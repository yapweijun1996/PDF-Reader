// ============================================================
//  oodae-decide.js — ORIENT + DECIDE phases
//  Memory loading, tool selection
//  Multi-intent enrichment extracted to oodae-plan-post.js
// ============================================================

import { HarnessConfig } from './config.js';
import { COT } from './cot-standard.js';
import { getAgentsDefaultLanguage } from './agents-config.js';

const FX_CURRENCY_ALIASES = {
    usd: 'USD',
    'us dollar': 'USD',
    'us dollars': 'USD',
    dollar: 'USD',
    dollars: 'USD',
    美元: 'USD',
    eur: 'EUR',
    euro: 'EUR',
    euros: 'EUR',
    欧元: 'EUR',
    gbp: 'GBP',
    pound: 'GBP',
    pounds: 'GBP',
    'british pound': 'GBP',
    英镑: 'GBP',
    jpy: 'JPY',
    yen: 'JPY',
    'japanese yen': 'JPY',
    日元: 'JPY',
    sgd: 'SGD',
    'singapore dollar': 'SGD',
    'singapore dollars': 'SGD',
    新币: 'SGD',
    新元: 'SGD',
    新加坡元: 'SGD',
    myr: 'MYR',
    ringgit: 'MYR',
    'malaysian ringgit': 'MYR',
    马币: 'MYR',
    令吉: 'MYR',
    cny: 'CNY',
    rmb: 'CNY',
    yuan: 'CNY',
    人民币: 'CNY',
    aud: 'AUD',
    'australian dollar': 'AUD',
    'australian dollars': 'AUD',
    澳元: 'AUD'
};

const FX_ARG_ALIASES = {
    amount: ['amount', 'value', 'qty', 'quantity', 'sum'],
    from: ['from', 'base', 'source', 'source_currency', 'base_currency', 'origin_currency'],
    to: ['to', 'quote', 'target', 'target_currency', 'destination_currency', 'quote_currency']
};

const GEOCODE_QUERY_KEYS = ['query', 'place', 'address', 'location', 'city', 'name', 'search'];

function _escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _pairsToObject(entries) {
    const out = {};
    if (!Array.isArray(entries)) return out;
    for (const item of entries) {
        if (!item || typeof item !== 'object') continue;
        const key = item.argument_name || item.name || item.key || item.param;
        const value = item.argument_value ?? item.value ?? item.val;
        if (key) out[key] = value;
    }
    return out;
}

function _normalizePlanArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return {};

    let normalized = { ...args };
    for (const wrapper of ['arguments', 'parameters', 'params']) {
        const wrapped = normalized[wrapper];
        if (!wrapped) continue;
        const unpacked = Array.isArray(wrapped)
            ? _pairsToObject(wrapped)
            : (typeof wrapped === 'object' ? wrapped : {});
        delete normalized[wrapper];
        normalized = { ...unpacked, ...normalized };
    }
    return normalized;
}

