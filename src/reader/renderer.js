// Pure DOM helpers for Reader view. No module-level state — every function
// takes its inputs explicitly so it's easy to test and to reason about.

import { renderMarkdown, looksLikeMarkdown } from '../markdown.js';
import { getReaderPrefs, setReaderPrefs } from '../settings.js';

const FONT_MIN = 13;
const FONT_MAX = 26;

/**
 * Build one paragraph card. The play button wiring is injected so this
 * module never has to know about the playback state machine.
 */
export function makeCard(p, { onPlay }) {
  const el = document.createElement('article');
  el.className = 'reader-card';
  el.dataset.segId = p.segId;
  // Target (translation) renders ABOVE source — for a reader app the
  // translation is the primary content, source is the reference.
  el.innerHTML = `
    <div class="reader-card-actions">
      <button class="reader-jump-btn" type="button" aria-label="Jump to source in PDF" title="Open this paragraph in the PDF view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17 17 7"/>
          <path d="M9 7h8v8"/>
        </svg>
      </button>
      <button class="reader-play-btn" type="button" aria-label="Read aloud">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
        </svg>
      </button>
    </div>
    <div class="reader-target"><span class="spinner"></span> Translating…</div>
    <div class="reader-source"></div>
  `;
  const sourceEl = el.querySelector('.reader-source');
  const targetEl = el.querySelector('.reader-target');
  sourceEl.textContent = p.text;

  el.querySelector('.reader-play-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onPlay(p.segId);
  });
  el.querySelector('.reader-jump-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    // Decoupled handoff to main.js — controller doesn't need to know
    // anything about mode switching or the PDF viewer.
    document.dispatchEvent(new CustomEvent('reader-jump-to-source', {
      detail: { segId: p.segId }
    }));
  });

  return { el, target: targetEl, source: sourceEl, p };
}

/**
 * Write the translated text into a card's target slot. Renders as
 * markdown if it looks structured, plain text otherwise.
 */
export function writeReaderTarget(el, text) {
  if (looksLikeMarkdown(text)) {
    el.innerHTML = renderMarkdown(text);
    el.classList.add('has-markdown');
  } else {
    el.textContent = text;
    el.classList.remove('has-markdown');
  }
}

/**
 * Replace a card's target with an error message + retry button. The
 * caller wires the retry handler; renderer only owns the DOM.
 */
export function showCardError(card, message, onRetry) {
  card.target.classList.remove('has-markdown');
  card.target.innerHTML = '';
  const msg = document.createElement('span');
  msg.className = 'reader-error-msg';
  msg.textContent = '⚠️ ' + message;
  card.target.appendChild(msg);
  if (onRetry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reader-retry-btn';
    btn.textContent = '↻ Retry';
    btn.addEventListener('click', onRetry);
    card.target.appendChild(btn);
  }
  card.el.classList.add('reader-card-error');
}

/**
 * Reset a card back to its "translating" state — called when a retry
 * is requested, before the new translation attempt begins.
 */
export function resetCardForRetry(card) {
  card.el.classList.remove('reader-card-error');
  card.target.classList.remove('has-markdown');
  card.target.innerHTML = '<span class="spinner"></span> Translating…';
}

/**
 * Apply persisted prefs (theme / font size / line height / show-source)
 * to the reader container. Returns the resolved prefs so the caller can
 * stash the initial `showSource` value for its own state.
 */
export function applyInitialPrefs(containerEl) {
  const prefs = getReaderPrefs();
  containerEl.dataset.theme = prefs.theme;
  containerEl.style.setProperty('--r-font-size', `${prefs.fontSize}px`);
  containerEl.style.setProperty('--r-line-height', String(prefs.lineHeight));
  document.body.classList.toggle('hide-source', !prefs.showSource);
  return prefs;
}

export function setShowSource(on) {
  document.body.classList.toggle('hide-source', !on);
  setReaderPrefs({ showSource: on });
}

export function setTheme(containerEl, theme) {
  containerEl.dataset.theme = theme;
  setReaderPrefs({ theme });
}

export function bumpFont(containerEl, delta) {
  const prefs = getReaderPrefs();
  const newSize = Math.max(FONT_MIN, Math.min(FONT_MAX, prefs.fontSize + delta));
  containerEl.style.setProperty('--r-font-size', `${newSize}px`);
  setReaderPrefs({ fontSize: newSize });
}

// Suppress auto-scroll for a few seconds after the user manually
// scrolls — otherwise playback yanks the viewport away from whatever
// they were trying to read. Listeners self-install on first call so
// the controller doesn't have to thread setup through start/stop.
const SCROLL_QUIET_MS = 3000;
let lastUserScrollAt = 0;
let scrollTrackingInit = false;

