# Gemma Tool Calling Architecture

**Date**: 2026-03-21
**Model**: Gemma 3 27B (via Gemini API)
**Runtime**: OODA-E + Legacy ToolRunner

---

## Why This Exists

Gemma does not have native tool/function calling support like GPT or Claude. This system simulates tool calling through **prompt engineering + XML tag parsing**, enabling Gemma to select and invoke tools (web search, memory, weather, etc.) to answer user queries.

---

## Architecture Overview

```
                        ┌──────────────────────────────────┐
                        │           User Message           │
                        └──────────────┬───────────────────┘
                                       │
                    ┌──────────────────┤
                    │                  │
          ┌─────────▼────────┐  ┌──────▼───────────────────┐
          │  Legacy Flow     │  │  OODA-E Flow (Modern)    │
          │  (ToolRunner)    │  │  6-phase orchestrator    │
          └──────────────────┘  └──────────────────────────┘
```

There are **two tool calling flows**:

| Flow | File | When Used |
|------|------|-----------|
| **ToolRunner** (legacy) | `tool-runner.js` | Simple iteration loop; also used as fallback if OODA-E crashes |
| **OODAERunner** (modern) | `oodae.js` + phase modules | Primary flow with 6-phase decomposition |

---

## Core Modules

| File | Lines | Purpose |
|------|-------|---------|
| `core.js` | 113 | KeyManager (API key rotation), XOR encryption, retry logic |
| `client.js` | 150 | `GemmaAPI` — wraps Gemini `generateContent` endpoint |
| `tool-registry.js` | 70 | Tool definition storage and execution |
| `tool-parser.js` | 106 | XML `<tool_call>` parsing, JSON recovery, system prompt building |
| `tool-runner.js` | 107 | Legacy iterative tool-calling loop |
| `oodae.js` | 334 | Main orchestrator — 6-phase flow coordination |
| `oodae-observe.js` | 330 | OBSERVE + CLASSIFY phases |
| `oodae-decide.js` | 303 | ORIENT + DECIDE phases |
| `oodae-act.js` | 182 | ACT phase — parallel/sequential tool execution |
| `oodae-evaluate.js` | 135 | EVALUATE phase — result verification, final answer |
| `oodae-subagent.js` | 122 | Sub-agent decomposition for multi-entity queries |
| `oodae-helpers.js` | 205 | JSON parsing, model calls, language detection, utilities |
| `skill-registry.js` | 148 | Multi-step workflow templates (deep_research, compare, etc.) |

---

## Part 1: Tool Registration

**File**: `tool-registry.js`

Tools are registered with a name, description, typed parameters, and a handler function:

```javascript
registry.add({
    name: "web_search",
    description: "Search the web for information",
    parameters: {
        query: { type: "string", required: true, description: "Search query" }
    },
    handler: async (args) => {
        // execute search, return results
    }
});
```

The registry separates **metadata** (name, description, parameters) from **execution** (handler). `registry.list()` exports only metadata for prompt injection. `registry.execute(name, args)` validates required parameters, applies defaults, then calls the handler.

---

## Part 2: Prompt-Based Tool Calling (The Core Trick)

**File**: `tool-parser.js`

Since Gemma has no native tool calling API, we tell the model about tools via the **system prompt** and ask it to output tool calls in a specific XML format.

### System Prompt Construction — `buildSystemPrompt(tools)`

```
You are a helpful assistant with access to the following tools...

Available tools:

1. **web_search**
   Description: Search the web for information
   Parameters:
     - query (string, required): Search query

To call a tool, output EXACTLY this format:
<tool_call>
{"name": "function_name", "arguments": {"param1": "value1"}}
</tool_call>

You may call multiple tools by including multiple <tool_call> blocks.
```

### Parsing Tool Calls — `parseToolCalls(text)`

A regex extracts JSON from `<tool_call>` blocks in the model's response:

```javascript
const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
```

The parser supports multiple tool calls in one response and accepts `arguments`, `args`, or `parameters` as the field name for tool arguments.

### JSON Recovery — `tryParseJSON(raw)`

Gemma often produces malformed JSON. The parser has **6 recovery layers**:

```
Layer 1: Direct JSON.parse
Layer 2: Strip markdown code fences (```json ... ```)
Layer 3: Fix trailing commas ({a:1,} → {a:1})
Layer 4: Fix single quotes → double quotes
Layer 5: Fix unquoted keys ({key: "val"} → {"key": "val"})
Layer 6: Extract first {...} substring and retry
```

---

## Part 3: Legacy Flow — ToolRunner

