# Application Guide

Gemma-JSONL includes five HTML pages: a dashboard and four tools. All are standalone browser apps powered by the shared `gemma.js` core module. Default model: **[Gemma 3 27B IT](gemma-3-27b-it.md)** (27B parameters, 128K context, vision support).

---

## Dashboard — `index.html`

The landing page with navigation cards linking to all four tools.

- Dark theme with glassmorphism design
- Responsive grid (2 columns on desktop, 1 on mobile)
- No API calls — purely navigational

---

## OCR Tool — `ocr.html`

Extract text from images using Gemma 3's vision capabilities (SigLIP encoder).

### Features
- **Image upload** via file picker (supports JPEG, PNG, etc.)
- **Clipboard paste** — paste a screenshot directly with Ctrl+V / Cmd+V
- **Image preview** — click to enlarge in a modal
- **Text extraction** — sends image + prompt to Gemini, returns extracted text
- **Download** — save the extracted text

### How It Works
1. User uploads or pastes an image
2. Image is converted to base64 using `FileReader`
3. Sends a multi-part message to Gemini:
   ```javascript
   {
     role: "user",
     parts: [
       { text: "Extract all text from this image." },
       { inline_data: { data: base64Data, mime_type: "image/jpeg" } }
     ]
   }
   ```
4. Displays the model's text response in a chat bubble

### Supported Image Formats
Any format supported by the browser's `FileReader` and Gemini's vision API: JPEG, PNG, GIF, WebP, BMP.

---

## Chat Interface — `chat.html`

A full-featured conversational AI interface.

### Features
- **Multi-turn conversation** — maintains chat history across messages
- **Markdown rendering** — headings, lists, code blocks, blockquotes, links
- **Image support** — attach images to messages for vision tasks
- **Conversation management** — new chat, chat history in sidebar
- **Model selector** — switch models from a dropdown with status indicator
- **Suggestion chips** — quick-start prompts for empty chats
- **Responsive design** — sidebar collapses on mobile

