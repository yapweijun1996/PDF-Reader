# gemma_client — API Reference

`gemma_client` is a refactored, modular version of `gemma.js` that adds **prompt-based function calling** support for Gemma models. It builds into a single file via `npm run build`.

> **Why prompt-based?** Live API testing confirmed that Gemma models have **three disabled API features**:
> - `tools` / `functionDeclarations` → `"Function calling is not enabled"`
> - `systemInstruction` → `"Developer instruction is not enabled"`
> - `responseMimeType: 'application/json'` → `"JSON mode is not enabled"`
>
> This library solves function calling by injecting tool definitions into the user prompt, parsing `<tool_call>` XML tags from model output, executing handlers, and feeding results back. Live testing confirmed the model correctly outputs structured `<tool_call>` tags. See [model limitations](gemma-3-27b-it.md#已知限制经-live-api-测试确认) for details.

## Quick Start

```html
<script src="gemma_client/dist/gemma_client.js"></script>
<script>
  const { GemmaAPI, KeyManager, ToolRegistry, ToolRunner } = GemmaClient;

  // 1. Setup
  const keyManager = new KeyManager({ seed: '20250710' });
  const api = new GemmaAPI({ keyManager });

  // 2. Load keys
  await keyManager.loadFromJSONL('./gemma_code.jsonl');

  // 3. Simple chat
  const history = [];
  const reply = await api.chat('Hello!', history);
  console.log(reply);

  // 4. Function calling
  const registry = new ToolRegistry();
  registry.add({
    name: 'get_weather',
    description: 'Get weather for a city',
    parameters: { location: { type: 'string', required: true } },
    handler: async (args) => ({ temp: 22, city: args.location })
  });

  const runner = new ToolRunner(api, registry);
  const result = await runner.run('What is the weather in Tokyo?');
  console.log(result.response);    // Final model answer
  console.log(result.toolCalls);   // [{name, arguments, result}]
</script>
```

## Build

```bash
cd gemma_client
npm install
npm run build        # → dist/gemma_client.js (18kb)
npm run build:min    # → dist/gemma_client.min.js (9kb)
npm run watch        # rebuild on file changes
```

## Architecture

```
gemma_client/
├── src/
│   ├── core.js      # Encryption, KeyManager, sleep, fetchWithRetry
│   ├── client.js    # GemmaAPI class (generateContent, chat, vision)
│   ├── tools.js     # ToolRegistry, ToolRunner, parseToolCalls
│   ├── oodae.js     # OODAERunner (OODA-E + COT agent runtime)
│   └── index.js     # Entry point (re-exports everything)
├── test/
│   ├── run_all.js         # Test runner (--unit / --live / --all)
│   ├── helpers.js         # Assertions, key loading, test tools
│   ├── test_core.js       # Unit: crypto, KeyManager
│   ├── test_tools.js      # Unit: ToolRegistry, JSON parsing
│   ├── test_oodae_unit.js # Unit: OODA-E helpers (no API)
│   └── test_oodae_live.js # Live: full OODA-E with real API
├── dist/
│   ├── gemma_client.js      # Bundled IIFE (browser-ready)
│   └── gemma_client.min.js  # Minified version
└── package.json
```

All exports are available under the global `GemmaClient` namespace when loaded via `<script>`.

---

## Exports

| Export | Type | Module |
|--------|------|--------|
| `encryptKey(message, key)` | Function | core.js |
| `decryptKey(ciphertext, key)` | Function | core.js |
| `KeyManager` | Class | core.js |
| `sleep(ms)` | Function | core.js |
| `fetchWithRetry(url, opts, retryOpts)` | Function | core.js |
| `GemmaAPI` | Class | client.js |
| `ToolRegistry` | Class | tools.js |
| `ToolRunner` | Class | tools.js |
| `parseToolCalls(text)` | Function | tools.js |
| `hasToolCalls(text)` | Function | tools.js |
| `stripToolCalls(text)` | Function | tools.js |

---

## KeyManager

```javascript
const km = new KeyManager({
  seed: '20250710',      // XOR encryption seed
  rotateEveryN: 5        // proactive rotation interval
});
```

| Method | Returns | Description |
|--------|---------|-------------|
| `loadFromJSONL(url)` | `Promise<number>` | Fetch + decrypt keys, returns count |
| `addKey(plaintext)` | `void` | Add a plaintext key directly |
| `current()` | `string` | Get current key (may trigger rotation) |
| `rotate()` | `void` | Manually advance to next key |
| `onRotate(fn)` | `void` | Set rotation callback `fn(prevIndex, newIndex)` |
| `count` | `number` | Number of loaded keys (getter) |

---

## GemmaAPI

```javascript
const api = new GemmaAPI({
  keyManager: km,                    // KeyManager instance
  model: 'gemma-3-27b-it',          // default model
  generationConfig: { ... },        // default generation config
  retryOpts: { maxRetries: 5, baseDelay: 1000 }
});
```

| Method | Returns | Description |
|--------|---------|-------------|
| `loadKeys(url)` | `Promise<number>` | Shortcut for `keyManager.loadFromJSONL(url)` |
| `generateContent(opts)` | `Promise<object>` | Raw API call. `opts: { contents, model?, generationConfig? }` |
| `chat(text, history, opts?)` | `Promise<string>` | Send text, get reply. Mutates `history`. |
| `vision(text, base64, mime, history, opts?)` | `Promise<string>` | Send image+text, get reply. |

---

## ToolRegistry

```javascript
const registry = new ToolRegistry();

registry.add({
  name: 'calculate',
  description: 'Evaluate a math expression',
  parameters: {
    expression: { type: 'string', required: true, description: 'e.g. "2+2"' }
  },
  handler: async (args) => {
    return Function('"use strict"; return (' + args.expression + ')')();
  }
});
```

| Method | Returns | Description |
|--------|---------|-------------|
| `add(definition)` | `void` | Register a tool (name, description, parameters, handler) |
| `remove(name)` | `boolean` | Remove a tool by name |
| `clear()` | `void` | Remove all tools |
| `has(name)` | `boolean` | Check if tool exists |
| `get(name)` | `object` | Get tool definition + handler |
| `list()` | `Array` | List all tools (without handlers) |
| `execute(name, args)` | `Promise<{result}|{error}>` | Run a tool with arguments |
| `size` | `number` | Number of registered tools (getter) |

### Tool Definition Format

```javascript
{
  name: 'tool_name',           // required
  description: 'What it does', // shown to model
  parameters: {
    param1: {
      type: 'string',          // string, number, boolean, object, array
      required: true,          // required or optional
      description: '...',      // shown to model
      default: 'value',        // applied if not provided
      enum: ['a', 'b']         // allowed values (shown to model)
    }
  },
  handler: async (args) => {   // required — the actual function
    return someResult;
  }
}
```

---

## ToolRunner

The agentic loop that connects the model to your tools.

```javascript
const runner = new ToolRunner(api, registry, {
  maxIterations: 5   // max model↔tool round-trips
});
```

### `runner.run(userText, opts)`

| Option | Type | Description |
|--------|------|-------------|
| `chatHistory` | `Array` | Existing conversation (default: new `[]`) |
| `model` | `string` | Override model |
| `generationConfig` | `object` | Override config |
| `onToolCall` | `function(call)` | Called before each tool executes |
| `onToolResult` | `function(call, result)` | Called after each tool executes |
| `onModelReply` | `function(text, iteration)` | Called on each model response |

**Returns:** `Promise<ToolRunResult>`

```javascript
{
  response: 'The weather in Tokyo is...',  // final model text
  toolCalls: [                              // trace of all tool calls
    { name: 'get_weather', arguments: { location: 'Tokyo' }, result: { temp: 22 } }
  ],
  chatHistory: [...],                       // full conversation
  iterations: 2                             // number of model rounds
}
```

### How It Works

```
1. Inject system prompt with tool definitions into chatHistory
2. Send user message to model
3. Model responds:
   ├── No <tool_call> tags → return response (done)
   └── Has <tool_call> tags → parse, execute, feed results back
4. Repeat step 3 (up to maxIterations)
```

The model sees tools defined in the system prompt and outputs `<tool_call>` XML tags containing JSON:

```
<tool_call>
{"name": "get_weather", "arguments": {"location": "Tokyo"}}
</tool_call>
```

The ToolRunner parses these, executes the matching handler, and sends results back as `<tool_result>` blocks for the model to use in its final answer.

---

## Parsing Utilities

| Function | Description |
|----------|-------------|
| `parseToolCalls(text)` | Extract `[{name, arguments}]` from text with `<tool_call>` tags |
| `hasToolCalls(text)` | Returns `true` if text contains `<tool_call>` |
| `stripToolCalls(text)` | Remove all `<tool_call>...</tool_call>` blocks from text |

The parser includes JSON recovery for common Gemma formatting quirks:
- Trailing commas
- Code fences inside tags
- Single-quoted strings
- Unquoted keys
- `args` / `parameters` aliases for `arguments`

---

## Demo Pages

The `gemma_client` library includes two built-in demo pages:

### Test Dashboard — `gemma_client/index.html`

A comprehensive test runner with both offline unit tests and live API tests.

- **Unit tests** run entirely in the browser — 8 groups covering encryption, KeyManager, GemmaAPI, parseToolCalls, ToolRegistry, tool execution, and module exports
- **Live API tests** use real keys to verify model capabilities (text generation, multilingual, code, math, temperature effects, prompt-based function calling)
- Stats dashboard, filter tabs, progress bar, and collapsible console log

### Debug Chat — `gemma_client/chat.html`

A developer-focused chat interface for debugging API interactions.

- **Tool Calling toggle** — switch between plain chat and `ToolRunner` agentic loop at runtime
- **Show Raw toggle** — view raw model output alongside rendered markdown
- **Debug modal** — inspect `chatHistory` array, API request/response payloads, and token metadata
- **Console panel** — in-page log of API calls, key rotations, and tool execution

> These pages are useful for verifying your setup, testing tool definitions, and debugging prompt-based function calling behavior.

---

## Testing

The test suite covers core modules, tool registry, and OODA-E agent runtime. See [Testing Guide](testing.md) for full details.

```bash
cd gemma_client
npm test                      # all tests
npm run test:unit             # unit only (fast, no API)
npm run test:live             # live only (needs API keys)
node test/test_core.js        # single file
```

| File | Type | Tests | What it covers |
|------|------|-------|----------------|
| `test_core.js` | Unit | ~25 | encrypt/decrypt, KeyManager, sleep |
| `test_tools.js` | Unit | ~35 | parseToolCalls, ToolRegistry, JSON recovery |
| `test_oodae_unit.js` | Unit | ~65 | All OODAERunner helper methods |
| `test_oodae_live.js` | Live | 4 | Full OODA-E with real API (greeting, search, math, follow-up) |

---

## Migration from gemma.js

| Old (gemma.js) | New (gemma_client) |
|----------------|-------------------|
| `loadApiKeys()` | `keyManager.loadFromJSONL(url)` |
| `getCurrentKey()` | `keyManager.current()` |
| `rotateKey()` | `keyManager.rotate()` |
| `callGeminiAPI(model, msg, history, config)` | `api.chat(text, history)` or `api.generateContent({...})` |
| `encryptKey(msg, KEY)` | `GemmaClient.encryptKey(msg, key)` |
| `decryptKey(ct, KEY)` | `GemmaClient.decryptKey(ct, key)` |
| N/A | `registry.add({...})` + `runner.run(text)` (function calling!) |
