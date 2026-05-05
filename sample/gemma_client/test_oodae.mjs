#!/usr/bin/env node
// ============================================================
//  test_oodae.mjs — Live OODA-E tester (Node.js CLI)
//  Uses gemma_code.jsonl keys + real API calls
//  Run: node test_oodae.mjs
// ============================================================

import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { decryptKey, KeyManager, GemmaAPI, ToolRegistry, OODAERunner, PHASE, HarnessConfig } from './src/index.js';

// ===== Colors =====
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
    bgBlue: '\x1b[44m', bgMagenta: '\x1b[45m', bgCyan: '\x1b[46m', bgYellow: '\x1b[43m', bgGreen: '\x1b[42m', bgRed: '\x1b[41m',
};

const PHASE_STYLE = {
    [PHASE.OBSERVE]:  { icon: '👁', color: C.cyan,    bg: C.bgCyan,   label: 'OBSERVE'  },
    [PHASE.ORIENT]:   { icon: '🧭', color: C.blue,    bg: C.bgBlue,   label: 'ORIENT'   },
    [PHASE.DECIDE]:   { icon: '🧠', color: C.magenta, bg: C.bgMagenta,label: 'DECIDE'   },
    [PHASE.ACT]:      { icon: '⚡', color: C.yellow,  bg: C.bgYellow, label: 'ACT'      },
    [PHASE.EVALUATE]: { icon: '✅', color: C.green,   bg: C.bgGreen,  label: 'EVALUATE' },
    fallback:         { icon: '🔄', color: C.red,     bg: C.bgRed,    label: 'FALLBACK' },
};

function phaseHeader(phase, status, loop) {
    const s = PHASE_STYLE[phase] || PHASE_STYLE.fallback;
    const loopStr = loop ? ` [loop ${loop}]` : '';
    const statusStr = status === 'start' ? '...' : ' ✓';
    return `${s.color}${C.bold}${s.icon} ${s.label}${loopStr}${statusStr}${C.reset}`;
}

function jsonPretty(obj, indent = 2) {
    try { return JSON.stringify(obj, null, indent); } catch { return String(obj); }
}

function divider(char = '─', len = 60) { return C.dim + char.repeat(len) + C.reset; }

function truncate(s, max = 500) {
    if (!s || s.length <= max) return s;
    return s.slice(0, max) + `... [+${s.length - max} chars]`;
}

// ===== Load keys from filesystem =====
function loadKeys(filepath, seed = HarnessConfig.keys.seed) {
    const text = readFileSync(filepath, 'utf-8');
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => {
            try { return decryptKey(JSON.parse(l).key, seed); } catch { return null; }
        })
        .filter(k => k && k.length > 0);
}