### UI Layout
```
┌─────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────┐ │
│ │ Sidebar  │ │ Main Chat Area             │ │
│ │          │ │ ┌────────────────────────┐  │ │
│ │ New Chat │ │ │ Messages               │  │ │
│ │          │ │ │  [User bubble]         │  │ │
│ │ History  │ │ │  [Model bubble]        │  │ │
│ │  - Chat1 │ │ │  ...                   │  │ │
│ │  - Chat2 │ │ └────────────────────────┘  │ │
│ │          │ │ ┌────────────────────────┐  │ │
│ │ Model:   │ │ │ Input + Send button    │  │ │
│ │ [Select] │ │ └────────────────────────┘  │ │
│ └──────────┘ └────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Message Types
| Type | Style | Description |
|------|-------|-------------|
| User | Blue accent | Messages sent by the user |
| Model | Dark surface | AI responses with markdown |
| System | Yellow alert | System notifications |

---

## Stress Test — `smoke.html`

Load-test the Gemini API to verify key rotation, rate limiting, and overall throughput.

### Features
- **Configurable concurrency** — 1 to 10 parallel requests
- **Adjustable volume** — 1 to 500 total requests
- **Real-time statistics** — success/error counts, average response time, key rotations
- **Detailed request log** — table showing each request's status, response preview, key used, and timing
- **Progress bar** — visual progress with percentage
- **Abort support** — stop a running test at any time

### Statistics Dashboard
| Metric | Color | Description |
|--------|-------|-------------|
| Success | Green | Requests that returned a valid response |
| Errors | Red | Requests that failed after all retries |
| Key Rotations | Amber | Number of times `rotateKey()` was triggered |
| Avg Response Time | Cyan | Mean response time across all completed requests |

### How It Works
1. User sets total requests and concurrency level
2. Clicking "Run" dispatches batches of concurrent requests
3. Each request calls `callGeminiAPI()` with a simple test prompt
4. Results are logged in real-time to the table
5. Statistics update after each request completes
6. The tool patches `rotateKey()` to count rotations

### Use Cases
- Verify all API keys are working
- Test rate-limit behavior and retry logic
- Measure API response times under load
- Confirm key rotation is functioning correctly

---

## Tool Use Demo — `tools_demo.html`

Demonstrate prompt-based function calling using the `gemma_client` library.

### Features
- **4 registered tools**: `get_weather`, `calculate`, `get_time`, `search_knowledge`
- **Agentic loop**: Model calls tools → tools execute → results fed back → model answers
- **Multi-model support**: Switch between Gemma 3 27B/12B/4B/1B
- **Visual feedback**: Color-coded messages for user, model, tool calls, and tool results
- **Tool registry panel**: Shows registered tools with descriptions and parameters

### How It Works
1. Tools are defined and registered with `ToolRegistry`
2. User sends a message (e.g., "What's the weather in Tokyo?")
3. `ToolRunner` injects tool definitions into system prompt
4. Model outputs `<tool_call>` tags with JSON arguments
5. Runner parses tags, executes matching handlers
6. Results sent back as `<tool_result>` for the model's final answer
7. Loop repeats up to `maxIterations` if model needs more tools

### Message Types
| Type | Color | Description |
|------|-------|-------------|
| User | Blue | User input messages |
| Model | Gray | AI responses |
| Tool Call | Amber | Tool invocation details |
| Tool Result | Green | Tool execution results |

> **Note:** Gemma models don't support native function calling — this is solved via prompt engineering. See [gemma_client docs](gemma-client.md) for implementation details.

---

## GemmaClient Test Dashboard — `gemma_client/index.html`

A comprehensive test runner for the `gemma_client` library, supporting both offline unit tests and live API tests.

### Features
- **Unit tests (offline)**: 8 test groups covering encryption, KeyManager, GemmaAPI, parseToolCalls, ToolRegistry, tool execution, and module exports
- **Live API tests**: Real API calls to verify model capabilities — text generation, multilingual, code, math, structured output, temperature effects, and prompt-based function calling
- **Stats dashboard**: Total, passed, failed, skipped counts with duration tracking
- **Filter tabs**: View all, passed, failed, or skipped tests
- **Progress bar**: Visual progress indicator for live API test runs
- **Collapsible console log**: Debug output for test execution details

### How It Works
1. **Unit tests** run entirely in the browser using the built `gemma_client.js` bundle — no API keys needed
2. **Live API tests** load keys from `gemma_code.jsonl`, then execute a series of API calls testing different model capabilities
3. Results are displayed in collapsible test groups with pass/fail badges and response previews

---

## GemmaClient Debug Chat — `gemma_client/chat.html`

A developer-focused chat interface built on `gemma_client` with tools for inspecting API interactions and debugging function calling.

### Features
- **Tool Calling toggle**: Switch between plain chat and function-calling mode at runtime
- **Show Raw toggle**: Display raw model output alongside rendered markdown
- **Debug modal**: Inspect full conversation history, API request/response payloads, and token metadata
- **Console panel**: Collapsible in-page console showing API calls, key rotations, and tool execution
- **Multi-model support**: Switch between Gemma 3 27B/12B/4B/1B
- **Suggestion chips**: Pre-built prompts for testing tools (search, calculate, time, weather, etc.)

### How It Works
1. User types a message or clicks a suggestion chip
2. If Tool Calling is enabled, `ToolRunner` manages the agentic loop (tool calls → execution → results → model reply)
3. If Tool Calling is disabled, `GemmaAPI.chat()` handles plain conversation
4. Debug modal provides full visibility into the API request/response cycle

### Message Types
| Type | Color | Description |
|------|-------|-------------|
| User | Blue | User input messages |
| Model | Gray | AI responses (with markdown rendering) |
| Tool Call | Amber | Tool invocation with JSON arguments |
| Tool Result | Green | Tool execution results |
| Error | Red | API or tool errors |

> **Tip:** Use the Debug modal to inspect the exact `chatHistory` array being sent to the API — useful for debugging prompt-based function calling.
