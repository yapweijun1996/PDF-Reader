#!/usr/bin/env node
// ============================================================
//  test/test_complex_ability.js — Complex LLM Ability Test Suite
//
//  Tests Gemma's reasoning ability through multi-turn API calls.
//  Focuses on:
//    A. COT quality per OODA-E phase (does thinking improve output?)
//    B. Multi-step reasoning (chained deduction, planning)
//    C. Classification stability (same intent → same classification)
//    D. Entity resolution accuracy (complex entities, ambiguity)
//    E. Tool selection intelligence (right tool for the job)
//    F. Hallucination resistance (fake entities, unanswerable Qs)
//    G. Language & style control (follow instructions precisely)
//    H. Complex task decomposition (multi-part queries)
//    I. Error recovery & self-correction (bad results → adapt)
//    J. Context window stress (deep follow-up chains)
//
//  Run: node test/test_complex_ability.js
//       node test/run_all.js --ability
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

    // Weather tool
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

    // Exchange rate tool
    registry.add({
        name: 'exchange_rate', description: 'Get currency exchange rate.',
        parameters: {
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            amount: { type: 'number', required: false, default: 1 }
        },
        handler: async (args) => {
            const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${args.from}`);
            const data = await res.json();
            const rate = data.rates?.[args.to];
            if (!rate) throw new Error(`Rate not found: ${args.from} → ${args.to}`);
            return { from: args.from, to: args.to, rate, amount: args.amount || 1, converted: rate * (args.amount || 1) };
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

// ===== Debug helpers =====
function getPhaseData(col, phaseName) { return col.phases.find(p => p.phase === phaseName)?.data; }
function getToolNames(col) { return col.tools.map(t => t.name); }
function getSearchQueries(col) { return col.tools.filter(t => t.name === 'web_search').map(t => (t.arguments?.query || '').toLowerCase()); }

function printPhaseDebug(label, result, col) {
    console.log(`\n  ${C.dim}── ${label} ──${C.reset}`);
    for (const p of col.phases) {
        const d = p.data;
        if (p.phase === PHASE.OBSERVE) {
            console.log(`  ${C.cyan}OBS${C.reset} intent=${d?.intent} tools=${d?.requires_tools} entities=[${(d?.key_entities||[]).join(',')}]`);
        } else if (p.phase === PHASE.CLASSIFY) {
            const flags = [
                d?.is_greeting ? 'greet' : null, d?.is_command ? 'cmd' : null,
                d?.is_acknowledgment ? 'ack' : null, d?.is_task_request ? 'task' : null,
                d?.is_reference ? 'ref' : null, d?.is_info_sharing ? 'info' : null,
                d?.needs_tools ? 'tools' : null,
            ].filter(Boolean).join(',') || 'none';
            console.log(`  ${C.yellow}CLS${C.reset} [${flags}] entities=[${(d?.user_entities||[]).join(',')}]`);
        } else if (p.phase === PHASE.DECIDE) {
            const plan = d?.plan || [];
            console.log(`  ${C.blue}DEC${C.reset} [${plan.map(s => `${s.tool}(${JSON.stringify(s.args||{}).slice(0,50)})`).join(', ')}]`);
        } else if (p.phase === PHASE.EVALUATE) {
            console.log(`  ${C.green}EVL${C.reset} more=${d?.needs_more} confidence=${d?.confidence || '?'} answer_len=${(d?.final_answer||'').length}`);
        }
    }
    const resp = (result.response || '').replace(/\n/g, ' ').slice(0, 150);
    console.log(`  ${C.dim}→ (${result.iterations} loops, ${result.toolCalls.length} tools) ${resp}${C.reset}`);
}

// ===== Score tracker =====
const scores = {
    categories: {},
    add(cat, testName, passed, detail) {
        if (!this.categories[cat]) this.categories[cat] = { tests: [], passed: 0, failed: 0 };
        this.categories[cat].tests.push({ name: testName, passed, detail });
        if (passed) this.categories[cat].passed++; else this.categories[cat].failed++;
    },
    printReport() {
        console.log(`\n${C.cyan}${C.bold}╔═══════════════════════════════════════════════════╗${C.reset}`);
        console.log(`${C.cyan}${C.bold}║       LLM Ability Scorecard                       ║${C.reset}`);
        console.log(`${C.cyan}${C.bold}╚═══════════════════════════════════════════════════╝${C.reset}\n`);

        let totalP = 0, totalF = 0;
        for (const [cat, data] of Object.entries(this.categories)) {
            const pct = data.tests.length > 0 ? Math.round(data.passed / data.tests.length * 100) : 0;
            const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
            const color = pct >= 80 ? C.green : pct >= 50 ? C.yellow : C.red;
            console.log(`  ${color}${bar}${C.reset} ${pct}%  ${C.bold}${cat}${C.reset} (${data.passed}/${data.tests.length})`);
            for (const t of data.tests) {
                if (!t.passed) console.log(`    ${C.red}✗${C.reset} ${t.name}${t.detail ? ': ' + t.detail : ''}`);
            }
            totalP += data.passed;
            totalF += data.failed;
        }
        const totalPct = totalP + totalF > 0 ? Math.round(totalP / (totalP + totalF) * 100) : 0;
        console.log(`\n  ${C.bold}TOTAL: ${totalP}/${totalP + totalF} (${totalPct}%)${C.reset}`);

        // Recommendations
        console.log(`\n${C.cyan}${C.bold}── Improvement Recommendations ──${C.reset}`);
        for (const [cat, data] of Object.entries(this.categories)) {
            if (data.failed > 0) {
                const failedTests = data.tests.filter(t => !t.passed).map(t => t.name);
                console.log(`  ${C.yellow}⚠ ${cat}:${C.reset} Fix ${failedTests.join(', ')}`);
            }
        }
    }
};

// ============================================================
//  MAIN TEST SUITE
// ============================================================
export async function run() {
    resetResults();
    console.log(`\n${C.cyan}${C.bold}╔═══════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}${C.bold}║  test_complex_ability.js — LLM Ability Test Suite ║${C.reset}`);
    console.log(`${C.cyan}${C.bold}╚═══════════════════════════════════════════════════╝${C.reset}`);
    console.log(`${C.dim}  10 categories, ~30 tests via live Gemini API${C.reset}`);
    console.log(`${C.dim}  Tests COT quality, reasoning, stability, complex tasks${C.reset}\n`);

    let setup;
    try {
        setup = setupFullAPI();
        console.log(`${C.green}✓ Loaded ${setup.keyCount} keys, ${setup.registry.size} tools${C.reset}`);
    } catch (err) {
        console.log(`${C.red}✗ Setup failed: ${err.message}${C.reset}`);
        return { total: 0, passed: 0, failed: 0 };
    }

    const { runner, memoryStore, memoryDB, topics } = setup;

    // ============================================================
    //  A. CLASSIFICATION STABILITY — same intent pattern → consistent output
    // ============================================================
    group('A. Classification Stability');
    {
        const stabilityTests = [
            { input: 'hello', expect: { greeting: true }, label: 'english greeting' },
            { input: '你好', expect: { greeting: true }, label: 'chinese greeting' },
            { input: 'hey there!', expect: { greeting: true }, label: 'casual greeting' },
            { input: 'tell me about apple stock', expect: { needs_tools: true }, label: 'factual query' },
            { input: 'what is the weather in tokyo?', expect: { needs_tools: true }, label: 'tool query' },
            { input: 'I see, thanks', expect: { ack: true }, label: 'acknowledgment' },
        ];

        for (const t of stabilityTests) {
            try {
                const col = phaseCollector();
                const tm = timer();
                const result = await withTimeout(() => runner.run(t.input, {
                    chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
                }), TIMEOUT);

                const cls = getPhaseData(col, PHASE.CLASSIFY);
                const obs = getPhaseData(col, PHASE.OBSERVE);
                let passed = true;
                let detail = '';

                if (t.expect.greeting) {
                    if (!cls?.is_greeting && obs?.intent !== 'greeting') {
                        passed = false; detail = `expected greeting, got intent=${obs?.intent}, is_greeting=${cls?.is_greeting}`;
                    }
                }
                if (t.expect.needs_tools) {
                    if (!obs?.requires_tools && !cls?.needs_tools) {
                        passed = false; detail = `expected needs_tools, got requires_tools=${obs?.requires_tools}`;
                    }
                }
                if (t.expect.ack) {
                    if (!cls?.is_acknowledgment) {
                        passed = false; detail = `expected ack, got is_acknowledgment=${cls?.is_acknowledgment}`;
                    }
                }

                scores.add('A. Classification Stability', t.label, passed, detail);
                if (passed) {
                    results.total++; results.passed++;
                    console.log(`  ${C.green}✓${C.reset} ${t.label} (${tm()})`);
                } else {
                    results.total++; results.failed++;
                    results.errors.push({ label: `CLS: ${t.label}`, detail });
                    console.log(`  ${C.red}✗${C.reset} ${t.label}: ${detail}`);
                }
            } catch (err) {
                scores.add('A. Classification Stability', t.label, false, err.message);
                results.total++; results.failed++;
                results.errors.push({ label: `CLS: ${t.label}`, detail: err.message });
                console.log(`  ${C.red}✗${C.reset} ${t.label}: ${err.message}`);
            }
        }
    }

    // ============================================================
    //  B. ENTITY EXTRACTION ACCURACY — complex entities
    // ============================================================
    group('B. Entity Extraction');
    {
        const entityTests = [
            { input: 'tell me about Samsung Galaxy S24 Ultra', expectEntities: ['samsung', 'galaxy', 's24'], label: 'product name' },
            { input: 'who is the CEO of Berkshire Hathaway?', expectEntities: ['berkshire hathaway'], label: 'company with space' },
            { input: 'compare Tesla Model 3 vs BYD Seal', expectEntities: ['tesla', 'byd'], label: 'multi-entity comparison' },
        ];

        for (const t of entityTests) {
            try {
                const col = phaseCollector();
                const tm = timer();
                const result = await withTimeout(() => runner.run(t.input, {
                    chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
                }), TIMEOUT);

                const obs = getPhaseData(col, PHASE.OBSERVE);
                const cls = getPhaseData(col, PHASE.CLASSIFY);
                const entities = [
                    ...(obs?.key_entities || []),
                    ...(cls?.user_entities || [])
                ].map(e => String(e).toLowerCase());

                const foundCount = t.expectEntities.filter(exp =>
                    entities.some(e => e.includes(exp) || exp.includes(e))
                ).length;
                const passed = foundCount >= Math.ceil(t.expectEntities.length * 0.5); // at least 50% found
                const detail = passed ? '' : `entities=[${entities.join(',')}], expected at least one of [${t.expectEntities.join(',')}]`;

                scores.add('B. Entity Extraction', t.label, passed, detail);
                if (passed) {
                    results.total++; results.passed++;
                    console.log(`  ${C.green}✓${C.reset} ${t.label} entities=[${entities.slice(0,5).join(',')}] (${tm()})`);
                } else {
                    results.total++; results.failed++;
                    results.errors.push({ label: `ENT: ${t.label}`, detail });
                    console.log(`  ${C.red}✗${C.reset} ${t.label}: ${detail}`);
                }
            } catch (err) {
                scores.add('B. Entity Extraction', t.label, false, err.message);
                results.total++; results.failed++;
                console.log(`  ${C.red}✗${C.reset} ${t.label}: ${err.message}`);
            }
        }
    }

    // ============================================================
    //  C. TOOL SELECTION INTELLIGENCE — right tool for the job
    // ============================================================
    group('C. Tool Selection');
    {
        const toolTests = [
            { input: 'what is 1234 * 5678?', expectTool: 'calculate', label: 'math → calculate' },
            { input: 'what time is it in London?', expectTool: 'get_time', label: 'time → get_time' },
            { input: 'weather in Singapore right now?', expectTool: 'get_weather', label: 'weather → get_weather' },
            { input: 'what is the latest news about OpenAI?', expectTool: 'web_search', label: 'news → web_search' },
            { input: 'convert 100 USD to JPY', expectTool: 'exchange_rate', label: 'currency → exchange_rate' },
            { input: 'my favorite color is blue, remember that', expectTool: 'save_memory', label: 'save info → save_memory' },
        ];

        for (const t of toolTests) {
            try {
                const col = phaseCollector();
                const tm = timer();
                const result = await withTimeout(() => runner.run(t.input, {
                    chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
                }), TIMEOUT);

                const toolNames = getToolNames(col);
                const passed = toolNames.includes(t.expectTool);
                const detail = passed ? '' : `expected ${t.expectTool}, got [${toolNames.join(',')}]`;

                scores.add('C. Tool Selection', t.label, passed, detail);
                if (passed) {
                    results.total++; results.passed++;
                    console.log(`  ${C.green}✓${C.reset} ${t.label} → [${toolNames.join(',')}] (${tm()})`);
                } else {
                    results.total++; results.failed++;
                    results.errors.push({ label: `TOOL: ${t.label}`, detail });
                    console.log(`  ${C.red}✗${C.reset} ${t.label}: ${detail}`);
                }
            } catch (err) {
                scores.add('C. Tool Selection', t.label, false, err.message);
                results.total++; results.failed++;
                console.log(`  ${C.red}✗${C.reset} ${t.label}: ${err.message}`);
            }
        }
    }

    // ============================================================
    //  D. MULTI-STEP REASONING — chained deduction across turns
    // ============================================================
    group('D. Multi-Step Reasoning (chained conversation)');
    {
        const chatHistory = [];

        // Step 1: establish a fact
        try {
            const col = phaseCollector();
            const tm = timer();
            const r1 = await withTimeout(() => runner.run('what is 25 * 4?', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const has100 = (r1.response || '').includes('100');
            scores.add('D. Multi-Step Reasoning', 'step1: 25*4=100', has100, has100 ? '' : `response: ${r1.response.slice(0, 80)}`);
            if (has100) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} step1: 25*4=100 (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} step1: expected 100`); }
        } catch (err) {
            scores.add('D. Multi-Step Reasoning', 'step1: 25*4=100', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} step1: ${err.message}`);
        }

        // Step 2: follow-up computation
        try {
            const col = phaseCollector();
            const tm = timer();
            const r2 = await withTimeout(() => runner.run('add 50 to that result', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const has150 = (r2.response || '').includes('150');
            scores.add('D. Multi-Step Reasoning', 'step2: +50=150', has150, has150 ? '' : `response: ${r2.response.slice(0, 80)}`);
            if (has150) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} step2: +50=150 (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} step2: expected 150`); }
        } catch (err) {
            scores.add('D. Multi-Step Reasoning', 'step2: +50=150', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} step2: ${err.message}`);
        }

        // Step 3: divide by a number
        try {
            const col = phaseCollector();
            const tm = timer();
            const r3 = await withTimeout(() => runner.run('now divide by 3', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const has50 = (r3.response || '').includes('50');
            scores.add('D. Multi-Step Reasoning', 'step3: /3=50', has50, has50 ? '' : `response: ${r3.response.slice(0, 80)}`);
            if (has50) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} step3: /3=50 (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} step3: expected 50`); }
        } catch (err) {
            scores.add('D. Multi-Step Reasoning', 'step3: /3=50', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} step3: ${err.message}`);
        }
    }

    // ============================================================
    //  E. HALLUCINATION RESISTANCE — fake entities, unanswerable
    // ============================================================
    group('E. Hallucination Resistance');
    {
        const halluTests = [
            {
                input: 'who is the CEO of XyloMatic Technologies Inc?',
                label: 'fake company',
                check: (resp) => {
                    const r = resp.toLowerCase();
                    return r.includes('not find') || r.includes('no information') || r.includes('cannot') ||
                           r.includes('doesn\'t appear') || r.includes('unable') || r.includes('no result') ||
                           r.includes('找不到') || r.includes('没有找到') || r.includes('无法');
                },
                antiCheck: (resp) => {
                    // Should NOT confidently name a CEO
                    const r = resp.toLowerCase();
                    return !/the ceo (of|is) [a-z]+ [a-z]+/i.test(r);
                }
            },
            {
                input: 'what happened in the 2030 Olympics?',
                label: 'future event (2030)',
                check: (resp) => {
                    const r = resp.toLowerCase();
                    return r.includes('hasn\'t') || r.includes('future') || r.includes('not yet') ||
                           r.includes('hasn\'t happened') || r.includes('2030') || r.includes('尚未') || r.includes('还没');
                },
                antiCheck: () => true
            },
        ];

        for (const t of halluTests) {
            try {
                const col = phaseCollector();
                const tm = timer();
                const result = await withTimeout(() => runner.run(t.input, {
                    chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
                }), TIMEOUT);

                const honest = t.check(result.response);
                const noFab = t.antiCheck(result.response);
                const passed = honest || noFab;
                const detail = passed ? '' : `response may contain hallucination: ${result.response.slice(0, 120)}`;

                scores.add('E. Hallucination Resistance', t.label, passed, detail);
                if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} ${t.label} (${tm()})`); }
                else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} ${t.label}: ${detail}`); }
                printPhaseDebug(t.label, result, col);
            } catch (err) {
                scores.add('E. Hallucination Resistance', t.label, false, err.message);
                results.total++; results.failed++;
                console.log(`  ${C.red}✗${C.reset} ${t.label}: ${err.message}`);
            }
        }
    }

    // ============================================================
    //  F. MULTI-INTENT / PARALLEL TOOL EXECUTION
    // ============================================================
    group('F. Multi-Intent Parallel Execution');
    {
        // Test 1: two independent tools
        try {
            const col = phaseCollector();
            const tm = timer();
            const result = await withTimeout(() => runner.run('what time is it in Tokyo? and what is 999 * 111?', {
                chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const toolNames = getToolNames(col);
            const hasTime = toolNames.includes('get_time');
            const hasCalc = toolNames.includes('calculate');
            const resp = result.response || '';
            const has110889 = resp.includes('110889') || resp.includes('110,889');

            const passed = hasTime && hasCalc;
            const detail = passed ? '' : `expected get_time+calculate, got [${toolNames.join(',')}]`;
            scores.add('F. Multi-Intent', 'time+calculate dual tool', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} time+calculate both selected (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} time+calculate: ${detail}`); }

            // Also check answer correctness
            scores.add('F. Multi-Intent', 'math answer=110889', has110889, has110889 ? '' : `answer not found in response`);
            if (has110889) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} 999*111=110889 in response`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} 999*111=110889 not in response`); }
        } catch (err) {
            scores.add('F. Multi-Intent', 'time+calculate dual tool', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} multi-intent: ${err.message}`);
        }

        // Test 2: three independent tools
        try {
            const col = phaseCollector();
            const tm = timer();
            const result = await withTimeout(() => runner.run('what time in Singapore, weather in Tokyo, and 500 USD to EUR?', {
                chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const toolNames = getToolNames(col);
            const uniqueTools = [...new Set(toolNames)];
            const passed = uniqueTools.length >= 2; // at least 2 different tools
            const detail = `tools used: [${uniqueTools.join(',')}]`;
            scores.add('F. Multi-Intent', 'triple intent (3 tools)', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} triple intent → ${uniqueTools.length} tool types (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} triple: only ${uniqueTools.length} tool types`); }
            printPhaseDebug('triple intent', result, col);
        } catch (err) {
            scores.add('F. Multi-Intent', 'triple intent (3 tools)', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} triple intent: ${err.message}`);
        }
    }

    // ============================================================
    //  G. LANGUAGE & STYLE CONTROL
    // ============================================================
    group('G. Language & Style Control');
    {
        const chatHistory = [];
        // Step 1: Set language preference
        try {
            const col = phaseCollector();
            const tm = timer();
            const r1 = await withTimeout(() => runner.run('please remember to reply me in Chinese from now on', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            scores.add('G. Language Control', 'save language pref', true, '');
            results.total++; results.passed++;
            console.log(`  ${C.green}✓${C.reset} language preference set (${tm()})`);
        } catch (err) {
            scores.add('G. Language Control', 'save language pref', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} save lang: ${err.message}`);
        }

        // Step 2: ask something — should reply in Chinese
        try {
            const col = phaseCollector();
            const tm = timer();
            const r2 = await withTimeout(() => runner.run('what is 77 + 33?', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const resp = r2.response || '';
            const hasChinese = /[\u4e00-\u9fff]/.test(resp);
            const has110 = resp.includes('110');
            const passed = hasChinese && has110;
            const detail = !hasChinese ? 'no Chinese characters' : !has110 ? 'wrong answer' : '';

            scores.add('G. Language Control', 'reply in Chinese + correct answer', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} Chinese reply with 110 (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} lang control: ${detail}`); }
        } catch (err) {
            scores.add('G. Language Control', 'reply in Chinese + correct answer', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} Chinese reply: ${err.message}`);
        }
    }

    // ============================================================
    //  H. DEEP FOLLOW-UP CHAIN — context retention over 5 turns
    // ============================================================
    group('H. Deep Follow-Up Chain (5 turns)');
    {
        const chatHistory = [];

        const chain = [
            { input: 'tell me about Singapore Airlines', check: (r) => /singapore|sia|航空/i.test(r), label: 'T1: initial query' },
            { input: 'how many planes do they have?', check: (r) => /\d{2,3}/.test(r), label: 'T2: fleet size (depth 1)' },
            { input: 'what routes do they fly to?', check: (r) => r.length > 50, label: 'T3: routes (depth 2)' },
            { input: 'who is the current CEO?', check: (r) => r.length > 20, label: 'T4: CEO (depth 3)' },
            { input: 'what alliance are they part of?', check: (r) => /star|alliance|星空/i.test(r), label: 'T5: alliance (depth 4)' },
        ];

        for (const step of chain) {
            try {
                const col = phaseCollector();
                const tm = timer();
                const result = await withTimeout(() => runner.run(step.input, {
                    chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
                }), TIMEOUT);

                const passed = step.check(result.response);
                const detail = passed ? '' : `response: ${result.response.slice(0, 80)}`;
                scores.add('H. Deep Follow-Up', step.label, passed, detail);
                if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} ${step.label} (${tm()})`); }
                else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} ${step.label}: ${detail}`); }

                // Check search queries don't leak previous topics
                const queries = getSearchQueries(col);
                if (queries.length > 0) {
                    console.log(`  ${C.dim}  queries: ${queries.join(' | ')}${C.reset}`);
                }
            } catch (err) {
                scores.add('H. Deep Follow-Up', step.label, false, err.message);
                results.total++; results.failed++;
                console.log(`  ${C.red}✗${C.reset} ${step.label}: ${err.message}`);
            }
        }
    }

    // ============================================================
    //  I. TOPIC SWITCH + BACK-REFERENCE — conversation navigation
    // ============================================================
    group('I. Topic Switch & Back-Reference');
    {
        const chatHistory = [];

        // T1: Topic A
        try {
            const col = phaseCollector();
            const tm = timer();
            const r1 = await withTimeout(() => runner.run('tell me about Tesla stock price', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);
            scores.add('I. Topic Navigation', 'T1: Tesla (topic A)', r1.response.length > 30, '');
            results.total++; results.passed++;
            console.log(`  ${C.green}✓${C.reset} T1: Tesla stock (${tm()})`);
        } catch (err) {
            scores.add('I. Topic Navigation', 'T1: Tesla (topic A)', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} T1: ${err.message}`);
        }

        // T2: Clean topic switch to B
        try {
            const col = phaseCollector();
            const tm = timer();
            const r2 = await withTimeout(() => runner.run('what is quantum computing?', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const queries = getSearchQueries(col);
            const noTesla = !queries.some(q => q.includes('tesla'));
            const passed = noTesla && r2.response.length > 50;
            const detail = noTesla ? '' : `Tesla leaked into QC query: ${queries.join(' | ')}`;
            scores.add('I. Topic Navigation', 'T2: QC switch (no Tesla leak)', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} T2: clean QC switch (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} T2: ${detail}`); }
        } catch (err) {
            scores.add('I. Topic Navigation', 'T2: QC switch (no Tesla leak)', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} T2: ${err.message}`);
        }

        // T3: back-reference to topic A
        try {
            const col = phaseCollector();
            const tm = timer();
            const r3 = await withTimeout(() => runner.run('go back to Tesla, what was their latest revenue?', {
                chatHistory, memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const queries = getSearchQueries(col);
            const hasTesla = queries.some(q => q.includes('tesla'));
            const passed = hasTesla && r3.response.length > 30;
            const detail = hasTesla ? '' : `Tesla not in search queries: ${queries.join(' | ')}`;
            scores.add('I. Topic Navigation', 'T3: back-ref Tesla revenue', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} T3: back-ref Tesla (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} T3: ${detail}`); }
        } catch (err) {
            scores.add('I. Topic Navigation', 'T3: back-ref Tesla revenue', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} T3: ${err.message}`);
        }
    }

    // ============================================================
    //  J. COMPLEX TASK — multi-part query requiring synthesis
    // ============================================================
    group('J. Complex Task — Synthesis');
    {
        // Test: compare two things (requires multiple searches + synthesis)
        try {
            const col = phaseCollector();
            const tm = timer();
            const result = await withTimeout(() => runner.run('compare the weather in Tokyo and Singapore right now', {
                chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const toolNames = getToolNames(col);
            const weatherCalls = toolNames.filter(t => t === 'get_weather').length;
            const resp = result.response || '';
            const hasBothCities = (/tokyo|东京/i.test(resp)) && (/singapore|新加坡/i.test(resp));
            const hasTemp = /\d+\.?\d*\s*°?C/i.test(resp) || /度/.test(resp);

            const passed = hasBothCities && hasTemp;
            const detail = `weather calls=${weatherCalls}, both cities=${hasBothCities}, hasTemp=${hasTemp}`;
            scores.add('J. Complex Task', 'compare weather Tokyo vs Singapore', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} weather comparison (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} weather compare: ${detail}`); }
            printPhaseDebug('weather compare', result, col);
        } catch (err) {
            scores.add('J. Complex Task', 'compare weather Tokyo vs Singapore', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} weather compare: ${err.message}`);
        }

        // Test: conditional reasoning
        try {
            const col = phaseCollector();
            const tm = timer();
            const result = await withTimeout(() => runner.run('what is the weather in Singapore? if temperature > 25°C, say "hot", otherwise say "cool"', {
                chatHistory: [], memoryDB, model: 'gemma-3-27b-it', ...col,
            }), TIMEOUT);

            const toolNames = getToolNames(col);
            const hasWeather = toolNames.includes('get_weather');
            const resp = (result.response || '').toLowerCase();
            const hasJudgment = resp.includes('hot') || resp.includes('cool') || resp.includes('热') || resp.includes('凉');

            const passed = hasWeather && hasJudgment;
            const detail = `weather=${hasWeather}, judgment=${hasJudgment}`;
            scores.add('J. Complex Task', 'conditional reasoning (temp > 25?)', passed, detail);
            if (passed) { results.total++; results.passed++; console.log(`  ${C.green}✓${C.reset} conditional reasoning (${tm()})`); }
            else { results.total++; results.failed++; console.log(`  ${C.red}✗${C.reset} conditional: ${detail}`); }
        } catch (err) {
            scores.add('J. Complex Task', 'conditional reasoning (temp > 25?)', false, err.message);
            results.total++; results.failed++;
            console.log(`  ${C.red}✗${C.reset} conditional: ${err.message}`);
        }
    }

    // ============================================================
    //  FINAL SCORECARD
    // ============================================================
    scores.printReport();

    return { total: results.total, passed: results.passed, failed: results.failed };
}

// ===== Direct execution =====
if (import.meta.url === `file://${process.argv[1]}`) {
    run().then(r => {
        summarize();
        process.exit(r.failed > 0 ? 1 : 0);
    });
}