**File**: `tool-runner.js`

Simple loop: send message → parse tool calls → execute → feed results back → repeat.

```
┌──────────────────────────────────────────────────────────┐
│                     ToolRunner.run()                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Inject system prompt (tool definitions)              │
│     ↓                                                    │
│  2. Send user message to API                             │
│     ↓                                                    │
│  3. Parse <tool_call> blocks from response               │
│     ↓                                                    │
│  ┌─ 4. No tool calls? → Return response (DONE)          │
│  │                                                       │
│  └─ 5. Has tool calls:                                   │
│        a. Execute each tool via registry                  │
│        b. Format results as <tool_result> blocks          │
│        c. Append to chat as user message                  │
│        d. Go to step 2 (max 5 iterations)                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### System Prompt Injection

The system prompt is injected as a **fake conversation pair** at the start of chat history:

```javascript
chatHistory.unshift(
    { role: 'user',  parts: [{ text: systemPrompt }], _meta: 'system' },
    { role: 'model', parts: [{ text: 'Understood...' }], _meta: 'system' }
);
```

### Tool Result Format

Results are wrapped in `<tool_result>` XML tags and sent back as a user message:

```
Here are the results from the tool calls:

<tool_result>
{
  "name": "web_search",
  "result": { "results": [...] }
}
</tool_result>

Use these results to answer the original question.
```

---

## Part 4: Modern Flow — OODA-E

**File**: `oodae.js` (orchestrator) + phase modules

OODA-E decomposes the agent reasoning into **6 focused phases**, each a separate API call. This "one question at a time" design works better with weak models than a single complex prompt.

```
User Message
    │
    ▼
┌─────────┐  intent, entities, summary
│ OBSERVE  │──────────────────────────────┐
└─────────┘                               │
    │                                     ▼
    ▼                           ┌──────────────────┐
┌──────────┐  is_greeting,     │  Workspace        │
│ CLASSIFY │  is_command,       │  (IndexedDB)      │
│ (agent)  │  user_entities     └──────────────────┘
└──────────┘
    │
    ▼
┌─────────┐  language, memories, timezone
│ ORIENT  │  (NO API call — deterministic)
└─────────┘
    │
    ▼  ←── Loop (max 3) ──────────────┐
┌─────────┐                            │
│ DECIDE  │  tool plan (JSON)          │
└─────────┘                            │
    │                                  │
    ▼                                  │
┌─────────┐                            │
│   ACT   │  execute tools             │
└─────────┘                            │
    │                                  │
    ▼                                  │
┌──────────┐                           │
│ EVALUATE │  needs_more? ─── yes ────┘
└──────────┘
    │ no
    ▼
  Final Answer
```

### Phase 1: OBSERVE (`oodae-observe.js`)

**What it does**: Analyzes the user's message to extract intent, entities, and whether tools are needed.

**Prompt → Model**: "Analyze this user message. Output JSON."

**Output**:
```json
{
    "intent": "question|command|greeting|follow_up|information_sharing",
    "requires_tools": true,
    "key_entities": ["Tesla", "stock price"],
    "is_about_user": false,
    "summary": "User wants to know Tesla's stock price"
}
```

**Workspace resolution**: For short/vague messages (follow-ups), OBSERVE checks the IndexedDB topic tree to find the previous topic context. It uses entity overlap scoring to match the right conversation thread.

### Phase 2: CLASSIFY (`oodae-observe.js`)

**What it does**: An **independent verification agent** that double-checks OBSERVE's classification. This catches errors like misclassifying greetings as questions.

**9-point checklist**:
1. Greeting check (any language)
2. Command/preference check (save to memory)
3. Factual question check (needs tools)
4. Acknowledgment check (ok, thanks, got it)
5. Entity extraction (from current message only)
6. Reference check (refers back to previous topic)
7. Search entity filter (remove generic words)
8. Info sharing check (user telling about themselves)
9. Task/generation check (write/draft/translate)

**Key corrections CLASSIFY applies**:
- Greeting → force `requires_tools=false`
- Command with memory action → route to save_memory tool
- Info sharing → route to save_memory tool
- Task request → use fast path (no tools needed)
- Topic switch detection → rebuild summary if entities diverged

### Phase 3: ORIENT (`oodae-decide.js`)

**What it does**: Loads context without any API call. Pure deterministic logic.

- Loads all memories from IndexedDB
- Determines reply language (saved preference → auto-detect from user text)
- Identifies memory action (save/recall/none)
- Gets user timezone

**Language detection** (`_detectLanguage`): Uses Unicode ranges — CJK → mandarin, kana → japanese, hangul → korean, Thai script → thai, Arabic script → arabic.

### Phase 4: DECIDE (`oodae-decide.js`)

**What it does**: Calls the model to select which tools to use and build an execution plan.

**Prompt → Model**: Lists available tools in compact format, includes rules, asks for JSON plan.

**Output**:
```json
{
    "plan": [
        { "tool": "web_search", "args": { "query": "Tesla stock price" }, "reason": "look up current price" }
    ]
}
```

**Retry layers** (if model fails to produce a valid plan):
1. **Primary**: Full prompt with all context and rules
2. **(implicit)**: JSON recovery via `_parseJSON` and `_recoverToolPlan`
3. **Layer 3**: Simplified fill-in-the-blank prompt — "Replace QUERY with a search query"
4. **Layer 4**: Deterministic fallback — no LLM, just web_search with entities as query

**Harnesses applied**:
- **Deictic follow-up correction**: If model translates a pronoun to the wrong entity, replace query with workspace entity
- **Memory key dedup**: Match save_memory keys against existing keys to prevent duplicates
- **Multi-intent enrichment**: If user mentioned 2+ entities but DECIDE only covered one, add searches for missed entities
- **Skill expansion**: If DECIDE selected a skill name, expand it into concrete tool steps

### Phase 5: ACT (`oodae-act.js`)

**What it does**: Executes the tool plan.

**Execution strategy**:
```
Plan steps
    │
    ├── Independent tools (get_time, get_weather, save_memory)
    │   → Execute in PARALLEL via Promise.all()
    │
    └── Search-chain tools (web_search, fetch_url, summarize_url)
        → Execute SEQUENTIALLY (each may depend on prior results)
