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
  // Apply live where possible (Gemini HTMLAudioElement supports it);
  // browser TTS will pick up the new rate on the next utterance. No
  // restart — interrupting playback for a slider tweak is jarring.
  tts.setLiveRate(v);
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

// Polling parameters for the "translation not ready" wait loop.
// 30 × 600ms ≈ 18s — long enough to cover a slow LLM round-trip,
// short enough to surface "something is wrong" before the user gives up.
const TRANSLATION_WAIT_TRIES = 30;
const TRANSLATION_WAIT_MS = 600;

function speakSequence(segId, waitAttempts = 0) {
  const ctx = deps.getCtx();
  if (!ctx) return;
  const card = deps.getCards().get(segId);
  if (!card) { stopPlayback(); return; }
  const text = card.target.textContent || '';
  if (!text || /^Translating|^⚠️/.test(text)) {
    if (waitAttempts >= TRANSLATION_WAIT_TRIES) {
      toast('Translation stalled — stopping playback. Use ↻ Retry on the card or check Settings.', { duration: 5000 });
      stopPlayback();
      return;
    }
    setTimeout(() => {
      if (playing) speakSequence(segId, waitAttempts + 1);
    }, TRANSLATION_WAIT_MS);
    return;
  }
  setSpeaking(segId);
  renderer.updateReadProgress(deps.getParagraphs(), segId, null);

  // Prefetch the next 2 paragraphs in the background while the current
  // one plays. Short paragraphs (or fast playback rates) can finish
  // before Gemini synth completes N+1, so warming N+2 too closes the
  // gap. prefetchSegAudio short-circuits on IDB hit so the cost of
  // looking too far ahead is small.
  let cursor = segId;
  for (let i = 0; i < 2; i++) {
    cursor = nextSegAfter(cursor);
    if (!cursor) break;
    const p = deps.getParagraphs().find(pp => pp.segId === cursor);
    if (p) prefetchSegAudio(p).catch(() => {});
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

// Empirical: a Gemini TTS round-trip on gpt.yapweijun1996.com averages
// ~3s per paragraph. Used to set expectations before kicking off a
// long-running cache fill.
const GEMINI_SECS_PER_PARAGRAPH = 3;

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
  const total = allParagraphs.length;
  const estSecs = total * GEMINI_SECS_PER_PARAGRAPH;
  const estLabel = estSecs >= 60 ? `~${Math.round(estSecs / 60)} min` : `~${estSecs}s`;
  const ok = window.confirm(
    `Cache audio for all ${total} paragraphs?\n\n` +
    `Estimated time: ${estLabel} (uses your Gemini API quota).\n` +
    `Cached paragraphs will be skipped.`
  );
  if (!ok) return;
  const voice = cfg.ttsVoice || 'Zephyr';
  const langTag = tts.langTagFor(ctx.lang);
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
  // Use the FIRST sample rate we see and skip any later chunk that
  // disagrees (e.g. user re-voiced mid-session with a different
  // model). Merging incompatible rates plays back at the wrong pitch.
  let sampleRate = null;
  let missing = 0;
  let rateSkipped = 0;
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
    const itemRate = view.getUint32(24, true);
    if (sampleRate === null) {
      sampleRate = itemRate;
    } else if (itemRate !== sampleRate) {
      rateSkipped++;
      continue;
    }
    pcmParts.push(new Uint8Array(buf, 44));
  }
  renderer.hideProgress();

  if (!pcmParts.length) {
    toast('No cached audio yet. Click "Cache" first.', { duration: 4000 });
    return;
  }

  const total = pcmParts.reduce((s, a) => s + a.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const a of pcmParts) { merged.set(a, off); off += a.length; }
  const { wrapPcmInWav } = await import('../tts-gemini.js');
  const wavBytes = wrapPcmInWav(merged, sampleRate || 24000, 1, 16);
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pdf-reader-audio-${isoDate()}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  const parts = [`Downloaded ${pcmParts.length} clips`];
  if (missing) parts.push(`${missing} not cached`);
  if (rateSkipped) parts.push(`${rateSkipped} skipped (sample-rate mismatch)`);
  toast(parts.join(' · '), { duration: 5000 });
}

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
