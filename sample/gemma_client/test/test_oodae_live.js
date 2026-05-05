// ============================================================
//  test/test_oodae_live.js — Live tests with real API calls
//  Requires valid API keys in gemma_code.jsonl
//  Run: node test/test_oodae_live.js
// ============================================================

import { PHASE } from '../src/oodae.js';
import { assertTrue, assertGreater, assertContains, group, results, resetResults, summarize, timer, setupAPI, C } from './helpers.js';

const TIMEOUT = 60000; // 60s per test

async function withTimeout(fn, ms) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
}

export async function run() {
    resetResults();
    console.log('\n📦 test_oodae_live.js');
    console.log(`${C.dim}  (requires API keys — each test takes 5-30s)${C.reset}`);

    let setup;
    try {
        setup = setupAPI();
        console.log(`${C.dim}  Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}  Failed to setup API: ${err.message}${C.reset}`);
        console.log(`${C.dim}  Skipping all live tests${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner } = setup;
    const memoryDB = { getAllMemories: async () => [] };

    // ── Test 1: Greeting (no tools) ──
    group('Greeting — no tools expected');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('hello', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${result.toolCalls.length} tools${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertTrue(result.response.length < 2000, 'response is reasonable length');
        assertTrue(result.toolCalls.length === 0, 'no tool calls for greeting');
        assertTrue(result.iterations === 0, 'zero iterations (fast path)');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Greeting test', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Test 2: Factual search ──
    group('Factual search — should use tools');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('what time is it in Singapore?', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${result.toolCalls.length} tools${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.toolCalls.length, 0, 'used at least 1 tool');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Factual search test', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Test 3: Math calculation ──
    group('Math — calculate tool or direct answer');
    try {
        const t = timer();
        const result = await withTimeout(() => runner.run('what is 7 * 13 + 29?', {
            chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | ${result.iterations} loops | ${result.toolCalls.length} tools${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertContains(result.response, '120', 'response contains correct answer 120');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Math test', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Test 4: Follow-up context ──
    group('Follow-up — context retention');
    try {
        const t = timer();
        const chatHistory = [];
        // First query
        const r1 = await withTimeout(() => runner.run('what is 15 + 27?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        assertTrue(r1.response.length > 0, 'first response non-empty');

        // Follow-up
        const r2 = await withTimeout(() => runner.run('multiply that by 3', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it',
            onPhase: () => {}, onToolCall: () => {}, onToolResult: () => {},
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()} | follow-up response: ${r2.response.slice(0, 80)}${C.reset}`);

        assertTrue(r2.response.length > 0, 'follow-up response non-empty');
        assertGreater(chatHistory.length, 2, 'chat history grew');
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Follow-up test', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
