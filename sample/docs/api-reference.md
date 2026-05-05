# API Reference — `gemma.js`

`gemma.js` is the shared core module loaded by all application pages. It provides key management, encryption, rate-limit handling, and the Gemini API call wrapper.

## Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `XOR_SEED` | `string` | `"20250710"` | Seed used for XOR encryption/decryption |
| `ROTATE_EVERY_N` | `number` | `5` | Rotate to next key after this many API calls |
| `RATE_LIMIT_MAX_RETRIES` | `number` | `5` | Max retry attempts on 429/500 errors |
| `RATE_LIMIT_BASE_DELAY` | `number` | `1000` | Base delay in ms for exponential backoff |

## Global State

| Variable | Type | Description |
|----------|------|-------------|
| `apiKeys` | `string[]` | Decrypted API keys (populated by `loadApiKeys()`) |
| `currentKeyIndex` | `number` | Index of the currently active key |
| `keyUseCount` | `number` | Number of API calls made (drives proactive rotation) |

---

## Functions

### `encryptKey(message, KEY)`

Encrypts a plaintext string using XOR with the given key.

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `string` | Plaintext API key |
| `KEY` | `string` | XOR seed string |

**Returns:** `string` — Encrypted ciphertext (3-digit zero-padded numbers concatenated)

**Usage:**
```javascript
// In browser console
encryptKey("AIzaSyB-abc123", XOR_SEED)
// → "115121072084099078114097..."
```

---

### `decryptKey(ciphertext, KEY)`

Decrypts an XOR-encrypted string back to plaintext.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ciphertext` | `string` | Encrypted key string (from `encryptKey`) |
| `KEY` | `string` | XOR seed string (must match encryption seed) |

**Returns:** `string` — Original plaintext API key

---

### `loadApiKeys()`

Fetches `gemma_code.jsonl`, parses each line, and decrypts all keys into the `apiKeys` array.

**Returns:** `Promise<void>`

**Side effects:**
- Populates `apiKeys[]` with decrypted keys
- Resets `currentKeyIndex` to `0`
- Logs key count to console

**Error handling:** On failure, sets `apiKeys` to `[]` and logs to `console.error`.

---

### `getCurrentKey()`

Returns the current API key. Triggers proactive rotation if `keyUseCount` is a multiple of `ROTATE_EVERY_N`.

**Returns:** `string` — The current decrypted API key

**Throws:** `Error` if no API keys are loaded

**Side effects:** Increments `keyUseCount`, may call `rotateKey()`

---

### `rotateKey()`

Advances `currentKeyIndex` to the next key (wraps around).

**Returns:** `void`

**Side effects:** Updates `currentKeyIndex`, logs rotation to console

---

### `sleep(ms)`

Returns a promise that resolves after the specified delay.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Milliseconds to wait |

**Returns:** `Promise<void>`

---

### `fetchWithRetry(url, options)`

Wrapper around `fetch()` that automatically retries on HTTP 429 and 500 responses.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Request URL |
| `options` | `object` | Standard `fetch()` options |

**Returns:** `Promise<Response>`

**Retry logic:**
1. If response is 429 or 500, check `Retry-After` header
2. If header present, wait that many seconds
3. Otherwise, wait `RATE_LIMIT_BASE_DELAY * 2^retry` ms (exponential backoff)
4. After `RATE_LIMIT_MAX_RETRIES` failures, return the last response as-is

---

### `callGeminiAPI(model, userMessage, chatHistory, generationConfig)`

Main API call function with key rotation and multi-key failover.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | `string` | Model name (e.g. `"gemma-3-27b-it"`) |
| `userMessage` | `object` | `{ role: "user", parts: [...] }` |
| `chatHistory` | `Array` | Conversation history array (modified in place) |
| `generationConfig` | `object` | Generation parameters (temperature, topP, etc.) |

**Returns:** `Promise<object>` — The full API response JSON

**Behavior:**
1. Pushes `userMessage` onto `chatHistory`
2. Tries each API key (up to `apiKeys.length` attempts)
3. On non-OK response: logs error, rotates key, retries
4. On success: pushes model response onto `chatHistory`, returns result
5. If all keys fail: pops `userMessage` from `chatHistory`, throws last error

**Throws:** `Error` if all keys are exhausted or a non-API error occurs

---

## Data Flow

```
gemma_code.jsonl
    │
    ▼