function _pickAliasValue(args, names) {
    for (const name of names) {
        const value = args[name];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
}

function _normalizeCurrencyCode(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase().replace(/\.$/, '');
    if (!normalized) return null;
    if (FX_CURRENCY_ALIASES[normalized]) return FX_CURRENCY_ALIASES[normalized];
    const compact = normalized.replace(/\s+/g, ' ');
    if (FX_CURRENCY_ALIASES[compact]) return FX_CURRENCY_ALIASES[compact];
    const code = compact.toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

function _normalizeReplyLanguage(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    return HarnessConfig.policies.langAliases[raw] || raw;
}

const FX_CURRENCY_PATTERN = new RegExp(
    Object.keys(FX_CURRENCY_ALIASES)
        .sort((a, b) => b.length - a.length)
        .map(_escapeRegExp)
        .join('|'),
    'giu'
);

function _extractCurrencyMentions(text) {
    const mentions = [];
    if (!text) return mentions;
    for (const match of text.matchAll(FX_CURRENCY_PATTERN)) {
        const alias = match[0].toLowerCase();
        const code = FX_CURRENCY_ALIASES[alias];
        if (!code) continue;
        if (mentions.length > 0) {
            const prev = mentions[mentions.length - 1];
            if (prev.code === code && prev.index === match.index) continue;
        }
        mentions.push({ code, index: match.index, alias });
    }
    return mentions;
}

function _extractAmount(text) {
    if (!text) return undefined;
    const match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!match) return undefined;
    const amount = Number(match[0].replace(/,/g, ''));
    return Number.isNaN(amount) ? undefined : amount;
}

function _repairExchangeRateArgs(args, observation) {
    const repaired = { ...args };

    const amountValue = _pickAliasValue(repaired, FX_ARG_ALIASES.amount);
    const fromValue = _pickAliasValue(repaired, FX_ARG_ALIASES.from);
    const toValue = _pickAliasValue(repaired, FX_ARG_ALIASES.to);

    if (amountValue !== undefined && repaired.amount === undefined) repaired.amount = amountValue;
    if (repaired.from === undefined && fromValue !== undefined) repaired.from = fromValue;
    if (repaired.to === undefined && toValue !== undefined) repaired.to = toValue;

    repaired.from = _normalizeCurrencyCode(repaired.from) || repaired.from;
    repaired.to = _normalizeCurrencyCode(repaired.to) || repaired.to;

    const text = (observation.summary || '').replace(/\s*\(about:.*\)\s*$/, '');
    const mentions = _extractCurrencyMentions(text);
    if (!repaired.from && mentions[0]) repaired.from = mentions[0].code;
    if (!repaired.to) {
        const fallback = mentions.find(m => m.code !== repaired.from) || mentions[1];
        if (fallback) repaired.to = fallback.code;
    }
    if (repaired.amount === undefined) {
        const extracted = _extractAmount(text);
        if (extracted !== undefined) repaired.amount = extracted;
    }
    if (repaired.amount === undefined) repaired.amount = 1;

    return repaired;
}

function _normalizeSaveMemoryArgs(args, observation) {
    const repaired = { ...args };
    const key = String(repaired.key || '').trim().toLowerCase();
    const text = String(observation.summary || observation.userText || '').toLowerCase();
    if (!key) return repaired;

    if (['name', 'my_name', 'username', 'person_name'].includes(key)) {
        if (/\b(cat|dog|pet)\b/.test(text)) repaired.key = 'pet_name';
        else repaired.key = 'user_name';
    } else if (['location', 'city', 'home', 'place'].includes(key) && /\b(i live in|i am in|live at)\b|住在|住址/.test(text)) {
        repaired.key = 'user_location';
    }

    if (typeof repaired.value === 'string') {
        repaired.value = repaired.value.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '');
    }
    return repaired;
}

export function _expandMultiTargetExchangeRatePlan(plan, observation) {
    if (!plan?.plan || plan.plan.length === 0) return plan;
    const fxIndexes = plan.plan
        .map((step, index) => step?.tool === 'exchange_rate' ? index : -1)
        .filter(index => index >= 0);
    if (fxIndexes.length !== 1) return plan;

    const text = String(observation.summary || observation.userText || '').replace(/\s*\(about:.*\)\s*$/, '');
    const mentions = _extractCurrencyMentions(text);
    if (mentions.length < 3) return plan;

    const stepIndex = fxIndexes[0];
    const seedStep = plan.plan[stepIndex];
    const repaired = _repairExchangeRateArgs(seedStep.args || {}, observation);
    const from = _normalizeCurrencyCode(repaired.from) || mentions[0]?.code;
    if (!from) return plan;

    const targets = [];
    for (const mention of mentions) {
        if (!mention?.code || mention.code === from || targets.includes(mention.code)) continue;
        targets.push(mention.code);
    }
    if (targets.length <= 1) return plan;

    const amount = repaired.amount ?? _extractAmount(text) ?? 1;
    const expanded = targets.map(to => ({
        ...seedStep,
        args: { amount, from, to },
        reason: seedStep.reason ? `${seedStep.reason} (${to})` : `fx conversion (${to})`
    }));

    plan.plan.splice(stepIndex, 1, ...expanded);
    return plan;
}

function _repairGeocodeArgs(args) {
    const repaired = { ...args };
    if (repaired.query) return repaired;
    const queryValue = _pickAliasValue(repaired, GEOCODE_QUERY_KEYS);
    if (queryValue !== undefined) repaired.query = queryValue;
    return repaired;
}