// ===== Register essential tools (same as chat_tools.js) =====
function registerTools(registry) {
    // Web Search (SearXNG)
    registry.add({
        name: 'web_search',
        description: 'Search the web using SearXNG. Returns real search results from multiple engines.',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query' },
            max_results: { type: 'number', required: false, default: 5, description: 'Number of results (1-10)' },
            categories: { type: 'string', required: false, default: 'general', description: 'Search category', enum: ['general', 'news', 'images', 'videos', 'it', 'science'] }
        },
        handler: async (args) => {
            const limit = Math.min(Math.max(args.max_results || 5, 1), 10);
            const cat = args.categories || 'general';
            const url = `${HarnessConfig.services.search.searxng}?q=${encodeURIComponent(args.query)}&format=json&categories=${cat}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`SearXNG error: ${res.status}`);
            const data = await res.json();
            const results = (data.results || []).slice(0, limit).map(r => ({
                title: r.title, url: r.url, snippet: r.content || '',
                engine: r.engine, score: r.score
            }));
            return { query: args.query, category: cat, total_results: data.number_of_results || 0, results, suggestions: (data.suggestions || []).slice(0, 3) };
        }
    });

    // Fetch URL
    registry.add({
        name: 'fetch_url',
        description: 'Fetch and read the content of any webpage URL. Returns clean markdown content.',
        parameters: {
            url: { type: 'string', required: true, description: 'Full URL to fetch' },
            max_length: { type: 'number', required: false, default: 5000, description: 'Max chars to return' }
        },
        handler: async (args) => {
            const res = await fetch(HarnessConfig.services.search.readUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': HarnessConfig.services.search.readUrlApiKey },
                body: JSON.stringify({ url: args.url })
            });
            if (!res.ok) throw new Error(`ReadURL error: ${res.status}`);
            const data = await res.json();
            let content = data.contentMarkdown || data.textExcerpt || '';
            const max = args.max_length || 5000;
            if (content.length > max) content = content.slice(0, max) + '... [truncated]';
            return { url: data.url, title: data.title || '', content, content_length: content.length };
        }
    });

    // Get Time
    registry.add({
        name: 'get_time',
        description: 'Get the current date and time for a timezone using TimeAPI.io.',
        parameters: { timezone: { type: 'string', required: true, description: 'IANA timezone, e.g. "Asia/Singapore"' } },
        handler: async (args) => {
            const res = await fetch(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(args.timezone)}`);
            if (!res.ok) throw new Error(`TimeAPI error: ${res.status}`);
            const d = await res.json();
            return { timezone: d.timeZone, datetime: d.dateTime, date: d.date, time: d.time, day_of_week: d.dayOfWeek };
        }
    });

    // Calculator
    registry.add({
        name: 'calculate',
        description: 'Evaluate a math expression. Supports +, -, *, /, (), %.',
        parameters: { expression: { type: 'string', required: true, description: 'Math expression' } },
        handler: async (args) => {
            const expr = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
            if (!expr) throw new Error('Invalid expression');
            return { expression: args.expression, result: Function('"use strict"; return (' + expr + ')')() };
        }
    });

    // In-memory store for testing
    const memoryStore = new Map();

    registry.add({
        name: 'save_memory',
        description: 'Save information about the user for future reference.',
        parameters: {
            key: { type: 'string', required: true, description: 'Memory key' },
            value: { type: 'string', required: true, description: 'Memory value' },
            category: { type: 'string', required: false, default: 'general', description: 'Category' }
        },
        handler: async (args) => {
            memoryStore.set(args.key, { value: args.value, category: args.category || 'general' });
            return { saved: true, key: args.key };
        }
    });

    registry.add({
        name: 'recall_memory',
        description: 'Recall a previously saved memory by key or search term.',
        parameters: { query: { type: 'string', required: true, description: 'Key or search term' } },
        handler: async (args) => {
            const q = args.query.toLowerCase();
            const matches = [];
            for (const [k, v] of memoryStore) {
                if (k.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)) {
                    matches.push({ key: k, ...v });
                }
            }
            return { query: args.query, found: matches.length, memories: matches };
        }
    });

    registry.add({
        name: 'list_memories',
        description: 'List all saved memories.',
        parameters: {},
        handler: async () => {
            const all = [];
            for (const [k, v] of memoryStore) all.push({ key: k, ...v });
            return { count: all.length, memories: all };
        }
    });

    return memoryStore;
}

