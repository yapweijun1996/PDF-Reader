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
    if (gap < lineH * 1.4) {
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

function shouldTranslate(text) {
  const t = text.trim();
  if (t.length < PARAGRAPH_MIN_CHARS) return false;
  const wordChars = (t.match(/[A-Za-z一-鿿぀-ヿ]/g) || []).length;
  if (wordChars / t.length < 0.5) return false;
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
