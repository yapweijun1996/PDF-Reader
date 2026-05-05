// Thin wrapper around legacy gemma.js (sample/gemma.js, copied unmodified).
// gemma.js is loaded as a classic <script> in index.html so its `var` declarations
// (loadApiKeys, callGeminiAPI, rotateKey, ...) become true window globals.

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

  await ensureKeysLoaded();

  const userMessage = {
    role: 'user',
    parts: [{
      text:
        `Translate the following text to ${targetLang}. ` +
        `Return ONLY the translation. No explanation, no quotes, no preamble.\n\n` +
        trimmed
    }]
  };

  const result = await window.callGeminiAPI(
    'gemma-3-27b-it',
    userMessage,
    [],
    { temperature: 0.3, maxOutputTokens: 1024 }
  );

  const out = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  cache.set(cacheKey, out);
  return out;
}
