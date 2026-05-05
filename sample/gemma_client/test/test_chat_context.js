#!/usr/bin/env node
// ============================================================
//  test/test_chat_context.js — Unit tests for chat_context.js
//  Tests simple-mode grounding without making API calls
// ============================================================

import { readFileSync } from 'fs';
import vm from 'vm';
import {
    assertContains, assertEqual, assertTrue,
    group, results, resetResults, summarize
} from './helpers.js';

function loadChatContext() {
    const code = readFileSync(new URL('../chat_context.js', import.meta.url), 'utf-8');
    const ctx = {
        console,
        Intl,
        Date,
        navigator: { language: 'zh-CN' },
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx;
}

function getSystemPrompt(buildSimpleModeContents, history) {
    const contents = buildSimpleModeContents(history);
    return contents[0]?.parts?.[0]?.text || '';
}

export async function run() {
    resetResults();
    console.log('\n📦 test_chat_context.js');

    const ctx = loadChatContext();

    group('buildSimpleModeContents — summary grounding');
    {
        const history = [
            { role: 'user', parts: [{ text: '进入第1组，项目=项目1，基数=7，颜色=blue。' }] },
            { role: 'model', parts: [{ text: '好的。' }] },
            { role: 'user', parts: [{ text: '把基数乘以2。' }] },
            { role: 'model', parts: [{ text: '14' }] },
            { role: 'user', parts: [{ text: '把新基数更新为前一个结果减1。' }] },
            { role: 'model', parts: [{ text: '已更新。' }] },
            { role: 'user', parts: [{ text: '请用一句话总结第1组的信息。' }] },
        ];
        const prompt = getSystemPrompt(ctx.buildSimpleModeContents, history);
        const contents = ctx.buildSimpleModeContents(history);
        const ledgerPrompt = contents[1]?.parts?.[0]?.text || '';

        assertContains(prompt, '本轮必须只用中文回答', 'uses Chinese-only grounding');
        assertContains(prompt, 'Stable summary facts: 项目=项目1，基数=7，颜色=blue。', 'summary uses stable base');
        assertContains(prompt, 'Updated base exists separately: 13.', 'summary keeps updated base separate');
        assertContains(prompt, 'Temporary arithmetic result exists separately: 14.', 'summary keeps temporary result separate');
        assertContains(prompt, '第1组是项目1，基数是7，颜色是blue。', 'summary template anchors exact answer');
        assertContains(ledgerPrompt, '第1组：项目=项目1，稳定基数=7，颜色=blue，新基数=13，最近临时结果=14。', 'focused ledger preserves stable and temporary facts separately');
        assertEqual(contents[contents.length - 1].parts[0].text, '请用一句话总结第1组的信息。', 'focused contents keep only current user turn at the end');
    }

    group('buildSimpleModeContents — updated base uses last numeric result');
    {
        const history = [
            { role: 'user', parts: [{ text: '进入第1组，项目=项目1，基数=7，颜色=blue。' }] },
            { role: 'model', parts: [{ text: '好的。' }] },
            { role: 'user', parts: [{ text: '现在把基数加3。只回答结果。' }] },
            { role: 'model', parts: [{ text: '10' }] },
            { role: 'user', parts: [{ text: '请用一句话总结第1组的信息。' }] },
            { role: 'model', parts: [{ text: '第1组是项目1，基数是7，颜色是blue。' }] },
            { role: 'user', parts: [{ text: '现在把基数更新为前一个结果减1，并只回答新基数。' }] },
        ];
        const prompt = getSystemPrompt(ctx.buildSimpleModeContents, history);
        assertContains(prompt, '10 - 1 = 9', 'updated base instruction binds to last numeric result');
    }

    group('buildSimpleModeContents — project/color lookup');
    {
        const history = [
            { role: 'user', parts: [{ text: '进入第9组，项目=项目9，基数=63，颜色=cyan。' }] },
            { role: 'model', parts: [{ text: '收到。' }] },
            { role: 'user', parts: [{ text: '我这一组的项目和颜色分别是什么？' }] },
        ];
        const contents = ctx.buildSimpleModeContents(history);
        const prompt = getSystemPrompt(ctx.buildSimpleModeContents, history);
        const ledgerPrompt = contents[1]?.parts?.[0]?.text || '';

        assertContains(prompt, 'Exact facts for this reply: 项目=项目9，颜色=cyan。', 'lookup anchors project/color facts');
        assertTrue(!prompt.includes('Project9'), 'does not anglicize project identifiers');
        assertEqual(ctx._extractGroupLedger(history).current.base, 63, 'ledger tracks stable base');
        assertContains(ledgerPrompt, '第9组：项目=项目9，稳定基数=63，颜色=cyan。', 'focused ledger includes current group facts');
    }

    return summarize();
}
