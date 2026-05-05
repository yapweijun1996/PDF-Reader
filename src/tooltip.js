import * as tts from './tts.js';
import { detectLang } from './lang-detect.js';

const el = () => document.getElementById('tooltip');
const sourceEl = () => document.getElementById('tooltipSource');
const targetEl = () => document.getElementById('tooltipTarget');
const closeBtn = () => document.getElementById('tooltipClose');
const explainBtn = () => document.getElementById('tooltipExplain');
const explainBody = () => document.getElementById('tooltipExplainBody');
const handleEl = () => document.getElementById('tooltipHandle');
const speakTgtBtn = () => document.getElementById('tooltipSpeakTgt');

let initialized = false;
let onExplainClick = null;
let getTargetLangCb = null;
let currentSource = '';

export function initTooltip(onExplain, getTargetLang) {
  if (initialized) return;
  initialized = true;
  onExplainClick = onExplain;
  getTargetLangCb = getTargetLang;

  speakTgtBtn().addEventListener('click', (e) => {
    e.stopPropagation();
    const text = targetEl().textContent || '';
    if (!text || /^Translating|^⚠️/.test(text)) return;
    const langName = getTargetLangCb?.() || 'English';
    const tag = tts.langTagFor(langName);
    speakWith(speakTgtBtn(), text, tag);
  });

  closeBtn().addEventListener('click', hide);

  explainBtn().addEventListener('click', async () => {
    if (!currentSource || !onExplainClick) return;
    explainBtn().disabled = true;
    explainBody().hidden = false;
    explainBody().innerHTML = '<span class="spinner"></span> Loading explanation…';
    try {
      const payload = await onExplainClick(currentSource);
      renderExplain(payload);
    } catch (e) {
      explainBody().textContent = `⚠️ ${e.message || e}`;
    } finally {
      explainBtn().disabled = false;
    }
  });

  document.addEventListener('mousedown', (e) => {
    const t = el();
    if (!t.hidden && !t.contains(e.target)) hide();
  });

  wireDragToDismiss();
}

function wireDragToDismiss() {
  const handle = handleEl();
  const tip = el();
  if (!handle || !tip) return;
  let startY = 0;
  let dy = 0;
  let dragging = false;

  const onStart = (e) => {
    if (!isMobile()) return;
    dragging = true;
    startY = (e.touches?.[0]?.clientY) ?? e.clientY;
    dy = 0;
    tip.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    const y = (e.touches?.[0]?.clientY) ?? e.clientY;
    dy = Math.max(0, y - startY);
    tip.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    tip.style.transition = '';
    if (dy > 80) {
      hide();
    } else {
      tip.style.transform = '';
    }
  };

  handle.addEventListener('touchstart', onStart, { passive: true });
  handle.addEventListener('touchmove', onMove, { passive: true });
  handle.addEventListener('touchend', onEnd);
  handle.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
}

function isMobile() {
  return window.innerWidth < 640;
}

export function showLoading(sourceText, rect) {
  const t = el();
  currentSource = sourceText;
  sourceEl().textContent = truncate(sourceText, 200);
  targetEl().innerHTML = '<span class="spinner"></span> Translating…';
  explainBtn().hidden = false;
  explainBtn().disabled = false;
  explainBody().hidden = true;
  explainBody().innerHTML = '';
  t.style.transform = '';
  t.hidden = false;
  position(t, rect);
  requestAnimationFrame(() => t.classList.add('tooltip-in'));
}

export function showResult(translated) {
  targetEl().textContent = translated || '(empty)';
}

export function showError(msg) {
  targetEl().textContent = `⚠️ ${msg}`;
}

export function hide() {
  const t = el();
  t.classList.remove('tooltip-in');
  setTimeout(() => {
    t.hidden = true;
    t.style.transform = '';
  }, 180);
  currentSource = '';
}

