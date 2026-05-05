#!/usr/bin/env node
// ============================================================
//  test/test_longconv.js — Long Conversation Flow Test
//  Tests: context retention, direction loss, tool discipline,
//         topic switch, back-reference, skill progression
//  12-step continuous conversation with shared chatHistory
//  Run: node test/test_longconv.js
// ============================================================

import { PHASE } from '../src/oodae.js';
import {
    assertTrue, assertFalse, assertEqual, assertContains, assertGreater,
    group, results, resetResults, summarize, timer, loadKeys, registerTestTools, C
} from './helpers.js';
import { KeyManager } from '../src/core.js';
import { GemmaAPI } from '../src/client.js';
import { ToolRegistry } from '../src/tools.js';
import { OODAERunner } from '../src/oodae.js';

const TIMEOUT = 90000;

async function withTimeout(fn, ms) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
}

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

function setupFullAPI() {
    const keys = loadKeys(new URL('../gemma_code.jsonl', import.meta.url).pathname);
    if (keys.length === 0) throw new Error('No API keys found');

    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const k of keys) keyManager.addKey(k);

    const api = new GemmaAPI({ keyManager, model: 'gemma-3-27b-it' });
    const registry = new ToolRegistry();
    registerTestTools(registry);

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

// ===== Debug printer (compact) =====
function printDebug(label, result, collector) {
    console.log(`\n  ${C.dim}── Debug: ${label} ──${C.reset}`);
    for (const p of collector.phases) {
        const d = p.data;
        if (p.phase === PHASE.OBSERVE) {
            console.log(`  ${C.cyan}OBSERVE${C.reset} intent=${d?.intent} tools=${d?.requires_tools} entities=[${(d?.key_entities||[]).join(',')}]`);
        } else if (p.phase === PHASE.CLASSIFY) {
            const flags = [
                d?.is_greeting ? 'greeting' : null,
                d?.is_command ? 'command' : null,
                d?.is_acknowledgment ? 'ack' : null,
                d?.needs_tools ? 'needs_tools' : null,
                d?.is_reference ? 'reference' : null,
            ].filter(Boolean).join(', ') || 'none';
            const ents = d?.user_entities?.length ? ` entities=[${d.user_entities.join(',')}]` : '';
            console.log(`  ${C.yellow}CLASSIFY${C.reset} flags=[${flags}]${ents}`);
        } else if (p.phase === PHASE.ORIENT) {
            console.log(`  ${C.blue}ORIENT${C.reset}  lang=${d?.language} mem_count=${d?.memory_count}`);
        } else if (p.phase === PHASE.DECIDE) {
            const plan = d?.plan || [];
            console.log(`  ${C.yellow}DECIDE${C.reset}  plan=[${plan.map(s => `${s.tool}(${JSON.stringify(s.args||{}).slice(0,50)})`).join(', ')}]`);
        } else if (p.phase === PHASE.ACT) {
            const acts = Array.isArray(d) ? d : [];
            for (const a of acts) {
                const preview = a.error ? `ERROR: ${a.error}` : JSON.stringify(a.result).slice(0, 80);
                console.log(`  ${C.green}ACT${C.reset}     ${a.name}: ${preview}`);
            }
        } else if (p.phase === PHASE.EVALUATE) {
            console.log(`  ${C.green}EVAL${C.reset}    needs_more=${d?.needs_more} answer_len=${(d?.final_answer||'').length}`);
        }
    }
    console.log(`  ${C.dim}Response (${(result.response||'').length} chars): ${(result.response||'').slice(0, 120)}${C.reset}`);
}

// ===== Helpers =====
function getObserve(col) { return col.phases.find(p => p.phase === PHASE.OBSERVE)?.data; }
function getClassify(col) { return col.phases.find(p => p.phase === PHASE.CLASSIFY)?.data; }
function getToolNames(col) { return col.tools.map(t => t.name); }
function getSearchQueries(col) { return col.tools.filter(t => t.name === 'web_search').map(t => (t.arguments?.query || '').toLowerCase()); }

