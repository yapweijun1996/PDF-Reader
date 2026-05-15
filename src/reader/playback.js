// TTS playback state machine + Gemini audio cache/download for Reader view.
// Owns its own state (playing flag, current paragraph, rate). All access to
// the controller's data (cards Map, paragraphs list, current ctx, toolbar
// controls) goes through getter deps so the controller stays the single
// source of truth for what's on screen.

import * as tts from '../tts.js';
import { getUserConfig, getAudioBlob, putAudioBlob, audioCacheKey } from '../db.js';
import { getGeminiTtsKey } from '../model-config.js';
import { toast } from '../toast.js';
import * as renderer from './renderer.js';

let deps = null;  // { getCards, getParagraphs, getCtx, getToolbarCtl }
let playing = false;
let currentSpeakingSeg = null;
let playRate = 1;
const inflightPrefetch = new Set();

export function initPlayback(d) {
  deps = d;
  playing = false;
  currentSpeakingSeg = null;
  inflightPrefetch.clear();
}

export function getRate() { return playRate; }
export function setRate(v) {
  playRate = v;
  // Rate change mid-playback: restart current paragraph at new rate.
  if (playing && currentSpeakingSeg) speakSequence(currentSpeakingSeg);
}

export function getCurrentSpeakingSeg() { return currentSpeakingSeg; }
export function isPlaying() { return playing; }

/**
 * Play this one paragraph and stop. Used by per-card play buttons.
 */
export function speakOne(segId) {
  stopPlayback();
  const card = deps.getCards().get(segId);
  if (!card) return;
  const ctx = deps.getCtx();
  if (!ctx) return;
  const text = card.target.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) return;
  setSpeaking(segId);
  tts.speak(text, ctx.lang, {
    rate: playRate,
    onend: () => setSpeaking(null),
    onerror: () => setSpeaking(null)
  });
}

/**
 * Pause/resume toggle for the toolbar's Play-all button. `fallbackSegId`
 * is where playback should start if nothing is currently selected.
 */
export function togglePlayAll(fallbackSegId) {
  if (playing) {
    pause();
    return;
  }
  const start = currentSpeakingSeg || fallbackSegId;
  if (!start) return;
  playing = true;
  setPlayingButton(true);
  speakSequence(start);
}

export function pause() {
  playing = false;
  setPlayingButton(false);
  tts.cancel();
}

export function stopPlayback() {
  playing = false;
  setPlayingButton(false);
  tts.cancel();
  setSpeaking(null);
  renderer.hideProgress();
}

function setSpeaking(segId) {
  renderer.setSpeakingClass(deps.getCards(), currentSpeakingSeg, segId);
  currentSpeakingSeg = segId;
}

function setPlayingButton(on) {
  deps.getToolbarCtl()?.setPlaying(on);
}

function nextSegAfter(segId) {
  const paras = deps.getParagraphs();
  const idx = paras.findIndex(p => p.segId === segId);
  if (idx < 0 || idx >= paras.length - 1) return null;
  return paras[idx + 1].segId;
}

function speakSequence(segId) {
  const ctx = deps.getCtx();
  if (!ctx) return;
  const card = deps.getCards().get(segId);
  if (!card) { stopPlayback(); return; }
  const text = card.target.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) {
    // Translation not ready yet — poll again shortly.
    setTimeout(() => { if (playing) speakSequence(segId); }, 600);
    return;
  }
  setSpeaking(segId);
  renderer.updateReadProgress(deps.getParagraphs(), segId, null);

  // Prefetch the next paragraph's audio in the background while the
  // current one plays. By the time playback ends the next paragraph is
  // (usually) already in IDB, eliminating the synth-induced gap.
  const nextId = nextSegAfter(segId);
  if (nextId) {
    const nextP = deps.getParagraphs().find(p => p.segId === nextId);
    if (nextP) prefetchSegAudio(nextP).catch(() => {});
  }

  tts.speak(text, ctx.lang, {
    rate: playRate,
    onProgress: (info) => renderer.updateReadProgress(deps.getParagraphs(), segId, info),
    onend: () => advanceOrStop(segId),
    onerror: () => advanceOrStop(segId)
  });
}

function advanceOrStop(segId) {
  if (!playing) return;
  const next = nextSegAfter(segId);
  if (next) speakSequence(next);
  else { stopPlayback(); renderer.hideProgress(); }
}

/**
 * Synthesize + persist one paragraph's audio without playing it.
 * No-op when the user isn't on Gemini TTS, has no key, or the audio is
 * already cached / the translation isn't ready.
 */
