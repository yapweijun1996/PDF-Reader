// ============================================================
//  test/test_micro.js — Unit tests for src/oodae-micro.js
//  Tests micro-agent wrappers with mocked _callModel
//  No API calls — pure logic + prompt assembly testing
// ============================================================

import { assertEqual, assertTrue, assertFalse, assertContains, assertGreater, group, results, resetResults, summarize } from './helpers.js';

// Import micro-agent functions directly
import {
    _microIntent, _microEntities, _microReference, _microMemory,
    _microSelectTool, _microArgs, _microSufficiency, _microAnswer,
    _classifyMicro, _decideMicro, _evaluateMicro
} from '../src/oodae-micro.js';

// ===== Mock context (simulates OODAERunner's `this`) =====
function createMockContext(modelResponses = {}) {
    const callLog = [];
    return {
        callLog,
        _callModel(prompt, opts) {
            callLog.push({ prompt, opts });
            const phase = opts?._phase || 'unknown';
            const response = typeof modelResponses === 'function'
                ? modelResponses(phase, prompt)
                : modelResponses[phase] || '{}';
            return Promise.resolve(response);
        },
        _parseJSON(text) {
            let s = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
            try { return JSON.parse(s); } catch {}
            s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
            try { return JSON.parse(s); } catch {}
            const match = s.match(/\{[\s\S]*\}/);
            if (match) { try { return JSON.parse(match[0]); } catch {} }
            return null;
        },
        _stripThinking(text) {
            return (text || '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        },
        _getRecentContext(hist, n) {
            return hist.slice(-n).map(m => `${m.role}: ${m.parts?.[0]?.text || ''}`).join('\n');
        },
        _classifyIntent() { return Promise.resolve({ is_greeting: false, needs_tools: true, user_entities: [], search_entities: [] }); },
        _decide(obs, ori, opts, prev, cls) { return Promise.resolve({ plan: [{ tool: 'web_search', args: { query: 'fallback' }, reason: 'legacy' }] }); },
        _evaluate(obs, ori, act, ut, opts) { return Promise.resolve({ needs_more: false, final_answer: 'legacy answer', confidence: 'medium' }); },
        _buildToolDefsCompact() { return '- web_search(query*:string): Search the web\n- save_memory(key*:string, value*:string): Save user info'; },
        _findMatchingMemKey(key, keys) { return keys.includes(key) ? key : null; },
        _applyDeicticCorrection() {},
        _rankByRelevance(results) { return results; },
        _ctx: {},
        registry: { has: (name) => ['web_search', 'save_memory', 'recall_memory', 'calculate', 'fetch_url'].includes(name) },
        skillRegistry: null,
        // Attach all micro-agent functions so wrappers can call this._microX(...)
        _microIntent, _microEntities, _microReference, _microMemory,
        _microSelectTool, _microArgs, _microSufficiency, _microAnswer,
    };
}

export async function run() {
    resetResults();
    console.log('\n📦 test_micro.js');

    // ════════════════════════════════════════════════
    // _microIntent
    // ════════════════════════════════════════════════
    group('_microIntent — intent classification');

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"greeting"}' });
        const result = await _microIntent.call(ctx, '你好', {});
        assertEqual(result, 'greeting', 'Chinese greeting detected');
        assertEqual(ctx.callLog.length, 1, 'one LLM call');
        assertContains(ctx.callLog[0].prompt, '你好', 'prompt includes user text');
    }

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"question"}' });
        const result = await _microIntent.call(ctx, 'Who is the CEO of Tesla?', {});
        assertEqual(result, 'question', 'factual question detected');
    }

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"info_sharing"}' });
        const result = await _microIntent.call(ctx, '我叫小明', {});
        assertEqual(result, 'info_sharing', 'info sharing detected');
    }

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"task"}' });
        const result = await _microIntent.call(ctx, '写一首诗', {});
        assertEqual(result, 'task', 'task request detected');
    }

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"acknowledgment"}' });
        const result = await _microIntent.call(ctx, '好的', {});
        assertEqual(result, 'acknowledgment', 'acknowledgment detected');
    }

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"command"}' });
        const result = await _microIntent.call(ctx, '以后用中文回复', {});
        assertEqual(result, 'command', 'command detected');
    }

    {
        const ctx = createMockContext({});
        const result = await _classifyMicro.call(ctx, 'reply me mandarin', { requires_tools: false, is_about_user: false }, [], {});
        assertEqual(result.is_command, true, 'language preference phrase classified as command');
        assertEqual(result.memory_action, 'save', 'language preference triggers save');
        assertEqual(result.save_key, 'reply_language', 'language preference uses reply_language key');
        assertEqual(result.save_value, 'mandarin', 'language preference normalizes to mandarin');
        assertEqual(ctx.callLog.length, 0, 'language preference shortcut avoids LLM call');
    }

    {
        // Malformed response → defaults to 'question'
        const ctx = createMockContext({ micro_intent: 'garbage' });
        const result = await _microIntent.call(ctx, 'test', {});
        assertEqual(result, 'question', 'malformed response defaults to question');
    }

    {
        // Response with thinking tags
        const ctx = createMockContext({ micro_intent: '<thinking>let me think</thinking>{"intent":"greeting"}' });
        const result = await _microIntent.call(ctx, 'hello', {});
        assertEqual(result, 'greeting', 'strips thinking tags before parsing');
    }

    // ════════════════════════════════════════════════
    // _microEntities
    // ════════════════════════════════════════════════
    group('_microEntities — entity extraction');

    {
        const ctx = createMockContext({ micro_entities: '{"entities":["Tesla","Elon Musk"]}' });
        const result = await _microEntities.call(ctx, 'Who is the CEO of Tesla?', {});
        assertEqual(result.length, 2, 'found 2 entities');
        assertContains(result, 'Tesla', 'includes Tesla');
        assertContains(result, 'Elon Musk', 'includes Elon Musk');
    }

    {
        const ctx = createMockContext({ micro_entities: '{"entities":[]}' });
        const result = await _microEntities.call(ctx, '你好', {});
        assertEqual(result.length, 0, 'no entities in greeting');
    }

    {
        // Malformed → empty array
        const ctx = createMockContext({ micro_entities: 'invalid' });
        const result = await _microEntities.call(ctx, 'test', {});
        assertEqual(result.length, 0, 'malformed defaults to empty array');
    }

    // ════════════════════════════════════════════════
    // _microReference
    // ════════════════════════════════════════════════
    group('_microReference — follow-up detection');

    {
        const ctx = createMockContext({ micro_reference: '{"is_reference":true}' });
        const result = await _microReference.call(ctx, '那竞争对手呢？', 'user: Tesla的CEO是谁\nmodel: Elon Musk', {});
        assertEqual(result, true, 'follow-up reference detected');
    }

    {
        const ctx = createMockContext({ micro_reference: '{"is_reference":false}' });
        const result = await _microReference.call(ctx, 'What is quantum computing?', '', {});
        assertEqual(result, false, 'new topic is not a reference');
    }

    {
        // Malformed → defaults to false (safe fallback)
        const ctx = createMockContext({ micro_reference: 'bad' });
        const result = await _microReference.call(ctx, 'test', 'some context', {});
        assertEqual(result, false, 'malformed defaults to false');
    }

    // ════════════════════════════════════════════════
    // _microMemory
    // ════════════════════════════════════════════════
    group('_microMemory — save/recall decision');

    {
        const ctx = createMockContext({ micro_memory: '{"action":"save","key":"user_name","value":"小明","pairs":null}' });
        const result = await _microMemory.call(ctx, '我叫小明', {});
        assertEqual(result.action, 'save', 'save action');
        assertEqual(result.key, 'user_name', 'save key');
        assertEqual(result.value, '小明', 'save value');
    }

    {
        const ctx = createMockContext({ micro_memory: '{"action":"recall","key":"user_name","value":null,"pairs":null}' });
        const result = await _microMemory.call(ctx, '我叫什么？', {});
        assertEqual(result.action, 'recall', 'recall action');
    }

    {
        const ctx = createMockContext({ micro_memory: '{"action":"none","key":null,"value":null,"pairs":null}' });
        const result = await _microMemory.call(ctx, 'What time is it?', {});
        assertEqual(result.action, 'none', 'no memory action');
    }

    {
        // Multiple pairs
        const ctx = createMockContext({ micro_memory: '{"action":"save","key":"user_name","value":"John","pairs":[{"key":"user_name","value":"John"},{"key":"user_city","value":"Shanghai"}]}' });
        const result = await _microMemory.call(ctx, 'I am John from Shanghai', {});
        assertEqual(result.pairs.length, 2, 'two save pairs');
        assertEqual(result.pairs[0].key, 'user_name', 'first pair key');
        assertEqual(result.pairs[1].key, 'user_city', 'second pair key');
    }

    {
        // Malformed → defaults to none
        const ctx = createMockContext({ micro_memory: 'invalid' });
        const result = await _microMemory.call(ctx, 'test', {});
        assertEqual(result.action, 'none', 'malformed defaults to none');
    }

    {
        const ctx = createMockContext({ micro_memory: '{"action":"save","key":"name","value":"Mochi","pairs":null}' });
        const result = await _microMemory.call(ctx, 'I have a cat named Mochi.', {});
        assertEqual(result.key, 'pet_name', 'pet naming normalized to pet_name');
        assertEqual(result.value, 'Mochi', 'pet naming keeps value');
        assertEqual(result.pairs[1].key, 'pet_type', 'pet type captured alongside pet_name');
    }

    // ════════════════════════════════════════════════
    // _microSelectTool
    // ════════════════════════════════════════════════
    group('_microSelectTool — tool selection');

    {
        const ctx = createMockContext({ micro_tool: '{"tool":"web_search","reason":"factual question"}' });
        const result = await _microSelectTool.call(ctx, 'CEO of Tesla', ['Tesla'], 'none', '- web_search(query*:string): Search', {});
        assertEqual(result.tool, 'web_search', 'selected web_search');
        assertTrue(result.reason.length > 0, 'has reason');
    }

    {
        const ctx = createMockContext({ micro_tool: '{"tool":"save_memory","reason":"user sharing info"}' });
        const result = await _microSelectTool.call(ctx, 'save name', ['John'], 'save', '', {});
        assertEqual(result.tool, 'save_memory', 'selected save_memory');
    }

    {
        // Malformed → defaults to web_search
        const ctx = createMockContext({ micro_tool: 'bad' });
        const result = await _microSelectTool.call(ctx, 'test', [], 'none', '', {});
        assertEqual(result.tool, 'web_search', 'malformed defaults to web_search');
    }

    // ════════════════════════════════════════════════
    // _microArgs
    // ════════════════════════════════════════════════
    group('_microArgs — argument generation');

    {
        const ctx = createMockContext({ micro_args: '{"query":"Tesla CEO"}' });
        const result = await _microArgs.call(ctx, 'Who is Tesla CEO', 'web_search', ['Tesla'], '', {});
        assertEqual(result.query, 'Tesla CEO', 'web_search query');
    }

    {
        const ctx = createMockContext({ micro_args: '{"key":"user_name","value":"John"}' });
        const result = await _microArgs.call(ctx, 'save name', 'save_memory', ['John'], '', {});
        assertEqual(result.key, 'user_name', 'save_memory key');
        assertEqual(result.value, 'John', 'save_memory value');
    }

    {
        const ctx = createMockContext({ micro_args: '{"timezone":"Asia/Tokyo"}' });
        const result = await _microArgs.call(ctx, 'time in Tokyo', 'get_time', ['Tokyo'], '', {});
        assertEqual(result.timezone, 'Asia/Tokyo', 'get_time timezone');
    }

    {
        const ctx = createMockContext({ micro_args: '{"expression":"7*13+29"}' });
        const result = await _microArgs.call(ctx, 'calculate', 'calculate', [], '', {});
        assertEqual(result.expression, '7*13+29', 'calculate expression');
    }

    {
        // Format guide varies by tool — check that web_search prompt mentions "search query"
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_args') {
                assertContains(prompt, 'search query', 'web_search format guide present');
                return '{"query":"test"}';
            }
            return '{}';
        });
        await _microArgs.call(ctx, 'test', 'web_search', [], '', {});
    }

    {
        // Unknown tool gets generic format guide
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_args') {
                assertContains(prompt, 'what arguments are needed', 'generic format guide');
                return '{"param":"value"}';
            }
            return '{}';
        });
        await _microArgs.call(ctx, 'test', 'unknown_tool', [], '', {});
    }

    // ════════════════════════════════════════════════
    // _microSufficiency
    // ════════════════════════════════════════════════
    group('_microSufficiency — result validation');

    {
        const ctx = createMockContext({ micro_sufficiency: '{"sufficient":true,"reason":"found CEO name"}' });
        const result = await _microSufficiency.call(ctx, 'Who is Tesla CEO?', ['Tesla'], 'Results: Elon Musk is CEO', {});
        assertEqual(result.sufficient, true, 'sufficient=true');
        assertContains(result.reason, 'CEO', 'reason explains');
    }

    {
        const ctx = createMockContext({ micro_sufficiency: '{"sufficient":false,"reason":"results about different company"}' });
        const result = await _microSufficiency.call(ctx, 'About ZetaCorp', ['ZetaCorp'], 'Results: Zeta Global info', {});
        assertEqual(result.sufficient, false, 'insufficient results');
    }

    {
        // Malformed → defaults to sufficient=true (optimistic)
        const ctx = createMockContext({ micro_sufficiency: 'garbage' });
        const result = await _microSufficiency.call(ctx, 'test', [], '', {});
        assertEqual(result.sufficient, true, 'malformed defaults to sufficient');
    }

    // ════════════════════════════════════════════════
    // _microAnswer
    // ════════════════════════════════════════════════
    group('_microAnswer — answer generation');

    {
        const ctx = createMockContext({ micro_answer: '<thinking>The CEO is Elon Musk</thinking>Elon Musk is the CEO of Tesla.' });
        const result = await _microAnswer.call(ctx, 'Who is Tesla CEO?', 'Elon Musk is CEO of Tesla', 'english', '', {});
        assertEqual(result, 'Elon Musk is the CEO of Tesla.', 'strips thinking, returns answer');
    }

    {
        // Mandarin language instruction
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_answer') {
                assertContains(prompt, '中文', 'mandarin instruction present');
                assertContains(prompt, 'No English translation', 'mandarin prompt forbids English translation');
                return '特斯拉的CEO是Elon Musk。';
            }
            return '';
        });
        await _microAnswer.call(ctx, '谁是CEO', 'results', 'mandarin', '', {});
    }

    {
        // Profile context injected
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_answer') {
                assertContains(prompt, 'user_name=John', 'profile context in prompt');
                return 'Answer based on profile';
            }
            return '';
        });
        await _microAnswer.call(ctx, 'my name?', 'results', 'english', 'user_name=John', {});
    }

    // ════════════════════════════════════════════════
    // _classifyMicro (wrapper)
    // ════════════════════════════════════════════════
    group('_classifyMicro — greeting early exit');

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"greeting"}' });
        const result = await _classifyMicro.call(ctx, '你好', { key_entities: [] }, [], {});
        assertEqual(result.is_greeting, true, 'greeting flag');
        assertEqual(result.needs_tools, false, 'no tools for greeting');
        assertEqual(ctx.callLog.length, 1, 'only 1 LLM call for greeting (early exit)');
    }

    group('_classifyMicro — acknowledgment early exit');

    {
        const ctx = createMockContext({ micro_intent: '{"intent":"acknowledgment"}' });
        const result = await _classifyMicro.call(ctx, '好的', { key_entities: [] }, [], {});
        assertEqual(result.is_acknowledgment, true, 'acknowledgment flag');
        assertEqual(result.needs_tools, false, 'no tools for ack');
        assertEqual(ctx.callLog.length, 1, 'only 1 call for ack');
    }

    group('_classifyMicro — question with parallel calls');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"question"}',
            micro_entities: '{"entities":["Tesla"]}',
            micro_reference: '{"is_reference":false}'
        });
        const result = await _classifyMicro.call(ctx, 'Tell me about Tesla', { key_entities: [], is_about_user: false }, [], {});
        assertEqual(result.is_greeting, false, 'not greeting');
        assertEqual(result.needs_tools, true, 'question needs tools');
        assertEqual(result.user_entities.length, 1, 'one entity extracted');
        assertContains(result.user_entities, 'Tesla', 'entity is Tesla');
        assertEqual(result.is_reference, false, 'not a reference');
    }

    group('_classifyMicro — info_sharing triggers memory');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"info_sharing"}',
            micro_entities: '{"entities":["小明"]}',
            micro_memory: '{"action":"save","key":"user_name","value":"小明","pairs":null}'
        });
        const result = await _classifyMicro.call(ctx, '我叫小明', { key_entities: [], is_about_user: true }, [], {});
        assertEqual(result.is_info_sharing, true, 'info sharing flag');
        assertEqual(result.memory_action, 'save', 'save action');
        assertEqual(result.save_key, 'user_name', 'save key');
        assertEqual(result.save_value, '小明', 'save value');
        assertEqual(result.needs_tools, true, 'needs tools for save');
    }

    group('_classifyMicro — task request');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"task"}',
            micro_entities: '{"entities":[]}',
            micro_reference: '{"is_reference":false}'
        });
        const result = await _classifyMicro.call(ctx, '写一首关于春天的诗', { key_entities: [], is_about_user: false }, [], {});
        assertEqual(result.is_task_request, true, 'task flag');
        assertEqual(result.needs_tools, false, 'task does not need tools');
    }

    group('_classifyMicro — search_entities filter');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"question"}',
            micro_entities: '{"entities":["Tesla","AI"]}',
            micro_reference: '{"is_reference":false}'
        });
        const result = await _classifyMicro.call(ctx, 'Tell me about Tesla and AI', { key_entities: [], is_about_user: false }, [], {});
        // "AI" has length 2, should be included; entities with length < 2 are filtered
        assertEqual(result.search_entities.length, 2, 'both entities pass length filter');
    }

    group('_classifyMicro — grounds entities to current message');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"question"}',
            micro_entities: '{"entities":["yapweijun1996","Yap Wei Jun","6","five","1"]}',
            micro_reference: '{"is_reference":true}'
        });
        const result = await _classifyMicro.call(ctx, 'how to get 6 by five 1?', { key_entities: [], is_about_user: false }, [], {});
        assertEqual(result.user_entities.length, 3, 'only current-message entities remain after grounding');
        assertContains(result.user_entities, '6', 'digit entity preserved');
        assertContains(result.user_entities, 'five', 'number word preserved');
        assertContains(result.user_entities, '1', 'digit entity preserved');
        assertFalse(result.user_entities.includes('yapweijun1996'), 'prior-topic entity removed');
        assertFalse(result.user_entities.includes('Yap Wei Jun'), 'prior-topic person name removed');
        assertEqual(result.search_entities.length, 0, 'non-searchable numeric entities are filtered from search_entities');
    }

    group('_classifyMicro — error fallback to legacy');

    {
        const ctx = createMockContext({});
        // Force _callModel to throw
        ctx._callModel = () => { throw new Error('API fail'); };
        const result = await _classifyMicro.call(ctx, 'test', { key_entities: [] }, [], {});
        // Should fall back to _classifyIntent (returns defaults from mock)
        assertTrue(result !== null, 'fallback produces result');
    }

    // ════════════════════════════════════════════════
    // _decideMicro (wrapper)
    // ════════════════════════════════════════════════
    group('_decideMicro — save memory short-circuit');

    {
        const ctx = createMockContext({});
        const obs = { intent: 'info_sharing', _saveKey: 'user_name', _saveValue: '小明', key_entities: ['小明'], summary: 'user name is 小明' };
        const ori = { memory_action: 'save', all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan.length, 1, 'one step in plan');
        assertEqual(result.plan[0].tool, 'save_memory', 'save_memory selected');
        assertEqual(result.plan[0].args.key, 'user_name', 'key correct');
        assertEqual(result.plan[0].args.value, '小明', 'value correct');
        assertEqual(ctx.callLog.length, 0, 'zero LLM calls (short-circuit)');
    }

    group('_decideMicro — multiple save pairs');

    {
        const ctx = createMockContext({});
        const obs = {
            intent: 'info_sharing',
            _saveKey: 'user_name', _saveValue: 'John',
            _savePairs: [{ key: 'user_name', value: 'John' }, { key: 'user_city', value: 'Shanghai' }],
            key_entities: ['John', 'Shanghai'], summary: 'user is John from Shanghai'
        };
        const ori = { memory_action: 'save', all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan.length, 2, 'two save steps');
        assertEqual(result.plan[0].args.value, 'John', 'first save value');
        assertEqual(result.plan[1].args.value, 'Shanghai', 'second save value');
    }

    group('_decideMicro — recall memory short-circuit');

    {
        const ctx = createMockContext({});
        const obs = { intent: 'question', key_entities: ['name'], summary: 'what is my name' };
        const ori = { memory_action: 'recall', all_memories: [{ key: 'user_name', value: '小明' }] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].tool, 'recall_memory', 'recall selected');
        assertEqual(ctx.callLog.length, 0, 'zero LLM calls (short-circuit)');
    }

    group('_decideMicro — recall normalizes against existing keys');

    {
        const ctx = createMockContext({});
        ctx._findMatchingMemKey = (key, keys) => {
            if (key === 'name') return 'user_name'; // normalize
            return null;
        };
        const obs = { intent: 'question', key_entities: ['name'], summary: 'my name' };
        const ori = { memory_action: 'recall', all_memories: [{ key: 'user_name', value: 'John' }] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].args.query, 'user_name', 'query normalized to existing key');
    }

    group('_decideMicro — bogus save value skips short-circuit');

    {
        const ctx = createMockContext({
            micro_tool: '{"tool":"web_search","reason":"question"}',
            micro_args: '{"query":"test query"}'
        });
        const obs = { intent: 'question', _saveKey: 'thing', _saveValue: 'unknown', key_entities: ['Tesla'], summary: 'about Tesla' };
        const ori = { memory_action: 'save', all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        // Should NOT short-circuit because _saveValue is 'unknown' and intent is 'question'
        assertGreater(ctx.callLog.length, 0, 'LLM calls made (no short-circuit)');
    }

    group('_decideMicro — tool selection + args via LLM');

    {
        const ctx = createMockContext({
            micro_tool: '{"tool":"web_search","reason":"factual question"}',
            micro_args: '{"query":"Tesla CEO name"}'
        });
        const obs = { intent: 'question', key_entities: ['Tesla'], summary: 'who is Tesla CEO' };
        const ori = { memory_action: null, all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].tool, 'web_search', 'web_search selected');
        assertEqual(result.plan[0].args.query, 'Tesla CEO name', 'correct query');
        assertEqual(ctx.callLog.length, 2, 'two LLM calls (select + args)');
    }

    group('_decideMicro — invalid tool falls back to web_search');

    {
        const ctx = createMockContext({
            micro_tool: '{"tool":"nonexistent_tool","reason":"???"}',
            micro_args: '{"query":"fallback"}'
        });
        const obs = { intent: 'question', key_entities: ['X'], summary: 'about X' };
        const ori = { memory_action: null, all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].tool, 'web_search', 'invalid tool → web_search');
    }

    group('_decideMicro — geocode query repaired from current entity');

    {
        const ctx = createMockContext({
            micro_tool: '{"tool":"geocode","reason":"lookup coordinates"}',
            micro_args: '{"query":"Taipei 101"}'
        });
        ctx.registry.has = (name) => ['web_search', 'get_time', 'get_weather', 'save_memory', 'geocode'].includes(name);
        ctx.registry.list = () => [
            { name: 'geocode', description: 'Geocode', parameters: { query: { type: 'string', required: true } } }
        ];

        const obs = { summary: '请给我 Big Ben 的坐标，只用中文简短回答。', key_entities: ['Big Ben'] };
        const ori = { memory_action: 'none', all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].tool, 'geocode', 'geocode selected');
        assertEqual(result.plan[0].args.query, 'Big Ben', 'stale geocode query repaired to current entity');
    }

    group('_decideMicro — previous results injected as context');

    {
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_args') {
                assertContains(prompt, 'Previous searches tried', 'previous queries mentioned');
                assertContains(prompt, '"Tesla news"', 'specific prev query included');
                return '{"query":"Tesla latest developments"}';
            }
            return '{"tool":"web_search","reason":"retry"}';
        });
        const obs = { intent: 'question', key_entities: ['Tesla'], summary: 'about Tesla' };
        const ori = { memory_action: null, all_memories: [] };
        const prev = [{ name: 'web_search', args: { query: 'Tesla news' } }];
        await _decideMicro.call(ctx, obs, ori, {}, prev, null);
    }

    group('_decideMicro — error fallback to legacy');

    {
        const ctx = createMockContext({});
        ctx._callModel = () => { throw new Error('fail'); };
        const obs = { intent: 'question', key_entities: [], summary: 'test' };
        const ori = { memory_action: null, all_memories: [] };
        const result = await _decideMicro.call(ctx, obs, ori, {}, [], null);
        assertEqual(result.plan[0].reason, 'legacy', 'fell back to legacy _decide');
    }

    // ════════════════════════════════════════════════
    // _evaluateMicro (wrapper)
    // ════════════════════════════════════════════════
    group('_evaluateMicro — sufficient results');

    {
        const ctx = createMockContext({
            micro_sufficiency: '{"sufficient":true,"reason":"found answer"}',
            micro_answer: '<thinking>processing</thinking>Elon Musk is the CEO.'
        });
        const obs = { key_entities: ['Tesla'] };
        const ori = { language: 'english', memory_action: null, user_profile: {} };
        const act = [{ name: 'web_search', result: { query: 'Tesla CEO', results: [{ title: 'Tesla CEO', snippet: 'Elon Musk is CEO' }] } }];
        const result = await _evaluateMicro.call(ctx, obs, ori, act, 'Who is Tesla CEO?', {});
        assertEqual(result.needs_more, false, 'no more needed');
        assertEqual(result.final_answer, 'Elon Musk is the CEO.', 'answer extracted');
        assertEqual(result.confidence, 'high', 'high confidence');
    }

    {
        const ctx = createMockContext({
            micro_answer: 'Kuala Lumpur is 33.4°C and partly cloudy.'
        });
        const obs = { key_entities: ['Kuala Lumpur'] };
        const ori = { language: 'english', memory_action: null, user_profile: {} };
        const act = [{ name: 'get_weather', result: { city: 'Kuala Lumpur', temperature: 33.4, condition: 'Partly cloudy' } }];
        const result = await _evaluateMicro.call(ctx, obs, ori, act, "What's the weather there right now?", {});
        assertEqual(result.needs_more, false, 'deterministic weather result does not trigger another loop');
        assertEqual(result.final_answer, 'Kuala Lumpur is 33.4°C and partly cloudy.', 'deterministic tool answer still generated');
        assertEqual(ctx.callLog.filter(c => c.opts?._phase === 'micro_sufficiency').length, 0, 'skips sufficiency LLM for deterministic tools');
    }

    group('_evaluateMicro — insufficient results');

    {
        const ctx = createMockContext({
            micro_sufficiency: '{"sufficient":false,"reason":"wrong entity"}'
        });
        const obs = { key_entities: ['ZetaCorp'] };
        const ori = { language: 'english', memory_action: null, user_profile: {} };
        const act = [{ name: 'web_search', result: { query: 'ZetaCorp', results: [] } }];
        const result = await _evaluateMicro.call(ctx, obs, ori, act, 'About ZetaCorp', {});
        assertEqual(result.needs_more, true, 'needs more');
        assertEqual(result.confidence, 'low', 'low confidence');
        assertContains(result.reason, 'wrong', 'reason explains');
        assertEqual(ctx.callLog.length, 1, 'only sufficiency call (no answer gen)');
    }

    group('_evaluateMicro — recall with user profile');

    {
        const ctx = createMockContext((phase, prompt) => {
            if (phase === 'micro_sufficiency') {
                assertContains(prompt, 'user_name=John', 'profile injected in sufficiency');
                return '{"sufficient":true,"reason":"found in profile"}';
            }
            if (phase === 'micro_answer') {
                assertContains(prompt, 'user_name=John', 'profile injected in answer');
                return 'Your name is John.';
            }
            return '{}';
        });
        const obs = { key_entities: ['name'] };
        const ori = { language: 'english', memory_action: 'recall', user_profile: { user_name: 'John' } };
        const act = [{ name: 'recall_memory', result: { key: 'user_name', value: 'John' } }];
        await _evaluateMicro.call(ctx, obs, ori, act, 'What is my name?', {});
    }

    group('_evaluateMicro — result formatting');

    {
        const ctx = createMockContext({
            micro_sufficiency: '{"sufficient":true}',
            micro_answer: 'Formatted answer'
        });
        const obs = { key_entities: ['test'] };
        const ori = { language: 'english', memory_action: null, user_profile: {} };
        // Mixed result types
        const act = [
            { name: 'web_search', result: { query: 'test', results: [{ title: 'Test Result', snippet: 'A snippet' }] } },
            { name: 'fetch_url', result: { url: 'https://example.com', title: 'Example', content: 'Page content here' } },
            { name: 'calculate', result: { expression: '2+2', result: 4 } }
        ];
        const result = await _evaluateMicro.call(ctx, obs, ori, act, 'test', {});
        // Check that the prompt to sufficiency includes formatted results
        const suffPrompt = ctx.callLog[0].prompt;
        assertContains(suffPrompt, 'Tool: web_search', 'web_search results formatted');
        assertContains(suffPrompt, 'Tool: fetch_url', 'fetch_url results formatted');
        assertContains(suffPrompt, 'Tool: calculate', 'calculate results formatted');
    }

    group('_evaluateMicro — error fallback to legacy');

    {
        const ctx = createMockContext({});
        ctx._callModel = () => { throw new Error('fail'); };
        ctx._rankByRelevance = (r) => r;
        const obs = { key_entities: [] };
        const ori = { language: 'english', memory_action: null, user_profile: {} };
        const result = await _evaluateMicro.call(ctx, obs, ori, [], 'test', {});
        assertEqual(result.final_answer, 'legacy answer', 'fell back to legacy _evaluate');
    }

    // ════════════════════════════════════════════════
    // COT verification — all micro-agents use <thinking>
    // ════════════════════════════════════════════════
    group('COT — all prompts include thinking instruction');

    {
        const phases = ['micro_intent', 'micro_entities', 'micro_reference', 'micro_memory',
                        'micro_tool', 'micro_args', 'micro_sufficiency', 'micro_answer'];
        const ctx = createMockContext((phase) => {
            if (phase === 'micro_intent') return '{"intent":"question"}';
            if (phase === 'micro_entities') return '{"entities":[]}';
            if (phase === 'micro_reference') return '{"is_reference":false}';
            if (phase === 'micro_memory') return '{"action":"none"}';
            if (phase === 'micro_tool') return '{"tool":"web_search"}';
            if (phase === 'micro_args') return '{"query":"test"}';
            if (phase === 'micro_sufficiency') return '{"sufficient":true}';
            if (phase === 'micro_answer') return 'answer';
            return '{}';
        });

        // Trigger all micro-agents
        await _microIntent.call(ctx, 'test', {});
        await _microEntities.call(ctx, 'test', {});
        await _microReference.call(ctx, 'test', 'context', {});
        await _microMemory.call(ctx, 'test', {});
        await _microSelectTool.call(ctx, 'test', [], 'none', '', {});
        await _microArgs.call(ctx, 'test', 'web_search', [], '', {});
        await _microSufficiency.call(ctx, 'test', [], 'results', {});
        await _microAnswer.call(ctx, 'test', 'results', 'english', '', {});

        for (let i = 0; i < ctx.callLog.length; i++) {
            const prompt = ctx.callLog[i].prompt;
            assertContains(prompt, '<thinking>', `prompt ${i} includes <thinking> instruction`);
        }
    }

    // ════════════════════════════════════════════════
    // Generation config — deterministic vs creative
    // ════════════════════════════════════════════════
    group('Generation config — deterministic for classify/decide, creative for answer');

    {
        const ctx = createMockContext({
            micro_intent: '{"intent":"question"}',
            micro_answer: 'creative answer'
        });

        await _microIntent.call(ctx, 'test', {});
        const intentConfig = ctx.callLog[0].opts.generationConfig;
        assertTrue(intentConfig.temperature <= 0.3, 'intent uses low temperature');

        await _microAnswer.call(ctx, 'test', 'results', 'english', '', {});
        const answerConfig = ctx.callLog[1].opts.generationConfig;
        assertTrue(answerConfig.temperature >= 0.5, 'answer uses higher temperature');
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
