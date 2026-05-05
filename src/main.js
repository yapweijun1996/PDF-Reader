import 'pdfjs-dist/web/pdf_viewer.css';
import { renderPdf, onSelection } from './pdf-viewer.js';
import { translate, ensureKeysLoaded } from './translator.js';
import { mountLangSelector, getTargetLang } from './settings.js';
import { initTooltip, showLoading, showResult, showError } from './tooltip.js';
import { registerSW } from 'virtual:pwa-register';

const status = (msg) => {
  const el = document.getElementById('status');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
};

async function boot() {
  initTooltip();
  mountLangSelector(document.getElementById('targetLang'));

  status('Loading API keys…');
  try {
    await ensureKeysLoaded();
  } catch (e) {
    console.error(e);
    status('⚠️ Failed to load API keys — translation disabled.');
  }

  status('Loading PDF…');
  try {
    await renderPdf(`${import.meta.env.BASE_URL}attention.pdf`, document.getElementById('viewer'));
    status('');
  } catch (e) {
    console.error(e);
    status('⚠️ Failed to load PDF: ' + e.message);
    return;
  }

  onSelection(async (text, rect) => {
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

boot();
