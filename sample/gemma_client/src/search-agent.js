// ============================================================
//  search-agent.js — Agentic Web Search
//  A dedicated search agent that thinks before searching:
//  Plan → Execute → Validate → Refine → Synthesize
//
//  Instead of blindly executing DECIDE's query, the SearchAgent:
//  1. Understands the information need (not just keywords)
//  2. Generates optimal queries based on full conversation context
//  3. Validates results against the actual intent
//  4. Auto-refines if results are poor (different keywords, language, angle)
//  5. Cross-verifies facts when confidence is low
//
//  Design: minimal LLM calls (1 plan + 1 conditional refine = max 2)
//  with algorithmic validation between rounds.
// ============================================================

import { HarnessConfig } from './config.js';
import { COT, quoteForPrompt } from './cot-standard.js';
import { _parseJSON as _sharedParseJSON } from './oodae-helpers.js';
import { _pickBestUrl as _sharedPickBestUrl } from './oodae-act.js';

const MAX_SEARCH_ROUNDS = 3;

export class SearchAgent {
    constructor(api, registry) {
        this.api = api;
        this.registry = registry;
    }

    /**
     * Agentic search: the main entry point.
     * @param {string} originalQuery - The query from DECIDE (used as fallback)
     * @param {object} context - Full conversation context
     *   { intent, summary, entities, language, recentConversation, userProfile, previousQueries }
     * @param {object} callbacks - { onToolCall, onToolResult, toolTrace }
     * @returns {object} - { results[], fetchedContent[], queriesUsed[], rounds }
     */
    async search(originalQuery, context = {}, callbacks = {}) {
        const entities = (context.entities || []).map(e => String(e));
        const maxRounds = context.maxRounds || MAX_SEARCH_ROUNDS;
        const { onToolCall = () => {}, onToolResult = () => {}, toolTrace = [] } = callbacks;

        // ── Phase 1: PLAN — generate optimal search strategy ──
        let plan;
        try {
            plan = await this._generateSearchPlan(originalQuery, context);
        } catch (e) {
            // Fallback: use original query from DECIDE
            console.warn('SearchAgent plan generation failed:', e.message);
            plan = { queries: [{ q: originalQuery, reason: 'fallback to DECIDE query' }] };
        }

        // ── Phase 2: EXECUTE + VALIDATE loop ──
        const allResults = [];
        const fetchedContent = [];
        const queriesUsed = [];
        let round = 0;

        for (let i = 0; i < plan.queries.length && round < maxRounds; i++) {
            const step = plan.queries[i];
            const query = this._cleanQuery(step.q);
            if (!query || queriesUsed.includes(query)) continue;
            round++;
            queriesUsed.push(query);

            // Execute web_search
            const searchArgs = { query, max_results: HarnessConfig.truncation.searchMaxResults };
            onToolCall({ name: 'web_search', arguments: searchArgs });
            const searchResult = await this.registry.execute('web_search', searchArgs);
            onToolResult({ name: 'web_search', arguments: searchArgs }, searchResult);
            toolTrace.push({ name: 'web_search', arguments: searchArgs, ...searchResult });

            if (searchResult.error) continue;

            const results = searchResult.result?.results || [];
            allResults.push(...results.map(r => ({ ...r, _query: query, _round: round })));

            // Auto-fetch best URL for content extraction
            if (results.length > 0 && this.registry.has('fetch_url')) {
                const bestUrl = this._pickBestUrl(results);
                if (bestUrl) {
                    const fetchArgs = { url: bestUrl, max_length: HarnessConfig.truncation.fetchUrlMaxLength };
                    onToolCall({ name: 'fetch_url', arguments: fetchArgs });
                    try {
                        const fetchResult = await this.registry.execute('fetch_url', fetchArgs);
                        if (!fetchResult.error) {
                            onToolResult({ name: 'fetch_url', arguments: fetchArgs }, fetchResult);
                            toolTrace.push({ name: 'fetch_url', arguments: fetchArgs, ...fetchResult });
                            fetchedContent.push({
                                url: bestUrl,
                                content: fetchResult.result,
                                _query: query,
                                _round: round
                            });
                        }
                    } catch (e) { console.warn('SearchAgent auto-fetch failed:', e.message); }
                }
            }

            // ── Phase 3: VALIDATE — do results answer the question? ──
            const validation = this._validateResults(allResults, entities, context.summary || originalQuery);
            if (validation.score >= 0.5) {
                // Good results — stop searching
                break;
            }

            // ── Phase 4: REFINE — auto-generate better query if planned queries exhausted ──
            if (i >= plan.queries.length - 1 && round < maxRounds) {
                try {
                    const refined = await this._refineQuery(originalQuery, allResults, context, queriesUsed);
                    if (refined && !queriesUsed.includes(refined)) {
                        plan.queries.push({ q: refined, reason: 'auto-refined based on poor results' });
                    }
                } catch (e) { console.warn('SearchAgent query refinement failed:', e.message); }
            }
        }

        return {
            results: allResults,
            fetchedContent,
            queriesUsed,
            rounds: round
        };
    }

