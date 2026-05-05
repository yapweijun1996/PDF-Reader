# OODA-E Optimization Proposals

**Date**: 2026-03-21
**Updated**: 2026-03-21 — Priorities 1-5 implemented; P6 hardcode migration planned; P7 test sync, P8 API key, P9 entity safety, P10 punctuation guard added; **P11 direction loss (HIGH), P12 back-reference pollution (HIGH), P13 text-gen fast path (MEDIUM)** added from long conversation test; **P14 memory recall category mismatch (HIGH)** added from browser E2E Session 4
**Priority**: Based on E2E testing capability boundary findings

---

## Priority 1: Fix Topic Switch Contamination — IMPLEMENTED

### Problem
When the user switches topics (e.g., Tesla → quantum computing), OBSERVE still marks it as `follow_up` and injects the old workspace summary into DECIDE. CLASSIFY correctly filters entities but doesn't clean the observation summary.

### Data Flow (Current — Broken)
```
User: "what is quantum computing?"
  ↓
OBSERVE → summary: "quantum computing (about: Tesla)" ← workspace injection
  ↓
CLASSIFY → user_entities: ["quantum computing"] ← correctly filtered
  ↓
DECIDE → sees summary with "Tesla" → searches "Tesla quantum computing" ← WRONG
```

### Proposed Fix: Two-Layer Topic Switch Detection

**Layer 1: In _observe() — Entity Overlap Check**
```javascript
// After workspace resolution, before merging:
const modelEntities = parsed.key_entities.map(e => e.toLowerCase());
const wsEntities = wsContext.entities.map(e => e.toLowerCase());
const hasOverlap = modelEntities.some(me =>
    wsEntities.some(we => we.includes(me) || me.includes(we))
);
if (!hasOverlap) {
    // Zero entity overlap = new topic, skip workspace injection
    return parsed;
}
```

**Layer 2: In run() after CLASSIFY — Summary Rebuild**
```javascript
const classifiedLower = (classification.user_entities || []).map(e => e.toLowerCase());
const observeLower = (observation.key_entities || []).map(e => e.toLowerCase());
const overlap = classifiedLower.filter(e =>
    observeLower.some(oe => oe.includes(e) || e.includes(oe))
).length;
const overlapRatio = classifiedLower.length > 0 ? overlap / classifiedLower.length : 1;

if (overlapRatio < 0.3 && observation.intent === 'follow_up') {
    observation.summary = userText;
    observation.intent = 'question';
    observation.key_entities = classification.user_entities;
}
```

### Expected Result
```
User: "what is quantum computing?"
  ↓
OBSERVE → summary: "quantum computing (about: Tesla)"
  ↓
CLASSIFY → user_entities: ["quantum computing"]  — 0% overlap with ["Tesla", "CEO"]
  ↓
Topic switch detected → summary reset to "what is quantum computing?"
  ↓
DECIDE → searches "quantum computing" ← CORRECT
```

### Impact: HIGH — Fixes the #1 boundary issue found in testing

---

## Priority 2: Multi-Intent Over-Enrichment Filter — IMPLEMENTED

### Problem
`_enrichPlanForMissedIntents` treats short generic words as standalone entities needing their own search. Example: "companies" → `web_search("Tesla companies")`.

### Fix
```javascript
// In _enrichPlanForMissedIntents, add filter:
const MIN_ENTITY_LENGTH = 4;
const GENERIC_WORDS = new Set(['companies', 'people', 'things', 'stuff',
    'information', 'details', 'data', 'results', 'list', 'types']);

const userEntities = entities.filter(e => {
    const eLower = e.toLowerCase();
    if (eLower.length < MIN_ENTITY_LENGTH) return false;
    if (GENERIC_WORDS.has(eLower)) return false;
    return userLower.includes(eLower.slice(0, Math.min(eLower.length, 10)));
});
```

### Impact: MEDIUM — Prevents nonsensical multi-intent expansion

---

## Priority 3: URL Fetch Dedup Cache — IMPLEMENTED

### Problem
Same URL can be fetched multiple times in one OODA-E run across loops.

