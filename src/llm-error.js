// Shared error contract for all LLM clients (gateway, Gemini, future
// providers). Callers in the UI layer use friendlyMessage() to render a
// short, actionable message without having to know which provider threw.
//
// LlmError.code values:
//   'auth'        — 401 / 403 / missing key. User must fix Settings.
//   'rate_limit'  — 429. Retriable, transient.
//   'bad_request' — 400. Usually a model-side rejection (unsupported param,
//                   bad shape). Message includes upstream detail.
//   'network'     — 5xx, DNS failure, fetch reject. Retriable.
//   'unknown'     — anything else (incl. AbortError if not classified).

export class LlmError extends Error {
  constructor({ code, status = null, message, retriable = false, cause }) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
    if (cause) this.cause = cause;
  }
}

/**
 * Classify a non-OK HTTP response from an LLM upstream. Pass `bodyText` if
 * the body has already been consumed; otherwise this reads it.
 */
export async function fromHttpResponse(res, providerLabel, bodyText) {
  const body = bodyText ?? (await safeText(res));
  const status = res.status;
  const detail = (body || '').trim().slice(0, 240);

  if (status === 401 || status === 403) {
    return new LlmError({
      code: 'auth',
      status,
      message: `${providerLabel} ${status}: invalid or missing API key${detail ? ` — ${detail}` : ''}`
    });
  }
  if (status === 429) {
    return new LlmError({
      code: 'rate_limit',
      status,
      retriable: true,
      message: `${providerLabel} 429: rate limit hit — please retry shortly`
    });
  }
  if (status === 400) {
    return new LlmError({
      code: 'bad_request',
      status,
      message: `${providerLabel} 400${detail ? `: ${detail}` : ''}`
    });
  }
  if (status >= 500) {
    return new LlmError({
      code: 'network',
      status,
      retriable: true,
      message: `${providerLabel} ${status}: upstream temporarily unavailable`
    });
  }
  return new LlmError({
    code: 'unknown',
    status,
    message: `${providerLabel} ${status}${detail ? `: ${detail}` : ''}`
  });
}

/**
 * Classify a network-level failure (fetch reject, DNS, abort).
 */
export function fromNetworkError(cause, providerLabel) {
  if (cause?.name === 'AbortError') {
    return new LlmError({
      code: 'unknown',
      message: `${providerLabel}: cancelled`,
      cause
    });
  }
  return new LlmError({
    code: 'network',
    retriable: true,
    message: `${providerLabel}: network error${cause?.message ? ` — ${cause.message}` : ''}`,
    cause
  });
}

/**
 * Short, user-facing message for UI display. Hides upstream details unless
 * they're actionable (bad_request usually is — it surfaces the model's own
 * reason for rejection).
 */
export function friendlyMessage(err) {
  if (!(err instanceof LlmError)) return err?.message || String(err);
  switch (err.code) {
    case 'auth': return 'API key invalid — open Settings ⚙ and check your key.';
    case 'rate_limit': return 'Rate limit hit — please wait a moment and retry.';
    case 'bad_request': return err.message; // upstream detail is usually actionable
    case 'network': return 'Network error — check your connection or retry.';
    default: return err.message || 'Translation failed.';
  }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
