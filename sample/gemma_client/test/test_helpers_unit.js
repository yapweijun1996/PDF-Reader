// ============================================================
//  test/test_helpers_unit.js — Unit tests for oodae-helpers.js,
//  oodae-plan-post.js, and config.js (HarnessConfig)
//  Tests pure functions that don't require API calls
// ============================================================

import { assertEqual, assertTrue, assertFalse, assertContains, assertGreater, group, results, resetResults, summarize } from './helpers.js';
import { HarnessConfig } from '../src/config.js';

// Import functions from oodae-helpers (they run as methods on `this`)
import {
    _parseJSON, _extractBalancedBraces, _repairPlanArray, _recoverToolPlan,
    _buildToolDefsCompact, _getLangInstruction, _detectLanguage,
    _findMatchingMemKey, _stripThinking,
    _analyzeConfidenceTrend, _selectNextStrategy, _extractConfidence,
    _rankByRelevance, _extractKnownAnswers, _getRecentContext
} from '../src/oodae-helpers.js';

import { _enrichPlanForMissedIntents } from '../src/oodae-plan-post.js';

// ===== Mock context =====
function createCtx() {
    return {
        _extractBalancedBraces,
        _repairPlanArray,
        registry: {
            has: (n) => ['web_search', 'fetch_url', 'get_time', 'get_weather', 'save_memory'].includes(n),
            list: () => [
                { name: 'web_search', description: 'Search the web for information', parameters: { query: { type: 'string', required: true } } },
                { name: 'get_time', description: 'Get current time', parameters: { timezone: { type: 'string', required: true } } },
                { name: 'get_weather', description: 'Get weather', parameters: { city: { type: 'string', required: true } } },
                { name: 'save_memory', description: 'Save user info', parameters: { key: { type: 'string', required: true }, value: { type: 'string', required: true } } },
            ]
        }
    };
}

