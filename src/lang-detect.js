// Lightweight source-language detection by Unicode block voting.
// Not a real classifier — just enough to pick the right TTS voice and
// frame the Explain prompt. Returns { name, bcp47 }.

const BLOCKS = [
  { name: 'Chinese',     bcp47: 'zh-CN', re: /[一-鿿]/ },
  { name: 'Japanese',    bcp47: 'ja-JP', re: /[぀-ヿ]/ },
  { name: 'Korean',      bcp47: 'ko-KR', re: /[가-힯]/ },
  { name: 'Arabic',      bcp47: 'ar-SA', re: /[؀-ۿ]/ },
  { name: 'Hebrew',      bcp47: 'he-IL', re: /[֐-׿]/ },
  { name: 'Cyrillic',    bcp47: 'ru-RU', re: /[Ѐ-ӿ]/ },
  { name: 'Greek',       bcp47: 'el-GR', re: /[Ͱ-Ͽ]/ },
  { name: 'Devanagari',  bcp47: 'hi-IN', re: /[ऀ-ॿ]/ },
  { name: 'Thai',        bcp47: 'th-TH', re: /[฀-๿]/ }
];

export function detectLang(text) {
  if (!text) return { name: 'English', bcp47: 'en-US' };
  let best = null;
  let bestCount = 0;
  for (const b of BLOCKS) {
    const matches = text.match(new RegExp(b.re.source, 'g'));
    const count = matches ? matches.length : 0;
    if (count > bestCount) { bestCount = count; best = b; }
  }
  if (best && bestCount > 0) return { name: best.name, bcp47: best.bcp47 };

  // Latin-default: distinguish a few common European languages by diacritics
  // (best-effort; falls back to English when ambiguous).
  if (/[éèêëàâîïôûùüçœæ]/i.test(text)) return { name: 'French',     bcp47: 'fr-FR' };
  if (/[äöüß]/i.test(text))             return { name: 'German',     bcp47: 'de-DE' };
  if (/[áéíóúñ¿¡]/i.test(text))         return { name: 'Spanish',    bcp47: 'es-ES' };
  if (/[ãõáéíóúâêô]/i.test(text))       return { name: 'Portuguese', bcp47: 'pt-PT' };
  if (/\b(itu|adalah|dengan|yang|untuk|tidak)\b/i.test(text)) return { name: 'Malay', bcp47: 'ms-MY' };
  return { name: 'English', bcp47: 'en-US' };
}
