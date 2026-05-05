# Session 7 — Regression Test Report

**Date:** 2026-03-21 ~10:00 PM MYT
**Build:** dist/gemma_client.js (rebuilt with P13 + token counter fixes)
**Model:** Gemma 3 27B via OpenRouter
**Mode:** Tool Calling, OODA-E pipeline
**Tester:** Chrome DevTools MCP (automated browser E2E)

## Executive Summary

**6/9 PASS, 1 PARTIAL, 2 FAIL**

The engineer's P13 text generation fix and token counter fix are both **confirmed working**. However, two regressions surfaced: P17 info-sharing save is broken (DECIDE ignores memory_action flag), and P14 memory recall has regressed (recall_memory can't find generic-key memories).

## Test Matrix

| # | Test Case | Expected | Actual | Verdict |
|---|-----------|----------|--------|---------|
| 1 | Greeting: `hello!` | 0 tools, fast path | 0 tools, "你好！" | **PASS** |
| 2 | Info sharing: `I am a software engineer in Shanghai` | save_memory | web_search (salary) | **FAIL** |
| 3 | Web search: `tell me about Tesla` | Tesla info, no Shanghai leak | Clean Tesla summary | **PASS** |
| 4 | Follow-up: `who is the CEO?` | Resolve to Tesla CEO | Elon Musk (2 loops) | **PARTIAL** |
| 5 | Text gen: `write me a short poem about the moon` | 0 tools, fast path | 0 tools, Chinese poem | **PASS** |
| 6 | Memory recall: `what is my name?` | "David" | "我不知道你的名字" | **FAIL** |
| 7 | Acknowledgment: `ok thanks` | 0 tools | 0 tools, "不客气" | **PASS** |
| 8 | Back-reference: `tell me more about Tesla` | Tesla info | Clean Tesla summary | **PASS** |
| 9 | Topic switch: `what is quantum computing?` | QC info, no Tesla leak | Clean QC explanation | **PASS** |

## Fixes Confirmed Working

### P13: Text Generation Fast Path
- **Input:** "write me a short poem about the moon"
- **CLASSIFY:** `is_task_request: true` (new CHECK 9 working)
- **Orchestrator:** Routes to fast path, sets `observation.requires_tools = false`
- **Result:** 0 loops, 0 tools, 2.08s — Chinese poem generated directly
- **Before fix:** Would search "short poem moon" and fetch random poetry sites

### Token Counter
- **Before fix:** Showed `~0.7K tokens` (text-based estimate with `~` prefix)
- **After fix:** Shows actual API-reported tokens: `1.7K` → `11.5K` → `44.2K` (cumulative)
- **Implementation:** `_callModel` captures `usageMetadata.totalTokenCount`, `_runTokens` accumulates per-run
- **Compaction threshold:** Now uses real token count for COMPACT_THRESHOLD check

### Other Stable Fixes
| Fix | Status | Evidence |
|-----|--------|----------|
| Greeting memory leak | Stable | Turn 1: No David/Microsoft mention despite DB memories |
| Topic switch Layer 1 | Stable | Turns 3, 9: Zero cross-topic contamination |
| P21 language auto-detect | Stable | All 9 turns answered in Mandarin |
| Acknowledgment guard | Stable | Turn 7: `is_acknowledgment: true`, 0 tools |
| Back-reference (P12) | Stable | Turn 8: Clean Tesla results after other topics |

## Bugs Found

### BUG 1: P17 — DECIDE ignores memory_action flag (HIGH)

**Reproduction:** Send "I am a software engineer in Shanghai"

**Pipeline trace:**
```
OBSERVE  → intent: information_sharing, requires_tools: false, is_about_user: true
CLASSIFY → is_info_sharing: true, memory_action: save, save_key: user_occupation ✓
ORIENT   → memory_action: save ✓
DECIDE   → web_search("software engineer Shanghai salary") ✗
```

**Root cause:** The orchestrator correctly sets `observation._memoryAction = "save"` and `observation.intent = "information_sharing"`. But the DECIDE prompt does not receive or check this flag. It generates its own plan independently based on entities ["software engineer", "Shanghai"] and decides to search.

**Fix:** In `_decide()`, if `observation._memoryAction === "save"`, force the plan to include `save_memory` with the pre-extracted key/value from `observation._saveKey` / `observation._saveValue`.