### Fix
```javascript
// In _act(), add dedup set:
const fetchedUrls = new Set();

// Before fetch_url execution:
if ((name === 'fetch_url' || name === 'summarize_url') && fetchedUrls.has(args.url)) {
    results.push({ name, args, result: '(skipped — already fetched)' });
    continue;
}

// After successful fetch:
if (name === 'fetch_url' || name === 'summarize_url') {
    fetchedUrls.add(args.url);
}
```

### Impact: LOW — Performance optimization, saves ~1-2s per duplicate fetch

---

## Priority 4: DECIDE Query Variation on Retry — IMPLEMENTED

### Problem
When EVALUATE returns `needs_more=true`, DECIDE re-plans with the same search strategy.

### Fix
Add evaluation feedback to DECIDE prompt on retry loops:

```javascript
// In DECIDE prompt (loop > 1):
if (orientation._additionalContext) {
    prompt += `\n\nPREVIOUS ATTEMPT FAILED: ${orientation._additionalContext}
    TRY A DIFFERENT APPROACH:
    - Use different search keywords
    - Try wikipedia instead of web_search (or vice versa)
    - Add more specific qualifiers to the query`;
}
```

### Impact: MEDIUM — Improves success rate for complex queries

---

## Priority 5: Explicit Entity Passing to DECIDE — IMPLEMENTED

### Problem
DECIDE reads `observation.summary` which may carry workspace context even after CLASSIFY filtered entities.

### Fix
Add a dedicated field in the DECIDE prompt:

```javascript
const decidePrompt = `
USER WANTS: ${observation.summary}
CLASSIFIED ENTITIES (use these for search queries): ${classification.user_entities.join(', ')}
...
IMPORTANT: Use CLASSIFIED ENTITIES for search queries, not entities from the summary.
`;
```

### Impact: HIGH — Directly prevents workspace entity leakage into search queries

---

## Priority 6: Hardcode → Agent Harness Migration

### Philosophy
All semantic decisions should be made by the model, not by regex or hardcoded word lists. Regex should only be used for structural parsing (JSON recovery, XML protocol, URL manipulation). This eliminates brittle pattern matching and makes the system language-agnostic and extensible without code changes.

### 6.1 `_shortenQuery` — Filler/Stop Word Removal → Agent Harness

**Problem**: `_shortenQuery` uses hardcoded regex to strip filler words (`what is|who is|where is|...`) and stop words (`the|a|an|of|...`). These lists are English-only, incomplete, and may strip meaningful words.

**Current (hardcoded)**:
```javascript
.replace(/^(what is|who is|where is|...)\s+/i, '')
.replace(/\b(the|a|an|of|in|for|and|or|...)\b/gi, ' ')
```

**Proposed (agent harness)**: Add a micro-prompt in `_act()` before web_search:
```javascript
async _shortenQueryAgent(query, opts) {
    const raw = await this._callModel(
        `Extract ONLY the essential search keywords from this query. Output ONLY the keywords, nothing else.
Query: "${query}"
Keywords:`,
        { ...opts, generationConfig: { temperature: 0.1, topK: 5, maxOutputTokens: 32 } }
    );
    const keywords = raw.trim().replace(/^["']|["']$/g, '');
    return keywords.length >= 3 ? keywords : query;
}
```

**Impact**: Language-agnostic, handles edge cases (e.g., "Tesla CEO" preserved, "what is the CEO of Tesla" → "Tesla CEO")

### 6.2 `_pickBestUrl` — SKIP_EXT/SKIP_SITE → Agent Harness

**Problem**: `_pickBestUrl` uses hardcoded regex for `SKIP_EXT` (pdf, jpg, etc.) and `SKIP_SITE` (facebook, youtube, etc.). New domains/formats require code changes.

**Current (hardcoded)**:
```javascript
const SKIP_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|mp4|...)(\?|$)/i;
const SKIP_SITE = /(facebook\.com|instagram\.com|twitter\.com|...)/i;
```

**Proposed (agent harness)**: Let the model score URLs by relevance:
```javascript
async _pickBestUrlAgent(searchResults, userQuery, opts) {
    const urlList = searchResults
        .filter(r => r.url)
        .slice(0, 8)
        .map((r, i) => `${i+1}. ${r.url} — ${(r.snippet || '').slice(0, 80)}`)
        .join('\n');
    const raw = await this._callModel(
        `Pick the BEST URL to fetch for answering: "${userQuery}"
