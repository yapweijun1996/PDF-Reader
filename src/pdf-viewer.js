import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = (() => {
  const dpr = window.devicePixelRatio || 1;
  const baseScale = window.innerWidth < 768 ? 1.2 : 1.4;
  return baseScale * Math.min(dpr, 2);
})();

export async function renderPdf(url, container) {
  container.innerHTML = '';
  const pdf = await pdfjsLib.getDocument(url).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    await renderPage(page, container);
  }
  return pdf;
}

async function renderPage(page, container) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const cssScale = (window.innerWidth < 768)
    ? (window.innerWidth - 16) / viewport.width
    : Math.min(1, (container.clientWidth - 32) / viewport.width);

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page';
  wrapper.style.width = `${viewport.width * cssScale}px`;
  wrapper.style.height = `${viewport.height * cssScale}px`;

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
  container.appendChild(wrapper);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const scaledViewport = page.getViewport({ scale: viewport.scale * cssScale });
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport: scaledViewport
  });
  await textLayer.render();
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
