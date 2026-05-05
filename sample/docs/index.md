# Gemma-JSONL Documentation

A lightweight, zero-dependency browser toolkit for the Google Gemini API with encrypted key rotation and rate-limit handling.

## Table of Contents

- [Getting Started](getting-started.md) — Setup, key encryption, and running the project
- [**Gemma 3 27B IT**](gemma-3-27b-it.md) — Model specs, benchmarks, capabilities, and limitations
- [API Reference](api-reference.md) — `gemma.js` functions, configuration, and usage
- [gemma_client](gemma-client.md) — Modular library with function calling support
- [Architecture](architecture.md) — Project structure, data flow, and design decisions
- [Applications](applications.md) — How each HTML app works
- [Security](security.md) — Threat model, known limitations, and recommendations
- [Configuration](configuration.md) — Tunable parameters and defaults
- [Testing](testing.md) — Unit and live test guide for gemma_client
- [**Free APIs for Agent Tools**](free-apis.md) — 8 verified free APIs for AI agent tools (weather, time, knowledge, currency, etc.)

## Overview

Gemma-JSONL provides four browser-based applications built on a shared core module (`gemma.js`), with default model **[Gemma 3 27B IT](gemma-3-27b-it.md)** — a 27B-parameter multimodal model with 128K context and 140+ language support:

| Application | File | Purpose |
|-------------|------|---------|
| Dashboard | `index.html` | Landing page with navigation |
| OCR | `ocr.html` | Image-to-text extraction via Gemma 3 vision |
| Chat | `chat.html` | Conversational interface with markdown and image support |
| Stress Test | `smoke.html` | API load testing with concurrency control |
| Tool Use | `tools_demo.html` | Function calling demo with agentic loop |
| GemmaClient Tests | `gemma_client/index.html` | Unit + live API test dashboard for `gemma_client` |
| GemmaClient Chat | `gemma_client/chat.html` | Debug chat with tool calling toggle, raw view, and debug modal |

## Default Model

**[Gemma 3 27B IT](gemma-3-27b-it.md)** (released 2025-03-12) — key highlights:
- 128K token context window (16x improvement over Gemma 2)
- Multimodal: text + image input via SigLIP vision encoder
- 140+ languages pre-trained, 35+ instruction-tuned
- Arena Elo 1,338 — outperforms DeepSeek-V3, Llama 3 405B, Qwen2.5-70B
- INT4 quantization fits on consumer GPUs (~14 GB VRAM)

## Key Features

- **XOR-obfuscated key storage** — API keys stored in `gemma_code.jsonl`, not plaintext in source
- **Automatic key rotation** — Proactive rotation every N calls + fallback rotation on errors
- **Rate-limit retry** — Exponential backoff with `Retry-After` header support (429/500)
- **Prompt-based function calling** — `gemma_client` library enables tool use for Gemma models
- **Zero dependencies** — Pure HTML/CSS/JS, no build tools or frameworks
