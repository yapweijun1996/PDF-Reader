// Paragraph clustering — shared between auto-translator and reader.
// Walks a rendered .textLayer's spans and groups them by Y-proximity, with
// font-size and left-margin guards that prevent academic front-matter
// (title + author block + emails + abstract) from collapsing into one blob.
// Returns [{ text, top, bottom, left, right }, ...].

const PARAGRAPH_MIN_CHARS = 12;
// Gap (vs line height) below which two lines belong to the same paragraph.
// Tight enough to split academic title/author/abstract blocks (typical
// inter-block gap ≈ 0.5-0.8 × lineH) while staying tolerant of standard
// body-text line spacing (~0.2 × lineH).
const PARA_GAP_RATIO = 0.4;
// Font-size delta (fraction of cur cluster's avg) that signals a
// structural break — title→authors→abstract typically jumps ≥ 30%.
const FONT_SIZE_DELTA_RATIO = 0.3;
// Left-edge drift (multiples of line height) that signals a column or
// alignment change — centred title vs left-aligned body, or column shift.
const LEFT_DRIFT_RATIO = 2;

export function extractParagraphs(textLayer) {
  const spans = Array.from(textLayer.querySelectorAll(':scope > span'));
  if (!spans.length) return [];
  const items = spans.map(s => {
    const top = parseFloat(s.style.top) || s.offsetTop || 0;
    const left = parseFloat(s.style.left) || s.offsetLeft || 0;
    const fontSize = parseFloat(s.style.fontSize) || s.offsetHeight || 12;
    return {
      el: s,
      top,
      left,
      width: s.offsetWidth || s.getBoundingClientRect().width || 0,
      height: s.offsetHeight || fontSize,
      fontSize,
      text: s.textContent || ''
    };
  }).filter(i => i.text.trim().length > 0);

  items.sort((a, b) => a.top - b.top || a.left - b.left);

  const groups = [];
  let cur = null;
  for (const it of items) {
    if (!cur) { cur = newGroup(it); continue; }
    if (sameParagraph(cur, it)) {
      cur.items.push(it);
      cur.bottom = Math.max(cur.bottom, it.top + it.height);
      cur.left = Math.min(cur.left, it.left);
      cur.right = Math.max(cur.right, it.left + it.width);
      cur.fontSum += it.fontSize;
    } else {
      groups.push(cur);
      cur = newGroup(it);
    }
  }
  if (cur) groups.push(cur);

  return groups
    .map(g => ({
      text: cleanText(g.items.map(i => i.text).join(' ')),
      top: g.top,
      bottom: g.bottom,
      left: g.left,
      right: g.right
    }))
    .filter(p => shouldTranslate(p.text));
}

/**
 * Three-signal split detector. All three must agree on "same paragraph"
 * for items to be merged; any one disagreeing triggers a break.
 *   1. Vertical gap < PARA_GAP_RATIO × lineH
 *   2. Font size matches cluster's running average within FONT_SIZE_DELTA_RATIO
 *   3. Left edge hasn't drifted more than LEFT_DRIFT_RATIO × lineH (catches
 *      title↔body and column shifts; tolerates first-line indent < 2× lineH)
 */
function sameParagraph(cur, it) {
  const lineH = Math.max(it.height, 12);
  const gap = it.top - cur.bottom;

  // Items overlapping in Y belong to the same visual line — always merge.
  // Font-size differences within a line are super/subscripts, inline math,
  // small caps; treating them as paragraph breaks would shred equations.
  if (gap < 0) return true;

  if (gap >= lineH * PARA_GAP_RATIO) return false;

  const curFontSize = cur.fontSum / cur.items.length;
  const fontDelta = Math.abs(curFontSize - it.fontSize) / Math.max(curFontSize, 1);
  if (fontDelta > FONT_SIZE_DELTA_RATIO) return false;

  const leftDrift = Math.abs(it.left - cur.left);
  if (leftDrift > lineH * LEFT_DRIFT_RATIO) return false;

  return true;
}

/**
 * Mechanical (regex-level) cleaning of raw extracted text. Cheap,
 * deterministic, runs before LLM. The LLM still does smarter cleaning
 * during translation, but this layer handles the obvious noise so we
 * don't waste tokens on it.
 */
