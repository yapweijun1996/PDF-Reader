// ============================================================
//  test/test_tools.js — Unit tests for src/tools.js
//  Tests: parseToolCalls, hasToolCalls, stripToolCalls, ToolRegistry
// ============================================================

import { ToolRegistry, parseToolCalls, hasToolCalls, stripToolCalls } from '../src/tools.js';
import { ToolRunner } from '../src/tool-runner.js';
import { assertEqual, assertTrue, assertFalse, assertContains, assertThrows, group, results, resetResults, summarize } from './helpers.js';

export async function run() {
    resetResults();
    console.log('\n📦 test_tools.js');

    // ── parseToolCalls ──
    group('parseToolCalls');

    let calls = parseToolCalls('<tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call>');
    assertEqual(calls.length, 1, 'parses single tool call');
    assertEqual(calls[0].name, 'web_search', 'correct tool name');
    assertEqual(calls[0].arguments.query, 'test', 'correct arguments');

    calls = parseToolCalls('<tool_call>{"name":"a","arguments":{}}</tool_call> text <tool_call>{"name":"b","arguments":{}}</tool_call>');
    assertEqual(calls.length, 2, 'parses multiple tool calls');

    calls = parseToolCalls('<tool_call>{"name":"t","args":{"x":1}}</tool_call>');
    assertEqual(calls[0].arguments.x, 1, 'accepts "args" alias');

    calls = parseToolCalls('<tool_call>{"name":"t","parameters":{"y":2}}</tool_call>');
    assertEqual(calls[0].arguments.y, 2, 'accepts "parameters" alias');

    calls = parseToolCalls('some text before <tool_call>{"name":"t","arguments":{"q":"v"}}</tool_call> and after');
    assertEqual(calls.length, 1, 'extracts from surrounding text');

    calls = parseToolCalls('no tool calls here');
    assertEqual(calls.length, 0, 'no tool_call tags returns empty');

    calls = parseToolCalls('<tool_call>not valid json</tool_call>');
    assertEqual(calls.length, 0, 'invalid JSON returns empty');

    calls = parseToolCalls('<tool_call>{"name":"t","arguments":{"a":1,}}</tool_call>');
    assertEqual(calls.length, 1, 'trailing comma recovery');

    // ── hasToolCalls ──
    group('hasToolCalls');

    assertTrue(hasToolCalls('text <tool_call>stuff</tool_call>'), 'detects tool_call tag');
    assertFalse(hasToolCalls('no tools here'), 'no tag returns false');
    assertFalse(hasToolCalls('partial <tool_call'), 'partial tag returns false');

    // ── stripToolCalls ──
    group('stripToolCalls');

    assertEqual(stripToolCalls('before <tool_call>stuff</tool_call> after'), 'before  after', 'strips single block');
    assertEqual(stripToolCalls('<tool_call>a</tool_call> mid <tool_call>b</tool_call>'), 'mid', 'strips multiple blocks');
    assertEqual(stripToolCalls('no tags'), 'no tags', 'no tags unchanged');

    // ── ToolRegistry CRUD ──
    group('ToolRegistry CRUD');

    const reg = new ToolRegistry();
    assertEqual(reg.size, 0, 'empty initially');

    reg.add({ name: 'calc', description: 'Calculator', parameters: { expr: { type: 'string', required: true } }, handler: async (a) => a.expr });
    assertEqual(reg.size, 1, 'size after add');
    assertTrue(reg.has('calc'), 'has returns true');
    assertFalse(reg.has('nope'), 'has returns false for missing');

    const def = reg.get('calc');
    assertEqual(def.name, 'calc', 'get returns correct tool');

    const list = reg.list();
    assertEqual(list.length, 1, 'list returns all tools');
    assertEqual(list[0].name, 'calc', 'list has correct name');
    assertTrue(list[0].handler === undefined, 'list omits handler');

    assertTrue(reg.remove('calc'), 'remove returns true');
    assertEqual(reg.size, 0, 'size after remove');
    assertFalse(reg.remove('calc'), 'remove nonexistent returns false');

    // ── ToolRegistry add validation ──
    group('ToolRegistry validation');

    assertThrows(() => reg.add({}), 'add without name throws');
    assertThrows(() => reg.add({ name: 'x' }), 'add without handler throws');
    assertThrows(() => reg.add({ name: 'x', handler: 'notfn' }), 'add with non-function handler throws');

    // ── ToolRegistry execute ──
    group('ToolRegistry execute');

    reg.add({ name: 'echo', description: 'Echo', parameters: { msg: { type: 'string', required: true } }, handler: async (a) => a.msg });
    reg.add({ name: 'boom', description: 'Throws', parameters: {}, handler: async () => { throw new Error('BOOM'); } });
    reg.add({ name: 'defaults', description: 'Has defaults', parameters: { x: { type: 'number', default: 42 } }, handler: async (a) => a.x });

    let result = await reg.execute('echo', { msg: 'hi' });
    assertEqual(result.result, 'hi', 'execute returns result');

    result = await reg.execute('unknown', {});
    assertTrue(result.error !== undefined, 'unknown tool returns error');
    assertContains(result.error, 'Unknown tool', 'error mentions unknown');

    result = await reg.execute('echo', {});
    assertTrue(result.error !== undefined, 'missing required param returns error');

    result = await reg.execute('boom', {});
    assertTrue(result.error !== undefined, 'throwing handler returns error');
    assertContains(result.error, 'BOOM', 'error contains throw message');

    result = await reg.execute('defaults', {});
    assertEqual(result.result, 42, 'default parameter applied');

    reg.add({
        name: 'wrapped',
        description: 'Wrapped args',
        parameters: { query: { type: 'string', required: true }, amount: { type: 'number', required: false, default: 1 } },
        handler: async (a) => a
    });

    result = await reg.execute('wrapped', { arguments: { query: 'Taipei 101', amount: '2' } });
    assertEqual(result.result.query, 'Taipei 101', 'wrapped arguments are flattened');
    assertEqual(result.result.amount, 2, 'numeric string is coerced to number');

    result = await reg.execute('wrapped', { arguments: [{ argument_name: 'query', argument_value: 'Colosseum' }] });
    assertEqual(result.result.query, 'Colosseum', 'argument array is flattened');
    assertEqual(result.result.amount, 1, 'default still applies after flattening');

    reg.add({
        name: 'exchange_rate',
        description: 'FX',
        parameters: {
            amount: { type: 'number', required: true },
            from: { type: 'string', required: true },
            to: { type: 'string', required: true }
        },
        handler: async (a) => a
    });

    result = await reg.execute('exchange_rate', {
        arguments: { amount: '200', from_currency: '欧元', to_currency: '美元' }
    });
    assertEqual(result.result.amount, 200, 'exchange_rate coerces numeric string');
    assertEqual(result.result.from, 'EUR', 'exchange_rate normalizes from_currency alias');
    assertEqual(result.result.to, 'USD', 'exchange_rate normalizes to_currency alias');

    // ── ToolRegistry clear ──
    group('ToolRegistry clear');

    reg.clear();
    assertEqual(reg.size, 0, 'clear empties registry');

    // ── ToolRunner duration ──
    group('ToolRunner duration');

    const runner = new ToolRunner({
        generateContent: async () => {
            await new Promise(resolve => setTimeout(resolve, 15));
            return {
                candidates: [{
                    content: {
                        parts: [{ text: 'final answer' }]
                    }
                }]
            };
        }
    }, new ToolRegistry(), { maxIterations: 1 });

    const toolResult = await runner.run('hello', { chatHistory: [] });
    assertEqual(toolResult.response, 'final answer', 'ToolRunner returns final answer');
    assertTrue(typeof toolResult.durationMs === 'number', 'ToolRunner exposes durationMs');
    assertTrue(toolResult.durationMs >= 10, 'ToolRunner durationMs reflects call time');

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
