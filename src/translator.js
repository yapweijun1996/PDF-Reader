// Thin wrapper around legacy gemma.js + optional user API key.
// gemma.js is loaded as a classic <script> in index.html; its `var` decls
// (loadApiKeys, callGeminiAPI, rotateKey, ...) become true window globals.
// When the user supplies their own API key via Settings, we bypass the
// rotation entirely and call the Gemini REST API directly with their key.

import { getActiveModelConfig } from './settings-modal.js';

const cache = new Map();
let initialized = false;
let initPromise = null;

export function ensureKeysLoaded() {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await window.loadApiKeys();
    initialized = true;
  })();
  return initPromise;
}

export async function translate(text, targetLang) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const cacheKey = `${targetLang}::${trimmed}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const userMessage = {
    role: 'user',
    parts: [{
      text:
        `Translate the following text to ${targetLang}. ` +
        `Return ONLY the translation. No explanation, no quotes, no preamble.\n\n` +
        trimmed
    }]
  };
  const generationConfig = { temperature: 0.3, maxOutputTokens: 1024 };

  const out = await callModel(userMessage, generationConfig);
  cache.set(cacheKey, out);
  return out;
}

/**
 * Dispatch to either the user's API key path (direct call) or the bundled
 * rotated keys path (gemma.js). Used by translator + explain.
 */
export async function callModel(userMessage, generationConfig) {
  const userCfg = await getActiveModelConfig();
  if (userCfg.apiKey) {
    return await callDirect(userCfg.model, userCfg.apiKey, userMessage, generationConfig);
  }
  await ensureKeysLoaded();
  const result = await window.callGeminiAPI(
    'gemma-3-27b-it',
    userMessage,
    [],
    generationConfig
  );
  return result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callDirect(model, apiKey, userMessage, generationConfig) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [userMessage], generationConfig })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt.slice(0, 200)}`);
  }
  const result = await res.json();
  return result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}
