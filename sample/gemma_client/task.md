# OODA-E Agent Runtime — Task Tracker

## Completed

- [x] OODA-E core loop (Observe → Orient → Decide → Act → Evaluate)
- [x] COT thinking per OODA-E step (Observe, Decide, Evaluate prompts)
- [x] ChatGPT-style Activity side panel (real-time phase tracking, debug expand)
- [x] Phase indicator in chat (clickable inline badges, opens Activity panel)
- [x] Auto context compaction at 99K tokens (3-level: strip tool → shorten → trim)
- [x] Token counter in status footer with warn/critical colors
- [x] IndexedDB Topic Workspace (parentId chain, root entity resolution)
- [x] CLASSIFY phase — independent agent call replacing all hardcoded regex guards
- [x] Greeting detection via CLASSIFY agent (multi-language, no regex)
- [x] Command/preference detection via CLASSIFY agent (save_key/save_value extraction)
- [x] Acknowledgment detection via CLASSIFY agent (no word lists)
- [x] Entity filtering via CLASSIFY agent (user_entities from current message only)
- [x] Follow-up resolution via workspace (replaced hardcoded `_detectFollowUp`)
- [x] Entity coverage ratio (model entity detection vs user text, no hardcoded word lists)
- [x] Multi-intent harness (`_enrichPlanForMissedIntents` — entity-to-tool matching)
- [x] Malformed JSON recovery (`_recoverToolPlan` + `_repairPlanArray`)
- [x] URL validation harness (`_validateUrl` — knownUrls tracking, domain variant fix)
- [x] `_shortenQuery` harness (reject single-word when original multi-word)
- [x] Auto-fetch top URL after web_search in `_act()`
- [x] `_pickBestUrl` (skip social media, PDFs)
- [x] Clean chat UI (tool bubbles in Activity panel only, not in chat)
- [x] Activity tracking for Simple mode (Tools OFF)
- [x] ~Remove all `maxOutputTokens` from codebase and docs~ — **INCOMPLETE**: `oodae-decide.js:167` still has `maxOutputTokens: 256`
- [x] `fetch_url` max_length raised to 15000
- [x] Workspace summary uses root entity topic (not intermediate questions)
- [x] Topic switch detection Layer 1 — skip workspace injection in `_observe()` when zero entity overlap
- [x] Topic switch detection Layer 2 — rebuild `observation.summary` when CLASSIFY entities diverge from OBSERVE
- [x] Explicit entity passing to DECIDE — CLASSIFY's `user_entities` passed as `SEARCH ENTITIES` field
- [x] URL fetch dedup cache in `_act()` — `fetchedUrls` Set prevents re-fetching same URL per run
- [x] Multi-intent entity length filter — skip generic words < 4 chars + GENERIC_WORDS blocklist
- [x] DECIDE query variation on retry — evaluator feedback includes variation instructions
- [x] Refactored `oodae.js` (1013 lines) → 6 focused modules via prototype mixin pattern
- [x] CLASSIFY `is_reference` field — model-driven deictic/pronoun/implicit reference detection (replaces all hardcoded regex)
- [x] `_wsContextAvailable` mechanism — preserve workspace context when Layer 1 skips injection, for CLASSIFY override
- [x] Deictic follow-up query correction harness in DECIDE — prepend workspace entity when model generates generic query
- [x] Implicit contextual follow-up — "boss name?", "address?" detected as `is_reference=true` by CLASSIFY
- [x] 3-layer topic switch + reference system (Layer 1 entity overlap → CLASSIFY is_reference override → Layer 2 entity divergence check)
- [x] E2E regression 60/60 passed (Route 1: priority fixes verified against live Gemini API)
- [x] Route 2: Complex scenario E2E tests — 74/74 PASS (market research, customer service, executive, personal assistant, student)
- [x] Parallel tool execution — independent tools (get_time, exchange_rate, etc.) run concurrently via Promise.all; search-chain tools remain sequential
- [x] Skill registry — `SkillRegistry` class with static template ($variable) and dynamic planner support; built-in skills: deep_research, compare, daily_briefing
- [x] Sub-agent delegation — `_decompose` splits complex multi-part queries; `_runSubAgents` runs focused sub-agents in parallel; `_evaluateSubAgents` merges results
- [x] Skill expansion in orchestrator — DECIDE can select skills; orchestrator expands them into concrete tool calls before ACT
- [x] Unit tests for Route 3 — 165/165 passed (36 new tests for parallel execution, skill registry, skill expansion)
- [x] Unit tests for critical bug fixes — 173/173 passed (8 new: non-string entity safety, punctuation-only guard)
- [x] Harness optimization — 5 improvements (repeated search avoidance, entity pruning, old-intent leakage, snippet extraction, result ranking)
- [x] Unit tests for harness optimization — 189/189 passed (16 new: _rankByRelevance, _extractKnownAnswers, entity pruning)
- [x] Hardcode → Agent migration — 3 semantic migrations + 2 structural retained (GENERIC_WORDS→CLASSIFY, language normalization, metadata tags)
- [x] Unit tests for hardcode → agent migration — 212/212 passed (23 new: search_entities, language normalization, metadata tags)
- [x] Direction loss fix — root entity priority in `_resolveFromWorkspace` (root entities always included, recent fill remaining, cap at 10)
- [x] Unit tests for direction loss fix — 222/222 passed (10 new: deep chain root preservation, root priority ordering, overflow pruning)
- [x] Back-reference query contamination fix — entity-matched topic resolution in `_resolveFromWorkspace` (score each chain by overlap with user entities, select best match instead of most recent)
- [x] Unit tests for back-reference fix — 237/237 passed (15 new: cross-topic entity matching, fallback to most recent, empty entities, middle chain selection)
- [x] Memory recall fix — `_orient` includes all memories in `userProfile` regardless of category (model often saves with default `category='general'` instead of `'user_profile'`)
- [x] Unit tests for memory recall fix — 251/251 passed (14 new: category=general, category=user_info, mixed categories, null/empty guards, recall action)
- [x] Text gen forces tool path fix — CLASSIFY `is_task_request` field (CHECK 9) independently detects content generation requests; orchestrator routes `is_task_request=true` to fast path regardless of `is_command` misclassification
- [x] Unit tests for text gen fix — 267/267 passed (16 new: memory command forces tools, text gen stays on fast path, undefined/empty memory_action, save name/key/value, compose/summarize/explain)
- [x] Math follow-up misclassification fix — `is_reference=true` blocks command path in orchestrator; CLASSIFY prompt excludes computation/math from COMMAND CHECK
- [x] Unit tests for math follow-up fix — 281/281 passed (14 new: multiply/add/divide/subtract/convert blocked by is_reference, real commands still work, undefined is_reference backward compat)
- [x] P15 semantic-drift hallucination fix — strengthened entity name verification in `_evaluate` prompt (EXACT name match required, no similar-sounding substitution)
- [x] P16 cat-name-as-user-name fix — `_directResponse` formats pet memory keys with `(PET, not the user)` disambiguation + semantic key matching instruction
- [x] P19 conversation summary hallucination fix — `_directResponse` now includes recent chat history via `_getRecentContext` + anti-fabrication instruction
- [x] Unit tests for P15/P16/P19 — 311/311 passed (30 new: entity drift detection, profile key disambiguation, chat history inclusion)
- [x] P17 info sharing fix — CLASSIFY `is_info_sharing` check + orchestrator routing to save_memory instead of web_search
- [x] P20 Chinese back-reference fix — DECIDE prompt rule 12 (follow-up reference resolution) + query correction harness (pronoun stripping + workspace entity injection)
- [x] P21 auto language detection — `_detectLanguage` helper (Unicode charset ranges) + ORIENT fallback when no memory preference
- [x] Unit tests for P17/P20/P21 — 346/346 passed (35 new: info sharing routing, workspace entity injection, pronoun removal, language detection)
- [x] P18 memory key dedup — `_findMatchingMemKey` fuzzy matching (prefix normalization + containment) + DECIDE prompt shows existing keys + post-processing harness
- [x] Greeting memory leak fix — `_directResponse` skips profile injection when `observation.intent === 'greeting'`
- [x] Unit tests for P18/greeting fix — 376/376 passed (18 new: key dedup normalization, plan integration, greeting guard)
- [x] P13 text gen forces tool path fix — CLASSIFY `is_task_request` field (CHECK 9) detects content generation requests; orchestrator routes to fast path when `is_task_request=true`
- [x] Token counter accuracy fix — `_callModel` captures `usageMetadata.totalTokenCount` per API call; OODAERunner accumulates `_runTokens`/`_peakCallTokens`; `run()` returns `tokenStats`; `chat_app.js` uses actual cumulative tokens for display and compaction
- [x] Unit tests for P13/token counter — 388/388 passed (12 new: is_task_request routing, token tracking accumulation)
- [x] Conversation auto-save — `saveSession` persists `sessionTokens` alongside `chatHistory`; restored on page load; `_meta` tag filtering for system messages; save status indicator in footer
- [x] Conversation export/import — export full conversation (chatHistory + workspace + memories) as JSON; import restores all state; UI buttons in header
- [x] Unit tests for persistence — 407/407 passed (19 new: sessionTokens persistence, _meta filtering, export/import validation)
- [x] Capability boundary stress test — 64/65 PASS (15-turn E2E: ambiguity, correction, memory update, language switch, negation, hallucination resistance, minimal input, conditional reasoning, memory deletion)
- [x] P1 Refactor: `chat_app.js` split — 1041 lines → 130 lines + 7 modules (`chat_utils.js` 93, `chat_activity.js` 92, `chat_message.js` 72, `chat_context.js` 249, `chat_ui.js` 161, `chat_send.js` 236, `chat_queue.js` 57); load order updated in `chat.html`; 419/419 tests pass
- [x] P2 Refactor: `chat_tools.js` split — 544 lines → 16 lines + 5 modules (`tools_search.js` 153, `tools_data.js` 194, `tools_compute.js` 138, `tools_language.js` 44, `tools_memory.js` 36); 38 tools across 5 categories; 419/419 tests pass
- [x] P3 Refactor: `oodae-observe.js` split — 345 lines → 173 lines + `oodae-workspace.js` 176 lines; workspace resolution + topic persistence extracted; dist rebuilt 86.7kb; 419/419 tests pass
- [x] P4 Refactor: `oodae-decide.js` split — 309 lines → 259 lines + `oodae-plan-post.js` 69 lines; multi-intent enrichment extracted; also fixed missing `_stripThinking` in mixin; dist rebuilt 88.3kb; 419/419 tests pass
- [x] Session 7 Bug 1: DECIDE `_memoryAction=save` enforcement — force `save_memory` into plan, remove spurious `web_search`; hardened with bogus-value guard (`unknown`/`null`/`?`) and question-intent guard to prevent recall-as-save
- [x] Session 7 Bug 2: recall_memory key mismatch — inject `user_profile` into EVALUATE when `memory_action=recall`
- [x] Session 7 Bug 3: CLASSIFY `is_reference` enhanced — CEO/stock/employee examples + attribute-without-entity rule; CLASSIFY CHECK 8 now distinguishes recall questions ("我叫什么名字？") from info sharing ("我叫小明"); orchestrator `is_info_sharing` branch detects bogus save_value and overrides to recall
- [x] Session 7 Bug 4: Acknowledgment profile leak — orchestrator sets `intent='acknowledgment'` + `_directResponse` profile guard
- [x] Unit tests for Session 7 bugs — 434/434 passed (27 new: forced save_memory, profile injection for recall, CLASSIFY prompt verification, acknowledgment guard)
- [x] HarnessConfig centralized config — `src/config.js` singleton with 9 categories (api, keys, generation, agent, context, truncation, services, policies, workspace); 100+ hardcoded values extracted from 12 src/ files + 4 browser tool files (23 service URLs); `HarnessConfig.load(overrides)` for runtime customization; exported via `GemmaClient.HarnessConfig`; dist 103.9kb; 434/434 tests pass
- [x] GoalManager multi-step goal system — `src/goal-manager.js` (280 lines): LLM-driven decomposition into ordered subgoals with dependency graph; parallel execution for independent subgoals, sequential for dependent; replan on failure with alternative approach; cross-session persistence via IndexedDB; goal context injection into OODA-E DECIDE prompt; 503/503 tests pass (69 new)
- [x] ModelRouter multi-model routing — `src/model-router.js` (120 lines): phase-aware model selection (OBSERVE/CLASSIFY→fast, DECIDE/EVALUATE→default); confidence-based escalation (low+retry→strong, deep_research→strong); configurable per-phase mapping + runtime updates; routing stats in tokenStats; integrated via `_callModel` `_phase` param across all 6 phase files; 568/568 unit tests pass (54 new); dist 122.4kb
- [x] ProactiveEngine autonomous trigger system — `src/proactive.js` (350 lines): 4 trigger types (schedule/condition/reminder/follow_up); cron parser with 5-field support (exact/step/list/range/any); condition evaluation with cooldown; permission model (safe actions auto-execute, risky queue for approval); IndexedDB persistence via `chat_memory.js` (DB_VERSION 4, triggers store); 665/665 unit tests pass (97 new); dist 138.4kb
- [x] LearningSystem experience-driven improvement — `src/learning.js` (310 lines): outcome logging with query type classification; pattern discovery across 12+ query types; strategy recommendation from historical best; auto-skill generation from repeated tool combos; best practices surfacing per phase; integrated into OODAERunner (logOutcome at 4 return points, recommendStrategy before DECIDE); IndexedDB persistence via `chat_memory.js` (DB_VERSION 5, learning store); 819/819 unit tests pass (90 new); dist 154.0kb
- [x] P24 fix: trust OBSERVE LLM's follow_up classification — implicit follow-ups like "最后一次喷发是什么时候？" (no pronouns, no entity overlap) now handled correctly by adding `llmSaysFollowUp` check in `_resolveFromWorkspace` (`oodae-observe.js`)
- [x] P25 fix: deictic correction for ALL decide paths — extracted `_applyDeicticCorrection` from `_decide` into standalone export (`oodae-decide.js`); called in orchestrator after `_enrichPlanForMissedIntents` so it covers `_decideSimplified`, `_recoverToolPlan`, and `_buildFallbackPlan` too (`oodae.js`)
- [x] P26 fix: model fabrication from tangential results — EVALUATE prompt rule 8: tangential mention filter rejects entities mentioned only in passing (not main subject); checks result title for entity presence (`oodae-evaluate.js`)
- [x] P27 fix: implicit "the" reference not resolved — CLASSIFY CHECK 6 now recognizes definite article "the" + attribute as implicit back-reference (e.g., "what is the stock price?" after NVIDIA → is_reference=true); added 3 examples + NOTE about "the" as reference marker (`oodae-observe.js`)
- [x] P28 fix: memory key granularity — compound info splitting via `save_pairs` array in CLASSIFY; orchestrator propagates `_savePairs` to DECIDE forced-save logic; multi-fact sentences generate multiple save_memory calls (e.g., "name is David and works at Microsoft" → 2 saves) (`oodae-observe.js`, `oodae-decide.js`, `oodae.js`)
- [x] P29 fix: search quality domain reputation — `_pickBestUrl` now uses 4-pass scoring: preferred domains (Wikipedia, SO, GitHub, MDN) → .edu/.gov → generic with snippet → any valid URL; `HarnessConfig.policies.preferredDomains` configurable list (`oodae-act.js`, `config.js`)
- [x] ProactiveEngine browser UI — `chat_proactive.js` (170 lines): trigger management panel with add/remove/view; pending approval UI with approve/reject buttons; `setInterval(tick, 60s)` background loop; notification queue in chat; CSS for trigger panel + approval items; wired into `chat_app.js` init + `chat.html` (`chat_proactive.js`, `chat.css`, `chat.html`, `chat_app.js`)
- [x] Unit tests for P26-P29 + preferredDomains — 844/844 unit tests pass (25 new: domain reputation scoring 6, compound info splitting 5, implicit "the" reference 6, tangential filter 1, HarnessConfig preferredDomains 5, .edu priority 1, skip rules 1)
- [x] P26 fix (extended): standalone recall detection — CLASSIFY `memory_action=recall` without `is_info_sharing` now correctly routes to tool path (recall_memory); ORIENT recall action forces `requires_tools=true` as safety net (`oodae.js`)
- [x] P27 fix (extended): CJK/EN sentence-level follow-up patterns — 9 CJK patterns (那X呢？, 为什么？, 怎么办？, 哪个更X？, 然后呢？, 还有呢？, 多少？, 什么时候？) + 5 EN patterns (Why?, How come?, What about X?, And X?, Which one?) added to `_resolveFromWorkspace` overlap detection (`oodae-observe.js`)
- [x] P27 fix (extended): workspace recentEntity propagation — leaf node entity from workspace chain propagated as `_wsRecentEntity` for deictic correction anchor; `_applyDeicticCorrection` prefers recent entity over root entity for pronoun follow-ups (`oodae-workspace.js`, `oodae-observe.js`, `oodae-decide.js`)
- [x] P27 fix (extended): `_lastTopicId` cross-turn tracking — OODAERunner stores `_lastTopicId` from `_saveToWorkspace` return value; passed to next `run()` via `opts._lastTopicId` for pronoun resolution (`oodae.js`, `oodae-workspace.js`)
- [x] P27 fix (extended): recall_memory key normalization — `_findMatchingMemKey` now applied to recall_memory in DECIDE (key/query args); prevents "cat_name" missing "pet_name" due to LLM key mismatch (`oodae-decide.js`)
- [x] P27 fix (extended): semantic alias group matching — `_findMatchingMemKey` gains 10 alias groups (cat↔pet, name↔nickname, location↔city↔address, job↔occupation, etc.) with CJK character extraction; checked BEFORE substring containment to prevent false matches (`oodae-helpers.js`)
- [x] P28 fix (extended): memory key normalization for ALL decide paths — catch-all normalization in orchestrator loop applies `_findMatchingMemKey` to recall_memory and save_memory from `_decideSimplified`, `_recoverToolPlan`, `_buildFallbackPlan` (`oodae.js`)
- [x] P28 fix (extended): searchMemories word-level fallback — `chat_memory.js` `searchMemories` adds word-level tokenized search with CJK character extraction when exact substring fails
- [x] ToolRunner _meta strip — `tool-runner.js` filters `_meta` tags from chatHistory before sending to Gemini API (rejects unknown fields)
- [x] Config: `workspace.recentTopicsFetch` 5→10, added `recentTopicsExtended: 20` for two-pass search fallback window (`config.js`)
- [x] dist rebuilt: 165.2kb; 844/844 unit tests pass
- [x] Autonomous agent coordination layer — wired all 5 subsystems together:

