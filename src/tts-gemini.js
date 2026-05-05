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

export const GEMINI_VOICES = [
  { name: 'Zephyr',         tone: 'Bright' },
  { name: 'Puck',           tone: 'Upbeat' },
  { name: 'Charon',         tone: 'Informative' },
  { name: 'Kore',           tone: 'Firm' },
  { name: 'Fenrir',         tone: 'Excitable' },
  { name: 'Leda',           tone: 'Youthful' },
  { name: 'Orus',           tone: 'Firm' },
  { name: 'Aoede',          tone: 'Breezy' },
  { name: 'Callirrhoe',     tone: 'Easy-going' },
  { name: 'Autonoe',        tone: 'Bright' },
  { name: 'Enceladus',      tone: 'Breathy' },
  { name: 'Iapetus',        tone: 'Clear' },
  { name: 'Umbriel',        tone: 'Easy-going' },
  { name: 'Algieba',        tone: 'Smooth' },
  { name: 'Despina',        tone: 'Smooth' },
  { name: 'Erinome',        tone: 'Clear' },
  { name: 'Algenib',        tone: 'Gravelly' },
  { name: 'Rasalgethi',     tone: 'Informative' },
  { name: 'Laomedeia',      tone: 'Upbeat' },
  { name: 'Achernar',       tone: 'Soft' },
  { name: 'Alnilam',        tone: 'Firm' },
  { name: 'Schedar',        tone: 'Even' },
  { name: 'Gacrux',         tone: 'Mature' },
  { name: 'Pulcherrima',    tone: 'Forward' },
  { name: 'Achird',         tone: 'Friendly' },
  { name: 'Zubenelgenubi',  tone: 'Casual' },
  { name: 'Vindemiatrix',   tone: 'Gentle' },
  { name: 'Sadachbia',      tone: 'Lively' },
  { name: 'Sadaltager',     tone: 'Knowledgeable' },
  { name: 'Sulafat',        tone: 'Warm' }
];

/**
 * Synthesize text to a playable Blob URL (audio/wav).
 * Throws on missing apiKey or network/API failure.
 */
export async function synthesizeGemini({ text, voice = 'Zephyr', apiKey, temperature = 1, signal }) {
  if (!apiKey) throw new Error('Gemini TTS requires an API key (Settings → AI Provider).');
  if (!text || !text.trim()) throw new Error('Empty text');

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
  for (const chunk of chunks) {
    const parts = chunk?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      const data = p?.inlineData?.data || p?.inline_data?.data;
      if (data) base64Parts.push(data);
    }
  }
  if (base64Parts.length === 0) throw new Error('Gemini TTS: no audio in response');

  const pcmBytes = base64ConcatToBytes(base64Parts);
  const wavBytes = wrapPcmInWav(pcmBytes, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
  return new Blob([wavBytes], { type: 'audio/wav' });
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
function wrapPcmInWav(pcm, sampleRate, channels, bitsPerSample) {
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
