# Testing Guide

## Overview

The gemma_client test suite has two categories:

- **Unit tests** — Fast, no API calls. Tests pure logic: crypto, JSON parsing, tool registry, OODA-E helpers.
- **Live tests** — Slow (30-60s), real API calls via `gemma_code.jsonl`. Tests end-to-end OODA-E ability.

## Prerequisites

- Node.js 23+
- Valid API keys in `gemma_client/gemma_code.jsonl`

## Running Tests

```bash
cd gemma_client

# All tests (unit + live)
npm test
node test/run_all.js

# Unit tests only (fast, no API)
npm run test:unit
node test/run_all.js --unit

# Live tests only (slow, needs API keys)
npm run test:live
node test/run_all.js --live

# Single test file
node test/test_core.js
node test/test_tools.js
node test/test_oodae_unit.js
node test/test_oodae_live.js
```

## Test Architecture

```
gemma_client/test/
├── run_all.js          — Orchestrator: discovers and runs all tests
├── helpers.js          — Shared utilities (assertions, key loading, colors)
├── test_core.js        — Unit: encryptKey, decryptKey, KeyManager, sleep
├── test_tools.js       — Unit: parseToolCalls, ToolRegistry, JSON recovery
├── test_oodae_unit.js  — Unit: _parseJSON, _shortenQuery, _pickBestUrl, etc.
└── test_oodae_live.js  — Live: greeting, factual search, math, follow-up
```

### helpers.js

Shared utilities used by all test files:

| Export | Purpose |
|--------|---------|
| `assertEqual(actual, expected, label)` | Strict equality check |
| `assertTrue(value, label)` | Truthy check |
| `assertFalse(value, label)` | Falsy check |
| `assertContains(str, sub, label)` | String/array includes |
| `assertThrows(fn, label)` | Expects function to throw |
| `assertGreater(a, b, label)` | a > b check |
| `group(name)` | Print test group header |
| `summarize()` | Print pass/fail summary |
| `timer()` | Returns elapsed time function |
| `loadKeys(path, seed)` | Load and decrypt API keys from JSONL |
| `setupAPI()` | Create full API + Runner for live tests |
| `registerTestTools(registry)` | Register minimal tool set |

### Test File Pattern

Every test file follows this pattern:

```js
import { assertEqual, results, resetResults, summarize } from './helpers.js';

export async function run() {
    resetResults();
    // ... tests ...
    return { total: results.total, passed: results.passed, failed: results.failed };
}

// Allow standalone execution
if (import.meta.url === `file://${process.argv[1]}`) { run().then(summarize); }
```

## Unit Tests

### test_core.js (~25 tests)

Tests `src/core.js`:

- **encryptKey/decryptKey** — Roundtrip for ASCII, unicode, empty, long/short keys
- **KeyManager** — Construction defaults, key addition, rotation, `rotateEveryN`, wrap-around, `onRotate` callback
- **JSONL decryption** — Real `gemma_code.jsonl` decryption, validates Google API key format
- **sleep** — Timing accuracy

### test_tools.js (~35 tests)

Tests `src/tools.js`:

- **parseToolCalls** — Valid JSON, multiple calls, alias keys (args/parameters), surrounding text, malformed JSON recovery
- **hasToolCalls** — Tag detection, partial tags, no tags
- **stripToolCalls** — Single/multiple block removal
- **ToolRegistry** — CRUD operations, validation, execute with required/default params, error handling, clear

### test_oodae_unit.js (~65 tests)

Tests OODAERunner helper methods (no API calls):

- **PHASE constants** — Enum values
- **_parseJSON** — 6-layer JSON recovery including plan array repair
- **_extractBalancedBraces** — Nested objects, escaped quotes
- **_repairPlanArray** — Malformed Gemma output recovery
- **_recoverToolPlan** — Regex-based tool extraction, hallucinated tool filtering
- **_shortenQuery** — Filler word removal, word cap, fallback
- **_pickBestUrl** — Social media/PDF filtering, snippet quality
- **_buildFallbackPlan** — Deterministic plan from entities
- **_getLangInstruction** — All language variants
- **_getRecentContext** — History extraction, meta message filtering
- **_validateUrl** — Domain matching, known URL validation

## Live Tests

### test_oodae_live.js (4 tests)

Tests full OODA-E pipeline with real API:

| Test | Query | Validates |
|------|-------|-----------|
| Greeting | "hello" | No tools used, fast path, 0 iterations |
| Factual search | "what time is it in Singapore?" | Tools used, at least 1 OODA loop |
| Math | "what is 7 * 13 + 29?" | Correct answer (120) in response |
| Follow-up | "15+27" then "multiply that by 3" | Context retention across turns |

Each test has a 60-second timeout. Failures are reported with error details.

## Writing New Tests

### Adding a unit test

1. Add test cases in the appropriate `test_*.js` file
2. Use `group('Group Name')` to organize
3. Use assertion functions from `helpers.js`
4. Run standalone: `node test/test_file.js`

### Adding a live test

1. Add to `test_oodae_live.js`
2. Wrap in try/catch with `withTimeout()`
3. Use generic queries (avoid specific entity names)
4. Assert response properties, not exact content

## Troubleshooting

- **"No valid API keys found"** — Check `gemma_code.jsonl` exists and contains valid encrypted keys
- **Live tests timeout** — API may be rate-limited. Wait and retry, or run with `--unit` only
- **Module import errors** — Ensure `package.json` has `"type": "module"`
- **Permission errors** — Run from the `gemma_client/` directory
