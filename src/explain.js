// Deep-dictionary "study" Explain.
// Returns a payload designed for language learners, not just for translation:
// IPA + part of speech + CEFR + bilingual definitions + graded example
// sentences + collocations + word family + synonyms/antonyms + memory tip.
//
// Shape (schema v2):
// {
//   schemaVersion: 2,
//   sourceLang: { name, bcp47 },
//   phonetic: '/ipa/' | '',
//   partOfSpeech: 'noun' | ...,
//   cefrLevel: 'A1' | ... | 'C2' | 'unknown',
//   definitionSrc: '...',     // simple-words definition in source language
//   definitionTgt: '...',     // definition in target language
//   context: '...',           // what it means specifically in this paragraph
//   examples: [{ src, tgt, level }, ...],
//   collocations: ['...', ...],
//   wordFamily: [{ word, pos, meaning }, ...],
//   synonyms: [{ word, note }, ...],
//   antonyms: ['...', ...],
//   memoryTip: '...'
// }

import { getExplain, putExplain } from './db.js';
import { detectLang } from './lang-detect.js';

const SCHEMA_VERSION = 2;

export async function explain(phrase, contextParagraph, lang, docHash) {
  const cached = docHash ? await getExplain(docHash, phrase, lang) : null;
  if (cached?.schemaVersion === SCHEMA_VERSION) return cached;

  const sourceLang = detectLang(phrase);

  const userMessage = {
    role: 'user',
    parts: [{
      text: buildPrompt({
        phrase,
        contextParagraph: (contextParagraph || '').slice(0, 1200),
        sourceLangName: sourceLang.name,
        targetLang: lang
      })
    }]
  };

  const result = await window.callGeminiAPI(
    'gemma-3-27b-it',
    userMessage,
    [],
    { temperature: 0.3, maxOutputTokens: 1600 }
  );

  const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  const parsed = parseJsonLoose(raw) || {};

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    sourceLang,
    phonetic: stringy(parsed.phonetic),
    partOfSpeech: stringy(parsed.partOfSpeech),
    cefrLevel: stringy(parsed.cefrLevel) || 'unknown',
    definitionSrc: stringy(parsed.definitionSrc),
    definitionTgt: stringy(parsed.definitionTgt) || stringy(parsed.definition) || raw,
    context: stringy(parsed.context),
    examples: arrify(parsed.examples).map(e => ({
      src: stringy(e?.src),
      tgt: stringy(e?.tgt),
      level: stringy(e?.level)
    })).filter(e => e.src && e.tgt),
    collocations: arrify(parsed.collocations).map(stringy).filter(Boolean),
    wordFamily: arrify(parsed.wordFamily).map(w => ({
      word: stringy(w?.word),
      pos: stringy(w?.pos),
      meaning: stringy(w?.meaning)
    })).filter(w => w.word),
    synonyms: arrify(parsed.synonyms).map(s => ({
      word: stringy(s?.word),
      note: stringy(s?.note)
    })).filter(s => s.word),
    antonyms: arrify(parsed.antonyms).map(stringy).filter(Boolean),
    memoryTip: stringy(parsed.memoryTip)
  };

  if (docHash) {
    try { await putExplain(docHash, phrase, lang, payload); } catch {}
  }
  return payload;
}

function buildPrompt({ phrase, contextParagraph, sourceLangName, targetLang }) {
  return (
    `You are a language tutor. The user is a native ${targetLang} speaker reading a ${sourceLangName} text.\n` +
    `They highlighted: "${phrase}".\n` +
    (contextParagraph ? `Surrounding paragraph: """${contextParagraph}"""\n` : '') +
    `\n` +
    `Explain "${phrase}" so the learner can understand AND use it.\n` +
    `\n` +
    `CRITICAL rules for examples:\n` +
    `- Examples MUST use vocabulary SIMPLER than the target word/phrase, so the example teaches the word.\n` +
    `- Provide 3 examples in increasing difficulty (typically A2 → B1 → B2). Adjust if the phrase is itself elementary.\n` +
    `- Do NOT just paraphrase the surrounding paragraph — give fresh, natural examples.\n` +
    `\n` +
    `Return STRICT JSON ONLY. No markdown fences, no preamble, no commentary.\n` +
    `Schema:\n` +
    `{\n` +
    `  "phonetic": "/IPA/ or empty string if uncertain",\n` +
    `  "partOfSpeech": "noun|verb|adjective|adverb|phrase|...",\n` +
    `  "cefrLevel": "A1|A2|B1|B2|C1|C2|unknown",\n` +
    `  "definitionSrc": "definition in ${sourceLangName} using simple learner-friendly vocabulary",\n` +
    `  "definitionTgt": "definition in ${targetLang}, 1-2 sentences",\n` +
    `  "context": "${targetLang}: what it means specifically in the surrounding paragraph (or empty if no context)",\n` +
    `  "examples": [\n` +
    `    {"src": "easy ${sourceLangName} sentence using the word", "tgt": "${targetLang} translation", "level": "A2"},\n` +
    `    {"src": "medium sentence", "tgt": "${targetLang}", "level": "B1"},\n` +
    `    {"src": "harder sentence", "tgt": "${targetLang}", "level": "B2"}\n` +
    `  ],\n` +
    `  "collocations": ["3-5 common phrases that use this word naturally"],\n` +
    `  "wordFamily": [{"word": "...", "pos": "...", "meaning": "${targetLang}"}],\n` +
    `  "synonyms": [{"word": "...", "note": "${targetLang} note about nuance"}],\n` +
    `  "antonyms": ["..."],\n` +
    `  "memoryTip": "${targetLang}: short etymology or mnemonic (one sentence)"\n` +
    `}\n` +
    `If a section doesn't apply (e.g. no clear antonym), return an empty array or empty string for it.`
  );
}

function parseJsonLoose(s) {
  if (!s) return null;
  const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

function stringy(v) {
  return typeof v === 'string' ? v.trim() : (v != null ? String(v).trim() : '');
}

function arrify(v) {
  return Array.isArray(v) ? v : [];
}
