# Gemma-JSONL

A lightweight, zero-dependency, browser-based toolkit for interacting with the Google Gemini API. Default model: **[Gemma 3 27B IT](docs/gemma-3-27b-it.md)** — a 27B-parameter multimodal vision-language model with 128K context and 140+ language support.

## Features

- **XOR-encrypted API key storage** — Keys are stored encrypted in a JSONL file, not in plain text
- **Automatic key rotation** — Proactive rotation every N uses, plus fallback rotation on errors
- **Rate-limit retry** — Exponential backoff with Retry-After header support (429/500)
- **Prompt-based function calling** — `gemma_client` library enables tool use for Gemma models
- **Zero dependencies** — Pure HTML/CSS/JS, no build tools required for main apps

## Applications

| App | File | Description |
|-----|------|-------------|
| **Dashboard** | `index.html` | Landing page with navigation to all tools |
| **OCR** | `ocr.html` | Extract text from images using Gemma 3 vision (SigLIP encoder) |
| **Chat** | `chat.html` | Full chat interface with markdown, conversation history, and image support |
| **Stress Test** | `smoke.html` | API load testing with configurable concurrency and real-time stats |
| **Tool Use** | `tools_demo.html` | Function calling demo with agentic loop via `gemma_client` |

## Default Model — Gemma 3 27B IT

| Spec | Value |
|------|-------|
| Parameters | ~27B |
| Architecture | Decoder-only Transformer, hybrid attention (5:1 local:global) |
| Context | 128K tokens |
| Vision | SigLIP encoder (image + text input) |
| Languages | 140+ pre-trained, 35+ instruction-tuned |
| Benchmarks | Arena Elo 1,338 · MATH 89.0% · HumanEval 87.8% |
| VRAM (INT4 QAT) | ~14 GB (fits on RTX 3090/4090) |
| License | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) (not Apache/MIT) |

> **Live API findings:** Gemma models have 3 disabled API features — `tools`, `systemInstruction`, and `responseMimeType: 'application/json'`. The `gemma_client` library provides workarounds for all three via prompt engineering.

See [full model reference](docs/gemma-3-27b-it.md) for architecture details, benchmarks, deployment, and live-verified limitations.

## Quick Start

### 1. Get API Keys

Obtain one or more Google Gemini API keys from [Google AI Studio](https://aistudio.google.com/apikey).

### 2. Encrypt Your Keys

Open any of the HTML files in a browser, then run this in the developer console:

```javascript
encryptKey("YOUR_API_KEY_HERE", XOR_SEED)
```

This returns the XOR-encrypted key string.

### 3. Add Keys to `gemma_code.jsonl`

Add one encrypted key per line in this format:

```jsonl
{"key":"115121072084099078114097..."}
{"key":"115121072084099078115105..."}
```

### 4. Run

Serve the project with any static file server:

```bash
# Python
python -m http.server 8000

# Node.js
npx http-server

# Then open http://localhost:8000
```

## Project Structure

```
├── index.html          # Dashboard — navigate to all tools
├── ocr.html            # OCR tool — image-to-text extraction
├── chat.html           # Chat interface — conversational AI
├── smoke.html          # Stress test — API load testing
├── tools_demo.html     # Tool use — function calling demo
├── gemma.js            # Legacy core module — key management, encryption, API calls
├── gemma_code.jsonl    # Encrypted API keys (one per line)
├── gemma_client/       # Modular library with function calling support
│   ├── src/            #   Source modules (core, client, tools)
│   ├── dist/           #   Built output (gemma_client.js)
│   └── package.json    #   npm run build → single file
├── docs/               # Documentation
└── test/               # Unit tests
```

## Configuration

Key settings in `gemma.js`:

| Variable | Default | Description |
|----------|---------|-------------|
| `XOR_SEED` | `"20250710"` | Seed used for key encryption/decryption |
| `ROTATE_EVERY_N` | `5` | Rotate to next key after N API calls |
| `RATE_LIMIT_MAX_RETRIES` | `5` | Max retry attempts on 429/500 errors |
| `RATE_LIMIT_BASE_DELAY` | `1000` | Base delay (ms) for exponential backoff |

## Documentation

- [Getting Started](docs/getting-started.md) — Setup, key encryption, and first run
- [Gemma 3 27B IT — Model Reference](docs/gemma-3-27b-it.md) — Specs, benchmarks, deployment, limitations
- [API Reference — gemma.js](docs/api-reference.md) — Legacy module functions and variables
- [gemma_client](docs/gemma-client.md) — Modular library with function calling
- [Applications](docs/applications.md) — How each HTML app works
- [Architecture](docs/architecture.md) — Project structure and design decisions
- [Security](docs/security.md) — Threat model and recommendations
- [Configuration](docs/configuration.md) — Tunable parameters and defaults

## License

MIT
