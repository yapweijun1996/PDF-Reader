# Configuration

All configuration is done by editing variables in `gemma.js` or the generation config objects in each HTML file. There is no separate config file.

## gemma.js — Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `XOR_SEED` | `"20250710"` | Seed for XOR encryption/decryption. Change this **before** encrypting keys. |
| `ROTATE_EVERY_N` | `5` | Proactive key rotation interval. After every N API calls, switches to the next key. |
| `RATE_LIMIT_MAX_RETRIES` | `5` | Max retry attempts on HTTP 429 or 500. |
| `RATE_LIMIT_BASE_DELAY` | `1000` | Base delay (ms) for exponential backoff. Actual delays: 1s, 2s, 4s, 8s, 16s. |

### Changing the XOR Seed

```javascript
// In gemma.js, line 14
var XOR_SEED = "your_new_seed";
```

After changing the seed, re-encrypt all API keys:

```javascript
// In the browser console
encryptKey("YOUR_API_KEY", "your_new_seed")
```

Then update every line in `gemma_code.jsonl` with the new encrypted values.

### Adjusting Key Rotation

```javascript
// Rotate every 10 uses instead of 5
var ROTATE_EVERY_N = 10;

// Disable proactive rotation (only rotate on error)
var ROTATE_EVERY_N = Infinity;
```

### Adjusting Retry Behavior

```javascript
// More aggressive retries
var RATE_LIMIT_MAX_RETRIES = 10;
var RATE_LIMIT_BASE_DELAY = 500;  // start at 500ms

// No retries
var RATE_LIMIT_MAX_RETRIES = 0;
```

---

## Application-Level Settings

### Generation Config

Each HTML app defines its own `generationConfig` object passed to `callGeminiAPI()`:

| Parameter | Default | Live-Verified | Description |
|-----------|---------|---------------|-------------|
| `temperature` | 1 | ✅ Works (0 – 2.0) | Controls randomness (0 = deterministic, 2 = very random) |
| `topP` | 0.95 | ✅ Works | Nucleus sampling threshold |
| `topK` | 40 | ✅ Works | Top-K sampling limit |
| `stopSequences` | — | ✅ Works | Stop generation at specified sequences |
| `responseMimeType` | `"text/plain"` | ⚠️ See note | Response format |

> **Live API Finding:** `responseMimeType: 'application/json'` returns error `"JSON mode is not enabled for models/gemma-3-27b-it"`. Only `"text/plain"` works. To get JSON output, instruct the model via the prompt (e.g., `"Output valid JSON only"`).
>
> **Live API Finding:** `systemInstruction` is also not supported for Gemma models. Use system-style prompts in the first user message instead.

### Model Selection

Models are configured in `<select>` elements within each HTML file. Default: **`gemma-3-27b-it`**.

**[Gemma 3 27B IT](gemma-3-27b-it.md)** is a 27B-parameter multimodal model with 128K context, vision support, and 140+ languages. It outperforms many larger models (Arena Elo 1,338).

To add a new model, add an `<option>` to the select element:

```html
<option value="gemma-3-27b-it" selected>Gemma 3 27B IT</option>
<option value="gemma-3-12b-it">Gemma 3 12B IT</option>
<option value="gemma-3-4b-it">Gemma 3 4B IT</option>
<option value="gemma-3-1b-it">Gemma 3 1B IT</option>
<option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
```

#### Gemma 3 Model Family

| Model | Parameters | Context | Vision | VRAM (INT4) |
|-------|-----------|---------|--------|-------------|
| `gemma-3-27b-it` | 27B | 128K | Yes | ~14 GB |
| `gemma-3-12b-it` | 12B | 128K | Yes | ~7 GB |
| `gemma-3-4b-it` | 4B | 128K | Yes | ~3 GB |
| `gemma-3-1b-it` | 1B | 32K | No | ~1 GB |

> Note: Gemma models do not support native function calling. Use `gemma_client` for prompt-based tool use.

### Smoke Test Specific

In `smoke.html`:

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| Total Requests | 1–500 | — | Number of API calls to make |
| Concurrency | 1–10 | — | How many requests run in parallel |

---

## gemma_client — Library Settings

When using the `gemma_client` library instead of `gemma.js`, configuration is passed via constructor options rather than global variables.

### KeyManager Options

```javascript
const km = new KeyManager({
  seed: '20250710',      // XOR encryption seed (must match gemma_code.jsonl)
  rotateEveryN: 5        // proactive rotation interval
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `seed` | `'20250710'` | XOR seed for decrypting keys from JSONL |
| `rotateEveryN` | `5` | Rotate to next key after this many API calls |

### GemmaAPI Options

```javascript
const api = new GemmaAPI({
  keyManager: km,
  model: 'gemma-3-27b-it',
  generationConfig: {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    responseMimeType: 'text/plain'
  },
  retryOpts: { maxRetries: 5, baseDelay: 1000 }
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `keyManager` | `new KeyManager()` | KeyManager instance |
| `model` | `'gemma-3-27b-it'` | Default model name |
| `generationConfig` | See above | Default generation parameters |
| `retryOpts.maxRetries` | `5` | Max retry attempts on 429/500 |
| `retryOpts.baseDelay` | `1000` | Base delay (ms) for exponential backoff |

### ToolRunner Options

```javascript
const runner = new ToolRunner(api, registry, {
  maxIterations: 5   // max model↔tool round-trips before stopping
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxIterations` | `5` | Maximum number of model↔tool round-trips per `run()` call |

---

## gemma_code.jsonl — Key Storage

Format: one JSON object per line, each with a `"key"` field containing an XOR-encrypted API key.

```jsonl
{"key":"115121072084099078114097..."}
{"key":"115121072084099078115105..."}
```

- Add more keys by appending lines
- Remove keys by deleting lines
- Order matters only for initial key selection (starts at index 0)
- Minimum: 1 key required; recommended: 3+ for effective rotation
