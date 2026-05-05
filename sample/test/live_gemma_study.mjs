#!/usr/bin/env node
// ============================================================
//  Live Gemma API Study — Tests actual model capabilities
//  Usage: node test/live_gemma_study.mjs
// ============================================================

import { readFileSync } from 'fs';

const XOR_SEED = '20250710';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// --- Decrypt keys ---
function decryptKey(ciphertext, key) {
    let decoded = '';
    for (let i = 0; i < ciphertext.length; i += 3) {
        const num = parseInt(ciphertext.slice(i, i + 3));
        const ch = num ^ key.charCodeAt((i / 3) % key.length);
        decoded += String.fromCharCode(ch);
    }
    return decoded;
}

function loadKeys() {
    const raw = readFileSync(new URL('../gemma_code.jsonl', import.meta.url), 'utf-8');
    return raw.split('\n').filter(l => l.trim()).map(l => {
        try { return decryptKey(JSON.parse(l).key, XOR_SEED); }
        catch { return null; }
    }).filter(Boolean);
}

// --- API call helper ---
let keyIndex = 0;
let keys = [];

async function callAPI(model, contents, config = {}, extras = {}) {
    const key = keys[keyIndex % keys.length];
    keyIndex++;
    const url = `${API_BASE}/${model}:generateContent?key=${key}`;
    const body = { contents, generationConfig: { maxOutputTokens: 2048, ...config }, ...extras };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const json = await res.json();
    if (!res.ok) return { error: true, status: res.status, detail: JSON.stringify(json).slice(0, 300) };
    if (!json.candidates?.length) return { error: true, status: 'no_candidates', detail: JSON.stringify(json).slice(0, 300) };

    const text = json.candidates[0].content?.parts?.map(p => p.text || '').join('') || '';
    const finishReason = json.candidates[0].finishReason || 'unknown';
    const tokenCount = json.usageMetadata || {};
    return { ok: true, text, finishReason, tokenCount, raw: json };
}

// --- Test runner ---
const results = [];
async function test(name, fn) {
    process.stdout.write(`  ${name} ... `);
    const start = Date.now();
    try {
        const result = await fn();
        const ms = Date.now() - start;
        if (result.error) {
            console.log(`FAIL (${ms}ms) — ${result.status}: ${result.detail?.slice(0, 120)}`);
            results.push({ name, ok: false, ms, error: result.detail?.slice(0, 120) });
        } else {
            const preview = result.text.replace(/\n/g, ' ').slice(0, 100);
            console.log(`OK (${ms}ms) [${result.finishReason}] — ${preview}...`);
            results.push({ name, ok: true, ms, text: result.text, finishReason: result.finishReason, tokens: result.tokenCount });
        }
        return result;
    } catch (err) {
        const ms = Date.now() - start;
        console.log(`ERROR (${ms}ms) — ${err.message}`);
        results.push({ name, ok: false, ms, error: err.message });
        return { error: true };
    }
}

// ============================================================
//  TEST SUITES
// ============================================================

