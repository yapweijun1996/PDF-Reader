// Web Speech API wrapper.
// Voices load asynchronously; we cache them and refresh on 'voiceschanged'.
// Provides lang-mapped speak / cancel + reactive voice list for UI.

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

/**
 * Speak text in the given target language.
 * opts: { rate, pitch, voiceURI, onstart, onend, onerror }
 * Cancels any in-flight utterance first.
 */
export function speak(text, targetLang, opts = {}) {
  if (!isSupported() || !text) return null;
  cancel();
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

export function cancel() {
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
  currentUtter = null;
}

export function isSpeaking() {
  return isSupported() && window.speechSynthesis.speaking;
}
