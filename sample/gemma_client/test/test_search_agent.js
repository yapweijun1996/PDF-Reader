// ============================================================
//  test/test_search_agent.js — Unit tests for src/search-agent.js
//  Tests SearchAgent with mocked API and registry
//  No real API calls
// ============================================================

import { assertEqual, assertTrue, assertFalse, assertContains, assertGreater, group, results, resetResults, summarize } from './helpers.js';
import { SearchAgent } from '../src/search-agent.js';
import { HarnessConfig } from '../src/config.js';

// ===== Mock API =====
function createMockAPI(responses = []) {
    let callIdx = 0;
    const callLog = [];
    return {
        callLog,
        generateContent(opts) {
            const prompt = opts.contents[0].parts[0].text;
            callLog.push({ prompt, opts });
            const text = typeof responses === 'function'
                ? responses(callIdx++, prompt)
                : (responses[callIdx++] || '{}');
            return Promise.resolve({
                candidates: [{ content: { parts: [{ text }] } }],
                usageMetadata: { totalTokenCount: 100 }
            });
        }
    };
}

// ===== Mock Registry =====
function createMockRegistry(searchResults = [], fetchResult = null) {
    const executeCalls = [];
    return {
        executeCalls,
        has(name) { return ['web_search', 'fetch_url'].includes(name); },
        execute(name, args) {
            executeCalls.push({ name, args });
            if (name === 'web_search') {
                return Promise.resolve({ result: { query: args.query, results: searchResults } });
            }
            if (name === 'fetch_url') {
                if (fetchResult) return Promise.resolve({ result: fetchResult });
                return Promise.resolve({ result: { url: args.url, title: 'Page', content: 'Page content' } });
            }
            return Promise.resolve({ error: 'unknown tool' });
        }
    };
}

