# Gemma-JSONL Documentation

A lightweight, zero-dependency, browser-based toolkit for interacting with the Google Gemini API. Default model: **[Gemma 3 27B IT](gemma-3-27b-it.md)** — a 27B-parameter multimodal vision-language model (SigLIP encoder) with 128K context, 140+ language pre-training / 35+ instruction-tuned, and state-of-the-art performance at its scale (Arena Elo 1,338). Features XOR-encrypted API key storage, automatic key rotation, rate-limit handling with exponential backoff, and five ready-to-use applications.

## Table of Contents

- [Architecture Overview](architecture.md)
- [Getting Started](getting-started.md)
- [**Gemma 3 27B IT — Model Reference**](gemma-3-27b-it.md)
- [API Reference — gemma.js (legacy)](api-reference.md)
- [**gemma_client — New Library with Function Calling**](gemma-client.md)
- [Application Guide](applications.md)
- [Security Considerations](security.md)
- [Configuration](configuration.md)
- [**Free APIs for Agent Tools**](free-apis.md)

## Project Structure

```
Gemma-JSONL/
├── index.html              # Dashboard — landing page with navigation
├── ocr.html                # OCR tool — image-to-text extraction via Gemma 3 vision (SigLIP)
├── chat.html               # Chat interface — full conversational AI with markdown
├── smoke.html              # Stress test — API load testing with concurrency control
├── tools_demo.html         # Tool use — function calling demo with agentic loop
├── gemma.js                # Legacy core module (still works, not required by gemma_client)
├── gemma_code.jsonl        # Encrypted API keys (one per line, XOR-encoded)
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

## Gemma API Limitations & Our Solutions (Live-Verified)

Live API testing (`test/live_gemma_study.mjs`) confirmed **three API features disabled** for Gemma models:

| Disabled Feature | Error Message | Our Workaround |
|-----------------|---------------|----------------|
| `tools` / `functionDeclarations` | `"Function calling is not enabled"` | `gemma_client` prompt-based function calling ✅ |
| `systemInstruction` | `"Developer instruction is not enabled"` | Inject system prompt in first user message ✅ |
| `responseMimeType: 'application/json'` | `"JSON mode is not enabled"` | Request JSON in prompt text ✅ |

The `gemma_client` library solves function calling via **prompt-based approach** — it injects tool definitions into the system prompt, parses `<tool_call>` tags from model output, executes handlers, and feeds results back. See [gemma_client docs](gemma-client.md) for details.

## Quick Links

| Topic | Description |
|-------|-------------|
| [Getting Started](getting-started.md) | Setup, key encryption, and first run |
| [**Gemma 3 27B IT**](gemma-3-27b-it.md) | **Model specs, benchmarks, capabilities, deployment & limitations** |
| [API Reference — gemma.js](api-reference.md) | Legacy module functions and variables |
| [**gemma_client**](gemma-client.md) | **New library with function calling, build system, modular design** |
| [Applications](applications.md) | How each HTML app works |
| [Security](security.md) | Known limitations and recommendations |
| [Configuration](configuration.md) | Tunable parameters and defaults |
| [**Free APIs**](free-apis.md) | **25 verified free APIs for agent tools (search, weather, time, math, news, crypto, research, etc.)** |
