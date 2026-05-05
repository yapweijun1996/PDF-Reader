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
  const cacheKey = `v2::${targetLang}::${trimmed}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const userMessage = {
    role: 'user',
    parts: [{
      text:
        `You are translating an academic / technical PDF paragraph to ${targetLang}.\n` +
        `\n` +
        `Before translating, silently clean the input:\n` +
        `- Drop citation markers like [1], [12, 5], [3-7] entirely (they're not content)\n` +
        `- Drop figure/table reference IDs like "(B)", "(C)", "Figure 2" if they appear mid-sentence as labels\n` +
        `- Drop footnote markers (* † ‡ § ¶) and the affiliations they introduce\n` +
        `- Reconnect words split by hyphens at line breaks (e.g. "se- quence" → "sequence")\n` +
        `- Skip pure metadata fragments (author lists, email addresses, table-cell duplicates)\n` +
        `- Keep math symbols / variable names (d_v, h_t, Q·K^T) as-is — do not translate them\n` +
        `- Normalize whitespace; do NOT add Markdown unless the source is structured (then GFM is fine)\n` +
        `\n` +
        `Output: the cleaned, fluent ${targetLang} translation only. ` +
        `No explanation, no quotes, no preamble. ` +
        `If after cleaning there is no content worth reading, output an empty string.\n` +
        `\n` +
        `INPUT:\n${trimmed}`
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
