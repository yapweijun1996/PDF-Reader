// Reader View — translation-only flowing layout with TTS playback.
// On enter: extract all paragraphs across rendered pages, translate (using
// IDB cache), render flowing cards, expose a toolbar (play / pause / speed /
// show original toggle).

import { translate } from './translator.js';
import { getTrans, putTrans } from './db.js';
import { extractAllParagraphs } from './paragraphs.js';
import { renderMarkdown, looksLikeMarkdown } from './markdown.js';
import * as tts from './tts.js';

const INTER_CALL_DELAY_MS = 500;

let active = false;
let getCtx = null;        // () => ({ docHash, lang })
let containerEl = null;   // #readerView
let toolbarEl = null;     // #readerToolbar
let listEl = null;        // .reader-list
let allParagraphs = [];
let cards = new Map();    // segId -> { card, target, source, p }
let translationQueue = [];
let translating = false;

let playing = false;
let currentSpeakingSeg = null;
let playRate = 1;
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

  bindToolbar();
  rebuild();
}

export function stopReader() {
  active = false;
  stopPlayback();
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
  stopPlayback();
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
    const card = makeCard(p);
    cards.set(p.segId, card);
    translationQueue.push(p);
    frag.appendChild(card.el);
  }
  listEl.appendChild(frag);
  pumpTranslate();
}

function makeCard(p) {
  const el = document.createElement('article');
  el.className = 'reader-card';
  el.dataset.segId = p.segId;
  el.innerHTML = `
    <div class="reader-card-actions">
      <button class="reader-play-btn" type="button" aria-label="Read aloud">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
        </svg>
      </button>
    </div>
    <div class="reader-source"></div>
    <div class="reader-target"><span class="spinner"></span> Translating…</div>
  `;
  const sourceEl = el.querySelector('.reader-source');
  const targetEl = el.querySelector('.reader-target');
  sourceEl.textContent = p.text;

  el.querySelector('.reader-play-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    speakOne(p.segId);
  });

  return { el, target: targetEl, source: sourceEl, p };
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
      writeReaderTarget(card.target, cached);
      return;
    }
  } catch {}

  try {
    const out = await translate(p.text, lang);
    writeReaderTarget(card.target, out || '(empty)');
    if (docHash && out) {
      try { await putTrans(docHash, p.segId, lang, out); } catch {}
    }
  } catch (e) {
    card.target.textContent = '⚠️ ' + (e.message || e);
    card.el.classList.add('reader-card-error');
  }
}

function writeReaderTarget(el, text) {
  if (looksLikeMarkdown(text)) {
    el.innerHTML = renderMarkdown(text);
    el.classList.add('has-markdown');
  } else {
    el.textContent = text;
    el.classList.remove('has-markdown');
  }
}

// -------- TTS playback --------

function bindToolbar() {
  toolbarEl.querySelector('.reader-play-all').onclick = () => playing ? pause() : playFrom(currentSpeakingSeg || allParagraphs[0]?.segId);
  toolbarEl.querySelector('.reader-stop').onclick = stopPlayback;
  const rateInput = toolbarEl.querySelector('.reader-rate');
  rateInput.value = String(playRate);
  rateInput.oninput = () => {
    playRate = parseFloat(rateInput.value);
    toolbarEl.querySelector('.reader-rate-value').textContent = `${playRate.toFixed(2)}x`;
    if (playing && currentSpeakingSeg) {
      // Restart current paragraph with new rate
      speakSequence(currentSpeakingSeg);
    }
  };
  toolbarEl.querySelector('.reader-rate-value').textContent = `${playRate.toFixed(2)}x`;

  const toggle = toolbarEl.querySelector('.reader-toggle-original');
  toggle.checked = showOriginal;
  toggle.onchange = () => {
    showOriginal = toggle.checked;
    document.body.classList.toggle('hide-source', !showOriginal);
  };
}

function speakOne(segId) {
  stopPlayback();
  const card = cards.get(segId);
  if (!card) return;
  const ctx = getCtx?.();
  if (!ctx) return;
  const lang = ctx.lang;
  const text = card.target.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) return;
  setSpeaking(segId);
  tts.speak(text, lang, {
    rate: playRate,
    onend: () => setSpeaking(null),
    onerror: () => setSpeaking(null)
  });
}

function playFrom(segId) {
  if (!segId) return;
  playing = true;
  setPlayingButton(true);
  speakSequence(segId);
}

function speakSequence(segId) {
  const ctx = getCtx?.();
  if (!ctx) return;
  const lang = ctx.lang;
  const card = cards.get(segId);
  if (!card) { stopPlayback(); return; }
  const text = card.target.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) {
    // Skip until translation is ready or paragraph fails — try again in 600ms
    setTimeout(() => { if (playing) speakSequence(segId); }, 600);
    return;
  }
  setSpeaking(segId);
  tts.speak(text, lang, {
    rate: playRate,
    onend: () => {
      if (!playing) return;
      const next = nextSegAfter(segId);
      if (next) speakSequence(next);
      else stopPlayback();
    },
    onerror: () => {
      if (!playing) return;
      const next = nextSegAfter(segId);
      if (next) speakSequence(next);
      else stopPlayback();
    }
  });
}

function nextSegAfter(segId) {
  const idx = allParagraphs.findIndex(p => p.segId === segId);
  if (idx < 0 || idx >= allParagraphs.length - 1) return null;
  return allParagraphs[idx + 1].segId;
}

function pause() {
  playing = false;
  setPlayingButton(false);
  tts.cancel();
}

function stopPlayback() {
  playing = false;
  setPlayingButton(false);
  tts.cancel();
  setSpeaking(null);
}

function setPlayingButton(on) {
  const btn = toolbarEl?.querySelector('.reader-play-all');
  if (!btn) return;
  btn.classList.toggle('is-playing', on);
  btn.querySelector('.label').textContent = on ? 'Pause' : 'Read All';
}

function setSpeaking(segId) {
  if (currentSpeakingSeg) {
    cards.get(currentSpeakingSeg)?.el.classList.remove('reader-card-speaking');
  }
  currentSpeakingSeg = segId;
  if (segId) {
    const card = cards.get(segId);
    if (card) {
      card.el.classList.add('reader-card-speaking');
      card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
