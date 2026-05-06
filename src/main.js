import 'pdfjs-dist/web/pdf_viewer.css';
import { initTheme } from './theme.js';

// Apply theme as the very first thing so first paint already has correct colors
initTheme();
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
import { openGalleryPaper } from './gallery.js';
import { getDocHash } from './db.js';
import { toast } from './toast.js';
import { initOfflineBanner } from './offline.js';
import { initInstallPrompt } from './install.js';
import { initBottomSheet } from './bottom-sheet.js';
import { initSettingsModal } from './settings-modal.js';
import { initBilingualResizer, applyBilingualScale } from './bilingual-resizer.js';
import { initZoomControls, updateZoomLabel } from './zoom-controls.js';
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
  // Sync the zoom widget label in case bilingual drag changed scale
  // before the user switched back to selection mode.
  updateZoomLabel();

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
    applyBilingualScale();
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
    applyBilingualScale();
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

async function handleGalleryOpen(entry) {
  try {
    const { docHash, hasTextLayer } = await openGalleryPaper(entry, viewer(), setLoading);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    notify('Opened: ' + entry.title, { duration: 2500 });
    if (!hasTextLayer) {
      notify('⚠️ Scanned PDF — translation unavailable', { duration: 5000 });
    }
    const m = getTranslateMode();
    if (isAutoMode(m) && hasTextLayer) rescanPages();
    if (isReaderMode(m) && hasTextLayer) rebuildReader();
  } catch (e) {
    console.error(e);
    notify(`⚠️ ${e.message}`, { duration: 6000 });
  } finally {
    setLoading(null);
  }
}

async function handleHistoryOpen(record) {
  try {
    const { docHash, hasTextLayer } = await openPdfFromRecord(record, viewer(), setLoading);
    currentDocHash = docHash;
    currentHasTextLayer = hasTextLayer;
    applyBilingualScale();
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
  }, getTargetLang);

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
  initBottomSheet({
    panel: document.getElementById('translationPanel'),
    handle: document.getElementById('panelHandle')
  });
  initSettingsModal({ openButton: document.getElementById('settingsBtn') });
  initBilingualResizer();
  initZoomControls();
  detectPwaStandalone();

  initHistoryDrawer({
    drawerEl: document.getElementById('historyDrawer'),
    openButton: document.getElementById('historyBtn'),
    closeButton: document.getElementById('historyClose'),
    onOpen: handleHistoryOpen,
    onOpenGallery: handleGalleryOpen
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
    onNeedRefresh() {
      console.log('[PWA] new version available — reloading');
      try { toast('Updating to latest version…', { duration: 1200 }); } catch {}
      setTimeout(() => window.location.reload(), 800);
    },
    onOfflineReady() { console.log('[PWA] offline-ready'); },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Aggressive auto-update: poll for new sw.js while the tab is visible.
      // skipWaiting + clientsClaim are configured in vite.config.js so the
      // new SW activates immediately; onNeedRefresh above forces a reload.
      const POLL_MS = 60_000;
      setInterval(() => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      }, POLL_MS);

      // Also check immediately whenever the user returns to the tab.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    }
  });
}

/**
 * When the app runs as an installed PWA in standalone display mode, lock
 * the viewport scale (no pinch zoom, no double-tap zoom). Tag the body
 * so CSS can hide our custom zoom widget too. In-browser tabs keep the
 * default user-scalable behavior so users can still pinch the page.
 */
function detectPwaStandalone() {
  const mq = window.matchMedia('(display-mode: standalone)');
  const apply = () => {
    const standalone = mq.matches || window.navigator.standalone === true;
    document.body.classList.toggle('pwa-standalone', standalone);
    if (standalone) {
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        meta.setAttribute('content',
          'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
      }
    }
  };
  apply();
  // Some browsers fire change when user installs/uninstalls. Re-apply.
  mq.addEventListener?.('change', apply);
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
