// Settings modal: lets the user supply their own LLM provider, model, and
// API key. Stored in IndexedDB. When set, translator/explain calls use the
// user's key directly; when not set, they fall back to the bundled rotation.
//
// Provider currently fixed to Gemini, but the schema is provider-aware so
// we can add OpenAI / Anthropic / local Ollama later without breaking
// stored configs.

import { getUserConfig, setUserConfig, clearUserConfig } from './db.js';
import { toast } from './toast.js';

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

  body.innerHTML = `
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

  body.querySelector('.settings-save').addEventListener('click', async () => {
    const newCfg = {
      provider: body.querySelector('.settings-provider').value,
      model: modelSel.value,
      customModel: body.querySelector('.settings-custom-model').value.trim(),
      apiKey: body.querySelector('.settings-apikey').value.trim()
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

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
