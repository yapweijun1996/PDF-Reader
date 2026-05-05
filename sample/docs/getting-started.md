# Getting Started

## Prerequisites

- One or more Google Gemini API keys from [Google AI Studio](https://aistudio.google.com/apikey)
- Any static file server (Python, Node.js, or similar)

## 1. Encrypt Your API Keys

Open any of the HTML files in a browser and run this in the developer console:

```javascript
encryptKey("YOUR_API_KEY_HERE", XOR_SEED)
// Returns: "115121072084099078114097..."
```

The function XOR-encrypts each byte of your key with the seed (`"20250710"` by default) and zero-pads each result to 3 digits.

## 2. Add Keys to `gemma_code.jsonl`

Add one encrypted key per line:

```jsonl
{"key":"115121072084099078114097099127070118103026064074004096070122002002087007103088084003008127114120091091120086009097120"}
{"key":"115121072084099078115105103069031113111093126067123117106064105084110122096065092096029121002105087004112002006121096"}
```

Multiple keys enable automatic rotation and failover.

## 3. Serve the Project

```bash
# Python
python -m http.server 8000

# Node.js
npx http-server

# Then open http://localhost:8000
```

> **Important:** Files must be served over HTTP — opening HTML files directly via `file://` will fail because `fetch()` cannot load local `.jsonl` files.

## 4. Use the Applications

- **Dashboard** (`index.html`) — Navigate to all tools
- **OCR** (`ocr.html`) — Upload or paste an image, click "Perform OCR"
- **Chat** (`chat.html`) — Type a message or attach an image, press Enter
- **Stress Test** (`smoke.html`) — Configure requests/concurrency, click Run
- **Tool Use** (`tools_demo.html`) — Try function calling with registered tools
- **GemmaClient Tests** (`gemma_client/index.html`) — Run unit tests and live API tests for `gemma_client`
- **GemmaClient Chat** (`gemma_client/chat.html`) — Debug chat with tool calling toggle and raw output view

## Customizing the XOR Seed

If you change `XOR_SEED` in `gemma.js`, you must re-encrypt all keys with the new seed:

```javascript
// In gemma.js
var XOR_SEED = "myNewSeed123";

// Then re-encrypt each key in the browser console
encryptKey("AIzaSy...", "myNewSeed123")
```

Replace all entries in `gemma_code.jsonl` with the newly encrypted values.

## Adding More Models

Each application has a `<select>` element with model options. Default is **[Gemma 3 27B IT](gemma-3-27b-it.md)** — a 27B multimodal model with 128K context and vision support.

Available Gemma 3 models:

| Model | Parameters | Context | Vision | Best For |
|-------|-----------|---------|--------|----------|
| `gemma-3-27b-it` | 27B | 128K | Yes | Highest quality, complex tasks |
| `gemma-3-12b-it` | 12B | 128K | Yes | Good balance of quality and speed |
| `gemma-3-4b-it` | 4B | 128K | Yes | Fast, lightweight tasks |
| `gemma-3-1b-it` | 1B | 32K | No | Edge/mobile, text-only |

To add models, edit the `<option>` elements in the relevant HTML file:

```html
<select id="modelSelect">
    <option value="gemma-3-27b-it" selected>Gemma 3 27B IT</option>
    <option value="gemma-3-12b-it">Gemma 3 12B IT</option>
    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
</select>
```

> See [Gemma 3 27B IT — Model Reference](gemma-3-27b-it.md) for detailed specs, benchmarks, and deployment options.

## Using gemma_client (Recommended)

The `gemma_client` library is the modular successor to `gemma.js`, adding function calling support. To use it:

### 1. Build the library

```bash
cd gemma_client
npm install
npm run build        # → dist/gemma_client.js
```

### 2. Include in your HTML

```html
<script src="gemma_client/dist/gemma_client.js"></script>
<script>
  const { GemmaAPI, KeyManager, ToolRegistry, ToolRunner } = GemmaClient;

  const keyManager = new KeyManager({ seed: '20250710' });
  const api = new GemmaAPI({ keyManager });

  // Load keys and start chatting
  await keyManager.loadFromJSONL('./gemma_code.jsonl');
  const history = [];
  const reply = await api.chat('Hello!', history);
</script>
```

### 3. Add function calling (optional)

```javascript
const registry = new ToolRegistry();
registry.add({
  name: 'get_weather',
  description: 'Get weather for a city',
  parameters: { location: { type: 'string', required: true } },
  handler: async (args) => ({ temp: 22, city: args.location })
});

const runner = new ToolRunner(api, registry);
const result = await runner.run('What is the weather in Tokyo?');
```

See [gemma_client docs](gemma-client.md) for the full API reference.
