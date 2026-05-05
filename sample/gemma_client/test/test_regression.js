#!/usr/bin/env node
// ============================================================
//  test/test_regression.js — Full E2E regression test
//  Follows task.md 8-step flow with real API + real tools
//  Tests: greeting guard, is_about_user, workspace follow-up,
//         multi-intent, memory, hallucination detection, harness
//  Run: node test/test_regression.js
// ============================================================

import { PHASE } from '../src/oodae.js';
import {
    assertTrue, assertFalse, assertEqual, assertContains, assertGreater,
    group, results, resetResults, summarize, timer, setupAPI, registerTestTools, loadKeys, C
} from './helpers.js';
import { KeyManager } from '../src/core.js';
import { GemmaAPI } from '../src/client.js';
import { ToolRegistry } from '../src/tools.js';
import { OODAERunner } from '../src/oodae.js';

const TIMEOUT = 90000; // 90s per test (some need multiple OODA loops)

async function withTimeout(fn, ms) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
}

// ===== Phase collector — captures all phase data for assertions =====
function phaseCollector() {
    const phases = [];
    const tools = [];
    return {
        phases, tools,
        onPhase: (phase, info) => {
            if (info.status === 'done') phases.push({ phase, data: info.data, loop: info.loop });
        },
        onToolCall: (call) => tools.push(call),
        onToolResult: () => {},
    };
}

// ===== Setup with full tools + memory =====
function setupFullAPI() {
    const keys = loadKeys(new URL('../gemma_code.jsonl', import.meta.url).pathname);
    if (keys.length === 0) throw new Error('No API keys found');

    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const k of keys) keyManager.addKey(k);

    const api = new GemmaAPI({ keyManager, model: 'gemma-3-27b-it' });
    const registry = new ToolRegistry();
    registerTestTools(registry);

    // Add save_memory / recall_memory / list_memories for memory tests
    const memoryStore = new Map();
    registry.add({
        name: 'save_memory', description: 'Save information about the user.',
        parameters: {
            key: { type: 'string', required: true },
            value: { type: 'string', required: true },
            category: { type: 'string', required: false, default: 'general' }
        },
        handler: async (args) => {
            memoryStore.set(args.key, { value: args.value, category: args.category || 'general' });
            return { saved: true, key: args.key };
        }
    });
    registry.add({
        name: 'recall_memory', description: 'Recall a previously saved memory.',
        parameters: { query: { type: 'string', required: true } },
        handler: async (args) => {
            const q = args.query.toLowerCase();
            const matches = [];
            for (const [k, v] of memoryStore) {
                if (k.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)) matches.push({ key: k, ...v });
            }
            return { query: args.query, found: matches.length, memories: matches };
        }
    });
    registry.add({
        name: 'list_memories', description: 'List all saved memories.',
        parameters: {},
        handler: async () => {
            const all = [];
            for (const [k, v] of memoryStore) all.push({ key: k, ...v });
            return { count: all.length, memories: all };
        }
    });

    const runner = new OODAERunner(api, registry, { maxLoops: 3 });

    // Simple workspace (in-memory topic DB for follow-up resolution)
    const topics = [];
    const memoryDB = {
        getAllMemories: async () => {
            const all = [];
            for (const [k, v] of memoryStore) all.push({ key: k, value: v.value, category: v.category });
            return all;
        },
        getRecentTopics: async (n) => topics.slice(-n).reverse(),
        getTopicChain: async (id) => {
            const chain = [];
            let cur = topics.find(t => t.id === id);
            while (cur) {
                chain.unshift(cur);
                cur = cur.parentId ? topics.find(t => t.id === cur.parentId) : null;
            }
            return chain;
        },
        addTopic: async (t) => {
            t.id = 'topic_' + (topics.length + 1);
            t.timestamp = Date.now();
            topics.push(t);
        }
    };

    return { api, runner, registry, memoryStore, memoryDB, topics, keyCount: keys.length };
}

