// Settings modal: lets the user supply their own LLM provider, model, and
// API key. Stored in IndexedDB. When set, translator/explain calls use the
// user's key directly; when not set, they fall back to the bundled rotation.
//
// Provider currently fixed to Gemini, but the schema is provider-aware so
// we can add OpenAI / Anthropic / local Ollama later without breaking
// stored configs.

import { getUserConfig, setUserConfig, clearUserConfig } from './db.js';
import { toast } from './toast.js';
import { getAppTheme, setAppTheme, THEMES } from './theme.js';
import { GEMINI_VOICES, synthesizeGemini } from './tts-gemini.js';
import { getTargetLang } from './settings.js';
import { langTagFor } from './tts.js';

const MODEL_OPTIONS = {
  gemini: [
    { value: 'gemma-3-27b-it', label: 'Gemma 3 27B IT (default, fast)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (slow, high quality)' },
    { value: 'custom', label: 'Custom model name…' }
  ]
};

let modalEl = null;

export async function initSettingsModal({ openButton }) {
  modalEl = createModal();
  document.body.appendChild(modalEl);

  openButton?.addEventListener('click', async () => {
    await renderForm();
    show();
  });

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) hide();
  });
  modalEl.querySelector('.settings-close').addEventListener('click', hide);
}

function createModal() {
  const el = document.createElement('div');
  el.className = 'settings-modal';
  el.hidden = true;
  el.innerHTML = `
    <div class="settings-card">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="settings-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="settings-body"></div>
    </div>
  `;
  return el;
}