function initScrollTracking() {
  if (scrollTrackingInit) return;
  scrollTrackingInit = true;
  const stamp = () => { lastUserScrollAt = Date.now(); };
  window.addEventListener('wheel', stamp, { passive: true });
  window.addEventListener('touchmove', stamp, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Space'].includes(e.code)) {
      stamp();
    }
  });
}

/**
 * Highlight the card whose paragraph is currently being read aloud and
 * scroll it into view (unless the user was just scrolling, in which
 * case we don't fight them). Pass `segId === null` to clear.
 */
export function setSpeakingClass(cards, prevSegId, segId) {
  initScrollTracking();
  if (prevSegId) {
    cards.get(prevSegId)?.el.classList.remove('reader-card-speaking');
  }
  if (segId) {
    const card = cards.get(segId);
    if (card) {
      card.el.classList.add('reader-card-speaking');
      const userBrowsing = Date.now() - lastUserScrollAt < SCROLL_QUIET_MS;
      if (!userBrowsing) {
        card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

// -------- Viewport-center "current paragraph" tracking --------

let currentSegEl = null;
let intersectObserver = null;

/**
 * Tag whichever card is closest to the viewport center as
 * `reader-card-current`. Used by the toolbar's Read All button to
 * start playback from where the user is actually looking, instead of
 * always from paragraph 1. Safe to call multiple times — it tears
 * down the previous observer first.
 */
export function trackCurrentParagraph(listEl) {
  stopTrackingCurrentParagraph();
  // Only cards intersecting the central 20% strip of the viewport count.
  intersectObserver = new IntersectionObserver((entries) => {
    const inView = entries.filter(e => e.isIntersecting);
    if (!inView.length) return;
    const center = window.innerHeight / 2;
    inView.sort((a, b) => {
      const am = a.boundingClientRect.top + a.boundingClientRect.height / 2;
      const bm = b.boundingClientRect.top + b.boundingClientRect.height / 2;
      return Math.abs(am - center) - Math.abs(bm - center);
    });
    const newEl = inView[0].target;
    if (newEl === currentSegEl) return;
    if (currentSegEl) currentSegEl.classList.remove('reader-card-current');
    currentSegEl = newEl;
    currentSegEl.classList.add('reader-card-current');
  }, {
    root: null,
    rootMargin: '-40% 0px -40% 0px',
    threshold: 0
  });
  listEl.querySelectorAll('.reader-card').forEach(c => intersectObserver.observe(c));
}

export function stopTrackingCurrentParagraph() {
  intersectObserver?.disconnect();
  intersectObserver = null;
  if (currentSegEl) currentSegEl.classList.remove('reader-card-current');
  currentSegEl = null;
}

export function getCurrentSegId() {
  return currentSegEl?.dataset.segId || null;
}

// -------- Progress bar (shared by audio caching + playback) --------

export function showProgress(done, total, label) {
  const bar = document.getElementById('readerProgress');
  if (!bar) return;
  bar.hidden = false;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  bar.querySelector('.reader-progress-bar').style.width = `${pct}%`;
  bar.querySelector('.reader-progress-label').textContent = label;
}

export function hideProgress() {
  const bar = document.getElementById('readerProgress');
  if (bar) bar.hidden = true;
}

/**
 * Playback-specific progress: outer = paragraph index / total,
 * inner = chunk synth progress within current paragraph.
 */
export function updateReadProgress(allParagraphs, segId, chunkInfo) {
  const bar = document.getElementById('readerProgress');
  if (!bar) return;
  const idx = allParagraphs.findIndex(p => p.segId === segId);
  if (idx < 0 || allParagraphs.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const outer = idx / allParagraphs.length;
  const inner = chunkInfo && chunkInfo.totalChunks
    ? (chunkInfo.chunkIdx / chunkInfo.totalChunks) / allParagraphs.length
    : 0;
  const pct = Math.min(100, Math.round((outer + inner) * 100));
  bar.querySelector('.reader-progress-bar').style.width = `${pct}%`;
  const label = bar.querySelector('.reader-progress-label');
  let text = `Reading ${idx + 1} / ${allParagraphs.length}`;
  if (chunkInfo && chunkInfo.totalChunks > 1) {
    if (chunkInfo.phase === 'synth') {
      text += ` · synthesizing chunk ${chunkInfo.chunkIdx + 1}/${chunkInfo.totalChunks}`;
    } else if (chunkInfo.phase === 'chunk-done') {
      text += ` · chunk ${chunkInfo.chunkIdx}/${chunkInfo.totalChunks} ready`;
    }
  }
  label.textContent = text;
}
