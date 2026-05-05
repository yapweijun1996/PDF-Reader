# Architecture

## Project Structure

```
Gemma-JSONL/
├── index.html              # Dashboard — landing page with navigation cards
├── ocr.html                # OCR tool — image-to-text via Gemma 3 vision
├── chat.html               # Chat interface — full conversational UI
├── smoke.html              # Stress test — API load testing with concurrency
├── tools_demo.html         # Tool use — function calling demo with agentic loop
├── gemma.js                # Legacy core module — key management, encryption, API calls
├── gemma_code.jsonl        # Encrypted API keys (one JSON object per line)
├── gemma_client/           # Modular library with function calling support
│   ├── src/
│   │   ├── index.js        #   Entry point (re-exports all modules)
│   │   ├── core.js         #   Encryption, KeyManager, sleep, fetchWithRetry
│   │   ├── client.js       #   GemmaAPI class (generateContent, chat, vision)
│   │   └── tools.js        #   ToolRegistry, ToolRunner, parseToolCalls
│   ├── dist/
│   │   ├── gemma_client.js      # Bundled IIFE (browser-ready)
│   │   └── gemma_client.min.js  # Minified version
│   ├── index.html          #   Test dashboard — unit + live API tests
│   ├── chat.html           #   Debug chat — tool calling toggle, raw view, console
│   └── package.json        #   npm run build → single file
├── docs/                   # Documentation (you are here)
└── test/
    ├── test_gemma.html           # Legacy gemma.js tests
    ├── test_gemma_client.html    # gemma_client unit tests (8 groups)
    ├── live_gemma_study.mjs      # Node.js live API test suite (30+ tests)
    └── live_results.json         # Live test output (JSON)
```

## Default Model — Gemma 3 27B IT

The project defaults to `gemma-3-27b-it`, a 27B-parameter multimodal model with:
- **128K context** — supports long documents and extended conversations
- **Vision input** — OCR and image understanding via SigLIP encoder
- **140+ languages** — broad multilingual support (CJK, Malay verified via live tests)
- **Three API features disabled** — `tools`, `systemInstruction`, `responseMimeType: 'application/json'` all return HTTP 400
- **Workarounds verified** — prompt-based function calling, system prompts, and JSON output all work via prompt engineering

Live API test results (`test/live_gemma_study.mjs`): 31/41 tests passed. 4 failures were from suspended API keys, 3 from high-demand 503 errors, and 3 confirmed feature limitations (400 errors).

See [Gemma 3 27B IT — Model Reference](gemma-3-27b-it.md) for full specs.

---

## Design Decisions

### Single Shared Module

All pages include `gemma.js` via `<script src="./gemma.js">`. This module provides:
- Key encryption/decryption
- Key loading and rotation
- Rate-limit-aware fetch wrapper
- The main `callGeminiAPI()` function

Each page then adds its own application-specific logic inline.

### Global State

`gemma.js` uses global `var` declarations for shared state (`apiKeys`, `currentKeyIndex`, `keyUseCount`). This allows application pages to directly access and extend the state (e.g., `smoke.html` monkey-patches `rotateKey()` to count rotations).

### No Build System

The project deliberately avoids build tools, bundlers, and package managers. Each HTML file is self-contained (styles + markup + scripts) and only depends on `gemma.js` and `gemma_code.jsonl`.

### JSONL Key Storage

API keys are stored in JSONL (JSON Lines) format — one `{"key":"..."}` object per line. This format:
- Is easy to append to (just add a new line)
- Allows line-by-line parsing without loading the entire file into a JSON array
- Works well with version control diffs

---

## Application Details

### Dashboard (`index.html`)

A static landing page with CSS Grid cards linking to all tools. No JavaScript — pure HTML/CSS with responsive layout (2-column → 1-column on mobile).

### OCR (`ocr.html`)

**Flow:**
1. User uploads or pastes an image
2. Image is read as base64 via `FileReader`
3. Sent to Gemini with a prompt: *"Extract text from the given image..."*
4. Response text is displayed in a chat-style message area
5. Any inline binary data (e.g., processed images) gets download links

**Features:**
- File input and clipboard paste support
- Image preview modal
- Inline data download handling

### Chat (`chat.html`)

**Flow:**
1. User types a message and/or attaches an image
2. Message is rendered in the UI with a user avatar
3. A typing indicator (bouncing dots) appears
4. `callGeminiAPI()` is called with the full conversation history
5. Response is rendered with basic Markdown formatting