function _repairStepArgs(step, observation) {
    if (!step || !step.tool) return;
    let args = _normalizePlanArgs(step.args);
    if (step.tool === 'exchange_rate') {
        args = _repairExchangeRateArgs(args, observation);
    } else if (step.tool === 'geocode') {
        args = _repairGeocodeArgs(args);
    } else if (step.tool === 'save_memory') {
        args = _normalizeSaveMemoryArgs(args, observation);
    }
    step.args = args;
}

// ===== ORIENT: Load memories + determine context (NO API call) =====
export async function _orient(observationOrCtx, opts, userText) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx     = observationOrCtx && typeof observationOrCtx === 'object' && 'userText' in observationOrCtx;
    const observation = observationOrCtx;   // ctx IS the observation (same fields)
    const _opts     = isCtx ? observationOrCtx : opts;
    const _userText = isCtx ? observationOrCtx.userText : userText;

    let memories = [];
    try {
        if (_opts.memoryDB) memories = await _opts.memoryDB.getAllMemories();
    } catch (e) { console.warn('ORIENT: failed to load memories:', e.message); }

    const userProfile = {};
    for (const mem of memories) {
        // Include ALL memories in user profile regardless of category —
        // model often saves with default category='general' instead of 'user_profile',
        // causing recalls like "what is my name?" to miss saved data
        if (mem.key && mem.value != null) userProfile[mem.key] = mem.value;
    }

    // Match any memory key containing "lang" — works for preferred_language, reply_language, etc.
    const langKey = Object.keys(userProfile).find(k => /lang/i.test(k));
    const languagePref = langKey ? userProfile[langKey] : null;

    // ── Language: use CLASSIFY-normalized value directly, with legacy alias fallback ──
    const LANG_ALIASES = HarnessConfig.policies.langAliases;
    let replyLanguage = 'english';
    const pendingLanguagePref = observation._memoryAction === 'save' && /lang/i.test(observation._saveKey || '')
        ? _normalizeReplyLanguage(observation._saveValue)
        : null;
    if (pendingLanguagePref) {
        replyLanguage = pendingLanguagePref;
    } else if (languagePref) {
        const lp = languagePref.toLowerCase().trim();
        replyLanguage = LANG_ALIASES[lp] || lp;
    } else if (_userText) {
        // P21 fix: auto-detect language from user input when no saved preference
        const detected = this._detectLanguage(_userText);
        if (detected) replyLanguage = detected;
    }
    // ── AGENTS.md language default: override 'english' fallback when persona specifies a default ──
    // Only applies when no user memory pref AND no detected language (i.e. replyLanguage is still 'english').
    // User explicit language detection always wins over AGENTS.md.
    if (replyLanguage === 'english' && !languagePref) {
        const agentsCfg = isCtx ? observationOrCtx.agentsConfig : null;
        const agentsLang = getAgentsDefaultLanguage(agentsCfg);
        if (agentsLang && agentsLang !== 'english') {
            replyLanguage = agentsLang;
        }
    }

    let memoryAction = 'none';
    if (observation._memoryAction) {
        memoryAction = observation._memoryAction;
    } else if (observation.is_about_user) {
        memoryAction = observation.intent === 'information_sharing' ? 'save' : 'recall';
    }

    const userTimezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

    // ── Cache formatted profile strings in shared context ──
    // Avoids reformatting in EVALUATE and DIRECT_RESPONSE
    if (this._ctx && Object.keys(userProfile).length > 0) {
        // Flat format for EVALUATE recall
        this._ctx.formattedProfileRecall = Object.entries(userProfile).map(([k, v]) => `${k}=${v}`).join(', ');
        // Semantic format for DIRECT_RESPONSE (with pet disambiguation)
        this._ctx.formattedProfile = Object.entries(userProfile).map(([k, v]) => {
            const kl = k.toLowerCase();
            if (kl.includes('cat_') || kl.includes('dog_') || kl.includes('pet_'))
                return `${k}=${v} (this is about user's PET, not the user)`;
            return `${k}=${v}`;
        }).join(', ');
    }

    const result = {
        language: replyLanguage,
        language_raw: languagePref,
        user_profile: userProfile,
        all_memories: memories,
        memory_action: memoryAction,
        memory_count: memories.length,
        timezone: userTimezone,
        _additionalContext: null
    };

    // ── COODAE: also write orientation fields to ctx when called with ctx ──
    if (isCtx) {
        observationOrCtx.language      = replyLanguage;
        observationOrCtx.language_raw  = languagePref;
        observationOrCtx.user_profile  = userProfile;
        observationOrCtx.all_memories  = memories;
        observationOrCtx.memory_action = memoryAction;
        observationOrCtx.memory_count  = memories.length;
        observationOrCtx.timezone      = userTimezone;
        return observationOrCtx;  // ctx IS the unified orientation; callers use ctx as alias
    }

    return result;
}

