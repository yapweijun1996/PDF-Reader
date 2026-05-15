// Reader View orchestration: owns the active state, paragraph list, card
// map, and translation queue. Hands DOM work to ./renderer.js and TTS
// state to ./playback.js. Bound to the toolbar via reader-toolbar.js.

import { translate } from '../translator.js';
import { getTrans, putTrans } from '../db.js';
import { extractAllParagraphs } from '../paragraphs.js';
import { getReaderPrefs, READER_THEMES } from '../settings.js';
import { friendlyMessage } from '../llm-error.js';
import { renderReaderToolbar } from '../reader-toolbar.js';
import * as renderer from './renderer.js';
import * as playback from './playback.js';

const INTER_CALL_DELAY_MS = 500;
const FONT_STEP = 1;

let active = false;
let getCtx = null;       // () => ({ docHash, lang })
let containerEl = null;  // #readerView
let toolbarEl = null;    // #readerToolbar
let listEl = null;       // .reader-list
let allParagraphs = [];
let cards = new Map();   // segId -> { el, target, source, p }
let translationQueue = [];
let translating = false;
let toolbarCtl = null;
let showOriginal = true;

export function startReader({ container, toolbar, getContext }) {
  containerEl = container;
  toolbarEl = toolbar;
  listEl = container.querySelector('.reader-list');
  getCtx = getContext;
  if (active) return;
  active = true;
  containerEl.hidden = false;
  document.body.classList.add('reader-open');

  const prefs = renderer.applyInitialPrefs(containerEl);
  showOriginal = prefs.showSource;

  playback.initPlayback({
    getCards: () => cards,
    getParagraphs: () => allParagraphs,
    getCtx: () => getCtx?.(),
    getToolbarCtl: () => toolbarCtl
  });

  bindToolbar();
  rebuild();
}

export function stopReader() {
  active = false;
  playback.stopPlayback();
  if (containerEl) containerEl.hidden = true;
  document.body.classList.remove('reader-open');
  if (listEl) listEl.innerHTML = '';
  cards.clear();
  allParagraphs = [];
  translationQueue.length = 0;
}

/**
 * Re-extract paragraphs (e.g. after a new PDF loads or lang switches).
 */
export function rebuild() {
  if (!active) return;
  playback.stopPlayback();
  if (listEl) listEl.innerHTML = '';
  cards.clear();
  translationQueue.length = 0;
  allParagraphs = extractAllParagraphs();

  if (allParagraphs.length === 0) {
    listEl.innerHTML = '<div class="reader-empty">No translatable text in this PDF.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const p of allParagraphs) {
    const card = renderer.makeCard(p, { onPlay: playback.speakOne });
    cards.set(p.segId, card);
    translationQueue.push(p);
    frag.appendChild(card.el);
  }
  listEl.appendChild(frag);
  pumpTranslate();
}

async function pumpTranslate() {
  if (translating || !active) return;
  translating = true;
  try {
    while (active && translationQueue.length > 0) {
      const p = translationQueue.shift();
      await translateOne(p);
      if (translationQueue.length > 0) await sleep(INTER_CALL_DELAY_MS);
    }
  } finally {
    translating = false;
  }
}

async function translateOne(p) {
  const card = cards.get(p.segId);
  if (!card) return;
  const ctx = getCtx?.();
  if (!ctx) return;
  const { docHash, lang } = ctx;

  try {
    const cached = docHash ? await getTrans(docHash, p.segId, lang) : null;
    if (cached) {
      renderer.writeReaderTarget(card.target, cached);
      return;
    }
  } catch {}

  try {
    const out = await translate(p.text, lang);
    renderer.writeReaderTarget(card.target, out || '(empty)');
    if (docHash && out) {
      try { await putTrans(docHash, p.segId, lang, out); } catch {}
    }
  } catch (e) {
    card.target.textContent = '⚠️ ' + friendlyMessage(e);
    card.el.classList.add('reader-card-error');
  }
}

function bindToolbar() {
  // All toolbar markup + wiring lives in reader-toolbar.js. We just hand
  // over a handlers map and stash the returned controls for state sync.
  toolbarCtl = renderReaderToolbar(toolbarEl, {
    playAll: () => playback.togglePlayAll(allParagraphs[0]?.segId),
    stop: playback.stopPlayback,
    rate: (v) => playback.setRate(v),
    showSource: (on) => {
      showOriginal = on;
      renderer.setShowSource(on);
    },
    fontDec: () => renderer.bumpFont(containerEl, -FONT_STEP),
    fontInc: () => renderer.bumpFont(containerEl, +FONT_STEP),
    theme: (t) => {
      const theme = READER_THEMES.includes(t) ? t : 'dark';
      renderer.setTheme(containerEl, theme);
    },
    cacheAll: playback.cacheAllAudio,
    downloadWav: playback.downloadAllAudio,
    exportTxt
  });
  toolbarCtl.setRate(playback.getRate());
  toolbarCtl.setShowSource(showOriginal);
  toolbarCtl.setTheme(getReaderPrefs().theme);
}

function exportTxt() {
  if (!allParagraphs.length) return;
  const ctx = getCtx?.();
  const lang = ctx?.lang || '';
  const lines = [`Translation export — target language: ${lang}`, '='.repeat(60), ''];
  for (const p of allParagraphs) {
    const card = cards.get(p.segId);
    const tgt = card?.target?.textContent || '(not yet translated)';
    lines.push(`[${p.segId}]`);
    lines.push(p.text);
    lines.push('---');
    lines.push(tgt);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `translation-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
