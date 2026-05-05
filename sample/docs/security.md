# Security Considerations

## Threat Model

This project is designed for **personal/local use** — running on `localhost` or a trusted internal network. It is **not suitable for public deployment** without significant changes.

## Known Limitations

### 1. API Keys in URL Query Parameters

API keys are passed via `?key=` in the request URL:

```
https://generativelanguage.googleapis.com/v1beta/models/...?key=AIzaSy...
```

**Risks:**
- Keys appear in browser history and devtools Network tab
- Keys may be logged by proxies, CDNs, or network monitoring tools
- Keys are visible in `Referer` headers on subsequent navigation

**Mitigation:** Use a backend proxy that injects the API key server-side, keeping it out of the browser entirely.

### 2. XOR Obfuscation Is Not Encryption

The XOR scheme in `gemma.js` uses a hardcoded seed (`"20250710"`) visible in the source code. Anyone who can read the JavaScript can:
1. Read the `XOR_SEED` value
2. Fetch `gemma_code.jsonl`
3. Decrypt all API keys

**This provides obfuscation** (keys are not in plaintext at rest) **but not security** (the decryption key is public).

**Mitigation:** For production use, store API keys server-side and proxy API requests through your backend.

### 3. Global JavaScript State

All key management variables (`apiKeys`, `currentKeyIndex`, `keyUseCount`) are declared as global `var` and are accessible from the browser console:

```javascript
// Anyone can run this in devtools
console.log(apiKeys);
```

**Mitigation:** This is inherent to client-side JavaScript — the real fix is moving keys server-side.

### 4. Potential XSS in Stress Test

In `smoke.html`, the `logResult()` function uses `innerHTML` to render log rows. The `r.msg` field is escaped via `esc()`, but `r.keyLabel` is inserted without escaping:

```javascript
row.innerHTML = `...Key ${r.keyLabel || "?"}...`;
```

Since `keyLabel` is constructed internally (e.g., `"#1"`), this is not exploitable in normal use, but it violates the principle of defense in depth.

**Mitigation:** Pass `r.keyLabel` through the `esc()` function.

### 5. `Function()` Constructor in Calculator Tool

In `tools_demo.html`, the `calculate` tool uses `Function()` to evaluate math expressions:

```javascript
const result = Function('"use strict"; return (' + expr + ')')();
```

While the input is filtered via `/[^0-9+\-*/().%\s]/g` to strip non-math characters, `Function()` is functionally equivalent to `eval()`. The current regex filter is restrictive enough to prevent injection, but future modifications must not relax this filter (e.g., allowing letters would enable arbitrary code execution).

**Mitigation:** For production use, replace `Function()` with a proper math expression parser (e.g., `math.js` or a custom recursive descent parser).

### 6. Markdown Renderer XSS Surface

The custom Markdown renderer in `chat.html` uses regex-based HTML injection. While it escapes `<`, `>`, and `&` before processing, complex or adversarial input could potentially bypass the regex patterns.

**Mitigation:** Consider using a battle-tested Markdown library (e.g., `marked` with `sanitize` option) for production use.

### 7. Model Safety Evaluation Gaps

Gemma 3 27B IT's safety evaluations have been **primarily conducted in English only** ([arXiv:2503.19786](https://arxiv.org/abs/2503.19786)). Since this project promotes multilingual capabilities (140+ languages), there is a gap between the model's language coverage and its safety validation coverage.

**Risk:** Non-English inputs may produce outputs that would be filtered in English but pass unchecked in other languages.

**Mitigation:** Implement application-level output filtering for sensitive use cases, especially in non-English languages.

### 8. Model Hallucination

The model has documented hallucination rates: 63.9% at 27B scale (vs 79.0% at 2B), with significantly higher rates when encountering "symbolic triggers" — modifiers (84-95%) and named entities (84-94%) ([arXiv:2509.09715](https://arxiv.org/abs/2509.09715)).

**Risk:** Users may trust model outputs that contain fabricated facts, especially in knowledge-intensive applications.

**Mitigation:** For factual tasks, use RAG (retrieval-augmented generation) to ground model responses in verified data. Display appropriate disclaimers in the UI.

## Recommendations

| Priority | Action |
|----------|--------|
| High | Move API keys to a backend proxy for any non-local deployment |
| High | Add output disclaimers for factual/knowledge tasks (hallucination risk) |
| Medium | Replace `Function()` eval in calculator tool with a safe math parser |
| Medium | Escape all dynamic values in `innerHTML` assignments |
| Medium | Use a mature Markdown sanitizer instead of custom regex |
| Medium | Implement output filtering for non-English languages (safety gap) |
| Low | Wrap `gemma.js` in an IIFE or ES module to avoid global state pollution |
| Low | Add `Content-Security-Policy` headers to restrict inline scripts |