// ===== DECIDE: Select tools and build plan =====
export async function _decide(observation, orientation, opts, previousResults = [], classification = null, strategy = 'default') {
    const toolDefs = this._buildToolDefsCompact();

    // ── Proactive re-planning: strategy-specific guidance ──
    let strategyHint = '';
    if (strategy && strategy !== 'default') {
        const hints = {
            broaden: 'STRATEGY: BROADEN — Previous searches were too narrow/specific. Use MORE GENERAL terms. Remove specific qualifiers. Search for the category instead of exact names. Example: instead of "ZetaCorp Pte Ltd revenue 2024", try just "ZetaCorp".',
            narrow: 'STRATEGY: NARROW — Previous searches were too broad. Add SPECIFIC qualifiers: year, country, role, industry. Use exact full names. Example: instead of "Tesla CEO", try "Tesla Inc CEO 2024 name".',
            deep_research: 'STRATEGY: DEEP RESEARCH — Use the deep_research skill for multi-angle investigation. This question needs comprehensive research, not a single search.',
            alternative_source: 'STRATEGY: ALTERNATIVE SOURCE — Try DIFFERENT tools. If web_search failed, try ddg_search. Try fetch_url on an authoritative domain directly (e.g., Wikipedia, official site).',
            decompose: 'STRATEGY: DECOMPOSE — Break this into SMALLER questions. Search for each piece separately with focused queries. Multiple simple searches > one complex search.'
        };
        strategyHint = `\n${hints[strategy] || ''}\n`;
    }

    // Include skills if skill registry is available
    let skillDefs = '';
    if (this.skillRegistry && this.skillRegistry.size > 0) {
        skillDefs = '\n\nAVAILABLE SKILLS (multi-step workflows — use like tools):\n' +
            this.skillRegistry.list().map(s => {
                const params = Object.entries(s.parameters || {})
                    .map(([k, v]) => `${k}${v.required ? '*' : ''}:${v.type || 'str'}`)
                    .join(', ');
                return `- ${s.name}(${params}): ${(s.description || '').slice(0, 80)}`;
            }).join('\n');
    }

    let prevInfo = '';
    if (previousResults.length > 0) {
        const prevSearches = previousResults.filter(r => r.name === 'web_search');
        const prevQueries = prevSearches.map(r => `"${r.args?.query || '?'}"`).join(', ');
        prevInfo = prevQueries
            ? `\nPREVIOUS SEARCHES TRIED: ${prevQueries}\nDo NOT use these same queries. Try DIFFERENT shorter keywords.\n`
            : `\nPREVIOUS ATTEMPTS failed. Try a DIFFERENT approach.\n`;
    }

    let additionalCtx = '';
    if (orientation._additionalContext) {
        additionalCtx = `\nFEEDBACK FROM EVALUATOR: ${orientation._additionalContext}
TRY A DIFFERENT APPROACH:
- Use different search keywords (synonyms, alternative phrasing)
- Add more specific qualifiers (location, year, role)
- Try broader or narrower queries depending on previous failure\n`;
    }

    // ── GoalManager: inject parent goal context into DECIDE ──
    let goalCtx = '';
    if (orientation._goalContext) {
        const gc = orientation._goalContext;
        goalCtx = `\nGOAL CONTEXT: This is sub-goal ${gc.subgoalIndex + 1} of a larger goal: "${gc.goalDescription}"
Sub-goal: "${gc.subgoalDescription}"
Focus ONLY on this sub-goal. Do NOT try to answer the full goal.\n`;
    }

    // ── Harness: cross-turn repeated search avoidance ──
    let knownInfo = '';
    const knownAnswers = this._extractKnownAnswers(opts.chatHistory);
    if (knownAnswers.length > 0 && previousResults.length === 0) {
        knownInfo = `\nALREADY KNOWN (from conversation — do NOT re-search):\n${knownAnswers.map(a => `- ${a}`).join('\n')}\n`;
    }

    // ── P29a: inject recent conversation context into DECIDE ──
    // DECIDE previously operated in a vacuum — only saw observation.summary + entities.
    // For follow-ups like "那价格呢？", DECIDE needs to know what was just discussed.
    let conversationCtx = '';
    if (opts.chatHistory && opts.chatHistory.length > 0) {
        const recent = this._ctx?.recent3 || this._getRecentContext(opts.chatHistory, 3);
        if (recent && recent.length > 10) {
            conversationCtx = `\nRECENT CONVERSATION:\n${recent}\n`;
        }
    }

    // ── P29c: inject user profile for contextual queries ──
    // If user saved location=Shanghai, query about "附近餐厅" should include Shanghai.
    let profileCtx = '';
    if (orientation.user_profile && Object.keys(orientation.user_profile).length > 0) {
        const profileEntries = Object.entries(orientation.user_profile)
            .filter(([k, v]) => v && String(v).length > 0 && String(v).length < 100)
            .slice(0, 5)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        if (profileEntries) {
            profileCtx = `\nUSER PROFILE: ${profileEntries}\n`;
        }
    }

    // ── P29d: search language guidance for mixed-language queries ──
    let searchLangHint = '';
    if (orientation.language && orientation.language !== 'english') {
        searchLangHint = `\nSEARCH LANGUAGE: The user speaks ${orientation.language}. For search queries:
- Use ENGLISH queries for international entities (companies, people, places with English names)
- Use the entity's ORIGINAL language name (e.g., "Tesla CEO" not "特斯拉 CEO")
- For local/regional topics, use the local language (e.g., "上海美食推荐" for Shanghai food)
- NEVER mix languages in a single search query — pick the language that gets best results\n`;
    }

    // Explicit entity passing — prefer CLASSIFY's user_entities over OBSERVE's (may be workspace-contaminated)
    // Exception: CLASSIFY's is_reference OR OBSERVE's workspace-resolved follow_up means
    // user refers back to previous topic; use OBSERVE's workspace-enriched entities.
    // P23 fix: CLASSIFY often fails is_reference for CJK pronouns (他的/她的).
    // If OBSERVE already resolved follow-up via workspace (intent=follow_up), trust it.
    const classifiedEntities = classification?.user_entities;
    const isReferenceFollowUp = !!classification?.is_reference || observation.intent === 'follow_up';
    const searchEntities = isReferenceFollowUp
        ? (observation.key_entities || [])
        : (classifiedEntities && classifiedEntities.length > 0
            ? classifiedEntities
            : (observation.key_entities || []));
    const entityLine = searchEntities.map(e => String(e)).join(', ') || 'none';

    const prompt = `You must select tools to help answer the user's question.

USER WANTS: ${observation.summary}
ENTITIES: ${entityLine}${classifiedEntities && !isReferenceFollowUp ? `\nSEARCH ENTITIES (use these for queries): ${classifiedEntities.join(', ')}` : ''}
MEMORY ACTION: ${orientation.memory_action}${orientation.memory_action === 'save' && orientation.all_memories?.length > 0 ? `\nEXISTING MEMORY KEYS: ${orientation.all_memories.map(m => m.key).join(', ')}` : ''}
USER TIMEZONE: ${orientation.timezone || 'UTC'}
${profileCtx}${conversationCtx}${searchLangHint}${strategyHint}${prevInfo}${additionalCtx}${knownInfo}${goalCtx}
AVAILABLE TOOLS:
${toolDefs}${skillDefs}

${COT.decide(previousResults.length > 0)}

EXAMPLES of good plans:
- "Who is the CEO of Tesla?" → {"plan":[{"tool":"web_search","args":{"query":"Tesla CEO"},"reason":"find CEO"}]}
- "Remember my name is John" → {"plan":[{"tool":"save_memory","args":{"key":"user_name","value":"John"},"reason":"save user name"}]}
- "What time is it in Tokyo?" → {"plan":[{"tool":"get_time","args":{"timezone":"Asia/Tokyo"},"reason":"get Tokyo time"}]}
- "What's the weather in London?" → {"plan":[{"tool":"get_weather","args":{"city":"London"},"reason":"get weather"}]}

RULES:
1. You MUST select at least one tool. Do NOT return an empty plan.
2. SEARCH QUERY RULES:
   - Drop filler words (who is, what is, tell me about, etc.)
   - Keep queries concise: entity name + keyword
   - ALWAYS keep full entity names including legal suffixes (Pte Ltd, Sdn Bhd, Inc, Corp, LLC, GmbH, Co Ltd) — dropping these may match a completely different organization
   - When searching for a person's role at a specific company, include the full company name
3. For questions about the SITE OWNER, this website, GemmaClient, or services offered → use search_knowledge FIRST (if available). Only fall back to web_search if search_knowledge returns no relevant results.
4. For any search/question about an EXTERNAL company, person, topic → use web_search
5. For "recall" memory action → use recall_memory or list_memories
6. For "save" memory action → use save_memory. If EXISTING MEMORY KEYS are listed, check if one matches what you want to save — use the EXACT existing key to UPDATE it (e.g., if "favorite_sport" exists, use "favorite_sport", NOT "user_favorite_sport"). Only create a new key if no existing key matches.
7. For news → use web_search or tech_news
8. For time/date → use get_time with timezone="${orientation.timezone || 'UTC'}"
9. For weather → use get_weather
10. For URLs → use fetch_url
11. Do NOT add fetch_url after web_search — the system reads top results automatically.
12. ONLY select tools for the user's CURRENT question. Ignore topics from previous conversation turns.
13. FOLLOW-UP REFERENCE RESOLUTION: If USER WANTS contains "(about: X)", the user is referring to "X" using pronouns or demonstratives (this, that, it, 这个, 那个, 这家, 那家).
    - Use "X" DIRECTLY as the main entity in your search query.
    - Do NOT translate pronouns/demonstratives into a DIFFERENT entity.
    - Example: "这个联盟还有哪些航空公司? (about: Star Alliance)" → query: "Star Alliance member airlines", NOT "英雄联盟 航空公司".

{"plan":[{"tool":"tool_name","args":{...},"reason":"why"}]}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts,
        _phase: 'decide',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    if (parsed && Array.isArray(parsed.plan)) {
        for (const step of parsed.plan) _repairStepArgs(step, observation);
        _expandMultiTargetExchangeRatePlan(parsed, observation);

        // ── Harness: deictic follow-up query correction ──
        // If workspace-enriched follow-up and DECIDE's search query misses the key entity, inject it.
        // P20 fix: when model translates a pronoun/demonstrative to the WRONG entity (e.g., "联盟" → "英雄联盟"),
        // replace the entire query with entity-based keywords instead of just prepending.
        // P22 fix: when model generates a META-query (asking for clarification instead of searching),
        // build the query from the user's original text + the top workspace entity.
        if (isReferenceFollowUp && searchEntities.length > 0) {
            // P23 fix: use top 2 entities for better search context.
            // For "他的净资产多少？" with entities ["Tesla","Elon Musk","净资产"],
            // using only "Tesla" gives company financials; "Tesla Elon Musk" gives personal net worth.
            // P24 fix: use >= 2 threshold (not > 3) for CJK compatibility.
            // CJK entities are shorter: "富士山"=3, "日本"=2, "Tesla"=5.
            const relevantEntities = searchEntities.filter(e => String(e).length >= 2).slice(0, 2);
            const topEntity = relevantEntities.map(e => String(e)).join(' ') || String(searchEntities[0]);
            const topLower = topEntity.toLowerCase();
            for (const step of parsed.plan) {
                if (step.tool === 'web_search' && step.args?.query) {
                    const qLower = step.args.query.toLowerCase();
                    if (!qLower.includes(topLower.slice(0, Math.min(topLower.length, 10)))) {
                        // P22: Extract keywords from USER's ORIGINAL text, not the LLM's generated query.
                        // The LLM may generate meta-queries like "提供他的姓名以便搜索" instead of real searches.
                        // Using the user's actual question gives much better keywords.
                        const pronouns = /\b(this|that|these|those|it|its|they|their|them|the|his|her|who|what|how much|how many)\b|这个|那个|这家|那家|他们的|她们的|它们的|他们|她们|它们|他的|她的|它的|他|她|它|谁|什么|多少/gi;
                        const userSummary = observation.summary || '';
                        // Remove the "(about: ...)" suffix to get clean user text
                        const userClean = userSummary.replace(/\s*\(about:.*\)\s*$/, '');
                        const userKeywords = userClean.replace(pronouns, '').replace(/[？?。！!，,]/g, '').trim();
                        // Also try cleaning the LLM query as fallback
                        const queryKeywords = step.args.query.replace(pronouns, '').trim();
                        // Use user keywords if they contain meaningful content, else LLM query
                        const keywords = (userKeywords.length >= 2) ? userKeywords : queryKeywords;
                        step.args.query = keywords ? `${topEntity} ${keywords}` : topEntity;
                        step._corrected = true;
                    }
                }
            }
        }

        // ── Bug 1 fix: force save_memory when _memoryAction=save ──
        // DECIDE's LLM often ignores MEMORY ACTION: save and generates web_search instead.
        // If CLASSIFY already extracted save_key/save_value, enforce it deterministically.
        // ── Bug 3 safety guard: don't force save with garbage values ──
        // CLASSIFY sometimes misclassifies recall questions as save with value="unknown".
        // Also skip if OBSERVE detected a question intent (questions recall, not save).
        const saveValue = observation._saveValue || '';
        const isBogusValue = !saveValue || /^(unknown|null|undefined|none|\?)$/i.test(saveValue.trim());
        const isQuestionIntent = observation.intent === 'question' || observation.intent === 'follow_up';
        if (orientation.memory_action === 'save' && observation._saveKey && observation._saveValue
            && !isBogusValue && !isQuestionIntent) {
            const hasSave = parsed.plan.some(s => s.tool === 'save_memory');
            if (!hasSave) {
                // Remove any web_search steps that were generated instead of save_memory
                parsed.plan = parsed.plan.filter(s => s.tool !== 'web_search');
                // Compound info: multiple save_memory calls from save_pairs
                if (Array.isArray(observation._savePairs) && observation._savePairs.length > 1) {
                    for (const pair of observation._savePairs) {
                        if (pair.key && pair.value) {
                            parsed.plan.push({
                                tool: 'save_memory',
                                args: { key: pair.key, value: pair.value },
                                reason: 'forced by _memoryAction=save (compound split)'
                            });
                        }
                    }
                } else {
                    parsed.plan.unshift({
                        tool: 'save_memory',
                        args: { key: observation._saveKey, value: observation._saveValue },
                        reason: 'forced by _memoryAction=save'
                    });
                }
            }
        }

        // ── P18 fix: memory key dedup — match save_memory/recall_memory keys against existing memory ──
        if (orientation.all_memories?.length > 0) {
            const existingKeys = orientation.all_memories.map(m => m.key);
            for (const step of parsed.plan) {
                if (step.tool === 'save_memory' && step.args?.key) {
                    const match = this._findMatchingMemKey(step.args.key, existingKeys);
                    if (match && match !== step.args.key) {
                        step.args.key = match;
                        step._keyDeduped = true;
                    }
                }
                // P27 fix: normalize recall_memory query/key against existing memory keys.
                // Prevents "cat_name" missing "pet_name" due to DECIDE LLM using different keys.
                if (step.tool === 'recall_memory') {
                    const recallKey = step.args?.key || step.args?.query;
                    if (recallKey) {
                        const match = this._findMatchingMemKey(recallKey, existingKeys);
                        if (match) {
                            if (step.args.key) step.args.key = match;
                            if (step.args.query) step.args.query = match;
                        }
                    }
                }
            }
        }

        return { ...parsed, _raw: raw };
    }

    // ── Harness: recover tool calls from malformed Decide JSON ──
    const recovered = this._recoverToolPlan(raw);
    if (recovered.length > 0) return { plan: recovered, _raw: raw };

    return { plan: [], _raw: raw };
}

// ===== Layer 3: Simplified Decide retry (fill-in-the-blank) =====
export async function _decideSimplified(observationOrCtx, orientation, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx      = observationOrCtx && typeof observationOrCtx === 'object' && 'userText' in observationOrCtx;
    const _opts      = isCtx ? observationOrCtx : opts;
    const observation = observationOrCtx;  // ctx IS observation

    const entities = (observation.key_entities || []).join(', ') || observation.summary || 'unknown';
    const prompt = `Pick ONE tool. Replace QUERY with a short search query. Output ONLY the JSON line.

USER WANTS: ${observation.summary}

{"plan":[{"tool":"web_search","args":{"query":"QUERY"},"reason":"search"}]}

Replace QUERY with a short search about: ${entities}

JSON:`;

    const raw = await this._callModel(prompt, {
        ..._opts,
        _phase: 'decide',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    if (parsed && Array.isArray(parsed.plan) && parsed.plan.length > 0) {
        for (const step of parsed.plan) _repairStepArgs(step, observation);
        _expandMultiTargetExchangeRatePlan(parsed, observation);
        const result = { ...parsed, _raw: raw };
        if (isCtx) observationOrCtx.plan = result;
        return result;
    }
    const recovered = this._recoverToolPlan(raw);
    for (const step of recovered) _repairStepArgs(step, observation);
    if (recovered.length > 0) {
        const result = { plan: recovered, _raw: raw };
        _expandMultiTargetExchangeRatePlan(result, observation);
        if (isCtx) observationOrCtx.plan = result;
        return result;
    }
    const empty = { plan: [], _raw: raw };
    if (isCtx) observationOrCtx.plan = empty;
    return empty;
}

// ===== Layer 4: Deterministic fallback plan (no LLM) =====
export function _buildFallbackPlan(observationOrCtx, orientation) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = observationOrCtx && typeof observationOrCtx === 'object' && 'userText' in observationOrCtx;
    const observation  = observationOrCtx;  // ctx IS observation
    const _orientation = isCtx ? observationOrCtx : orientation;

    const plan = [];
    if (_orientation.memory_action === 'recall' && this.registry.has('recall_memory')) {
        const query = (observation.key_entities || [])[0] || observation.summary;
        plan.push({ tool: 'recall_memory', args: { query }, reason: 'deterministic fallback' });
    }
    if (plan.length === 0 && this.registry.has('web_search')) {
        const query = (observation.key_entities || []).join(' ') || observation.summary || '';
        plan.push({ tool: 'web_search', args: { query: this._shortenQuery(query) }, reason: 'deterministic fallback' });
    }
    return plan;
}

// ===== Deictic correction: standalone method for orchestrator use =====
// P25 fix: extracted from _decide so it applies to ALL decide paths
// (_decide, _decideSimplified, _buildFallbackPlan, _recoverToolPlan)
export function _applyDeicticCorrection(plan, observation, classification) {
    const isReferenceFollowUp = !!classification?.is_reference || observation.intent === 'follow_up';
    if (!isReferenceFollowUp || !plan?.plan || plan.plan.length === 0) return;

    const searchEntities = observation.key_entities || [];
    if (searchEntities.length === 0) return;

    // P27 fix: prefer recentEntity (leaf of workspace chain) as primary search anchor.
    // For pronoun follow-ups ("她是哪国人？"), the user refers to the most recently
    // discussed entity, not the root entity of the topic chain.
    let topEntity;
    if (observation._wsRecentEntity) {
        const recent = String(observation._wsRecentEntity);
        const others = searchEntities.filter(e => String(e).length >= 2 && String(e).toLowerCase() !== recent.toLowerCase()).slice(0, 1);
        topEntity = others.length > 0 ? `${recent} ${others[0]}` : recent;
    } else {
        const relevantEntities = searchEntities.filter(e => String(e).length >= 2).slice(0, 2);
        topEntity = relevantEntities.map(e => String(e)).join(' ') || String(searchEntities[0]);
    }
    const topLower = topEntity.toLowerCase();

    for (const step of plan.plan) {
        if (step.tool === 'web_search' && step.args?.query && !step._corrected) {
            const qLower = step.args.query.toLowerCase();
            if (!qLower.includes(topLower.slice(0, Math.min(topLower.length, 10)))) {
                const pronouns = /\b(this|that|these|those|it|its|they|their|them|the|his|her|who|what|how much|how many)\b|这个|那个|这家|那家|他们的|她们的|它们的|他们|她们|它们|他的|她的|它的|他|她|它|谁|什么|多少/gi;
                const userSummary = observation.summary || '';
                const userClean = userSummary.replace(/\s*\(about:.*\)\s*$/, '');
                const userKeywords = userClean.replace(pronouns, '').replace(/[？?。！!，,]/g, '').trim();
                const queryKeywords = step.args.query.replace(pronouns, '').trim();
                const keywords = (userKeywords.length >= 2) ? userKeywords : queryKeywords;
                step.args.query = keywords ? `${topEntity} ${keywords}` : topEntity;
                step._corrected = true;
            }
        }
    }
}
