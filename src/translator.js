// Thin wrapper around legacy gemma.js (sample/gemma.js, copied unmodified).
// gemma.js attaches loadApiKeys / callGeminiAPI / rotateKey / etc. to the global scope.
import './gemma.js';

const cache = new Map();
let initialized = false;
let initPromise = null;

export function ensureKeysLoaded() {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // loadApiKeys is global from gemma.js
    await loadApiKeys();
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

  const result = await callGeminiAPI(
    'gemma-3-27b-it',
    userMessage,
    [],
    { temperature: 0.3, maxOutputTokens: 1024 }
  );

  const out = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  cache.set(cacheKey, out);
  return out;
}
