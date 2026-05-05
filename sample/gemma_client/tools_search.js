// ============================================================
//  tools_search.js — Web search, fetch, and knowledge tools (9 tools)
//  Called by registerTools() in chat_tools.js
// ============================================================

function registerSearchTools(registry) {
    const _svc = (typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig) ? GemmaClient.HarnessConfig.services : null;
    const _cfg = (typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig) ? GemmaClient.HarnessConfig : null;
    const _searchCache = new Map();

    function _normalizeUrl(rawUrl) {
        try {
            const u = new URL(rawUrl);
            u.hash = '';
            return u.toString().replace(/\/$/, '');
        } catch {
            return String(rawUrl || '').replace(/\/$/, '');
        }
    }

    function _rememberSearchResults(query, results) {
        for (const r of results || []) {
            if (!r?.url) continue;
            const key = _normalizeUrl(r.url);
            const prev = _searchCache.get(key) || {};
            _searchCache.set(key, {
                url: r.url,
                title: r.title || prev.title || '',
                snippet: r.snippet || prev.snippet || '',
                query: query || prev.query || '',
                engine: r.engine || prev.engine || '',
                publishedDate: r.publishedDate || prev.publishedDate || null
            });
        }
    }

    function _cachedSearchHit(url) {
        const normalized = _normalizeUrl(url);
        if (_searchCache.has(normalized)) return _searchCache.get(normalized);
        try {
            const want = new URL(normalized);
            for (const hit of _searchCache.values()) {
                const got = new URL(hit.url);
                if (got.hostname === want.hostname && got.pathname.replace(/\/$/, '') === want.pathname.replace(/\/$/, '')) {
                    return hit;
                }
            }
        } catch { /* ignore malformed URL */ }
        return null;
    }

    function _truncate(text, max, suffix = '... [truncated]') {
        const str = String(text || '').trim();
        if (!max || str.length <= max) return str;
        const head = Math.max(0, max - suffix.length);
        return str.slice(0, head) + suffix;
    }

    function _collapseWhitespace(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function _createTimeoutSignal(timeoutMs) {
        if (!timeoutMs || typeof AbortController === 'undefined') {
            return { signal: undefined, cleanup: () => {} };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return {
            signal: controller.signal,
            cleanup: () => clearTimeout(timer)
        };
    }

    async function _fetchWithTimeout(url, options, timeoutMs) {
        const { signal, cleanup } = _createTimeoutSignal(timeoutMs);
        try {
            return await fetch(url, signal ? { ...options, signal } : options);
        } finally {
            cleanup();
        }
    }

    function _extractReadableText(raw, contentType) {
        const type = String(contentType || '').toLowerCase();
        if (!raw) return { title: '', content: '' };

        if (type.includes('text/plain') || (!type && !/<[a-z!][\s\S]*>/i.test(raw))) {
            return { title: '', content: _collapseWhitespace(raw) };
        }

        if (typeof DOMParser !== 'undefined') {
            try {
                const doc = new DOMParser().parseFromString(raw, 'text/html');
                for (const node of doc.querySelectorAll('script, style, noscript, svg, iframe, header, footer, nav')) {
                    node.remove();
                }
                const main = doc.querySelector('article, main, [role="main"]') || doc.body;
                const title = _collapseWhitespace(doc.title || '');
                const content = _collapseWhitespace(main?.innerText || main?.textContent || '');
                return { title, content };
            } catch { /* fall back to regex strip */ }
        }

        const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = _collapseWhitespace(titleMatch?.[1] || '');
        const content = _collapseWhitespace(raw.replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' '));
        return { title, content };
    }

    async function _fetchReadablePage(url, maxLength) {
        const timeoutMs = _svc?.search?.directFetchTimeoutMs || 5000;
        const res = await _fetchWithTimeout(url, {
            method: 'GET',
            headers: { 'Accept': 'text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.1' }
        }, timeoutMs);
        if (!res.ok) throw new Error(`Direct fetch error: ${res.status}`);
        const raw = await res.text();
        const extracted = _extractReadableText(raw, res.headers?.get?.('content-type') || '');
        if (!extracted.content) throw new Error('Direct fetch returned no readable content');
        const content = _truncate(extracted.content, maxLength);
        return {
            url,
            final_url: res.url || url,
            title: extracted.title || '',
            content,
            content_length: content.length,
            status: res.status,
            source: 'direct_fetch_fallback'
        };
    }

    function _searchSnippetFallback(url, maxLength) {
        const hit = _cachedSearchHit(url);
        if (!hit) return null;
        const content = _truncate(_collapseWhitespace(
            `Search result fallback. Query: ${hit.query || 'unknown'}. ` +
            `Title: ${hit.title || 'Untitled'}. ` +
            `Snippet: ${hit.snippet || 'No snippet available.'}`
        ), maxLength);
        return {
            url: hit.url || url,
            final_url: hit.url || url,
            title: hit.title || '',
            content,
            content_length: content.length,
            status: 'search-snippet-fallback',
            source: 'search_snippet_fallback',
            query: hit.query || ''
        };
    }

    async function _readUrlContent(url, maxLength) {
        const timeoutMs = _svc?.search?.readUrlTimeoutMs || 8000;
        const apiKey = _svc?.search?.readUrlApiKey;
        const headers = {
            'Content-Type': 'application/json'
        };
        if (apiKey) headers['x-api-key'] = apiKey;
        const res = await _fetchWithTimeout(_svc?.search?.readUrl || 'https://readurl.b1122333.com/read-url', {
            method: 'POST',
            headers,
            body: JSON.stringify({ url })
        }, timeoutMs);
        if (!res.ok) throw new Error(`ReadURL error: ${res.status}`);
        const data = await res.json();
        const content = _truncate(data.contentMarkdown || data.textExcerpt || '', maxLength);
        const result = {
            url: data.url || url,
            final_url: data.finalUrl || data.url || url,
            title: data.title || '',
            content,
            content_length: content.length,
            load_time_ms: data.meta?.loadTimeMs,
            status: data.meta?.statusCode || res.status,
            source: 'readurl'
        };
        // Pass screenshot when text extraction is too thin — agent can use vision
        const threshold = _cfg?.truncation?.visionFallbackThreshold || 300;
        if (data.screenshotBase64 && content.length < threshold) {
            result.screenshotBase64 = data.screenshotBase64;
        }
        return result;
    }

    async function _fetchContentWithFallback(url, maxLength) {
        const errors = [];
        try {
            return await _readUrlContent(url, maxLength);
        } catch (err) {
            errors.push(err.message || String(err));
        }

        const snippetFallback = _searchSnippetFallback(url, Math.min(maxLength, 1200));
        if (snippetFallback) return snippetFallback;

        try {
            return await _fetchReadablePage(url, maxLength);
        } catch (err) {
            errors.push(err.message || String(err));
        }

        throw new Error(errors.join(' | ') || 'Unable to read page');
    }

    // --- SearXNG Web Search ---
    registry.add({
        name: 'web_search',
        description: 'Search the web using SearXNG. Returns real search results from multiple engines (Google, Bing, DuckDuckGo, Brave, etc). Use this for any factual question, current events, or when you need up-to-date information.',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query, e.g. "latest AI news 2025"' },
            max_results: { type: 'number', required: false, default: 5, description: 'Number of results to return (1-10)' },
            categories: { type: 'string', required: false, default: 'general', description: 'Search category', enum: ['general', 'news', 'images', 'videos', 'it', 'science', 'music'] }
        },
        handler: async (args) => {
            const limit = Math.min(Math.max(args.max_results || 5, 1), 10);
            const cat = args.categories || 'general';
            const url = `${_svc?.search?.searxng || 'https://search.yapweijun1996.com/search'}?q=${encodeURIComponent(args.query)}&format=json&categories=${cat}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`SearXNG error: ${res.status}`);
            const data = await res.json();
            const results = (data.results || []).slice(0, limit).map(r => ({
                title: r.title, url: r.url, snippet: r.content || '',
                engine: r.engine, score: r.score, publishedDate: r.publishedDate || null
            }));
            _rememberSearchResults(args.query, results);
            return { query: args.query, category: cat, total_results: data.number_of_results || 0, results, suggestions: (data.suggestions || []).slice(0, 3), answers: data.answers || [] };
        }
    });

    // --- DuckDuckGo Instant Answer ---
    registry.add({
        name: 'ddg_search',
        description: 'Quick search using DuckDuckGo Instant Answer API. Returns Wikipedia-style summaries and related topics. Best for "what is X" questions. For full web results, use web_search instead.',
        parameters: { query: { type: 'string', required: true, description: 'Search query' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.search?.ddg || 'https://api.duckduckgo.com/'}?q=${encodeURIComponent(args.query)}&format=json&no_html=1`);
            if (!res.ok) throw new Error('DuckDuckGo error: ' + res.status);
            const d = await res.json();
            return { heading: d.Heading || '', abstract: d.Abstract || '', source: d.AbstractSource || '', url: d.AbstractURL || '', type: d.Type || '', related: (d.RelatedTopics || []).slice(0, 5).map(t => t.Text || '').filter(Boolean) };
        }
    });

    // --- LIVE: Read URL via readurl.b1122333.com ---
    registry.add({
        name: 'fetch_url',
        description: 'Fetch and read the content of any webpage URL. Returns clean markdown content, title, and page metadata. Use this to read articles, documentation, blog posts, or any web page.',
        parameters: {
            url: { type: 'string', required: true, description: 'Full URL to fetch, e.g. "https://example.com/article"' },
            max_length: { type: 'number', required: false, default: 15000, description: 'Max characters of content to return' }
        },
        handler: async (args) => _fetchContentWithFallback(args.url, args.max_length || _cfg?.truncation?.fetchUrlMaxLength || 15000)
    });

    // --- LIVE: Summarize URL via readurl.b1122333.com ---
    registry.add({
        name: 'summarize_url',
        description: 'Fetch a webpage and return its markdown content for summarization. Returns clean extracted text ready for the model to summarize.',
        parameters: { url: { type: 'string', required: true, description: 'URL to fetch and summarize' } },
        handler: async (args) => {
            const data = await _fetchContentWithFallback(args.url, 3000);
            return {
                url: data.url,
                final_url: data.final_url,
                title: data.title || '',
                content_length: data.content_length || 0,
                content: data.content,
                load_time_ms: data.load_time_ms,
                status: data.status,
                source: data.source
            };
        }
    });

    // --- Wikipedia ---
    registry.add({
        name: 'wikipedia',
        description: 'Get a summary of any topic from Wikipedia.',
        parameters: { topic: { type: 'string', required: true, description: 'Topic to look up' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.knowledge?.wikipedia || 'https://en.wikipedia.org/api/rest_v1/page/summary/'}${encodeURIComponent(args.topic)}`);
            if (!res.ok) throw new Error('Wikipedia error: ' + res.status);
            const data = await res.json();
            return { title: data.title, description: data.description || '', extract: data.extract || '', url: data.content_urls?.desktop?.page || '', thumbnail: data.thumbnail?.source || null };
        }
    });

    // --- Wikidata (structured entity) ---
    registry.add({
        name: 'wikidata',
        description: 'Look up structured entity data from Wikidata. Returns entity ID, label, description, and aliases. Useful for fact verification and knowledge graph queries.',
        parameters: { query: { type: 'string', required: true, description: 'Entity to search, e.g. "Singapore", "Albert Einstein"' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.knowledge?.wikidata || 'https://www.wikidata.org/w/api.php'}?action=wbsearchentities&search=${encodeURIComponent(args.query)}&language=en&format=json&origin=*&limit=3`);
            if (!res.ok) throw new Error('Wikidata error: ' + res.status);
            const d = await res.json();
            return { query: args.query, results: (d.search || []).map(e => ({ id: e.id, label: e.label, description: e.description || '', url: e.concepturi })) };
        }
    });

    // --- Open Library (book search) ---
    registry.add({
        name: 'search_books',
        description: 'Search for books by title, author, or subject using Open Library.',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query, e.g. "harry potter", "machine learning"' },
            limit: { type: 'number', required: false, default: 5 }
        },
        handler: async (args) => {
            const res = await fetch(`${_svc?.knowledge?.openLibrary || 'https://openlibrary.org/search.json'}?q=${encodeURIComponent(args.query)}&limit=${args.limit || 5}`);
            if (!res.ok) throw new Error('Open Library error: ' + res.status);
            const d = await res.json();
            return { query: args.query, total: d.numFound, books: (d.docs || []).map(b => ({ title: b.title, author: (b.author_name || []).join(', '), year: b.first_publish_year, isbn: (b.isbn || [])[0] || null, subjects: (b.subject || []).slice(0, 3) })) };
        }
    });

    // --- CrossRef (academic papers) ---
    registry.add({
        name: 'search_papers',
        description: 'Search for academic/research papers using CrossRef. Returns paper titles, authors, DOI, and publication info.',
        parameters: { query: { type: 'string', required: true, description: 'Research topic or paper title' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.knowledge?.crossRef || 'https://api.crossref.org/works'}?query=${encodeURIComponent(args.query)}&rows=5`);
            if (!res.ok) throw new Error('CrossRef error: ' + res.status);
            const d = await res.json();
            return { query: args.query, total: d.message?.['total-results'] || 0, papers: (d.message?.items || []).map(p => ({ title: (p.title || [])[0] || 'Untitled', authors: (p.author || []).map(a => `${a.given || ''} ${a.family || ''}`).slice(0, 3), doi: p.DOI, type: p.type, year: p['published-print']?.['date-parts']?.[0]?.[0] || p.created?.['date-parts']?.[0]?.[0], url: p.URL })) };
        }
    });

    // --- StackExchange (coding Q&A) ---
    registry.add({
        name: 'search_code',
        description: 'Search StackOverflow for programming questions and answers. Great for coding help, error messages, and how-to queries.',
        parameters: { query: { type: 'string', required: true, description: 'Programming question or error message' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.knowledge?.stackExchange || 'https://api.stackexchange.com/2.3/search'}?order=desc&sort=relevance&intitle=${encodeURIComponent(args.query)}&site=stackoverflow&pagesize=5`);
            if (!res.ok) throw new Error('StackExchange error: ' + res.status);
            const d = await res.json();
            return { query: args.query, total: d.items?.length || 0, questions: (d.items || []).map(q => ({ title: q.title, link: q.link, score: q.score, answered: q.is_answered, answers: q.answer_count, tags: q.tags?.slice(0, 3) })), quota_remaining: d.quota_remaining };
        }
    });
}
