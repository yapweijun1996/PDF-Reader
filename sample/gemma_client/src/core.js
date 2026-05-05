// ============================================================
//  core.js — XOR encryption, KeyManager, retry, sleep
// ============================================================

import { HarnessConfig } from './config.js';

const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

// --- Encryption / Decryption ---

export function encryptKey(message, key) {
    let ciphertext = '';
    const encoded = _encoder.encode(message);
    for (let i = 0; i < encoded.length; i++) {
        const xored = encoded[i] ^ key.charCodeAt(i % key.length);
        ciphertext += xored.toString().padStart(3, '0');
    }
    return ciphertext;
}

export function decryptKey(ciphertext, key) {
    let decoded = '';
    for (let i = 0; i < ciphertext.length; i += 3) {
        const num = parseInt(ciphertext.slice(i, i + 3));
        const ch = num ^ key.charCodeAt((i / 3) % key.length);
        decoded += String.fromCharCode(ch);
    }
    return _decoder.decode(new Uint8Array(_encoder.encode(decoded)));
}

// --- Key Manager ---

export class KeyManager {
    constructor(opts = {}) {
        this.keys = [];
        this.index = 0;
        this.useCount = 0;
        this.rotateEveryN = opts.rotateEveryN ?? HarnessConfig.keys.rotateEveryN;
        this.seed = opts.seed ?? HarnessConfig.keys.seed;
        this._onRotate = null;
    }

    async loadFromJSONL(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load keys: ' + res.status);
        const text = await res.text();
        this.keys = text.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(l => {
                try { return decryptKey(JSON.parse(l).key, this.seed); }
                catch { return null; /* invalid JSONL line — skip */ }
            })
            .filter(k => k && k.length > 0);
        if (this.keys.length === 0) throw new Error('No valid API keys found');
        this.index = 0;
        this.useCount = 0;
        return this.keys.length;
    }

    addKey(plaintextKey) {
        this.keys.push(plaintextKey);
    }

    current() {
        if (this.keys.length === 0) throw new Error('No API keys available.');
        if (this.useCount > 0 && this.useCount % this.rotateEveryN === 0 && this.keys.length > 1) {
            this.rotate();
        }
        this.useCount++;
        return this.keys[this.index];
    }

    rotate() {
        if (this.keys.length === 0) return;
        const prev = this.index;
        this.index = (this.index + 1) % this.keys.length;
        if (this._onRotate) this._onRotate(prev, this.index);
    }

    invalidateCurrent() {
        if (this.keys.length === 0) return null;
        const [removed] = this.keys.splice(this.index, 1);
        if (this.index >= this.keys.length) this.index = 0;
        this.useCount = 0;
        return removed || null;
    }

    onRotate(fn) {
        this._onRotate = fn;
    }

    get count() {
        return this.keys.length;
    }
}

// --- Helpers ---

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url, options, retryOpts = {}) {
    const maxRetries = retryOpts.maxRetries ?? HarnessConfig.api.retry.maxRetries;
    const baseDelay = retryOpts.baseDelay ?? HarnessConfig.api.retry.baseDelay;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status === 500) {
                if (attempt === maxRetries) return response;
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter
                    ? parseInt(retryAfter) * 1000
                    : baseDelay * Math.pow(2, attempt);
                await sleep(delay);
                continue;
            }
            return response;
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries) throw err;
            await sleep(baseDelay * Math.pow(2, attempt));
        }
    }

    throw lastError || new Error('fetchWithRetry exhausted without a response');
}