```

Both groups run concurrently via `Promise.all([independentPromise, searchPromise])`.

**Search chain harnesses**:
- **Query shortening**: Remove filler words ("what is", "tell me about") and cap at 6 words
- **URL fetch dedup**: Skip if same URL already fetched this run
- **URL validation**: Check that fetch_url targets are from actual search results
- **Auto-fetch**: After web_search, automatically fetch the top result URL (skip social media, PDFs, images)

### Phase 6: EVALUATE (`oodae-evaluate.js`)

**What it does**: Reads tool results and either generates a final answer or requests another loop.

**Prompt → Model**: "Read the tool results CAREFULLY and answer the user's question."

**Output**:
```json
{ "needs_more": false, "final_answer": "Tesla (TSLA) is trading at $245.32..." }
// or
{ "needs_more": true, "reason": "Results were about a different entity. Try: 'Tesla Inc TSLA stock'" }
```

**Harnesses applied**:
- **Result ranking**: Sort tool results by entity relevance (fuzzy string matching)
- **Snippet sorting**: Within web_search results, sort snippets by entity match score
- **Entity name verification**: Strict rules to prevent the model from answering about a similarly-named but different entity (e.g., "ZetaCorp" ≠ "Zeta Global")

**If `needs_more=true`**: Loop back to DECIDE with the evaluator's feedback (max 3 loops).
**If max loops reached**: Force a final answer with `_forceFinalAnswer`.

---

## Part 5: Sub-Agent Delegation

**File**: `oodae-subagent.js`

For complex queries with 2+ independent entities (e.g., "Compare Tesla and Apple stock"), the system can split the work:

```
"Compare Tesla and Apple stock"
    │
    ▼ DECOMPOSE
┌──────────────────┐    ┌──────────────────┐
│  Sub-agent 1     │    │  Sub-agent 2     │
│  "Tesla stock"   │    │  "Apple stock"   │
│  DECIDE → ACT    │    │  DECIDE → ACT    │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
              EVALUATE (combined)
              "Tesla is at $X, Apple is at $Y..."
