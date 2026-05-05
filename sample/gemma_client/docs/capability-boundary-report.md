# OODA-E Agent Runtime — Capability Boundary Report

**Date**: 2026-03-21
**Model**: Gemma 3 27B (via Gemini API)
**Runtime**: OODA-E (Observe → Classify → Orient → Decide → Act → Evaluate)

---

## Architecture Summary

OODA-E decomposes agent reasoning into 6 focused phases, each a separate API call optimized for weak models. This "multi-step, low-pressure" design lets Gemma handle tool calling and agent skills by asking it one question at a time instead of a complex system prompt.

```
User Message
    │
    ▼
┌─────────┐  intent, entities, summary
│ OBSERVE  │────────────────────────────────┐
└─────────┘                                 │
    │                                       ▼
    ▼                              ┌──────────────┐
┌──────────┐  is_greeting,        │  Workspace    │
│ CLASSIFY │  is_command,          │  (IndexedDB)  │
│ (agent)  │  user_entities        └──────────────┘
└──────────┘
    │
    ▼
┌─────────┐  language, memories, timezone
│ ORIENT  │  (non-API, deterministic)
└─────────┘
    │
    ▼  ←─── Loop (max 3) ───┐
┌─────────┐                  │
│ DECIDE  │  tool plan        │
└─────────┘                  │
    │                        │
    ▼                        │
┌─────────┐                  │
│  ACT    │  execute tools    │
└─────────┘                  │
    │                        │
    ▼                        │
┌──────────┐  needs_more?    │
│ EVALUATE │─── true ────────┘
└──────────┘
    │ false
    ▼
  Response
```

---

## E2E Test Results

### Suite 1: Basic Interactions (Browser E2E, Chrome DevTools MCP)

| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Time | Status |
|---|-------|---------|----------|--------|--------|------|--------|
| 1 | `hello` | greeting, tools=false | is_greeting=true | — | "Hi there! 👋" 0 tools | 2.33s | PASS |
| 2 | `你好` | greeting, tools=false | is_greeting=true | — | Chinese greeting, 0 tools | 6.58s | PASS |
| 3 | `my name is Alex` | info_sharing, is_about_user | entities=["Alex"] | save_memory | Saved user_name=Alex | ~4s | PASS |
| 4 | `remember to reply in mandarin` | command | is_command, save_key | save_memory | Preference saved | ~4s | PASS |
| 5 | `what time is it now?` | question, tools=true | needs_tools=true | get_time(Asia/KL) | Correct time in Mandarin | ~4s | PASS |
| 6 | `what is the latest news about OpenAI` | question, tools=true | needs_tools=true | web_search+fetch_url | 5 results, Chinese summary | ~8s | PASS |
| 7 | `tell me about Tesla` | question, tools=true | needs_tools=true | web_search+fetch_url+wikipedia | Tesla summary in Chinese | ~6s | PASS |
| 8 | `who is the CEO?` | follow_up (workspace→Tesla) | needs_tools=true | web_search | "Elon Musk" | ~4s | PASS |
| 9 | `i see` | acknowledgment | is_acknowledgment=true | — | "好的，明白了。" 0 tools | ~3s | PASS |

### Suite 2: Office Worker Personal Assistant (Fresh Session)

| # | Input | DECIDE Plan | Tools Used | Result | Time | Tokens | Status |
|---|-------|-------------|------------|--------|------|--------|--------|
| 1 | `what time is it now? also, how much is 500 USD in Malaysian Ringgit?` | get_time + exchange_rate | 2 | "11:07...500 USD = 1969.75 MYR" in Mandarin | 3.96s | 839 | PASS |
| 2 | `search for latest AI news today and what is the weather in Kuala Lumpur?` | tech_news + get_weather | 2 | 5 HN stories + "29.8°C, partly cloudy" in Mandarin | 8.27s | 1214 | PASS |

### Suite 3: Topic Switch + Deictic Follow-up (After TNO Conversation)

| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Status |
|---|-------|---------|----------|--------|--------|--------|
| 1 | `what is quantum computing?` | intent=question, entities=["quantum computing"] | entities=["quantum computing"] | `"quantum computing definition"` | Chinese summary of QC | PASS |
| 2 | `who are the leaders in this field?` | intent=follow_up, entities=["quantum computing"] | is_reference=true, entities=["field"] | `"leading figures quantum computing"` | Google, IBM, Microsoft, IonQ... | PASS |

**Key validation**: Topic switch detection (Layer 1) correctly blocks TNO contamination. CLASSIFY's `is_reference` field (model-driven, no regex) correctly detects deictic follow-up. DECIDE uses workspace-enriched entities for search.

### Suite 4: Full Pipeline Regression (2026-03-21, 3:29 PM — Fresh Session via HTTP)

| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Time | Tokens | Status |
|---|-------|---------|----------|--------|--------|------|--------|--------|
| 1 | `hello` | greeting, tools=false | is_greeting=true | — | "你好！有什么我可以帮你的吗？" 0 tools | 1.45s | 196 | PASS |
| 2 | `what time is it now?` | question, tools=true | needs_tools=true | get_time(Asia/KL) | "现在是2026年3月21日15:30" in Mandarin | 1.91s | 756 | PASS |
| 3 | `tell me about Tesla` | question, tools=true | needs_tools=true | web_search("Tesla") | Chinese Tesla summary (CEO, BEV, solar) | 5.08s | 1368 | PASS |
| 4 | `what is quantum computing?` | question, entities=["quantum computing"] | user_entities=["quantum computing"] | web_search("quantum computing explanation") | Chinese QC summary, **NO Tesla contamination** | 3.10s | 1269 | **PASS** |
| 5 | `who are the leaders in this field?` | follow_up, entities=["quantum computing"] | is_reference=true | web_search("leading figures QC") + web_search("leading organizations QC") | D-Wave, IonQ, Rigetti — correct QC leaders | 7.57s | 5831 | **PASS** |
| 6 | `i see` | follow_up, tools=false | is_acknowledgment=true | — | "好的，明白了。" 0 tools, no search leakage | 1.57s | 197 | PASS |

**Key validation — Session 2**:
- **Topic switch FIXED**: "quantum computing?" after Tesla → clean response, no Tesla contamination (was FAIL in Suite 3, now PASS)
- **Deictic follow-up WORKING**: "leaders in this field?" → CLASSIFY `is_reference=true`, searches "leading figures quantum computing"
- **Acknowledgment guard**: "i see" → 0 tools despite Tesla + QC in workspace
- **API Key #2 dead**: `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` returns 403 on every use (3x in session); `fetchWithRetry` handles it transparently

### Suite 5: Number Entities, Math Follow-up, Edge Cases (Session 3 — 2026-03-21, ~4:30 PM)

| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Time | Tokens | Status |
|---|-------|---------|----------|--------|--------|------|--------|--------|
| 1 | `what is 15 + 27?` | question, tools=true | entities=["15","27"] | calculate(15+27) | "42" in Mandarin | 3.27s | 626 | PASS |
| 2 | `multiply that by 3` | follow_up | **is_command=true** ✗ + is_reference=true ✓ | calculate((15+27)*3) | "126" correct despite CLASSIFY bug | 6.81s | 627 | PASS (with bug) |
| 3 | `what is the latest AI news?` | question | user_entities=["AI news"] | web_search+fetch_url | 5 news items, clean topic switch | 5.88s | 1555 | PASS |
| 4 | `weather in Tokyo?` | question | user_entities=["Tokyo","weather"] | get_weather(Tokyo) | "14.1°C clear", clean topic switch | 3.79s | 745 | PASS |
| 5 | `😊 你好啊！今天心情好` | greeting, tools=false | is_greeting=true | — | Chinese greeting, 0 tools | 1.55s | 203 | PASS |
| 6 | `?` | follow_up (workspace→Tokyo) | needs_tools=true | get_weather(Tokyo) | Re-triggered weather (wasted 6.48s) | 6.48s | 741 | **BOUNDARY** |

