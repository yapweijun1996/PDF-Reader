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

/**
 * Highlight the card whose paragraph is currently being read aloud and
 * scroll it into view. Pass `segId === null` to clear the highlight.
 */
export function setSpeakingClass(cards, prevSegId, segId) {
  if (prevSegId) {
    cards.get(prevSegId)?.el.classList.remove('reader-card-speaking');
  }
  if (segId) {
    const card = cards.get(segId);
    if (card) {
      card.el.classList.add('reader-card-speaking');
      card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
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
