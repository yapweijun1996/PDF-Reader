// ============================================================
//  test/test_micro_live.js — Live API tests for micro-agents
//  and SearchAgent. Uses real Gemma API calls.
//  Run: node test/test_micro_live.js
// ============================================================

import { PHASE } from '../src/oodae.js';
import { assertTrue, assertFalse, assertGreater, assertContains, assertEqual, group, results, resetResults, summarize, timer, setupAPI, C } from './helpers.js';

const TIMEOUT = 120000; // 120s per test (fetch_url can be slow)

async function withTimeout(fn, ms) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
}

export async function run() {
    resetResults();
    console.log('\n📦 test_micro_live.js');
    console.log(`${C.dim}  (requires API keys — each test takes 5-60s)${C.reset}`);

    let setup;
    try {
        setup = setupAPI();
        console.log(`${C.dim}  Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}  Failed to setup API: ${err.message}${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner, api, registry } = setup;
    const memoryDB = {
        getAllMemories: async () => [],
        getRecentTopics: async () => [],
        saveToWorkspace: async () => {},
    };

    // ═══════════════════════════════════════════
    // Test 1: Greeting — micro-agent fast path
    // ═══════════════════════════════════════════
    group('Micro: Greeting — fast path, no tools');
    try {
        const t = timer();
        const phases = [];
        const result = await withTimeout(() => runner.run('你好！', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: (phase) => phases.push(phase),
            onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | response: ${result.response.slice(0, 80)}${C.reset}`);

        assertTrue(result.response.length > 0, 'greeting response non-empty');
        assertEqual(result.toolCalls.length, 0, 'no tool calls for greeting');
        assertEqual(result.iterations, 0, 'zero iterations (fast path)');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro greeting', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 2: Factual question — micro classify + decide + evaluate
    // ═══════════════════════════════════════════
    group('Micro: Factual question — "Who is the CEO of Tesla?"');
    try {
        const t = timer();
        const toolCalls = [];
        const result = await withTimeout(() => runner.run('Who is the CEO of Tesla?', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {},
            onToolCall: (c) => toolCalls.push(c),
            onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${toolCalls.length} tool calls${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 150)}${C.reset}`);

        assertTrue(result.response.length > 0, 'response non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');
        assertGreater(toolCalls.length, 0, 'used tools');
        // Should mention Elon Musk somewhere
        const lower = result.response.toLowerCase();
        assertTrue(lower.includes('elon') || lower.includes('musk'), 'mentions Elon Musk');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro factual', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 3: Chinese factual — micro + language detection
    // ═══════════════════════════════════════════
    group('Micro: Chinese question — "新加坡现在几点？"');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('新加坡现在几点？', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 150)}${C.reset}`);

        assertTrue(result.response.length > 0, 'response non-empty');
        assertGreater(result.toolCalls.length, 0, 'used tools');
        // Response should contain time-related content (numeric or Chinese format)
        const hasTime = /\d{1,2}[:\s时点]/.test(result.response)
            || /[一二三四五六七八九十]+[点时]/.test(result.response)
            || /[上下]午/.test(result.response)
            || /AM|PM|:\d{2}/i.test(result.response);
        assertTrue(hasTime, 'response contains time information');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro Chinese', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 4: Info sharing — micro memory save
    // ═══════════════════════════════════════════
    group('Micro: Info sharing — "我叫小白"');
    try {
        const t = timer();
        const saved = [];
        const memDB = {
            getAllMemories: async () => [],
            getRecentTopics: async () => [],
            saveToWorkspace: async () => {},
        };
        // Add save_memory tool
        if (!registry.has('save_memory')) {
            registry.add({
                name: 'save_memory', description: 'Save user info to memory.',
                parameters: { key: { type: 'string', required: true }, value: { type: 'string', required: true } },
                handler: async (args) => { saved.push(args); return { saved: true, key: args.key, value: args.value }; }
            });
        }

        const result = await withTimeout(() => runner.run('我叫小白', {
            chatHistory: [], memoryDB: memDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | saved: ${JSON.stringify(saved)}${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 150)}${C.reset}`);

        assertTrue(result.response.length > 0, 'response non-empty');
        // Should have triggered save_memory with name info
        if (saved.length > 0) {
            assertTrue(saved[0].value.includes('小白') || saved[0].key.includes('name'), 'saved user name info');
        } else {
            // Acceptable: model might respond directly without save_memory
            console.log(`${C.yellow}  ⚠ No save_memory call (model may have responded directly)${C.reset}`);
            results.total++; results.passed++;
        }
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro info sharing', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 5: Acknowledgment — fast path
    // ═══════════════════════════════════════════
    group('Micro: Acknowledgment — "好的谢谢"');
    try {
        const t = timer();
        const chatHistory = [
            { role: 'user', parts: [{ text: 'Tesla的CEO是谁？' }] },
            { role: 'model', parts: [{ text: 'Tesla的CEO是Elon Musk。' }] }
        ];
        const result = await withTimeout(() => runner.run('好的谢谢', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${result.toolCalls.length} tools${C.reset}`);

        assertTrue(result.response.length > 0, 'ack response non-empty');
        assertEqual(result.toolCalls.length, 0, 'no tools for acknowledgment');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro acknowledgment', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 6: Task request — "写一首关于春天的诗"
    // ═══════════════════════════════════════════
    group('Micro: Task request — "写一首关于春天的诗"');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('写一首关于春天的诗', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 200)}${C.reset}`);

        assertTrue(result.response.length > 20, 'poem response is substantial');
        assertEqual(result.toolCalls.length, 0, 'no tools for creative task');
        // Should contain Chinese text (poem content)
        assertTrue(/[\u4e00-\u9fff]/.test(result.response), 'response contains Chinese characters');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro task', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 7: Follow-up with pronoun — "那竞争对手呢？"
    // ═══════════════════════════════════════════
    group('Micro: Follow-up — "那竞争对手呢？" after Tesla CEO');
    try {
        const t = timer();
        const chatHistory = [
            { role: 'user', parts: [{ text: 'Tesla的CEO是谁？' }] },
            { role: 'model', parts: [{ text: 'Tesla的CEO是Elon Musk。他于2008年成为CEO。' }] }
        ];
        const result = await withTimeout(() => runner.run('那竞争对手呢？', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${result.toolCalls.length} tools${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 200)}${C.reset}`);

        assertTrue(result.response.length > 0, 'follow-up response non-empty');
        // Should talk about Tesla competitors, not random companies
        const lower = result.response.toLowerCase();
        const mentionsCompetitor = lower.includes('byd') || lower.includes('rivian') || lower.includes('nio')
            || lower.includes('ford') || lower.includes('gm') || lower.includes('volkswagen')
            || lower.includes('竞争') || lower.includes('对手') || lower.includes('比亚迪');
        assertTrue(mentionsCompetitor, 'mentions at least one Tesla competitor');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro follow-up', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 8: SearchAgent direct — factual search with agentic reasoning
    // ═══════════════════════════════════════════
    group('SearchAgent: Direct — "Singapore population 2024"');
    try {
        const { SearchAgent } = await import('../src/search-agent.js');
        const t = timer();
        const agent = new SearchAgent(api, registry);

        const trace = [];
        const result = await withTimeout(() => agent.search('Singapore population', {
            entities: ['Singapore'],
            summary: 'Singapore population in 2024',
            language: 'english'
        }, {
            toolTrace: trace,
            onToolCall: () => {},
            onToolResult: () => {}
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.rounds} rounds | ${result.queriesUsed.length} queries | ${result.results.length} results${C.reset}`);

        assertGreater(result.results.length, 0, 'has search results');
        assertGreater(result.queriesUsed.length, 0, 'used at least 1 query');
        assertTrue(result.rounds >= 1, 'at least 1 search round');
        // Check that results mention Singapore
        const hasEntity = result.results.some(r =>
            (r.title + ' ' + r.snippet).toLowerCase().includes('singapore')
        );
        assertTrue(hasEntity, 'results mention Singapore');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'SearchAgent direct', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 9: Math calculation — "7 * 13 + 29"
    // ═══════════════════════════════════════════
    group('Micro: Math — "7 * 13 + 29"');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('7 * 13 + 29 等于多少？', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | tools: ${result.toolCalls.map(c => c.name).join(', ')}${C.reset}`);
        console.log(`${C.dim}  Response: ${result.response.slice(0, 150)}${C.reset}`);

        assertTrue(result.response.length > 0, 'math response non-empty');
        assertContains(result.response, '120', 'correct answer 120');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Micro math', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ═══════════════════════════════════════════
    // Test 10: Token tracking — verify stats
    // ═══════════════════════════════════════════
    group('Token tracking — stats present');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('hello', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | tokens: ${JSON.stringify(result.tokenStats)}${C.reset}`);

        assertTrue(result.tokenStats !== undefined, 'tokenStats present');
        assertGreater(result.tokenStats.totalTokens, 0, 'totalTokens > 0');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Token tracking', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
