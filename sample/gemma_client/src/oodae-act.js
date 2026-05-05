// ============================================================
//  oodae-act.js — ACT phase
//  Tool execution with URL validation, dedup, auto-fetch harness
//  Supports parallel execution of independent tools
// ============================================================

import { HarnessConfig } from './config.js';

const SEARCH_TOOLS = new Set(HarnessConfig.policies.searchTools);

// ===== ACT: Execute tool plan with parallel + sequential harness =====
export async function _act(planOrCtx, callbacks) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    // Legacy callers: _act({ plan: [...] }, { onToolCall, onToolResult, toolTrace })
    // Ctx callers:    _act(ctx)  — reads ctx.plan, ctx.callbacks, ctx.toolTrace
    const isCtx = planOrCtx && typeof planOrCtx === 'object' && 'userText' in planOrCtx;
    const plan  = isCtx ? planOrCtx.plan : planOrCtx;
    const { onToolCall, onToolResult, toolTrace } = isCtx
        ? { ...planOrCtx.callbacks, toolTrace: planOrCtx.toolTrace }
        : callbacks;

    let steps = plan?.plan || [];
    if (steps.length === 0) return [];

    // ── Bug 3 write-protection: never save_memory with bogus values ──
    // Prevents CLASSIFY misidentification from destroying real memory data
    const BOGUS_VALUES = /^(unknown|null|undefined|none|\?|n\/a|not\s*set)$/i;
    steps = steps.filter(step => {
        if (step.tool === 'save_memory' && step.args?.value) {
            const val = String(step.args.value).trim();
            if (BOGUS_VALUES.test(val)) return false;
        }
        return true;
    });

    // Partition steps into independent (parallel-safe) and search-chain (sequential)
    const independent = [];
    const searchChain = [];
    for (const step of steps) {
        (SEARCH_TOOLS.has(step.tool) ? searchChain : independent).push(step);
    }

    const results = [];
    const knownUrls = new Set();
    const fetchedUrls = new Set();

    // ── Execute independent tools in parallel + search chain sequentially, concurrently ──
    const independentPromise = independent.length > 0
        ? this._actParallel(independent, { onToolCall, onToolResult, toolTrace })
        : Promise.resolve([]);

    const searchPromise = searchChain.length > 0
        ? this._actSearchChain(searchChain, { onToolCall, onToolResult, toolTrace, knownUrls, fetchedUrls })
        : Promise.resolve([]);

    const [indepResults, searchResults] = await Promise.all([independentPromise, searchPromise]);
    results.push(...indepResults, ...searchResults);

    return results;
}

// ===== Execute independent tools in parallel =====
export async function _actParallel(steps, { onToolCall, onToolResult, toolTrace }) {
    const execOne = async (step) => {
        const name = step.tool;
        const args = { ...(step.args || {}) };

        onToolCall({ name, arguments: args });
        const execResult = await this.registry.execute(name, args);
        onToolResult({ name, arguments: args }, execResult);

        toolTrace.push({ name, arguments: args, ...execResult });
        return { name, args, ...(execResult.error ? { error: execResult.error } : { result: execResult.result }) };
    };

    if (steps.length === 1) return [await execOne(steps[0])];
    return Promise.all(steps.map(s => execOne(s)));
}