async function renderForm() {
  const body = modalEl.querySelector('.settings-body');
  const cfg = await getUserConfig();
  const provider = cfg.provider || 'gemini';
  const model = cfg.model || 'gemma-3-27b-it';
  const apiKey = cfg.apiKey || '';
  const customModel = cfg.customModel || '';

  const currentTheme = getAppTheme();

  body.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">Appearance</div>
      <div class="theme-segmented" role="radiogroup" aria-label="Theme">
        ${THEMES.map(t => `
          <button class="theme-segmented-btn ${t === currentTheme ? 'is-active' : ''}" data-theme="${t}" type="button" role="radio" aria-checked="${t === currentTheme}">
            ${themeIcon(t)} <span>${t.charAt(0).toUpperCase() + t.slice(1)}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">AI Provider</div>
    </div>

    <p class="settings-intro">
      Use your own API key to bypass the shared rotation. Stored locally
      in IndexedDB on your device — never uploaded.
    </p>
    <label class="settings-row">
      <span>Provider</span>
      <select class="settings-provider">
        <option value="gemini" ${provider === 'gemini' ? 'selected' : ''}>Google Gemini / Gemma</option>
      </select>
    </label>
    <label class="settings-row">
      <span>Model</span>
      <select class="settings-model"></select>
    </label>
    <label class="settings-row settings-row-custom" style="display:${model === 'custom' ? 'flex' : 'none'}">
      <span>Custom model name</span>
      <input class="settings-custom-model" type="text" placeholder="e.g. gemini-2.5-flash-lite" value="${escapeAttr(customModel)}" />
    </label>
    <label class="settings-row">
      <span>API Key</span>
      <input class="settings-apikey" type="password" autocomplete="off" placeholder="AIzaSy…" value="${escapeAttr(apiKey)}" />
    </label>
    <p class="settings-hint">
      Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
      Leave blank to use the shared rotation.
    </p>

    <div class="settings-section">
      <div class="settings-section-title">Text-to-Speech</div>
      <label class="settings-row">
        <span>TTS provider</span>
        <select class="settings-tts-provider">
          <option value="browser" ${(cfg.ttsProvider || 'browser') === 'browser' ? 'selected' : ''}>Browser (free, system voices)</option>
          <option value="gemini" ${cfg.ttsProvider === 'gemini' ? 'selected' : ''}>Gemini TTS (uses your API key, higher quality)</option>
        </select>
      </label>
      <label class="settings-row settings-row-tts-voice" style="display:${cfg.ttsProvider === 'gemini' ? 'flex' : 'none'}">
        <span>Voice</span>
        <select class="settings-tts-voice"></select>
      </label>
      <div class="settings-row settings-row-tts-preview">
        <button class="settings-preview-tts" type="button">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="6 4 20 12 6 20" />
          </svg>
          <span class="preview-label">Preview voice</span>
        </button>
      </div>
    </div>

    <div class="settings-actions">
      <button class="settings-clear" type="button">Clear</button>
      <button class="settings-save" type="button">Save</button>
    </div>
  `;

  const modelSel = body.querySelector('.settings-model');
  for (const opt of MODEL_OPTIONS.gemini) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === model) o.selected = true;
    modelSel.appendChild(o);
  }

  modelSel.addEventListener('change', () => {
    body.querySelector('.settings-row-custom').style.display =
      modelSel.value === 'custom' ? 'flex' : 'none';
  });

  // TTS provider + voice picker
  const ttsProviderSel = body.querySelector('.settings-tts-provider');
  const ttsVoiceSel = body.querySelector('.settings-tts-voice');
  const currentVoice = cfg.ttsVoice || 'Zephyr';
  for (const v of GEMINI_VOICES) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} — ${v.tone}`;
    if (v.name === currentVoice) o.selected = true;
    ttsVoiceSel.appendChild(o);
  }
  ttsProviderSel.addEventListener('change', () => {
    body.querySelector('.settings-row-tts-voice').style.display =
      ttsProviderSel.value === 'gemini' ? 'flex' : 'none';
  });

  // Preview voice — uses current inputs without requiring Save first
  const previewBtn = body.querySelector('.settings-preview-tts');
  let previewAudio = null;
  previewBtn.addEventListener('click', async () => {
    if (previewAudio && !previewAudio.paused) {
      previewAudio.pause();
      previewAudio = null;
      previewBtn.querySelector('.preview-label').textContent = 'Preview voice';
      return;
    }
    const provider = ttsProviderSel.value;
    const voice = ttsVoiceSel.value;
    const apiKey = body.querySelector('.settings-apikey').value.trim();
    const targetLang = getTargetLang();
    const sample = sampleTextFor(targetLang);

    previewBtn.disabled = true;
    previewBtn.querySelector('.preview-label').textContent = 'Loading…';
    try {
      if (provider === 'gemini') {
        if (!apiKey) {
          toast('Enter your API key first to preview Gemini voices', { duration: 3000 });
          return;
        }
        const blob = await synthesizeGemini({ text: sample, voice, apiKey });
        const url = URL.createObjectURL(blob);
        previewAudio = new Audio(url);
        previewAudio.addEventListener('ended', () => {
          previewBtn.querySelector('.preview-label').textContent = 'Preview voice';
          URL.revokeObjectURL(url);
        });
        previewBtn.querySelector('.preview-label').textContent = 'Stop';
        await previewAudio.play();
      } else {
        const utter = new SpeechSynthesisUtterance(sample);
        utter.lang = langTagFor(targetLang);
        utter.addEventListener('end', () => {
          previewBtn.querySelector('.preview-label').textContent = 'Preview voice';
        });
        previewBtn.querySelector('.preview-label').textContent = 'Stop';
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    } catch (e) {
      toast(`⚠️ ${e.message || e}`, { duration: 4000 });
      previewBtn.querySelector('.preview-label').textContent = 'Preview voice';
    } finally {
      previewBtn.disabled = false;
    }
  });

  // Theme segmented control
  body.querySelectorAll('.theme-segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.theme;
      setAppTheme(t);
      body.querySelectorAll('.theme-segmented-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    });
  });

  body.querySelector('.settings-save').addEventListener('click', async () => {
    const newCfg = {
      provider: body.querySelector('.settings-provider').value,
      model: modelSel.value,
      customModel: body.querySelector('.settings-custom-model').value.trim(),
      apiKey: body.querySelector('.settings-apikey').value.trim(),
      ttsProvider: ttsProviderSel.value,
      ttsVoice: ttsVoiceSel.value
    };
    await setUserConfig(newCfg);
    toast(newCfg.apiKey ? 'Saved — using your API key' : 'Saved — using shared rotation', { duration: 2400 });
    hide();
  });

  body.querySelector('.settings-clear').addEventListener('click', async () => {
    if (!confirm('Clear your API key and reset to shared rotation?')) return;
    await clearUserConfig();
    toast('Settings cleared', { duration: 2000 });
    hide();
  });
}

function show() {
  modalEl.hidden = false;
  requestAnimationFrame(() => modalEl.classList.add('settings-modal-open'));
}

function hide() {
  modalEl.classList.remove('settings-modal-open');
  setTimeout(() => { modalEl.hidden = true; }, 200);
}

/**
 * Returns the active model + key the translator should use.
 * Falls back to (null, null) which means use the bundled rotation.
 */
export async function getActiveModelConfig() {
  const cfg = await getUserConfig();
  if (!cfg.apiKey) return { model: null, apiKey: null };
  const model = cfg.model === 'custom'
    ? (cfg.customModel || 'gemma-3-27b-it')
    : (cfg.model || 'gemma-3-27b-it');
  return { model, apiKey: cfg.apiKey };
}

function themeIcon(t) {
  if (t === 'light') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
  if (t === 'dark')  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
}

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const SAMPLE_TEXTS = {
  'English': "Hello! This is a preview of how I'll read translations to you.",
  'Chinese (Simplified)': '你好！这是我朗读译文时的声音预览。',
  'Chinese (Traditional)': '你好！這是我朗讀譯文時的聲音預覽。',
  'Japanese': 'こんにちは。翻訳を読み上げる声のプレビューです。',
  'Korean': '안녕하세요. 번역을 읽어 드릴 목소리 미리듣기입니다.',
  'Spanish': 'Hola, esta es una vista previa de cómo leeré las traducciones.',
  'French': "Bonjour, ceci est un aperçu de la voix qui lira vos traductions.",
  'German': 'Hallo, dies ist eine Vorschau der Stimme, die Übersetzungen vorliest.',
  'Portuguese': 'Olá, esta é uma prévia de como vou ler as traduções para você.',
  'Arabic': 'مرحباً، هذه معاينة لصوت قراءة الترجمات.',
  'Hindi': 'नमस्ते, यह अनुवाद पढ़ने वाली आवाज़ का पूर्वावलोकन है।',
  'Thai': 'สวัสดี นี่คือตัวอย่างเสียงที่จะใช้อ่านคำแปลให้คุณฟัง',
  'Vietnamese': 'Xin chào, đây là bản xem trước giọng đọc bản dịch.',
  'Malay': 'Helo, ini adalah pratonton suara yang akan membacakan terjemahan.',
  'Indonesian': 'Halo, ini adalah pratinjau suara yang akan membacakan terjemahan.'
};

function sampleTextFor(lang) {
  return SAMPLE_TEXTS[lang] || SAMPLE_TEXTS.English;
}