```

Each sub-agent runs its own DECIDE → ACT cycle in parallel. Results are merged for a combined EVALUATE.

---

## Part 6: Skill System

**File**: `skill-registry.js`

Skills are named multi-step workflow templates that DECIDE can invoke like tools. The orchestrator expands skill references into concrete tool plans.

### Skill Definition

```javascript
skillRegistry.add({
    name: 'deep_research',
    description: 'Deep research on a topic',
    parameters: {
        topic: { type: 'string', required: true },
        angles: { type: 'string', required: false }
    },
    planner: (args) => {
        // Dynamic: generate steps based on args
        return angles.map(angle => ({
            tool: 'web_search',
            args: { query: `${topic} ${angle}` },
            reason: `deep_research: ${angle}`
        }));
    }
});
```

### Two types of skills:
- **Static**: Fixed steps with `$variable` substitution
- **Dynamic**: Planner function that generates steps at runtime

### Built-in skills:
| Skill | Description |
|-------|-------------|
| `deep_research` | Multi-angle search on a topic |
| `compare` | Parallel search for side-by-side comparison |
| `daily_briefing` | Time + weather + news in parallel |

---

## Part 7: JSON Recovery (Critical for Weak Models)

Gemma frequently produces malformed JSON. The system has multiple layers of recovery spread across two parsers:

### `tryParseJSON` in `tool-parser.js` (for ToolRunner)

6 layers: direct parse → strip code fences → fix trailing commas → fix single quotes → fix unquoted keys → extract `{...}` substring.

### `_parseJSON` in `oodae-helpers.js` (for OODA-E)

5 layers: strip `<thinking>` tags → direct parse → strip code fences → extract `{...}` substring → fix trailing commas → repair plan array (extract valid `{"tool":...}` objects from a malformed array).

### `_recoverToolPlan` in `oodae-helpers.js` (last resort)

Regex-based extraction: finds `"tool":"name"` patterns, then extracts balanced `{...}` for args.

---

## Part 8: Error Handling and Fallbacks

### API Level (`client.js`, `core.js`)

- **Key rotation**: If an API key fails, rotate to the next key and retry
- **Retry with backoff**: For 429 (rate limit) and 500 errors, exponential backoff up to 5 retries
- **Retry-After header**: Respected if the server provides it

### OODA-E Level (`oodae.js`)

- **DECIDE retry**: 4 layers (full → JSON recovery → simplified → deterministic)
- **Max loops**: DECIDE → ACT → EVALUATE loops max 3 times
- **Force final answer**: After max loops, force-generate an answer from available results
- **Fallback to ToolRunner**: If OODA-E throws an uncaught exception, fall back to the legacy ToolRunner

```javascript
catch (err) {
    console.warn('OODA-E failed, falling back to ToolRunner:', err);
    return this._fallbackToToolRunner(userText, chatHistory, opts);
}
```

---

## Part 9: Data Flow Example

**User asks**: "What time is it in Tokyo and what's the weather in Singapore?"

```
OBSERVE
  → intent: "question"
  → entities: ["Tokyo", "Singapore"]
  → requires_tools: true

CLASSIFY
  → is_greeting: false
  → needs_tools: true
  → user_entities: ["Tokyo", "Singapore"]
  → search_entities: ["Tokyo", "Singapore"]

ORIENT (no API call)
  → language: "english"
  → memory_action: "none"
  → timezone: "Asia/Kuala_Lumpur"

DECIDE (API call)
  → plan: [
      { tool: "get_time", args: { timezone: "Asia/Tokyo" } },
      { tool: "get_weather", args: { city: "Singapore" } }
    ]

ACT
  → Partition: both are independent tools
  → Execute in PARALLEL via Promise.all()
  → Results: [
      { name: "get_time", result: { time: "2026-03-21T14:30:00+09:00" } },
      { name: "get_weather", result: { temp: "31°C", condition: "Partly cloudy" } }
    ]

EVALUATE (API call)
  → needs_more: false
  → final_answer: "It's 2:30 PM in Tokyo. Singapore weather: 31°C, partly cloudy."
```

---

## Part 10: Key Design Decisions

### Why 6 phases instead of 1 prompt?

Gemma 27B struggles with complex multi-part instructions. By asking one focused question per API call, each phase gets a **simpler prompt** that Gemma can handle reliably. The harness code between phases compensates for model weaknesses.

### Why XML tags instead of JSON mode?

Gemma's JSON output mode (`responseMimeType: 'application/json'`) is unreliable. XML tags (`<tool_call>`) are easier for the model to produce correctly and can be mixed with natural language text.

### Why two independent classifiers (OBSERVE + CLASSIFY)?

OBSERVE may misclassify due to workspace context injection (e.g., marking a new topic as a follow-up). CLASSIFY acts as an independent verifier that corrects OBSERVE's mistakes without being biased by workspace state.

### Why deterministic fallbacks?

The model may fail to produce any valid tool plan. Layer 4 (deterministic fallback) ensures the system always does *something* — even if it's just a web search with the user's entities as the query.

---

## Appendix: Token Tracking

Every API call tracks token usage via `usageMetadata.totalTokenCount`:

- `_runTokens`: Total tokens consumed across all API calls in one `run()`
- `_peakCallTokens`: Highest single-call token count

Returned in the `tokenStats` field of the run result.