// ===== Execute search-related tools sequentially (URL tracking + auto-fetch) =====
export async function _actSearchChain(steps, { onToolCall, onToolResult, toolTrace, knownUrls, fetchedUrls }) {
    const results = [];

    for (const step of steps) {
        const name = step.tool;
        const args = { ...(step.args || {}) };

        // ── Harness: shorten web_search queries ──
        if (name === 'web_search' && args.query) {
            args.query = this._shortenQuery(args.query);
        }

        // ── Harness: URL fetch dedup — skip if already fetched this run ──
        if ((name === 'fetch_url' || name === 'summarize_url') && args.url && fetchedUrls.has(args.url)) {
            onToolCall({ name, arguments: args });
            onToolResult({ name, arguments: args }, { result: '(skipped — already fetched)' });
            continue;
        }

        // ── Harness: validate fetch/summarize URLs against known search results ──
        if ((name === 'fetch_url' || name === 'summarize_url') && args.url) {
            const fixed = this._validateUrl(args.url, knownUrls);
            if (fixed) {
                args.url = fixed;
            } else if (knownUrls.size > 0) {
                onToolCall({ name, arguments: args });
                onToolResult({ name, arguments: args }, { result: '(skipped — URL not from search results)' });
                continue;
            }
        }

        onToolCall({ name, arguments: args });
        const execResult = await this.registry.execute(name, args);
        onToolResult({ name, arguments: args }, execResult);

        // ── Vision fallback: if fetch_url returned thin content + screenshot, use vision ──
        if ((name === 'fetch_url' || name === 'summarize_url') && execResult.result?.screenshotBase64) {
            await this._visionEnhanceResult(execResult.result);
        }

        toolTrace.push({ name, arguments: args, ...execResult });
        results.push({ name, args, ...(execResult.error ? { error: execResult.error } : { result: execResult.result }) });

        // Track fetched URLs for dedup
        if ((name === 'fetch_url' || name === 'summarize_url') && args.url && !execResult.error) {
            fetchedUrls.add(args.url);
        }

        // Track known URLs from web_search results
        if (name === 'web_search' && !execResult.error && execResult.result?.results) {
            for (const r of execResult.result.results) {
                if (r.url) knownUrls.add(r.url);
            }
        }

        // ── Harness: auto-fetch top URL after web_search ──
        if (name === 'web_search' && !execResult.error && execResult.result?.results?.length > 0) {
            const topUrl = this._pickBestUrl(execResult.result.results);
            if (topUrl && this.registry.has('fetch_url') && !fetchedUrls.has(topUrl)) {
                const fetchArgs = { url: topUrl, max_length: 15000 };
                onToolCall({ name: 'fetch_url', arguments: fetchArgs });
                try {
                    const fetchResult = await this.registry.execute('fetch_url', fetchArgs);
                    if (!fetchResult.error) {
                        if (fetchResult.result?.screenshotBase64) {
                            await this._visionEnhanceResult(fetchResult.result);
                        }
                        onToolResult({ name: 'fetch_url', arguments: fetchArgs }, fetchResult);
                        toolTrace.push({ name: 'fetch_url', arguments: fetchArgs, ...fetchResult });
                        results.push({ name: 'fetch_url', args: fetchArgs, result: fetchResult.result });
                        fetchedUrls.add(topUrl);
                    } else {
                        onToolResult({ name: 'fetch_url', arguments: fetchArgs }, { result: '(skipped — site unreachable)' });
                    }
                } catch (e) {
                    console.warn('auto-fetch failed:', e.message);
                    onToolResult({ name: 'fetch_url', arguments: fetchArgs }, { result: '(skipped — fetch error)' });
                }
            }
        }
    }
    return results;
}

// ===== Vision fallback: extract page content from screenshot when text is thin =====
export async function _visionEnhanceResult(result) {
    if (!result?.screenshotBase64) return;
    const screenshot = result.screenshotBase64;
    delete result.screenshotBase64;
    try {
        const prompt = 'Extract all visible text from this webpage screenshot. Include names, titles, company info, contact details, and any other relevant content. Be thorough and structured.';
        const visionText = await this.api.vision(prompt, screenshot, 'image/jpeg', [], {});
        if (visionText && visionText.length > result.content_length) {
            result.content = visionText;
            result.content_length = visionText.length;
            result.source = 'vision';
        }
    } catch (e) {
        console.warn('vision extraction failed:', e.message);
    }
}

// ===== URL validation against known search results =====
export function _validateUrl(url, knownUrls) {
    if (knownUrls.has(url)) return url;
    try {
        const u = new URL(url);
        for (const known of knownUrls) {
            const k = new URL(known);
            if (u.pathname !== '/' && k.pathname.includes(u.pathname.replace(/\/$/, ''))) {
                return known;
            }
            if (k.hostname === u.hostname) return url;
            if (k.hostname.replace(/-/g, '') === u.hostname.replace(/-/g, '')) {
                return known.replace(k.pathname, u.pathname);
            }
        }
    } catch { /* invalid URL — not validatable */ }
    return null;
}