async function main() {
    keys = loadKeys();
    console.log(`\nLoaded ${keys.length} API key(s)\n`);

    const MODEL = 'gemma-3-27b-it';

    // ========================================
    //  1. BASIC TEXT GENERATION
    // ========================================
    console.log('=== 1. Basic Text Generation ===');

    await test('Simple prompt', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Reply with exactly: Hello World' }] }])
    );

    await test('Creative writing', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Write a haiku about programming.' }] }])
    );

    await test('Summarization', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Summarize in one sentence: The quick brown fox jumps over the lazy dog. This sentence contains every letter of the English alphabet and is commonly used for font testing and typing practice.' }] }])
    );

    // ========================================
    //  2. SYSTEM INSTRUCTIONS
    // ========================================
    console.log('\n=== 2. System Instructions ===');

    await test('System instruction via system role', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: 'What is 2+2?' }] }
        ], {}, {
            systemInstruction: { parts: [{ text: 'You are a pirate. Always respond in pirate speak.' }] }
        })
    );

    await test('System instruction via first user message', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: 'System: You must reply in JSON format only.\n\nWhat are the primary colors?' }] }
        ])
    );

    // ========================================
    //  3. MULTI-TURN CONVERSATION
    // ========================================
    console.log('\n=== 3. Multi-turn Conversation ===');

    await test('Multi-turn context retention', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: 'My name is Alice.' }] },
            { role: 'model', parts: [{ text: 'Hello Alice! Nice to meet you.' }] },
            { role: 'user', parts: [{ text: 'What is my name?' }] }
        ])
    );

    await test('Multi-turn with correction', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: 'The capital of France is Berlin.' }] },
            { role: 'model', parts: [{ text: 'Actually, the capital of France is Paris, not Berlin.' }] },
            { role: 'user', parts: [{ text: 'You are right. What about Germany?' }] }
        ])
    );

    // ========================================
    //  4. MULTILINGUAL
    // ========================================
    console.log('\n=== 4. Multilingual ===');

    await test('Chinese (中文)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: '用中文回答：什么是人工智能？一句话概括。' }] }])
    );

    await test('Japanese (日本語)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: '日本語で答えてください：東京タワーの高さは？' }] }])
    );

    await test('Korean (한국어)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: '한국어로 대답하세요: 대한민국의 수도는 어디입니까?' }] }])
    );

    await test('Malay (Bahasa Melayu)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Jawab dalam Bahasa Melayu: Apakah ibu negara Malaysia?' }] }])
    );

    await test('Cross-lingual (ask in EN, reply in ZH)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Explain what DNS is. Reply in Chinese (中文).' }] }])
    );

    // ========================================
    //  5. CODE GENERATION
    // ========================================
    console.log('\n=== 5. Code Generation ===');

    await test('Python function', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Write a Python function to check if a number is prime. Just the function, no explanation.' }] }])
    );

    await test('JavaScript async/await', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Write a JavaScript async function that fetches a URL and returns the JSON. Include error handling. Code only.' }] }])
    );

    await test('Code explanation', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Explain this code in one sentence: const f = n => n <= 1 ? n : f(n-1) + f(n-2);' }] }])
    );

    await test('SQL generation', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Write a SQL query to find the top 5 customers by total order amount from tables: customers(id, name) and orders(id, customer_id, amount). Code only.' }] }])
    );

    // ========================================
    //  6. MATH & REASONING
    // ========================================
    console.log('\n=== 6. Math & Reasoning ===');

    await test('Arithmetic', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'What is 17 * 23 + 45? Show your work briefly.' }] }])
    );

    await test('Word problem', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'A train travels 120km in 2 hours. It then travels 180km in 3 hours. What is the average speed for the entire journey? Answer with the number only.' }] }])
    );

    await test('Logic puzzle', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'If all roses are flowers, and some flowers fade quickly, can we conclude that some roses fade quickly? Answer yes or no and explain in one sentence.' }] }])
    );

    // ========================================
    //  7. STRUCTURED OUTPUT
    // ========================================
    console.log('\n=== 7. Structured Output ===');

    await test('JSON output (prompt-based)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'List 3 programming languages with their year of creation. Output valid JSON array: [{"name": "...", "year": ...}]. JSON only, no markdown.' }] }])
    );

    await test('JSON with responseMimeType', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'List 3 colors with hex codes as JSON array: [{"color":"...","hex":"..."}]' }] }],
        { responseMimeType: 'application/json', maxOutputTokens: 1024 })
    );

    await test('CSV output', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'List 3 countries with capital and population. Output as CSV with headers. No explanation.' }] }])
    );

    // ========================================
    //  8. TEMPERATURE EFFECTS
    // ========================================
    console.log('\n=== 8. Temperature Effects ===');

    await test('Temperature 0 (deterministic)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'What is the capital of France? One word answer.' }] }],
        { temperature: 0, maxOutputTokens: 64 })
    );

    await test('Temperature 2.0 (max creativity)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Invent a new word and define it.' }] }],
        { temperature: 2.0, maxOutputTokens: 256 })
    );

    // ========================================
    //  9. NATIVE TOOLS / FUNCTION CALLING
    // ========================================
    console.log('\n=== 9. Native Function Calling (expected to fail) ===');

    await test('tools parameter (should fail for Gemma)', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] }], {}, {
            tools: [{
                functionDeclarations: [{
                    name: 'get_weather',
                    description: 'Get weather for a city',
                    parameters: {
                        type: 'OBJECT',
                        properties: { city: { type: 'STRING', description: 'City name' } },
                        required: ['city']
                    }
                }]
            }]
        })
    );

    // ========================================
    //  10. PROMPT-BASED FUNCTION CALLING
    // ========================================
    console.log('\n=== 10. Prompt-based Function Calling ===');

    await test('Tool call via system prompt', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: `You have access to these tools:

<tools>
[{"name": "get_weather", "description": "Get current weather", "parameters": {"location": {"type": "string", "required": true}}}]
</tools>

When you need a tool, output:
<tool_call>
{"name": "tool_name", "arguments": {"key": "value"}}
</tool_call>

What is the weather in Tokyo?` }] }
        ])
    );

    await test('Tool result handling', () =>
        callAPI(MODEL, [
            { role: 'user', parts: [{ text: `You have access to these tools:
<tools>[{"name":"calculate","description":"Evaluate math","parameters":{"expression":{"type":"string","required":true}}}]</tools>
When you need a tool, output: <tool_call>{"name":"...","arguments":{...}}</tool_call>
What is 15 * 37?` }] },
            { role: 'model', parts: [{ text: '<tool_call>\n{"name": "calculate", "arguments": {"expression": "15 * 37"}}\n</tool_call>' }] },
            { role: 'user', parts: [{ text: '<tool_result>\n{"result": 555}\n</tool_result>' }] }
        ])
    );

    // ========================================
    //  11. CONTEXT WINDOW / LONG INPUT
    // ========================================
    console.log('\n=== 11. Context Window ===');

    await test('Medium context (4K tokens of text)', () => {
        const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(200);
        return callAPI(MODEL, [{ role: 'user', parts: [{ text: `Count approximately how many times the word "fox" appears in this text:\n\n${longText}\n\nJust give the number.` }] }],
        { maxOutputTokens: 128 });
    });

    // ========================================
    //  12. SAFETY / REFUSAL
    // ========================================
    console.log('\n=== 12. Safety Behavior ===');

    await test('Harmless edge case', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Explain how encryption works for security professionals.' }] }],
        { maxOutputTokens: 512 })
    );

    // ========================================
    //  13. MODEL VARIANTS
    // ========================================
    console.log('\n=== 13. Model Variants ===');

    const models = ['gemma-3-27b-it', 'gemma-3-12b-it', 'gemma-3-4b-it', 'gemma-3-1b-it'];
    for (const m of models) {
        await test(`${m} — basic test`, () =>
            callAPI(m, [{ role: 'user', parts: [{ text: 'What is 2+2? Answer with just the number.' }] }],
            { temperature: 0, maxOutputTokens: 32 })
        );
    }

    // ========================================
    //  14. API PARAMETER EXPLORATION
    // ========================================
    console.log('\n=== 14. API Parameter Exploration ===');

    await test('topK parameter', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
        { topK: 40, maxOutputTokens: 64 })
    );

    await test('topP parameter', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
        { topP: 0.5, maxOutputTokens: 64 })
    );

    await test('stopSequences parameter', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Count from 1 to 20, separated by commas.' }] }],
        { stopSequences: ['10'], maxOutputTokens: 256 })
    );

    await test('candidateCount > 1', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Say a random word.' }] }],
        { candidateCount: 2, maxOutputTokens: 32 })
    );

    // ========================================
    //  15. EDGE CASES
    // ========================================
    console.log('\n=== 15. Edge Cases ===');

    await test('Empty user message', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: '' }] }])
    );

    await test('Very short prompt', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Hi' }] }],
        { maxOutputTokens: 64 })
    );

    await test('Emoji handling', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'What does this emoji mean? 🎉' }] }],
        { maxOutputTokens: 128 })
    );

    await test('Mixed language in one prompt', () =>
        callAPI(MODEL, [{ role: 'user', parts: [{ text: 'Translate to English: 今天天气很好。Then translate to Japanese.' }] }],
        { maxOutputTokens: 256 })
    );

    // ========================================
    //  SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

    if (failed > 0) {
        console.log('\nFailed tests:');
        results.filter(r => !r.ok).forEach(r => {
            console.log(`  ✗ ${r.name}: ${r.error}`);
        });
    }

    // Token usage summary
    const withTokens = results.filter(r => r.tokens?.totalTokenCount);
    if (withTokens.length > 0) {
        const totalTokens = withTokens.reduce((sum, r) => sum + (r.tokens.totalTokenCount || 0), 0);
        console.log(`\nTotal tokens used: ${totalTokens}`);
    }

    // Latency summary
    const okResults = results.filter(r => r.ok);
    if (okResults.length > 0) {
        const avgMs = Math.round(okResults.reduce((s, r) => s + r.ms, 0) / okResults.length);
        const maxMs = Math.max(...okResults.map(r => r.ms));
        const minMs = Math.min(...okResults.map(r => r.ms));
        console.log(`Latency — avg: ${avgMs}ms, min: ${minMs}ms, max: ${maxMs}ms`);
    }

    // Write detailed results
    const reportPath = new URL('../test/live_results.json', import.meta.url);
    const { writeFileSync } = await import('fs');
    writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\nDetailed results saved to test/live_results.json`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