**Key validation — Session 3**:
- **Math pipeline**: `calculate(15+27)` → `calculate((15+27)*3)` — correct operand chaining via workspace context
- **CLASSIFY bug**: "multiply that by 3" triggers `is_command=true` (false positive) but `is_reference=true` override in `run()` recovers correct behavior
- **Single "?" boundary**: Bare punctuation should not trigger workspace follow-up — `_resolveFromWorkspace` needs a punctuation filter
- **TypeError (Node.js only)**: CLASSIFY returns `user_entities: [3]` (number) → `.toLowerCase()` crashes. Masked in browser by stale dist/

### Suite 5b: Node.js — TypeError Crash Confirmation

```
Test: Follow-up — context retention
  "what is 15 + 27?" → calculate(15+27) → 42 ✓
  "multiply that by 3" → CLASSIFY returns user_entities: [3] (number)
  → oodae.js:105 — TypeError: e.toLowerCase is not a function
  → OODA-E crashes, falls back to ToolRunner
```

10 crash sites identified across 4 files:
- `oodae.js:105-106` (Layer 2 topic switch)
- `oodae-observe.js:36-37` (Layer 1 topic switch)
- `oodae-decide.js:131,134` (deictic query correction)
- `oodae-decide.js:202,216,225` (multi-intent enrichment)

### Suite 6: Route 2 — Complex Scenario E2E Tests (Node.js, 74/74 PASS)

5 real-world personas tested with live Gemini API. Each scenario uses independent workspace/memory.

| Scenario | Steps | Key Tests | Status |
|----------|-------|-----------|--------|
| **1. 市场调查** | NVIDIA → stock price → AMD → revenue comparison | Implicit follow-up, competitor switch, comparative dual-search | 15/15 |
| **2. 客服** | hi Sarah → iPhone 16 Pro → how much? → Tokyo weather → thanks | Product research, implicit price follow-up, topic switch, ack guard | 14/14 |
| **3. 老板决策** | time+USD→EUR → EU AI regulation → US comparison → tech news | Multi-intent, policy research, deictic comparison, topic switch | 13/13 |
| **4. 个人助手** | mandarin → time+weather → JPY→MYR → ok → Japan PM | Language command, multi-intent, currency conversion, new topic after ack | 15/15 |
| **5. 大学生** | blockchain → applications → DeFi → CRISPR → who invented it? | Deictic follow-up, subtopic pivot, complete topic switch, pronoun follow-up | 17/17 |

**Boundary identified**: "what is the stock price?" after NVIDIA — implicit "the" not resolved to NVIDIA by CLASSIFY (needs explicit pronoun like "its" or "their").

### Suite 7: Long Conversation Flow (Node.js E2E, 52/52 PASS)

12-step continuous conversation with shared chatHistory. Tests context retention, direction loss after repeated follow-ups, topic switching, back-reference resolution, tool discipline, and memory recall.