export function cleanText(raw) {
  let t = String(raw || '');

  // Reconnect hyphenated line breaks like "se- quence" → "sequence"
  // Only fold if hyphen is between two lowercase letters (real word break)
  t = t.replace(/([a-z])-\s+([a-z])/g, '$1$2');

  // Strip stray emails (author-block leftovers if grouping merged them in)
  // Conservative pattern — needs @, dot, and word chars on both sides.
  t = t.replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g, '');

  // Strip citation markers: [1], [1, 2], [1-3], [1, 2, 5], [12]
  t = t.replace(/\s*\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g, '');

  // Strip standalone footnote markers when followed by space (mid-paragraph)
  t = t.replace(/\s[*†‡§¶★]+(?=\s)/g, ' ');

  // Strip footnote markers at start of paragraph
  t = t.replace(/^[\s*†‡§¶★]+/, '');

  // Collapse runs of whitespace (including non-breaking + line/paragraph seps)
  t = t.replace(/[\s\u00a0\u2028\u2029\u3000]+/g, ' ');

  // Smarten quotes like "He said , 'go'" → "He said, 'go'"
  t = t.replace(/\s+([,;.!?:])/g, '$1');

  return t.trim();
}

function newGroup(it) {
  return {
    items: [it],
    top: it.top,
    bottom: it.top + it.height,
    left: it.left,
    right: it.left + it.width,
    fontSum: it.fontSize
  };
}

// Tighter noise filter — academic PDFs surface a lot of metadata fragments
// (author lists, emails, footnote markers, citation lists, table headers)
// that translate badly and are pure noise when read aloud.
// Known publisher boilerplate that adds nothing for a reader and tends
// to land on title pages. Match conservatively — these phrases are
// distinctive enough that false positives are very unlikely.
const BOILERPLATE_PATTERNS = [
  /Google hereby grants permission/i,
  /Permission to make digital or hard copies/i,            // ACM
  /All rights reserved\b.*\b(?:reproduce|republish)/i,
  /This work is licensed under/i,
  /Provided proper attribution is provided/i,
  /arXiv:\s*\d{4}\.\d{4,5}/i                                // standalone arxiv stamp
];

function shouldTranslate(text) {
  const t = text.trim();
  if (t.length < PARAGRAPH_MIN_CHARS) return false;
  if (BOILERPLATE_PATTERNS.some(rx => rx.test(t))) return false;

  const wordChars = (t.match(/[A-Za-z一-鿿぀-ヿ]/g) || []).length;
  if (wordChars / t.length < 0.5) return false;

  // 1) Email-heavy lines (author email blocks)
  const emails = t.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
  const emailLen = emails.reduce((s, e) => s + e.length, 0);
  if (emailLen / t.length > 0.3) return false;

  // 2) Footnote-marker prefix + short text (* † ‡ § ¶ followed by a name)
  if (/^[\s*†‡§¶★]{1,20}[A-Z][\w.\s]{0,80}$/.test(t) && t.length < 100) return false;
  if (/^[*†‡§¶★]+\s/.test(t) && t.length < 80) return false;

  // 3) Repeated-token lines (table rows: "X X Y Y Z Z")
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) {
    const unique = new Set(tokens.map(s => s.toLowerCase()));
    if (unique.size / tokens.length < 0.4) return false;
  }

  // 4) Long strings without any space, CJK, or punctuation — usually URLs / IDs
  if (t.length > 30 && !/\s/.test(t) && !/[一-鿿぀-ヿ。、！？]/.test(t)) return false;

  // 5) Author-list heuristic: ≥4 English tokens, all start with uppercase,
  //    and no lowercase function words (the/of/and/in/is/with/for/a/an).
  const englishTokens = t.match(/\b[A-Za-z][A-Za-z'.-]*\b/g) || [];
  if (englishTokens.length >= 4) {
    const allTitleCase = englishTokens.every(w => /^[A-Z]/.test(w));
    const hasFunctionWord = /\b(the|of|and|in|is|with|for|on|to|by|that|this|are|was|were|from|as|or|but|we|our|these|those|their|its)\b/i.test(t);
    if (allTitleCase && !hasFunctionWord) return false;
  }

  // 6) Symbol-heavy / citation lists ("[1, 2, 5]", "[35, 2, 5]")
  const digitsAndPunct = (t.match(/[\d\[\],.\-:;()\/]/g) || []).length;
  if (digitsAndPunct / t.length > 0.5) return false;

  return true;
}

/**
 * Walk every rendered .pdf-page in the viewer and produce a flat ordered
 * list of paragraphs across the entire document.
 * Each entry: { segId, text, pageIdx, idxInPage }
 */
export function extractAllParagraphs() {
  const out = [];
  const pages = document.querySelectorAll('.pdf-page');
  pages.forEach((pageEl, pageIdx) => {
    const textLayer = pageEl.querySelector('.textLayer');
    if (!textLayer) return;
    extractParagraphs(textLayer).forEach((p, idx) => {
      out.push({
        segId: `p${pageIdx + 1}_${idx}`,
        text: p.text,
        pageIdx,
        idxInPage: idx
      });
    });
  });
  return out;
}
