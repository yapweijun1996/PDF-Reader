// Selection-mode zoom controls.
//
// Renders a floating widget (− / %  / +) that lets the user scale the
// PDF page in selection mode. Reuses the same applyBilingualScale()
// helper as bilingual-resizer.js — both features write to the same
// `.pdf-page` data attributes, so the scale is consistent across modes.
//
// Hidden when:
//   - mode is not 'selection' (other modes have their own controls or
//     don't need one)
//   - the app is running as an installed PWA in standalone display mode
//     (per user request: PWA = locked ratio)

import { applyBilingualScale, getCurrentScale } from './bilingual-resizer.js';

const STORAGE_KEY = 'pdfReader.pageScale';
const STEP = 0.1;
const MIN = 0.5;
const MAX = 1.5;

let widgetEl = null;
let labelEl = null;

export function initZoomControls() {
  if (widgetEl) return;
  // Inherit any persisted bilingual scale value as the starting zoom so
  // selection / bilingual stay in sync after a reload.
  const saved = parseFloat(localStorage.getItem(STORAGE_KEY) || '');
  if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) {
    applyBilingualScale(saved);
  }

  widgetEl = document.createElement('div');
  widgetEl.className = 'zoom-controls';
  widgetEl.setAttribute('role', 'toolbar');
  widgetEl.setAttribute('aria-label', 'Zoom');
  widgetEl.innerHTML = `
    <button class="zoom-btn" data-zoom="out" type="button" aria-label="Zoom out">−</button>
    <button class="zoom-btn zoom-reset" data-zoom="reset" type="button" aria-label="Reset zoom">100%</button>
    <button class="zoom-btn" data-zoom="in" type="button" aria-label="Zoom in">+</button>
  `;
  labelEl = widgetEl.querySelector('.zoom-reset');
  document.body.appendChild(widgetEl);

  widgetEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.zoom-btn');
    if (!btn) return;
    const op = btn.dataset.zoom;
    const cur = getCurrentScale();
    let next = cur;
    if (op === 'in') next = Math.min(MAX, +(cur + STEP).toFixed(2));
    else if (op === 'out') next = Math.max(MIN, +(cur - STEP).toFixed(2));
    else if (op === 'reset') next = 1;
    applyBilingualScale(next);
    persist(next);
    updateLabel();
  });

  updateLabel();
}

function persist(v) {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
}

export function updateZoomLabel() {
  updateLabel();
}

function updateLabel() {
  if (!labelEl) return;
  const pct = Math.round(getCurrentScale() * 100);
  labelEl.textContent = `${pct}%`;
}