function renderExplain(p) {
  // Backward compatibility: if cached payload has the old schema (PR #2),
  // render using the legacy block layout.
  if (!p || !p.schemaVersion || p.schemaVersion < 2) {
    renderExplainLegacy(p || {});
    return;
  }

  const sourceLang = p.sourceLang || detectLang(currentSource);
  const sourceTag = sourceLang.bcp47 || 'en-US';

  const sec = (icon, label, body, opts = {}) => body
    ? `<div class="explain-block ${opts.collapsible ? 'is-collapsible' : ''}" ${opts.collapsed ? 'data-collapsed="1"' : ''}>
         <div class="explain-label">${icon} ${label}${opts.collapsible ? ' <span class="explain-toggle">+</span>' : ''}</div>
         <div class="explain-body-text">${body}</div>
       </div>`
    : '';

  // Headword section: phrase + phonetic + partOfSpeech + CEFR badge
  // (No TTS button here — source language audio is intentionally omitted;
  // speak the *translation* via the main tooltip-target TTS button.)
  const head = `
    <div class="explain-head">
      <div class="explain-head-text">
        <span class="explain-headword">${escapeHtml(currentSource)}</span>
        ${p.phonetic ? `<span class="explain-phonetic">${escapeHtml(p.phonetic)}</span>` : ''}
      </div>
      <div class="explain-head-meta">
        ${p.partOfSpeech ? `<span class="badge badge-pos">${escapeHtml(p.partOfSpeech)}</span>` : ''}
        ${p.cefrLevel && p.cefrLevel !== 'unknown' ? `<span class="badge badge-cefr">${escapeHtml(p.cefrLevel)}</span>` : ''}
      </div>
    </div>`;

  const definitions = (p.definitionSrc || p.definitionTgt) ? `
    <div class="explain-block">
      <div class="explain-label">📖 Definition</div>
      ${p.definitionSrc ? `<div class="explain-def-src">${escapeHtml(p.definitionSrc)}</div>` : ''}
      ${p.definitionTgt ? `<div class="explain-def-tgt">${escapeHtml(p.definitionTgt)}</div>` : ''}
    </div>` : '';

  const examples = p.examples?.length ? `
    <div class="explain-block">
      <div class="explain-label">💡 Examples</div>
      <div class="explain-examples">
        ${p.examples.map(e => `
          <div class="explain-example">
            ${e.level ? `<div class="explain-example-head"><span class="badge badge-cefr badge-sm">${escapeHtml(e.level)}</span></div>` : ''}
            <div class="explain-example-src">${escapeHtml(e.src)}</div>
            <div class="explain-example-tgt">${escapeHtml(e.tgt)}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const collocations = p.collocations?.length
    ? sec('🔤', 'Collocations', `<div class="explain-chips">${p.collocations.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>`, { collapsible: true })
    : '';

  const family = p.wordFamily?.length ? sec('🌳', 'Word family', `
    <ul class="explain-list">
      ${p.wordFamily.map(w => `
        <li>
          <strong>${escapeHtml(w.word)}</strong>
          ${w.pos ? `<span class="muted"> (${escapeHtml(w.pos)})</span>` : ''}
          ${w.meaning ? ` — ${escapeHtml(w.meaning)}` : ''}
        </li>`).join('')}
    </ul>`, { collapsible: true }) : '';

  const synonyms = p.synonyms?.length ? sec('🔁', 'Synonyms', `
    <ul class="explain-list">
      ${p.synonyms.map(s => `
        <li>
          <strong>${escapeHtml(s.word)}</strong>
          ${s.note ? ` — <span class="muted">${escapeHtml(s.note)}</span>` : ''}
        </li>`).join('')}
    </ul>`, { collapsible: true }) : '';

  const antonyms = p.antonyms?.length
    ? sec('↔️', 'Antonyms', `<div class="explain-chips">${p.antonyms.map(a => `<span class="chip">${escapeHtml(a)}</span>`).join('')}</div>`, { collapsible: true })
    : '';

  const tip = p.memoryTip ? sec('💭', 'Memory tip', escapeHtml(p.memoryTip), { collapsible: true }) : '';
  const ctx = p.context ? sec('📍', 'In context', escapeHtml(p.context)) : '';

  explainBody().innerHTML = head + definitions + ctx + examples + collocations + family + synonyms + antonyms + tip;

  wireExplainInteractions();
}

