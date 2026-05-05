// ============================================================
//  test/helpers.js — Shared test utilities
// ============================================================

import { readFileSync } from 'fs';
import { decryptKey, KeyManager } from '../src/core.js';
import { GemmaAPI } from '../src/client.js';
import { ToolRegistry } from '../src/tools.js';
import { OODAERunner } from '../src/oodae.js';
import { HarnessConfig } from '../src/config.js';

// ===== Colors =====
export const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m', white: '\x1b[37m',
};

// ===== Results tracker =====
export const results = { total: 0, passed: 0, failed: 0, errors: [] };

export function resetResults() {
    results.total = 0; results.passed = 0; results.failed = 0; results.errors = [];
}

// ===== Assertions =====
function pass(label) {
    results.total++; results.passed++;
    console.log(`  ${C.green}✓${C.reset} ${label}`);
}

function fail(label, detail) {
    results.total++; results.failed++;
    results.errors.push({ label, detail });
    console.log(`  ${C.red}✗${C.reset} ${label}`);
    if (detail) console.log(`    ${C.dim}${detail}${C.reset}`);
}

export function assertEqual(actual, expected, label) {
    if (actual === expected) pass(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertTrue(value, label) {
    if (value) pass(label);
    else fail(label, `expected truthy, got ${JSON.stringify(value)}`);
}

export function assertFalse(value, label) {
    if (!value) pass(label);
    else fail(label, `expected falsy, got ${JSON.stringify(value)}`);
}

export function assertContains(str, sub, label) {
    const s = typeof str === 'string' ? str : JSON.stringify(str);
    if (s.includes(sub)) pass(label);
    else fail(label, `"${s.slice(0, 80)}" does not contain "${sub}"`);
}

export function assertThrows(fn, label) {
    try { fn(); fail(label, 'did not throw'); }
    catch { pass(label); }
}

export function assertGreater(a, b, label) {
    if (a > b) pass(label);
    else fail(label, `expected ${a} > ${b}`);
}

// ===== Group header =====
export function group(name) {
    console.log(`\n${C.cyan}${C.bold}▸ ${name}${C.reset}`);
}

// ===== Summary =====
export function summarize() {
    const { total, passed, failed } = results;
    const color = failed > 0 ? C.red : C.green;
    console.log(`\n${color}${C.bold}${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}${C.reset}`);
    if (failed > 0) {
        console.log(`${C.red}Failed:${C.reset}`);
        for (const e of results.errors) console.log(`  ${C.red}✗${C.reset} ${e.label}: ${e.detail}`);
    }
    return results;
}

// ===== Timer =====
export function timer() {
    const t = Date.now();
    return () => ((Date.now() - t) / 1000).toFixed(2) + 's';
}

// ===== Load API keys from gemma_code.jsonl =====
export function loadKeys(filepath, seed = HarnessConfig.keys.seed) {
    const text = readFileSync(filepath, 'utf-8');
    return text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
        .map(l => { try { return decryptKey(JSON.parse(l).key, seed); } catch { return null; } })
        .filter(k => k && k.length > 0);
}

// ===== Setup full API + Runner for live tests =====
export function setupAPI(keysPath = new URL('../gemma_code.jsonl', import.meta.url).pathname) {
    const keys = loadKeys(keysPath);
    if (keys.length === 0) throw new Error('No API keys found');

    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const k of keys) keyManager.addKey(k);

    const api = new GemmaAPI({ keyManager });
    const registry = new ToolRegistry();
    registerTestTools(registry);
    const runner = new OODAERunner(api, registry, { maxLoops: 3 });

    return { api, keyManager, registry, runner, keyCount: keys.length };
}

// ===== Register minimal tools for testing =====
export function registerTestTools(registry) {
    registry.add({
        name: 'web_search', description: 'Search the web.',
        parameters: { query: { type: 'string', required: true }, max_results: { type: 'number', required: false, default: 5 } },
        handler: async (args) => {
            const url = `${HarnessConfig.services.search.searxng}?q=${encodeURIComponent(args.query)}&format=json&categories=general`;
            const res = await fetch(url); if (!res.ok) throw new Error('SearXNG error: ' + res.status);
            const data = await res.json();
            return { query: args.query, results: (data.results || []).slice(0, args.max_results || 5).map(r => ({ title: r.title, url: r.url, snippet: r.content || '' })) };
        }
    });
    registry.add({
        name: 'fetch_url', description: 'Fetch a webpage.',
        parameters: { url: { type: 'string', required: true }, max_length: { type: 'number', required: false, default: 3000 } },
        handler: async (args) => {
            const headers = { 'Content-Type': 'application/json' };
            if (HarnessConfig.services.search.readUrlApiKey) headers['x-api-key'] = HarnessConfig.services.search.readUrlApiKey;
            const res = await fetch(HarnessConfig.services.search.readUrl, {
                method: 'POST', headers,
                body: JSON.stringify({ url: args.url })
            });
            if (!res.ok) throw new Error('ReadURL error: ' + res.status);
            const data = await res.json();
            let content = data.contentMarkdown || data.textExcerpt || '';
            if (content.length > (args.max_length || 3000)) content = content.slice(0, args.max_length || 3000) + '...';
            return { url: data.url, title: data.title || '', content };
        }
    });
    registry.add({
        name: 'calculate', description: 'Evaluate math expression.',
        parameters: { expression: { type: 'string', required: true } },
        handler: async (args) => {
            const expr = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
            if (!expr) throw new Error('Invalid expression');
            return { expression: args.expression, result: Function('"use strict"; return (' + expr + ')')() };
        }
    });
    registry.add({
        name: 'get_time', description: 'Get current time.',
        parameters: { timezone: { type: 'string', required: true } },
        handler: async (args) => {
            const res = await fetch(`https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(args.timezone)}`);
            if (!res.ok) throw new Error('TimeAPI error: ' + res.status);
            const d = await res.json();
            return { timezone: d.timeZone, datetime: d.dateTime, time: d.time };
        }
    });
    return registry;
}
