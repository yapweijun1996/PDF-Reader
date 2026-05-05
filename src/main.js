import 'pdfjs-dist/web/pdf_viewer.css';
import { renderPdf, onSelection } from './pdf-viewer.js';
import { translate, ensureKeysLoaded } from './translator.js';
import { explain } from './explain.js';
import { mountLangSelector, getTargetLang } from './settings.js';
import { initTooltip, showLoading, showResult, showError } from './tooltip.js';
import { wireUploadUI, openPdfFile, openPdfFromRecord } from './upload.js';
import { initHistoryDrawer } from './history.js';
import { getDocHash } from './db.js';
import { registerSW } from 'virtual:pwa-register';

const viewer = () => document.getElementById('viewer');
const statusEl = () => document.getElementById('status');

let currentDocHash = null;
let currentHasTextLayer = true;
let lastSelectionContext = '';

function status(msg) {
  const el = statusEl();
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

async function loadDemoPdf() {
  status('Loading demo PDF…');
  const url = `${import.meta.env.BASE_URL}attention.pdf`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  currentDocHash = await getDocHash(buf);
  const { hasTextLayer } = await renderPdf(new Uint8Array(buf), viewer());
  currentHasTextLayer = hasTextLayer;
  if (!hasTextLayer) {
    status('⚠️ Scanned PDF — translation unavailable.');
  } else {
    status('');
  }
}

async function handleFile(file) {
  try {
    const { docHash, hasTextLayer } = await openPdfFile(file, viewer(), status);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    if (!hasTextLayer) {
      status('⚠️ Scanned PDF — translation unavailable.');
      setTimeout(() => status(''), 4000);
    }
  } catch (e) {
    console.error(e);
    status(`⚠️ ${e.message}`);
    setTimeout(() => status(''), 4000);
  }
}

async function handleHistoryOpen(record) {
  try {
    const { docHash, hasTextLayer } = await openPdfFromRecord(record, viewer(), status);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    if (!hasTextLayer) {
      status('⚠️ Scanned PDF — translation unavailable.');
      setTimeout(() => status(''), 4000);
    }
  } catch (e) {
    console.error(e);
    status(`⚠️ ${e.message}`);
  }
}

async function boot() {
  initTooltip(async (phrase) => {
    const lang = getTargetLang();
    return explain(phrase, lastSelectionContext, lang, currentDocHash);
  });

  mountLangSelector(document.getElementById('targetLang'));

  wireUploadUI({
    pickButton: document.getElementById('uploadBtn'),
    fileInput: document.getElementById('fileInput'),
    dropZone: document.getElementById('dropZone'),
    onFile: handleFile
  });

  initHistoryDrawer({
    drawerEl: document.getElementById('historyDrawer'),
    openButton: document.getElementById('historyBtn'),
    closeButton: document.getElementById('historyClose'),
    onOpen: handleHistoryOpen
  });

  status('Loading API keys…');
  try {
    await ensureKeysLoaded();
  } catch (e) {
    console.error(e);
    status('⚠️ Failed to load API keys — translation disabled.');
  }

  try {
    await loadDemoPdf();
  } catch (e) {
    console.error(e);
    status('⚠️ Failed to load demo PDF: ' + e.message);
  }

  onSelection(async (text, rect) => {
    if (!currentHasTextLayer) return;
    lastSelectionContext = captureContext(text);
    const lang = getTargetLang();
    showLoading(text, rect);
    try {
      const out = await translate(text, lang);
      showResult(out);
    } catch (e) {
      console.error(e);
      showError(e.message || String(e));
    }
  });

  registerSW({ immediate: true });
}

function captureContext(selectedText) {
  // Capture the surrounding paragraph by walking up from the selection's
  // common ancestor and grabbing innerText, then truncating.
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return selectedText;
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    // walk up to a textLayer span container
    let ctx = '';
    let depth = 0;
    while (node && depth < 4) {
      const text = (node.innerText || node.textContent || '').trim();
      if (text.length > selectedText.length + 40) {
        ctx = text;
        break;
      }
      node = node.parentNode;
      depth++;
    }
    return ctx ? ctx.slice(0, 1500) : selectedText;
  } catch {
    return selectedText;
  }
}

boot();
