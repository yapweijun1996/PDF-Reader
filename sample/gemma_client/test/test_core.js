// ============================================================
//  test/test_core.js — Unit tests for src/core.js
//  Tests: encryptKey, decryptKey, KeyManager, sleep
// ============================================================

import { encryptKey, decryptKey, KeyManager, sleep, fetchWithRetry } from '../src/core.js';
import { readFileSync } from 'fs';
import { assertEqual, assertTrue, assertThrows, assertGreater, group, results, resetResults, summarize } from './helpers.js';
import { HarnessConfig } from '../src/config.js';

export async function run() {
    resetResults();
    console.log('\n📦 test_core.js');

    // ── encrypt / decrypt roundtrip ──
    group('encryptKey / decryptKey');

    const rt = (msg, key, label) => assertEqual(decryptKey(encryptKey(msg, key), key), msg, label);
    rt('hello', 'secret', 'ASCII roundtrip');
    rt('', 'key', 'empty message roundtrip');
    rt('a', 'k', 'single char roundtrip');
    rt('Hello World 123!@#', 'mykey', 'mixed chars roundtrip');
    rt('abcdefghijklmnopqrstuvwxyz', 'ab', 'short key roundtrip');
    rt('ab', 'abcdefghijklmnopqrstuvwxyz', 'long key roundtrip');

    const cipher = encryptKey('test', 'key');
    assertTrue(/^\d+$/.test(cipher), 'ciphertext is all digits');
    assertEqual(cipher.length % 3, 0, 'ciphertext length is multiple of 3');

    // ── KeyManager construction ──
    group('KeyManager construction');

    const km = new KeyManager();
    assertEqual(km.count, 0, 'count is 0 initially');
    assertEqual(km.index, 0, 'index is 0');
    assertEqual(km.useCount, 0, 'useCount is 0');
    assertEqual(km.seed, '20250710', 'default seed');

    const km2 = new KeyManager({ rotateEveryN: 5, seed: 'custom' });
    assertEqual(km2.rotateEveryN, 5, 'custom rotateEveryN');
    assertEqual(km2.seed, 'custom', 'custom seed');

    // ── KeyManager key management ──
    group('KeyManager keys');

    km.addKey('key-a');
    km.addKey('key-b');
    km.addKey('key-c');
    assertEqual(km.count, 3, 'count after adding 3 keys');

    assertEqual(km.current(), 'key-a', 'first current() returns first key');
    // rotateEveryN=1, so second call triggers rotation
    assertEqual(km.current(), 'key-b', 'second call rotates to key-b');
    assertEqual(km.current(), 'key-c', 'third call rotates to key-c');
    assertEqual(km.current(), 'key-a', 'wraps around to key-a');

    const removed = km.invalidateCurrent();
    assertEqual(removed, 'key-a', 'invalidateCurrent removes active key');
    assertEqual(km.count, 2, 'count reduced after invalidation');
    assertEqual(km.current(), 'key-b', 'next current() uses next surviving key');

    // ── KeyManager rotation callback ──
    group('KeyManager rotation');

    const km3 = new KeyManager({ rotateEveryN: 2 });
    km3.addKey('x'); km3.addKey('y');
    let rotated = false;
    km3.onRotate((prev, next) => { rotated = true; });
    km3.current(); // useCount becomes 1
    assertEqual(rotated, false, 'no rotation after 1 use (rotateEveryN=2)');
    km3.current(); // useCount becomes 2
    assertEqual(rotated, false, 'no rotation after 2 uses yet');
    km3.current(); // useCount=2, check fires (2%2===0), rotates, then useCount becomes 3
    assertEqual(rotated, true, 'rotation fires on 3rd call (useCount=2 triggers)');

    // ── Load real keys from gemma_code.jsonl ──
    group('Decrypt gemma_code.jsonl');

    const keysPath = new URL('../gemma_code.jsonl', import.meta.url).pathname;
    const lines = readFileSync(keysPath, 'utf-8').split('\n').filter(l => l.trim());
    assertGreater(lines.length, 0, 'jsonl has lines');

    const keys = lines.map(l => { try { return decryptKey(JSON.parse(l).key, HarnessConfig.keys.seed); } catch { return null; } }).filter(Boolean);
    assertGreater(keys.length, 0, 'decrypted keys found');
    assertTrue(keys[0].startsWith('AIza'), 'first key starts with AIza (Google API key format)');

    // ── sleep ──
    group('sleep');

    const t0 = Date.now();
    await sleep(50);
    const elapsed = Date.now() - t0;
    assertTrue(elapsed >= 30 && elapsed < 200, `sleep(50) took ${elapsed}ms (30-200 range)`);

    // ── fetchWithRetry ──
    group('fetchWithRetry');

    {
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            if (calls === 1) throw new Error('transient');
            return { ok: true, status: 200, headers: { get: () => null } };
        };

        try {
            const response = await fetchWithRetry('https://example.com', {}, { maxRetries: 2, baseDelay: 1 });
            assertEqual(calls, 2, 'transport error retried once');
            assertEqual(response.status, 200, 'transport retry eventually succeeds');
        } finally {
            globalThis.fetch = originalFetch;
        }
    }

    return { total: results.total, passed: results.passed, failed: results.failed };
}

if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
