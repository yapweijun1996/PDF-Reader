// ============================================================
//  test_client.js — Unit tests for src/client.js
//  Tests GemmaAPI failover behavior with mocked fetch
// ============================================================

import { GemmaAPI } from '../src/client.js';
import { KeyManager } from '../src/core.js';
import { assertContains, assertEqual, assertTrue, group, results, resetResults, summarize } from './helpers.js';

function makeKeyManager(keys) {
    const keyManager = new KeyManager({ rotateEveryN: 1 });
    for (const key of keys) keyManager.addKey(key);
    return keyManager;
}

function makeResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name] ?? null },
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
        json: async () => body
    };
}

export async function run() {
    resetResults();
    console.log('\n📦 test_client.js');

    group('GemmaAPI.generateContent failover');

    {
        const originalFetch = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url) => {
            calls.push(url);
            if (url.includes('key=key-a')) throw new Error('network down');
            return makeResponse(200, {
                candidates: [{ content: { parts: [{ text: 'ok' }] } }]
            });
        };

        try {
            const api = new GemmaAPI({
                keyManager: makeKeyManager(['key-a', 'key-b']),
                retryOpts: { maxRetries: 1, baseDelay: 1 }
            });
            const result = await api.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
            });
            assertEqual(result.candidates[0].content.parts[0].text, 'ok', 'network failure retries then rotates to next key');
            assertEqual(calls.length, 3, 'retries current key before rotating after transport failure');
            assertTrue(calls[0].includes('key=key-a'), 'first attempt uses first key');
            assertTrue(calls[1].includes('key=key-a'), 'transport retry reuses same key');
            assertTrue(calls[2].includes('key=key-b'), 'next key used after retries exhausted');
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    {
        const originalFetch = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url) => {
            calls.push(url);
            if (url.includes('key=key-a')) {
                return makeResponse(200, { candidates: [] });
            }
            return makeResponse(200, {
                candidates: [{ content: { parts: [{ text: 'recovered' }] } }]
            });
        };

        try {
            const api = new GemmaAPI({ keyManager: makeKeyManager(['key-a', 'key-b']) });
            const result = await api.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
            });
            assertEqual(result.candidates[0].content.parts[0].text, 'recovered', 'malformed success response rotates to next key');
            assertEqual(calls.length, 2, 'retried with second key after missing candidates');
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    {
        const originalFetch = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url) => {
            calls.push(url);
            if (url.includes('key=bad-key')) return makeResponse(403, { error: 'forbidden' });
            return makeResponse(200, {
                candidates: [{ content: { parts: [{ text: 'healthy' }] } }]
            });
        };

        try {
            const keyManager = makeKeyManager(['bad-key', 'good-key']);
            const api = new GemmaAPI({ keyManager });
            const result = await api.generateContent({
                contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
            });
            assertEqual(result.candidates[0].content.parts[0].text, 'healthy', '403 key is discarded and next key succeeds');
            assertEqual(keyManager.count, 1, 'invalid key removed from pool');
            assertEqual(calls.length, 2, 'forbidden key is not retried repeatedly');
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url) => {
            if (url.includes('key=key-a')) throw new Error('network down');
            return makeResponse(200, { candidates: [] });
        };

        try {
            const api = new GemmaAPI({
                keyManager: makeKeyManager(['key-a', 'key-b']),
                retryOpts: { maxRetries: 1, baseDelay: 1 }
            });
            let error = null;
            try {
                await api.generateContent({
                    contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
                });
            } catch (err) {
                error = err;
            }
            assertTrue(!!error, 'throws when all keys fail');
            assertContains(error.message, 'No candidates in API response', 'surfaces last failure reason');
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
