// ============================================================
//  test_search_tools_browser.js — Unit tests for browser search tools
//  Executes tools_search.js inside a VM with mocked browser globals
// ============================================================

import vm from 'vm';
import { readFileSync } from 'fs';
import { HarnessConfig } from '../src/config.js';
import { assertContains, assertEqual, assertFalse, assertTrue, group, results, resetResults, summarize } from './helpers.js';

function createRegistry() {
    const defs = new Map();
    return {
        add(def) { defs.set(def.name, def); },
        get(name) { return defs.get(name); }
    };
}

function loadBrowserSearchTools(fetchImpl) {
    const script = readFileSync(new URL('../tools_search.js', import.meta.url), 'utf-8');
    const registry = createRegistry();
    const sandbox = {
        console,
        fetch: fetchImpl,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        JSON,
        String,
        Math,
        Date,
        encodeURIComponent,
        GemmaClient: { HarnessConfig }
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox, { filename: 'tools_search.js' });
    sandbox.registerSearchTools(registry);
    return registry;
}

export async function run() {
    resetResults();
    console.log('\n📦 test_search_tools_browser.js');

    group('fetch_url — falls back to cached search snippet when browser reads fail');

    {
        const calls = [];
        const registry = loadBrowserSearchTools(async (url, options = {}) => {
            calls.push({ url, options });
            if (String(url).startsWith(HarnessConfig.services.search.searxng)) {
                return {
                    ok: true,
                    json: async () => ({
                        results: [{
                            title: 'Example Article',
                            url: 'https://example.com/article',
                            content: 'Competitive positioning snippet from search results',
                            engine: 'mock'
                        }]
                    })
                };
            }
            if (url === HarnessConfig.services.search.readUrl) {
                throw new Error('Failed to fetch');
            }
            if (url === 'https://example.com/article') {
                throw new Error('CORS blocked');
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const searchTool = registry.get('web_search');
        const fetchTool = registry.get('fetch_url');
        await searchTool.handler({ query: 'notion competitors', max_results: 5 });
        const result = await fetchTool.handler({ url: 'https://example.com/article', max_length: 180 });

        assertEqual(result.source, 'search_snippet_fallback', 'uses snippet fallback after browser read failures');
        assertContains(result.content, 'Competitive positioning snippet', 'fallback content includes cached snippet');
        assertContains(result.content, 'notion competitors', 'fallback content preserves originating query');
        assertTrue(calls.some(c => c.url === HarnessConfig.services.search.readUrl && c.options.signal), 'readUrl request has abort signal');
        assertTrue(calls.some(c => c.url === HarnessConfig.services.search.readUrl && !('x-api-key' in (c.options.headers || {}))), 'readUrl request omits API key when none configured');
        assertFalse(calls.some(c => c.url === 'https://example.com/article'), 'does not direct-fetch cross-origin page before snippet fallback');
    }

    group('fetch_url — falls back to direct text fetch when readable');

    {
        const registry = loadBrowserSearchTools(async (url, options = {}) => {
            if (url === HarnessConfig.services.search.readUrl) {
                throw new Error('Read service unavailable');
            }
            if (url === 'https://example.com/plain.txt') {
                return {
                    ok: true,
                    status: 200,
                    url,
                    headers: { get: () => 'text/plain; charset=utf-8' },
                    text: async () => 'Line one about positioning.\nLine two with more context.\nLine three keeps going.'
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const fetchTool = registry.get('fetch_url');
        const result = await fetchTool.handler({ url: 'https://example.com/plain.txt', max_length: 55 });

        assertEqual(result.source, 'direct_fetch_fallback', 'uses direct fetch fallback for readable pages');
        assertContains(result.content, 'Line one about positioning.', 'direct fetch keeps readable text');
        assertTrue(result.content.length <= 55, 'direct fetch respects max_length');
    }

    group('summarize_url — reuses fallback pipeline');

    {
        const registry = loadBrowserSearchTools(async (url) => {
            if (url === HarnessConfig.services.search.readUrl) {
                throw new Error('Read service unavailable');
            }
            if (url === 'https://example.com/plain.txt') {
                return {
                    ok: true,
                    status: 200,
                    url,
                    headers: { get: () => 'text/plain' },
                    text: async () => 'Summary text from direct fetch fallback.'
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const summarizeTool = registry.get('summarize_url');
        const result = await summarizeTool.handler({ url: 'https://example.com/plain.txt' });

        assertEqual(result.source, 'direct_fetch_fallback', 'summarize_url uses the same fallback pipeline');
        assertContains(result.content, 'Summary text from direct fetch fallback.', 'summarize_url returns fallback content');
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