    // ===== Phase 1: Generate optimal search plan =====
    // One focused LLM call — SOLELY about generating good search queries.
    // Much more focused than DECIDE's prompt which handles tool selection, memory, multi-intent, etc.
    async _generateSearchPlan(originalQuery, context) {
        const { intent, summary, userText, entities = [], language, recentConversation, userProfile, previousQueries = [] } = context;

        const entityLine = entities.map(e => String(e)).join(', ') || 'none';
        const prevLine = previousQueries.length > 0
            ? `\nPREVIOUS QUERIES (already tried, do NOT repeat): ${previousQueries.map(q => `"${q}"`).join(', ')}`
            : '';
        const profileLine = userProfile && Object.keys(userProfile).length > 0
            ? `\nUSER CONTEXT: ${Object.entries(userProfile).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')}`
            : '';
        const conversationLine = recentConversation
            ? `\nRECENT CONVERSATION:\n${recentConversation}`
            : '';

        // Separate user's actual question from topic context for follow-ups.
        // "那日元呢？ (about: BOJ利率)" → userText="那日元呢？", topic="BOJ利率"
        // The SearchAgent must search for what the USER asked (日元), not repeat the topic (利率).
        const userQuestion = userText || originalQuery;
        const topicContext = summary && summary !== userQuestion
            ? `\nTOPIC CONTEXT: ${summary}`
            : '';

        const prompt = `You are a search query optimizer. Generate 1-3 optimal search queries.

USER'S QUESTION: ${quoteForPrompt(userQuestion)}${topicContext}
KEY ENTITIES: ${entityLine}
REPLY LANGUAGE: ${language || 'english'}${profileLine}${conversationLine}${prevLine}

${COT.searchPlan()}

{"queries":[{"q":"primary search query","reason":"why"},{"q":"alternative query","reason":"backup"}]}

JSON:`;

        const raw = await this.api.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { ...HarnessConfig.generation.deterministic }
        }).then(r => r.candidates[0].content.parts.map(p => p.text || '').join(''));

        const parsed = this._parseJSON(raw);
        if (parsed?.queries?.length > 0) return parsed;

        // Fallback: use original query
        return { queries: [{ q: originalQuery, reason: 'fallback' }] };
    }

    // ===== Phase 3: Validate results against intent =====
    // Algorithmic — no LLM call. Checks entity presence + snippet relevance.
    _validateResults(results, entities, intent) {
        if (!results || results.length === 0) return { score: 0, reason: 'no results' };

        const intentWords = (intent || '').toLowerCase().split(/[\s,;]+/).filter(w => w.length >= 2);
        const entityLower = entities.map(e => String(e).toLowerCase());

        let entityHits = 0;
        let intentHits = 0;
        let snippetQuality = 0;

        for (const r of results.slice(0, 5)) {
            const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();

            // Entity presence check
            for (const e of entityLower) {
                if (text.includes(e.slice(0, Math.min(e.length, 10)))) {
                    entityHits++;
                    break;
                }
            }

            // Intent word overlap
            const overlap = intentWords.filter(w => text.includes(w)).length;
            if (overlap >= 2) intentHits++;

            // Snippet quality (length + specificity)
            if ((r.snippet || '').length > 50) snippetQuality++;
        }

        const maxResults = Math.min(results.length, 5);
        const score = maxResults > 0
            ? (entityHits / maxResults * 0.5) + (intentHits / maxResults * 0.3) + (snippetQuality / maxResults * 0.2)
            : 0;

        return { score, entityHits, intentHits, snippetQuality };
    }

    // ===== Phase 4: Refine query based on poor results =====
    // One conditional LLM call — only fires when validation fails.
    async _refineQuery(originalQuery, results, context, triedQueries) {
        const snippets = results.slice(0, 3).map(r => `${r.title}: ${(r.snippet || '').slice(0, 80)}`).join('\n');
        const triedLine = triedQueries.map(q => `"${q}"`).join(', ');

        const prompt = `The following search queries did not find the answer: ${triedLine}
Search results were about: ${snippets || 'no results'}

The user actually wants: ${context.summary || originalQuery}
Key entities: ${(context.entities || []).join(', ') || 'none'}

Generate ONE better search query using DIFFERENT keywords or a different language.

${COT.searchRefine()}

Query:`;

        const raw = await this.api.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { ...HarnessConfig.generation.deterministic }
        }).then(r => r.candidates[0].content.parts.map(p => p.text || '').join(''));

        // Extract clean query
        let q = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        q = q.replace(/^["'`]+|["'`]+$/g, '').trim();
        return q.length >= 3 ? q : null;
    }

    // ===== Helpers =====

    _cleanQuery(query) {
        if (!query) return null;
        let q = query.trim();
        // Strip filler
        q = q.replace(/^(what is|who is|where is|tell me about|search for)\s+/i, '').trim();
        // Strip articles at start
        q = q.replace(/^(the|a|an)\s+/i, '').trim();
        return q.length >= 2 ? q : null;
    }

    _pickBestUrl(results) {
        return _sharedPickBestUrl(results);
    }

    _parseJSON(text) {
        // Delegate to shared parser (oodae-helpers.js) — single source of truth
        return _sharedParseJSON.call({ _repairPlanArray: () => null }, text);
    }
}