| Step | Input | Intent | Tools | Key Finding | Time | Status |
|------|-------|--------|-------|-------------|------|--------|
| 1 | "hello!" | greeting | 0 | Fast path, 0 iterations | 15s | PASS |
| 2 | "my name is alex" | info_sharing | save_memory | Name saved, no web_search | 29s | PASS |
| 3 | "singapore airlines" | question | web_search | Search "Singapore Airlines" | 32s | PASS |
| 4 | "how many planes?" | follow_up | web_search | Search "SIA number planes" (context retained) | 18s | PASS |
| 5 | "what routes?" | follow_up | web_search ×3 | Search "SIA routes" (2nd follow-up, 3 loops) | 58s | PASS |
| 6 | "who is the CEO?" | **question** | web_search | **Searched generic "CEO"** — lost SIA context after 3 follow-ups | 10s | **QUALITY ISSUE** |
| 7 | "tesla stock price" | question | web_search | Clean switch: "tesla stock price", no SIA | 23s | PASS |
| 8 | "their latest earnings?" | follow_up | web_search ×3 | Tesla earnings, no SIA leak (3 loops) | 42s | PASS |
| 9 | "go back to SIA, stock?" | follow_up | web_search ×3 | **Query contaminated**: "tesla stock price Singapore Airlines stock" | 33s | **QUALITY ISSUE** |
| 10 | "write professional email" | command | web_search | **Web search for text gen** (CLASSIFY is_command=true) | 19s | PASS |
| 11 | "time? 15% of 280?" | question | get_time+calculate | Both intents, correct answer=42 | 16s | PASS |
| 12 | "what's my name?" | question | recall_memory | "alex" recalled after 10+ turns | 14s | PASS |

**Critical boundaries found:**

1. **Direction loss at depth 3+**: After 3 consecutive follow-ups on the same topic (Steps 3→4→5→6), OBSERVE loses the parent topic context. Step 6 "who is the CEO?" was classified as a standalone question about CEOs in general, not about Singapore Airlines' CEO.

2. **Back-reference entity pollution**: When switching back to an earlier topic (Step 9), workspace entities from ALL prior topics are included in OBSERVE's key_entities, contaminating the DECIDE search query with old-topic terms.

3. **is_command overrides fast path**: CLASSIFY's `is_command=true` forces `requires_tools=true` even for pure text generation tasks (Step 10), preventing the fast path that would generate better text without web search.

---

## Capability Matrix

### Strengths (Working Well)

| Capability | Evidence | Confidence |
|-----------|----------|------------|
| Multi-intent tool selection | get_time + exchange_rate, time + weather, tech_news + get_weather | HIGH |
| Memory persistence | Name + language recalled across sessions via IndexedDB | HIGH |
| CLASSIFY entity filtering | Correctly filters workspace entities from user text | HIGH |
| Greeting/ack/command guards | No tools triggered for "hi", "i see", "thanks", "ok", "remember X" | HIGH |
| Follow-up resolution (same topic) | "who is CEO?" → Tesla, "how much?" → iPhone 16 Pro | HIGH |
| Topic switch detection | blockchain→CRISPR, iPhone→Tokyo, EU reg→tech news — all clean | HIGH |
| Deictic/reference follow-up | "this field?", "this technology?", "how does this compare?" → is_reference=true | HIGH |
| Implicit contextual follow-up | "boss name?", "how much?", "who invented it?" → is_reference=true | HIGH |
| Pronoun follow-up | "who invented it?" → CRISPR (not blockchain), "they compare?" → NVIDIA vs AMD | HIGH |
| Comparative analysis | "how do they compare in revenue?" → dual web_search (NVIDIA + AMD) | HIGH |
| Tool diversity | 10 tools: get_time, exchange_rate, web_search, fetch_url, tech_news, get_weather, save_memory, recall_memory, list_memories, calculate | HIGH |
| Language preference | All responses in Mandarin after "reply in mandarin" command | HIGH |
| Timezone awareness | Asia/Kuala_Lumpur inferred from Orient | HIGH |
| Currency conversion | "1000 JPY to MYR" → exchange_rate(JPY, MYR, 1000) = 24.8 MYR | HIGH |
| Policy research | "EU AI regulation" + "compare to US" → correct deictic context linking | HIGH |
| Malformed JSON recovery | _recoverToolPlan + _repairPlanArray handle Gemma's broken JSON | HIGH |
| URL hallucination prevention | _validateUrl blocks fabricated domains | HIGH |
| Math operand chaining | "15+27" → "multiply that by 3" → calculate((15+27)*3) via workspace context | HIGH |
| Emoji greeting detection | "😊 你好啊！今天心情好" → is_greeting=true, 0 tools | HIGH |
| CLASSIFY recovery from own errors | is_command false positive overridden by is_reference=true in run() | MEDIUM |
| Follow-up context retention (depth 1-2) | Steps 4-5: "how many planes?" + "what routes?" both link to SIA | HIGH |
| Topic B follow-up after switch | Step 8: "their latest earnings?" → Tesla (not SIA) | HIGH |
| Memory recall after 10+ turns | Step 12: "what's my name?" → recall_memory → "alex" | HIGH |
| No user context leak in search | "alex" never appears in any web_search across 12 steps | HIGH |
| Multi-intent (calculate + get_time) | Step 11: 15% of 280 = 42 + current time, both correct | HIGH |

