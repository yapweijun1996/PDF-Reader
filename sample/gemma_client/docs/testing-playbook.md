# Testing Playbook

Updated: 2026-03-22

This is the canonical test workflow for this repo. Use this instead of relying on scattered historical notes in old regression reports.

## Goals

- Catch source-level regressions before rebuilding `dist/`
- Keep `dist/gemma_client.js` in sync with `src/`
- Separate deterministic local verification from live API verification
- Make browser E2E checks reproducible, especially long multi-turn and Chrome MCP runs

## Test Levels

### 1. Build

Run this after any source change that affects browser behavior:

```bash
npm run build
```

Pass criteria:

- `dist/gemma_client.js` rebuilds successfully
- No stale bundle mismatch between `src/` and `dist/`

Notes:

- Do not trust browser results until `npm run build` has been run after source edits.
- Several past “browser bugs” were stale-bundle issues, not real source bugs.

### 2. Unit Tests

Run for fast local verification:

```bash
npm run test:unit
```

Use when:

- You changed parsing, routing, prompts, normalization, memory logic, or orchestration
- You want fast confidence before live/API tests

Pass criteria:

- All unit tests green
- New behavior has a targeted regression test when practical

### 3. Full Test Suite

Run before closing a substantial fix:

```bash
npm test
```

This currently includes:

- unit tests
- live tests

Pass criteria:

- Full suite green
- No new failures in `test_oodae_live.js` or related live suites

Notes:

- Live tests use real API keys and take materially longer than unit tests.
- Intermittent upstream slowness is possible; a logic regression should be distinguished from transient provider/API instability.

## Targeted Test Commands

Use these when the change is isolated:

```bash
npm run test:unit
npm run test:live
npm run test:e2e
npm run test:complex
npm run test:longconv
npm run test:stress
npm run test:ability
```

Recommended usage:

- `test:live`: validate live OODA-E + tools with real APIs
- `test:e2e`: regression scenarios
- `test:complex`: multi-step/business-style scenarios
- `test:longconv`: long follow-up context retention
- `test:stress`: boundary and failure-mode pressure test
- `test:ability`: capability-oriented checks

## Required Workflow After Source Changes

Use this order unless there is a strong reason not to:

```bash
1. npm run test:unit
2. npm run build
3. npm test
4. browser validation if the change affects real UI flows, queueing, persistence, or tool behavior
```

If the change is browser-only or integrated behavior only:

```bash
1. npm run build
2. npm test
3. Chrome MCP/browser validation
```

## Chrome MCP Test Procedure

Use Chrome DevTools MCP when the user asks for “real-life” verification, long conversations, queue behavior, page behavior, or wants console/network evidence.

### Preconditions

- Run `npm run build` first
- Start the local app and open `http://localhost:3000/chat.html`
- Use a clean conversation before each new run
- Confirm `Tools` mode or `Simple` mode explicitly before testing

### Clean-Session Rules

Before every browser run:

- reload page
- clear conversation with page logic, not only DOM inspection
- verify `0 user / 0 model`
- confirm intended mode is active

Why:

- the app restores prior sessions automatically
- stale history can invalidate long-run conclusions

### What To Capture

For every serious browser test, capture:

- page behavior
- user turn count
- model turn count
- error row count
- tool call count and tool names
- console errors
- network errors
- notable UI state such as `Ready`, queue depth, compaction messages, token display

### What Counts As A Valid Browser Run

A browser run is only valid if:

- the conversation started from a clean session
- the tested build matches current `src/`
- the prompts actually went through the page’s real send/queue path
- results were read from rendered page state, not assumed from logs alone

### Expected Noise

These are not automatically regressions:

- `403` on some Gemini keys if the client rotates to a working key and the run continues
- long latency on multi-loop tool runs
- ambiguous third-party geocoding/search results when tool arguments are correct

These are regressions unless explained:

- front-end exception or broken queue
- missing model rows
- wrong mode used for the test
- stale bundle behavior after source change
- tool args malformed in Activity/Debug when source should have normalized them
- language drift or unwanted translation output after fixes explicitly targeting that

## Chrome MCP Long-Run Scenarios

### A. Tool Mode Pressure Test

Use when validating:

- tool argument generation
- multi-turn queue stability
- language/output constraints
- real third-party API integration

Recommended checks:

- 20-turn run for regression confirmation
- 50-turn run for pressure testing

Prompt mix should include:

- time
- weather
- exchange rate
- geocode
- follow-up or planning turns when relevant

### B. Marketing Deep Research Run

Use when validating:

- research/planning quality
- search and synthesis behavior
- long multi-turn reasoning under real UI conditions

Recommended size:

- 20 turns

Run rules:

- keep prompts concise enough to avoid wasting tokens
- prefer one company/topic per run
- keep answers compact so the test stresses reasoning more than token bloat

Capture:

- a few representative user/model turn pairs
- whether tools were actually used
- whether the conversation stayed on-topic across turns
- whether context compaction occurred

## Interpretation Rules

When a test fails, classify it first:

- source regression
- stale build
- prompt/routing regression
- third-party data ambiguity
- provider/API instability
- test-harness issue

Do not file a source bug until stale bundle and dirty session are ruled out.

## Minimum Sign-Off Matrix

### Small source fix

- `npm run test:unit`
- `npm run build`

### Medium logic fix

- `npm run test:unit`
- `npm run build`
- `npm test`

### Tool/routing/browser fix

- `npm run test:unit`
- `npm run build`
- `npm test`
- one clean Chrome MCP browser validation

### Long-conversation or workflow fix

- `npm run test:unit`
- `npm run build`
- `npm test`
- one clean Chrome MCP long-run validation

## Reporting Template

When reporting results, include:

- build status
- local test status
- browser status
- exact scope tested
- whether the session was clean
- whether `dist/` was rebuilt first
- open risks or known ambiguous cases

Example:

```text
Build: passed
Local tests: npm test passed (1159/1159)
Browser: Chrome MCP 20-turn tool-mode run passed from clean session
Observed noise: intermittent 403 on one API key, auto-rotated successfully
Residual risk: geocode ambiguity depends on upstream Nominatim ranking
```
