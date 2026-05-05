// Viewport auto-translate.
// Walks the rendered textLayers, clusters spans into paragraphs, observes them
// with IntersectionObserver, queues visible ones, throttles API calls, and
// renders bilingual cards either to the side panel or to per-page columns
// depending on the current mode.

import { translate } from './translator.js';
import { getTrans, putTrans } from './db.js';

const INTER_CALL_DELAY_MS = 500;
const PARAGRAPH_MIN_CHARS = 12;

let active = false;
let panelEl = null;
let getCtx = null; // () => ({ docHash, lang, mode })
let observer = null;
const seenSegs = new Set();
const queue = [];
let processing = false;

export function startAutoTranslate({ panel, getContext }) {
  panelEl = panel;
  getCtx = getContext;
  if (active) return;
  active = true;
  if (panelEl) panelEl.classList.add('panel-open');
  scanAllPages();
}

export function stopAutoTranslate() {
  active = false;
  if (observer) { observer.disconnect(); observer = null; }
  queue.length = 0;
  processing = false;
  seenSegs.clear();
  if (panelEl) {
    panelEl.classList.remove('panel-open');
    const list = panelEl.querySelector('.panel-list');
    if (list) list.innerHTML = '';
  }
  document.querySelectorAll('.paragraph-anchor').forEach(el => el.remove());
  document.querySelectorAll('.translation-column').forEach(col => { col.innerHTML = ''; });
}

/**
 * Re-scan the current viewer DOM for paragraphs after a new PDF loads or mode
 * changes. Safe to call multiple times.
 */
export function rescanPages() {
  if (!active) return;
  if (observer) observer.disconnect();
  document.querySelectorAll('.paragraph-anchor').forEach(el => el.remove());
  document.querySelectorAll('.translation-column').forEach(col => { col.innerHTML = ''; });
  if (panelEl) {
    const list = panelEl.querySelector('.panel-list');
    if (list) list.innerHTML = '';
  }
  seenSegs.clear();
  scanAllPages();
}

function scanAllPages() {
  observer = new IntersectionObserver(onIntersect, {
    root: null,
    rootMargin: '200px 0px',
    threshold: 0.01
  });

  const pages = document.querySelectorAll('.pdf-page');
  pages.forEach((pageEl, pageIdx) => {
    const textLayer = pageEl.querySelector('.textLayer');
    if (!textLayer) return;
    const paragraphs = clusterParagraphs(textLayer);
    paragraphs.forEach((p, idx) => {
      const segId = `p${pageIdx + 1}_${idx}`;
      const anchor = document.createElement('div');
      anchor.className = 'paragraph-anchor';
      anchor.dataset.segId = segId;
      anchor.dataset.text = p.text;
      anchor.dataset.pageIdx = String(pageIdx);
      anchor.dataset.top = String(p.top);
      anchor.dataset.height = String(Math.max(8, p.bottom - p.top));
      anchor.style.position = 'absolute';
      anchor.style.left = `${p.left}px`;
      anchor.style.top = `${p.top}px`;
      anchor.style.width = `${Math.max(20, p.right - p.left)}px`;
      anchor.style.height = `${Math.max(8, p.bottom - p.top)}px`;
      anchor.style.pointerEvents = 'none';
      textLayer.appendChild(anchor);
      observer.observe(anchor);
    });
  });
}

function clusterParagraphs(textLayer) {
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
    if (!cur) {
      cur = newGroup(it);
      continue;
    }
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

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const anchor = entry.target;
    const segId = anchor.dataset.segId;
    if (seenSegs.has(segId)) continue;
    seenSegs.add(segId);
    queue.push({
      segId,
      text: anchor.dataset.text,
      pageIdx: parseInt(anchor.dataset.pageIdx, 10),
      top: parseFloat(anchor.dataset.top),
      height: parseFloat(anchor.dataset.height)
    });
    pump();
  }
}

async function pump() {
  if (processing || !active) return;
  processing = true;
  try {
    while (active && queue.length > 0) {
      const job = queue.shift();
      await processJob(job);
      if (queue.length > 0) {
        await sleep(INTER_CALL_DELAY_MS);
      }
    }
  } finally {
    processing = false;
  }
}

async function processJob(job) {
  const ctx = getCtx?.();
  if (!ctx) return;
  const { docHash, lang, mode } = ctx;
  const cardEl = ensureCard(job, mode);
  if (!cardEl) return;
  const transTarget = cardEl.querySelector('.card-target');

  try {
    const cached = docHash ? await getTrans(docHash, job.segId, lang) : null;
    if (cached) {
      transTarget.textContent = cached;
      cardEl.classList.add('card-ready');
      return;
    }
  } catch {}

  transTarget.innerHTML = '<span class="spinner"></span> Translating…';
  try {
    const out = await translate(job.text, lang);
    transTarget.textContent = out;
    cardEl.classList.add('card-ready');
    if (docHash && out) {
      try { await putTrans(docHash, job.segId, lang, out); } catch {}
    }
  } catch (e) {
    transTarget.textContent = '⚠️ ' + (e.message || e);
    cardEl.classList.add('card-error');
  }
}

function ensureCard(job, mode) {
  if (mode === 'bilingual') return ensureBilingualCard(job);
  return ensurePanelCard(job);
}

function ensurePanelCard(job) {
  if (!panelEl) return null;
  const list = panelEl.querySelector('.panel-list');
  let card = list.querySelector(`[data-seg-id="${job.segId}"]`);
  if (card) return card;
  card = makeCardElement(job);
  list.appendChild(card);
  list.scrollTop = list.scrollHeight;
  return card;
}

function ensureBilingualCard(job) {
  const rows = document.querySelectorAll('.bilingual-row');
  const row = rows[job.pageIdx];
  if (!row) return ensurePanelCard(job);
  const column = row.querySelector('.translation-column');
  if (!column) return ensurePanelCard(job);
  let card = column.querySelector(`[data-seg-id="${job.segId}"]`);
  if (card) return card;
  card = makeCardElement(job);
  card.classList.add('translation-card-bilingual');
  // Insert in segId numeric order so cards roughly match reading order even
  // when IO fires out-of-order during fast scroll.
  const existing = Array.from(column.querySelectorAll('.translation-card'));
  const newSeg = parseSegOrder(job.segId);
  const before = existing.find(el => parseSegOrder(el.dataset.segId) > newSeg);
  if (before) column.insertBefore(card, before); else column.appendChild(card);
  return card;
}

function parseSegOrder(segId) {
  // 'p3_5' -> 3.0005 (page-major)
  const m = /^p(\d+)_(\d+)$/.exec(segId);
  if (!m) return 0;
  return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10);
}

function makeCardElement(job) {
  const card = document.createElement('div');
  card.className = 'translation-card';
  card.dataset.segId = job.segId;
  card.innerHTML = `
    <div class="card-source"></div>
    <div class="card-arrow">↓</div>
    <div class="card-target"></div>
  `;
  card.querySelector('.card-source').textContent = truncate(job.text, 200);
  return card;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