| Component | Before | After |
|-----------|--------|-------|
| **ProactiveEngine.runner** | Always `null` → TypeError on action execution | Wired from `chat_send.js` via `getRunner()` on first user message; updated on each `sendToolChat()` |
| **GoalManager** | Never instantiated in browser | Created in `chat_app.js` init, persisted to IndexedDB, runner wired on first `sendToolChat()` |
| **LearningSystem** | Never instantiated in browser | Created in `chat_app.js` init, passed to OODAERunner via `opts.learningSystem` for outcome logging + strategy recommendation |
| **proactiveTick()** | Missing `await` on async `tick()`, no error handling | Properly awaited, wrapped in `.catch()`, errors logged to console |
| **Approval execution** | `approve()` changed status but never ran the action | Now calls `_executeTrigger()` after approval, shows result notification, handles runner-not-ready case |
| **onNotify callback** | Not passed to ProactiveEngine constructor | Wired to `addProactiveNotification()` for chat display |
| **onApprovalNeeded callback** | Not passed to ProactiveEngine constructor | Wired to `renderPendingApprovals()` + notification display |
| **Condition auto-fetch** | No mechanism to check condition values | `_updateConditionValues()` runs before each tick; maps `watch` keys to tool calls (crypto_price, get_weather); falls back to OODA-E query for generic conditions |
| **Action parsing** | Plain string `actionText` → malformed action object | `_parseAction()` handles `run:query`, `notify:message`, `goal:description` prefixes + auto-detection |
| **Trigger panel** | Used `.cron` (undefined) | Fixed to `.cronExpr`; conditions show `(current: value)` |

Files modified: `chat_proactive.js` (rewritten, 260→270 lines), `chat_send.js` (+15 lines: global runner + coordination), `chat_app.js` (+20 lines: GoalManager + LearningSystem init); dist rebuilt 179.8kb; 856/856 tests pass

## In Progress

### ~~🔧 Session 7 Bug Fixes~~ — COMPLETED (2026-03-21)

All 4 bugs from Session 7 regression test fixed. 434/434 unit tests pass. dist rebuilt (92.1kb).

| # | Bug | Fix | File |
|---|-----|-----|------|
| 1 | **P17: DECIDE ignores `_memoryAction` flag** | Force `save_memory` into plan when `memory_action=save`; hardened with bogus-value guard + question-intent guard to prevent recall-as-save | `src/oodae-decide.js` |
| 2 | **P14: recall_memory key mismatch** | Inject `orientation.user_profile` into EVALUATE prompt when `memory_action=recall` | `src/oodae-evaluate.js` |
| 3 | **CLASSIFY `is_reference` weak + recall-as-save misclass** | CHECK 6: CEO/stock/employee examples; CHECK 8: recall vs save disambiguation ("我叫什么名字？"→recall, "我叫小明"→save); orchestrator bogus-value override | `src/oodae-observe.js` + `src/oodae.js` |
| 4 | **Acknowledgment leaks user_profile** | Orchestrator sets `intent='acknowledgment'`; `_directResponse` skips profile for greeting+ack | `src/oodae.js` + `src/oodae-evaluate.js` |

---

### COT Prompt Engineering Enhancement (2026-03-21) — Toward Autonomous Agent

**Goal:** Improve weak Gemma LLM reasoning ability via structured Chain-of-Thought (COT) prompting across ALL OODA-E phases. Target: autonomous agent capability.

**Before:** Only 2 of 7 LLM phases used COT (`<thinking>` tags) — DECIDE and EVALUATE.

**After:** All 7 LLM phases now use structured COT with self-verification:

| Phase | Before | After | Key Improvement |
|-------|--------|-------|-----------------|
| **OBSERVE** | No COT, "Output ONLY JSON" | 6-step thinking checklist | Better intent detection, entity extraction |
| **CLASSIFY** | No COT (9 checks, no structured thinking) | 5-step verification + consistency check | More reliable cross-checking of OBSERVE |
| **DECIDE** | 4-step COT | 5-step COT + self-verification + 4 few-shot examples | Better tool selection, fewer empty plans |
| **EVALUATE** | 5-step COT | 7-step COT + self-critique + confidence scoring | Catches wrong-entity answers, enables adaptive retry |
| **DIRECT_RESPONSE** | No COT | 4-step thinking (question → profile → response → language check) | Better profile-aware responses |
| **FORCE_FINAL_ANSWER** | No COT | 4-step thinking (question → evidence → confidence → gaps) | Honest uncertainty acknowledgment |
| **DECOMPOSE** | No COT | 5-step thinking (count → independence → dependency → list → verify) | Better task splitting decisions |
| **_evaluateSubAgents** | No COT | 4-step thinking (facts → contradictions → organization → completeness) | Better answer merging |

**New features added:**

1. **Confidence scoring** — EVALUATE now outputs `"confidence":"high|medium|low"` field; `_extractConfidence()` utility in helpers; confidence propagated to run result
2. **Self-verification** — DECIDE step 5: "Does my plan ACTUALLY answer what the user asked?"; EVALUATE step 6: "Re-read my answer — is it complete?"
3. **Enhanced feedback loop** — EVALUATE's `suggested_query` field passed to next DECIDE cycle (more targeted retry instead of generic "try different keywords")
4. **Few-shot examples in DECIDE** — 4 concrete examples (web_search, save_memory, get_time, get_weather) to anchor weak model behavior

**Files modified:**
- `src/oodae-observe.js` — OBSERVE + CLASSIFY COT
- `src/oodae-decide.js` — DECIDE COT enhancement + few-shot examples
- `src/oodae-evaluate.js` — EVALUATE self-critique + DIRECT_RESPONSE COT + FORCE_FINAL_ANSWER COT
- `src/oodae-subagent.js` — DECOMPOSE + _evaluateSubAgents COT
- `src/oodae-helpers.js` — `_extractConfidence()` utility
- `src/oodae.js` — confidence tracking + enhanced feedback loop with `suggested_query`

**Autonomous agent feasibility assessment:**

✅ **Already strong:**
- OODA-E loop = proper agent architecture (Observe→Orient→Decide→Act→Evaluate)
- Each phase as separate API call = perfect for weak models (focused, small tasks)
- 4-layer fallback (DECIDE → simplified → deterministic → ToolRunner) = high reliability
- Sub-agent decomposition = handles complex multi-part queries
- Workspace memory = cross-turn context persistence
- Tool registry with 38 tools = rich action space

✅ **Now improved (this session):**
- COT in all phases = better reasoning quality
- Self-verification = catches errors before they propagate
- Confidence scoring = knows when it's uncertain
- Few-shot examples = anchors weak model behavior
- Enhanced feedback loop = smarter retries
- **Proactive re-planning** = confidence-driven strategy switching (see below)

### Proactive Re-Planning System (2026-03-21) — Strategy-Driven Retry

**Problem:** The DECIDE→ACT→EVALUATE loop retried blindly — same approach, different keywords. If confidence was consistently low, the system had no mechanism to fundamentally change its strategy.

**Solution:** Confidence trend analysis + strategy switching. The orchestrator now tracks confidence across loops and pivots to a different strategy when the current one is failing.

**Architecture:**

```
Loop 1: DECIDE(default) → ACT → EVALUATE → confidence=low
                                                ↓
                                    REPLAN: trend=struggling → switch to "narrow"
Loop 2: DECIDE(narrow) → ACT → EVALUATE → confidence=medium
                                                ↓
                                    REPLAN: trend=improving → keep
Loop 3: DECIDE(narrow) → ACT → EVALUATE → confidence=high → DONE
```

**5 strategies available:**

| Strategy | When Selected | What It Does |
|----------|---------------|-------------|
| `default` | First attempt | Normal DECIDE prompt |
| `narrow` | Results too broad (plateaued/struggling) | Add specific qualifiers: year, country, role, industry, full legal name |
| `broaden` | Results too specific (plateaued) | Use general terms, remove qualifiers, search category |
| `deep_research` | Failing badly (declining/stuck_low) | Multi-angle search via `deep_research` skill |
| `alternative_source` | Failing badly (declining/stuck_low) | Switch tools: `ddg_search`, direct `fetch_url` |
| `decompose` | Failing badly (stuck_low) | Break into sub-questions, search each separately |

**Confidence trend analysis:**

| Trend | Condition | Meaning |
|-------|-----------|---------|
| `improving` | latest > previous | Getting better → keep strategy |
| `declining` | latest < previous | Getting worse → big pivot |
| `stuck_low` | all low | Nothing works → try fundamentally different approach |
| `plateaued` | stable at medium | Making some progress → moderate change |
| `struggling` | first loop was low | Bad start → try different angle |

**New data in run result:**
- `confidence` — final confidence level (`high`/`medium`/`low`)
- `confidenceHistory` — array of confidence per loop (for max-loop fallback)
- `strategy` — which strategy produced the final answer
- `phaseLog` now includes `replan` events with `{from, to, trend, confidence}`

**Thinking tag safety:**
- Added `_stripThinking()` utility — strips `<thinking>...</thinking>` from free-text responses
- Applied to `_directResponse`, `_forceFinalAnswer`, `_evaluateSubAgents`
- Prevents COT reasoning from leaking into user-visible answers

**Files modified:**
- `src/oodae-helpers.js` — `_stripThinking()`, `_analyzeConfidenceTrend()`, `_selectNextStrategy()`
- `src/oodae-decide.js` — `strategy` parameter + 5 strategy hint injections in DECIDE prompt
- `src/oodae-evaluate.js` — `_stripThinking` in `_directResponse` + `_forceFinalAnswer`
- `src/oodae-subagent.js` — `_stripThinking` in `_evaluateSubAgents`
- `src/oodae.js` — confidence tracking, strategy switching, `replan` phase event, imports/mixin

⚠️ **Remaining gaps for full autonomy:** See "Autonomous Agent Upgrade Roadmap" below.

---

## Pending

### Autonomous Agent Upgrade Roadmap (2026-03-21) — 5-Layer Plan

**Current state:** Highly-optimized single-query responder (64/65 stress test, 5-strategy re-planning, sub-agents, skills). **Purely reactive** — only responds to `run(userText)`, never initiates action.

**Target:** 主动智能体 (proactive autonomous agent) — can set goals, plan multi-step tasks, act proactively, and learn from experience.

#### Layer 0: Fix 4 Known Bugs (Foundation — ~0.5 day)

Must fix before any new features. All S-effort.

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | **P17: DECIDE ignores `_memoryAction` flag** | `src/oodae-decide.js` | In `_decide()`, if `observation._memoryAction === "save"`, force plan to include `save_memory` with `observation._saveKey` / `observation._saveValue`. Do NOT generate web_search for info sharing. |
| 2 | **P14: recall_memory key mismatch** | recall_memory handler | Search both keys AND values (query "name" should match key `user_info` with value "David"). Or inject ORIENT's `user_profile` into EVALUATE when `memory_action === "recall"`. |
| 3 | **CLASSIFY `is_reference` weak for deictic** | `src/oodae-observe.js` (CLASSIFY prompt CHECK 6) | Add explicit examples: "who is the CEO?" after company → `is_reference=true`. "what's the price?" after product → `is_reference=true`. |
| 4 | **Acknowledgment leaks user_profile** | `src/oodae-evaluate.js` (`_directResponse`) | Skip `user_profile` injection when `observation.intent === 'acknowledgment'`, same guard as greeting. |

**Validation:** `npm test` (all 407+ unit tests) + `npm run test:stress` (64/65 → target 65/65)

---

#### Layer 1: Goal System — GoalManager (~3-5 days)

**Problem:** Agent only handles single-turn queries. "帮我规划下周日本旅行" → searches once → done. No multi-step execution.

**What to build:** `src/goal-manager.js`

```js
class GoalManager {
    constructor(runner, memoryDB) { ... }

    // Goal lifecycle
    create(description, opts)     // → { id, description, status, subgoals, progress, context, deadline }
    decompose(goal)               // LLM breaks goal → ordered subgoals with dependencies
    execute(goal)                 // Runs subgoals sequentially/parallel via OODA-E
    checkProgress(goal)           // Evaluates completion (0.0 → 1.0)
    replan(goal, failedSubgoal)   // LLM generates alternative approach on failure

    // State
    getActive()                   // All in-progress goals
    persist(memoryDB)             // Save to IndexedDB for cross-session survival
    restore(memoryDB)             // Load on startup
}
```

