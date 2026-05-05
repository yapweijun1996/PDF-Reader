import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = (() => {
  const dpr = window.devicePixelRatio || 1;
  const baseScale = window.innerWidth < 768 ? 1.2 : 1.4;
  return baseScale * Math.min(dpr, 2);
})();

const BILINGUAL_COLUMN_WIDTH = 320;
const BILINGUAL_GUTTER = 24;
const BILINGUAL_BREAKPOINT = 1024;

function isBilingualLayoutEligible() {
  return window.innerWidth >= BILINGUAL_BREAKPOINT && document.body.classList.contains('mode-bilingual');
}

function computeCssScale(viewport, container) {
  if (window.innerWidth < 768) {
    return (window.innerWidth - 16) / viewport.width;
  }
  let available = container.clientWidth - 32;
  if (isBilingualLayoutEligible()) {
    available = available - BILINGUAL_COLUMN_WIDTH - BILINGUAL_GUTTER;
  }
  return Math.min(1, Math.max(0.4, available / viewport.width));
}

let currentPdf = null;

/**
 * Load and render a PDF from URL or ArrayBuffer/Blob source.
 * @param {string|ArrayBuffer|Uint8Array} source
 * @param {HTMLElement} container
 * @returns {{ pdf, hasTextLayer }}
 */
export async function renderPdf(source, container) {
  container.innerHTML = '';
  const loadingTask = typeof source === 'string'
    ? pdfjsLib.getDocument(source)
    : pdfjsLib.getDocument({ data: source });
  const pdf = await loadingTask.promise;
  currentPdf = pdf;

  let firstPageHasText = false;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const renderInfo = await renderPage(page, container);
    if (i === 1) firstPageHasText = renderInfo.textItemCount > 0;
  }
  return { pdf, hasTextLayer: firstPageHasText };
}

async function renderPage(page, container) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const cssScale = computeCssScale(viewport, container);

  const row = document.createElement('div');
  row.className = 'bilingual-row';

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page';
  wrapper.style.width = `${viewport.width * cssScale}px`;
  wrapper.style.height = `${viewport.height * cssScale}px`;

  const translationColumn = document.createElement('div');
  translationColumn.className = 'translation-column';
  translationColumn.style.height = `${viewport.height * cssScale}px`;

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const ctx = canvas.getContext('2d');

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale * cssScale));
  textLayerDiv.style.width = `${viewport.width * cssScale}px`;
  textLayerDiv.style.height = `${viewport.height * cssScale}px`;

  wrapper.appendChild(canvas);
  wrapper.appendChild(textLayerDiv);
  row.appendChild(wrapper);
  row.appendChild(translationColumn);
  container.appendChild(row);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const textItemCount = textContent?.items?.length || 0;
  if (textItemCount > 0) {
    const scaledViewport = page.getViewport({ scale: viewport.scale * cssScale });
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: scaledViewport
    });
    await textLayer.render();
  }
  return { textItemCount };
}

/**
 * Render the first page of a PDF as a low-res PNG dataURL thumbnail.
 */
export async function renderThumbnail(source, maxWidth = 200) {
  const loadingTask = typeof source === 'string'
    ? pdfjsLib.getDocument(source)
    : pdfjsLib.getDocument({ data: source });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const dataUrl = canvas.toDataURL('image/png');
  pdf.destroy();
  return dataUrl;
}

export function onSelection(handler) {
  let timer = null;
  let lastText = '';

  const fire = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || text === lastText) return;
    if (text.length < 2) return;
    let rect = null;
    try {
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
    } catch {}
    lastText = text;
    handler(text, rect);
  };

  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(fire, 250);
  };

  document.addEventListener('mouseup', debounced);
  document.addEventListener('touchend', debounced);

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) lastText = '';
  });
}

export function getCurrentPdf() {
  return currentPdf;
}