// ===== Main =====
async function main() {
    console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.cyan}║   OODA-E Live Tester (Node.js CLI)  ║${C.reset}`);
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════╝${C.reset}\n`);

    // Load keys
    const keys = loadKeys('./gemma_code.jsonl');
    console.log(`${C.green}✓ Loaded ${keys.length} API keys${C.reset}`);

    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const k of keys) keyManager.addKey(k);

    // Setup API
    const model = process.argv[2] || 'gemma-3-27b-it';
    const api = new GemmaAPI({ keyManager, model });
    console.log(`${C.green}✓ Model: ${model}${C.reset}`);

    // Setup tools
    const registry = new ToolRegistry();
    const memoryStore = registerTools(registry);
    console.log(`${C.green}✓ Registered ${registry.size} tools${C.reset}`);

    // Pre-seed some memories for testing
    memoryStore.set('user_name', { value: 'jinja', category: 'user_profile' });
    memoryStore.set('user_language_preference', { value: 'mandarin', category: 'preferences' });
    console.log(`${C.green}✓ Pre-seeded ${memoryStore.size} memories${C.reset}`);

    // Simple memoryDB interface for OODAERunner
    const memoryDB = {
        getAllMemories: async () => {
            const all = [];
            for (const [k, v] of memoryStore) all.push({ key: k, value: v.value, category: v.category });
            return all;
        }
    };

    // Setup OODA-E Runner
    const runner = new OODAERunner(api, registry, { maxLoops: 3 });
    console.log(`${C.green}✓ OODAERunner ready (maxLoops=3)${C.reset}`);
    console.log(divider('═'));
    console.log(`${C.dim}Commands: type a message to test, "quit" to exit, "mem" to show memories${C.reset}`);
    console.log(`${C.dim}          "raw" toggle raw LLM output, "model <name>" switch model${C.reset}`);
    console.log(divider('═'));

    // State
    let chatHistory = [];
    let showRaw = false;

    // Interactive loop
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on('close', () => process.exit(0));
    const prompt = () => {
        try { rl.question(`\n${C.bold}${C.white}You > ${C.reset}`, handleInput); }
        catch { process.exit(0); }
    };

    async function handleInput(input) {
        const trimmed = input.trim();
        if (!trimmed) { prompt(); return; }

        // Commands
        if (trimmed === 'quit' || trimmed === 'exit') { rl.close(); process.exit(0); }
        if (trimmed === 'raw') { showRaw = !showRaw; console.log(`${C.dim}Raw output: ${showRaw ? 'ON' : 'OFF'}${C.reset}`); prompt(); return; }
        if (trimmed === 'clear') { chatHistory = []; console.log(`${C.dim}Chat history cleared.${C.reset}`); prompt(); return; }
        if (trimmed === 'mem') {
            console.log(`\n${C.cyan}${C.bold}Memories (${memoryStore.size}):${C.reset}`);
            for (const [k, v] of memoryStore) console.log(`  ${C.cyan}${k}${C.reset} [${v.category}] = ${v.value}`);
            prompt(); return;
        }
        if (trimmed.startsWith('model ')) {
            const newModel = trimmed.slice(6).trim();
            api.model = newModel;
            console.log(`${C.green}✓ Switched to model: ${newModel}${C.reset}`);
            prompt(); return;
        }

        const startTime = Date.now();

        try {
            const result = await runner.run(trimmed, {
                chatHistory,
                memoryDB,
                model: api.model,
                onPhase: (phase, info) => {
                    if (info.status === 'start') {
                        process.stdout.write(phaseHeader(phase, 'start', info.loop));
                    } else {
                        // Clear line and rewrite with done status
                        process.stdout.write('\r' + ' '.repeat(80) + '\r');
                        console.log(phaseHeader(phase, 'done', info.loop));

                        // Show phase data
                        const data = info.data;
                        if (!data) return;

                        if (phase === PHASE.OBSERVE) {
                            console.log(`  ${C.dim}Intent:${C.reset} ${data.intent}  ${C.dim}Tools:${C.reset} ${data.requires_tools}  ${C.dim}Entities:${C.reset} ${(data.key_entities||[]).join(', ')}`);
                            console.log(`  ${C.dim}Summary:${C.reset} ${data.summary}`);
                            if (showRaw && data._raw) console.log(`  ${C.dim}Raw:${C.reset} ${truncate(data._raw, 300)}`);
                        }
                        else if (phase === PHASE.ORIENT) {
                            console.log(`  ${C.dim}Language:${C.reset} ${data.language}  ${C.dim}Memories:${C.reset} ${data.memory_count}  ${C.dim}Action:${C.reset} ${data.memory_action}`);
                            if (Object.keys(data.user_profile || {}).length > 0) {
                                console.log(`  ${C.dim}Profile:${C.reset} ${jsonPretty(data.user_profile)}`);
                            }
                        }
                        else if (phase === PHASE.DECIDE) {
                            const plan = data.plan || [];
                            console.log(`  ${C.dim}Plan (${plan.length} steps):${C.reset}`);
                            for (const step of plan) {
                                console.log(`    ${C.magenta}→${C.reset} ${step.tool}(${jsonPretty(step.args || {})}) — ${step.reason || ''}`);
                            }
                            if (showRaw && data._raw) console.log(`  ${C.dim}Raw:${C.reset} ${truncate(data._raw, 300)}`);
                        }
                        else if (phase === PHASE.ACT) {
                            const results = data || [];
                            for (const r of results) {
                                if (r.error) {
                                    console.log(`    ${C.red}✗ ${r.name}: ${r.error}${C.reset}`);
                                } else {
                                    const preview = truncate(jsonPretty(r.result), 200);
                                    console.log(`    ${C.green}✓ ${r.name}:${C.reset} ${C.dim}${preview}${C.reset}`);
                                }
                            }
                        }
                        else if (phase === PHASE.EVALUATE) {
                            console.log(`  ${C.dim}Needs more:${C.reset} ${data.needs_more}`);
                            if (data.needs_more) {
                                console.log(`  ${C.dim}Reason:${C.reset} ${data.reason}`);
                            } else {
                                console.log(`  ${C.dim}Answer length:${C.reset} ${(data.final_answer || '').length} chars`);
                            }
                            if (showRaw && data._raw) console.log(`  ${C.dim}Raw:${C.reset} ${truncate(data._raw, 300)}`);
                        }
                        console.log(divider('·', 50));
                    }
                },
                onToolCall: (call) => {
                    console.log(`    ${C.yellow}⚒ ${call.name}${C.reset}(${jsonPretty(call.arguments)})`);
                },
                onToolResult: (call, result) => {
                    if (result.error) {
                        console.log(`    ${C.red}✗ ${call.name}: ${result.error}${C.reset}`);
                    }
                }
            });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

            // Final answer
            console.log(`\n${C.bold}${C.green}Gemma > ${C.reset}${result.response}`);
            console.log(`\n${C.dim}${elapsed}s | ${result.iterations} loop(s) | ${result.toolCalls.length} tool call(s) | history: ${chatHistory.length} msgs${C.reset}`);

        } catch (err) {
            console.error(`\n${C.red}${C.bold}ERROR:${C.reset} ${err.message}`);
            if (err.stack) console.error(`${C.dim}${err.stack.split('\n').slice(1, 3).join('\n')}${C.reset}`);
        }

        prompt();
    }

    prompt();
}

main().catch(err => { console.error(err); process.exit(1); });
