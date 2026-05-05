// TTS router. Two providers:
//   'browser' — Web Speech API (free, instant, system voices)
//   'gemini'  — Gemini TTS REST (uses user's API key, higher quality)
//
// All callsites import { speak, cancel, listVoicesForLang, langTagFor }
// and don't need to know which provider runs underneath.

import { synthesizeGemini, GEMINI_VOICES } from './tts-gemini.js';
import { getUserConfig } from './db.js';
import { getActiveModelConfig } from './settings-modal.js';

const LANG_MAP = {
  'Chinese (Simplified)': 'zh-CN',
  'Chinese (Traditional)': 'zh-TW',
  'English': 'en-US',
  'Malay': 'ms-MY',
  'Indonesian': 'id-ID',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'Spanish': 'es-ES',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Portuguese': 'pt-PT',
  'Arabic': 'ar-SA',
  'Hindi': 'hi-IN',
  'Thai': 'th-TH',
  'Vietnamese': 'vi-VN'
};

let voices = [];
let currentUtter = null;
let currentAudio = null;
let currentBlobUrl = null;

const audioCache = new Map(); // key: provider::voice::text -> Blob URL

export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function initTTS() {
  if (!isSupported()) return false;
  refreshVoices();
  if (typeof speechSynthesis.addEventListener === 'function') {
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }
  return true;
}

function refreshVoices() {
  voices = window.speechSynthesis.getVoices();
}

export function listVoicesForLang(langTag) {
  if (!voices.length) refreshVoices();
  const exact = voices.filter(v => v.lang === langTag);
  if (exact.length) return exact;
  const prefix = langTag.split('-')[0];
  return voices.filter(v => v.lang.startsWith(prefix + '-') || v.lang === prefix);
}

export function langTagFor(targetLang) {
  return LANG_MAP[targetLang] || 'en-US';
}

export { GEMINI_VOICES };

/**
 * Speak text. Routes by user-configured TTS provider.
 * opts: { rate, pitch, voiceURI (browser) | voice (gemini), onstart, onend, onerror }
 * Always cancels any in-flight playback first.
 */
export async function speak(text, targetLang, opts = {}) {
  if (!text) return null;
  cancel();

  const cfg = await getUserConfig();
  const provider = cfg.ttsProvider === 'gemini' ? 'gemini' : 'browser';

  if (provider === 'gemini') {
    try {
      return await speakGemini(text, opts);
    } catch (e) {
      console.warn('[tts] Gemini failed, falling back to browser:', e.message);
      // Fall through to browser
    }
  }
  return speakBrowser(text, targetLang, opts);
}

function speakBrowser(text, targetLang, opts) {
  if (!isSupported()) return null;
  const utter = new SpeechSynthesisUtterance(text);
  const tag = langTagFor(targetLang);
  utter.lang = tag;
  utter.rate = opts.rate ?? 1;
  utter.pitch = opts.pitch ?? 1;
  const candidates = listVoicesForLang(tag);
  if (opts.voiceURI) {
    const found = voices.find(v => v.voiceURI === opts.voiceURI);
    if (found) utter.voice = found;
  } else if (candidates.length) {
    utter.voice = candidates[0];
  }
  if (opts.onstart) utter.addEventListener('start', opts.onstart);
  if (opts.onend) utter.addEventListener('end', opts.onend);
  if (opts.onerror) utter.addEventListener('error', opts.onerror);
  currentUtter = utter;
  window.speechSynthesis.speak(utter);
  return utter;
}

async function speakGemini(text, opts) {
  const userCfg = await getActiveModelConfig();
  const apiKey = userCfg.apiKey;
  if (!apiKey) throw new Error('Gemini TTS requires API key');
  const cfg = await getUserConfig();
  const voice = opts.voice || cfg.ttsVoice || 'Zephyr';
  const cacheKey = `gemini::${voice}::${text}`;

  let blobUrl = audioCache.get(cacheKey);
  if (!blobUrl) {
    opts.onstart?.();
    const blob = await synthesizeGemini({ text, voice, apiKey });
    blobUrl = URL.createObjectURL(blob);
    audioCache.set(cacheKey, blobUrl);
    // Cap cache size
    if (audioCache.size > 50) {
      const firstKey = audioCache.keys().next().value;
      const oldUrl = audioCache.get(firstKey);
      URL.revokeObjectURL(oldUrl);
      audioCache.delete(firstKey);
    }
  }

  const audio = new Audio(blobUrl);
  audio.playbackRate = opts.rate ?? 1;
  audio.addEventListener('ended', () => opts.onend?.());
  audio.addEventListener('error', (e) => opts.onerror?.(e));
  currentAudio = audio;
  currentBlobUrl = blobUrl;
  // Fire onstart for callers that expect it before audio actually plays
  if (!audioCache.has(cacheKey)) opts.onstart?.();
  await audio.play().catch(e => opts.onerror?.(e));
  return audio;
}

export function cancel() {
  if (isSupported()) window.speechSynthesis.cancel();
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }
  currentUtter = null;
}

export function isSpeaking() {
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) return true;
  return isSupported() && window.speechSynthesis.speaking;
}
