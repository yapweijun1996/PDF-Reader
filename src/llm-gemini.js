// Direct Google Gemini LLM client. Used by translator.js when the user
// picks "Google Gemini" in Settings → AI Provider. The user supplies their
// own Gemini API key (`geminiApiKey`); we send it via the x-goog-api-key
// header rather than as a URL query string so it doesn't leak into
// history / proxy logs.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

export async function callGemini({
  prompt,
  model,
  apiKey,
  temperature,
  maxOutputTokens,
  signal
}) {
  if (!apiKey) {
    throw new Error('Gemini API key required — set one in Settings → AI Provider.');
  }
  const m = model || GEMINI_DEFAULT_MODEL;
  const url = `${ENDPOINT}/${encodeURIComponent(m)}:generateContent`;

  const generationConfig = {};
  if (typeof temperature === 'number') generationConfig.temperature = temperature;
  if (typeof maxOutputTokens === 'number') generationConfig.maxOutputTokens = maxOutputTokens;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 240); } catch {}
    throw new Error(`Gemini ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p?.text || '').join('').trim();
}
