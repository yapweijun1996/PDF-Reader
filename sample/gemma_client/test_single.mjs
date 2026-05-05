// Single-query OODA-E test (no readline, no stdin issues)
// Usage: node test_single.mjs "your question here"
import { readFileSync } from 'fs';
import { decryptKey, KeyManager, GemmaAPI, ToolRegistry, OODAERunner, PHASE, HarnessConfig } from './src/index.js';

function loadKeys(fp, seed = HarnessConfig.keys.seed) {
    return readFileSync(fp, 'utf-8').split('\n').map(l => l.trim()).filter(l => l.length > 0)
        .map(l => { try { return decryptKey(JSON.parse(l).key, seed); } catch { return null; } }).filter(Boolean);
}

const keys = loadKeys('./gemma_code.jsonl');
const km = new KeyManager({ rotateEveryN: 1 });
for (const k of keys) km.addKey(k);
const api = new GemmaAPI({ keyManager: km });
const reg = new ToolRegistry();

reg.add({
    name: 'web_search', description: 'Search the web using SearXNG. Returns real search results.',
    parameters: { query: { type: 'string', required: true }, max_results: { type: 'number', required: false, default: 5 } },
    handler: async (args) => {
        const url = `${HarnessConfig.services.search.searxng}?q=${encodeURIComponent(args.query)}&format=json&categories=general`;
        const res = await fetch(url); if (!res.ok) throw new Error('SearXNG error: ' + res.status);
        const data = await res.json();
        return { query: args.query, results: (data.results || []).slice(0, args.max_results || 5).map(r => ({ title: r.title, url: r.url, snippet: r.content || '', engine: r.engine, score: r.score })) };
    }
});

reg.add({
    name: 'fetch_url', description: 'Fetch and read the content of any webpage URL.',
    parameters: { url: { type: 'string', required: true }, max_length: { type: 'number', required: false, default: 5000 } },
    handler: async (args) => {
        const res = await fetch(HarnessConfig.services.search.readUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': HarnessConfig.services.search.readUrlApiKey },
            body: JSON.stringify({ url: args.url })
        });
        if (!res.ok) throw new Error('ReadURL error: ' + res.status);
        const data = await res.json();
        let content = data.contentMarkdown || data.textExcerpt || '';
        if (content.length > (args.max_length || 5000)) content = content.slice(0, args.max_length || 5000) + '... [truncated]';
        return { url: data.url, title: data.title || '', content, content_length: content.length };
    }
});

const memStore = new Map([
    ['user_name', { value: 'jinja', category: 'user_profile' }],
    ['user_language_preference', { value: 'mandarin', category: 'preferences' }]
]);
const memoryDB = { getAllMemories: async () => [...memStore].map(([k, v]) => ({ key: k, value: v.value, category: v.category })) };

const runner = new OODAERunner(api, reg, { maxLoops: 3 });
const query = process.argv[2] || 'who is the ceo of tno systems pte ltd?';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m' };

console.log(`\n${C.bold}Query: "${query}"${C.reset}\n${'─'.repeat(60)}`);
const t0 = Date.now();

const result = await runner.run(query, {
    chatHistory: [], memoryDB, model: 'gemma-3-27b-it',
    onPhase: (phase, info) => {
        if (info.status === 'done') {
            const loop = info.loop ? ` [loop ${info.loop}]` : '';
            const d = info.data;
            if (phase === 'observe') {
                console.log(`\n${C.cyan}${C.bold}👁 OBSERVE${loop}${C.reset}`);
                console.log(`  Intent: ${d.intent} | Tools: ${d.requires_tools} | Entities: ${(d.key_entities || []).join(', ')}`);
                console.log(`  Summary: ${d.summary}`);
                if (d._raw?.includes('<thinking>')) {
                    const thinking = d._raw.match(/<thinking>([\s\S]*?)<\/thinking>/)?.[1]?.trim();
                    if (thinking) console.log(`  ${C.dim}Thinking: ${thinking.slice(0, 200)}${C.reset}`);
                }
            } else if (phase === 'orient') {
                console.log(`\n${C.blue}${C.bold}🧭 ORIENT${loop}${C.reset}`);
                console.log(`  Language: ${d.language} | Memories: ${d.memory_count} | Action: ${d.memory_action}`);
            } else if (phase === 'decide') {
                console.log(`\n${C.magenta}${C.bold}🧠 DECIDE${loop}${C.reset}`);
                for (const step of (d.plan || [])) {
                    console.log(`  → ${step.tool}(${JSON.stringify(step.args || {})}) — ${step.reason || ''}`);
                }
                if (d._raw?.includes('<thinking>')) {
                    const thinking = d._raw.match(/<thinking>([\s\S]*?)<\/thinking>/)?.[1]?.trim();
                    if (thinking) console.log(`  ${C.dim}Thinking: ${thinking.slice(0, 300)}${C.reset}`);
                }
            } else if (phase === 'act') {
                console.log(`\n${C.yellow}${C.bold}⚡ ACT${loop}${C.reset}`);
                for (const r of (d || [])) {
                    if (r.error) console.log(`  ${C.red}✗ ${r.name}: ${r.error}${C.reset}`);
                    else console.log(`  ${C.green}✓ ${r.name}${C.reset}: ${JSON.stringify(r.result).length} chars`);
                }
            } else if (phase === 'evaluate') {
                console.log(`\n${C.green}${C.bold}✅ EVALUATE${loop}${C.reset}`);
                console.log(`  Needs more: ${d.needs_more}`);
                if (d.needs_more) console.log(`  Reason: ${d.reason}`);
                else console.log(`  Answer: ${(d.final_answer || '').slice(0, 200)}`);
                if (d._raw?.includes('<thinking>')) {
                    const thinking = d._raw.match(/<thinking>([\s\S]*?)<\/thinking>/)?.[1]?.trim();
                    if (thinking) console.log(`  ${C.dim}Thinking: ${thinking.slice(0, 500)}${C.reset}`);
                }
            }
        }
    },
    onToolCall: (c) => console.log(`  ${C.yellow}⚒ ${c.name}${C.reset}(${JSON.stringify(c.arguments)})`),
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\n${'═'.repeat(60)}`);
console.log(`${C.bold}${C.green}FINAL ANSWER:${C.reset}\n${result.response}`);
console.log(`${'═'.repeat(60)}`);
console.log(`${C.dim}${elapsed}s | ${result.iterations} loops | ${result.toolCalls.length} tool calls${C.reset}\n`);
