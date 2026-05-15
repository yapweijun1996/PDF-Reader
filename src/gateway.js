// OpenAI-compatible gateway client (https://gpt.yapweijun1996.com).
// Uses the /v1/responses endpoint (reasoning API) with streaming SSE —
// streaming is required to avoid Cloudflare's 100s edge timeout (524).
//
// The default Bearer key is XOR-obfuscated below (seed: 20260515). This is
// obfuscation only, not real crypto; for production use a backend proxy.
// Users can override with their own gateway key via Settings.

const GATEWAY_URL = 'https://gpt.yapweijun1996.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.4-mini';
const XOR_SEED = '20260515';

const ENCRYPTED_DEFAULT_KEY =
  '085071109003002001087084003002084015001086006001081000083087002004085002001086080087081002083012005081000001081002085087001082007087006087002006005000010';

let cachedKey = null;

function decryptKey(cipher, seed) {
  const bytes = [];
  for (let i = 0; i < cipher.length; i += 3) {
    const n = parseInt(cipher.slice(i, i + 3), 10);
    const kc = seed.charCodeAt((i / 3) % seed.length);
    bytes.push(n ^ kc);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function getDefaultKey() {
  if (!cachedKey) cachedKey = decryptKey(ENCRYPTED_DEFAULT_KEY, XOR_SEED);
  return cachedKey;
}

/**
 * Call the gateway's /v1/responses endpoint with streaming.
 * Returns the assembled plain-text output.
 *
 * @param {object} opts
 * @param {string} opts.prompt           Text content for the user turn.
 * @param {string} [opts.model]          Overrides DEFAULT_MODEL.
 * @param {string} [opts.apiKey]         Overrides the bundled default key.
 * @param {number} [opts.temperature]    Forwarded to the API.
 * @param {number} [opts.maxOutputTokens] Forwarded as max_output_tokens.
 * @param {'minimal'|'low'|'medium'|'high'|'xhigh'} [opts.reasoningEffort='low']
 *        Reasoning budget. Defaults to 'low' for snappy translations.
 *        The gateway's own default is 'xhigh', which can drain quota — always
 *        pass an explicit value.
 * @param {AbortSignal} [opts.signal]
 */
export async function callGateway({
  prompt,
  model,
  apiKey,
  temperature,
  maxOutputTokens,
  reasoningEffort = 'low',
  signal
}) {
  const key = apiKey || getDefaultKey();
  const body = {
    model: model || DEFAULT_MODEL,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
    stream: true,
    reasoning: { effort: reasoningEffort }
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof maxOutputTokens === 'number') body.max_output_tokens = maxOutputTokens;

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 240); } catch {}
    throw new Error(`Gateway ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!res.body) throw new Error('Gateway: empty response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';
  let finalText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = frame.split('\n').filter(l => l.startsWith('data:'));
      if (!dataLines.length) continue;
      const payload = dataLines.map(l => l.slice(5).trimStart()).join('\n');
      if (payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      const t = evt?.type || '';
      if (t === 'response.output_text.delta' && typeof evt.delta === 'string') {
        streamed += evt.delta;
      } else if (t === 'response.completed' && evt.response?.output) {
        for (const item of evt.response.output) {
          if (item.type === 'message') {
            for (const c of (item.content || [])) {
              if (typeof c.text === 'string') finalText += c.text;
            }
          }
        }
      } else if (t === 'error') {
        const msg = evt.error?.message || 'Gateway stream error';
        throw new Error(msg);
      }
    }
  }
  return (finalText || streamed).trim();
}

export const GATEWAY_DEFAULT_MODEL = DEFAULT_MODEL;