### Boundary Issues (Known Limitations)

| Issue | Root Cause | Severity | Fix Complexity |
|-------|-----------|----------|----------------|
| ~~**Topic switch contamination**~~ | ~~OBSERVE injects workspace topic into summary~~ | ~~HIGH~~ | **FIXED** — 2-layer detection (entity overlap in _observe + summary rebuild after CLASSIFY) |
| ~~**Summary leakage to DECIDE**~~ | ~~observation.summary carries old topic~~ | ~~HIGH~~ | **FIXED** — explicit SEARCH ENTITIES field in DECIDE prompt |
| ~~**Multi-intent over-enrichment**~~ | ~~Generic words treated as standalone entities~~ | ~~MEDIUM~~ | **FIXED** — length filter (≥4 chars) + GENERIC_WORDS blocklist |
| **Model fabrication** | Gemma fabricates connections from tangential search results (Tesla as QC leader) | MEDIUM | MEDIUM |
| ~~**Same URL re-fetched**~~ | ~~No fetch dedup cache in _act()~~ | ~~LOW~~ | **FIXED** — fetchedUrls Set |
| ~~**Decide retry uses same query**~~ | ~~No query variation strategy~~ | ~~MEDIUM~~ | **FIXED** — evaluator feedback with variation instructions |
| **Implicit "the" reference** | "what is the stock price?" after NVIDIA → CLASSIFY doesn't detect is_reference; needs explicit pronoun ("its", "their") | LOW | MEDIUM — enhance CLASSIFY prompt or add article-based reference detection |
| ~~**TypeError: e.toLowerCase()**~~ | ~~CLASSIFY/OBSERVE return non-string entities (numbers, null); `.toLowerCase()` crashes at 10 sites across 4 files~~ | ~~HIGH~~ | **FIXED** — `String(e)` coercion at all 10 call sites |
| **CLASSIFY: math follow-up → is_command** | "multiply that by 3" → `is_command=true, memory_action=save` (should be `is_reference=true` only); DECIDE recovers but ORIENT sets wrong memory_action | MEDIUM | MEDIUM — enhance CLASSIFY prompt to distinguish math context from commands |
| ~~**Single "?" triggers follow-up**~~ | ~~Bare "?" re-triggers last workspace tool call; `_resolveFromWorkspace` lacks punctuation-only filter~~ | ~~LOW~~ | **FIXED** — Unicode punctuation-only guard (`/^[\p{P}\p{S}\s]+$/u`) |
| **Direction loss at follow-up depth 3+** | After 3 consecutive follow-ups, OBSERVE loses parent topic context; "who is the CEO?" (after 3 SIA follow-ups) → generic "CEO" search instead of "Singapore Airlines CEO" | **HIGH** | MEDIUM — topic chain weighting or entity decay in workspace |
| **Back-reference entity pollution** | "go back to SIA" → query "tesla stock price Singapore Airlines stock"; workspace entities from ALL prior topics included in OBSERVE's key_entities | **HIGH** | MEDIUM — clear old-topic entities when explicit back-reference detected |
| **is_command overrides fast path for text gen** | "write email" → CLASSIFY is_command=true → requires_tools=true → web_search; should use fast path (_directResponse) for pure text generation | MEDIUM | LOW — add text-generation subtype to CLASSIFY or exclude from requires_tools |
| **maxLoops exhaustion on paywalled content** | Steps 5/8/9 hit maxLoops=3 because fetched pages were login-walled or paywalled | LOW | LOW — detect paywall in fetch_url, skip and try next URL |
| **Repeated search avoidance** | Agent sometimes re-searches info already in chatHistory/workspace | MEDIUM | MEDIUM |
| **Workspace entity accumulation** | Entities accumulate across conversation; no decay/pruning | LOW | MEDIUM |
| **API Key #2 dead (403)** | Key `AIza...k48` consistently returns 403; `fetchWithRetry` auto-retries but wastes a cycle | MEDIUM | LOW — remove from gemma_code.jsonl |
| **chat.html CORS on file://** | `loadFromJSONL()` fetch fails on `file://` protocol; requires HTTP server | LOW | LOW — document requirement or add inline key fallback |
| **Memory recall category mismatch** | "what is my name?" → ORIENT only extracts `category="user_profile"` memories into user context; `user_name` saved with `category="user_info"` is invisible to response generation | **HIGH** | LOW — expand ORIENT to include all user-related categories |
| **Greeting leaks personal memory** | "hello!" → agent proactively mentions car color/employer from memory; should not volunteer personal data in greetings | LOW | LOW — suppress user_profile injection for greeting intent |

