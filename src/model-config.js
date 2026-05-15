// Single source of truth for the LLM provider config + Gemini TTS key.
// Owned by logic modules (translator / reader / tts). The UI layer
// (settings-modal.js) only renders and persists — it imports MODEL_OPTIONS
// from here, never the other way around.

import { getUserConfig } from './db.js';
import { GATEWAY_DEFAULT_MODEL } from './gateway.js';
import { GEMINI_DEFAULT_MODEL } from './llm-gemini.js';

export const MODEL_OPTIONS = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (default)' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (slow, high quality)' },
    { value: 'gemma-3-27b-it', label: 'Gemma 3 27B IT' },
    { value: 'custom', label: 'Custom model name…' }
  ]
};

/**
 * Returns the active LLM provider + model + key for translator/explain.
 *
 * - provider === 'gateway' (default): always uses the bundled key + model.
 *   Any leftover cfg.apiKey / cfg.model from a previous schema is ignored
 *   on purpose — see commit notes for the 401 we hit on 2026-05-15.
 * - provider === 'gemini': returns the user's Gemini key + chosen model.
 */
export async function getActiveModelConfig() {
  const cfg = await getUserConfig();
  const provider = cfg.provider || 'gateway';

  if (provider === 'gemini') {
    const model = cfg.geminiModel === 'custom'
      ? (cfg.geminiCustomModel || GEMINI_DEFAULT_MODEL)
      : (cfg.geminiModel || GEMINI_DEFAULT_MODEL);
    return { provider, model, apiKey: cfg.geminiApiKey || null };
  }

  return { provider: 'gateway', model: GATEWAY_DEFAULT_MODEL, apiKey: null };
}

/**
 * Returns the Gemini API key used for Gemini TTS, independent of which
 * LLM provider is active. Stored separately so a user can run translations
 * through the gateway while still using their own Gemini key for TTS.
 */
export async function getGeminiTtsKey() {
  const cfg = await getUserConfig();
  return cfg.geminiApiKey || null;
}
