// Translation + generic LLM call surface, backed by the OpenAI-compatible
// gateway in gateway.js. Settings can override the model/key per user.

import { getActiveModelConfig } from './settings-modal.js';
import { callGateway } from './gateway.js';

const cache = new Map();

// Kept for API stability — boot() awaits this. The gateway loads its key
// lazily on first request, so there's nothing to preload here.
export function ensureKeysLoaded() {
  return Promise.resolve();
}

export async function translate(text, targetLang) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const cacheKey = `v3::${targetLang}::${trimmed}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const prompt =
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
    `INPUT:\n${trimmed}`;

  const out = await callModel(prompt, { temperature: 0.3 });
  cache.set(cacheKey, out);
  return out;
}

/**
 * Generic LLM dispatch used by translator + explain.
 * Accepts either a plain string prompt or a legacy Gemini-shaped userMessage
 * (`{ role, parts: [{ text }] }`) so older call sites keep working.
 */
export async function callModel(prompt, opts = {}) {
  const text = typeof prompt === 'string'
    ? prompt
    : (prompt?.parts?.[0]?.text || '');
  if (!text) return '';

  const cfg = await getActiveModelConfig();
  return callGateway({
    prompt: text,
    model: cfg.model || undefined,
    apiKey: cfg.apiKey || undefined,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    reasoningEffort: opts.reasoningEffort,
    signal: opts.signal
  });
}