Skip: social media, PDFs, images, videos, paywalled sites.
Prefer: official sites, news articles, Wikipedia, documentation.

${urlList}

Output ONLY the number (e.g. "2"). If none are good, output "0".`,
        { ...opts, generationConfig: { temperature: 0.1, topK: 5, maxOutputTokens: 8 } }
    );
    const idx = parseInt(raw.trim()) - 1;
    const candidates = searchResults.filter(r => r.url).slice(0, 8);
    return (idx >= 0 && idx < candidates.length) ? candidates[idx].url : null;
}
```

**Impact**: Considers snippet relevance, handles new domains without code changes, language-agnostic

### 6.3 `GENERIC_WORDS` Blocklist → CLASSIFY Agent Extension

**Problem**: `_enrichPlanForMissedIntents` uses a hardcoded `GENERIC_WORDS` Set and a length filter (`< 4 chars`) to avoid over-enrichment. This is brittle and English-only.

**Current (hardcoded)**:
```javascript
const GENERIC_WORDS = new Set(['companies', 'company', 'people', 'person', ...]);
if (eLower.length < 4) return false;
if (GENERIC_WORDS.has(eLower)) return false;
```

**Proposed**: Extend CLASSIFY agent to output `search_entities` — entities suitable for search queries (already filtered of generic words):
```javascript
// Add to CLASSIFY prompt:
`7. SEARCH ENTITY CHECK: Which entities are specific enough for a search query?
   Remove generic/abstract words (companies, people, things, stuff, latest, etc.)
   Keep only named entities, technical terms, and specific concepts.
   → search_entities=["only", "searchable", "terms"]`
```

Then `_enrichPlanForMissedIntents` uses `classification.search_entities` directly — no blocklist needed.

**Impact**: Eliminates GENERIC_WORDS entirely, model handles any language, new generic words auto-filtered

### 6.4 `_orient` Language Detection → Normalized Storage

**Problem**: `_orient` uses hardcoded string matching (`lp.includes('mandarin') || lp.includes('chinese') || lp.includes('中文')`) to detect language preference. Adding new languages requires code changes.

**Current (hardcoded)**:
```javascript
if (lp.includes('mandarin') || lp.includes('chinese') || lp.includes('中文')) replyLanguage = 'mandarin';
else if (lp.includes('malay') || lp.includes('bahasa')) replyLanguage = 'malay';
```

**Proposed**: Normalize at save time in CLASSIFY/ORIENT:
```javascript
// In _classifyIntent prompt, when is_command=true and save_key contains "language":
`If the user sets a language preference, normalize save_value to one of:
 en, zh, ms, ja, ko, fr, de, es, ar, hi, th, vi, id, pt, ru, ...
 Example: "mandarin" → "zh", "bahasa melayu" → "ms", "日本語" → "ja"`

// In _orient, simply:
const langMap = { zh: 'mandarin', ms: 'malay', ja: 'japanese', en: 'english' };
replyLanguage = langMap[languagePref] || languagePref;
```

**Impact**: Any language supported without code changes, consistent storage format

### 6.5 `_getRecentContext` — String Prefix Checks → Metadata Tags

**Problem**: `_getRecentContext` uses `text.startsWith('[User context]')` and `text.startsWith('Understood.')` to filter system messages. Brittle if message format changes.

**Current (hardcoded)**:
```javascript
if (text.startsWith('[User context]') || text.startsWith('Understood.') || text.startsWith('Noted.')) return null;
```

**Proposed**: Tag system/context messages with metadata when they are added to chatHistory:
```javascript
// When adding system messages to chatHistory:
chatHistory.push({ role: 'model', parts: [{ text: msg }], _meta: { type: 'system_ack' } });

// In _getRecentContext, filter by metadata:
if (m._meta?.type === 'system_ack') return null;
```

**Impact**: No string matching, clean separation of system vs. user content

### Regex Audit — What Stays

The following regex patterns are **structural parsing** and should remain as code:

