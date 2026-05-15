// Gemini TTS — calls gemini-3.1-flash-tts-preview via streamGenerateContent,
// concatenates the streamed base64 PCM chunks, wraps them in a WAV header,
// and returns a playable Blob URL.
//
// Sample reference (curl):
//   model: gemini-3.1-flash-tts-preview
//   endpoint: streamGenerateContent
//   body: { contents:[{role:'user',parts:[{text}]}],
//           generationConfig:{responseModalities:["audio"],temperature:1,
//             speech_config:{voice_config:{prebuilt_voice_config:{voice_name}}}}}
//
// Returns 24 kHz mono 16-bit PCM in inlineData.data (base64). We add the
// 44-byte WAV RIFF header so the browser <audio> can play it.

const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

// GEMINI_VOICES moved to ./gemini-voices.js so callers (Settings, tts.js)
// can populate the voice dropdown without pulling the synth-and-WAV code.

// Gemini TTS audio output cap ≈ 30 seconds per request. Empirical testing
// (user reported "150 words → only 100 words audible") shows 500-char input
// sometimes overflows that 30s window for fast-pace voices and dense CJK
// text. Drop to 300 chars per chunk for safety; raise the chunk count cap
// to compensate so total reachable input stays similar (~5000 chars).
const MAX_CHARS_PER_CHUNK = 300;
const MAX_CHUNKS_PER_REQUEST = 16;

/**
 * Synthesize text to a playable Blob URL (audio/wav).
 * Long text is split into sentence chunks; their PCM is concatenated
 * and wrapped once at the end. Throws on missing apiKey or API failure.
 */
export async function synthesizeGemini({ text, voice = 'Zephyr', apiKey, temperature = 1, signal, onProgress }) {
  if (!apiKey) throw new Error('Gemini TTS requires an API key (Settings → AI Provider).');
  if (!text || !text.trim()) throw new Error('Empty text');

  const chunks = splitForTts(text, MAX_CHARS_PER_CHUNK).slice(0, MAX_CHUNKS_PER_REQUEST);
  console.log(`[tts-gemini] ${chunks.length} chunk(s) for ${text.length} chars`);
  onProgress?.({ chunkIdx: 0, totalChunks: chunks.length, phase: 'start' });

  const pcmParts = [];
  let detectedSampleRate = SAMPLE_RATE;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ chunkIdx: i, totalChunks: chunks.length, phase: 'synth' });
    const { pcm, sampleRate } = await synthesizeChunkPcm({ text: chunks[i], voice, apiKey, temperature, signal });
    pcmParts.push(pcm);
    if (sampleRate) detectedSampleRate = sampleRate;
    onProgress?.({ chunkIdx: i + 1, totalChunks: chunks.length, phase: 'chunk-done' });
  }

  const merged = concatBytes(pcmParts);
  const wavBytes = wrapPcmInWav(merged, detectedSampleRate, CHANNELS, BITS_PER_SAMPLE);
  return new Blob([wavBytes], { type: 'audio/wav' });
}

async function synthesizeChunkPcm({ text, voice, apiKey, temperature, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['audio'],
      temperature,
      speech_config: {
        voice_config: {
          prebuilt_voice_config: { voice_name: voice }
        }
      }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS ${res.status}: ${errText.slice(0, 240)}`);
  }

  // streamGenerateContent returns a JSON array of chunks
  const raw = await res.text();
  let chunks;
  try {
    chunks = JSON.parse(raw);
    if (!Array.isArray(chunks)) chunks = [chunks];
  } catch {
    throw new Error('Gemini TTS: invalid JSON response');
  }

  const base64Parts = [];
  let mimeType = '';
  let sampleRate = SAMPLE_RATE;
  for (const chunk of chunks) {
    const parts = chunk?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const inline = p?.inlineData || p?.inline_data;
      if (inline?.data) {
        base64Parts.push(inline.data);
        if (inline.mimeType && !mimeType) mimeType = inline.mimeType;
      }
    }
  }
  if (base64Parts.length === 0) throw new Error('Gemini TTS: no audio in response');

  const rateMatch = /rate=(\d+)/i.exec(mimeType);
  if (rateMatch) sampleRate = parseInt(rateMatch[1], 10);

  const pcmBytes = base64ConcatToBytes(base64Parts);
  // Gemini TTS sends little-endian PCM in practice (despite audio/L16 label).
  return { pcm: pcmBytes, sampleRate };
}

/**
 * Split text into TTS-friendly chunks at sentence boundaries.
 * Falls back to hard length-based splits for sentences that exceed maxLen.
 */
function splitForTts(text, maxLen) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];
  // Split on Latin or CJK sentence-ending punctuation, keeping it attached
  const sentences = trimmed.split(/(?<=[.!?。！？])\s*/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if (s.length > maxLen) {
      if (current) { chunks.push(current); current = ''; }
      // Hard split overlong sentence
      for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen));
      continue;
    }
    if ((current + s).length <= maxLen) {
      current += s;
    } else {
      if (current) chunks.push(current);
      current = s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function concatBytes(arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Decode an array of base64 strings into one Uint8Array of raw bytes.
 */
function base64ConcatToBytes(base64Parts) {
  const decoded = base64Parts.map(b64 => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  });
  const total = decoded.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of decoded) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Prepend a 44-byte RIFF/WAV header to raw PCM so it can be played by
 * <audio>. Inputs are little-endian; sampleRate / channels / bitsPerSample
 * must match the PCM data.
 */
export function wrapPcmInWav(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataLen = pcm.length;
  const buffer = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buffer);
  let p = 0;
  const writeStr = (s) => { for (const c of s) v.setUint8(p++, c.charCodeAt(0)); };
  writeStr('RIFF');
  v.setUint32(p, 36 + dataLen, true); p += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  v.setUint32(p, 16, true); p += 4;            // fmt chunk size
  v.setUint16(p, 1, true);  p += 2;            // PCM = 1
  v.setUint16(p, channels, true); p += 2;
  v.setUint32(p, sampleRate, true); p += 4;
  v.setUint32(p, byteRate, true); p += 4;
  v.setUint16(p, blockAlign, true); p += 2;
  v.setUint16(p, bitsPerSample, true); p += 2;
  writeStr('data');
  v.setUint32(p, dataLen, true); p += 4;
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}