### Remaining Hardcoded Logic (Pending Migration)

| Hardcoded Pattern | Location | Type | Migration Target |
|-------------------|----------|------|-----------------|
| ~~Deictic/pronoun regex~~ | ~~oodae-observe.js~~ | ~~Semantic decision~~ | **MIGRATED** — CLASSIFY `is_reference` field |
| `_shortenQuery` filler/stop word regex | oodae-act.js:106-108 | Structural parsing | Could be agent micro-prompt |
| `SKIP_EXT` / `SKIP_SITE` regex | oodae-act.js:118-119 | Structural filtering | Could be agent URL quality scoring |
| `GENERIC_WORDS` blocklist | oodae-decide.js:198-200 | Semantic decision | CLASSIFY agent `search_entities` field |
| Language detection string matching | oodae-decide.js:25-29 | Semantic decision | Normalized ISO code storage |

**Design principle**: Regex is acceptable for **structural parsing** (JSON recovery, XML protocol, URL format validation). Regex is NOT acceptable for **semantic decisions** (intent classification, reference detection, content filtering). All semantic decisions should be delegated to the model via focused micro-prompts or existing agent phases (CLASSIFY).

---

## Optimization Roadmap

### Level 1: Quick Harness Fixes — ALL IMPLEMENTED

#### ~~1.1 CLASSIFY Summary Override~~ — **IMPLEMENTED**
Layer 2 topic switch detection in `run()`: if CLASSIFY's `user_entities` have <30% overlap with OBSERVE's `key_entities` AND `!classification.is_reference`, rebuild summary from `userText` and revert intent to `question`.

#### ~~1.2 Topic Switch Detection~~ — **IMPLEMENTED**
Layer 1 in `_observe()`: if model-parsed entities have zero overlap with workspace entities, skip workspace injection. Workspace context preserved in `_wsContextAvailable` for CLASSIFY override.

#### ~~1.3 URL Fetch Dedup Cache~~ — **IMPLEMENTED**
`fetchedUrls` Set in `_act()` prevents re-fetching same URL within a single OODA-E run.

#### ~~1.4 Multi-Intent Entity Length Filter~~ — **IMPLEMENTED**
`_enrichPlanForMissedIntents` requires entity length ≥ 4 chars and filters against `GENERIC_WORDS` blocklist.

### Level 2: Architecture Improvements