async function prefetchSegAudio(p) {
  if (!p || inflightPrefetch.has(p.segId)) return;
  const ctx = deps.getCtx();
  if (!ctx) return;
  const cfg = await getUserConfig();
  if (cfg.ttsProvider !== 'gemini') return;
  const apiKey = await getGeminiTtsKey();
  if (!apiKey) return;
  const card = deps.getCards().get(p.segId);
  const text = card?.target?.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) return;
  const voice = cfg.ttsVoice || 'Zephyr';
  const langTag = tts.langTagFor(ctx.lang);
  const idbKey = await audioCacheKey('gemini', voice, langTag, text);
  const existing = await getAudioBlob(idbKey);
  if (existing) return;

  inflightPrefetch.add(p.segId);
  try {
    console.log('[reader] prefetch synth', p.segId);
    const { synthesizeGemini } = await import('../tts-gemini.js');
    const blob = await synthesizeGemini({ text, voice, apiKey });
    await putAudioBlob(idbKey, blob);
  } catch (e) {
    console.warn('[reader] prefetch failed for', p.segId, e.message || e);
  } finally {
    inflightPrefetch.delete(p.segId);
  }
}

export async function cacheAllAudio() {
  const allParagraphs = deps.getParagraphs();
  if (!allParagraphs.length) return;
  const ctx = deps.getCtx();
  if (!ctx) return;
  const cfg = await getUserConfig();
  if (cfg.ttsProvider !== 'gemini') {
    toast('Cache requires Gemini TTS — switch in Settings ⚙', { duration: 4000 });
    return;
  }
  const apiKey = await getGeminiTtsKey();
  if (!apiKey) {
    toast('Cache requires your Gemini API key — open Settings ⚙', { duration: 4000 });
    return;
  }
  const voice = cfg.ttsVoice || 'Zephyr';
  const langTag = tts.langTagFor(ctx.lang);
  const total = allParagraphs.length;
  const { synthesizeGemini } = await import('../tts-gemini.js');
  let done = 0;
  let synthesized = 0;
  let skipped = 0;
  let failed = 0;

  renderer.showProgress(0, total, 'Starting cache…');

  for (const p of allParagraphs) {
    done++;
    const card = deps.getCards().get(p.segId);
    const text = card?.target?.textContent || '';
    if (!text || /^Translating|^⚠️/.test(text)) { skipped++; continue; }

    const idbKey = await audioCacheKey('gemini', voice, langTag, text);
    const existing = await getAudioBlob(idbKey);
    if (existing) {
      skipped++;
      renderer.showProgress(done, total, `cached ${done}/${total} (hit)`);
      continue;
    }
    renderer.showProgress(done, total, `synthesizing ${done}/${total}…`);
    try {
      const blob = await synthesizeGemini({ text, voice, apiKey });
      await putAudioBlob(idbKey, blob);
      synthesized++;
    } catch (e) {
      console.warn('[reader] cache failed for', p.segId, e);
      failed++;
    }
  }

  renderer.hideProgress();
  toast(`Cached: ${synthesized} new + ${skipped} hits${failed ? ` · ${failed} failed` : ''}`, { duration: 5000 });
}

export async function downloadAllAudio() {
  const allParagraphs = deps.getParagraphs();
  if (!allParagraphs.length) return;
  const ctx = deps.getCtx();
  if (!ctx) return;
  const cfg = await getUserConfig();
  const voice = cfg.ttsVoice || 'Zephyr';
  const langTag = tts.langTagFor(ctx.lang);

  renderer.showProgress(0, allParagraphs.length, 'Collecting audio…');
  const pcmParts = [];
  let sampleRate = 24000;
  let missing = 0;
  for (let i = 0; i < allParagraphs.length; i++) {
    const p = allParagraphs[i];
    const card = deps.getCards().get(p.segId);
    const text = card?.target?.textContent || '';
    if (!text) continue;
    const idbKey = await audioCacheKey('gemini', voice, langTag, text);
    const blob = await getAudioBlob(idbKey);
    if (!blob) { missing++; continue; }
    renderer.showProgress(i + 1, allParagraphs.length, `merging ${i + 1}/${allParagraphs.length}`);
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    if (buf.byteLength < 44) continue;
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') continue;
    sampleRate = view.getUint32(24, true);
    pcmParts.push(new Uint8Array(buf, 44));
  }
  renderer.hideProgress();

  if (!pcmParts.length) {
    toast('No cached audio yet. Click "Cache all" first.', { duration: 4000 });
    return;
  }

  const total = pcmParts.reduce((s, a) => s + a.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const a of pcmParts) { merged.set(a, off); off += a.length; }
  const { wrapPcmInWav } = await import('../tts-gemini.js');
  const wavBytes = wrapPcmInWav(merged, sampleRate, 1, 16);
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pdf-reader-audio-${Date.now()}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  toast(`Downloaded ${pcmParts.length} clips${missing ? ` · ${missing} not cached (skipped)` : ''}`, { duration: 4000 });
}