**Features:**
- Sidebar with session history (in-memory, not persisted)
- Custom Markdown renderer (headings, bold, italic, code blocks, lists, links, blockquotes)
- Image attachment with preview and modal zoom
- Suggestion chips for common prompts
- Textarea auto-resize
- Enter to send, Shift+Enter for newline

**Limitation:** Session history is stored in a JavaScript array — it is lost on page refresh. Consider using `localStorage` for persistence.

### Stress Test (`smoke.html`)

**Flow:**
1. User sets total requests, concurrency level, and model
2. A connection pool runs N concurrent requests
3. Each request sends a minimal prompt: *"Reply with just the number 1."*
4. Results are logged in real-time with status, response preview, key used, and latency

**Features:**
- Configurable concurrency (1–10) and request count (1–500)
- Real-time stats: success count, error count, key rotations, average latency
- Progress bar with percentage
- Abort button
- Monkey-patches `rotateKey()` to track rotation count

### Tool Use Demo (`tools_demo.html`)

**Flow:**
1. Tools are registered with `ToolRegistry` (get_weather, calculate, get_time, search_knowledge)
2. User sends a message
3. `ToolRunner` injects tool definitions into system prompt, sends to model
4. Model outputs `<tool_call>` XML tags with JSON arguments
5. Runner parses tags, executes matching handlers, sends results back
6. Loop repeats until model produces a final answer (up to `maxIterations`)

**Features:**
- Prompt-based function calling (Gemma does **not** support native `tools` API parameter)
- Multi-model support (27B/12B/4B/1B)
- Color-coded messages for user, model, tool calls, and tool results
- Built on `gemma_client` library

### GemmaClient Test Dashboard (`gemma_client/index.html`)

A comprehensive test runner for the `gemma_client` library with both offline unit tests and live API tests.

**Features:**
- **Unit tests**: 8 test groups covering encryption, KeyManager, GemmaAPI, parseToolCalls, ToolRegistry, tool execution, and module exports — run entirely offline
- **Live API tests**: Real API calls to verify model capabilities (text generation, multilingual, code, math, structured output, temperature effects, function calling)
- **Stats dashboard**: Total/passed/failed/skipped counts with duration
- **Filter tabs**: View all, passed, failed, or skipped tests
- **Progress bar**: Visual progress for live API tests
- **Collapsible console log**: Debug output for test execution

### GemmaClient Debug Chat (`gemma_client/chat.html`)

A developer-focused chat interface built on `gemma_client` with debugging tools for inspecting API interactions.

**Features:**
- **Tool Calling toggle**: Switch between plain chat and function-calling mode at runtime
- **Show Raw toggle**: Display raw model output alongside rendered markdown
- **Debug modal**: Inspect full conversation history, API request/response payloads, and token metadata
- **Console panel**: Collapsible in-page console showing API calls, key rotations, and tool execution logs
- **Multi-model support**: Switch between Gemma 3 27B/12B/4B/1B
- Built on `gemma_client` with `ToolRunner` integration

---

## Model Architecture — Gemma 3 27B IT

The default model uses a hybrid attention architecture documented in [arXiv:2503.19786](https://arxiv.org/abs/2503.19786):

```
Input (text + optional image via SigLIP encoder)
    │
    ▼
┌─────────────────────────────────────┐
│  62-layer Decoder-only Transformer  │
│                                     │
│  Repeating block pattern (5:1):     │
│  ┌─────────────────────────────┐    │
│  │ 5× Local Attention Layers   │    │  ← sliding window: 1,024 tokens
│  │ 1× Global Attention Layer   │    │  ← full context, RoPE base freq: 1M
│  └─────────────────────────────┘    │
│  × 10 repeats + 2 extra layers     │
│                                     │
│  GQA: 32 attention heads, 16 KV    │
│  Hidden dim: 5,376                  │
│  Vocab: 262,144 (Gemini 2.0)       │
└─────────────────────────────────────┘
    │
    ▼
Output (text only)
```

This 5:1 local-to-global ratio dramatically reduces KV cache memory while maintaining global semantic understanding, enabling the 128K context window.

See [Gemma 3 27B IT — Model Reference](gemma-3-27b-it.md) for full specs.

---

## API Communication

All API calls go through the Gemini REST endpoint:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
```

Request body:
```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "..." }] },
    { "role": "model", "parts": [{ "text": "..." }] }
  ],
  "generationConfig": {
    "temperature": 1,
    "topP": 0.95,
    "topK": 40,
    "responseMimeType": "text/plain"
  }
}
```

The `contents` array contains the full conversation history, enabling multi-turn dialogue.