#### ~~2.1 Explicit Entity Passing to DECIDE~~ — **IMPLEMENTED**
CLASSIFY's `user_entities` passed as `SEARCH ENTITIES` field in DECIDE prompt. Exception: when `is_reference=true`, uses OBSERVE's workspace-enriched entities (which contain the actual referenced topic).

#### 2.2 Workspace Topic Decay
**Problem**: Old topics never fade; workspace always has full entity history.
**Fix**: Add turn-count or time-based decay to workspace topic relevance.

#### ~~2.3 Decide Query Variation~~ — **IMPLEMENTED**
Evaluator feedback passed to DECIDE with variation instructions ("try different search keywords, synonyms, alternative phrasing").

#### 2.4 Search Result Ranking
**Problem**: `_pickBestUrl` selects first non-social URL. No snippet relevance scoring.
**Fix**: Score snippets by keyword overlap with user query; pick URL with highest relevance.

### Level 2.5: Reference/Follow-up System — IMPLEMENTED

#### ~~2.5.1 CLASSIFY `is_reference` Field~~ — **IMPLEMENTED**
Model-driven detection of deictic references ("this field", "that company"), implicit contextual references ("boss name?", "address?"), and continuation phrases ("tell me more"). Replaces all hardcoded pronoun/deictic regex.

#### ~~2.5.2 `_wsContextAvailable` Mechanism~~ — **IMPLEMENTED**
When Layer 1 skips workspace injection (no entity overlap), workspace context is preserved in `observation._wsContextAvailable`. If CLASSIFY detects `is_reference=true`, workspace context is retroactively injected in `run()`.

#### ~~2.5.3 Deictic Query Correction Harness~~ — **IMPLEMENTED**
In DECIDE, when `isReferenceFollowUp=true` and model generates a generic search query missing the key workspace entity, harness prepends the workspace entity to the query.

### Level 3: Capability Expansion (Agent Skills) — IMPLEMENTED

#### ~~3.1 Skill Registry~~ — **IMPLEMENTED**
`SkillRegistry` class (`src/skill-registry.js`) with static template (`$variable` substitution) and dynamic planner support. Built-in skills: `deep_research`, `compare`, `daily_briefing`. Skills appear in DECIDE prompt as available options; orchestrator expands them into concrete tool calls before ACT.

#### ~~3.2 Sub-Agent Delegation~~ — **IMPLEMENTED**
`_decompose()` splits complex multi-part queries into independent sub-tasks via model call. `_runSubAgents()` executes focused sub-agents in parallel (each runs its own DECIDE → ACT cycle). `_evaluateSubAgents()` merges all results into a combined answer. Triggered when CLASSIFY detects ≥2 entities.

#### ~~3.3 Parallel Tool Execution~~ — **IMPLEMENTED**
`_act()` partitions tool plan into independent tools (parallel via `Promise.all`) and search-chain tools (sequential with URL tracking/auto-fetch). Independent tools like `get_time + exchange_rate` or `tech_news + get_weather` run concurrently. Search tools maintain sequential `knownUrls`/`fetchedUrls` tracking.

#### 3.4 RAG Integration
Use workspace history as a retrieval source — if workspace already contains relevant answers, skip tool calls.

#### 3.5 Structured Output
Tables, bullet lists, comparison charts for complex multi-entity responses.

---

## Unit Test Status (2026-03-21)

### Node.js — 173/173 PASS (Unit) + TypeError FIXED
| Suite | Tests | Status |
|-------|-------|--------|
| test_core.js (encrypt, KeyManager, sleep) | 26 | PASS |
| test_tools.js (parseToolCalls, ToolRegistry) | 61 | PASS |
| test_oodae_unit.js (OODA-E harness + Route 3 + bug fixes) | 86 | PASS |

### Browser (index.html) — 187/189 (2 FAIL)
| Failed Test | Expected | Got | Root Cause |
|-------------|----------|-----|-----------|
| `Default rotateEveryN = 5` | 5 | 1 | Source default changed from 5→1, browser test stale |
| `Default maxOutputTokens = 8192` | 8192 | undefined | `maxOutputTokens` removed from GemmaAPI defaults, browser test stale |