| Pattern | File | Purpose |
|---------|------|---------|
| `/<thinking>[\s\S]*?<\/thinking>/g` | oodae-helpers.js | Strip CoT thinking tags from model output |
| `/^```(?:json)?\s*/i` | oodae-helpers.js, tool-parser.js | Strip markdown code fences |
| `/,\s*([}\]])/g` | oodae-helpers.js, tool-parser.js | Fix trailing commas in JSON |
| `/\{[\s\S]*\}/` | oodae-helpers.js, tool-parser.js | Extract JSON object from text |
| `/"tool"\s*:\s*"([^"]+)"/g` | oodae-helpers.js | Recover tool names from malformed JSON |
| `/<tool_call>[\s\S]*?<\/tool_call>/g` | tool-parser.js | Parse XML tool call protocol |
| `/\s+/` | oodae-observe.js, oodae-act.js | Basic word splitting/counting |
| URL pathname/hostname manipulation | oodae-act.js | `_validateUrl` URL normalization |

These parse **known text structures** (JSON, XML, URLs) — they make no semantic decisions and cannot be replaced by model calls.

---

## Future: Skill Registry Design

### Concept
Named skill templates that prescribe multi-step workflows:

```javascript
const SKILLS = {
    deep_research: {
        description: 'Multi-source research on a topic',
        steps: [
            { tool: 'web_search', args: { query: '{topic}', max_results: 10 } },
            { tool: 'wikipedia', args: { topic: '{topic}' } },
            { tool: 'fetch_url', args: { url: '{best_result}', max_length: 15000 } },
            { synthesize: true, instruction: 'Compare sources and provide comprehensive analysis' }
        ]
    },
    market_research: {
        description: 'Competitive analysis',
        steps: [
            { tool: 'web_search', args: { query: '{company} market share', categories: 'news' } },
            { tool: 'web_search', args: { query: '{company} competitors', categories: 'general' } },
            { synthesize: true, instruction: 'Compare market position, key competitors, strengths/weaknesses' }
        ]
    },
    personal_assistant: {
        description: 'Daily briefing',
        tools: ['get_time', 'get_weather', 'tech_news', 'exchange_rate'],
        instruction: 'Provide a morning briefing combining all results'
    }
};
```

### Integration
CLASSIFY could detect skill intent:
```json
{ "skill_match": "deep_research", "topic": "quantum computing" }
```

DECIDE would use the skill template instead of free-form planning.

---

## Future: Sub-Agent Architecture

```
DECIDE (Orchestrator)
    │
    ├── Research Agent → web_search + fetch_url + wikipedia
    │                    → returns structured findings
    │
    ├── Analysis Agent → compare findings, extract key facts
    │                    → returns analysis summary
    │
    └── Response Agent → format final answer in user's language
                         → returns formatted response
```

Each sub-agent gets a focused task with clear input/output, reducing hallucination and improving accuracy for complex multi-step queries.

---

## Priority 7: Test & Build Sync Issues (Found 2026-03-21)

### Problem
Browser tests (index.html) are out of sync with source code changes. Node tests (129/129) pass but browser tests show 2 failures due to stale expectations.

### 7.1 Browser Test: `rotateEveryN` Default Mismatch

**Location**: `index.html:285`
**Expected**: `km.rotateEveryN === 5`
**Actual**: `km.rotateEveryN === 1`
**Root Cause**: `src/core.js:37` changed default from `5` to `1`, browser test not updated.

**Fix**: Update browser test to expect `1`:
```javascript
eq(km.rotateEveryN, 1, 'Default rotateEveryN = 1');
```

### 7.2 Browser Test: `maxOutputTokens` Removed

**Location**: `index.html:375`
**Expected**: `api.generationConfig.maxOutputTokens === 8192`
**Actual**: `undefined`
**Root Cause**: `maxOutputTokens` was removed from GemmaAPI defaults (task: "Remove all maxOutputTokens"), but browser test still expects it.

**Fix**: Remove the test assertion:
```javascript
// Remove this line:
// eq(api.generationConfig.maxOutputTokens, 8192, 'Default maxOutputTokens = 8192');
```

### 7.3 `maxOutputTokens` Remnant in Source

**Location**: `oodae-decide.js:167`
**Issue**: `_decideSimplified` still passes `maxOutputTokens: 256` in its generationConfig, contradicting the completed task "Remove all maxOutputTokens from codebase and docs".

**Fix**: Remove `maxOutputTokens: 256` from the generationConfig:
```javascript
generationConfig: { temperature: 0.1, topP: 0.8, topK: 10, responseMimeType: 'text/plain' }
```

