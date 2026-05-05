import 'pdfjs-dist/web/pdf_viewer.css';
import { renderPdf, onSelection } from './pdf-viewer.js';
import { translate, ensureKeysLoaded } from './translator.js';
import { explain } from './explain.js';
import { mountLangSelector, getTargetLang, getTranslateMode, setTranslateMode, MODES, MODE_LABELS, isAutoMode, isReaderMode } from './settings.js';
import { startAutoTranslate, stopAutoTranslate, rescanPages } from './auto-translator.js';
import { startReader, stopReader, rebuild as rebuildReader } from './reader.js';
import { initTTS } from './tts.js';
import { initTooltip, showLoading, showResult, showError } from './tooltip.js';
import { wireUploadUI, openPdfFile, openPdfFromRecord } from './upload.js';
import { initHistoryDrawer } from './history.js';
import { getDocHash } from './db.js';
import { toast } from './toast.js';
import { initOfflineBanner } from './offline.js';
import { initInstallPrompt } from './install.js';
import { registerSW } from 'virtual:pwa-register';

const viewer = () => document.getElementById('viewer');

let currentDocHash = null;
let currentHasTextLayer = true;
let lastSelectionContext = '';
let loadingToastId = null;

function setLoading(msg) {
  if (msg) {
    loadingToastId = toast(msg, { sticky: true, id: 'loading' });
  } else if (loadingToastId) {
    toast.dismiss(loadingToastId);
    loadingToastId = null;
  }
}

function notify(msg, opts) {
  return toast(msg, opts);
}

function initScrollAwareTopbar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  let lastY = window.scrollY;
  let ticking = false;
  const threshold = 8;
  const bypassZone = 80; // always show within 80px of top

  const update = () => {
    const y = window.scrollY;
    const delta = y - lastY;
    if (y < bypassZone) {
      topbar.classList.remove('topbar-hidden');
    } else if (delta > threshold) {
      topbar.classList.add('topbar-hidden');
    } else if (delta < -threshold) {
      topbar.classList.remove('topbar-hidden');
    }
    lastY = y;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
}

function autoCtx() {
  return {
    docHash: currentDocHash,
    lang: getTargetLang(),
    mode: getTranslateMode()
  };
}

function applyMode(mode) {
  document.body.classList.remove('mode-selection', 'mode-side', 'mode-bilingual', 'mode-overlay', 'mode-reader', 'auto-mode');
  document.body.classList.add(`mode-${mode}`);
  if (isAutoMode(mode)) document.body.classList.add('auto-mode');

  // Auto-translate (side / bilingual)
  if (isAutoMode(mode)) {
    startAutoTranslate({
      panel: document.getElementById('translationPanel'),
      getContext: autoCtx
    });
    if (currentHasTextLayer) rescanPages();
  } else {
    stopAutoTranslate();
  }

  // Reader (TTS)
  if (isReaderMode(mode)) {
    startReader({
      container: document.getElementById('readerView'),
      toolbar: document.getElementById('readerToolbar'),
      getContext: autoCtx
    });
  } else {
    stopReader();
  }
}

function mountModeSelector() {
  const sel = document.getElementById('modeSelect');
  if (!sel) return;
  sel.innerHTML = '';
  for (const value of Object.values(MODES)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = MODE_LABELS[value];
    sel.appendChild(opt);
  }
  sel.value = getTranslateMode();
  sel.addEventListener('change', () => {
    const next = sel.value;
    setTranslateMode(next);
    applyMode(next);
    notify(`Mode: ${MODE_LABELS[next]}`, { duration: 1800 });
  });
}

async function loadDemoPdf() {
  setLoading('Loading demo PDF…');
  try {
    const url = `${import.meta.env.BASE_URL}attention.pdf`;
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    currentDocHash = await getDocHash(buf);
    const { hasTextLayer } = await renderPdf(new Uint8Array(buf), viewer());
    currentHasTextLayer = hasTextLayer;
    if (!hasTextLayer) {
      notify('⚠️ Scanned PDF — translation unavailable', { duration: 5000 });
    }
    const m = getTranslateMode();
    if (isAutoMode(m) && hasTextLayer) rescanPages();
    if (isReaderMode(m) && hasTextLayer) rebuildReader();
  } finally {
    setLoading(null);
  }
}

async function handleFile(file) {
  try {
    const { docHash, hasTextLayer } = await openPdfFile(file, viewer(), setLoading);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    if (!hasTextLayer) {
      notify('⚠️ Scanned PDF — translation unavailable', { duration: 5000 });
    } else {
      notify('Opened: ' + file.name, { duration: 2500 });
    }
    const m = getTranslateMode();
    if (isAutoMode(m) && hasTextLayer) rescanPages();
    if (isReaderMode(m) && hasTextLayer) rebuildReader();
  } catch (e) {
    console.error(e);
    notify(`⚠️ ${e.message}`, { duration: 4000 });
  } finally {
    setLoading(null);
  }
}

async function handleHistoryOpen(record) {
  try {
    const { docHash, hasTextLayer } = await openPdfFromRecord(record, viewer(), setLoading);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    if (!hasTextLayer) {
      notify('⚠️ Scanned PDF — translation unavailable', { duration: 5000 });
    }
    const m = getTranslateMode();
    if (isAutoMode(m) && hasTextLayer) rescanPages();
    if (isReaderMode(m) && hasTextLayer) rebuildReader();
  } catch (e) {
    console.error(e);
    notify(`⚠️ ${e.message}`, { duration: 4000 });
  } finally {
    setLoading(null);
  }
}

async function boot() {
  initTooltip(async (phrase) => {
    const lang = getTargetLang();
    return explain(phrase, lastSelectionContext, lang, currentDocHash);
  });

  mountLangSelector(document.getElementById('targetLang'), () => {
    const m = getTranslateMode();
    if (isAutoMode(m) && currentHasTextLayer) rescanPages();
    if (isReaderMode(m) && currentHasTextLayer) rebuildReader();
  });

  mountModeSelector();

  document.getElementById('panelClearBtn').addEventListener('click', () => {
    const list = document.querySelector('#translationPanel .panel-list');
    if (list) list.innerHTML = '';
  });

  wireUploadUI({
    pickButton: document.getElementById('uploadBtn'),
    fileInput: document.getElementById('fileInput'),
    dropZone: document.getElementById('dropZone'),
    onFile: handleFile
  });

  initOfflineBanner();
  initInstallPrompt(document.getElementById('installBtn'));
  initScrollAwareTopbar();
  initTTS();

  initHistoryDrawer({
    drawerEl: document.getElementById('historyDrawer'),
    openButton: document.getElementById('historyBtn'),
    closeButton: document.getElementById('historyClose'),
    onOpen: handleHistoryOpen
  });

  setLoading('Loading API keys…');
  try {
    await ensureKeysLoaded();
  } catch (e) {
    console.error(e);
    notify('⚠️ Failed to load API keys — translation disabled', { duration: 6000 });
  }

  applyMode(getTranslateMode());

  try {
    await loadDemoPdf();
  } catch (e) {
    console.error(e);
    notify('⚠️ Failed to load demo PDF: ' + e.message, { duration: 6000 });
  } finally {
    setLoading(null);
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

  registerSW({
    immediate: true,
    onNeedRefresh() { window.location.reload(); },
    onOfflineReady() { console.log('[PWA] offline-ready'); }
  });
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