function renderExplainLegacy(p) {
  const safe = (s) => String(s || '').trim();
  const list = (arr) => Array.isArray(arr) && arr.length
    ? `<ul>${arr.map(x => `<li>${escapeHtml(safe(x))}</li>`).join('')}</ul>`
    : '';
  const block = (icon, label, body) => body
    ? `<div class="explain-block"><div class="explain-label">${icon} ${label}</div><div class="explain-body-text">${body}</div></div>`
    : '';

  explainBody().innerHTML = [
    block('📖', 'Definition', escapeHtml(safe(p.definition))),
    block('📍', 'In context', escapeHtml(safe(p.context))),
    block('💡', 'Examples', list(p.examples)),
    block('🔗', 'Related', list(p.related))
  ].filter(Boolean).join('');
}

function wireExplainInteractions() {
  const root = explainBody();
  // TTS buttons
  root.querySelectorAll('.tts-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.dataset.tts;
      const lang = btn.dataset.lang || 'en-US';
      if (!text) return;
      speakWith(btn, text, lang);
    });
  });
  // Collapsible blocks
  root.querySelectorAll('.explain-block.is-collapsible .explain-label').forEach(label => {
    label.addEventListener('click', () => {
      const block = label.parentElement;
      const collapsed = block.dataset.collapsed === '1';
      block.dataset.collapsed = collapsed ? '0' : '1';
      const tog = block.querySelector('.explain-toggle');
      if (tog) tog.textContent = collapsed ? '−' : '+';
    });
  });
}

function speakWith(btn, text, langTag) {
  if (!text) return;
  tts.cancel();
  btn.classList.add('tts-btn-active');
  const lang = invertLang(langTag) || 'English';
  tts.speak(text, lang, {
    onend: () => btn.classList.remove('tts-btn-active'),
    onerror: () => btn.classList.remove('tts-btn-active')
  });
}

// Reverse the BCP-47 → lang-name map so tts.speak() can re-derive the tag
function invertLang(langTag) {
  const map = {
    'en-US': 'English', 'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)', 'ja-JP': 'Japanese',
    'ko-KR': 'Korean', 'es-ES': 'Spanish', 'fr-FR': 'French',
    'de-DE': 'German', 'pt-PT': 'Portuguese', 'ar-SA': 'Arabic',
    'hi-IN': 'Hindi', 'th-TH': 'Thai', 'vi-VN': 'Vietnamese',
    'ms-MY': 'Malay', 'id-ID': 'Indonesian'
  };
  return map[langTag];
}

function ttsSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M11 5l-6 4H3v6h2l6 4z" fill="currentColor" />
    <path d="M15 9c1.5 1 1.5 5 0 6" />
    <path d="M18 6c3 2 3 10 0 12" />
  </svg>`;
}

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function position(t, rect) {
  if (isMobile()) {
    // Bottom sheet — full width, anchored to bottom
    t.style.left = '0';
    t.style.right = '0';
    t.style.top = 'auto';
    t.style.bottom = '0';
    t.style.maxWidth = 'none';
    return;
  }
  if (!rect) return;
  const margin = 12;
  const tw = 380;
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 8;
  if (left + tw + margin > window.innerWidth) {
    left = window.innerWidth - tw - margin;
  }
  if (left < margin) left = margin;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
  t.style.right = 'auto';
  t.style.bottom = 'auto';
  t.style.maxWidth = `${tw}px`;
}