export async function run() {
    resetResults();
    console.log('\n📦 test_helpers_unit.js');

    // ════════════════════════════════════════════════
    // HarnessConfig
    // ════════════════════════════════════════════════
    group('HarnessConfig — structure');

    assertTrue(HarnessConfig.api.baseUrl.includes('googleapis.com'), 'API base URL');
    assertEqual(HarnessConfig.api.model, 'gemma-3-27b-it', 'default model');
    assertEqual(HarnessConfig.keys.seed, '20250710', 'default seed');
    assertTrue(HarnessConfig.generation.deterministic.temperature < 0.5, 'deterministic temp is low');
    assertTrue(HarnessConfig.generation.creative.temperature > 0.5, 'creative temp is high');
    assertGreater(HarnessConfig.agent.maxLoops, 0, 'maxLoops > 0');
    assertTrue(typeof HarnessConfig.services.search.searxng === 'string', 'searxng URL exists');
    assertTrue(HarnessConfig.services.search.readUrlApiKey === null, 'readUrl API key is not bundled');
    assertTrue(HarnessConfig.services.data.ipApi.startsWith('https://'), 'IP API uses HTTPS');

    group('HarnessConfig — load(overrides)');

    {
        // Save originals
        const origModel = HarnessConfig.api.model;
        const origSeed = HarnessConfig.keys.seed;

        HarnessConfig.load({ api: { model: 'test-model' }, keys: { seed: 'test-seed' } });
        assertEqual(HarnessConfig.api.model, 'test-model', 'model overridden');
        assertEqual(HarnessConfig.keys.seed, 'test-seed', 'seed overridden');
        // baseUrl should be preserved (deep merge)
        assertTrue(HarnessConfig.api.baseUrl.includes('googleapis.com'), 'baseUrl preserved');

        // Restore
        HarnessConfig.load({ api: { model: origModel }, keys: { seed: origSeed } });
        assertEqual(HarnessConfig.api.model, origModel, 'model restored');
    }

    {
        // Null/invalid input is safe
        HarnessConfig.load(null);
        HarnessConfig.load(undefined);
        HarnessConfig.load(42);
        assertTrue(true, 'load(null/undefined/number) does not throw');
    }

    group('HarnessConfig — policies');

    assertTrue(HarnessConfig.policies.skipExtensions.test('file.pdf'), 'skipExtensions blocks PDF');
    assertTrue(HarnessConfig.policies.skipExtensions.test('image.jpg'), 'skipExtensions blocks JPG');
    assertFalse(HarnessConfig.policies.skipExtensions.test('page.html'), 'skipExtensions allows HTML');
    assertTrue(HarnessConfig.policies.skipSites.test('https://facebook.com/page'), 'skipSites blocks Facebook');
    assertTrue(HarnessConfig.policies.skipSites.test('https://twitter.com/user'), 'skipSites blocks Twitter');
    assertFalse(HarnessConfig.policies.skipSites.test('https://reuters.com/article'), 'skipSites allows Reuters');
    assertTrue(HarnessConfig.policies.preferredDomains.includes('wikipedia.org'), 'Wikipedia is preferred');
    assertTrue(HarnessConfig.policies.preferredDomains.includes('github.com'), 'GitHub is preferred');

    // ════════════════════════════════════════════════
    // _detectLanguage
    // ════════════════════════════════════════════════
    group('_detectLanguage');

    assertEqual(_detectLanguage('你好世界'), 'mandarin', 'Chinese → mandarin');
    assertEqual(_detectLanguage('こんにちは'), 'japanese', 'Hiragana → japanese');
    assertEqual(_detectLanguage('カタカナ'), 'japanese', 'Katakana → japanese');
    assertEqual(_detectLanguage('안녕하세요'), 'korean', 'Korean → korean');
    assertEqual(_detectLanguage('สวัสดี'), 'thai', 'Thai → thai');
    assertEqual(_detectLanguage('مرحبا'), 'arabic', 'Arabic → arabic');
    assertEqual(_detectLanguage('Hello'), null, 'Latin → null (ambiguous)');
    assertEqual(_detectLanguage(''), null, 'empty → null');
    assertEqual(_detectLanguage(null), null, 'null → null');
    // CJK with kana → Japanese takes priority
    assertEqual(_detectLanguage('東京はいい'), 'japanese', 'CJK + hiragana → japanese');

    // ════════════════════════════════════════════════
    // _getLangInstruction
    // ════════════════════════════════════════════════
    group('_getLangInstruction');

    assertContains(_getLangInstruction('mandarin'), '中文', 'mandarin → 中文');
    assertContains(_getLangInstruction('mandarin'), 'NEVER translate proper nouns', 'mandarin includes proper noun rule');
    assertContains(_getLangInstruction('mandarin'), 'No English translation', 'mandarin forbids English translation');
    assertContains(_getLangInstruction('malay'), 'Bahasa Melayu', 'malay → Bahasa Melayu');
    assertContains(_getLangInstruction('japanese'), '日本語', 'japanese → 日本語');
    assertContains(_getLangInstruction('english'), 'English', 'english → English');
    assertContains(_getLangInstruction('french'), 'french', 'unknown lang uses language name');

    // ════════════════════════════════════════════════
    // _stripThinking
    // ════════════════════════════════════════════════
    group('_stripThinking');

    assertEqual(_stripThinking('<thinking>analysis</thinking>Answer here'), 'Answer here', 'strips thinking');
    assertEqual(_stripThinking('No thinking tags'), 'No thinking tags', 'no tags unchanged');
    assertEqual(_stripThinking('<thinking>a</thinking>text<thinking>b</thinking>more'), 'textmore', 'strips multiple');
    assertEqual(_stripThinking(''), '', 'empty stays empty');
    assertEqual(_stripThinking(null), '', 'null → empty');

    // ════════════════════════════════════════════════
    // _parseJSON (standalone tests beyond existing coverage)
    // ════════════════════════════════════════════════
    group('_parseJSON — thinking + code fence + trailing comma');

    {
        const ctx = createCtx();
        assertEqual(_parseJSON.call(ctx, '{"a":1}').a, 1, 'direct JSON');
        assertEqual(_parseJSON.call(ctx, '<thinking>hmm</thinking>{"a":1}').a, 1, 'strips thinking');
        assertEqual(_parseJSON.call(ctx, '```json\n{"a":1}\n```').a, 1, 'strips code fence');
        assertEqual(_parseJSON.call(ctx, '{"a":1,}').a, 1, 'fixes trailing comma');
        assertEqual(_parseJSON.call(ctx, 'Some text {"a":1} more text').a, 1, 'extracts from text');
        assertEqual(_parseJSON.call(ctx, 'totally invalid'), null, 'invalid → null');
    }

    // ════════════════════════════════════════════════
    // _extractBalancedBraces
    // ════════════════════════════════════════════════
    group('_extractBalancedBraces');

    assertEqual(_extractBalancedBraces('{"a":1}', 0), '{"a":1}', 'simple object');
    assertEqual(_extractBalancedBraces('{"a":{"b":2}}', 0), '{"a":{"b":2}}', 'nested object');
    assertEqual(_extractBalancedBraces('pre{"a":1}post', 3), '{"a":1}', 'offset');
    assertEqual(_extractBalancedBraces('{"a":"b{c}d"}', 0), '{"a":"b{c}d"}', 'braces in string ignored');
    assertEqual(_extractBalancedBraces('{"a":"b\\"c"}', 0), '{"a":"b\\"c"}', 'escaped quotes');
    assertEqual(_extractBalancedBraces('not json', 0), null, 'no brace at start → null');
    assertEqual(_extractBalancedBraces('{"unclosed":', 0), null, 'unclosed → null');

    // ════════════════════════════════════════════════
    // _repairPlanArray
    // ════════════════════════════════════════════════
    group('_repairPlanArray');

    {
        const ctx = createCtx();
        // Valid plan
        const good = '{"plan":[{"tool":"web_search","args":{"query":"test"}}]}';
        const r1 = _repairPlanArray.call(ctx, good);
        assertTrue(r1 !== null, 'valid plan repaired');
        assertContains(r1, '"tool"', 'contains tool');

        // Plan with garbage between objects
        const messy = '{"plan":[{"tool":"web_search","args":{"query":"a"}}, some garbage, {"tool":"get_time","args":{"timezone":"UTC"}}]}';
        const r2 = _repairPlanArray.call(ctx, messy);
        assertTrue(r2 !== null, 'messy plan repaired');
        const parsed = JSON.parse(r2);
        assertEqual(parsed.plan.length, 2, 'both valid objects preserved');

        // No plan key
        assertEqual(_repairPlanArray.call(ctx, '{"data":[]}'), null, 'no "plan" key → null');

        // Empty plan
        assertEqual(_repairPlanArray.call(ctx, '{"plan":[]}'), null, 'empty plan → null');

        // Objects without "tool" key are filtered
        const noTool = '{"plan":[{"foo":"bar"},{"tool":"web_search","args":{}}]}';
        const r3 = _repairPlanArray.call(ctx, noTool);
        const p3 = JSON.parse(r3);
        assertEqual(p3.plan.length, 1, 'non-tool object filtered');
    }

    // ════════════════════════════════════════════════
    // _recoverToolPlan
    // ════════════════════════════════════════════════
    group('_recoverToolPlan');

    {
        const ctx = createCtx();

        // Standard malformed
        const raw1 = 'I think we should use "tool":"web_search", "args":{"query":"test"}, "reason":"search"';
        const plan1 = _recoverToolPlan.call(ctx, raw1);
        assertEqual(plan1.length, 1, 'recovered one tool');
        assertEqual(plan1[0].tool, 'web_search', 'correct tool');

        // With thinking tags
        const raw2 = '<thinking>analysis</thinking>"tool":"get_time", "args":{"timezone":"UTC"}, "reason":"time"';
        const plan2 = _recoverToolPlan.call(ctx, raw2);
        assertEqual(plan2.length, 1, 'recovered after stripping thinking');

        // Unknown tool is filtered
        const raw3 = '"tool":"nonexistent", "args":{}';
        const plan3 = _recoverToolPlan.call(ctx, raw3);
        assertEqual(plan3.length, 0, 'unknown tool filtered');

        // Multiple tools
        const raw4 = '"tool":"web_search", "args":{"query":"a"}, "reason":"1" ... "tool":"get_time", "args":{"timezone":"UTC"}, "reason":"2"';
        const plan4 = _recoverToolPlan.call(ctx, raw4);
        assertEqual(plan4.length, 2, 'recovered multiple tools');
    }

    // ════════════════════════════════════════════════
    // _buildToolDefsCompact
    // ════════════════════════════════════════════════
    group('_buildToolDefsCompact');

    {
        const ctx = createCtx();
        const defs = _buildToolDefsCompact.call(ctx);
        assertContains(defs, 'web_search', 'includes web_search');
        assertContains(defs, 'get_time', 'includes get_time');
        assertContains(defs, 'query*:string', 'shows required param with *');
        assertTrue(defs.split('\n').length === 4, '4 tool lines');
    }

    // ════════════════════════════════════════════════
    // _findMatchingMemKey
    // ════════════════════════════════════════════════
    group('_findMatchingMemKey — exact + normalized + alias + substring');

    {
        const keys = ['user_name', 'user_city', 'pet_name', 'user_job'];

        // Exact match
        assertEqual(_findMatchingMemKey('user_name', keys), 'user_name', 'exact match');

        // Normalized match (user_ prefix stripped)
        assertEqual(_findMatchingMemKey('my_name', keys), 'user_name', 'my_name → user_name');

        // Alias group match: cat_name → pet_name (cat↔pet alias)
        assertEqual(_findMatchingMemKey('cat_name', keys), 'pet_name', 'cat_name → pet_name via alias');

        // Alias: occupation → job
        assertEqual(_findMatchingMemKey('user_occupation', keys), 'user_job', 'occupation → job alias');

        // Substring match
        assertEqual(_findMatchingMemKey('name', keys), 'user_name', 'substring match');

        // No match
        assertEqual(_findMatchingMemKey('favorite_color', keys), null, 'no match → null');

        // CJK key matching
        const cjkKeys = ['猫名字', 'user_city'];
        assertEqual(_findMatchingMemKey('pet_name', cjkKeys), '猫名字', 'pet → 猫 alias via CJK');

        // Pet scope must not collapse into user scope via substring-only "name"
        assertEqual(_findMatchingMemKey('pet_name', ['user_name']), null, 'pet_name does not dedupe to user_name');
    }

    // ════════════════════════════════════════════════
    // _analyzeConfidenceTrend
    // ════════════════════════════════════════════════
    group('_analyzeConfidenceTrend');

    assertEqual(_analyzeConfidenceTrend([]), 'start', 'empty → start');
    assertEqual(_analyzeConfidenceTrend(['high']), 'progressing', 'single high → progressing');
    assertEqual(_analyzeConfidenceTrend(['low']), 'struggling', 'single low → struggling');
    assertEqual(_analyzeConfidenceTrend(['low', 'medium']), 'improving', 'low→medium = improving');
    assertEqual(_analyzeConfidenceTrend(['high', 'medium']), 'declining', 'high→medium = declining');
    assertEqual(_analyzeConfidenceTrend(['low', 'low']), 'stuck_low', 'low→low = stuck_low');
    assertEqual(_analyzeConfidenceTrend(['medium', 'medium']), 'plateaued', 'med→med = plateaued');
    assertEqual(_analyzeConfidenceTrend(['high', 'high']), 'stable', 'high→high = stable');

    // ════════════════════════════════════════════════
    // _selectNextStrategy
    // ════════════════════════════════════════════════
    group('_selectNextStrategy');

    assertEqual(_selectNextStrategy('improving', new Set(), {}), 'default', 'improving → default');
    assertEqual(_selectNextStrategy('progressing', new Set(), {}), 'default', 'progressing → default');
    assertEqual(_selectNextStrategy('stuck_low', new Set(), {}), 'deep_research', 'stuck_low → deep_research');
    assertEqual(_selectNextStrategy('plateaued', new Set(), {}), 'narrow', 'plateaued → narrow');
    assertEqual(_selectNextStrategy('struggling', new Set(), {}), 'narrow', 'struggling → narrow');

    // With tried strategies, picks next untried
    assertEqual(_selectNextStrategy('stuck_low', new Set(['deep_research']), {}), 'alternative_source', 'skip tried strategy');
    assertEqual(_selectNextStrategy('stuck_low', new Set(['deep_research', 'alternative_source', 'decompose', 'broaden']), {}), 'default', 'all tried → default');

    // ════════════════════════════════════════════════
    // _extractConfidence
    // ════════════════════════════════════════════════
    group('_extractConfidence');

    assertEqual(_extractConfidence({ confidence: 'high' }), 'high', 'direct confidence field');
    assertEqual(_extractConfidence({ confidence: 'LOW' }), 'low', 'lowercased');
    assertEqual(_extractConfidence({ _raw: 'confidence: medium ok' }), 'medium', 'from _raw string');
    assertEqual(_extractConfidence(null), 'medium', 'null → medium default');
    assertEqual(_extractConfidence({}), 'medium', 'no field → medium');

    // ════════════════════════════════════════════════
    // _rankByRelevance
    // ════════════════════════════════════════════════
    group('_rankByRelevance');

    {
        const results = [
            { name: 'web_search', result: { title: 'Weather report' } },
            { name: 'web_search', result: { title: 'Tesla CEO Elon Musk' } },
            { name: 'web_search', result: { title: 'Sports news' } }
        ];
        const ranked = _rankByRelevance(results, ['Tesla']);
        assertEqual(ranked[0].result.title, 'Tesla CEO Elon Musk', 'Tesla result ranked first');

        // No entities → same order
        const same = _rankByRelevance(results, []);
        assertEqual(same[0].result.title, 'Weather report', 'no entities → original order');
    }

    // ════════════════════════════════════════════════
    // _extractKnownAnswers
    // ════════════════════════════════════════════════
    group('_extractKnownAnswers');

    {
        const history = [
            { role: 'user', parts: [{ text: 'q1' }] },
            { role: 'model', parts: [{ text: 'A long enough answer that should be included in the known answers list.' }] },
            { role: 'user', parts: [{ text: 'q2' }] },
            { role: 'model', parts: [{ text: 'Short' }] }, // too short (< 30 chars)
            { role: 'model', parts: [{ text: 'Another answer that is long enough to be included in the known answers.' }] }
        ];
        const answers = _extractKnownAnswers(history, 3);
        assertEqual(answers.length, 2, 'two long answers extracted');
        assertContains(answers[0], 'long enough', 'first answer');

        // Empty history
        assertEqual(_extractKnownAnswers([], 3).length, 0, 'empty history → empty');
        assertEqual(_extractKnownAnswers(null, 3).length, 0, 'null → empty');
    }

    // ════════════════════════════════════════════════
    // _getRecentContext
    // ════════════════════════════════════════════════
    group('_getRecentContext');

    {
        const history = [
            { role: 'user', parts: [{ text: 'Hello' }] },
            { role: 'model', parts: [{ text: 'Hi there!' }] },
            { role: 'user', parts: [{ text: 'Tell me about Tesla' }] },
        ];
        const ctx = _getRecentContext(history, 2);
        assertContains(ctx, 'user: Hello', 'includes user message');
        assertContains(ctx, 'model: Hi there', 'includes model response');

        // Filters system messages
        const withSystem = [
            { role: 'user', parts: [{ text: '[User context] some context' }], _meta: 'system' },
            { role: 'model', parts: [{ text: 'Understood.' }], _meta: 'system' },
            { role: 'user', parts: [{ text: 'Real message' }] }
        ];
        const ctx2 = _getRecentContext(withSystem, 3);
        assertFalse(ctx2.includes('[User context]'), 'system messages filtered');
        assertFalse(ctx2.includes('Understood'), 'noted filtered');
        assertContains(ctx2, 'Real message', 'real message included');

        // Empty
        assertEqual(_getRecentContext([], 3), '', 'empty → empty string');
    }

    // ════════════════════════════════════════════════
    // _enrichPlanForMissedIntents
    // ════════════════════════════════════════════════
    group('_enrichPlanForMissedIntents');

    {
        const ctx = createCtx();

        // Plan covers Tesla but misses Singapore
        const plan = { plan: [{ tool: 'web_search', args: { query: 'Tesla stock' }, reason: 'main' }] };
        const obs = { key_entities: ['Tesla', 'Singapore'], _searchEntities: ['Tesla', 'Singapore'] };
        const ori = { timezone: 'Asia/Singapore' };
        const enriched = _enrichPlanForMissedIntents.call(ctx, plan, obs, ori, 'Tell me about Tesla and Singapore weather');
        assertGreater(enriched.plan.length, 1, 'extra step added for Singapore');
    }

    {
        const ctx = createCtx();

        // Single entity — no enrichment needed
        const plan = { plan: [{ tool: 'web_search', args: { query: 'Tesla' }, reason: 'main' }] };
        const obs = { key_entities: ['Tesla'], _searchEntities: ['Tesla'] };
        const enriched = _enrichPlanForMissedIntents.call(ctx, plan, obs, {}, 'About Tesla');
        assertEqual(enriched.plan.length, 1, 'no enrichment for single entity');
    }

    {
        const ctx = createCtx();

        // Both entities already covered
        const plan = { plan: [
            { tool: 'web_search', args: { query: 'Tesla stock' }, reason: 'a' },
            { tool: 'web_search', args: { query: 'Apple stock' }, reason: 'b' }
        ] };
        const obs = { key_entities: ['Tesla', 'Apple'], _searchEntities: ['Tesla', 'Apple'] };
        const enriched = _enrichPlanForMissedIntents.call(ctx, plan, obs, {}, 'Compare Tesla and Apple stock');
        assertEqual(enriched.plan.length, 2, 'no extra when both covered');
    }

    {
        const ctx = createCtx();

        // Empty plan — no enrichment
        const plan = { plan: [] };
        const obs = { key_entities: ['Tesla', 'Apple'], _searchEntities: ['Tesla', 'Apple'] };
        const enriched = _enrichPlanForMissedIntents.call(ctx, plan, obs, {}, 'test');
        assertEqual(enriched.plan.length, 0, 'empty plan stays empty');
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