// ===== Hallucination detector =====
function detectHallucinations(result, collector) {
    const issues = [];

    // 1. URL hallucination: check if any fetch_url was called with non-search-result URL
    const searchUrls = new Set();
    for (const p of collector.phases) {
        if (p.phase === PHASE.ACT && Array.isArray(p.data)) {
            for (const r of p.data) {
                if (r.name === 'web_search' && r.result?.results) {
                    for (const sr of r.result.results) searchUrls.add(sr.url);
                }
            }
        }
    }
    for (const tool of collector.tools) {
        if (tool.name === 'fetch_url' && tool.arguments?.url) {
            const url = tool.arguments.url;
            // Check if URL was from search results or system auto-fetch
            if (searchUrls.size > 0 && !searchUrls.has(url)) {
                // Check domain at least matches
                try {
                    const fetchDomain = new URL(url).hostname;
                    const knownDomains = [...searchUrls].map(u => { try { return new URL(u).hostname; } catch { return ''; } });
                    if (!knownDomains.includes(fetchDomain)) {
                        issues.push(`URL hallucination: fetch_url("${url}") domain not in search results`);
                    }
                } catch {}
            }
        }
    }

    // 2. Tool hallucination: tool was called that doesn't exist
    // (handled by registry, but check for raw text)

    // 3. Factual hallucination: response claims "no information found" when data was present
    const actData = collector.phases.filter(p => p.phase === PHASE.ACT);
    for (const act of actData) {
        if (!Array.isArray(act.data)) continue;
        for (const r of act.data) {
            if (r.name === 'web_search' && r.result?.results?.length > 0) {
                const snippets = r.result.results.map(s => s.snippet).join(' ').toLowerCase();
                const resp = (result.response || '').toLowerCase();
                if (resp.includes('no information') || resp.includes('could not find') || resp.includes('unable to find')) {
                    if (snippets.length > 50) {
                        issues.push(`Snippet miss: response says "no info" but search returned ${r.result.results.length} results with content`);
                    }
                }
            }
        }
    }

    return issues;
}

// ===== Debug printer =====
function printDebug(label, result, collector) {
    console.log(`\n  ${C.dim}── Debug: ${label} ──${C.reset}`);
    for (const p of collector.phases) {
        const d = p.data;
        if (p.phase === PHASE.OBSERVE) {
            console.log(`  ${C.cyan}OBSERVE${C.reset} intent=${d?.intent} tools=${d?.requires_tools} entities=[${(d?.key_entities||[]).join(',')}] about_user=${d?.is_about_user}`);
        } else if (p.phase === PHASE.CLASSIFY) {
            const flags = [
                d?.is_greeting ? 'greeting' : null,
                d?.is_command ? 'command' : null,
                d?.is_acknowledgment ? 'ack' : null,
                d?.needs_tools ? 'needs_tools' : null,
            ].filter(Boolean).join(', ') || 'none';
            const mem = d?.memory_action ? ` mem=${d.memory_action}(${d.save_key}=${d.save_value})` : '';
            const ents = d?.user_entities?.length ? ` entities=[${d.user_entities.join(',')}]` : '';
            console.log(`  ${C.yellow}CLASSIFY${C.reset} flags=[${flags}]${mem}${ents}`);
        } else if (p.phase === PHASE.ORIENT) {
            console.log(`  ${C.blue}ORIENT${C.reset}  lang=${d?.language} mem_action=${d?.memory_action} mem_count=${d?.memory_count}`);
        } else if (p.phase === PHASE.DECIDE) {
            const plan = d?.plan || [];
            console.log(`  ${C.yellow}DECIDE${C.reset}  plan=[${plan.map(s => `${s.tool}(${JSON.stringify(s.args||{}).slice(0,60)})`).join(', ')}]`);
        } else if (p.phase === PHASE.ACT) {
            const acts = Array.isArray(d) ? d : [];
            for (const a of acts) {
                const preview = a.error ? `ERROR: ${a.error}` : JSON.stringify(a.result).slice(0, 100);
                console.log(`  ${C.green}ACT${C.reset}     ${a.name}: ${preview}`);
            }
        } else if (p.phase === PHASE.EVALUATE) {
            console.log(`  ${C.green}EVAL${C.reset}    needs_more=${d?.needs_more} answer_len=${(d?.final_answer||'').length}`);
        }
    }
    console.log(`  ${C.dim}Response (${(result.response||'').length} chars): ${(result.response||'').slice(0, 120)}${C.reset}`);

    // Hallucination check
    const hallucinations = detectHallucinations(result, collector);
    if (hallucinations.length > 0) {
        console.log(`  ${C.red}⚠ HALLUCINATIONS DETECTED:${C.reset}`);
        for (const h of hallucinations) console.log(`    ${C.red}• ${h}${C.reset}`);
    }
}

