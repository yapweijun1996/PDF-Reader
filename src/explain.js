import { getExplain, putExplain } from './db.js';

/**
 * Get a deep explanation for a phrase. Returns:
 * { definition, context, examples: string[], related: string[] }
 *
 * Uses IDB cache keyed by (docHash, phrase, lang). On parse failure,
 * returns a degraded shape with the raw text in `definition`.
 */
export async function explain(phrase, contextParagraph, lang, docHash) {
  const cached = docHash ? await getExplain(docHash, phrase, lang) : null;
  if (cached) return cached;

  const userMessage = {
    role: 'user',
    parts: [{
      text:
        `You are helping a learner read a research paper. ` +
        `The user highlighted: "${phrase}".\n\n` +
        `Surrounding context:\n"""${(contextParagraph || '').slice(0, 1200)}"""\n\n` +
        `Target language: ${lang}.\n\n` +
        `Return a strict JSON object with these keys (translate values to ${lang}):\n` +
        `{\n` +
        `  "definition": "general meaning, 1-2 sentences",\n` +
        `  "context": "what it means specifically in this paragraph, 1-2 sentences",\n` +
        `  "examples": ["3 short usage examples from similar texts"],\n` +
        `  "related": ["3-5 related technical terms"]\n` +
        `}\n` +
        `Return ONLY the JSON object. No markdown fences, no preamble.`
    }]
  };

  const result = await window.callGeminiAPI(
    'gemma-3-27b-it',
    userMessage,
    [],
    { temperature: 0.3, maxOutputTokens: 1024 }
  );

  const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  const parsed = parseJsonLoose(raw);

  const payload = parsed || {
    definition: raw || '(no response)',
    context: '',
    examples: [],
    related: []
  };

  if (docHash) {
    try { await putExplain(docHash, phrase, lang, payload); } catch {}
  }
  return payload;
}

function parseJsonLoose(s) {
  if (!s) return null;
  // Strip ```json ... ``` fences if present
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Try extracting first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}