### 7.4 Stale dist/ Bundle

**Issue**: Source modules (`src/oodae.js`, `src/tools.js`) have been modified but `dist/gemma_client.js` has not been rebuilt.
**Fix**: Run `npm run build` after all source fixes.

### Impact: LOW — Test/build hygiene, no user-facing behavior change

---

## Priority 8: API Key & Deployment Issues (Found 2026-03-21)

### 8.1 Dead API Key #2

**Issue**: API key `AIzaSyAYMXqvhkWEfLNlGg8rN_smFt7-neLqk48` (key #2 in rotation) consistently returns HTTP 403 Forbidden on every Gemini API call. The `fetchWithRetry` mechanism auto-retries with the next key, so there is no user-visible error, but each rotation cycle wastes one retry attempt and adds ~0.5-1s latency.

**Evidence**: Observed 3x 403 errors in a single 6-message test session (network reqids 16, 33, 47). All other 9 keys return 200.

**Fix**: Remove or replace the dead key in `gemma_code.jsonl`:
```bash
# Identify and remove the revoked key, then re-encrypt
# The key ending in ...k48 should be removed from the JSONL file
```

**Impact**: MEDIUM — Reduces unnecessary retries and console error noise

### 8.2 chat.html CORS on file:// Protocol

**Issue**: When `chat.html` is opened directly via `file://` protocol (e.g., double-clicking the file), the browser blocks `fetch()` of `gemma_code.jsonl` due to CORS policy. The status bar shows "Key load failed" and the send button is disabled.

**Root Cause**: `chat_app.js:829` uses `fetch()` to load `gemma_code.jsonl`, but `file://` origins are treated as opaque by browsers and blocked by same-origin policy.

**Works via**: `python -m http.server` or any local HTTP server (Live Server, etc.)

**Possible Fixes**:
1. **Document requirement**: Add a note in README that HTTP server is required
2. **Inline key fallback**: Allow pasting API key directly in the UI when JSONL load fails
3. **localStorage cache**: Cache decrypted keys in localStorage after first successful HTTP load

**Impact**: LOW — Affects local development workflow only, not production deployment

---

## Priority 9: Entity Type Safety — TypeError Crash Fix (Found 2026-03-21)

### Problem
CLASSIFY and OBSERVE return entity arrays where elements may be non-string types (numbers, null, booleans). The code calls `.toLowerCase()` on these elements without type checking, causing `TypeError: e.toLowerCase is not a function` and crashing the entire OODA-E pipeline.

### Reproduction
```
User: "what is 15 + 27?"    → CLASSIFY returns user_entities: ["15", "27"]  (strings ✓)
User: "multiply that by 3"  → CLASSIFY returns user_entities: [3]          (number ✗)
                             → oodae.js:105 — .map(e => e.toLowerCase()) → TypeError
                             → OODA-E crashes, falls back to ToolRunner
```

### Crash Sites (10 across 4 files)

| # | File | Line | Context |
|---|------|------|---------|
| 1 | `oodae.js` | 105 | `classification.user_entities.map(e => e.toLowerCase())` — Layer 2 topic switch |
| 2 | `oodae.js` | 106 | `(observation.key_entities \|\| []).map(e => e.toLowerCase())` — Layer 2 topic switch |
| 3 | `oodae-observe.js` | 36 | `parsed.key_entities.map(e => e.toLowerCase())` — Layer 1 topic switch |
| 4 | `oodae-observe.js` | 37 | `wsContext.entities.map(e => e.toLowerCase())` — Layer 1 topic switch |
| 5 | `oodae-decide.js` | 131 | `topEntity.toLowerCase()` — deictic query correction |
| 6 | `oodae-decide.js` | 134 | `step.args.query.toLowerCase()` — deictic query correction |
| 7 | `oodae-decide.js` | 202 | `e.toLowerCase()` — multi-intent enrichment (entity iteration) |
| 8 | `oodae-decide.js` | 216 | `entity.toLowerCase()` — multi-intent enrichment (plan check) |
| 9 | `oodae-decide.js` | 225 | `entity.toLowerCase()` — multi-intent enrichment (step match) |
| 10 | Various | — | Any future `.toLowerCase()` on entity arrays |

### Proposed Fix: Centralized Entity Sanitization

**Option A — Coercion at call sites** (minimal change):
```javascript
// Replace all:   entities.map(e => e.toLowerCase())
// With:          entities.map(e => String(e).toLowerCase())
```

**Option B — Sanitize at source** (preferred, single fix point):
```javascript
// In _observe() and _classifyIntent(), after parsing entity arrays:
function sanitizeEntities(entities) {
    if (!Array.isArray(entities)) return [];
    return entities
        .filter(e => e != null)
        .map(e => typeof e === 'string' ? e : String(e));
}

// In _observe():
parsed.key_entities = sanitizeEntities(parsed.key_entities);

// In _classifyIntent():
classification.user_entities = sanitizeEntities(classification.user_entities);
```

**Option C — Defensive wrapper** (belt-and-suspenders):
```javascript
// In oodae-helpers.js, add utility:
export function safeLC(value) {
    return typeof value === 'string' ? value.toLowerCase() : String(value ?? '').toLowerCase();
}

// Replace all e.toLowerCase() with safeLC(e) across the 4 files
```

### Recommendation
**Option B** — sanitize at source. Single fix in `_observe()` and `_classifyIntent()` protects all 10+ downstream call sites. Add `sanitizeEntities()` to `oodae-helpers.js` for reuse.

### Impact: **HIGH** — Fixes a crash that takes down the entire OODA-E pipeline. Currently masked by try/catch fallback to ToolRunner, but the fallback loses all OODA-E benefits (CLASSIFY, workspace, multi-intent, etc.)

---

## Priority 10: Single-Punctuation Follow-up Guard (Found 2026-03-21)

### Problem
A bare `?` (or other single-punctuation input) triggers workspace follow-up resolution, re-executing the last tool call. This wastes 6+ seconds and produces a duplicate response.

### Reproduction
```
User: "weather in Tokyo?"  → get_weather(Tokyo) → "14.1°C clear"
User: "?"                  → workspace resolves to Tokyo → get_weather(Tokyo) → duplicate result (6.48s)
```

### Root Cause
`_resolveFromWorkspace` has an acknowledgment short-circuit:
```javascript
if (wordCount <= 4 && !observation.requires_tools && modelEntities.length === 0 && !trimmed.includes('?')) {
    return null; // skip workspace resolution
}
```
The `!trimmed.includes('?')` check means `?` FAILS the filter and proceeds to workspace resolution.

### Proposed Fix
Add a punctuation-only guard before the acknowledgment check:
```javascript
// At the top of _resolveFromWorkspace:
const trimmed = userText.trim();
if (/^[?!.,;:…]+$/.test(trimmed)) {
    return null; // single-punctuation input is not a real follow-up
}
```

### Impact: LOW — Edge case, but prevents wasted API calls and duplicate responses

---

## Priority 11: Direction Loss After 3+ Follow-ups (Found 2026-03-21)

**Severity**: HIGH
**Found in**: Long conversation test (test_longconv.js), Step 6
**Status**: Open

### Problem
After 3 consecutive follow-ups on the same topic (Singapore Airlines), OBSERVE loses the parent topic context. "who is the CEO?" (Step 6, 3rd follow-up) is classified as `intent=question` with `entities=[CEO]` instead of `intent=follow_up` with `entities=[Singapore Airlines, CEO]`.

### Reproduction
```
Step 3: "tell me about singapore airlines"  → OBSERVE: entities=[Singapore Airlines] ✓
Step 4: "how many planes do they have?"     → OBSERVE: entities=[Singapore Airlines, planes] ✓
Step 5: "what routes do they fly?"          → OBSERVE: entities=[Singapore Airlines, planes, routes] ✓
Step 6: "who is the CEO?"                   → OBSERVE: entities=[CEO] ✗ (lost SIA)
         → DECIDE: web_search("CEO") → Investopedia definition
         → User gets generic CEO definition instead of SIA CEO name
```

### Root Cause Analysis
1. **Workspace topic chain depth**: By Step 6, the topic chain is 3 levels deep. `_resolveFromWorkspace` returns the root entity ("Singapore Airlines") but OBSERVE doesn't consistently inject it when the input has very low entity overlap with the workspace topic
2. **CLASSIFY also misses**: CLASSIFY returns `entities=[CEO]` without SIA context — it only analyzes the current message text, not workspace state
3. **Layer 1 entity overlap check**: "who is the CEO?" has zero overlap with workspace entities (Singapore Airlines, planes, routes), so Layer 1 skips workspace injection
4. **CLASSIFY is_reference**: Should detect "CEO" as requiring context (a CEO of _what?_) but doesn't fire is_reference=true

### Proposed Fix Options

**Option A: Enhance is_reference detection for role/title words** (Recommended)
```
Add to CLASSIFY prompt:
"Role/title words (CEO, boss, president, founder, manager) that lack a subject
are ALWAYS a reference to the current topic. Set is_reference=true."
```

**Option B: Reduce Layer 1 overlap threshold for short inputs**
```javascript
// In _observe(), reduce overlap threshold for short messages (< 5 words)
const words = userText.trim().split(/\s+/).length;
const overlapThreshold = words <= 4 ? 0 : 0.3;
// Short questions like "who is the CEO?" always get workspace context
```

**Option C: Topic chain recency weighting**
```javascript
// In _resolveFromWorkspace(), weight recent topics higher
// After 3+ follow-ups, ensure root entity is always prepended to OBSERVE entities
if (topicChain.length >= 3) {
    const rootEntity = topicChain[0].entities[0];
    if (!observation.key_entities.some(e => e.toLowerCase().includes(rootEntity.toLowerCase()))) {
        observation.key_entities.unshift(rootEntity);
    }
}
```

### Impact: HIGH — Causes factually wrong answers in natural conversation flows

---

## Priority 12: Back-Reference Entity Pollution (Found 2026-03-21)

**Severity**: HIGH
**Found in**: Long conversation test (test_longconv.js), Step 9
**Status**: Open

### Problem
When user explicitly switches back to an earlier topic ("go back to singapore airlines, what about their stock?"), the OBSERVE phase accumulates entities from ALL prior topics, contaminating the DECIDE search query.

### Reproduction
```
Step 7: "tell me about tesla stock price"       → entities=[tesla stock price]
Step 8: "what about their latest earnings?"      → entities=[tesla stock price, earnings]
Step 9: "go back to singapore airlines, stock?"  → entities=[tesla stock price, earnings, Singapore Airlines stock]
         → DECIDE: web_search("tesla stock price Singapore Airlines stock")
         → Search returns ONLY Tesla results
         → Response: "only contains data about Tesla stock"
```

### Root Cause Analysis
1. **Workspace entity accumulation**: `_resolveFromWorkspace` builds entities from the full topic chain, which includes ALL previous topics (Tesla stock price, earnings)
2. **No entity pruning on topic switch**: When the user explicitly mentions a new/old topic, old-topic entities should be cleared
3. **DECIDE doesn't filter**: DECIDE receives all entities as `SEARCH ENTITIES` and concatenates them into one search query

### Proposed Fix Options

**Option A: Detect explicit back-reference and reset entities** (Recommended)
```javascript
// In run() after CLASSIFY, when is_reference=true AND new entities are detected:
if (classification.is_reference && classification.user_entities?.length > 0) {
    // Replace (not merge) observation entities with CLASSIFY's entities
    observation.key_entities = classification.user_entities;
}
```

**Option B: Entity source tagging**
```javascript
// Tag entities with source: 'user' (from current message) vs 'workspace' (from history)
// In DECIDE, prioritize 'user' entities and exclude 'workspace' entities from different topics
observation.key_entities = [
    ...classifyEntities.map(e => ({ text: e, source: 'user' })),
    ...wsEntities.filter(e => !conflictsWithUser(e)).map(e => ({ text: e, source: 'workspace' }))
];
```

**Option C: Topic-aware entity grouping**
```javascript
// Group entities by topic_id; when building search query, only use entities
// from the topic the user is currently referencing
const currentTopicId = detectReferencedTopic(userText, topics);
const relevantEntities = entities.filter(e => e.topicId === currentTopicId || e.source === 'user');
```

### Impact: HIGH — Back-references produce wrong-topic results in multi-topic conversations

---

## Priority 13: Pure Text Generation Forces Tool Path (Found 2026-03-21)

**Severity**: MEDIUM
**Found in**: Long conversation test (test_longconv.js), Step 10
**Status**: Open

### Problem
"Write me a short professional email declining a meeting" triggers web_search instead of using the fast path (`_directResponse`). CLASSIFY sets `is_command=true` → `requires_tools=true`, forcing the DECIDE→ACT loop even though this is a pure text generation task.

### Root Cause
In `oodae.js` lines 74-82, `is_command=true` always sets `observation.requires_tools = true`:
```javascript
} else if (classification.is_command) {
    observation.intent = 'command';
    observation.is_about_user = true;
    observation.requires_tools = true;  // ← forces tool path for ALL commands
```

But "write email" is not a tool-using command — it's a text generation request. The agent should use its own language model to write the email, not search the web for email templates.

### Proposed Fix

**Option A: Add text_generation subtype to CLASSIFY** (Recommended)
```
Add to CLASSIFY prompt:
"is_text_generation: true if the user is asking you to WRITE, DRAFT, COMPOSE,
SUMMARIZE, TRANSLATE, or REWRITE something. These tasks do NOT need tools —
the model should generate the text directly."

// In run():
if (classification.is_text_generation) {
    observation.requires_tools = false; // → fast path
}
```

**Option B: Command subtype classification**
```javascript
// Split commands into tool-commands and text-commands
if (classification.is_command && !classification.needs_tools) {
    observation.requires_tools = false;
}
```

### Impact: MEDIUM — Suboptimal responses (web-template-based vs model-generated text), wasted API calls

---

## Priority 14: Memory Recall Category Mismatch (Found 2026-03-21, Browser E2E Session 4)

### Severity: HIGH

### Problem
When user asks "what is my name?", the agent responds "我目前没有关于您名字的信息" even though `user_name=Alex` is stored in IndexedDB. The agent CAN recall `user_car_color` and `user_employer` but NOT `user_name`.

### Root Cause
ORIENT phase builds a `user_profile` object by filtering memories to ONLY include entries with `category="user_profile"`. The `user_name` was saved with `category="user_info"` — a different category — so it's excluded from the context injected into the response prompt.

### Data Flow (Current — Broken)
```
IndexedDB memories:
  { key: "user_car_color", value: "red", category: "user_profile" }      ← INCLUDED
  { key: "user_employer", value: "Google", category: "user_profile" }     ← INCLUDED
  { key: "user_name", value: "Alex", category: "user_info" }             ← EXCLUDED!
  { key: "reply_language", value: "mandarin", category: "user_preferences" } ← EXCLUDED (lang handled separately)

ORIENT extracts:
  user_profile = { user_car_color: "red", user_employer: "Google" }
  // user_name is invisible to the response prompt!

Response: "我目前没有关于您名字的信息" ← WRONG
```

### Reproduction
```
1. Save memory: "my name is Alex" → saves as category="user_info"
2. (several turns later)
3. Ask: "what is my name?"
4. Expected: "Alex"
5. Actual: "我目前没有关于您名字的信息"
```

### Fix Options

**Option A: Expand ORIENT user_profile extraction to ALL user categories**

In `oodae-observe.js` (or wherever ORIENT builds `user_profile`):

```javascript
// BEFORE: only user_profile category
const userProfile = {};
for (const mem of allMemories) {
    if (mem.category === 'user_profile') {
        userProfile[mem.key] = mem.value;
    }
}

// AFTER: include all user-related categories
const userProfile = {};
const USER_CATEGORIES = ['user_profile', 'user_info', 'user_preferences'];
for (const mem of allMemories) {
    if (USER_CATEGORIES.includes(mem.category)) {
        userProfile[mem.key] = mem.value;
    }
}
```

**Option B: Inject all_memories into response prompt instead of just user_profile**

Pass the full `all_memories` array to `_directResponse()` so the model can see ALL stored memories and pick relevant ones.

**Option C: Trigger recall_memory tool for is_about_user questions**

When OBSERVE detects `is_about_user=true` and the question is a recall (not save), force `requires_tools=true` so the DECIDE phase plans a `recall_memory` tool call instead of relying on ORIENT's incomplete extraction.

### Recommended: Option A (simplest, least risk)

Option A is a one-line fix that preserves the existing architecture. Option B requires prompt changes. Option C adds complexity to the OBSERVE→CLASSIFY→ORIENT flow.

### Impact: HIGH — Users cannot recall personal info saved with non-"user_profile" categories; breaks memory recall trust