// ===== Shorten search queries =====
// P29b: preserve multi-word entities and legal suffixes while shortening.
// "New York Stock Exchange earnings 2024 quarterly report" → "New York Stock Exchange earnings 2024"
// Previously broke "New York Stock Exchange" into "New York Stock" at 6-word limit.
export function _shortenQuery(query) {
    // Step 1: strip leading filler phrases
    let q = query
        .replace(/^(what is|who is|where is|when is|when did|how to|how much|how many|find|search for|look up|tell me about|i want to know|can you find)\s+/i, '')
        .trim();

    // Step 2: strip trailing filler only (not mid-sentence stopwords that may be part of entity names)
    // "Bank of Japan interest rate" → keep "of" because "Bank of Japan" is an entity
    // Only strip stopwords that appear OUTSIDE of capitalized entity phrases
    const STOPWORDS = /\b(the|a|an)\b/gi;
    q = q.replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim();

    // Step 3: enforce word limit (increased from 6 to 8 for better coverage)
    const words = q.split(/\s+/);
    const maxWords = HarnessConfig.truncation.queryMaxWords;
    if (words.length > maxWords) q = words.slice(0, maxWords).join(' ');

    // Step 4: safety — don't collapse to nothing
    if (words.length <= 1 && query.split(/\s+/).length > 1) return query;
    return q.length >= 3 ? q : query;
}

// ===== Pick best URL from search results (domain reputation scoring) =====
export function _pickBestUrl(searchResults) {
    const SKIP_EXT = HarnessConfig.policies.skipExtensions;
    const SKIP_SITE = HarnessConfig.policies.skipSites;
    const PREFERRED = HarnessConfig.policies.preferredDomains || [];

    const _isPreferred = (url) => {
        try {
            const h = new URL(url).hostname.toLowerCase();
            return PREFERRED.some(d => h === d || h.endsWith('.' + d));
        } catch { return false; /* invalid URL */ }
    };
    const _isEduGov = (url) => {
        try { return /\.(edu|gov)$/i.test(new URL(url).hostname); } catch { return false; /* invalid URL */ }
    };
    const _valid = (r) => r.url && !SKIP_EXT.test(r.url) && !SKIP_SITE.test(r.url);

    // Pass 0: dominant high-score result (score > 3× any preferred domain result)
    // e.g. personal website score=6 beats github.com score=1 for "yapweijun1996"
    const bestPreferredScore = searchResults
        .filter(r => _valid(r) && r.snippet?.length > 20 && _isPreferred(r.url))
        .reduce((max, r) => Math.max(max, r.score || 0), 0);
    const dominant = searchResults
        .filter(r =>
            _valid(r) && r.snippet?.length > 20 && (r.score || 0) >= 3 &&
            (!bestPreferredScore || (r.score || 0) >= 3 * bestPreferredScore)
        )
        .reduce((best, r) => {
            if (!best) return r;
            return (r.score || 0) > (best.score || 0) ? r : best;
        }, null);
    if (dominant) return dominant.url;

    // Pass 1: preferred domain with snippet
    for (const r of searchResults) {
        if (_valid(r) && r.snippet?.length > 20 && _isPreferred(r.url)) return r.url;
    }
    // Pass 2: .edu/.gov with snippet
    for (const r of searchResults) {
        if (_valid(r) && r.snippet?.length > 20 && _isEduGov(r.url)) return r.url;
    }
    // Pass 3: any URL with snippet (original behavior)
    for (const r of searchResults) {
        if (_valid(r) && r.snippet?.length > 20) return r.url;
    }
    // Pass 4: any valid URL
    for (const r of searchResults) {
        if (_valid(r)) return r.url;
    }
    return null;
}