### BUG 2: CLASSIFY is_reference detection weak (MEDIUM)

**Reproduction:** After discussing Tesla, send "who is the CEO?"

**Pipeline trace:**
```
OBSERVE  → entities: ["CEO"], summary mentions "likely Tesla"
CLASSIFY → is_reference: false ✗  (should be true)
Layer 1  → No entity overlap: ["CEO"] vs ["Tesla"] → workspace context NOT injected
```

**Root cause:** The CLASSIFY prompt's REFERENCE CHECK (item 6) should detect "the CEO" as a deictic reference to a previously discussed entity. The model failed to recognize that "the CEO" implies "the CEO of Tesla."

**Impact:** System recovered through chatHistory context in loop 2 but wasted loop 1 on recall_memory. Inefficient but not incorrect.

**Fix:** Add more explicit examples to CLASSIFY prompt item 6, e.g.:
- "who is the CEO?" after discussing a company → is_reference=true
- "what's the price?" after discussing a product → is_reference=true

### BUG 3: P14 — Memory recall key mismatch (HIGH)

**Reproduction:** Send "what is my name?" when memory has `user_info: "David works at Microsoft"`

**Pipeline trace:**
```
ORIENT   → user_profile.user_info: "David works at Microsoft" ✓ (has the data!)
DECIDE   → recall_memory(query: "name")
ACT      → found: 0, memories: [] ✗
Loop 2   → recall_memory(query: "name") → found: 0 again
Loop 3   → recall_memory(query: "name") → found: 0 again
EVALUATE → "我不知道你的名字" (I don't know your name)
```

**Root cause:** The recall_memory tool searches by key name, not by value content. The key `user_info` doesn't match the query "name". The data IS in ORIENT's user_profile but DECIDE/EVALUATE can't access ORIENT's findings directly.

**Note:** This worked in Session 6 (Turns 11-13). Possible difference: Session 6 may have had a `user_name` key alongside `user_info`, or the recall_memory search algorithm has changed.

**Fix options:**
1. Recall_memory should search both keys AND values
2. ORIENT should inject user_profile into EVALUATE context when memory_action is "recall"
3. Save memories with granular keys (user_name, user_employer) not combined keys

### BUG 4: Acknowledgment leaks user_profile (LOW)

**Reproduction:** Send "ok thanks" when user_profile has memories

**Result:** Response includes "David 在 Microsoft 工作" — directResponse injects user_profile for non-greeting intents.

**Fix:** Skip user_profile injection for `intent === 'acknowledgment'` in `_directResponse`, same as for greeting.

## Session 6 → Session 7 Delta

| Metric | Session 6 | Session 7 |
|--------|-----------|-----------|
| Tests | 15 | 9 |
| Pass rate | 14/15 (93%) | 6/9 (67%) + 1 partial |
| P13 text gen | FAIL | **PASS (fixed)** |
| Token counter | FAIL (~0.7K) | **PASS (44.2K actual)** |
| P14 memory recall | PASS | FAIL (regression) |
| P17 info sharing | Not tested | FAIL (new) |
| Cumulative tokens | ~0.7K (broken) | 44.2K (accurate) |
| Console errors | 0 | 0 |

## Risk Assessment

| Risk | Severity | Impact |
|------|----------|--------|
| P17 info sharing breaks user onboarding | **HIGH** | Users who share personal info will get search results instead of acknowledgment |
| P14 memory recall inconsistent | **HIGH** | "what is my name?" fails despite data being in memory — erodes trust |
| CLASSIFY is_reference weak | **MEDIUM** | Follow-up questions waste extra loop, doubling response time |
| Acknowledgment profile leak | **LOW** | Harmless but inconsistent with greeting behavior |

## Recommended Next Steps

1. **P17 fix** — Add `_memoryAction` check in `_decide()` (estimated: 10 lines of code)
2. **P14 fix** — Add value search to recall_memory tool, or inject ORIENT's user_profile into EVALUATE
3. **CLASSIFY prompt improvement** — Add deictic reference examples to CHECK 6
4. **Run full 388 unit tests** after fixes to prevent regressions
5. **Session 8** — Re-run full 15-turn stress test to verify all fixes