export async function run() {
    resetResults();
    console.log('\n📦 test_search_agent.js');

    // ════════════════════════════════════════════════
    // Constructor
    // ════════════════════════════════════════════════
    group('SearchAgent constructor');

    {
        const api = createMockAPI();
        const reg = createMockRegistry();
        const agent = new SearchAgent(api, reg);
        assertTrue(agent.api === api, 'api assigned');
        assertTrue(agent.registry === reg, 'registry assigned');
    }

    // ════════════════════════════════════════════════
    // _cleanQuery
    // ════════════════════════════════════════════════
    group('_cleanQuery — filler removal');

    {
        const agent = new SearchAgent(null, null);

        assertEqual(agent._cleanQuery('what is quantum computing'), 'quantum computing', 'strips "what is"');
        assertEqual(agent._cleanQuery('who is Elon Musk'), 'Elon Musk', 'strips "who is"');
        assertEqual(agent._cleanQuery('where is Singapore'), 'Singapore', 'strips "where is"');
        assertEqual(agent._cleanQuery('tell me about Tesla'), 'Tesla', 'strips "tell me about"');
        assertEqual(agent._cleanQuery('search for Bitcoin price'), 'Bitcoin price', 'strips "search for"');
        assertEqual(agent._cleanQuery('the latest news'), 'latest news', 'strips leading article');
        assertEqual(agent._cleanQuery('Tesla CEO'), 'Tesla CEO', 'no stripping when no filler');
        assertEqual(agent._cleanQuery('a'), null, 'too short → null');
        assertEqual(agent._cleanQuery(''), null, 'empty → null');
        assertEqual(agent._cleanQuery(null), null, 'null → null');
        assertEqual(agent._cleanQuery('   Tesla   '), 'Tesla', 'trims whitespace');
    }

    // ════════════════════════════════════════════════
    // _pickBestUrl
    // ════════════════════════════════════════════════
    group('_pickBestUrl — domain preference');

    {
        const agent = new SearchAgent(null, null);

        // Preferred domain with snippet wins
        const results1 = [
            { url: 'https://example.com/page', snippet: 'Some content here for example' },
            { url: 'https://en.wikipedia.org/wiki/Tesla', snippet: 'Tesla Inc is a company that makes EVs' }
        ];
        assertEqual(agent._pickBestUrl(results1), 'https://en.wikipedia.org/wiki/Tesla', 'Wikipedia preferred');

        // Skip social media
        const results2 = [
            { url: 'https://twitter.com/elonmusk', snippet: 'Elon Musk tweet about Tesla' },
            { url: 'https://reuters.com/article/tesla', snippet: 'Tesla earnings report Q4' }
        ];
        assertEqual(agent._pickBestUrl(results2), 'https://reuters.com/article/tesla', 'skips twitter');

        // Skip PDF
        const results3 = [
            { url: 'https://example.com/report.pdf', snippet: 'Annual report' },
            { url: 'https://example.com/article', snippet: 'Article about topic' }
        ];
        assertEqual(agent._pickBestUrl(results3), 'https://example.com/article', 'skips PDF');

        // Skip images
        const results4 = [
            { url: 'https://example.com/photo.jpg', snippet: 'A photo' },
            { url: 'https://example.com/page', snippet: 'A page with actual content' }
        ];
        assertEqual(agent._pickBestUrl(results4), 'https://example.com/page', 'skips jpg');

        // No valid URLs → null
        const results5 = [
            { url: 'https://facebook.com/page', snippet: 'FB post' },
            { url: 'https://instagram.com/photo', snippet: 'IG photo' }
        ];
        assertEqual(agent._pickBestUrl(results5), null, 'all blocked → null');

        // Empty results
        assertEqual(agent._pickBestUrl([]), null, 'empty → null');

        // URL without snippet — still valid but lower priority
        const results6 = [
            { url: 'https://example.com/page1', snippet: '' },
            { url: 'https://example.com/page2', snippet: 'A good snippet about the topic here' }
        ];
        assertEqual(agent._pickBestUrl(results6), 'https://example.com/page2', 'prefers URL with snippet');
    }

    // ════════════════════════════════════════════════
    // _validateResults — algorithmic validation
    // ════════════════════════════════════════════════
    group('_validateResults — scoring');

    {
        const agent = new SearchAgent(null, null);

        // Good results: entity present + intent words + snippets
        const good = [
            { title: 'Tesla CEO', snippet: 'Elon Musk is the CEO of Tesla, the electric vehicle company' },
            { title: 'About Tesla', snippet: 'Tesla Inc. was founded by several engineers including Elon Musk' }
        ];
        const goodScore = agent._validateResults(good, ['Tesla'], 'Tesla CEO');
        assertTrue(goodScore.score >= 0.5, `good results score ${goodScore.score} >= 0.5`);
        assertGreater(goodScore.entityHits, 0, 'entity hits > 0');

        // No results
        const emptyScore = agent._validateResults([], ['Tesla'], 'Tesla');
        assertEqual(emptyScore.score, 0, 'empty results score 0');

        // Irrelevant results
        const bad = [
            { title: 'Weather Report', snippet: 'Sunny day' },
            { title: 'Sports News', snippet: 'Football match score' }
        ];
        const badScore = agent._validateResults(bad, ['Tesla'], 'Tesla CEO');
        assertTrue(badScore.score < 0.5, `bad results score ${badScore.score} < 0.5`);

        // Null entities — intent-only scoring
        const noEntity = agent._validateResults(good, [], 'CEO electric vehicle');
        assertTrue(noEntity.entityHits === 0, 'no entity hits with empty entity list');

        // Long snippets contribute to quality
        const longSnippets = [
            { title: 'Tesla', snippet: 'A'.repeat(100) },
            { title: 'Tesla', snippet: 'B'.repeat(100) }
        ];
        const longScore = agent._validateResults(longSnippets, ['Tesla'], 'Tesla');
        assertGreater(longScore.snippetQuality, 0, 'long snippets add quality');
    }

    // ════════════════════════════════════════════════
    // _parseJSON
    // ════════════════════════════════════════════════
    group('_parseJSON — JSON recovery');

    {
        const agent = new SearchAgent(null, null);

        // Direct JSON
        assertEqual(agent._parseJSON('{"a":1}').a, 1, 'direct JSON');

        // With thinking tags
        assertEqual(agent._parseJSON('<thinking>hmm</thinking>{"a":1}').a, 1, 'strips thinking');

        // With code fences
        assertEqual(agent._parseJSON('```json\n{"a":1}\n```').a, 1, 'strips code fence');

        // Trailing comma
        assertEqual(agent._parseJSON('{"a":1,}').a, 1, 'fixes trailing comma');

        // Nested in text
        assertEqual(agent._parseJSON('Here is the answer: {"a":1} done.').a, 1, 'extracts from text');

        // Invalid → null
        assertEqual(agent._parseJSON('totally invalid'), null, 'invalid returns null');
    }

    // ════════════════════════════════════════════════
    // search() — full flow with mocks
    // ════════════════════════════════════════════════
    group('search — basic flow');

    {
        const api = createMockAPI([
            // _generateSearchPlan
            '{"queries":[{"q":"Tesla CEO name","reason":"primary"}]}'
        ]);
        const searchResults = [
            { title: 'Tesla CEO', url: 'https://en.wikipedia.org/wiki/Tesla', snippet: 'Elon Musk is the CEO of Tesla' }
        ];
        const reg = createMockRegistry(searchResults);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('Tesla CEO', { entities: ['Tesla'], summary: 'Tesla CEO' });
        assertGreater(result.results.length, 0, 'has results');
        assertEqual(result.queriesUsed[0], 'Tesla CEO name', 'used planned query');
        assertEqual(result.rounds, 1, 'one search round');
        assertTrue(result.fetchedContent.length > 0, 'auto-fetched URL');
    }

    group('search — plan fallback when LLM fails');

    {
        const api = createMockAPI([
            'totally broken LLM output'
        ]);
        const reg = createMockRegistry([
            { title: 'Result', url: 'https://example.com', snippet: 'Good result about Tesla' }
        ]);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('Tesla CEO', { entities: ['Tesla'], summary: 'Tesla CEO' });
        // Should fall back to original query
        assertContains(result.queriesUsed, 'Tesla CEO', 'used original query as fallback');
    }

    group('search — dedup same queries');

    {
        const api = createMockAPI([
            '{"queries":[{"q":"Tesla CEO","reason":"a"},{"q":"Tesla CEO","reason":"dup"}]}'
        ]);
        const reg = createMockRegistry([
            { title: 'Tesla', url: 'https://en.wikipedia.org/wiki/Tesla', snippet: 'Elon Musk CEO of Tesla Inc.' }
        ]);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('Tesla CEO', { entities: ['Tesla'], summary: 'Tesla CEO' });
        assertEqual(result.queriesUsed.length, 1, 'deduped duplicate queries');
    }

    group('search — duplicate queries do not consume rounds');

    {
        const api = createMockAPI([
            '{"queries":[{"q":"Tesla CEO","reason":"a"},{"q":"Tesla CEO","reason":"dup"},{"q":"Tesla stock price","reason":"b"}]}'
        ]);
        const reg = createMockRegistry([{ title: 'Irrelevant', url: 'https://example.com', snippet: 'nope' }]);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('Tesla CEO', { entities: ['Tesla'], summary: 'Tesla CEO', maxRounds: 2 });
        const searchCalls = reg.executeCalls.filter(c => c.name === 'web_search');
        assertEqual(result.rounds, 2, 'only executed searches count toward rounds');
        assertEqual(searchCalls.length, 2, 'second unique query still executes');
        assertEqual(searchCalls[1].args.query, 'Tesla stock price', 'backup query runs after duplicate is skipped');
    }

    group('search — stops on good validation');

    {
        const api = createMockAPI([
            '{"queries":[{"q":"Tesla CEO","reason":"a"},{"q":"Tesla stock","reason":"b"}]}'
        ]);
        // Return good results (entity match high)
        const reg = createMockRegistry([
            { title: 'Tesla CEO Elon Musk', url: 'https://en.wikipedia.org/wiki/Tesla', snippet: 'Tesla CEO is Elon Musk, he leads the electric vehicle company Tesla Inc.' },
            { title: 'Tesla Leaders', url: 'https://example.com/tesla', snippet: 'Tesla leadership team including Elon Musk as CEO and other executives' }
        ]);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('Tesla CEO', { entities: ['Tesla'], summary: 'Tesla CEO' });
        // Should stop after first query if results are good
        assertEqual(result.rounds, 1, 'stopped after 1 round (good results)');
    }

    group('search — callbacks fired');

    {
        const api = createMockAPI(['{"queries":[{"q":"test query","reason":"a"}]}']);
        const reg = createMockRegistry([{ title: 'R', url: 'https://en.wikipedia.org/wiki/test', snippet: 'Result text content here' }]);
        const agent = new SearchAgent(api, reg);

        const calls = [];
        const results_arr = [];
        const trace = [];
        await agent.search('test', { entities: ['test'], summary: 'test' }, {
            onToolCall: (c) => calls.push(c),
            onToolResult: (c, r) => results_arr.push({ call: c, result: r }),
            toolTrace: trace
        });

        assertGreater(calls.length, 0, 'onToolCall fired');
        assertGreater(results_arr.length, 0, 'onToolResult fired');
        assertGreater(trace.length, 0, 'toolTrace populated');
        assertEqual(calls[0].name, 'web_search', 'first call is web_search');
    }

    group('search — max rounds respected');

    {
        const api = createMockAPI((idx) => {
            if (idx === 0) return '{"queries":[{"q":"q1","reason":"a"},{"q":"q2","reason":"b"},{"q":"q3","reason":"c"},{"q":"q4","reason":"d"}]}';
            return '"q5"'; // refine result
        });
        // Always return bad results to force all rounds
        const reg = createMockRegistry([{ title: 'Irrelevant', url: 'https://example.com', snippet: 'nope' }]);
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('test', { entities: ['specific_entity_xyz'], summary: 'test', maxRounds: 2 });
        assertTrue(result.rounds <= 2, `rounds ${result.rounds} <= max 2`);
    }

    group('search — handles web_search error gracefully');

    {
        const api = createMockAPI(['{"queries":[{"q":"fail query","reason":"a"}]}']);
        const reg = {
            has: () => true,
            execute: (name) => Promise.resolve({ error: 'network error' })
        };
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('test', { entities: ['test'] });
        assertEqual(result.results.length, 0, 'no results on error');
        // Should not throw
        assertTrue(true, 'handled error gracefully');
    }

    group('search — no fetch_url if registry lacks it');

    {
        const api = createMockAPI(['{"queries":[{"q":"test","reason":"a"}]}']);
        const executeCalls = [];
        const reg = {
            has: (name) => name === 'web_search', // no fetch_url
            execute: (name, args) => {
                executeCalls.push(name);
                return Promise.resolve({ result: { query: args.query, results: [{ title: 'R', url: 'https://example.com', snippet: 'content' }] } });
            }
        };
        const agent = new SearchAgent(api, reg);

        const result = await agent.search('test', { entities: ['test'] });
        assertFalse(executeCalls.includes('fetch_url'), 'fetch_url not called when unavailable');
        assertEqual(result.fetchedContent.length, 0, 'no fetched content');
    }

    // ════════════════════════════════════════════════
    // _generateSearchPlan — prompt construction
    // ════════════════════════════════════════════════
    group('_generateSearchPlan — prompt includes context');

    {
        const api = createMockAPI((idx, prompt) => {
            assertContains(prompt, 'Tesla', 'query in prompt');
            assertContains(prompt, 'KEY ENTITIES: Tesla, Musk', 'entities in prompt');
            assertContains(prompt, 'user_city=Shanghai', 'user profile in prompt');
            assertContains(prompt, '"old query"', 'previous queries in prompt');
            return '{"queries":[{"q":"Tesla CEO","reason":"primary"}]}';
        });
        const agent = new SearchAgent(api, null);

        await agent._generateSearchPlan('Tesla CEO', {
            entities: ['Tesla', 'Musk'],
            summary: 'Who is Tesla CEO',
            userText: 'Who is Tesla CEO?',
            language: 'english',
            userProfile: { user_city: 'Shanghai' },
            previousQueries: ['old query'],
            recentConversation: 'user: hi\nmodel: hello'
        });
    }

    // ════════════════════════════════════════════════
    // _refineQuery
    // ════════════════════════════════════════════════
    group('_refineQuery — generates alternative query');

    {
        const api = createMockAPI([
            'Tesla Inc latest developments 2025'
        ]);
        const agent = new SearchAgent(api, null);

        const refined = await agent._refineQuery(
            'Tesla news',
            [{ title: 'Old news', snippet: 'Not relevant' }],
            { summary: 'latest Tesla news', entities: ['Tesla'] },
            ['Tesla news']
        );
        assertTrue(refined !== null, 'refined query generated');
        assertTrue(refined.length >= 3, 'refined query is meaningful');
    }

    {
        // LLM returns too-short query
        const api = createMockAPI(['ab']);
        const agent = new SearchAgent(api, null);
        const refined = await agent._refineQuery('q', [], {}, []);
        assertEqual(refined, null, 'too short → null');
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