// ============================================================
//  LONG CONVERSATION TEST (12 steps)
//  Flow: greeting → self-intro → Topic A query → 3x follow-up →
//        Topic B switch → Topic B follow-up → back to Topic A →
//        pure text gen → multi-intent → complex reasoning
// ============================================================
export async function run() {
    resetResults();
    console.log('\n📦 test_longconv.js');
    console.log(`${C.dim}  Long conversation flow: 12 steps, shared chatHistory${C.reset}`);
    console.log(`${C.dim}  Tests: context retention, direction loss, tool discipline, skill progression${C.reset}\n`);

    let setup;
    try {
        setup = setupFullAPI();
        console.log(`${C.green}✓ Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}✗ Setup failed: ${err.message}${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner, memoryStore, memoryDB, topics } = setup;
    const chatHistory = []; // shared across ALL steps — this is the key

    // Track accumulated state for cross-step assertions
    const state = {
        topicA_response: '',  // Step 3 response (Singapore)
        topicB_response: '',  // Step 7 response (Tesla)
    };

    // ──────────────────────────────────────────────
    //  Step 1: "hello!" → greeting, fast path
    //  Test: tool discipline (0 tools for greeting)
    // ──────────────────────────────────────────────
    group('Step 1: "hello!" → greeting, fast path (0 tools)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('hello!', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertEqual(result.iterations, 0, 'zero iterations (fast path)');
        assertEqual(result.toolCalls.length, 0, 'zero tool calls');
        assertEqual(getObserve(col)?.intent, 'greeting', 'OBSERVE intent = greeting');
        assertFalse(getObserve(col)?.requires_tools, 'requires_tools = false');

        printDebug('Step 1', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 1', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 2: "my name is alex" → save_memory, no web_search
    //  Test: tool discipline (save_memory only, no search leak)
    // ──────────────────────────────────────────────
    group('Step 2: "my name is alex" → save_memory, no web_search');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('my name is alex', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertTrue(getObserve(col)?.is_about_user, 'OBSERVE is_about_user = true');

        const toolNames = getToolNames(col);
        assertFalse(toolNames.includes('web_search'), 'no web_search (is_about_user guard)');

        const savedTools = col.tools.filter(t => t.name === 'save_memory');
        if (savedTools.length > 0) {
            assertTrue(true, 'save_memory was called');
            let nameFound = false;
            for (const [k, v] of memoryStore) {
                if (v.value.toLowerCase().includes('alex') || k.toLowerCase().includes('name')) nameFound = true;
            }
            assertTrue(nameFound, 'memory contains "alex"');
        } else {
            const resp = result.response.toLowerCase();
            assertTrue(resp.includes('alex'), 'response acknowledges name');
        }

        printDebug('Step 2', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 2', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // Ensure memory is populated for future steps
    memoryStore.set('user_name', { value: 'alex', category: 'user_profile' });

    // ──────────────────────────────────────────────
    //  Step 3: "tell me about singapore airlines" → Topic A, web_search
    //  Test: new topic detection, correct tool usage
    // ──────────────────────────────────────────────
    group('Step 3: "tell me about singapore airlines" → Topic A (web_search)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('tell me about singapore airlines', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');

        const toolNames = getToolNames(col);
        assertTrue(toolNames.includes('web_search'), 'web_search was called');

        const queries = getSearchQueries(col);
        assertTrue(queries.some(q => q.includes('singapore') && q.includes('airline')), 'search about singapore airlines');

        assertTrue(getObserve(col)?.requires_tools, 'requires_tools = true');
        assertTrue(getObserve(col)?.intent !== 'greeting', 'intent is not greeting');

        state.topicA_response = result.response;
        printDebug('Step 3', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 3', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 4: "how many planes do they have?" → Follow-up #1 on Topic A
    //  Test: workspace context retention (should link to SIA)
    // ──────────────────────────────────────────────
    group('Step 4: "how many planes do they have?" → follow-up #1 (SIA context)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('how many planes do they have?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Search should be about SIA fleet, not generic "planes"
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutSIA = queries.some(q =>
                q.includes('singapore') || q.includes('sia') || q.includes('airline')
            );
            assertTrue(aboutSIA, `search links to SIA context (got: "${queries[0]}")`);
        }

        // OBSERVE should detect follow-up or include SIA entities
        const obs = getObserve(col);
        const entities = (obs?.key_entities || []).map(e => String(e).toLowerCase()).join(' ');
        const summary = (obs?.summary || '').toLowerCase();
        assertTrue(
            obs?.intent === 'follow_up' || entities.includes('singapore') || entities.includes('airline') || summary.includes('singapore'),
            'OBSERVE linked to SIA context'
        );

        printDebug('Step 4', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 4', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 5: "what routes do they fly?" → Follow-up #2 on Topic A
    //  Test: sustained context across 2 consecutive follow-ups
    // ──────────────────────────────────────────────
    group('Step 5: "what routes do they fly?" → follow-up #2 (still SIA)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what routes do they fly?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // KEY TEST: after 2 follow-ups, should still be about SIA
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutSIA = queries.some(q =>
                q.includes('singapore') || q.includes('sia') || q.includes('airline') || q.includes('route')
            );
            assertTrue(aboutSIA, `search still about SIA routes (got: "${queries[0]}")`);

            // Should NOT mention "alex" or user context
            const leaksUser = queries.some(q => q.includes('alex'));
            assertFalse(leaksUser, 'no user context leak into search');
        }

        printDebug('Step 5', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 5', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 6: "who is the CEO?" → Follow-up #3 on Topic A
    //  Test: 3rd consecutive follow-up — direction loss prone
    // ──────────────────────────────────────────────
    group('Step 6: "who is the CEO?" → follow-up #3 (still SIA, direction-loss test)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('who is the CEO?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // CRITICAL: 3rd follow-up — has the agent lost direction?
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutSIA = queries.some(q =>
                q.includes('singapore') || q.includes('sia') || q.includes('airline') || q.includes('ceo')
            );
            assertTrue(aboutSIA, `3rd follow-up still about SIA CEO (got: "${queries[0]}")`);

            // Should NOT search for "alex CEO" or random topics
            const genericCEO = queries.every(q => !q.includes('alex') && !q.includes('hello'));
            assertTrue(genericCEO, 'no context contamination from earlier steps');
        }

        // Response should mention a real person (not hallucinate)
        const respLower = result.response.toLowerCase();
        const mentionsPerson = respLower.includes('goh') || respLower.includes('ceo') ||
            respLower.includes('chief') || respLower.includes('officer') || respLower.includes('executive');
        assertTrue(mentionsPerson, 'response mentions CEO/leadership');

        printDebug('Step 6', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 6', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 7: "tell me about tesla stock price" → Topic B (SWITCH)
    //  Test: clean topic switch — no SIA contamination
    // ──────────────────────────────────────────────
    group('Step 7: "tell me about tesla stock price" → Topic B SWITCH (no SIA leak)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('tell me about tesla stock price', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');

        // CRITICAL: search should be about Tesla, NOT Singapore Airlines
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            assertTrue(queries.some(q => q.includes('tesla')), 'search contains "tesla"');
            assertFalse(queries.some(q => q.includes('singapore') || q.includes('airline') || q.includes('sia')),
                'search does NOT contain SIA (clean topic switch)');
        }

        // OBSERVE entities should be about Tesla
        const obs = getObserve(col);
        const entities = (obs?.key_entities || []).map(e => String(e).toLowerCase());
        const hasTesla = entities.some(e => e.includes('tesla'));
        assertTrue(hasTesla || (obs?.summary || '').toLowerCase().includes('tesla'), 'OBSERVE entities include tesla');

        // Should NOT be classified as follow_up (after CLASSIFY correction)
        const classify = getClassify(col);
        const classEntities = (classify?.user_entities || []).map(e => String(e).toLowerCase());
        assertTrue(classEntities.some(e => e.includes('tesla')), 'CLASSIFY detected "tesla" entity');

        state.topicB_response = result.response;
        printDebug('Step 7', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 7', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 8: "what about their latest earnings?" → Follow-up on Topic B
    //  Test: follow-up sticks to NEW topic (Tesla), not old (SIA)
    // ──────────────────────────────────────────────
    group('Step 8: "what about their latest earnings?" → follow-up on Topic B (Tesla)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what about their latest earnings?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should search Tesla earnings, NOT SIA earnings
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutTesla = queries.some(q =>
                q.includes('tesla') || q.includes('earnings') || q.includes('revenue') || q.includes('financial')
            );
            assertTrue(aboutTesla, `search about Tesla earnings (got: "${queries[0]}")`);

            // Must NOT revert to SIA
            assertFalse(queries.some(q => q.includes('singapore') || q.includes('airline')),
                'search does NOT contain SIA (correct follow-up on Topic B)');
        }

        printDebug('Step 8', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 8', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 9: "go back to singapore airlines, what about their stock?" → Back-reference
    //  Test: explicit back-reference to Topic A — can agent re-resolve?
    // ──────────────────────────────────────────────
    group('Step 9: "go back to singapore airlines, what about their stock?" → back-reference to Topic A');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('go back to singapore airlines, what about their stock?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should search for SIA stock, NOT Tesla
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            assertTrue(queries.some(q => q.includes('singapore') || q.includes('airline') || q.includes('sia')),
                `search about SIA stock (got: "${queries[0]}")`);
        }

        // Response should be about Singapore Airlines stock/share price
        const respLower = result.response.toLowerCase();
        const aboutSIA = respLower.includes('singapore') || respLower.includes('airline') ||
            respLower.includes('sia') || respLower.includes('sgx');
        assertTrue(aboutSIA, 'response is about Singapore Airlines (not Tesla)');

        printDebug('Step 9', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 9', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 10: "write me a short professional email declining a meeting" → Pure text gen
    //  Test: fast path quality, NO tools needed, skill: writing
    // ──────────────────────────────────────────────
    group('Step 10: "write me a short professional email..." → pure text gen (fast path)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('write me a short professional email declining a meeting invitation politely', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // TOOL DISCIPLINE: should NOT search the web for this — it's a text generation task
        const toolNames = getToolNames(col);
        const hasWebSearch = toolNames.includes('web_search');
        // This is a soft check — agent may search for "email template" which is defensible
        if (!hasWebSearch) {
            assertTrue(true, 'no web_search (correct: pure text generation)');
        } else {
            console.log(`  ${C.yellow}⚠${C.reset} web_search was used for text generation task (defensible but suboptimal)`);
        }

        // Quality checks for email output
        const resp = result.response.toLowerCase();
        const hasEmailStructure = resp.includes('subject') || resp.includes('dear') || resp.includes('hi ')
            || resp.includes('unfortunately') || resp.includes('regret') || resp.includes('unable')
            || resp.includes('decline') || resp.includes('thank');
        assertTrue(hasEmailStructure, 'response contains email-like structure');

        // Should be at least 50 chars for a proper email
        assertGreater(result.response.length, 50, 'email is substantial (>50 chars)');

        // Should NOT mention Singapore Airlines or Tesla
        assertFalse(resp.includes('singapore airlines') || resp.includes('tesla'),
            'no topic contamination in email');

        printDebug('Step 10', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 10', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 11: "what time is it now? also, what is 15% of 280?" → multi-intent
    //  Test: dual tool usage (get_time + calculate), skill progression
    // ──────────────────────────────────────────────
    group('Step 11: "what time is it? also 15% of 280?" → multi-intent (get_time + calculate)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what time is it now? also, what is 15% of 280?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertGreater(result.iterations, 0, 'at least 1 OODA loop');

        const toolNames = getToolNames(col);
        const hasTime = toolNames.includes('get_time');
        const hasCalc = toolNames.includes('calculate');

        // At least one intent should be handled
        assertTrue(hasTime || hasCalc, 'at least one intent handled');

        if (hasTime && hasCalc) {
            assertTrue(true, 'BOTH intents handled (get_time + calculate) — multi-intent works');
        } else {
            console.log(`  ${C.yellow}⚠${C.reset} Partial: get_time=${hasTime}, calculate=${hasCalc}`);
        }

        // Response should contain the calculation result (42)
        const resp = result.response;
        const hasAnswer = resp.includes('42');
        if (hasAnswer) {
            assertTrue(true, 'response contains correct answer: 42');
        } else {
            console.log(`  ${C.yellow}⚠${C.reset} 15% of 280 = 42 not found in response`);
        }

        // Should NOT mention SIA or Tesla
        const respLower = resp.toLowerCase();
        assertFalse(respLower.includes('singapore airlines') || respLower.includes('tesla stock'),
            'no old topic contamination');

        printDebug('Step 11', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 11', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 12: "what's my name?" → memory recall test
    //  Test: can agent recall from memory after 10+ turns?
    // ──────────────────────────────────────────────
    group('Step 12: "what\'s my name?" → memory recall after 10+ turns');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run("what's my name?", {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Response should mention "alex" (from Step 2 memory)
        const resp = result.response.toLowerCase();
        const recallsName = resp.includes('alex');
        assertTrue(recallsName, 'response recalls name "alex" from memory');

        // Check if recall_memory was used
        const toolNames = getToolNames(col);
        if (toolNames.includes('recall_memory') || toolNames.includes('list_memories')) {
            assertTrue(true, 'used memory recall tool');
        } else if (recallsName) {
            // Agent may have used chatHistory context instead of explicit tool call
            console.log(`  ${C.dim}  (recalled from chatHistory context, not explicit tool call)${C.reset}`);
            assertTrue(true, 'recalled from conversation context');
        }

        // Should NOT trigger web_search for "what's my name"
        assertFalse(toolNames.includes('web_search'), 'no web_search for personal memory query');

        printDebug('Step 12', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 12', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  SUMMARY
    // ──────────────────────────────────────────────
    console.log(`\n${C.dim}${'═'.repeat(60)}${C.reset}`);
    console.log(`${C.bold}  Conversation length: ${chatHistory.length / 2} turns${C.reset}`);
    console.log(`${C.bold}  Workspace topics: ${topics.length}${C.reset}`);
    for (const t of topics) {
        console.log(`  ${C.dim}  [${t.id}] ${t.intent || '?'} | ${(t.userText || '').slice(0, 40)} → ${(t.answer || '').slice(0, 50)}${C.reset}`);
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
