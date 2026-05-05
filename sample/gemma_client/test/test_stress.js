#!/usr/bin/env node
// ============================================================
//  test/test_stress.js — Capability Boundary Stress Test
//  15-turn conversation testing 13 untested capability gaps:
//    1. Greeting (baseline)
//    2. Memory save
//    3. Ambiguous query (single word)
//    4. User correction / repair
//    5. Follow-up on corrected topic
//    6. Memory update (name change)
//    7. Language switch (Chinese)
//    8. Negation constraint ("but NOT X")
//    9. Unanswerable / hallucination stress
//   10. Memory recall after update
//   11. Minimal input (single word)
//   12. Acknowledgment guard
//   13. Back-reference to earlier topic
//   14. Conditional / chained reasoning
//   15. Memory deletion / negative operation
//
//  Run: node test/test_stress.js
//       node test/run_all.js --stress
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

const TIMEOUT = 120000; // 120s per test

async function withTimeout(fn, ms) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
    ]);
}

// ===== Phase collector =====
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

// ===== Full API setup with all tools + memory =====
function setupFullAPI() {
    const keys = loadKeys(new URL('../gemma_code.jsonl', import.meta.url).pathname);
    if (keys.length === 0) throw new Error('No API keys found');

    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const k of keys) keyManager.addKey(k);

    const api = new GemmaAPI({ keyManager, model: 'gemma-3-27b-it' });
    const registry = new ToolRegistry();
    registerTestTools(registry);

    // Memory tools
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

    // Weather tool (for conditional test)
    registry.add({
        name: 'get_weather', description: 'Get current weather for a city.',
        parameters: { city: { type: 'string', required: true } },
        handler: async (args) => {
            const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1`);
            const geoData = await geo.json();
            if (!geoData.results?.length) throw new Error('City not found: ' + args.city);
            const { latitude, longitude, name } = geoData.results[0];
            const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m`);
            const wxData = await wx.json();
            const cur = wxData.current;
            return { city: name, temperature: cur.temperature_2m, unit: '°C', weather_code: cur.weather_code, wind_speed: cur.wind_speed_10m, humidity: cur.relative_humidity_2m };
        }
    });

    const runner = new OODAERunner(api, registry, { maxLoops: 3 });

    // In-memory workspace
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
            console.log(`  ${C.cyan}OBSERVE${C.reset} intent=${d?.intent} tools=${d?.requires_tools} entities=[${(d?.key_entities||[]).join(',')}] about_user=${d?.is_about_user}`);
        } else if (p.phase === PHASE.CLASSIFY) {
            const flags = [
                d?.is_greeting ? 'greeting' : null,
                d?.is_command ? 'command' : null,
                d?.is_acknowledgment ? 'ack' : null,
                d?.is_task_request ? 'task_req' : null,
                d?.is_reference ? 'reference' : null,
                d?.is_info_sharing ? 'info_share' : null,
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
    console.log(`  ${C.dim}Response (${(result.response||'').length} chars): ${(result.response||'').slice(0, 150)}${C.reset}`);
}

// ===== Helpers =====
function getObserve(col) { return col.phases.find(p => p.phase === PHASE.OBSERVE)?.data; }
function getClassify(col) { return col.phases.find(p => p.phase === PHASE.CLASSIFY)?.data; }
function getToolNames(col) { return col.tools.map(t => t.name); }
function getSearchQueries(col) { return col.tools.filter(t => t.name === 'web_search').map(t => (t.arguments?.query || '').toLowerCase()); }

// ===== Hallucination detector =====
function detectHallucinations(result, collector) {
    const issues = [];

    // URL hallucination
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
            if (searchUrls.size > 0 && !searchUrls.has(url)) {
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

    // "no info" despite having results
    const actData = collector.phases.filter(p => p.phase === PHASE.ACT);
    for (const act of actData) {
        if (!Array.isArray(act.data)) continue;
        for (const r of act.data) {
            if (r.name === 'web_search' && r.result?.results?.length > 0) {
                const snippets = r.result.results.map(s => s.snippet).join(' ').toLowerCase();
                const resp = (result.response || '').toLowerCase();
                if (resp.includes('no information') || resp.includes('could not find') || resp.includes('unable to find')) {
                    if (snippets.length > 50) {
                        issues.push(`Snippet miss: response says "no info" but search returned ${r.result.results.length} results`);
                    }
                }
            }
        }
    }

    return issues;
}

// ============================================================
//  STRESS TEST: 15-turn capability boundary conversation
// ============================================================
export async function run() {
    resetResults();
    console.log('\n📦 test_stress.js');
    console.log(`${C.dim}  Capability Boundary Stress Test: 15 steps${C.reset}`);
    console.log(`${C.dim}  Tests: ambiguity, correction, memory update, language switch,${C.reset}`);
    console.log(`${C.dim}         negation, hallucination, minimal input, conditional, deletion${C.reset}\n`);

    let setup;
    try {
        setup = setupFullAPI();
        console.log(`${C.green}✓ Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}✗ Setup failed: ${err.message}${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner, memoryStore, memoryDB, topics } = setup;
    const chatHistory = []; // shared across ALL steps

    // ──────────────────────────────────────────────
    //  Step 1: "hi" → greeting, fast path (baseline)
    //  Gap tested: (none — baseline for conversation start)
    // ──────────────────────────────────────────────
    group('Step 1: "hi" → greeting baseline (0 tools)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('hi', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertEqual(result.iterations, 0, 'zero iterations (fast path)');
        assertEqual(result.toolCalls.length, 0, 'zero tool calls');

        const obs = getObserve(col);
        assertEqual(obs?.intent, 'greeting', 'OBSERVE intent = greeting');
        assertFalse(obs?.requires_tools, 'requires_tools = false');

        printDebug('Step 1', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 1', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 2: "my name is Sarah" → memory save
    //  Gap tested: Memory save (baseline for later update/recall)
    // ──────────────────────────────────────────────
    group('Step 2: "my name is Sarah" → save_memory');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('my name is Sarah', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        const obs = getObserve(col);
        assertTrue(obs?.is_about_user, 'OBSERVE is_about_user = true');

        const toolNames = getToolNames(col);
        assertFalse(toolNames.includes('web_search'), 'no web_search for self-intro');

        // Check if save_memory was called or response acknowledges name
        const savedTools = col.tools.filter(t => t.name === 'save_memory');
        if (savedTools.length > 0) {
            assertTrue(true, 'save_memory was called');
        } else {
            const resp = result.response.toLowerCase();
            assertTrue(resp.includes('sarah'), 'response acknowledges name');
        }

        printDebug('Step 2', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 2', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // Ensure memory is populated for downstream tests
    memoryStore.set('user_name', { value: 'Sarah', category: 'user_profile' });

    // ──────────────────────────────────────────────
    //  Step 3: "Apple" → ambiguous single-word query
    //  Gap tested: AMBIGUITY — does OBSERVE/DECIDE handle minimal context?
    //  Expected: web_search (not ask for clarification — weak models won't)
    // ──────────────────────────────────────────────
    group('Step 3: "Apple" → ambiguous single-word query');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('Apple', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Key test: agent should do SOMETHING — either search or provide info
        // It should NOT crash or return empty
        const obs = getObserve(col);
        assertTrue(obs !== undefined, 'OBSERVE phase completed');

        // Check entities — should extract "Apple"
        const entities = (obs?.key_entities || []).map(e => String(e).toLowerCase());
        assertTrue(
            entities.some(e => e.includes('apple')) || (obs?.summary || '').toLowerCase().includes('apple'),
            'OBSERVE extracted "Apple" entity'
        );

        // Response should relate to Apple (company or fruit)
        const resp = result.response.toLowerCase();
        assertTrue(
            resp.includes('apple') || resp.includes('iphone') || resp.includes('fruit') || resp.includes('company') || resp.includes('tech'),
            'response is about Apple (not hallucinated topic)'
        );

        printDebug('Step 3', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 3', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 4: "I mean Apple the company, tell me about them" → correction / repair
    //  Gap tested: CORRECTION — can the agent pivot when user corrects?
    //  Expected: web_search for Apple Inc, not fruit
    // ──────────────────────────────────────────────
    group('Step 4: "I mean Apple the company" → user correction / repair');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('I mean Apple the company, tell me about them', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should search for Apple the tech company
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutAppleCompany = queries.some(q =>
                q.includes('apple') && (q.includes('company') || q.includes('inc') || q.includes('tech'))
            );
            assertTrue(aboutAppleCompany, `search is about Apple company (got: "${queries[0]}")`);
        }

        // Response should be about the tech company
        const resp = result.response.toLowerCase();
        const companySignals = ['iphone', 'mac', 'ios', 'tim cook', 'cupertino', 'silicon', 'technology', 'stock', 'revenue', 'trillion', 'steve jobs'];
        const hasCompanyContent = companySignals.some(s => resp.includes(s));
        assertTrue(hasCompanyContent, 'response is about Apple Inc (tech company signals present)');

        // Hallucination check
        const hallucinations = detectHallucinations(result, col);
        assertEqual(hallucinations.length, 0, `no hallucinations detected (${hallucinations.join('; ')})`);

        printDebug('Step 4', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 4', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 5: "who is the CEO?" → follow-up on corrected topic
    //  Gap tested: FOLLOW-UP AFTER CORRECTION — workspace should track Apple Inc
    //  Expected: web_search for Apple CEO (Tim Cook), NOT generic CEO query
    // ──────────────────────────────────────────────
    group('Step 5: "who is the CEO?" → follow-up on Apple (corrected topic)');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('who is the CEO?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Key test: search should be linked to Apple, not generic
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutApple = queries.some(q => q.includes('apple') || q.includes('ceo'));
            assertTrue(aboutApple, `search links to Apple context (got: "${queries[0]}")`);
        }

        // Response should mention Tim Cook
        const resp = result.response.toLowerCase();
        assertTrue(
            resp.includes('tim cook') || resp.includes('cook'),
            'response mentions Tim Cook (Apple CEO)'
        );

        // OBSERVE/CLASSIFY should detect follow-up or reference
        const obs = getObserve(col);
        const cls = getClassify(col);
        assertTrue(
            obs?.intent === 'follow_up' || cls?.is_reference === true,
            'detected as follow-up or reference'
        );

        printDebug('Step 5', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 5', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 6: "actually my name is Sara, not Sarah" → memory UPDATE
    //  Gap tested: MEMORY CORRECTION — should update, not create duplicate
    //  Expected: save_memory with updated name, old entry overwritten
    // ──────────────────────────────────────────────
    group('Step 6: "actually my name is Sara, not Sarah" → memory update');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('actually my name is Sara, not Sarah', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        const obs = getObserve(col);
        assertTrue(obs?.is_about_user, 'OBSERVE is_about_user = true');

        // CLASSIFY should detect this as a command/memory action
        const cls = getClassify(col);
        if (cls?.memory_action) {
            assertEqual(cls.memory_action, 'save', 'memory_action = save (update)');
        }

        // Check if save_memory was called
        const savedTools = col.tools.filter(t => t.name === 'save_memory');
        if (savedTools.length > 0) {
            assertTrue(true, 'save_memory was called for update');

            // The saved value should contain "Sara" (corrected name)
            const saveArgs = savedTools[0].arguments || {};
            const savedValue = (saveArgs.value || '').toLowerCase();
            assertTrue(
                savedValue.includes('sara'),
                `saved value contains "Sara" (got: "${saveArgs.value}")`
            );
        }

        // Response should acknowledge the correction
        const resp = result.response.toLowerCase();
        assertTrue(resp.includes('sara'), 'response acknowledges corrected name "Sara"');

        // Simulate the update for downstream steps
        // (In case the model used a different key)
        memoryStore.set('user_name', { value: 'Sara', category: 'user_profile' });

        printDebug('Step 6', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 6', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 7: "新加坡天气怎么样？" → language switch (Chinese)
    //  Gap tested: LANGUAGE SWITCHING — detect Chinese, respond in Chinese
    //  Expected: get_weather(Singapore), response in Chinese
    // ──────────────────────────────────────────────
    group('Step 7: "新加坡天气怎么样？" → language switch to Chinese');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('新加坡天气怎么样？', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should use get_weather or web_search for Singapore weather
        const toolNames = getToolNames(col);
        assertTrue(
            toolNames.includes('get_weather') || toolNames.includes('web_search'),
            'used weather or search tool'
        );

        // If get_weather was called, check city
        const weatherCalls = col.tools.filter(t => t.name === 'get_weather');
        if (weatherCalls.length > 0) {
            const city = (weatherCalls[0].arguments?.city || '').toLowerCase();
            assertTrue(
                city.includes('singapore') || city.includes('新加坡'),
                `weather query for Singapore (got: "${city}")`
            );
        }

        // Language detection: ORIENT should detect Chinese
        const orient = col.phases.find(p => p.phase === PHASE.ORIENT)?.data;
        if (orient?.language) {
            const lang = orient.language.toLowerCase();
            assertTrue(
                lang.includes('zh') || lang.includes('chinese') || lang.includes('中文') || lang.includes('mandarin'),
                `detected Chinese language (got: "${orient.language}")`
            );
        }

        // Response should contain Chinese characters (weather info in Chinese)
        const hasChinese = /[\u4e00-\u9fff]/.test(result.response);
        assertTrue(hasChinese, 'response contains Chinese characters');

        printDebug('Step 7', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 7', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 8: "tell me about electric cars but NOT Tesla" → negation constraint
    //  Gap tested: NEGATION — can the agent respect "NOT X" exclusions?
    //  Expected: web_search for electric cars, response should not focus on Tesla
    // ──────────────────────────────────────────────
    group('Step 8: "tell me about electric cars but NOT Tesla" → negation constraint');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('tell me about electric cars but NOT Tesla', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should have searched for electric cars
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            assertTrue(
                queries.some(q => q.includes('electric') || q.includes('ev') || q.includes('car')),
                `searched for electric cars (got: "${queries[0]}")`
            );
        }

        // Key negation test: response should mention OTHER EV brands
        const resp = result.response.toLowerCase();
        const otherBrands = ['byd', 'rivian', 'lucid', 'hyundai', 'kia', 'bmw', 'mercedes', 'ford', 'volkswagen', 'nio', 'polestar', 'chevrolet', 'gm', 'toyota'];
        const mentionsOtherBrand = otherBrands.some(b => resp.includes(b));
        assertTrue(mentionsOtherBrand, 'response mentions non-Tesla EV brands');

        // Soft check: Tesla should NOT be the primary focus
        // (It's OK to mention Tesla briefly in context, but shouldn't be the main topic)
        const teslaCount = (resp.match(/tesla/gi) || []).length;
        const totalLength = resp.length;
        // If Tesla appears more than once per 200 chars, it's too Tesla-focused
        const teslaRatio = teslaCount / (totalLength / 200);
        assertTrue(
            teslaRatio < 2 || teslaCount <= 2,
            `Tesla not over-represented (${teslaCount} mentions in ${totalLength} chars)`
        );

        printDebug('Step 8', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 8', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 9: "what will bitcoin be worth next year?" → unanswerable / hallucination stress
    //  Gap tested: HALLUCINATION RESISTANCE — future prediction is unknowable
    //  Expected: hedged response, no confident specific price prediction
    // ──────────────────────────────────────────────
    group('Step 9: "what will bitcoin be worth next year?" → unanswerable query');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('what will bitcoin be worth next year?', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // The agent may search for bitcoin price/predictions — that's fine
        // Key test: response should NOT state a confident specific price
        const resp = result.response.toLowerCase();

        // Should have hedging language
        const hedgingSignals = [
            'predict', 'forecast', 'uncertain', 'difficult', 'impossible',
            'no one', 'cannot', 'speculation', 'volatile', 'risk',
            'may', 'might', 'could', 'estimate', 'analyst',
            '预测', '不确定', '难以', '可能', '波动',  // Chinese hedging (in case lang stuck)
        ];
        const hasHedging = hedgingSignals.some(s => resp.includes(s));
        assertTrue(hasHedging, 'response includes hedging/uncertainty language');

        // Should NOT have a confident "Bitcoin WILL be $X" without hedging
        const confidentPrediction = /bitcoin (will|is going to) (be|reach|hit) \$[\d,]+(?! .*(may|might|could|predict|estimate|analyst))/i;
        assertFalse(
            confidentPrediction.test(result.response),
            'no confident specific price prediction without hedging'
        );

        printDebug('Step 9', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 9', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 10: "what's my name?" → memory recall AFTER update
    //  Gap tested: MEMORY RECALL AFTER UPDATE — should return "Sara" not "Sarah"
    //  Expected: response mentions "Sara" (the corrected name)
    // ──────────────────────────────────────────────
    group('Step 10: "what\'s my name?" → memory recall after correction');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run("what's my name?", {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Key test: should say "Sara" (updated), not "Sarah" (original)
        const resp = result.response;
        const respLower = resp.toLowerCase();
        assertTrue(respLower.includes('sara'), 'response contains "Sara"');

        // Soft check: if "Sarah" appears, it should be in correction context, not as the current name
        // This is a known-hard test for weak models
        if (respLower.includes('sarah') && !respLower.includes('sara,') && !respLower.includes('sara.') && !respLower.includes('sara!') && !respLower.includes('sara ')) {
            // "Sarah" appears without "Sara" nearby — potential stale memory
            console.log(`  ${C.yellow}⚠ WARNING: response mentions "Sarah" — may be using stale memory${C.reset}`);
        }

        printDebug('Step 10', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 10', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 11: "weather" → minimal single-word input
    //  Gap tested: MINIMAL INPUT — can OBSERVE extract intent from 1 word?
    //  Expected: either ask for location, use last location (Singapore), or detect from context
    // ──────────────────────────────────────────────
    group('Step 11: "weather" → minimal single-word input');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('weather', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Agent should do something reasonable:
        // Option A: use weather tool (with inferred or default location)
        // Option B: ask for location
        // Option C: provide general weather info
        const obs = getObserve(col);
        assertTrue(obs !== undefined, 'OBSERVE phase completed');

        const toolNames = getToolNames(col);
        const resp = result.response.toLowerCase();

        if (toolNames.includes('get_weather') || toolNames.includes('web_search')) {
            assertTrue(true, 'agent used a tool for weather query');
        } else {
            // If no tools, response should ask for location or give weather info
            assertTrue(
                resp.includes('where') || resp.includes('location') || resp.includes('city') ||
                resp.includes('weather') || resp.includes('哪') || resp.includes('天气'),
                'response addresses weather topic (asks location or provides info)'
            );
        }

        printDebug('Step 11', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 11', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 12: "thanks" → acknowledgment guard
    //  Gap tested: ACKNOWLEDGMENT — no tools, no profile leak, short response
    // ──────────────────────────────────────────────
    group('Step 12: "thanks" → acknowledgment guard');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run('thanks', {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');
        assertEqual(result.toolCalls.length, 0, 'zero tool calls');
        assertEqual(result.iterations, 0, 'zero iterations (fast path)');

        // CLASSIFY should detect acknowledgment
        const cls = getClassify(col);
        assertTrue(cls?.is_acknowledgment === true, 'CLASSIFY is_acknowledgment = true');

        // Response should be short and polite, NOT leak user profile
        const resp = result.response.toLowerCase();
        assertFalse(
            resp.includes('apple') || resp.includes('bitcoin') || resp.includes('electric car'),
            'no topic leakage in acknowledgment response'
        );

        // Response should be concise (acknowledgment doesn't need 500 chars)
        assertTrue(result.response.length < 500, `response is concise (${result.response.length} chars)`);

        printDebug('Step 12', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 12', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 13: "go back to Apple, what's their revenue?" → back-reference
    //  Gap tested: BACK-REFERENCE — jump back to Apple after 8 turns of other topics
    //  Expected: web_search for Apple revenue, NOT electric cars or bitcoin
    // ──────────────────────────────────────────────
    group('Step 13: "go back to Apple, what\'s their revenue?" → back-reference');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run("go back to Apple, what's their revenue?", {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Should search for Apple revenue
        const queries = getSearchQueries(col);
        if (queries.length > 0) {
            const aboutApple = queries.some(q => q.includes('apple') && (q.includes('revenue') || q.includes('earnings') || q.includes('financial')));
            assertTrue(aboutApple, `search is about Apple revenue (got: "${queries[0]}")`);
        }

        // Response should be about Apple's financials
        const resp = result.response.toLowerCase();
        const revenueSignals = ['revenue', 'billion', 'trillion', 'earning', 'financial', 'quarter', 'fiscal', 'income', 'profit', 'sales', '收入', '营收'];
        const hasRevenue = revenueSignals.some(s => resp.includes(s));
        assertTrue(hasRevenue, 'response discusses Apple revenue/financials');

        // Should NOT be about electric cars, bitcoin, weather (recent topics)
        const noContamination = !resp.includes('bitcoin') && !resp.includes('electric car') && !resp.includes('weather');
        assertTrue(noContamination, 'no contamination from recent topics');

        // OBSERVE should detect this as a back-reference or follow-up
        const obs = getObserve(col);
        const cls = getClassify(col);
        assertTrue(
            obs?.intent === 'follow_up' || cls?.is_reference === true ||
            (obs?.key_entities || []).some(e => String(e).toLowerCase().includes('apple')),
            'detected Apple back-reference'
        );

        printDebug('Step 13', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 13', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 14: "what's the weather in Tokyo? if it's cold, suggest warm food" → conditional
    //  Gap tested: CONDITIONAL REASONING — chained tool use + conditional response
    //  Expected: get_weather(Tokyo), then conditional food suggestion
    // ──────────────────────────────────────────────
    group('Step 14: "weather in Tokyo? if cold, suggest warm food" → conditional reasoning');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run("what's the weather in Tokyo? if it's cold, suggest warm food", {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // Must have used weather tool
        const toolNames = getToolNames(col);
        assertTrue(
            toolNames.includes('get_weather') || toolNames.includes('web_search'),
            'used weather or search tool for Tokyo'
        );

        // Check weather tool was for Tokyo
        const weatherCalls = col.tools.filter(t => t.name === 'get_weather');
        if (weatherCalls.length > 0) {
            const city = (weatherCalls[0].arguments?.city || '').toLowerCase();
            assertTrue(city.includes('tokyo') || city.includes('東京'), `weather for Tokyo (got: "${city}")`);
        }

        // Response should mention temperature AND food conditionally
        const resp = result.response.toLowerCase();
        assertTrue(
            resp.includes('tokyo') || resp.includes('東京') || resp.includes('东京'),
            'response mentions Tokyo'
        );

        // The conditional part: if temperature data is available, should address food
        // This is the hardest part — weak models may ignore the conditional
        const mentionsFood = resp.includes('food') || resp.includes('ramen') || resp.includes('soup') ||
                            resp.includes('hot') || resp.includes('warm') || resp.includes('nabe') ||
                            resp.includes('udon') || resp.includes('料理') || resp.includes('食');
        const mentionsTemp = resp.includes('°') || resp.includes('degree') || resp.includes('temperature') ||
                            resp.includes('cold') || resp.includes('cool') || resp.includes('warm') ||
                            resp.includes('温度') || resp.includes('度');
        assertTrue(mentionsTemp, 'response includes temperature information');

        // Soft check for conditional handling
        if (mentionsFood) {
            console.log(`  ${C.green}✓ BONUS: agent handled conditional (food suggestion present)${C.reset}`);
        } else {
            console.log(`  ${C.yellow}⚠ Agent provided weather but did not address food conditional${C.reset}`);
        }

        printDebug('Step 14', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 14', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Step 15: "forget my name, I don't want you to remember it" → memory deletion
    //  Gap tested: MEMORY DELETION — negative operation (remove saved data)
    //  Expected: agent attempts to handle deletion (even if no delete_memory tool)
    // ──────────────────────────────────────────────
    group('Step 15: "forget my name" → memory deletion / negative operation');
    try {
        const t = timer();
        const col = phaseCollector();
        const result = await withTimeout(() => runner.run("forget my name, I don't want you to remember it", {
            chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
        }), TIMEOUT);
        console.log(`${C.dim}  ${t()}${C.reset}`);

        assertTrue(result.response.length > 0, 'response is non-empty');

        // OBSERVE/CLASSIFY should detect this as a command about user data
        const obs = getObserve(col);
        assertTrue(obs?.is_about_user === true, 'OBSERVE is_about_user = true (about user data)');

        const cls = getClassify(col);
        assertTrue(
            cls?.is_command === true || cls?.memory_action !== undefined,
            'CLASSIFY detects command or memory action'
        );

        // Response should acknowledge the request
        const resp = result.response.toLowerCase();
        const ackSignals = [
            'forget', 'forgot', 'removed', 'deleted', 'cleared', 'done', 'ok',
            'understood', 'noted', 'will not', "won't", 'no longer',
            '忘记', '删除', '好的', '了解', '不会',
        ];
        const acknowledges = ackSignals.some(s => resp.includes(s));
        assertTrue(acknowledges, 'response acknowledges deletion request');

        // Should NOT search the web for "forget my name"
        const toolNames = getToolNames(col);
        assertFalse(toolNames.includes('web_search'), 'no web_search for memory deletion request');

        printDebug('Step 15', result, col);
    } catch (err) {
        results.total++; results.failed++;
        results.errors.push({ label: 'Step 15', detail: err.message });
        console.log(`  ${C.red}✗ Error: ${err.message}${C.reset}`);
    }

    // ──────────────────────────────────────────────
    //  Summary
    // ──────────────────────────────────────────────
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`${C.bold}Capability Gap Coverage:${C.reset}`);
    console.log(`  1. Greeting baseline           → Step 1`);
    console.log(`  2. Memory save                 → Step 2`);
    console.log(`  3. Ambiguous query             → Step 3`);
    console.log(`  4. User correction / repair    → Step 4`);
    console.log(`  5. Follow-up after correction  → Step 5`);
    console.log(`  6. Memory update (name change) → Step 6`);
    console.log(`  7. Language switch (Chinese)    → Step 7`);
    console.log(`  8. Negation constraint          → Step 8`);
    console.log(`  9. Unanswerable / hallucination → Step 9`);
    console.log(`  10. Memory recall after update  → Step 10`);
    console.log(`  11. Minimal input (1 word)      → Step 11`);
    console.log(`  12. Acknowledgment guard         → Step 12`);
    console.log(`  13. Back-reference (8 turns)     → Step 13`);
    console.log(`  14. Conditional reasoning        → Step 14`);
    console.log(`  15. Memory deletion              → Step 15`);
    console.log(`${'─'.repeat(50)}`);

    return summarize();
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
    run().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
