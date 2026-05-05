// ============================================================
//  oodae-observe.js — OBSERVE + CLASSIFY phases
//  Analyze user input, classify intent
//  Workspace resolution extracted to oodae-workspace.js
// ============================================================

import { HarnessConfig } from './config.js';
import { COT, quoteForPrompt } from './cot-standard.js';
import { _groundEntitiesToUserText, _looksUnderspecified } from './oodae-helpers.js';

// ===== OBSERVE: Analyze user input =====
export async function _observe(userTextOrCtx, chatHistory, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx    = userTextOrCtx && typeof userTextOrCtx === 'object' && 'userText' in userTextOrCtx;
    const userText = isCtx ? userTextOrCtx.userText   : userTextOrCtx;
    const _opts    = isCtx ? userTextOrCtx             : opts;
    const recent   = isCtx
        ? (userTextOrCtx.recent6 ?? '')
        : (this._ctx?.recent6 || this._getRecentContext(chatHistory, HarnessConfig.context.observeRecentMessages));

    const prompt = `Analyze this user message and output ONLY JSON.

User message: ${quoteForPrompt(userText)}
${recent ? `Recent conversation:\n${recent}` : ''}

RULES:
- Greetings (hi, hello, hey, 你好, etc.) → intent="greeting", requires_tools=false, key_entities=[]
- Simple chat/thanks/goodbye → requires_tools=false
- Only set requires_tools=true if the user asks a factual question needing real-time data
- If short/vague with recent context, set intent="follow_up"

${COT.observe()}

{"intent":"question|command|greeting|information_sharing|follow_up","requires_tools":true_or_false,"key_entities":["entity1"],"is_about_user":true_or_false,"summary":"one sentence summary"}

JSON:`;

    const raw = await this._callModel(prompt, {
        ..._opts,
        _phase: 'observe',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    if (!parsed) {
        const fallback = { intent: 'question', requires_tools: true, key_entities: [], is_about_user: false, summary: userText, _raw: raw };
        if (isCtx) { Object.assign(userTextOrCtx, fallback); return userTextOrCtx; }
        return fallback;
    }

    parsed.key_entities = _groundEntitiesToUserText(parsed.key_entities || [], userText);

    // If the message is self-contained, don't let OBSERVE carry a stale follow_up intent
    // forward from recent context alone.
    if (parsed.intent === 'follow_up' && !_looksUnderspecified(userText, parsed.key_entities)) {
        parsed.intent = 'question';
        parsed.summary = userText;
    }

    // ── Agent runtime harness: workspace-based follow-up resolution ──
    const wsContext = await this._resolveFromWorkspace(userText, parsed, _opts);
    if (wsContext) {
        // ── Harness: topic switch detection (Layer 1) ──
        // If user's entities have zero overlap with workspace entities → new topic, skip injection
        // P22 fix: filter pronouns — they are not real entities and cause false mismatch
        const PRONOUNS_SET = new Set([
            'he','him','his','she','her','hers','it','its','they','them','their','theirs',
            'this','that','these','those','who','whom','which','what',
            '他','她','它','他们','她们','它们','他的','她的','它的','他们的','她们的','它们的',
            '这个','那个','这家','那家','这些','那些','谁','哪个','什么',
            'dia','mereka','ini','itu',
        ]);
        const modelEntities = (parsed.key_entities || [])
            .map(e => String(e).toLowerCase())
            .filter(e => !PRONOUNS_SET.has(e));
        const wsEntities = (wsContext.entities || []).map(e => String(e).toLowerCase());

        // P23 fix: detect pronouns/demonstratives in raw user text as follow-up signal.
        // When user says "他的净资产多少？", entities are ["净资产"] with no overlap to
        // workspace ["Tesla","Elon Musk"]. But "他的" in the text IS the link — the user
        // is asking about an attribute of the previous topic's entity.
        // Possessive pronouns (他的/her/its/their) are the strongest signal.
        const textLower = userText.toLowerCase();
        const POSSESSIVE_PRONOUNS = [
            '他的','她的','它的','他们的','她们的','它们的',
            '这个','那个','这家','那家',
            'his ','her ','its ','their ',
            'this ','that ','these ','those ',
        ];
        const hasPronounRef = POSSESSIVE_PRONOUNS.some(p => textLower.includes(p));

        // P24 fix: also trust OBSERVE LLM's own follow_up classification.
        // For implicit follow-ups like "最后一次喷发是什么时候？" (no pronouns, no entity overlap),
        // the LLM sees recent conversation context and correctly detects the dependency.
        // The harness should not override the LLM's judgment in this case.
        const llmSaysFollowUp = parsed.intent === 'follow_up';

        // P27 fix: CJK/EN sentence-level follow-up pattern detection.
        // "那X呢？" = "What about X?" — Chinese rhetorical follow-up.
        // "为什么？" / "怎么？" = bare interrogatives only meaningful as follow-ups.
        // "哪个更X？" = implicit comparison with previous topic.
        const trimmedText = userText.trim();
        const CJK_FOLLOWUP_PATTERNS = [
            /^那.{0,10}呢[？?]?$/,     // 那日元呢？那除以7呢？
            /^那.{0,6}[？?]$/,          // 那呢？
            /^为什么[？?]?$/,            // 为什么？
            /^怎么[办样说]?[？?]?$/,     // 怎么？怎么办？
            /^哪个.{0,8}[？?]?$/,       // 哪个更适合旅游？
            /^然后呢[？?]?$/,            // 然后呢？
            /^还有呢[？?]?$/,            // 还有呢？
            /^多少[？?]?$/,              // 多少？
            /^什么时候[？?]?$/,          // 什么时候？
        ];
        const EN_FOLLOWUP_PATTERNS = [
            /^why\??$/i,                  // "Why?"
            /^how come\??$/i,             // "How come?"
            /^what about /i,              // "What about X?"
            /^and /i,                     // "And the other one?"
            /^which (one|is) /i,          // "Which one is better?"
        ];
        const hasSentencePattern = CJK_FOLLOWUP_PATTERNS.some(p => p.test(trimmedText))
            || EN_FOLLOWUP_PATTERNS.some(p => p.test(trimmedText));

        const hasOverlap = modelEntities.length === 0 || hasPronounRef || hasSentencePattern || llmSaysFollowUp || modelEntities.some(me =>
            wsEntities.some(we => we.includes(me) || me.includes(we))
        );

        // Deictic/reference detection is deferred to CLASSIFY agent (is_reference field)
        // Layer 1 only checks entity overlap; if no overlap, tentatively skip injection
        // but mark that workspace context was available (CLASSIFY may override via is_reference)
        if (!hasOverlap) {
            parsed._wsContextAvailable = wsContext; // preserve for CLASSIFY override
            const result = { ...parsed, _raw: raw };
            if (isCtx) { Object.assign(userTextOrCtx, result); return userTextOrCtx; }
            return result;
        }

        parsed.intent = 'follow_up';
        parsed.requires_tools = true;
        parsed.key_entities = [...new Set([...(wsContext.entities || []), ...(parsed.key_entities || [])])];
        // P23 fix: always replace summary with raw userText + workspace topic.
        if (wsContext.topic) {
            parsed.summary = `${userText} (about: ${wsContext.topic})`;
        }
        // P27 fix: propagate recentEntity for deictic correction anchor.
        // The leaf node entity is the most likely pronoun referent.
        if (wsContext.recentEntity) {
            parsed._wsRecentEntity = wsContext.recentEntity;
        }
    }

    const finalResult = { ...parsed, _raw: raw };
    if (isCtx) { Object.assign(userTextOrCtx, finalResult); return userTextOrCtx; }
    return finalResult;
}

// ===== Intent Classifier Agent (independent API call) =====
export async function _classifyIntent(userText, observation, opts) {
    const prompt = `You are an intent verification agent. The OBSERVE agent classified the user's message.
Review and CORRECT if needed.

User message: ${quoteForPrompt(userText)}
OBSERVE result: intent="${observation.intent}", requires_tools=${observation.requires_tools}, is_about_user=${observation.is_about_user}, entities=[${(observation.key_entities || []).join(', ')}]

CHECK EACH:

1. GREETING CHECK: Is this a greeting/hello in ANY language?
   (hi, hello, hey, 你好, bonjour, hola, ohayo, etc.)
   → If YES: is_greeting=true

2. COMMAND CHECK: Is this a PREFERENCE or SETTING that should be SAVED?
   (remember X, always do X, don't do X, use X language, 以后用中文回复, etc.)
   NOT a question. NOT information sharing like "my name is X".
   NOT a task/generation request (write X, draft X, compose X, translate X, summarize X, explain X).
   NOT a computation/math request (multiply X, add X, subtract X, calculate X, convert X to Y).
   Task requests and computations are things the assistant DOES, not settings it SAVES.
   → If YES: is_command=true, memory_action="save", save_key="descriptive_key", save_value="the value"
   For LANGUAGE preferences, normalize save_value to a standard name:
   中文/Chinese/华语/普通话 → "mandarin", BM/Bahasa/Melayu → "malay", 日本語/Japanese → "japanese", English → "english"
   Use the English language name in lowercase for any other language.

3. FACTUAL QUESTION CHECK: Does this need real-time data/tools to answer?
   (who is X, what time, weather, search, company info, address, news, etc.)
   → If YES: needs_tools=true

4. ACKNOWLEDGMENT CHECK: Is this just an acknowledgment with no question?
   (ok, i see, thanks, got it, 好的, understood, etc.)
   → If YES: is_acknowledgment=true

5. ENTITY CHECK: Which entities are ONLY from the user's current message?
   Do NOT include entities from conversation history that the user did NOT mention.
   → user_entities=["only", "from", "current", "message"]

6. REFERENCE CHECK: Does the message refer BACK to a previous topic?
   This includes:
   - Pronouns/demonstratives: "this field", "that company", "their CEO", "its price", "这个领域"
   - Implicit context: short questions that ONLY make sense with previous context
     (e.g. "boss name?" "address?" "how much?" "when?" — these need a subject from earlier)
   - Questions about a role/attribute of a previously discussed entity:
     "who is the CEO?" (after discussing a company) → is_reference=true
     "what's the stock price?" (after discussing a stock/company) → is_reference=true
     "how many employees?" (after discussing a company) → is_reference=true
     "他们的CEO是谁?" (after discussing a company) → is_reference=true
   - Definite article "the" as implicit reference:
     "what is the stock price?" (no company named → refers to previous company) → is_reference=true
     "what is the CEO's name?" (no company named → refers to previous company) → is_reference=true
     "where is the headquarters?" (no entity named → refers to previous topic) → is_reference=true
     NOTE: "the" + attribute WITHOUT a named entity = implicit back-reference.
   - "tell me more", "what else", "any updates"
   KEY: If the question is about an attribute (CEO, price, address, size, revenue, employees, headquarters, founder)
   but does NOT name a specific entity — including when "the" is used without naming WHO/WHAT — it MUST be referencing a previous topic → is_reference=true.
   The user is NOT introducing a new topic — they need context from what was discussed before.
   → If YES: is_reference=true

7. SEARCH ENTITY FILTER: From user_entities, which are specific enough to use as search queries?
   REMOVE generic/vague words: "companies", "company", "people", "person", "things", "latest", "recent", "best", "top", "type", "types", "information", "details", "data", "results", "list", "stuff", "new", "old", "other", "more" — or equivalents in any language.
   KEEP: named entities, specific topics, technical terms, proper nouns, unique identifiers.
   → search_entities=["only", "searchable", "specific", "entities"]

8. INFO SHARING CHECK: Is the user sharing PERSONAL information about THEMSELVES?
   (I am X, my name is X, I work at X, I live in X, I like X, I'm a X, 我是X, 我叫X, etc.)
   This is the user TELLING you something — NOT asking a question, NOT requesting a search.
   "I am a software engineer in Shanghai" → is_info_sharing=true (user is sharing their info)
   "software engineers in Shanghai" → is_info_sharing=false (this is a search query)
   → If YES: is_info_sharing=true, memory_action="save", save_key="descriptive_key", save_value="the value"

   ⚠️ CRITICAL: QUESTIONS about user info are NOT info sharing! They are RECALL requests.
   If the message contains a question word (什么/哪里/几岁/多大/什么时候/who/what/where/how/when/which)
   AND is about the user (我叫什么/what is my name/where do I live), this is a RECALL, not SAVE.
   - "我叫什么名字？" → is_info_sharing=false, memory_action="recall" (ASKING, not telling)
   - "what is my name?" → is_info_sharing=false, memory_action="recall" (ASKING, not telling)
   - "我住在哪里？" → is_info_sharing=false, memory_action="recall" (ASKING, not telling)
   - "我叫小明" → is_info_sharing=true, memory_action="save" (TELLING, not asking)
   - "my name is John" → is_info_sharing=true, memory_action="save" (TELLING, not asking)

   Examples of SAVE (user is TELLING):
   - "I am a software engineer" → save_key="user_occupation", save_value="software engineer"
   - "my name is John" → save_key="user_name", save_value="John"
   - "I live in Shanghai" → save_key="user_location", save_value="Shanghai"

   COMPOUND INFO SPLITTING: If the user shares MULTIPLE facts in one sentence, return save_pairs array:
   - "my name is David and I work at Microsoft" → memory_action="save", save_pairs=[{"key":"user_name","value":"David"},{"key":"user_employer","value":"Microsoft"}]
   - "I'm a 30-year-old engineer in NYC" → save_pairs=[{"key":"user_age","value":"30"},{"key":"user_occupation","value":"engineer"},{"key":"user_location","value":"NYC"}]
   When save_pairs is provided, save_key/save_value should be the FIRST pair (for backward compatibility).

9. TASK/GENERATION CHECK: Is the user asking you to CREATE or GENERATE content?
   (write X, draft X, compose X, translate X, summarize X, explain X, create X, 写X, 翻译X, 帮我写X, etc.)
   This is something you DO using your own knowledge — NOT a setting to save, NOT a factual lookup.
   "write me an email declining a meeting" → is_task_request=true (generate content)
   "draft a poem about the moon" → is_task_request=true (generate content)
   "translate this to English" → is_task_request=true (generate content)
   "remember to reply in mandarin" → is_task_request=false (this is a preference/setting)
   "what is the weather?" → is_task_request=false (this is a factual query)
   → If YES: is_task_request=true

${COT.classify()}

{"is_greeting":false,"is_command":false,"is_acknowledgment":false,"is_info_sharing":false,"is_task_request":false,"needs_tools":false,"is_reference":false,"memory_action":null,"save_key":null,"save_value":null,"user_entities":["entities from user text only"],"search_entities":["specific searchable entities only"]}

JSON:`;

    try {
        const raw = await this._callModel(prompt, {
            ...opts,
            _phase: 'classify',
            generationConfig: { ...HarnessConfig.generation.deterministic }
        });
        const parsed = this._parseJSON(raw);
        if (parsed) {
            return { ...parsed, _raw: raw };
        }
    } catch (e) { console.warn('CLASSIFY: failed, falling back to OBSERVE:', e.message); }
    // Fallback: trust OBSERVE as-is
    return {
        is_greeting: false, is_command: false, is_acknowledgment: false,
        is_task_request: false,
        needs_tools: observation.requires_tools,
        memory_action: null, save_key: null, save_value: null,
        user_entities: observation.key_entities || [],
        search_entities: observation.key_entities || []
    };
}
