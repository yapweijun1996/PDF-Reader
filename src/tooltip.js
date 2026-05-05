const el = () => document.getElementById('tooltip');
const sourceEl = () => document.getElementById('tooltipSource');
const targetEl = () => document.getElementById('tooltipTarget');
const closeBtn = () => document.getElementById('tooltipClose');
const explainBtn = () => document.getElementById('tooltipExplain');
const explainBody = () => document.getElementById('tooltipExplainBody');
const handleEl = () => document.getElementById('tooltipHandle');

let initialized = false;
let onExplainClick = null;
let currentSource = '';

export function initTooltip(onExplain) {
  if (initialized) return;
  initialized = true;
  onExplainClick = onExplain;

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