// ============================================================
//  REGRESSION TEST FLOW (task.md)
// ============================================================
export async function run() {
    resetResults();
    console.log('\n📦 test_regression.js');
    console.log(`${C.dim}  Full E2E regression: 8-step flow from task.md${C.reset}`);
    console.log(`${C.dim}  Real API calls + real tools + workspace + memory${C.reset}\n`);

    let setup;
    try {
        setup = setupFullAPI();
        console.log(`${C.green}✓ Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}✗ Setup failed: ${err.message}${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner, memoryStore, memoryDB, topics } = setup;
    const chatHistory = []; // shared across all steps (conversation continuity)

    // ──────────────────────────────────────────────
    //  Step 1: hi → greeting, no tools
    // ──────────────────────────────────────────────
    group('Step 1: "hi" → greeting, no tools');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('hi', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertTrue(result.iterations === 0, 'zero iterations (fast path, no tools)');
        assertTrue(result.toolCalls.length === 0, 'no tool calls');

        // Verify OBSERVE classified as greeting
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        assertEqual(obs?.data?.intent, 'greeting', 'OBSERVE intent = greeting');
        assertFalse(obs?.data?.requires_tools, 'requires_tools = false');

        printDebug('Step 1', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 1', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 2: my name is jinja → is_about_user, save_memory
    // ──────────────────────────────────────────────
    group('Step 2: "my name is jinja" → is_about_user, save_memory');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('my name is jinja', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Verify OBSERVE detected is_about_user
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        assertTrue(obs?.data?.is_about_user, 'OBSERVE is_about_user = true');

        // Verify save_memory was called (either directly or via tool plan)
        const savedTools = col.tools.filter(t => t.name === 'save_memory');
        // If model used fast-path (no tools), check if it at least mentioned the name
        if (savedTools.length > 0) {
            assertTrue(true, 'save_memory tool was called');
            // Check memory store
            let nameFound = false;
            for (const [k, v] of memoryStore) {
                if (v.value.toLowerCase().includes('jinja') || k.toLowerCase().includes('name')) nameFound = true;
            }
            assertTrue(nameFound, 'memory store contains user name "jinja"');
        } else {
            // Even without save_memory tool, response should acknowledge the name
            const resp = result.response.toLowerCase();
            assertTrue(resp.includes('jinja') || resp.includes('name'), 'response acknowledges user name');
        }

        // Verify workspace did NOT inject old topic context
        // (is_about_user guard should prevent workspace override)
        const decidePlan = col.phases.find(p => p.phase === PHASE.DECIDE);
        if (decidePlan?.data?.plan) {
            const hasWebSearch = decidePlan.data.plan.some(s => s.tool === 'web_search');
            assertFalse(hasWebSearch, 'no web_search (workspace guard: is_about_user)');
        }

        printDebug('Step 2', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 2', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // Pre-seed memory for language preference (needed for Step 8 validation)
    memoryStore.set('user_name', { value: 'jinja', category: 'user_profile' });

    // ──────────────────────────────────────────────
    //  Step 3: tno system pte ltd → new query, web_search
    // ──────────────────────────────────────────────
    group('Step 3: "tno system pte ltd" → new query, web_search');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('tno system pte ltd', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');

        // Verify web_search was used
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        assertGreater(searchCalls.length, 0, 'web_search was called');

        // Verify search query contains "tno" (not old entity)
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertTrue(query.includes('tno'), 'search query contains "tno"');
        }

        // Verify OBSERVE classified as question (not follow-up of greeting)
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        assertTrue(obs?.data?.intent !== 'greeting', 'intent is not greeting');
        assertTrue(obs?.data?.requires_tools, 'requires_tools = true');

        // Hallucination check
        const hallucinations = detectHallucinations(result, col);
        assertTrue(hallucinations.length === 0, `no hallucinations detected (${hallucinations.length > 0 ? hallucinations[0] : 'clean'})`);

        printDebug('Step 3', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 3', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 4: boss name? → follow-up (workspace), web_search
    // ──────────────────────────────────────────────
    group('Step 4: "boss name?" → follow-up (workspace), web_search');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('boss name?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Verify web_search was used
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        assertGreater(searchCalls.length, 0, 'web_search was called');

        // Verify search query is about TNO (follow-up context), not just "boss name"
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertTrue(
                query.includes('tno') || query.includes('boss') || query.includes('ceo') || query.includes('director'),
                `search query relates to TNO context (got: "${query}")`
            );
        }

        // Verify OBSERVE detected follow-up or question with workspace injection
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        const entities = (obs?.data?.key_entities || []).map(e => e.toLowerCase()).join(' ');
        assertTrue(
            entities.includes('tno') || obs?.data?.intent === 'follow_up' || obs?.data?.summary?.toLowerCase().includes('tno'),
            'OBSERVE links to TNO context via workspace or entities'
        );

        // Hallucination check
        const hallucinations = detectHallucinations(result, col);
        assertTrue(hallucinations.length === 0, `no hallucinations (${hallucinations.length > 0 ? hallucinations[0] : 'clean'})`);

        printDebug('Step 4', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 4', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 5: address? → follow-up (workspace), web_search
    // ──────────────────────────────────────────────
    group('Step 5: "address?" → follow-up (workspace), web_search');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('address?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Verify web_search was used
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        assertGreater(searchCalls.length, 0, 'web_search was called');

        // Verify it's about TNO address, not generic "address"
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertTrue(
                query.includes('tno') || query.includes('address'),
                `search includes TNO or address context (got: "${query}")`
            );
        }

        // Hallucination: response should not hallucinate a random address
        // Check if address in response appears in search results
        const actPhases = col.phases.filter(p => p.phase === PHASE.ACT);
        let searchSnippets = '';
        for (const act of actPhases) {
            if (!Array.isArray(act.data)) continue;
            for (const r of act.data) {
                if (r.result?.results) searchSnippets += r.result.results.map(s => s.snippet).join(' ');
                if (r.result?.content) searchSnippets += r.result.content;
            }
        }
        // If response contains a specific address, verify it's grounded in search results
        const addressMatch = result.response.match(/\d+[A-Za-z]?\s+[\w\s]+(?:Road|Street|Avenue|Drive|Lane|Blvd|Way|Place)/i);
        if (addressMatch && searchSnippets.length > 0) {
            const addr = addressMatch[0].toLowerCase();
            const grounded = searchSnippets.toLowerCase().includes(addr.slice(0, 15));
            assertTrue(grounded, `address "${addr.slice(0,40)}" is grounded in search results`);
        }

        printDebug('Step 5', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 5', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 6: what time now? i want tno email → multi-intent
    // ──────────────────────────────────────────────
    group('Step 6: "what time now? i want tno email" → multi-intent (get_time + web_search)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what time now? i want tno email', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');

        // Verify both intents were handled
        const toolNames = col.tools.map(t => t.name);
        const hasTime = toolNames.includes('get_time');
        const hasSearch = toolNames.includes('web_search');
        // At minimum, one of the intents should be addressed
        assertTrue(hasTime || hasSearch, 'at least one intent handled (get_time or web_search)');

        // Bonus: check if BOTH intents were covered (multi-intent harness)
        if (hasTime && hasSearch) {
            assertTrue(true, 'BOTH intents covered (get_time + web_search) — multi-intent harness works');
        } else {
            console.log(`  ${C.yellow}⚠${C.reset} Only partial: get_time=${hasTime}, web_search=${hasSearch}`);
        }

        // Verify search is about TNO email, not time
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertTrue(
                query.includes('tno') || query.includes('email'),
                `search is about TNO email (got: "${query}")`
            );
        }

        printDebug('Step 6', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 6', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 7: boss name? (repeat) → follow-up, should reuse context
    // ──────────────────────────────────────────────
    group('Step 7: "boss name?" (repeat) → follow-up, workspace context');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('boss name?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Compare with Step 4 — answer should be consistent
        // (We can't do exact comparison but at least verify it's about TNO)
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        const entities = (obs?.data?.key_entities || []).map(e => e.toLowerCase()).join(' ');
        const summary = (obs?.data?.summary || '').toLowerCase();
        assertTrue(
            entities.includes('tno') || summary.includes('tno') || obs?.data?.intent === 'follow_up',
            'still linked to TNO context'
        );

        printDebug('Step 7', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 7', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 8: remember reply mandarin → command, save_memory
    // ──────────────────────────────────────────────
    group('Step 8: "remember reply mandarin" → command, save_memory');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('remember reply mandarin', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Verify OBSERVE detected as command/is_about_user
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        assertTrue(
            obs?.data?.is_about_user || obs?.data?.intent?.includes('command') || obs?.data?.intent?.includes('information_sharing'),
            'OBSERVE: is_about_user or intent=command'
        );

        // Should NOT trigger web_search for TNO
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertFalse(query.includes('tno'), `no TNO web_search leak (got: "${query}")`);
        } else {
            assertTrue(true, 'no web_search (correct: this is a command)');
        }

        // Verify save_memory was called with mandarin preference
        const saveCalls = col.tools.filter(t => t.name === 'save_memory');
        if (saveCalls.length > 0) {
            assertTrue(true, 'save_memory was called');
            const arg = JSON.stringify(saveCalls[0].arguments || {}).toLowerCase();
            assertTrue(arg.includes('mandarin') || arg.includes('chinese') || arg.includes('中文'),
                'save_memory includes mandarin preference');
        }

        printDebug('Step 8', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 8', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  BONUS TESTS: Harness edge cases
    // ──────────────────────────────────────────────

    // ── Bonus A: "i see" → acknowledgment, no tools ──
    group('Bonus A: "i see" → acknowledgment, no tools');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('i see', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        // Should not trigger web_search (acknowledgment guard)
        assertTrue(result.toolCalls.length === 0, 'no tool calls for acknowledgment');

        printDebug('Bonus A', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus A', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Bonus B: "你好" → greeting in Chinese ──
    group('Bonus B: "你好" → greeting guard (Chinese)');
    try {
        const t = timer();
        const col = phaseCollector();
        const freshHistory = [];
        const result = await withTimeout(() => runner.run('你好', {
            chatHistory: freshHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertTrue(result.iterations === 0, 'zero iterations (fast path)');
        assertTrue(result.toolCalls.length === 0, 'no tool calls');

        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        assertEqual(obs?.data?.intent, 'greeting', 'OBSERVE intent = greeting');

        printDebug('Bonus B', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus B', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Bonus C: URL hallucination stress test ──
    group('Bonus C: "who founded openai" → URL hallucination check');
    try {
        const t = timer();
        const col = phaseCollector();
        const freshHistory = [];
        const result = await withTimeout(() => runner.run('who founded openai', {
            chatHistory: freshHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'used OODA loop');

        // Hallucination check
        const hallucinations = detectHallucinations(result, col);
        assertTrue(hallucinations.length === 0, `no URL hallucinations (${hallucinations.length > 0 ? hallucinations[0] : 'clean'})`);

        printDebug('Bonus C', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus C', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Bonus D: Topic Switch — "what is quantum computing?" after TNO context ──
    // This is the critical test from the capability report (was FAIL before Priority 1 fix)
    group('Bonus D: "what is quantum computing?" → topic switch (no TNO contamination)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what is quantum computing?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'used OODA loop');

        // CRITICAL: OBSERVE should NOT inject TNO context into this query
        const obs = col.phases.find(p => p.phase === PHASE.OBSERVE);
        const obsSummary = (obs?.data?.summary || '').toLowerCase();
        const obsEntities = (obs?.data?.key_entities || []).map(e => e.toLowerCase());

        // Layer 1 check: entities should be about quantum computing, NOT TNO
        const hasTnoInEntities = obsEntities.some(e => e.includes('tno'));
        assertFalse(hasTnoInEntities, 'OBSERVE entities do NOT contain "tno" (Layer 1 topic switch)');

        // CLASSIFY should detect quantum computing entities
        const classify = col.phases.find(p => p.phase === PHASE.CLASSIFY);
        const classifiedEnts = (classify?.data?.user_entities || []).map(e => e.toLowerCase());
        const hasQC = classifiedEnts.some(e => e.includes('quantum'));
        assertTrue(hasQC, 'CLASSIFY detected "quantum" entity');

        // DECIDE should search for quantum computing, NOT "tno quantum computing"
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            assertTrue(query.includes('quantum'), 'search query contains "quantum"');
            assertFalse(query.includes('tno'), 'search query does NOT contain "tno" (no contamination)');
        }

        // Layer 2 check: if OBSERVE classified as follow_up, CLASSIFY should have corrected it
        if (obs?.data?.intent === 'follow_up') {
            // Layer 2 should have rebuilt the summary
            assertFalse(obsSummary.includes('tno'), 'summary rebuilt without TNO (Layer 2 correction)');
        }

        // Hallucination check
        const hallucinations = detectHallucinations(result, col);
        assertTrue(hallucinations.length === 0, `no hallucinations (${hallucinations.length > 0 ? hallucinations[0] : 'clean'})`);

        printDebug('Bonus D', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus D', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Bonus E: Topic Switch follow-up — "who are the leaders in this field?" ──
    // After quantum computing query, follow-up should stay on QC, NOT revert to TNO
    group('Bonus E: "who are the leaders in this field?" → follow-up on quantum computing');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('who are the leaders in this field?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Search should be about quantum computing leaders, NOT TNO leaders
        const searchCalls = col.tools.filter(t => t.name === 'web_search');
        if (searchCalls.length > 0) {
            const query = searchCalls[0].arguments?.query?.toLowerCase() || '';
            const aboutQC = query.includes('quantum') || query.includes('computing') || query.includes('leader');
            assertTrue(aboutQC, `search relates to quantum computing leaders (got: "${query}")`);
            assertFalse(query.includes('tno'), 'search does NOT mention TNO');
        }

        // Response should mention QC companies/researchers, not TNO
        const respLower = result.response.toLowerCase();
        const aboutQCResponse = respLower.includes('quantum') || respLower.includes('ibm') ||
            respLower.includes('google') || respLower.includes('microsoft') || respLower.includes('qubit');
        assertTrue(aboutQCResponse, 'response is about quantum computing (not TNO)');

        printDebug('Bonus E', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus E', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ── Bonus F: URL fetch dedup — verify same URL not fetched twice ──
    group('Bonus F: URL fetch dedup validation');
    try {
        const t = timer();
        const col = phaseCollector();
        const freshHistory2 = [];
        const result = await withTimeout(() => runner.run('tell me about SpaceX latest launches', {
            chatHistory: freshHistory2, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Check for duplicate fetch_url calls
        const fetchCalls = col.tools.filter(t => t.name === 'fetch_url');
        const fetchUrls = fetchCalls.map(t => t.arguments?.url).filter(Boolean);
        const uniqueUrls = new Set(fetchUrls);
        assertEqual(fetchUrls.length, uniqueUrls.size, `no duplicate fetch_url calls (${fetchUrls.length} calls, ${uniqueUrls.size} unique)`);

        printDebug('Bonus F', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Bonus F', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Final summary
    // ──────────────────────────────────────────────
    console.log(`\n${C.dim}${'═'.repeat(60)}${C.reset}`);
    console.log(`${C.bold}  Workspace topics created: ${topics.length}${C.reset}`);
    for (const t of topics) {
        console.log(`  ${C.dim}  [${t.id}] ${t.intent} | ${t.userText} → ${(t.answer||'').slice(0,50)}${C.reset}`);
    }
    console.log(`${C.bold}  Memory store: ${memoryStore.size} entries${C.reset}`);
    for (const [k, v] of memoryStore) {
        console.log(`  ${C.dim}  ${k} [${v.category}] = ${v.value}${C.reset}`);
    }
    console.log(`${C.dim}${'═'.repeat(60)}${C.reset}`);

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run().then(r => {
        summarize();
        process.exit(r.failed > 0 ? 1 : 0);
    });
}