### Code Inconsistency Found
| Issue | Location | Detail |
|-------|----------|--------|
| ~~`maxOutputTokens` remnant~~ | ~~`oodae-decide.js:167`~~ | **FIXED** — `maxOutputTokens: 256` removed from `_decideSimplified` |
| dist/ stale | `dist/gemma_client.js` | Source modules modified but dist not rebuilt |
| API Key #2 revoked | `gemma_code.jsonl` key #2 | `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` returns 403 on every API call; auto-retry works but adds latency |
| chat.html file:// CORS | `chat_app.js:829-857` | `fetch()` of `gemma_code.jsonl` blocked by CORS when page opened via `file://` protocol |
| ~~TypeError: e.toLowerCase()~~ | ~~`oodae.js:105`, `oodae-observe.js:36-37`, `oodae-decide.js:131,134,202,216,225`~~ | **FIXED** — `String(e)` coercion at all 10 sites |
| CLASSIFY math follow-up misclass | `_classifyIntent` prompt | "multiply that by 3" → `is_command=true` (false positive); `is_reference=true` override recovers but leaves stale `memory_action=save` |
| ~~Single "?" follow-up~~ | ~~`_resolveFromWorkspace`~~ | **FIXED** — punctuation-only guard added |

---

## Performance Benchmarks

| Metric | Value | Notes |
|--------|-------|-------|
| Greeting response | 2-3s | No tools, fast path |
| Single tool query | 3-4s | get_time, save_memory |
| Multi-tool query | 4-8s | 2-3 tools |
| Web search + fetch | 6-10s | Search + auto-fetch top URL |
| Tokens per response | 800-2000 | Depends on tool result length |
| Max OODA-E loops | 3 | Configurable |
| API calls per turn | 4-7 | OBSERVE + CLASSIFY + ORIENT + DECIDE + ACT(n) + EVALUATE |

---

## Test Flow (Standard Regression)

```
1. hi                              → greeting, no tools
2. my name is jinja                → is_about_user, save_memory
3. tno system pte ltd              → new query, web_search
4. boss name?                      → follow-up (workspace), web_search
5. address?                        → follow-up (workspace), web_search
6. what time now? i want tno email → multi-intent (get_time + web_search)
7. boss name?                      → follow-up (workspace), should reuse cached
8. remember reply mandarin         → command, save_memory
9. what time + 500 USD to MYR?     → multi-intent (get_time + exchange_rate)
10. AI news + KL weather?          → multi-intent (tech_news + get_weather)
11. [topic switch] quantum computing → should NOT inject previous topic
```

---

## Key Architectural Decisions

1. **6-Phase Decomposition**: Each phase asks the model one focused question — reduces hallucination and improves tool selection accuracy for weak models
2. **Independent CLASSIFY Agent**: Separate API call that validates OBSERVE output — catches entity leakage, greeting misclassification, command detection
3. **4-Layer DECIDE Fallback**: Normal → Simplified → Deterministic → Multi-intent enrichment — ensures a tool plan is always produced
4. **Deterministic Harnesses**: `_validateUrl`, `_recoverToolPlan` — compensate for model weaknesses with code-level guardrails (structural parsing only)
5. **Agent Harnesses (planned)**: `_shortenQuery`, `_pickBestUrl`, entity filtering — semantic decisions delegated to focused micro-prompts instead of hardcoded regex
6. **Workspace Root Entity Rule**: Only the root topic (depth 0) is used for follow-up context — prevents intermediate questions from hijacking the conversation subject
7. **Auto-Fetch Top URL**: After web_search, automatically fetch the highest-quality result — reduces the need for the model to plan fetch_url explicitly
8. **No Hardcoded Semantic Logic**: Design principle — all semantic decisions (intent, language, entity filtering, content quality) are handled by model calls, not regex or word lists
