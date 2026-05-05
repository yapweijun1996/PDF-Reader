// Paragraph clustering — shared between auto-translator and reader.
// Walks a rendered .textLayer's spans and groups them by Y-proximity into
// paragraphs. Returns [{ text, top, bottom, left, right }, ...].

const PARAGRAPH_MIN_CHARS = 12;

export function extractParagraphs(textLayer) {
  const spans = Array.from(textLayer.querySelectorAll(':scope > span'));
  if (!spans.length) return [];
  const items = spans.map(s => {
    const top = parseFloat(s.style.top) || s.offsetTop || 0;
    const left = parseFloat(s.style.left) || s.offsetLeft || 0;
    return {
      el: s,
      top,
      left,
      width: s.offsetWidth || s.getBoundingClientRect().width || 0,
      height: s.offsetHeight || parseFloat(s.style.fontSize) || 12,
      text: s.textContent || ''
    };
  }).filter(i => i.text.trim().length > 0);

  items.sort((a, b) => a.top - b.top || a.left - b.left);

  const groups = [];
  let cur = null;
  for (const it of items) {
    if (!cur) { cur = newGroup(it); continue; }
    const lineH = Math.max(it.height, 12);
    const gap = it.top - cur.bottom;
    // Within a paragraph, gap between line bottom and next line top is ~0.2x
    // line height. Between paragraphs it's typically ~1.0-1.2x. Threshold
    // 0.6 separates them while staying tolerant to slight irregularities.
    if (gap < lineH * 0.6) {
      cur.items.push(it);
      cur.bottom = Math.max(cur.bottom, it.top + it.height);
      cur.left = Math.min(cur.left, it.left);
      cur.right = Math.max(cur.right, it.left + it.width);
    } else {
      groups.push(cur);
      cur = newGroup(it);
    }
  }
  if (cur) groups.push(cur);

  return groups
    .map(g => ({
      text: g.items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim(),
      top: g.top,
      bottom: g.bottom,
      left: g.left,
      right: g.right
    }))
    .filter(p => shouldTranslate(p.text));
}

function newGroup(it) {
  return {
    items: [it],
    top: it.top,
    bottom: it.top + it.height,
    left: it.left,
    right: it.left + it.width
  };
}

// Tighter noise filter — academic PDFs surface a lot of metadata fragments
// (author lists, emails, footnote markers, citation lists, table headers)
// that translate badly and are pure noise when read aloud.
function shouldTranslate(text) {
  const t = text.trim();
  if (t.length < PARAGRAPH_MIN_CHARS) return false;

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
