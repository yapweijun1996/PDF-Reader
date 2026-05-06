// TTS router. Two providers:
//   'browser' — Web Speech API (free, instant, system voices)
//   'gemini'  — Gemini TTS REST (uses user's API key, higher quality)
//
// All callsites import { speak, cancel, listVoicesForLang, langTagFor }
// and don't need to know which provider runs underneath.

import { synthesizeGemini, GEMINI_VOICES } from './tts-gemini.js';
import { getUserConfig, getAudioBlob, putAudioBlob, audioCacheKey } from './db.js';
import { getActiveModelConfig } from './settings-modal.js';
import { toast } from './toast.js';

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

// Short-lived in-memory map of Blob URLs (so the same audio can be replayed
// without revoking the URL). Persistent storage of the actual audio bytes
// lives in IndexedDB via db.js getAudioBlob/putAudioBlob.
const blobUrlCache = new Map();

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
      return await speakGemini(text, opts, targetLang);
    } catch (e) {
      console.warn('[tts] Gemini failed, falling back to browser:', e);
      toast(`⚠️ Gemini TTS: ${e.message || e}`, { duration: 5000 });
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

async function speakGemini(text, opts, targetLang) {
  const userCfg = await getActiveModelConfig();
  const apiKey = userCfg.apiKey;
  if (!apiKey) throw new Error('Gemini TTS requires an API key — open Settings ⚙ and paste your Google AI Studio key.');
  const cfg = await getUserConfig();
  const voice = opts.voice || cfg.ttsVoice || 'Zephyr';
  const langTag = langTagFor(targetLang);
  const idbKey = await audioCacheKey('gemini', voice, langTag, text);

  // Tier 1: in-memory blob URL (instant)
  let blobUrl = blobUrlCache.get(idbKey);
  if (blobUrl) {
    opts.onstart?.();
    console.log('[tts] memory hit');
  } else {
    // Tier 2: IndexedDB (persisted across reloads)
    let blob = await getAudioBlob(idbKey);
    if (blob) {
      opts.onstart?.();
      console.log('[tts] IDB hit, ' + blob.size + ' bytes');
    } else {
      // Tier 3: synthesize via Gemini
      opts.onstart?.();
      console.log('[tts] Gemini synthesizing…', { voice, len: text.length });
      blob = await synthesizeGemini({ text, voice, apiKey, onProgress: opts.onProgress });
      try { await putAudioBlob(idbKey, blob); } catch (e) {
        console.warn('[tts] IDB save failed (continuing):', e);
      }
      console.log('[tts] Gemini synth ok, ' + blob.size + ' bytes');
    }
    blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(idbKey, blobUrl);
    // Cap in-memory URL cache; revoke oldest
    if (blobUrlCache.size > 100) {
      const firstKey = blobUrlCache.keys().next().value;
      const oldUrl = blobUrlCache.get(firstKey);
      URL.revokeObjectURL(oldUrl);
      blobUrlCache.delete(firstKey);
    }
  }

  const audio = new Audio(blobUrl);
  audio.playbackRate = opts.rate ?? 1;
  audio.addEventListener('ended', () => opts.onend?.());
  audio.addEventListener('error', (e) => {
    console.warn('[tts] audio element error:', e);
    opts.onerror?.(e);
  });
  currentAudio = audio;
  currentBlobUrl = blobUrl;
  try {
    await audio.play();
  } catch (e) {
    console.warn('[tts] audio.play() rejected:', e);
    throw e; // bubble up so caller's try/catch (in speak) shows toast
  }
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
