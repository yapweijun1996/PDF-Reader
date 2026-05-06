// Bilingual mode column resizer.
//
// In bilingual mode each .bilingual-row is a flex container:
//   [.pdf-page] [.bilingual-resizer] [.translation-column flex:1]
//
// Dragging the resizer scales the PDF page (width + height + textLayer
// --scale-factor) by a multiplier. The translation column's flex:1
// auto-absorbs the remaining width. The multiplier persists in
// localStorage and applies to every page (so the layout stays uniform
// across the document).

// Unified storage key — shared with zoom-controls.js so the selection-mode
// zoom buttons and the bilingual-mode drag resizer write/read the same value.
const STORAGE_KEY = 'pdfReader.pageScale';
const LEGACY_KEY = 'pdfReader.bilingualScale';
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

let currentScale = loadScale();

export function getCurrentScale() { return currentScale; }

function loadScale() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || '';
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v >= MIN_SCALE && v <= MAX_SCALE) return v;
  } catch {}
  return 1;
}

function saveScale(v) {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
}

/**
 * Apply the current multiplier to every .pdf-page / .textLayer / column
 * height in the document. Idempotent — call after each PDF render and
 * after each drag end.
 */
export function applyBilingualScale(scale = currentScale) {
  currentScale = clamp(scale);
  document.querySelectorAll('.pdf-page').forEach(page => {
    const w = parseFloat(page.dataset.naturalWidth || '0');
    const h = parseFloat(page.dataset.naturalHeight || '0');
    if (!w || !h) return;
    page.style.width = `${w * currentScale}px`;
    page.style.height = `${h * currentScale}px`;
    const textLayer = page.querySelector('.textLayer');
    if (textLayer) {
      const sf = parseFloat(textLayer.dataset.naturalScaleFactor || '0');
      if (sf) textLayer.style.setProperty('--scale-factor', String(sf * currentScale));
      textLayer.style.width = `${w * currentScale}px`;
      textLayer.style.height = `${h * currentScale}px`;
    }
  });
  document.querySelectorAll('.translation-column').forEach(col => {
    const h = parseFloat(col.dataset.naturalHeight || '0');
    if (h) col.style.height = `${h * currentScale}px`;
  });
}

function clamp(v) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));
}

/**
 * Wire pointerdown on every .bilingual-resizer. Uses event delegation on
 * document so resizers added by future page renders are auto-handled.
 */
export function initBilingualResizer() {
  document.addEventListener('pointerdown', onPointerDown);
  // Re-apply scale when bilingual mode toggles on (page list might have
  // been re-rendered).
  applyBilingualScale();
}

function onPointerDown(e) {
  const handle = e.target?.closest?.('.bilingual-resizer');
  if (!handle) return;
  if (!document.body.classList.contains('mode-bilingual')) return;

  e.preventDefault();
  const row = handle.closest('.bilingual-row');
  if (!row) return;
  const page = row.querySelector('.pdf-page');
  if (!page) return;
  const naturalW = parseFloat(page.dataset.naturalWidth || '0');
  if (!naturalW) return;

  const startX = e.clientX;
  const startScale = currentScale;
  const startWidth = naturalW * startScale;
  // Available width for the PDF column = current pdf width + translation
  // width + gap. We compute it once at drag start and treat it as fixed.
  const rowRect = row.getBoundingClientRect();

  document.body.classList.add('bilingual-resizing');
  handle.setPointerCapture?.(e.pointerId);

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    // New PDF width in px → translate to scale multiplier.
    let newWidth = startWidth + dx;
    // Cap so translation column always has at least 240px.
    const maxPdfWidth = rowRect.width - 240;
    newWidth = Math.max(naturalW * MIN_SCALE, Math.min(maxPdfWidth, newWidth, naturalW * MAX_SCALE));
    const newScale = newWidth / naturalW;
    applyBilingualScale(newScale);
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('bilingual-resizing');
    saveScale(currentScale);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}