**Key changes to existing code:**
- `oodae.js` `run()` → support `opts.goal` context (subgoal inherits parent goal's accumulated results)
- `oodae-evaluate.js` → assess not just "answer quality" but "subgoal completion"
- `chat_memory.js` → new `goals` object store in IndexedDB

**Example flow:**
```
User: "帮我比较 Tesla 和 BYD 的投资价值"
  → GoalManager.create("比较 Tesla 和 BYD 投资价值")
  → decompose → [
      { subgoal: "查 Tesla 财务数据", deps: [] },
      { subgoal: "查 BYD 财务数据", deps: [] },
      { subgoal: "查两家股价走势", deps: [] },
      { subgoal: "综合分析比较", deps: [0, 1, 2] }  // 等前 3 个完成
    ]
  → execute subgoals 0-2 in parallel (each runs OODA-E)
  → execute subgoal 3 with accumulated context
  → return comprehensive comparison
```

**Acceptance criteria:**
- [x] GoalManager can decompose a complex goal into 3+ subgoals
- [x] Subgoals with dependencies execute in correct order
- [x] Independent subgoals execute in parallel
- [x] Failed subgoal triggers replan (not crash)
- [x] Goals persist across page reload (IndexedDB)
- [ ] E2E test: "compare X and Y" produces multi-source synthesis (needs live API)

**Implementation (2026-03-21):** `src/goal-manager.js` (280 lines), 69 unit tests (503/503 total). Files modified: `oodae.js` (goal context passthrough), `oodae-decide.js` (GOAL CONTEXT in prompt), `chat_memory.js` (goals store, DB_VERSION 3), `index.js` (GoalManager export). dist 117.4kb.

**Layer 4 Implementation (2026-03-22):** `src/model-router.js` (120 lines), 54 unit tests (568/568 total). Files modified: `oodae-helpers.js` (_callModel routing), `oodae-observe.js` (_phase: observe/classify), `oodae-decide.js` (_phase: decide), `oodae-evaluate.js` (_phase: evaluate/direct/fallback), `oodae-subagent.js` (_phase: decompose/synthesize), `oodae.js` (ModelRouter constructor + loopOpts + tokenStats), `config.js` (routing section), `index.js` (ModelRouter export). dist 122.4kb.

---

#### Layer 2: Proactive Engine — ProactiveEngine (~3-5 days)

**Problem:** `run(userText)` is the only entry point. No user input = agent is completely idle.

**What to build:** `src/proactive.js`

```js
class ProactiveEngine {
    constructor(runner, goalManager, memoryDB) { ... }

    // Trigger types
    addSchedule(cron, action)              // "0 8 * * *" → daily_briefing
    addCondition(watch, threshold, action)  // "btc_price > 100000" → notify
    addReminder(datetime, message)          // "2026-03-25T09:00" → remind user
    addFollowUp(goalId, stepId, action)     // After goal step completes → next action

    // Runtime
    tick()                    // Check all triggers (call every 60s)
    evaluate(trigger)         // Should this trigger fire now?
    act(action)               // Execute via OODA-E runner
    notify(user, message)     // Push result to UI

    // Permissions
    setAutoApprove(types[])       // Which actions can run without user confirmation
    requestApproval(action)       // Queue action for user confirmation
}
```

**Key changes to existing code:**
- `chat_app.js` → `setInterval(engine.tick, 60000)` background loop
- New UI: trigger management panel (add/remove/view active triggers)
- New UI: notification queue (pending proactive results)
- Permission model: "safe" actions (search, weather) auto-execute; "risky" (save, delete) need approval

**Example scenarios:**
```
"每天早上 8 点给我新闻摘要"     → addSchedule("0 8 * * *", { skill: "daily_briefing" })
"BTC 超过 10 万通知我"          → addCondition("btc_price", "> 100000", { notify: true })
"3 天后提醒我跟进这件事"        → addReminder("2026-03-24T09:00", "跟进上次讨论")
```

**Acceptance criteria:**
- [x] Schedule triggers fire at correct intervals
- [x] Condition triggers evaluate external data (via tools) and fire when met
- [x] Reminders fire at specified time
- [x] Auto-execute safe actions, queue risky actions for approval
- [x] Triggers persist across page reload (IndexedDB)
- [x] UI shows active triggers + pending notifications (`chat_proactive.js` + trigger panel in `chat.html`)

**Implementation (2026-03-22):** `src/proactive.js` (350 lines), 97 unit tests (665/665 total). Files modified: `config.js` (proactive section), `chat_memory.js` (triggers store, DB_VERSION 4), `index.js` (ProactiveEngine export). dist 138.4kb.

---

#### Layer 3: Learning System — LearningSystem (~5-7 days)

**Problem:** `_stripThinking()` discards model reasoning. Strategy experience not saved. Each conversation starts from zero.

**What to build:** `src/learning.js`

```js
class LearningSystem {
    constructor(memoryDB) { ... }

    // 1. Experience recording — log every run() outcome
    logOutcome(entry)  // { query_type, strategy, tools_used, confidence, success, duration }

    // 2. Pattern discovery
    //    "company queries → web_search+fetch_url success 92%"
    //    "weather queries → get_weather success 99%"
    discoverPatterns()  // → Map<query_type, { best_strategy, best_tools, avg_confidence }>

    // 3. Strategy recommendation (called by DECIDE phase)
    recommendStrategy(observation)  // → { strategy, tools, reason }

    // 4. Auto-skill generation
    //    If tool combo [web_search, fetch_url, web_search] repeated 5+ times → register as skill
    detectNewSkills()   // → Skill[] (auto-register in SkillRegistry)

    // 5. Prompt tuning — surface best practices per phase
    getBestPractices(phase)  // → string (inject into phase prompt)
}
```

**Key changes to existing code:**
- `oodae.js` `run()` → after returning, call `learning.logOutcome(...)` with full trace
- `oodae-decide.js` → query `learning.recommendStrategy()` for initial strategy before LLM call
- `oodae-helpers.js` → stop stripping thinking in internal logs (still strip for user-visible output)
- `skill-registry.js` → support runtime `add()` from learning system
- `chat_memory.js` → new `learning` object store for outcome history

**Acceptance criteria:**
- [x] Every `run()` logs outcome to IndexedDB
- [x] After 20+ queries, `discoverPatterns()` returns meaningful strategy preferences
- [x] DECIDE uses historical best strategy as default (not always "default")
- [x] Repeated tool combos auto-registered as skills after 5+ occurrences
- [ ] Agent demonstrably improves success rate over 50+ queries (needs live API long-run test)

**Implementation (2026-03-22):** `src/learning.js` (310 lines), 90 unit tests (819/819 total). Files modified: `oodae.js` (learningSystem constructor + _logToLearning at 4 return points + recommendStrategy before DECIDE loop), `config.js` (learning section), `chat_memory.js` (learning store, DB_VERSION 5), `index.js` (LearningSystem export). dist 154.0kb.

---

#### Layer 4: Multi-Model Router — ModelRouter (~2-3 days)

**Problem:** All 7 LLM phases use Gemma 3 27B. Simple tasks (CLASSIFY) waste capacity; complex tasks (DECIDE) hit ceiling.

**What to build:** `src/model-router.js`

```js
class ModelRouter {
    constructor(models) { ... }
    // models = { fast: 'gemma-3-4b-it', default: 'gemma-3-27b-it', strong: 'gemini-2.0-flash' }

    route(phase, complexity, confidence) {
        // OBSERVE/CLASSIFY → fast model (4B/12B)
        // DECIDE/EVALUATE → default model (27B)
        // Low confidence retry → strong model (Gemini Flash/Pro)
    }
}
```

**Key changes:** `_callModel()` accepts model override → query router per phase.

**Value:** ~40% token savings + better quality on hard queries.

**Acceptance criteria:**
- [x] Simple phases route to smaller/faster model
- [x] Low-confidence retries escalate to stronger model
- [x] Configurable model mapping per phase
- [x] Token cost reduction measurable vs baseline (routing stats in tokenStats)

---

#### Execution Summary

```
Layer 0 (bugs)        ████████████████████  DONE      ✓ 4/4 bugs fixed
Layer 1 (goals)       ████████████████████  DONE      ✓ GoalManager + 69 tests
Layer 2 (proactive)   ████████████████████  DONE      ✓ ProactiveEngine + 97 tests
Layer 3 (learning)    ████████████████████  DONE      ✓ LearningSystem + 90 tests
Layer 4 (routing)     ████████████████████  DONE      ✓ ModelRouter + 54 tests
                                            ALL LAYERS COMPLETE

Post-roadmap:
  Bug fixes (P26-P29) ████████████████████  DONE      ✓ 4 open bugs + 11 extended fixes
  ProactiveEngine UI  ████████████████████  DONE      ✓ Browser trigger panel + tick loop
  Memory/workspace    ████████████████████  DONE      ✓ Alias groups + CJK follow-up patterns
```

**Dependencies:** ~~Layer 0 → blocks all~~ DONE | ~~Layer 1 → blocks Layer 2~~ DONE | Layers 2, 3, 4 independent of each other

---

### Code Refactoring — Completed (2026-03-21)

All 4 priorities completed. 15 new modules extracted, all 419/419 tests passing.

| Priority | Original File | Before → After | New Modules | Status |
|----------|--------------|----------------|-------------|--------|
| **P1** | `chat_app.js` | 1041 → 130 | `chat_utils.js` 93, `chat_activity.js` 92, `chat_message.js` 72, `chat_context.js` 249, `chat_ui.js` 161, `chat_send.js` 236, `chat_queue.js` 57 | **DONE** |
| **P2** | `chat_tools.js` | 544 → 16 | `tools_search.js` 153, `tools_data.js` 194, `tools_compute.js` 138, `tools_language.js` 44, `tools_memory.js` 36 | **DONE** |
| **P3** | `oodae-observe.js` | 345 → 173 | `src/oodae-workspace.js` 176 | **DONE** |
| **P4** | `oodae-decide.js` | 309 → 259 | `src/oodae-plan-post.js` 69 | **DONE** |

**Also fixed:** `_stripThinking` missing from `oodae.js` import/mixin (pre-existing bug causing live test failures).

**Files that need no split:** `oodae.js`, `oodae-helpers.js`, `oodae-act.js`, `oodae-evaluate.js`, `oodae-subagent.js`, `client.js`, `core.js`, `tool-runner.js`, `tool-parser.js`, `skill-registry.js`, `chat_memory.js`, `chat_debug.js`

### Harness Engineering
- [x] Repeated search avoidance — `_extractKnownAnswers` passes recent model answers to DECIDE as "ALREADY KNOWN" context
- [x] Workspace entity pruning — case-insensitive dedup + cap at 10 entities in `_resolveFromWorkspace`
- [x] Decide old-intent leakage — Rule 11 in DECIDE prompt: "ONLY select tools for the CURRENT question"
- [x] Evaluate snippet extraction — snippets sorted by entity relevance within each web_search result
- [x] Search result ranking — `_rankByRelevance` reorders actResults by entity overlap before EVALUATE

### Features
- [x] Memory integration testing — verified save_memory works e2e (name, language preference recalled across turns)
- [x] Timezone passthrough — get_time correctly uses Asia/Kuala_Lumpur from Orient
- [x] Skill registry — `SkillRegistry` class with static/dynamic skill definitions, DECIDE integration, built-in skills
- [x] Sub-agent delegation — decompose complex queries → parallel sub-agents → merged evaluation
- [x] Parallel tool execution — independent tools run concurrently; search-chain stays sequential with URL tracking
- [x] Conversation export — save/load full conversation + workspace + memories as JSON
- [x] Conversation auto-save — persist chatHistory + sessionTokens to IndexedDB; restore on page load; save status indicator
- [x] Token counter improvement — track actual API-reported `usageMetadata.totalTokenCount` instead of text-only estimate

### HarnessConfig — 集中配置层 (80+ hardcoded values → centralized config) — COMPLETED (2026-03-21)
- [x] Create `src/config.js` — `HarnessConfig` singleton with 9 categories, 100+ values
- [x] Extract API + Keys — `API_BASE`, model, seed → `config.api.*` / `config.keys.*`
- [x] Extract Generation Configs — 4 phase-specific configs → `config.generation.{client,helper,deterministic,creative}`
- [x] Extract Agent Thresholds — `MAX_LOOPS`, `MAX_ACT_ITERATIONS`, `toolRunnerMaxIterations` → `config.agent.*`
- [x] Extract Context + Truncation — 20+ magic numbers → `config.context.*` / `config.truncation.*`
- [x] Extract Service URLs — 23 endpoints → `config.services.{search,knowledge,data,language}`
- [x] Extract Policies — `SEARCH_TOOLS`, `SKIP_EXT`, `SKIP_SITE`, `LANG_ALIASES` → `config.policies.*`
- [x] Extract Workspace Thresholds — `maxWordCount`, `ackMaxWords`, `entityCoverageThreshold` → `config.workspace.*`
- [x] Runtime Override — `HarnessConfig.load(overrides)` with `_deepMerge` (preserves RegExp)
- [x] Export — `GemmaClient.HarnessConfig` available via bundled dist
- [x] Rebuild + Test — dist 103.5kb, 434/434 unit tests pass
- [x] Wire `tools_*.js` service URLs — 4 browser scripts read `GemmaClient.HarnessConfig.services.*` with inline fallbacks; 23 URLs across `tools_search.js`(8), `tools_data.js`(12), `tools_compute.js`(1), `tools_language.js`(4)

### Infrastructure
- [x] `npm run build` — dist/gemma_client.js rebuilt (165.2kb)
- [x] Unit tests for Route 3 features — 36 new tests (parallel execution, skill registry, skill expansion)
- [ ] Live API test suite for OODA-E (extend test_oodae.mjs)
- [x] Route 2: Complex scenario E2E tests — 74/74 PASS (market research, customer service, executive, personal assistant, student)
- [x] Route 3: Capability expansion — parallel execution, skill registry, sub-agent delegation
- [x] Long conversation flow test — 12-step E2E (52/52 PASS): context retention, direction loss, topic switch, back-reference, multi-intent, memory recall
- [x] Browser long-run test — 15-turn E2E (14/15 PASS, Session 6): P11/P12/P14 fixes confirmed, P13 still broken, acknowledgment guard + ambiguous input + memory recall all working
- [x] Browser regression test — 9-turn E2E (6/9 PASS, Session 7): **P13 FIXED**, token counter FIXED, P17 info-sharing save BROKEN→**FIXED**, P14 memory recall REGRESSION→**FIXED**, CLASSIFY is_reference weak→**FIXED**, ack leak→**FIXED**
- [x] Capability boundary stress test — 15-turn E2E (64/65 PASS): 13 untested capability gaps covered (ambiguity, user correction, memory update, language switch, negation constraint, hallucination resistance, minimal input, conditional reasoning, memory deletion, back-reference across 8 turns)
- [x] Browser E2E live test (2026-03-22) — 9-test suite via Chrome DevTools MCP against live Gemini API (Gemma 3 27B), **8/9 PASS, 1/9 PARTIAL**:

| # | Input | Result | Key Findings |
|---|-------|--------|-------------|
| 1 | `hello` | **PASS** | Greeting detected, 0 tools, 3.12s, no memory leak |
| 2 | `my name is Alex` | **PASS** | save_memory(user_name=Alex, category=user_info), 1 tool, 5164 tokens |
| 3 | `I'm a developer in Tokyo` | **PARTIAL** | Saved occupation only (user_occupation=developer); save_pairs compound splitting not triggered by model — code path exists (P28) but Gemma 3 27B returned single save_key instead of save_pairs array |
| 4 | `tell me about NVIDIA` | **PASS** | web_search → Wikipedia auto-selected (P29 domain reputation), 2 tools, 19.1K tokens |
| 5 | `what is the stock price?` | **PASS** | Implicit "the" → NVIDIA (P27 `_corrected:true`), searched NVDA, fetched Yahoo Finance + Wikipedia, 2 loops, 4 tools, $174.90 |
| 6 | `那CEO是谁？` | **PASS** | CJK pattern `那X` matched (P27), resolved to NVIDIA CEO, fetched wikipedia.org/wiki/Jensen_Huang, Chinese response: "Jensen Huang，他是 Nvidia 的创始人、总裁兼首席执行官", 2 tools |
| 7 | `quantum computing` | **PASS** | Topic switch — NO NVIDIA contamination in search query, clean "quantum computing applications" search, 2 tools |
| 8 | `what is my name?` | **PASS** | recall_memory(query=user_name) → found "Alex" (P26 recall), 1 tool, 2.06s |
| 9 | `i see` | **PASS** | is_acknowledgment=true, 0 tools, 0 loops, 3084 tokens, all 3 memories intact (location/name/occupation) |

**Fixes verified live:** P26 (recall routing), P27 (implicit "the" + CJK follow-up), P29 (Wikipedia/preferred domain auto-fetch), greeting no-leak, topic switch isolation, acknowledgment guard.
**Known limitation:** P28 compound save_pairs depends on model returning `save_pairs` array — Gemma 3 27B tends to save only the primary fact. Code path is correct but model behavior is inconsistent.

### Test Fixes (Browser — index.html)
- [x] Fix `rotateEveryN` test — index.html expected `5`, changed to `1` (matches `src/core.js:37`)
- [x] Fix `maxOutputTokens` test — index.html expected `8192`, changed to assert `undefined` (removed from GemmaAPI defaults)
- [x] Fix live test `rotateEveryN` — `testLiveKeyLoading` used `5`, changed to `1`
- [x] Remove residual `maxOutputTokens: 256` from `oodae-decide.js:167` (`_decideSimplified`)
- [x] Rebuild dist/ after all source fixes (`npm run build`) — 73.5kb

### Critical Bug Fixes
- [x] **`TypeError: e.toLowerCase is not a function`** — OODA-E crashes when model returns non-string entities (numbers, null). Fixed: `String(e)` coercion at all 10 call sites across 4 files (oodae.js, oodae-observe.js, oodae-decide.js)
- [x] **CLASSIFY misclassifies math follow-up as command** — Fixed: orchestrator requires `!classification.is_reference` to enter command path; CLASSIFY prompt excludes computation/math requests from COMMAND CHECK
- [x] **P15: Semantic-drift hallucination** — Fixed: `_evaluate` prompt strengthened with exact entity name verification (full name match required, no similar-sounding substitution, honest "not found" when no match)
- [x] **P16: Cat-name-as-user-name confusion** — Fixed: `_directResponse` tags pet memory keys with `(PET, not the user)` and adds semantic key matching instruction
- [x] **P19: Conversation summary hallucination** — Fixed: `_directResponse` includes `chatHistory` via `_getRecentContext` + explicit anti-fabrication instruction
- [x] **Single "?" triggers workspace follow-up** — Fixed: added punctuation-only guard (`/^[\p{P}\p{S}\s]+$/u`) in `_resolveFromWorkspace`

### API Key & Infrastructure
- [ ] Remove dead API key #2 (`AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48`) from `gemma_code.jsonl` — consistently returns 403, wastes a retry each rotation cycle
- [ ] chat.html CORS on file:// protocol — `keyManager.loadFromJSONL()` fails when opened via `file://` (CORS blocks fetch); works fine via HTTP server. Consider adding a fallback or documenting that HTTP server is required

## Known Issues

| Issue | Root Cause | Status |
|-------|-----------|--------|
| "hi" triggered web_search | Observe misclassified greeting as needing tools | Fixed (greeting guard) |
| Follow-up searched TV show instead of company | No conversation context awareness | Fixed (workspace) |
| "tno system sg" misclassified as follow-up | Follow-up detection too aggressive | Fixed (entity coverage ratio) |
| URL hallucination (tno-systems.com) | Gemma fabricated domain | Fixed (_validateUrl) |
| Malformed Decide JSON | Gemma outputs broken JSON | Fixed (_recoverToolPlan + _repairPlanArray) |
| "i see" triggered searches | Workspace injected old entities into safety override | Fixed (acknowledgment detection) |
| "my name is jinja" triggered TNO searches | Workspace overrode is_about_user | Fixed (CLASSIFY agent) |
| Multi-intent over-enrichment | Workspace entities triggered searches for all old entities | Fixed (CLASSIFY entity filter) |
| "remember mandarin" triggered web_search | Workspace entity leakage into Decide | Fixed (CLASSIFY agent) |
| Hardcoded regex classification | Greeting/command/ack used regex word lists | Fixed (replaced with CLASSIFY agent) |
| ~~Hardcoded _shortenQuery filler/stop words~~ | ~~Regex-based word removal in _shortenQuery~~ | **Structural — retained** (DECIDE prompt handles model-side) |
| ~~Hardcoded SKIP_EXT/SKIP_SITE in _pickBestUrl~~ | ~~Regex blocklists for URL filtering~~ | **Structural — retained** (file ext + domain are objective) |
| ~~Hardcoded GENERIC_WORDS in multi-intent~~ | ~~Blocklist for entity filtering~~ | **Fixed** (CLASSIFY `search_entities` field) |
| ~~Hardcoded language detection in _orient~~ | ~~String matching for mandarin/malay/japanese~~ | **Fixed** (CLASSIFY normalization + alias fallback) |
| Same URL fetched multiple times | No fetch dedup in _act() | Fixed (fetchedUrls Set) |
| _pickBestUrl selects homepage | No snippet relevance scoring | Fixed (_rankByRelevance + snippet sorting) |
| Topic switch contaminates DECIDE | OBSERVE summary carries old workspace topic; CLASSIFY cleans entities but not summary | Fixed (2-layer detection) |
| Deictic/reference follow-up missed | Layer 1 skipped workspace for "this field" (no entity overlap); Layer 2 reverted fix | Fixed (CLASSIFY is_reference + _wsContextAvailable) |
| Implicit contextual follow-up missed | "boss name?" not detected as needing previous context | Fixed (CLASSIFY is_reference enhanced prompt) |
| Multi-intent over-enrichment (generic words) | Short words like "companies" trigger nonsensical extra searches | Fixed (length + blocklist filter) |
| ~~Model fabrication from tangential results~~ | ~~Gemma fabricates connections (Tesla as QC leader) from loosely related search results~~ | **Fixed** (EVALUATE tangential mention filter — rule 8) |
| ~~Browser test: `rotateEveryN` default mismatch~~ | ~~index.html expects `5`, src/core.js changed default to `1`~~ | **Fixed** (test updated to `1`) |
| ~~Browser test: `maxOutputTokens` default mismatch~~ | ~~index.html expects `8192`, source removed it from GemmaAPI~~ | **Fixed** (test asserts `undefined`) |
| ~~`maxOutputTokens` remnant in `_decideSimplified`~~ | ~~`oodae-decide.js:167` still had `maxOutputTokens: 256`~~ | **Fixed** (removed) |
| dist/gemma_client.js stale | src/ modules modified but dist/ not rebuilt | Fixed (103.9kb) |
| ~~Implicit "the" reference not resolved~~ | ~~"what is the stock price?" after NVIDIA → CLASSIFY doesn't detect is_reference~~ | **Fixed** (CLASSIFY CHECK 6: "the" as implicit reference marker) |
| API Key #2 dead (403) | Key `AIza...k48` consistently returns 403 Forbidden; retry handles it but wastes a cycle | Open |
| chat.html CORS on file:// | `loadFromJSONL()` fetch fails with CORS when opened via file:// protocol; requires HTTP server | Open |
| ~~Token counter misleading~~ | ~~`estimateTokens()` only counts `S.chatHistory` text (~0.7K after 15 turns); ignores tool results, system prompts, OODA-E intermediate calls~~ | **Fixed** (`_callModel` captures `usageMetadata`, cumulative `S.sessionTokens`) |
| ~~Memory key granularity~~ | ~~"name is David and works at Microsoft" saved as single key~~ | **Fixed** (CLASSIFY save_pairs compound splitting + DECIDE multi-save) |
| ~~Search quality — niche source~~ | ~~"what is quantum computing?" → Tierkreis instead of Wikipedia~~ | **Fixed** (_pickBestUrl domain reputation scoring with preferredDomains) |
| ~~No conversation persistence~~ | ~~Page reload loses all chatHistory; only IndexedDB memories survive~~ | **Fixed** (auto-save to IndexedDB after each response; sessionTokens persisted; export/import UI) |
| ~~**TypeError: e.toLowerCase()**~~ | ~~CLASSIFY/OBSERVE return non-string entities (numbers, null); 10 crash sites across 4 files~~ | **Fixed** (String(e) coercion) |
| ~~**CLASSIFY: math follow-up → is_command**~~ | ~~"multiply that by 3" → is_command=true, memory_action=save (should be is_reference only)~~ | **Fixed** (is_reference blocks command path + CLASSIFY prompt) |
| ~~**Single "?" triggers follow-up**~~ | ~~Bare "?" re-triggers last workspace tool call; _resolveFromWorkspace needs punctuation filter~~ | **Fixed** (punctuation-only guard) |
| ~~**Direction loss after 3+ follow-ups**~~ | ~~"who is the CEO?" (3rd follow-up) → OBSERVE loses SIA context~~ | **Fixed** (root entity priority in `_resolveFromWorkspace`) |
| ~~**Back-reference query contamination**~~ | ~~"go back to SIA" → search "tesla stock price Singapore Airlines stock"~~ | **Fixed** (entity-matched topic resolution) |
| ~~**Pure text gen forces tool path**~~ | ~~"write email" → CLASSIFY is_command=true → requires_tools=true → web_search instead of fast-path text generation~~ | **Fixed** (CLASSIFY `is_task_request` field + orchestrator fast-path override) |
| ~~**Memory recall ignores non-user_profile categories**~~ | ~~"what is my name?" → user_name saved as category="user_info" → ORIENT only extracts category="user_profile" → name invisible to response~~ | **Fixed** (_orient includes all categories) |
| ~~**Greeting leaks personal memory**~~ | ~~"hello!" → response mentions "听说您的车是红色的"~~ | **Fixed** (`_directResponse` greeting guard) |
| ~~**P15: Semantic-drift hallucination**~~ | ~~"ZetaCorp Technologies" (fake) → answered about "Zeta Global" (real). Model maps unknown entity to similar-sounding real entity~~ | **Fixed** (EVALUATE prompt: exact entity name verification) |
| ~~**P16: Cat-name-as-user-name confusion**~~ | ~~"what is my name?" → "Xiaobai" (the cat). recall_memory returns pet name; no key-type disambiguation~~ | **Fixed** (_directResponse: pet key disambiguation + semantic matching) |
| ~~**P17: Info sharing misclassified as search**~~ | ~~"I am a software engineer in Shanghai" → web_search("software engineer job market Shanghai")~~ | **Fixed** (CLASSIFY `is_info_sharing` + orchestrator routing) |
| ~~**P18: Memory update creates duplicate keys**~~ | ~~"change sport to football" → creates `user_favorite_sport=football` instead of updating existing `favorite_sport=篮球`~~ | **Fixed** (`_findMatchingMemKey` + DECIDE existing keys) |
| ~~**P19: Conversation summary hallucination**~~ | ~~"summarize our conversation" → fabricates completely wrong content~~ | **Fixed** (_directResponse: includes chat history + anti-fabrication rule) |
| ~~**P20: Chinese back-reference "联盟" disambiguation**~~ | ~~"这个联盟还有哪些航空公司?" → searches 英雄联盟 instead of Star Alliance~~ | **Fixed** (DECIDE rule 12 + pronoun stripping harness) |
| ~~**P21: No auto language detection for replies**~~ | ~~All 30 turns of Chinese input → all responses in English~~ | **Fixed** (`_detectLanguage` + ORIENT fallback) |

## Test Flow

Canonical reference:

- `docs/testing-playbook.md` — current build/test/browser workflow, Chrome MCP procedure, clean-session rules, and sign-off matrix

Quick rules:

- Always run `npm run build` before trusting browser results
- Run `npm test` before closing substantial fixes
- For Chrome MCP runs, start from a clean conversation and confirm the intended mode first
- Treat some API-key `403` noise as non-fatal only if the client rotates keys and the run continues successfully

Standard regression test sequence:
```
1. hi                              → greeting, no tools
2. my name is jinja                → is_about_user, save_memory
3. tno system pte ltd              → new query, web_search
4. boss name?                      → follow-up (workspace), web_search
5. address?                        → follow-up (workspace), web_search
6. what time now? i want tno email → multi-intent (get_time + web_search)
7. boss name?                      → follow-up (workspace), should reuse cached
8. remember reply mandarin         → command, save_memory
```

## Browser E2E Tests (Chrome DevTools MCP — 2026-03-21)

Real browser tests via MCP Chrome DevTools against live Gemini API (Gemma 3 27B).

### Suite 1: Greetings (multi-language)
| Input | OBSERVE | CLASSIFY | Result | Status |
|-------|---------|----------|--------|--------|
| `hello` | intent=greeting, tools=false | is_greeting=true | "Hi there! 👋" — 0 tools, 2.33s | PASS |
| `你好` | intent=greeting, tools=false | is_greeting=true | Chinese greeting recognized, 0 tools, 6.58s | PASS |

### Suite 2: Memory & Personal Info
| Input | OBSERVE | CLASSIFY | DECIDE | Result | Status |
|-------|---------|----------|--------|--------|--------|
| `my name is Alex` | intent=info_sharing, is_about_user=true | entities=["Alex"] | save_memory(user_name=Alex) | Saved to user_info | PASS |
| `remember to reply me in mandarin` | intent=command | is_command=true, save_key=preferred_response_language | save_memory(reply_language=mandarin) | Preference saved, no web_search leakage | PASS |

### Suite 3: Tool Calling
| Input | Tools Used | Result | Status |
|-------|-----------|--------|--------|
| `what time is it now?` | get_time(Asia/Kuala_Lumpur) | "现在是 2026年3月21日 10:57" — replied in Mandarin (memory!) | PASS |
| `what is the latest news about OpenAI` | web_search(news) + fetch_url | 5 news results, fetched Yahoo Finance article, Chinese summary | PASS |

### Suite 4: Follow-up & Context
| Input | Context Resolution | Result | Status |
|-------|-------------------|--------|--------|
| `tell me about Tesla` | New query, entities=["Tesla"] | Chinese summary of Tesla Inc. | PASS |
| `who is the CEO?` | Workspace → follow_up(about: Tesla), search "Tesla CEO" | "Elon Musk 是 Tesla 的 CEO 和产品架构师" | PASS |

### Suite 5: Edge Cases
| Input | CLASSIFY | Result | Status |
|-------|----------|--------|--------|
| `i see` | is_acknowledgment=true | "好的，明白了。" — 0 tools, no Tesla search leakage | PASS |

### Suite 6: Office Worker — Multi-Intent (Fresh Session)
| Input | DECIDE Plan | Tools | Result | Status |
|-------|-------------|-------|--------|--------|
| `what time + 500 USD to MYR?` | get_time + exchange_rate | 2 | "11:07, 1969.75 MYR" in Mandarin, 3.96s | PASS |
| `AI news + KL weather?` | tech_news + get_weather | 2 | 5 HN stories + "29.8°C partly cloudy", 8.27s | PASS |

### Suite 7: Topic Switch — Boundary Test (After Tesla Conversation)
| Input | OBSERVE | CLASSIFY | DECIDE | Issue | Status |
|-------|---------|----------|--------|-------|--------|
| `what is quantum computing?` | "(about: Tesla)" | user_entities=["quantum computing"] ✓ | "Tesla quantum computing" ✗ | Summary leakage | FAIL |
| `companies leading in QC?` | "(about: Tesla)" | user_entities=["quantum computing","companies"] ✓ | "Tesla QC research" ✗ | Summary leakage + fabrication | FAIL |
| `how does a qubit work?` | "(about: Tesla)" | user_entities filtered ✓ | Accurate response despite contaminated search | Summary leakage (tolerable) | PARTIAL |

### Key Validations
- **CLASSIFY agent** correctly replaces all hardcoded regex for intent classification
- **Memory persistence** across turns: name saved → language preference saved → both recalled in later turns
- **Workspace follow-up**: "who is the CEO?" correctly resolves to Tesla context
- **Entity leakage prevention**: CLASSIFY filters workspace entities (language:mandarin, time) from user_entities
- **Acknowledgment guard**: "i see" doesn't trigger searches despite Tesla being in workspace
- **Language preference**: All responses after "remember mandarin" are in Chinese
- **Multi-intent tool selection**: Correctly pairs get_time+exchange_rate, tech_news+get_weather
- **Topic switch boundary**: CLASSIFY correctly filters entities but observation.summary leakage contaminates DECIDE

## Browser E2E Tests — Session 2 (Chrome DevTools MCP — 2026-03-21, 3:29 PM)

Live tests via HTTP server (`python -m http.server`), clean conversation, Tool Calling mode ON.

### Suite 8: Full Pipeline Regression (Fresh Session, via HTTP)
| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Time | Tokens | Status |
|---|-------|---------|----------|--------|--------|------|--------|--------|
| 1 | `hello` | greeting, tools=false | is_greeting=true | — | "你好！有什么我可以帮你的吗？" 0 tools | 1.45s | 196 | PASS |
| 2 | `what time is it now?` | question, tools=true | needs_tools=true | get_time(Asia/KL) | "现在是2026年3月21日15:30，星期六。时区是Asia/Kuala_Lumpur。" | 1.91s | 756 | PASS |
| 3 | `tell me about Tesla` | question, tools=true | needs_tools=true | web_search("Tesla") | Chinese summary of Tesla Inc. (Martin E., BEV, Elon Musk CEO) | 5.08s | 1368 | PASS |
| 4 | `what is quantum computing?` | question, entities=["quantum computing"] | user_entities=["quantum computing"] | web_search("quantum computing explanation") | Chinese QC summary, NO Tesla contamination | 3.10s | 1269 | **PASS** |
| 5 | `who are the leaders in this field?` | follow_up, entities=["quantum computing"] | is_reference=true | web_search("leading figures quantum computing") + web_search("leading organizations quantum computing") | D-Wave, IonQ, Rigetti — correct QC leaders, no Tesla | 7.57s | 5831 | **PASS** |
| 6 | `i see` | follow_up, tools=false | is_acknowledgment=true | — | "好的，明白了。有什么我可以帮你的吗？" 0 tools | 1.57s | 197 | PASS |

### Key Findings — Session 2
- **Topic switch: FIXED** — "what is quantum computing?" after Tesla produces clean QC response with NO Tesla contamination (was FAIL in Session 1)
- **Deictic follow-up: WORKING** — "leaders in this field?" correctly resolves to quantum computing via CLASSIFY `is_reference=true` + workspace entity injection
- **Acknowledgment guard: WORKING** — "i see" triggers 0 tools despite QC and Tesla in workspace
- **Memory recall: WORKING** — All responses in Mandarin (recalled from IndexedDB `reply_language=mandarin`)
- **Key rotation: WORKING** — Keys rotate correctly across turns (Key #5 → #10 → #4 → #9 → #3)
- **API Key #2 dead** — Key `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` returns 403 on every use (3x during session); `fetchWithRetry` auto-retries with next key, no user-visible error
- **chat.html file:// CORS** — Opening chat.html via `file://` protocol fails to load API keys (CORS blocks fetch of gemma_code.jsonl); works fine via HTTP server

## Browser E2E Tests — Session 3 (Chrome DevTools MCP — 2026-03-21, ~4:30 PM)

Live tests via HTTP server, clean session, Tool Calling mode ON. Focus: math/number entities, edge cases, new bugs.

### Suite 9: Number Entities, Math Follow-up, Edge Cases (Fresh Session, via HTTP)
| # | Input | OBSERVE | CLASSIFY | DECIDE | Result | Time | Tokens | Status |
|---|-------|---------|----------|--------|--------|------|--------|--------|
| 1 | `what is 15 + 27?` | question, tools=true | needs_tools=true, entities=["15","27"] | calculate(15+27) | "15 + 27 = 42" in Mandarin | 3.27s | 626 | PASS |
| 2 | `multiply that by 3` | follow_up | **is_command=true** ✗ (should be is_reference=true) + is_reference=true | calculate((15+27)*3) | "126" — correct result despite CLASSIFY misclass | 6.81s | 627 | **PASS (with CLASSIFY bug)** |
| 3 | `what is the latest AI news?` | question, tools=true | user_entities=["AI news"] | web_search + fetch_url | 5 news items in Mandarin, clean topic switch | 5.88s | 1555 | PASS |
| 4 | `weather in Tokyo?` | question, tools=true | user_entities=["Tokyo","weather"] | get_weather(Tokyo) | "14.1°C, clear" in Mandarin, clean topic switch | 3.79s | 745 | PASS |
| 5 | `😊 你好啊！今天心情好` | greeting, tools=false | is_greeting=true | — | Chinese greeting, 0 tools | 1.55s | 203 | PASS |
| 6 | `?` | follow_up (workspace→Tokyo) | needs_tools=true | get_weather(Tokyo) | Re-triggered Tokyo weather (6.48s wasted) | 6.48s | 741 | **BOUNDARY** |

### Key Findings — Session 3
- **Math follow-up: WORKING** — "multiply that by 3" correctly produces `calculate((15+27)*3) = 126` despite CLASSIFY misclassification
- **CLASSIFY bug: is_command false positive** — "multiply that by 3" → `is_command=true, memory_action=save, save_key=last_number, save_value=3`. DECIDE recovers via `is_reference=true` override, but ORIENT sets wrong `memory_action=save`
- **Single "?" boundary** — bare "?" after weather query re-triggers `get_weather(Tokyo)` (6.48s wasted). `_resolveFromWorkspace` should filter single-punctuation inputs
- **Emoji greeting: WORKING** — `😊 你好啊！今天心情好` correctly classified as greeting
- **Topic switches: ALL CLEAN** — math → AI news → Tokyo weather, no contamination
- **TypeError NOT triggered in browser** — dist/gemma_client.js is stale (lacks Layer 2 code). Confirmed crash in Node.js live tests only
- **Key rotation: WORKING** — Keys #3→#4→#5→#7→#9→#1→#3→#4→#9

## Browser E2E Tests — Session 4 (Chrome DevTools MCP — 2026-03-21, ~6:33 PM)

Live tests via HTTP server (port 8765), clean conversation (Clear button), Tool Calling mode ON, Gemma 3 27B. **Focus: long conversation flow, memory recall, back-reference, topic switch, multi-intent, text generation.**

### Suite 10: Long Conversation Flow (9-Step Browser E2E)
| # | Input | OBSERVE | CLASSIFY/ORIENT | Tools Used | Result | Time | Tokens | Status |
|---|-------|---------|-----------------|------------|--------|------|--------|--------|
| 1 | `hello!` | greeting, tools=false | is_greeting=true, ORIENT: 3 memories loaded | 0 | "你好！...听说您的车是红色的" ⚠️ memory leak in greeting | 2.24s | 208 | **PASS (minor issue)** |
| 2 | `I work at Google` | info_sharing, is_about_user=true | CLASSIFY: memory_action=null ⚠️; ORIENT: memory_action=save ✓ | save_memory(user_employer=Google) | "我记住了，您在 Google 工作。" | 1.81s | 637 | PASS |
| 3 | `tell me about Singapore Airlines` | question, tools=true, entities=["Singapore Airlines"] | needs_tools=true | web_search + fetch_url | Comprehensive SIA summary (Skytrax 5-star, 163 aircraft, Temasek 53%) | 10.16s | 1692 | PASS |
| 4 | `how many planes do they have?` | follow_up, tools=true | is_reference=true | web_search("Singapore Airlines number planes") + fetch_url | "155架飞机，或者158架飞机（截至2026年1月）" | 2.16s | 1830 | PASS |
| 5 | `tell me about Tesla stock price` | question, tools=true, entities=["Tesla"] | needs_tools=true | web_search("Tesla stock price") + fetch_url | TSLA $367.96, -$12.34 (-3.24%), Yahoo Finance data | 220.96s ⚠️ | 1304 | **PASS (slow)** |
| 6 | `go back to Singapore Airlines, stock price?` | follow_up | is_reference=true | web_search(**"Tesla stock price Singapore Airlines stock"** ⚠️) + fetch_url | "Singapore Airlines Ltd (C6L)...但具体股价没有直接给出" | 1.95s | 1407 | **PARTIAL (P12 confirmed)** |
| 7 | `what is my name?` | question, is_about_user=true | needs_tools=false, fast path | 0 (no recall_memory!) | **"我目前没有关于您名字的信息"** ❌ despite user_name=Alex in IndexedDB | 1.57s | — | **FAIL (P14 new bug)** |
| 8 | `what time is it? also calculate 15% of 280` | question, tools=true | needs_tools=true | get_time + calculate (parallel) | "2026年3月21日18:56" + "42" — both correct | 2.00s | — | PASS |
| 9 | `write me a short poem about the moon` | command, tools=true | is_command=true ⚠️ | web_search("short poem moon") + fetch_url(poetrysoup.com) ⚠️ | Chinese poem (translated from PoetrySoup, not original) | 4.76s | 1576 | **PASS (P13 confirmed)** |

### Key Findings — Session 4

#### New Bug: P14 — Memory Recall Category Mismatch (HIGH)

**Reproduction:** Ask "what is my name?" when `user_name=Alex` exists in IndexedDB.

**Symptom:** Agent responds "我目前没有关于您名字的信息" despite the memory existing. It correctly recalls `user_car_color` (red) and `user_employer` (Google) but NOT `user_name` (Alex).

**Root cause:** ORIENT phase extracts `user_profile` object ONLY from entries with `category="user_profile"`. The `user_name` was saved with `category="user_info"` — ORIENT ignores it.

| Memory Key | Category | ORIENT Extracts? |
|-----------|----------|-----------------|
| reply_language=mandarin | user_preferences | ❌ No (but language detected separately) |
| user_car_color=red | **user_profile** | ✅ Yes |
| user_employer=Google | **user_profile** | ✅ Yes |
| user_name=Alex | **user_info** | ❌ **No — invisible to response generation!** |

**Fix needed:** ORIENT's `user_profile` extraction should include ALL user-related categories (`user_info`, `user_profile`, `user_preferences`), or the response prompt should inject `all_memories` instead of just `user_profile`.

#### Confirmed Existing Bugs

1. **P12 — Back-reference entity pollution** — Network request shows search query `"Tesla stock price Singapore Airlines stock"` — old Tesla entities pollute the SIA query. Response partial: found C6L ticker but no actual price.

2. **P13 — Pure text gen forces tool path** — "write me a short poem" triggers `web_search("short poem moon")` + `fetch_url(poetrysoup.com)`. Agent translates existing poems instead of generating original content.

3. **Dead API Key #8** — `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` returned 403 four times during session (reqid 18, 31, 44, 54). Key rotation auto-retries correctly.

#### Minor Issues

- **Greeting memory leak (Step 1):** Agent proactively mentions "听说您的车是红色的" in greeting — user only said "hello!", should not volunteer personal data
- **CLASSIFY misses memory_action (Step 2):** CLASSIFY returned `memory_action=null` for "I work at Google" but ORIENT compensated via `is_about_user=true` → `memory_action=save`
- **Tesla query slow (Step 5):** 220.96s — likely fetch_url hitting slow/paywalled content

#### Strengths Confirmed (Browser)

| Capability | Evidence | Rating |
|-----------|---------|--------|
| Greeting fast path | Step 1: 0 tools, 0 iterations, 2.24s | HIGH |
| Memory save (user_profile) | Step 2: save_memory(user_employer=Google) | HIGH |
| Web search + fetch | Step 3: Comprehensive SIA data, 1692 tokens | HIGH |
| Follow-up context (depth 1) | Step 4: "they" → SIA, search "SIA number planes" | HIGH |
| Topic switch (clean) | Step 5: Tesla search, no SIA contamination | HIGH |
| Multi-intent (parallel tools) | Step 8: get_time + calculate in parallel, both correct | HIGH |
| Activity panel & Debug inspector | All phases visible, debug JSON expandable, Memory tab shows IndexedDB | HIGH |
| Key rotation + 403 retry | Dead key auto-skipped, no user-visible error | HIGH |
| IndexedDB persistence | Memories persist across Clear/reload | HIGH |

#### Network Analysis Summary
- **Total requests:** 52 (43 Gemini API + 4 search + 4 fetch_url + 1 timeapi)
- **API success rate:** 39/43 (90.7%) — 4 failures all from dead Key #8
- **Search endpoints:** `search.yapweijun1996.com` (SearXNG proxy), `readurl.b1122333.com` (URL reader), `timeapi.io`
- **No application-level JS errors** — all console errors are 403s (dead key) or Chrome DevTools internal

## Browser E2E Tests — Session 5 (30-Turn Long Conversation — 2026-03-21, ~7:25-7:50 PM)

Live tests via HTTP server (port 8765), **clean IndexedDB**, Tool Calling mode ON, **Gemma 3 27B only**. Focus: **memory storage/recall, hallucination, context loss, tool calling, memory update**.

**Build:** `npm run build` (75.3kb, rebuilt before test with latest src including P14 ORIENT fix)

### Suite 11: 30-Turn Long Conversation (6-Phase Browser E2E)

#### Phase 1: 记忆力 — 存储5个事实 (Turns 1-5)
| # | Input | Expected | Actual | Memory Saved? | Status |
|---|-------|----------|--------|---------------|--------|
| 1 | 你好，我叫李明，请记住我的名字 | save_memory(user_name=李明) | "I will remember your name" (English) | ❌ **NOT saved** | **FAIL** |
| 2 | 我是软件工程师，在上海工作 | save_memory(user_job=...) | Searched for "software engineer job market Shanghai" ❌ | ❌ **NOT saved** — misclassified as search query | **FAIL** |
| 3 | 请帮我记住：我最喜欢的运动是篮球 | save_memory(favorite_sport=篮球) | "I have saved your favorite sport" | ✅ favorite_sport=篮球 (user_preferences) | PASS |
| 4 | 我养了一只猫叫小白，请保存到记忆 | save_memory(cat_name=小白) | "Saved: cat + cat_name" | ✅ user_cat=true + cat_name=小白 (2 entries) | PASS |
| 5 | 记住我的生日是3月15日 | save_memory(user_birthday=3月15日) | "Saved your birthday" | ✅ user_birthday=3月15日 (user_info) | PASS |

**Phase 1 Score: 3/5** — Name and job not saved. Category chaos: 4 different categories (user_preferences, pet, user_info, user_profile).

#### Phase 2: 记忆召回 + 更新 (Turns 6-10)
| # | Input | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 6 | 我叫什么名字？ | "李明" | **"Your name is Xiaobai"** ❌ — confused cat name for user name | **FAIL — CRITICAL** |
| 7 | 你记得我的哪些信息？全部列出 | All 5 facts | Listed 4: cat, sport, birthday, has_cat. Missing: name, job | **PARTIAL** |
| 8 | 不对！我叫李明，请更新名字 | update user_name | "Updated user_name=李明" + created user_not_xiaobai 🤦 | PASS (with noise) |
| 9 | 运动改成足球了，请更新 | update favorite_sport | "Updated to football" — but created NEW key user_favorite_sport instead of updating favorite_sport | **PARTIAL** — duplicate key |
| 10 | 告诉我你记得的所有信息 | All memories | **"I do not remember any information about you"** ❌ | **FAIL — CRITICAL** |

**Phase 2 Score: 1/5** — Turn 6 cat-name-as-user-name is catastrophic. Turn 10 total recall failure despite 7 memories in DB.

**Root cause (Turn 10):** MemoryDB.open() returned stale DB connection pointing to wrong database. ORIENT called getAllMemories() → got empty array → "no information". This is partly a test environment artifact (DB name patching) but also exposes: **MemoryDB.open() lacks connection validation** — if _db is set, it returns without verifying the connection is still valid.

#### Phase 3: 工具调用 (Turns 11-15)
| # | Input | Tool(s) Used | Result | Status |
|---|-------|-------------|--------|--------|
| 11 | 计算 (125*37)+(89/4) | calculate | 4647.25 ✅ | **PASS** |
| 12 | 现在几点了？ | get_time(Asia/Kuala_Lumpur) | 7:38 PM ✅ | **PASS** |
| 13 | 新加坡的人口是多少？ | country_info(Singapore) | 6,110,200 ✅ | **PASS** |
| 14 | 东京几点？算15%的2800 | get_time(Tokyo) + calculate — **parallel** | 8:39 PM + 420 ✅ | **PASS** |
| 15 | 上海天气怎么样？ | geocode(上海) + get_weather | 10.4°C, mainly clear ✅ | **PASS** |

**Phase 3 Score: 5/5** — All tools work correctly, including parallel multi-tool execution.

#### Phase 4: 幻觉测试 (Turns 16-19)
| # | Input | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 16 | 苹果公司现在的CEO是谁？ | Tim Cook | Tim Cook, since 2011 ✅ | **PASS** |
| 17 | ZetaCorp Technologies总部在哪？ | "I cannot find this company" | **Answered about "Zeta Global" (real company)** — semantic drift hallucination | **FAIL — hallucination** |
| 18 | 我之前告诉你我住在哪个城市？ | "上海" (from chat history) | "I don't recall" — honest but wrong (we said 上海 in Turn 2) | **MIXED** |
| 19 | 地球到月球距离？ | ~384,400 km | ~384,000 km ✅ | **PASS** |

**Phase 4 Score: 2.5/4** — Turn 17 semantic-drift hallucination is a new pattern (P15): model maps unknown entity to similar-sounding real entity instead of admitting ignorance.

#### Phase 5: 迷路测试 (Turns 20-27)
| # | Input | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 20 | 新加坡航空是哪个联盟的成员？ | Star Alliance | Star Alliance ✅ | **PASS** |
| 21 | 这个联盟还有哪些航空公司？ | Star Alliance members | **Mixed up "联盟" → "英雄联盟" (League of Legends)** then partially corrected | **FAIL — P12 variant** |
| 22 | 比特币现在多少钱？ | BTC price | $70,598 ✅ | **PASS** |
| 23 | 以太坊呢？ | ETH price (follow-up) | $2,156.08 ✅ | **PASS** |
| 24 | 回到新加坡航空，多少架飞机？ | SIA fleet size | 158 aircraft (146 pax + 12 freighters) ✅ | **PASS** |
| 25 | 他们用什么型号飞机？ | Fleet models (depth-3) | "Boeing 747-400F" only — incomplete | **PARTIAL** |
| 26 | 你还记得我的猫叫什么吗？ | "小白" (from memory) | **"I don't remember"** ❌ | **FAIL — P14** |
| 27 | BTC和ETH差多少？帮我算 | Re-fetch + calculate | $68,446.06 ✅ | **PASS** |

**Phase 5 Score: 4.5/8** — Topic jumps mostly work, but: Chinese back-reference "联盟" causes LOL contamination (Turn 21); depth-3 follow-up incomplete (Turn 25); memory recall fails again (Turn 26).

#### Phase 6: 综合压力 (Turns 28-30)
| # | Input | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 28 | 请总结我们今天聊了哪些话题 | List all topics | **"We discussed how to respond to your Chinese requests in English"** ❌ — complete fabrication | **FAIL — hallucination** |
| 29 | 上海今天适合打篮球吗？ | Weather + basketball context | 10.4°C, mainly clear, consider wind ✅ | **PASS** |
| 30 | 告诉我你记得关于我的所有信息 | All memories (name, job, sport, cat, birthday) | **"I do not remember any information about you"** ❌ | **FAIL — P14** |

**Phase 6 Score: 1/3**

### Session 5 Summary

**Overall: 16.5/30 (55%)** — Tool calling strong, memory system critically broken.

| Category | Score | Grade |
|----------|-------|-------|
| 记忆存储 (save) | 3/5 (60%) | D |
| 记忆召回 (recall) | 0/5 (0%) | **F** |
| 记忆更新 (update) | 1/3 (33%) | F |
| 工具调用 (tools) | 5/5 (100%) | **A+** |
| 幻觉 (hallucination) | 2.5/4 (63%) | C |
| 迷路 (context loss) | 4.5/8 (56%) | D |

### New Bugs Found — Session 5

| ID | Bug | Severity | Evidence |
|----|-----|----------|----------|
| **P15** | **Semantic-drift hallucination** — fake entity mapped to similar real entity | HIGH | Turn 17: "ZetaCorp Technologies" → answered about "Zeta Global" |
| **P16** | **Cat-name-as-user-name confusion** — recall_memory returns pet name when asked for user name | HIGH | Turn 6: "Your name is Xiaobai" (Xiaobai is the cat) |
| **P17** | **Info sharing misclassified as search** — "I am a software engineer in Shanghai" triggers web_search for job listings | MEDIUM | Turn 2: searched "software engineer job market Shanghai" |
| **P18** | **Memory update creates duplicate keys** — sport preference updated as new key instead of overwriting | LOW | Turn 9: created user_favorite_sport instead of updating favorite_sport |
| **P19** | **Conversation summary hallucination** — fabricates conversation topics | HIGH | Turn 28: "We discussed how to respond to Chinese requests in English" |
| **P20** | **Chinese back-reference "联盟" disambiguation failure** — "this alliance" mapped to "League of Legends" | MEDIUM | Turn 21: 联盟 → 英雄联盟 (LOL) instead of Star Alliance |
| **P21** | **All responses in English despite Chinese input** — no reply_language auto-detection in clean DB | MEDIUM | All 30 turns: responses in English |

### Confirmed Existing Bugs
- **P14** — Memory recall failure: ORIENT gets empty memory array → "no information about you" (Turns 10, 26, 30)
- **Dead Key #8** — `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` returned 403 seventeen times. Key rotation auto-retries correctly.

### Design Recommendations (from Session 5)

1. **AGENTS.md / ROLES.md** — User-suggested persona system:
   - AGENTS.md: System prompt control (tool rules, memory classification standards, language rules)
   - ROLES.md: Persona definition (role, style, behavior boundaries)
   - Would fix P17 (classification rules), P21 (language default), P19 (conversation awareness)

2. **Memory key naming convention** — Enforce consistent key prefixes (user_, pref_, fact_) and category enum
3. **MemoryDB.open() connection validation** — Verify _db connection is still valid before returning cached reference
4. **Reply language auto-detection** — Detect input language in OBSERVE and set default reply_language without needing a memory entry

### Network Analysis — Session 5
- **Total HTTP requests:** 189
- **Gemini API calls:** ~160 (10 keys × rotateEveryN=1)
- **403 failures:** 17 (all Key #8 `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48`)
- **API success rate:** ~89.4%
- **Tool endpoints used:** SearXNG (8), readurl (8), timeapi (2), CoinGecko (4), restcountries (1), nominatim (2), open-meteo (2)
- **Average response time:** ~12.5s per turn (range: 8.5s–26.5s)

### Node.js Live Test — TypeError Crash (confirmed)
```
Test: Follow-up — context retention
  "what is 15 + 27?" → calculate(15+27) → 42 ✓
  "multiply that by 3" → CLASSIFY returns user_entities: [3] (number, not string)
  → oodae.js:105 — classification.user_entities.map(e => e.toLowerCase())
  → TypeError: e.toLowerCase is not a function
  → OODA-E falls back to ToolRunner (try/catch in run())
```

## Long Conversation Flow Test (Node.js E2E — 2026-03-21)

12-step continuous conversation, shared chatHistory, real Gemini API. Tests context retention, direction loss, tool discipline, topic switching, back-reference, and skill progression.

**Run:** `npm run test:longconv` | **Result: 52/52 PASS** | **Duration: 309.63s**

### Test Flow
```
 Step 1:  "hello!"                            → greeting, fast path (0 tools)
 Step 2:  "my name is alex"                   → save_memory, no web_search
 Step 3:  "tell me about singapore airlines"  → Topic A, web_search
 Step 4:  "how many planes do they have?"     → follow-up #1 (SIA context)
 Step 5:  "what routes do they fly?"          → follow-up #2 (still SIA)
 Step 6:  "who is the CEO?"                   → follow-up #3 (direction-loss test)
 Step 7:  "tell me about tesla stock price"   → Topic B SWITCH (no SIA leak)
 Step 8:  "what about their latest earnings?" → follow-up on Topic B (Tesla)
 Step 9:  "go back to SIA, what about stock?" → back-reference to Topic A
 Step 10: "write me a professional email..."  → pure text generation
 Step 11: "what time? also 15% of 280?"       → multi-intent (get_time + calculate)
 Step 12: "what's my name?"                   → memory recall after 10+ turns
```

### Step Results
| Step | Input | Intent | Tools | Key Assertion | Time | Status |
|------|-------|--------|-------|---------------|------|--------|
| 1 | "hello!" | greeting | 0 | fast path, 0 iterations | 15.36s | PASS |
| 2 | "my name is alex" | info_sharing | save_memory | name saved, no web_search | 28.94s | PASS |
| 3 | "singapore airlines" | question | web_search + fetch_url | search "Singapore Airlines" | 32.35s | PASS |
| 4 | "how many planes?" | follow_up | web_search + fetch_url | search "Singapore Airlines number planes" | 17.89s | PASS |
| 5 | "what routes?" | follow_up | web_search + fetch_url (×3 loops) | search "Singapore Airlines routes" | 58.37s | PASS |
| 6 | "who is the CEO?" | **question** | web_search + fetch_url | **searched generic "CEO"** (lost SIA context) | 9.50s | **PASS (quality issue)** |
| 7 | "tesla stock price" | question | web_search + fetch_url | search "tesla stock price", no SIA leak | 23.03s | PASS |
| 8 | "their latest earnings?" | follow_up | web_search + fetch_url (×3 loops) | search "tesla earnings" | 42.10s | PASS |
| 9 | "go back to SIA, stock?" | follow_up | web_search + fetch_url (×3 loops) | **query: "tesla stock price Singapore Airlines stock"** (contaminated) | 32.51s | **PASS (quality issue)** |
| 10 | "write email declining..." | command | web_search + fetch_url | **used web_search for pure text gen** (defensible) | 19.07s | PASS |
| 11 | "time? 15% of 280?" | question | get_time + calculate | both intents, answer=42 | 16.13s | PASS |
| 12 | "what's my name?" | question | recall_memory | recalled "alex" after 10 turns | 14.36s | PASS |

### Key Findings — Long Conversation Test

#### Issues Found

1. **Direction loss after 3 follow-ups (Step 6)** — HIGH
   - "who is the CEO?" after 3 turns about SIA → OBSERVE classified as `intent=question` with `entities=[CEO]` instead of follow-up
   - Searched generic "CEO" → got Investopedia definition of what a CEO is
   - **Root cause**: By Step 6, workspace topic chain depth causes OBSERVE to lose connection to SIA. CLASSIFY also returned `entities=[CEO]` without SIA context
   - **Impact**: User gets wrong answer (generic CEO definition instead of SIA CEO name)

2. **Back-reference query contamination (Step 9)** — HIGH
   - "go back to singapore airlines" → search "tesla stock price Singapore Airlines stock"
   - OBSERVE inherited `entities=[tesla stock price, earnings, Singapore Airlines stock]` — old Tesla entities pollute the query
   - Response: "The provided information only contains data about Tesla stock" — factual failure
   - **Root cause**: Workspace entity chain accumulates ALL entities from prior topics; DECIDE doesn't filter old-topic entities from search query

3. **Pure text gen uses web_search (Step 10)** — MEDIUM
   - "write me a professional email" → CLASSIFY flagged `is_command=true` → DECIDE chose web_search("professional email declining meeting")
   - Response is based on search results (template from themuse.com) rather than agent's own text generation
   - **Root cause**: `is_command=true` always sets `requires_tools=true`, even for text generation tasks that don't need tools

4. **maxLoops exhaustion (Steps 5, 8, 9)** — LOW
   - 3 steps hit the maxLoops=3 ceiling, forced final answer via `_forceFinalAnswer`
   - Step 5: 3 loops searching SIA routes (site content was login-walled)
   - Step 8: 3 loops searching Tesla earnings (paywalled financial data)
   - Step 9: 3 loops with contaminated query (never found SIA stock data)

#### Strengths Confirmed

| Capability | Evidence | Rating |
|-----------|---------|--------|
| Greeting fast path | Step 1: 0 tools, 0 iterations | HIGH |
| is_about_user guard | Step 2: save_memory, no web_search leak | HIGH |
| Follow-up #1 | Step 4: search "SIA number planes" | HIGH |
| Follow-up #2 | Step 5: search "SIA routes" (sustained context) | HIGH |
| Topic switch | Step 7: clean Tesla search, no SIA contamination | HIGH |
| Topic B follow-up | Step 8: Tesla earnings, no SIA leak | HIGH |
| Multi-intent | Step 11: get_time + calculate both executed, answer=42 | HIGH |
| Memory recall (10+ turns) | Step 12: recall_memory → "alex" | HIGH |
| No user context leak | Steps 3-12: "alex" never appears in search queries | HIGH |

## Browser E2E Tests — Session 6 (15-Turn Long-Run — 2026-03-21, ~9:00 PM)

Live tests via HTTP server (port 8765), Tool Calling mode ON, Gemma 3 27B. **Focus: long-run multi-turn stress test — follow-up depth 3+, topic switch, back-reference, multi-intent, text gen, memory recall, acknowledgment guard, ambiguous input.**

**Build:** dist/gemma_client.js rebuilt with P11-P21 fixes.

### Suite 12: 15-Turn Long-Run Stress Test

| # | Input | Tools | Result | Time | Tokens | Status |
|---|-------|-------|--------|------|--------|--------|
| 1 | `hello!` | 0 | "你好！有什么我可以帮你的吗？" | 1.40s | 308 | PASS |
| 2 | `my name is David and I work at Microsoft` | save_memory(user_info) | "David 在 Microsoft 工作" — saved as combined key | 2.16s | 758 | PASS |
| 3 | `tell me about NVIDIA` | web_search | NVIDIA Corp summary (NASDAQ: NVDA, 1993, Jensen Huang) | 5.63s | 2019 | PASS |
| 4 | `what is their stock price?` | web_search | NVDA $174.90, follow-up resolved to NVIDIA | 9.07s | 1391 | PASS |
| 5 | `who is the CEO?` | web_search | Jensen Huang (黃仁勳), follow-up depth 2 | 2.33s | 1512 | PASS |
| 6 | `how many employees do they have?` | web_search | 42,000 employees (Jan 2026), **depth 3 follow-up** | 2.45s | 2367 | **PASS — P11 fixed** |
| 7 | `what is quantum computing?` | web_search | QC explanation (no NVIDIA contamination) | 5.13s | 1782 | PASS |
| 8 | `go back to NVIDIA, what are their latest products?` | web_search | RTX 50/40 series, DGX — **no QC contamination** | 6.94s | 1666 | **PASS — P12 fixed** |
| 9 | `what time is it now? and calculate 15% of 2800` | get_time + calculate | 20:59 + 420, parallel execution | 2.34s | 485 | PASS |
| 10 | `write me a short professional email declining a meeting` | web_search + fetch_url ⚠️ | Email written but used tools unnecessarily | 2.21s | 1590 | **BUG — P13 still broken** |
| 11 | `what is my name?` | recall_memory | "您的名字是 David" — combined key recall works | 1.32s | 991 | **PASS — P14 fixed** |
| 12 | `what is my name?` (retry) | recall_memory | "您的名字是 David" — consistent | 1.25s | 996 | PASS |
| 13 | `ok thanks, where do I work?` | recall_memory | "您在 Microsoft 工作" — combined key recall | 1.69s | 995 | PASS |
| 14 | `ok, I see. thanks!` | 0 | "不客气！如果有其他问题随时问我。" — acknowledgment guard | 2.46s | 924 | PASS |
| 15 | `hmm 🤔` | 0 | "有什么我可以帮您的吗？" — ambiguous input handled | 1.35s | 860 | PASS |

**Score: 14/15 PASS** (1 known bug — P13)

### Key Findings — Session 6

#### Previously Fixed Bugs — Confirmed Working
| Fix | Turn | Evidence |
|-----|------|----------|
| **P11** Direction loss at depth 3+ | Turn 6 | "how many employees?" → NVIDIA (42,000) at follow-up depth 3 |
| **P12** Back-reference entity pollution | Turn 8 | "go back to NVIDIA" → clean NVIDIA-only results, no quantum computing contamination |
| **P14** Memory recall category mismatch | Turns 11-13 | recall_memory correctly found `user_info` key across categories |
| Greeting memory leak | Turn 1 | 0 tools, no false save_memory triggered |
| Acknowledgment guard | Turn 14 | 0 tools for "ok, I see. thanks!" |
| Multi-intent parallel execution | Turn 9 | get_time + calculate ran in parallel (2.34s total) |

#### Bugs Found

1. **P13: Text gen forces tool path — STILL BROKEN** (HIGH)
   - Turn 10: "write email" → CLASSIFY returns `is_command: true` → forces tool path → web_search("professional email declining meeting invitation") + fetch_url
   - OODA-E pipeline: 1 loop, 2 tools (should be 0 tools via fast path)
   - **task.md line 60 marks this as "Fixed" but it's still broken in browser**
   - Possible cause: `dist/gemma_client.js` stale, or CLASSIFY prompt still misclassifying imperative text generation as command

2. **Token counter misleading** (MEDIUM)
   - Shows `~0.7K tokens` after 15 turns (2,500+ chars in chatHistory)
   - `estimateTokens()` only counts final response text in `S.chatHistory`, ignoring tool results, system prompts, OODA-E intermediate API calls
   - Risk: `COMPACT_THRESHOLD = 99K` may never trigger because estimate is drastically low
   - Root cause: [chat_app.js:141-148](chat_app.js#L141-L148) — `estimateTokens()` only iterates `msg.parts[].text`

3. **Memory key granularity** (LOW)
   - "my name is David and I work at Microsoft" → saved as single key `user_info="David works at Microsoft"` instead of separate `user_name` + `user_employer`
   - Recall still works (Turns 11, 13) but makes targeted updates harder

4. **Search quality — niche source selection** (LOW)
   - Turn 7: "what is quantum computing?" → response about Tierkreis (arXiv framework paper) instead of Wikipedia/educational content
   - `_pickBestUrl` chose niche academic paper over popular sources

5. **Wrong memory_action for text gen** (LOW)
   - Turn 10 activity panel shows `memory_action: save` for email writing request — should be `none`

#### Risks Identified

| Risk | Severity | Description |
|------|----------|-------------|
| Context token underestimation | **HIGH** | `estimateTokens()` shows ~0.7K but actual API usage much higher. Compaction at 99K may never trigger. |
| Stale dist/ bundle | **HIGH** | P13 fix in src/ not reflected in dist/gemma_client.js. Need `npm run build`. |
| No conversation persistence | **MEDIUM** | Page reload loses all chatHistory. Only IndexedDB memories survive. |

#### Performance Summary
- **Console errors: 0** (clean run across all 15 turns)
- **Average response time: 3.04s** (range: 1.25s–9.07s)
- **Fastest: 1.25s** (memory recall, Turn 12)
- **Slowest: 9.07s** (web search with fetch_url, Turn 4)
- **All responses in Mandarin** (P21 auto-detection working)

## Browser E2E Tests — Session 7 (9-Turn Regression — 2026-03-21, ~10:00 PM)

Live tests via HTTP server (port 8765), Tool Calling mode ON, Gemma 3 27B. **Focus: verify engineer's P13 + token counter fixes, regression test all prior fixes.**

**Build:** dist/gemma_client.js rebuilt with P13 (is_task_request) + token counter fixes.

### Suite 13: 9-Turn Regression Test

| # | Input | Tools | Result | Time | Tokens | Status |
|---|-------|-------|--------|------|--------|--------|
| 1 | `hello!` | 0 | "你好！有什么我可以帮你的吗？" | 1.50s | 1,726 | PASS |
| 2 | `I am a software engineer in Shanghai` | web_search ⚠️ | Searched salary info instead of saving | 6.58s | 4,968 | **FAIL — P17** |
| 3 | `tell me about Tesla` | web_search + fetch_url | Tesla summary in Mandarin, no Shanghai contamination | 5.85s | 4,818 | PASS |
| 4 | `who is the CEO?` | recall_memory → web_search + fetch_url | "Elon Musk 是 Tesla 的 CEO 和产品架构师" (2 loops) | ~20s | 7,637 | **PARTIAL** |
| 5 | `write me a short poem about the moon` | 0 | Chinese poem (皎洁的月亮...) — **fast path!** | 2.08s | 2,368 | **PASS — P13 fixed** |
| 6 | `what is my name?` | recall_memory ×3 | "我不知道你的名字" — recall_memory found 0 | ~20s | 9,600 | **FAIL — P14** |
| 7 | `ok thanks` | 0 | "不客气！...David 在 Microsoft 工作" — ack guard works | 2.6s | 2,368 | PASS |
| 8 | `tell me more about Tesla` | web_search + fetch_url | Tesla summary in Mandarin, no contamination | ~12s | 5,100 | PASS |
| 9 | `what is quantum computing?` | web_search + fetch_url | QC explanation in Mandarin, no Tesla leak | ~10s | 5,400 | PASS |

**Score: 6/9 PASS, 1 PARTIAL, 2 FAIL**

### Key Findings — Session 7

#### Verified Fixed
| Fix | Turn | Evidence |
|-----|------|----------|
| **P13** Text gen fast path | Turn 5 | `is_task_request: true` → 0 loops, 0 tools, 2.08s. **CONFIRMED FIXED.** |
| **Token counter** | All turns | Shows actual API tokens (1.7K→11.5K→44.2K cumulative). No `~` prefix. |
| **Greeting memory leak** | Turn 1 | 0 tools, no David/Microsoft mention despite memories in DB |
| **Topic switch Layer 1** | Turns 3, 9 | Tesla query had no Shanghai contamination; QC query had no Tesla leak |
| **Acknowledgment guard** | Turn 7 | `is_acknowledgment: true` → 0 loops, 0 tools |
| **P21 auto-detect language** | All turns | All responses in Mandarin from first turn |

#### Bugs Found / Regressions

1. **P17: Info sharing → save_memory — STILL BROKEN** (HIGH)
   - Turn 2: "I am a software engineer in Shanghai"
   - CLASSIFY correctly returns `is_info_sharing: true, memory_action: save, save_key: user_occupation`
   - ORIENT correctly sets `memory_action: save`
   - **But DECIDE ignores** `_memoryAction` flag and plans `web_search("software engineer Shanghai salary")`
   - Root cause: DECIDE prompt does not check `observation._memoryAction` to force `save_memory` tool

2. **CLASSIFY is_reference detection weak** (MEDIUM)
   - Turn 4: "who is the CEO?" → CLASSIFY returns `is_reference: false`
   - This is clearly a deictic reference ("the CEO" = "the CEO of Tesla we just discussed")
   - Workspace context NOT injected because no entity overlap between ["CEO"] and ["Tesla"]
   - System recovered via chatHistory in loop 2 (searched "current CEO of Tesla") but wasted loop 1 on recall_memory

3. **P14: Memory recall key mismatch — REGRESSION** (HIGH)
   - Turn 6: "what is my name?" → recall_memory(query: "name") returns found: 0
   - ORIENT has `user_profile.user_info: "David works at Microsoft"` but DECIDE can't access it
   - Memory stored as generic key `user_info` — recall_memory can't fuzzy-match "name" to it
   - **Was working in Session 6** (Turns 11-13) — possible regression from DB state or search algorithm
   - Note: Turn 7 ("ok thanks") ironically mentions David via directResponse user_profile injection

4. **Acknowledgment leaks user_profile** (LOW)
   - Turn 7: Acknowledgment response volunteered "David 在 Microsoft 工作"
   - Greeting memory leak fix only filters `intent === 'greeting'`, not acknowledgments
   - Not harmful per se (user_profile IS the user's info) but inconsistent with greeting behavior

#### Session 6 vs Session 7 Comparison

| Feature | Session 6 | Session 7 | Delta |
|---------|-----------|-----------|-------|
| P11 Follow-up depth 3 | PASS | Not tested (depth 1 only) | — |
| P12 Back-reference | PASS | PASS | Stable |
| P13 Text gen fast path | **FAIL** | **PASS** | **Fixed** |
| P14 Memory recall | PASS | **FAIL** | **Regression** |
| P17 Info sharing save | Not tested | **FAIL** | New bug |
| Token counter | ~0.7K (broken) | 44.2K actual | **Fixed** |
| Greeting leak | PASS | PASS | Stable |
| Topic switch | PASS | PASS | Stable |
| Acknowledgment guard | PASS | PASS | Stable |

#### Performance Summary — Session 7
- **Console errors: 0** (clean run across all 9 turns)
- **Total tokens consumed: 44.2K** (actual API tokens, not estimated)
- **Average response time: ~8.9s** (range: 1.50s–~20s)
- **Fast path responses (0 tools): 3** (greeting, poem, acknowledgment)
- **All responses in Mandarin** (P21 auto-detection working)

#### Priority Bug Fix List (for engineer)

| # | Bug | Severity | Fix Location | Effort |
|---|-----|----------|-------------|--------|
| 1 | P17: DECIDE ignores `_memoryAction` flag | **HIGH** | `src/oodae-decide.js` — check `observation._memoryAction` before generating plan | S |
| 2 | P14: recall_memory key mismatch | **HIGH** | `chat_tools.js` recall_memory — add fuzzy/value search, not just key match | M |
| 3 | CLASSIFY `is_reference` weak | **MEDIUM** | `src/oodae-observe.js` CLASSIFY prompt — improve deictic reference examples | S |
| 4 | Ack leaks user_profile | **LOW** | `src/oodae-evaluate.js` _directResponse — skip profile for acknowledgment intent | S |

## Node.js E2E — Capability Boundary Stress Test (2026-03-21)

15-turn continuous conversation testing 13 previously untested capability gaps. Real Gemini API (Gemma 3 27B), shared chatHistory, in-memory workspace + memory.

**Run:** `node test/test_stress.js` or `node test/run_all.js --stress`

**Result: 64/65 PASS (98.5%)**

### Test Flow
```
 Step 1:  "hi"                                           → greeting baseline (0 tools)
 Step 2:  "my name is Sarah"                             → memory save
 Step 3:  "Apple"                                        → ambiguous single-word query
 Step 4:  "I mean Apple the company, tell me about them" → user correction / repair
 Step 5:  "who is the CEO?"                              → follow-up on corrected topic
 Step 6:  "actually my name is Sara, not Sarah"          → memory UPDATE (not duplicate)
 Step 7:  "新加坡天气怎么样？"                              → language switch (Chinese)
 Step 8:  "tell me about electric cars but NOT Tesla"    → negation constraint
 Step 9:  "what will bitcoin be worth next year?"        → unanswerable / hallucination stress
 Step 10: "what's my name?"                              → memory recall after update
 Step 11: "weather"                                      → minimal single-word input
 Step 12: "thanks"                                       → acknowledgment guard
 Step 13: "go back to Apple, what's their revenue?"     → back-reference (8 turns apart)
 Step 14: "weather in Tokyo? if cold, suggest warm food" → conditional reasoning
 Step 15: "forget my name"                               → memory deletion / negative op
```

### Step Results
| Step | Input | Gap Tested | Tools | Key Result | Status |
|------|-------|-----------|-------|------------|--------|
| 1 | `"hi"` | Baseline | 0 | Fast path, greeting detected | PASS |
| 2 | `"my name is Sarah"` | Memory save | save_memory | Saved user_name=Sarah, no web_search | PASS |
| 3 | `"Apple"` | **Ambiguity** | 0 | Asked user for clarification — correct for single-word ambiguity | PASS |
| 4 | `"I mean Apple the company"` | **User correction** | web_search + fetch_url | Searched "Apple Inc", response about tech company (Silicon Valley, iPhone) | PASS |
| 5 | `"who is the CEO?"` | **Follow-up after correction** | web_search + fetch_url | Searched "Apple Inc. CEO", response: Tim Cook | **PASS (1 assertion failed)** |
| 6 | `"actually my name is Sara, not Sarah"` | **Memory update** | save_memory | Updated value to "Sara", CLASSIFY detected save action | PASS |
| 7 | `"新加坡天气怎么样？"` | **Language switch** | get_weather | Singapore weather in Chinese, language detected as zh/Chinese | PASS |
| 8 | `"electric cars but NOT Tesla"` | **Negation** | web_search + fetch_url | Mentioned BYD/Rivian/etc, Tesla not over-represented | PASS |
| 9 | `"bitcoin worth next year?"` | **Hallucination resistance** | web_search + fetch_url | Hedging language present, no confident specific price prediction | PASS |
| 10 | `"what's my name?"` | **Recall after update** | recall_memory / fast path | Response contains "Sara" (corrected name) | PASS |
| 11 | `"weather"` | **Minimal input** | get_weather / web_search | Handled 1-word input, used weather tool | PASS |
| 12 | `"thanks"` | Acknowledgment guard | 0 | `is_acknowledgment=true`, 0 tools, 40 chars, no topic leakage | PASS |
| 13 | `"go back to Apple, revenue?"` | **Back-reference** | web_search + fetch_url | Searched "Apple revenue", $143.8B Q1 FY2026, no bitcoin/EV contamination | PASS |
| 14 | `"Tokyo weather? if cold, warm food"` | **Conditional reasoning** | get_weather + web_search | Tokyo 6.5°C → suggested warm Japanese food (oden, udon) — **BONUS: conditional handled** | PASS |
| 15 | `"forget my name"` | **Memory deletion** | save_memory | Cleared value via save_memory(key=user_name, value=""), no web_search | PASS |

### Single Failure

**Step 5:** `detected as follow-up or reference` — OBSERVE returned `intent=question` with `entities=[CEO]` instead of `follow_up`. CLASSIFY returned `is_reference=false`. This matches **known Bug 3** (CLASSIFY `is_reference` weak for deictic references).

**Impact: None on user experience** — the agent still searched "Apple Inc. CEO" (chatHistory provided context) and correctly answered "Tim Cook". Only the OODA-E phase metadata assertion failed.

### Capability Scorecard

| Capability | Step(s) | Verdict |
|-----------|---------|---------|
| Ambiguous input handling | 3, 11 | **STRONG** — asked for clarification (Step 3), inferred from context (Step 11) |
| User correction / pivot | 4 | **STRONG** — clean topic switch to Apple Inc |
| Memory CRUD (create/read/update/delete) | 2, 6, 10, 15 | **STRONG** — all 4 operations work |
| Language switching | 7 | **STRONG** — detected Chinese, responded in Chinese |
| Negation constraints | 8 | **STRONG** — focused on non-Tesla brands |
| Hallucination resistance | 9 | **STRONG** — hedging language, no fabricated prices |
| Back-reference (long distance) | 13 | **STRONG** — 8 turns apart, clean Apple-only search |
| Conditional reasoning | 14 | **STRONG** — chained weather→food suggestion |
| Deictic reference detection | 5 | **WEAK** — known Bug 3, CLASSIFY misses implicit references |

### Key Highlights

1. **Conditional reasoning (Step 14)** — Agent queried Tokyo weather (6.5°C), determined it was cold, then searched for warm Japanese food and recommended oden, udon, nabe. This multi-step reasoning with conditional branching is an advanced capability.

2. **Memory deletion (Step 15)** — No `delete_memory` tool exists. Agent gracefully degraded by using `save_memory(key=user_name, value="")` to clear the value.

3. **Negation (Step 8)** — Response focused on BYD, Rivian, Hyundai, etc. Tesla mentioned only briefly in context, not as primary focus.

---

## Hardcode Audit — HarnessConfig 集中配置层 (2026-03-21) — ✅ COMPLETED

**审计结果：100+ 个硬编码值，分布在 12 个 src/ 文件、9 个类别。** 已抽取到 `src/config.js` 集中配置层。

**已完成的文件 (12/12 src/):** `client.js`, `core.js`, `oodae.js`, `oodae-helpers.js`, `oodae-observe.js`, `oodae-decide.js`, `oodae-evaluate.js`, `oodae-act.js`, `oodae-subagent.js`, `oodae-workspace.js`, `oodae-plan-post.js`, `tool-runner.js`

**已完成 (browser scripts):** `tools_search.js`(8 URLs), `tools_data.js`(12 URLs), `tools_compute.js`(1 URL), `tools_language.js`(4 URLs) — 通过 `GemmaClient.HarnessConfig.services.*` 读取，保留 `||` 内联默认值作为 fallback。

### 目标架构

```js
HarnessConfig = {
  api:        { baseUrl, model, apiVersion },
  keys:       { seed, rotateEveryN, jsonlPath },
  generation: { default, observe, decide, decideLite, evaluate, directResp, subagent },
  agent:      { maxLoops, maxActIterations, maxToolRunnerIterations },
  context:    { compactThreshold, charsPerToken, keepRecent, recentContextWindow },
  retry:      { maxRetries, baseDelay },
  truncation: { fetchContent, toolResultJson, finalSummary, resultText, knownAnswer, subagentResult, autoFetchMaxLength },
  services:   { search, readUrl, timeApi, geocode, weather, currency, wikipedia, dictionary, ... },
  policies:   { searchTools, skipExtensions, skipSites, langAliases },
  prompts:    { observe, classify, decide, decideLite, evaluate, decompose, systemContext },
  storage:    { dbName, dbVersion, themeKey },
}
```

### Category 1: API & Infrastructure

| File | Line | Hardcoded Value | Controls |
|---|---|---|---|
| `src/client.js:7` | `'https://generativelanguage.googleapis.com/v1beta/models'` | Google AI API base URL |
| `src/client.js:19` | `'gemma-3-27b-it'` | Default model name |
| `src/core.js:38` | `'20250710'` | XOR encryption seed |
| `chat_app.js:19` | `{ rotateEveryN: 1, seed: '20250710' }` | Key rotation config |

### Category 2: Generation Config (5 separate profiles)

| File | temp | topP | topK | Used By |
|---|---|---|---|---|
| `src/client.js:20-24` | 1.0 | 0.95 | 40 | Default API calls |
| `src/oodae-helpers.js:10-14` | 0.3 | 0.9 | 20 | OODA-E phase calls (Observe/Classify/Decide/Evaluate) |
| `src/oodae-decide.js:216` | 0.1 | 0.8 | 10 | Simplified Decide retry |
| `src/oodae-evaluate.js:~113` | 0.7 | 0.95 | 40 | Direct response generation |
| `src/oodae-subagent.js:~28` | 0.1 | 0.8 | 10 | Sub-agent decomposition |

### Category 3: Agent Thresholds

| File | Value | Controls |
|---|---|---|
| `src/oodae.js:26` | `MAX_LOOPS = 3` | Max OODA-E retry loops |
| `src/oodae.js:27` | `MAX_ACT_ITERATIONS = 5` | Max tool execution iterations |
| `src/tool-runner.js:10` | `DEFAULT_MAX_ITERATIONS = 5` | Legacy ToolRunner max iterations |
| `src/client.js:26` | `maxRetries: 5, baseDelay: 1000` | HTTP retry config |
| `chat_app.js:138` | `COMPACT_THRESHOLD = 99000` | Context compaction trigger |
| `chat_app.js:139` | `CHARS_PER_TOKEN = 3.5` | Token estimation ratio |
| `chat_app.js:140` | `KEEP_RECENT = 10` | Messages preserved after compaction |

### Category 4: External Tool API URLs (23 endpoints in chat_tools.js)

| Line | URL | Service |
|---|---|---|
| ~22 | `search.yapweijun1996.com/search` | SearXNG web search |
| ~43 | `readurl.b1122333.com/read-url` | URL content extraction |
| ~45 | `'x-api-key': 'rk_local_5b02ce...'` | **ReadURL API key — plaintext** ⚠️ |
| ~75 | `timeapi.io/api/time/current/zone` | World time |
| ~91 | `nominatim.openstreetmap.org/search` | Geocoding |
| ~96 | `api.open-meteo.com/v1/forecast` | Weather |
| ~115 | `api.frankfurter.app/latest` | Currency exchange |
| ~128 | `en.wikipedia.org/api/rest_v1/page/summary` | Wikipedia |
| ~141 | `api.dictionaryapi.dev/api/v2/entries/en` | Dictionary |
| ~169 | `ip-api.com/json/` | IP geolocation |
| ~179 | `official-joke-api.appspot.com/random_joke` | Jokes |
| ~184 | `api.adviceslip.com/advice` | Advice |
| ~193 | `api.duckduckgo.com/` | DuckDuckGo |
| ~207 | `hacker-news.firebaseio.com/v0/` | Hacker News |
| ~229 | `api.coingecko.com/api/v3/simple/price` | Crypto prices |
| ~246 | `restcountries.com/v3.1/name/` | Country data |
| ~260 | `api.mathjs.org/v4/` | Calculator |
| ~276 | `api.bigdatacloud.net/...` | Reverse geocoding |
| ~289 | `wikidata.org/w/api.php` | Wikidata |
| ~306 | `api.worldbank.org/v2/country/` | World Bank |
| ~323 | `openlibrary.org/search.json` | Books |
| ~336 | `api.stackexchange.com/2.3/search` | Stack Exchange |
| ~349 | `api.crossref.org/works` | Academic papers |

### Category 5: Truncation / Magic Numbers (30+)

| File | Value | Purpose |
|---|---|---|
| `src/oodae-observe.js:8` | `6` | Recent context window for OBSERVE |
| `src/oodae-observe.js:~68` | `10` | Word count threshold for follow-up |
| `src/oodae-observe.js:~191` | `10` | Entity dedup cap |
| `src/oodae-act.js:161` | `6` | Query word limit for shortening |
| `src/oodae-act.js:~113` | `15000` | Auto-fetch max_length |
| `src/oodae-evaluate.js:~29` | `2000` | Fetch content truncation |
| `src/oodae-evaluate.js:~32` | `1500` | Tool result JSON truncation |
| `src/oodae-evaluate.js:~120` | `300` | Final answer summary truncation |
| `src/oodae-helpers.js:~175` | `3000` | Result text truncation |
| `src/oodae-helpers.js:~188` | `200`, `30` | Known answer snippet limits |
| `src/oodae-subagent.js:~96` | `1000`, `500` | Sub-agent result truncation |

### Category 6: Prompt Templates (inline, not externalizable)

| File | Lines | Phase |
|---|---|---|
| `src/oodae-observe.js:9-23` | OBSERVE prompt (intent analysis) |
| `src/oodae-observe.js:~235-289` | CLASSIFY prompt (intent classification) |
| `src/oodae-decide.js:111-151` | DECIDE prompt (tool selection rules) |
| `src/oodae-decide.js:204-212` | Simplified DECIDE prompt |
| `src/oodae-evaluate.js:~37-72` | EVALUATE prompt (answer quality) |
| `src/oodae-subagent.js:~13-23` | Decompose prompt |
| `chat_app.js:431-498` | System context + memory instructions |

### Category 7: Behavior Policies

| File | Value | Controls |
|---|---|---|
| `src/oodae-act.js:7` | `SEARCH_TOOLS = Set(...)` | Which tools trigger search chain |
| `src/oodae-act.js:168` | `SKIP_EXT` regex | File extensions to skip fetching |
| `src/oodae-act.js:169` | `SKIP_SITE` regex | Social sites to skip fetching |
| `src/oodae-decide.js:26` | `LANG_ALIASES` map | Language name normalization |
| `chat_memory.js:6-7` | `'GemmaClientMemory'`, `2` | IndexedDB name + version |

### Category 8: UI / Frontend

| File | Value | Controls |
|---|---|---|
| `chat_app.js:29` | `'gemma-theme'` | localStorage key |
| `chat_app.js:424` | `'en-US'` | Fallback locale |
| `chat.html:25-29` | 4 model options | Model selector dropdown |

### Risk Priority

| # | Risk | Severity | Reason |
|---|------|----------|--------|
| 1 | Credentials in plaintext | **CRITICAL** | `chat_tools.js` ReadURL API key exposed in source |
| 2 | 5 scattered generation configs | **HIGH** | Impossible to centrally tune temperature/topP/topK |
| 3 | 30+ magic numbers undocumented | **HIGH** | No rationale for truncation values; inter-dependent |
| 4 | Prompt templates inline | **MEDIUM** | Cannot A/B test or version prompts without code changes |
| 5 | 23 external API URLs hardcoded | **MEDIUM** | Any service change requires code edit + rebuild |

### Implementation Plan

- [x] **Phase 1: Create `src/config.js`** — `HarnessConfig` singleton, 9 categories, 100+ values
- [x] **Phase 2: Extract API + Keys** — `config.api.{baseUrl,model,retry}`, `config.keys.{rotateEveryN,seed}`
- [x] **Phase 3: Extract Generation Configs** — `config.generation.{client,helper,deterministic,creative}`
- [x] **Phase 4: Extract Agent Thresholds** — `config.agent.{maxLoops,maxActIterations,toolRunnerMaxIterations}`
- [x] **Phase 5: Extract Context + Truncation** — `config.context.*` (7 values) + `config.truncation.*` (20 values)
- [x] **Phase 6: Extract Service URLs** — `config.services.{search,knowledge,data,language}` (23 endpoints defined in config.js)
- [x] **Phase 6b: Wire `tools_*.js`** — browser scripts read `GemmaClient.HarnessConfig.services.*` with inline fallbacks
- [ ] **Phase 7: Extract Credentials** — ReadURL API key to `config.services.readUrl.apiKey` (deferred)
- [ ] **Phase 8: Externalize Prompts** — inline templates to `config.prompts.*` (deferred — large scope)
- [x] **Phase 9: Extract Policies** — `config.policies.{searchTools,skipExtensions,skipSites,langAliases}`
- [x] **Phase 9b: Extract Workspace** — `config.workspace.{maxWordCount,ackMaxWords,entityCoverageThreshold,recentTopicsFetch,entityCap}`
- [x] **Phase 10: Runtime Override** — `HarnessConfig.load(overrides)` with `_deepMerge` (preserves RegExp)
- [x] **Phase 11: Rebuild + Test** — dist 103.5kb, 434/434 unit tests pass

## Unit Test Results (2026-03-21)

### Node.js (`node test/run_all.js --unit`)
| Suite | Tests | Status |
|-------|-------|--------|
| test_core.js | 26/26 | PASS |
| test_tools.js | 61/61 | PASS |
| test_oodae_unit.js | 416/416 | PASS |
| **Total** | **503/503** | **ALL PASS** |

**All tests passing.**

## Browser E2E Tests — Session 9 (Coordination Layer Multi-Turn — 2026-03-22, ~2:38-3:08 PM)

Live tests via HTTP server (port 8765), Tool Calling mode ON, Gemma 3 27B. **Focus: coordination layer verification — Runner wiring, ProactiveEngine triggers, LearningSystem logging, GoalManager integration, multi-turn follow-ups, memory recall, error recovery.**

**Build:** dist 179.8kb with coordination layer changes. Cache-busting added to all `<script>` tags in `chat.html` (`?v=4`→`?v=5`).

### Test Results

| # | Test | Input(s) | Result | Key Findings |
|---|------|----------|--------|-------------|
| 1 | Runner init + coordination wiring | "hello, what day is it today?" | **PASS** | Runner created; `proactiveEngine.runner` ✅, `goalManager.runner` ✅, `getRunner()` ✅; LearningSystem logged intent=greeting |
| 2a | Factual query | "tell me about SpaceX" | **PASS** | web_search (10 calls, domain scoring) + fetch_url (Wikipedia); 6278 tokens, 8.08s |
| 2b | Implicit "the" reference | "who is the founder?" | **PASS** | Correctly resolved "the founder" → SpaceX founder = Elon Musk |
| 2c | CJK follow-up | "它的总部在哪里？" | **PASS** | "它" resolved to SpaceX; Chinese response: "Starbase, Texas" |
| 2d | Topic switch isolation | "what is machine learning?" | **PASS** | No SpaceX leakage; clean ML response |
| 2e | CJK follow-up after switch | "那它跟深度学习什么关系？" | **PASS** | "它" resolved to ML; Chinese: "深度学习⊂机器学习⊂AI" |
| 3 | ProactiveEngine trigger | Reminder (2 min) | **PASS** | Trigger created via timestamp, fired on schedule, notification displayed |
| 4 | LearningSystem logging | (automatic) | **PASS** | 6 entries logged: intent types (greeting/question/follow_up), tools, duration, tokens |
| 5 | Duplicate notification fix | Reminder trigger | **PASS** | After fix: exactly 1 notification (was 2 before) |
| 6 | Memory save + recall | "I love chess, favorite color blue" → "what do you know about me?" | **PARTIAL** | Saved favorite_color=blue ✅; DECIDE did web_search for "blue chess" instead of saving chess interest; Recall: ORIENT injected all 4 memories but model omitted favorite_color in response |
| 7 | GoalManager integration | Programmatic: create + decompose + persist/restore | **PASS** | Goal decomposed into 8 subgoals; persist/restore via IndexedDB ✅ |
| 8 | Error recovery | "......" (dots only) | **PASS** | No crash; compactHistory triggered (~108.7K→~0.8K); model inferred "What is my name?" from context; 3 loops, 3 tools |

### Bugs Found & Fixed

| # | Bug | Severity | Fix | File |
|---|-----|----------|-----|------|
| 1 | **Duplicate ProactiveEngine notification** — `_executeTrigger.onNotify()` + `proactiveTick()` loop both called `addProactiveNotification()` | MEDIUM | Remove duplicate call in `proactiveTick()` — `onNotify` callback already handles it | `chat_proactive.js` |
| 2 | **Browser cache serving stale JS** — `chat_send.js` coordination code not loaded | HIGH | Added `?v=N` cache-busting to all `<script>` tags in `chat.html` | `chat.html` |

### Observations

- **Token accumulation**: 120.6K tokens after 8 turns (90K restored + 30K new). Auto-compaction triggered correctly at ~108.7K
- **LearningSystem duration**: 21-163s range. High values (148-163s) are legitimate — include all LLM API calls + tool network requests (10x web_search = ~100s network time)
- **save_pairs still unreliable**: Compound info ("I love chess and favorite color is blue") — CLASSIFY correctly identifies `is_info_sharing` + `save_key: "user_interests"` but DECIDE splits into save(blue) + search(chess). Known model behavior issue (P28)
- **GoalManager.persist()**: Must be called with goal argument `persist(goal)`, not `persist()`. Normal usage path in `execute()` is correct
- **Key rotation**: Keys #2→#5→#1→#10→#6→#2 across 8 turns (rotateEveryN=1 working)

### Documentation
- `docs/capability-boundary-report.md` — Full capability matrix, test results, architecture analysis
- `docs/optimization-proposals.md` — Prioritized optimization roadmap with code examples
