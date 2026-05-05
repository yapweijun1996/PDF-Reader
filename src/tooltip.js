const el = () => document.getElementById('tooltip');
const sourceEl = () => document.getElementById('tooltipSource');
const targetEl = () => document.getElementById('tooltipTarget');
const closeBtn = () => document.getElementById('tooltipClose');

let initialized = false;

export function initTooltip() {
  if (initialized) return;
  initialized = true;
  closeBtn().addEventListener('click', hide);
  document.addEventListener('mousedown', (e) => {
    const t = el();
    if (!t.hidden && !t.contains(e.target)) hide();
  });
}

export function showLoading(sourceText, rect) {
  const t = el();
  sourceEl().textContent = truncate(sourceText, 200);
  targetEl().innerHTML = '<span class="spinner"></span> Translating…';
  t.hidden = false;
  position(t, rect);
}

export function showResult(translated) {
  targetEl().textContent = translated || '(empty)';
}

export function showError(msg) {
  targetEl().textContent = `⚠️ ${msg}`;
}

export function hide() {
  el().hidden = true;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function position(t, rect) {
  if (!rect) return;
  const isMobile = window.innerWidth < 640;
  if (isMobile) {
    t.style.left = '8px';
    t.style.right = '8px';
    t.style.top = 'auto';
    t.style.bottom = '12px';
    t.style.maxWidth = 'none';
    return;
  }
  const margin = 12;
  const tw = 360;
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