loadApiKeys()  ──►  apiKeys[]
                        │
                        ▼
                  getCurrentKey()  ──►  rotateKey() (every N uses)
                        │
                        ▼
                  callGeminiAPI()
                        │
                        ├──►  fetchWithRetry()  ──►  Gemini API
                        │         │
                        │         └──  retry on 429/500
                        │
                        └──  rotate key on error, retry with next key
```

---

## Known Limitations

### No Native Function Calling (Tool Use)

Gemma models (`gemma-3-27b-it`, etc.) **do not support** the native `tools` / `function_declarations` API parameter. Attempting to pass `tools` will result in:

> "Function calling is not enabled for models/gemma-3-27b-it"

This is a model-level limitation, not a `gemma.js` limitation. `callGeminiAPI()` only sends `contents` and `generationConfig`, which is the correct usage for Gemma models.

**Workarounds:**
1. **Prompt-based function calling via `gemma_client`** — The [gemma_client](gemma-client.md) library injects tool definitions into the system prompt, parses `<tool_call>` tags from model output, executes handlers, and feeds results back. See `tools_demo.html` for a live demo.
2. **Switch to Gemini models** — Use `gemini-2.0-flash` or similar for native `tools` support.
3. **FunctionGemma** — A tiny 270M model fine-tuned for function calling (edge/IoT use cases).

### Gemma 3 27B IT vs Gemini — API Feature Comparison (Live-Verified)

> 以下对比通过 Live API 测试验证（`test/live_gemma_study.mjs`）。
> 完整模型规格请参阅 [Gemma 3 27B IT 模型参考](gemma-3-27b-it.md)

| API Feature | Gemini | Gemma 3 27B IT | Live Test Result |
|-------------|--------|----------------|------------------|
| `contents` + `generationConfig` | Yes | Yes | ✅ Verified |
| `temperature` (0 – 2.0) | Yes | Yes | ✅ Verified |
| `topP`, `topK` | Yes | Yes | ✅ Verified |
| `stopSequences` | Yes | Yes | ✅ Verified |
| Vision / multimodal (inline images) | Yes | Yes | ✅ Verified (SigLIP) |
| Multi-turn conversation | Yes | Yes | ✅ Verified |
| Multilingual (CJK, Malay, etc.) | Yes | Yes | ✅ Verified |
| `systemInstruction` | Yes | **No** | ❌ `"Developer instruction is not enabled"` |
| `tools` / `function_declarations` | Yes | **No** | ❌ `"Function calling is not enabled"` |
| `responseMimeType: 'application/json'` | Yes | **No** | ❌ `"JSON mode is not enabled"` |
| `tool_config` (function calling mode) | Yes | **No** | ❌ Not available |
| Structured output (`response_schema`) | Yes | **No** | ❌ Not available |
| Code execution tool | Yes | **No** | ❌ Not available |
| Google Search grounding | Yes | **No** | ❌ Not available |
| Open weights / local deployment | **No** | Yes | Ollama, llama.cpp, etc. |

### Workarounds for Unsupported Features (All Verified)

| Unsupported Feature | Workaround | Status |
|---------------------|-----------|--------|
| `systemInstruction` | Inject `"System: ..."` in first user message | ✅ Works |
| `tools` (native) | Prompt-based function calling via `gemma_client` | ✅ Works — model outputs `<tool_call>` tags |
| JSON mode | Request `"Output valid JSON only"` in prompt | ✅ Works |

### Gemma 3 Model Family (Live-Verified)

| Model | Parameters | Live Test | Avg Latency |
|-------|-----------|-----------|-------------|
| `gemma-3-27b-it` | 27B | ✅ OK | ~7-8s |
| `gemma-3-12b-it` | 12B | ⚠️ 503 (high demand) | — |
| `gemma-3-4b-it` | 4B | ✅ OK | ~1.5s |
| `gemma-3-1b-it` | 1B | ✅ OK | ~0.9s |

For features exclusive to Gemini, change the model to a Gemini variant and extend the request body in `callGeminiAPI()`.
