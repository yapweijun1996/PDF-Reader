// ============================================================
//  oodae-micro.js — Focused micro-agents for weak LLMs
//  Design: ONE call = ONE decision, with COT (<thinking>)
//
//  Replaces:
//    CLASSIFY (9 checks in 1 call → 4 focused calls)
//    DECIDE   (tool+args+rules   → 2 focused calls)
//    EVALUATE (check+answer+rules → 2 focused calls)
// ============================================================

import { HarnessConfig } from './config.js';
import { COT, quoteForPrompt } from './cot-standard.js';
import { _groundEntitiesToUserText, _isSubstantiveEntity, _getAgentsBlock } from './oodae-helpers.js';
import { isSiteDomainQuery, isPrivateInfoQuery, buildNoKnowledgeFallback } from './agents-config.js';
import { extractKnowledgeFact } from './knowledge-fact-extractor.js';

function _microLangRule(language) {
    if (language === 'mandarin') return 'Reply ONLY in 中文. No pinyin. No English translation. No bilingual output.';
    if (language === 'japanese') return 'Reply ONLY in 日本語. No romaji. No English translation. No bilingual output.';
    if (language === 'malay') return 'Reply ONLY in Bahasa Melayu. No English translation. No bilingual output.';
    if (language && language !== 'english') return `Reply ONLY in ${language}. No translation or bilingual output.`;
    return 'Reply only in English.';
}

function _extractGeoQuery(observation) {
    const entities = observation.key_entities || [];
    const firstEntity = entities.find(entity => String(entity).trim().length > 1);
    if (firstEntity) return String(firstEntity).trim();
    return String(observation.summary || '')
        .replace(/\s*\(about:.*\)\s*$/, '')
        .replace(/^.*?(?:坐标|coordinates?)[:：]?\s*/i, '')
        .replace(/请给我|请查询|只用中文简短回答。?/g, '')
        .trim();
}

function _matchesGeoContext(query, observation) {
    if (!query) return false;
    const q = String(query).toLowerCase().trim();
    const summary = String(observation.summary || '').toLowerCase();
    if (summary.includes(q)) return true;
    return (observation.key_entities || []).some(entity => {
        const e = String(entity).toLowerCase().trim();
        return e && (q.includes(e) || e.includes(q));
    });
}

function _normalizeLanguagePreference(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const aliases = HarnessConfig.policies.langAliases || {};
    return aliases[raw] || raw;
}

function _detectLanguagePreferenceCommand(userText) {
    const text = String(userText || '').trim();
    if (!text) return null;

    const patterns = [
        /\b(?:reply|respond|answer|speak|write|use)(?:\s+to)?(?:\s+me)?(?:\s+(?:in|using))?\s+(mandarin|chinese|中文|华语|bahasa|malay|japanese|日本語|english)\b/i,
        /\b(?:please\s+)?reply(?:\s+to)?(?:\s+me)?\s+(mandarin|chinese|中文|华语|bahasa|malay|japanese|日本語|english)\b/i,
        /\b(?:from\s+now\s+on|going\s+forward)\s*,?\s*(?:reply|respond|answer|write)\s+(?:in\s+)?(mandarin|chinese|中文|华语|bahasa|malay|japanese|日本語|english)\b/i,
        /以后用(中文|华语|日语|日本語|英文|英语|马来语|马来文|bahasa|malay|english|mandarin|japanese)回复/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const language = _normalizeLanguagePreference(match[1]);
        if (!language) continue;
        return {
            action: 'save',
            key: 'reply_language',
            value: language,
            pairs: null
        };
    }
    return null;
}

function _cleanMemoryValue(value) {
    return String(value || '')
        .trim()
        .replace(/^[`"'“”‘’\s]+|[`"'“”‘’\s]+$/g, '')
        .replace(/[.。!！?？]+$/g, '')
        .trim();
}

function _detectMemoryFacts(userText) {
    const text = String(userText || '').trim();
    if (!text) return null;

    const petNamed = text.match(/\b(?:i have|i've got)\s+(?:an?\s+)?(cat|dog|pet)\s+(?:named|called)\s+(.+?)$/i)
        || text.match(/\bmy\s+(cat|dog|pet)(?:'s)?\s+name\s+is\s+(.+?)$/i);
    if (petNamed) {
        const petType = _cleanMemoryValue(petNamed[1]).toLowerCase();
        const petName = _cleanMemoryValue(petNamed[2]);
        if (petName) {
            return {
                action: 'save',
                key: 'pet_name',
                value: petName,
                pairs: [
                    { key: 'pet_name', value: petName },
                    { key: 'pet_type', value: petType }
                ]
            };
        }
    }

    const userName = text.match(/\bmy name is\s+(.+?)$/i)
        || text.match(/\bi am\s+([A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*)*)$/);
    if (userName) {
        const value = _cleanMemoryValue(userName[1]);
        if (value) return { action: 'save', key: 'user_name', value, pairs: null };
    }

    const userLocation = text.match(/\bi live in\s+(.+?)$/i)
        || text.match(/\bi(?:'m| am)\s+in\s+(.+?)$/i);
    if (userLocation) {
        const value = _cleanMemoryValue(userLocation[1]);
        if (value) return { action: 'save', key: 'user_location', value, pairs: null };
    }

    return null;
}

function _normalizeMemoryDecision(userText, parsed) {
    const languagePreference = _detectLanguagePreferenceCommand(userText);
    if (languagePreference) return languagePreference;

    const heuristic = _detectMemoryFacts(userText);
    if (heuristic) return heuristic;

    const action = parsed?.action || 'none';
    let key = parsed?.key || null;
    const value = parsed?.value || null;
    const pairs = Array.isArray(parsed?.pairs) ? parsed.pairs : null;
    const text = String(userText || '').toLowerCase();

    if (action === 'save' && key) {
        const normalized = String(key).trim().toLowerCase();
        if (['name', 'my_name', 'username', 'person_name'].includes(normalized)) {
            key = /\b(cat|dog|pet)\b/.test(text) ? 'pet_name' : 'user_name';
        } else if (['location', 'city', 'home', 'place'].includes(normalized) && /\b(i live in|i am in|live at)\b|住在|住址/.test(text)) {
            key = 'user_location';
        }
    }

    return {
        action,
        key,
        value,
        pairs
    };
}

function _hasDeterministicToolCoverage(results) {
    const deterministicTools = new Set([
        'get_time', 'world_time', 'get_weather', 'exchange_rate',
        'geocode', 'reverse_geocode', 'calculate', 'math',
        'convert_units', 'date_calc', 'save_memory', 'recall_memory',
        'list_memories', 'delete_memory'
    ]);
    const relevant = (results || []).filter(r => r && r.name && r.name !== '_previous_summary');
    if (relevant.length === 0) return false;
    if (relevant.some(r => r.error)) return false;
    return relevant.every(r => deterministicTools.has(r.name));
}

// ===== CLASSIFY micro-agents (replace monolithic _classifyIntent) =====

/**
 * Micro 1: Intent classification
 * ONE decision: What type of message is this?
 */
export async function _microIntent(userText, opts) {
    const prompt = `What type of message is this? Pick ONE.

Message: ${quoteForPrompt(userText)}

Types:
- greeting: hello, hi, 你好, hey, bonjour, hola, good morning
- question: asking for information or facts
- command: setting a preference (remember X, use X language, 以后用中文)
- info_sharing: telling about self (my name is X, I am X, 我叫X, I live in X)
- task: content creation (write X, translate X, summarize X, draft X)
- acknowledgment: ok, thanks, got it, 好的, understood, I see

${COT.micro('Classify the message into one intent type.', 'Output ONLY the intent JSON.')}

{"intent":"type_name"}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_intent',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    return this._parseJSON(raw)?.intent || 'question';
}

/**
 * Micro 2: Entity extraction
 * ONE decision: What named entities does the user mention?
 */
export async function _microEntities(userText, opts) {
    const prompt = `What specific named entities does the user mention?

Message: ${quoteForPrompt(userText)}

Rules:
- Look for people, places, companies, products, specific topics.
- Only from THIS message. Not from prior context.
- Exclude generic words (company, person, things, latest, best, 公司, 人, 最新).

${COT.micro('Extract named entities from the current message only.', 'Output ONLY the entities JSON.')}

{"entities":["entity1","entity2"]}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_entities',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    return this._parseJSON(raw)?.entities || [];
}

/**
 * Micro 3: Reference detection
 * ONE decision: Does this refer back to a previous topic?
 */
export async function _microReference(userText, recentContext, opts) {
    const prompt = `Does this message refer back to a previous conversation topic?

Message: ${quoteForPrompt(userText)}

Recent conversation:
${recentContext}

Rules:
- Does the message use pronouns (he/she/this/that/他的/她的/这个/那个)?
- Is it a short question that only makes sense with prior context (how much? when? CEO? 多少?)?
- Does it say "tell me more", "what about X?", "那X呢?", "还有呢?"?
- Is it asking about an attribute (CEO, price, address) without naming the entity?

${COT.micro('Decide whether the message refers back to earlier conversation context.', 'Output ONLY the reference JSON.')}

{"is_reference":true_or_false}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_reference',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    return this._parseJSON(raw)?.is_reference === true;
}

/**
 * Micro 4: Memory decision
 * ONE decision: Save, recall, or neither?
 */
export async function _microMemory(userText, opts) {
    const prompt = `Is the user saving or asking about personal information?

Message: ${quoteForPrompt(userText)}

Rules:
- SAVE = user TELLS about self: "my name is John", "我叫小明", "I live in Shanghai"
- RECALL = user ASKS about saved info: "what is my name?", "我叫什么?", "where do I live?"
- NONE = not about personal info
- Key: Questions (什么/what/where/who) → RECALL. Statements → SAVE.
- For language preferences (中文→mandarin, Bahasa→malay, 日本語→japanese): use standard name.
- If MULTIPLE facts in one message, list all pairs.

${COT.micro('Choose whether the message saves, recalls, or ignores memory.', 'Output ONLY the memory JSON.')}

{"action":"save|recall|none","key":"descriptive_key_or_null","value":"value_or_null","pairs":[{"key":"k","value":"v"}]}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_memory',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    return _normalizeMemoryDecision(userText, this._parseJSON(raw));
}

// ===== DECIDE micro-agents (replace monolithic _decide) =====

/**
 * Micro 5: Tool selection
 * ONE decision: Which tool should we use?
 */
export async function _microSelectTool(summary, entities, memAction, toolDefs, opts) {
    const entityLine = entities.join(', ') || 'none';
    const prompt = `Pick ONE tool to help with this task.

User needs: ${summary}
Entities: ${entityLine}
Memory action: ${memAction}

Rules:
- What information does the user need?
- Which tool provides this information?
- For questions about the site owner, this website, GemmaClient, or services → search_knowledge (if available)
- For factual questions about external entities → web_search
- For saving user info → save_memory
- For recalling user info → recall_memory
- For time/date → get_time
- For weather → get_weather
- For math → calculate

Available tools:
${toolDefs}

${COT.micro('Select the single best tool for this request.', 'Output ONLY the tool-selection JSON.')}

{"tool":"tool_name","reason":"one sentence why"}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_tool',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    return { tool: parsed?.tool || 'web_search', reason: parsed?.reason || '' };
}

/**
 * Micro 6: Argument generation
 * ONE decision: What arguments for this tool?
 */
export async function _microArgs(summary, tool, entities, extraCtx, opts) {
    const entityLine = entities.join(', ') || 'none';

    let formatGuide;
    switch (tool) {
        case 'web_search':
            formatGuide = `Write a short search query (2-6 words).
Rules:
- Drop filler (who is, what is, tell me about).
- Keep full entity names including suffixes (Pte Ltd, Inc, GmbH).
- For international entities, use English.
- For local/cultural topics, use local language.

${COT.micro('Generate search arguments for web_search.', 'Output ONLY the query JSON.')}

{"query":"short search query"}`;
            break;
        case 'save_memory':
            formatGuide = `Extract what to save about the user.
Rules:
- What key describes this information? (user_name, user_location, etc.)
- What is the exact value?

${COT.micro('Generate arguments for save_memory.', 'Output ONLY the memory-save JSON.')}

{"key":"descriptive_key","value":"the value to save"}`;
            break;
        case 'recall_memory':
            formatGuide = `What to search in memory?
Rules:
- What is the user asking about? Name, location, preference?

${COT.micro('Generate arguments for recall_memory.', 'Output ONLY the memory-recall JSON.')}

{"query":"search term"}`;
            break;
        case 'get_time':
            formatGuide = `What timezone?
Rules:
- Which timezone does the user mean?

${COT.micro('Generate arguments for get_time.', 'Output ONLY the time JSON.')}

{"timezone":"IANA timezone like Asia/Singapore"}`;
            break;
        case 'get_weather':
            formatGuide = `What city?
Rules:
- Which city does the user want weather for?

${COT.micro('Generate arguments for get_weather.', 'Output ONLY the weather JSON.')}

{"city":"city name"}`;
            break;
        case 'exchange_rate':
            formatGuide = `What currency conversion does the user want?
Rules:
- Extract the amount. If the user did not specify one, use 1.
- Use ONLY these keys: amount, from, to.
- "美元" -> "USD", "欧元" -> "EUR", "日元" -> "JPY", "马币"/"令吉" -> "MYR", "新币" -> "SGD".

${COT.micro('Generate arguments for exchange-rate lookup.', 'Output ONLY the exchange-rate JSON.')}

{"amount":100,"from":"USD","to":"MYR"}`;
            break;
        case 'geocode':
            formatGuide = `What place should be geocoded?
Rules:
- Extract the place name or address exactly.
- Use ONLY this key: query.

${COT.micro('Generate arguments for geocode.', 'Output ONLY the geocode JSON.')}

{"query":"Taipei 101"}`;
            break;
        case 'calculate':
            formatGuide = `What math expression?
Rules:
- What does the user want calculated?

${COT.micro('Generate arguments for calculate.', 'Output ONLY the calculation JSON.')}

{"expression":"math expression"}`;
            break;
        default:
            formatGuide = `Decide what arguments are needed for this tool.

${COT.micro('Generate the required tool arguments.', 'Output ONLY JSON with the arguments.')}`;
    }

    const prompt = `Generate arguments for ${tool}.

User needs: ${summary}
Entities: ${entityLine}
${extraCtx || ''}
${formatGuide}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_args',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    return this._parseJSON(raw) || {};
}

// ===== EVALUATE micro-agents (replace monolithic _evaluate) =====

/**
 * Micro 7: Result sufficiency check
 * ONE decision: Do results answer the question?
 */
export async function _microSufficiency(userText, entities, resultsText, opts) {
    const entityLine = entities.join(', ') || 'unknown';
    const prompt = `Do these results answer the user's question?

Question: ${quoteForPrompt(userText)}
Key entity: ${entityLine}

Results:
${resultsText}

${COT.micro('Decide whether the current results are sufficient to answer the question.', 'Output ONLY the sufficiency JSON.')}

{"sufficient":true_or_false,"reason":"brief explanation"}

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_sufficiency',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    return {
        sufficient: parsed?.sufficient !== false,
        reason: parsed?.reason || ''
    };
}

/**
 * Micro 8: Answer generation from results
 * ONE task: Answer the question from the facts.
 */
export async function _microAnswer(userText, resultsText, language, profileContext, opts) {
    const lang = _microLangRule(language);
    const agentsBlock = _getAgentsBlock(opts, 'tool');
    const prompt = `${lang}
${agentsBlock ? `${agentsBlock}\n` : ''}Answer the user's question using ONLY the facts from the results below.
${profileContext || ''}

Question: ${quoteForPrompt(userText)}

Results:
${resultsText}

${COT.micro('Write the final answer from the available results.', `Write a helpful, natural final answer in ${language || 'english'} only.`)}

KNOWLEDGE GROUNDING RULES:
- Extract and state SPECIFIC facts from the results: URLs, names, descriptions, numbers.
- If the results contain a URL (e.g. github.com/..., codepen.io/...), include it in your answer.
- If the results describe a project, give its actual description from the knowledge, not a vague summary.
- Do NOT paraphrase away concrete details — the user wants the actual facts.
- If info is missing from the results, say so honestly.
${lang}`;

    const raw = await this._callModel(prompt, {
        ...opts, _phase: 'micro_answer',
        generationConfig: { ...HarnessConfig.generation.creative }
    });
    return this._stripThinking(raw);
}


// =============================================================
//  WRAPPER: _classifyMicro — orchestrates 4 micro-agents
//  Returns same shape as legacy _classifyIntent for compatibility
// =============================================================

export async function _classifyMicro(userTextOrCtx, observation, chatHistory, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx    = userTextOrCtx && typeof userTextOrCtx === 'object' && 'userText' in userTextOrCtx;
    const userText = isCtx ? userTextOrCtx.userText    : userTextOrCtx;
    const obs      = isCtx ? userTextOrCtx             : observation;    // ctx IS observation
    const hist     = isCtx ? userTextOrCtx.chatHistory : chatHistory;
    const _opts    = isCtx ? userTextOrCtx             : opts;

    try {
        const languagePreference = _detectLanguagePreferenceCommand(userText);
        if (languagePreference) {
            const cls = {
                is_greeting: false,
                is_command: true,
                is_acknowledgment: false,
                is_info_sharing: false,
                is_task_request: false,
                needs_tools: true,
                is_reference: false,
                memory_action: 'save',
                save_key: languagePreference.key,
                save_value: languagePreference.value,
                save_pairs: null,
                user_entities: [languagePreference.value],
                search_entities: []
            };
            if (isCtx) {
                Object.assign(userTextOrCtx, cls);
                _applyClassificationCorrections.call(this, userTextOrCtx, cls);
                return userTextOrCtx;
            }
            return cls;
        }

        // ── Micro 1: Intent ──
        const intent = await this._microIntent(userText, _opts);

        // Early exit for simple intents (no further classification needed)
        if (intent === 'greeting') {
            const cls = {
                is_greeting: true, is_command: false, is_acknowledgment: false,
                is_info_sharing: false, is_task_request: false,
                needs_tools: false, is_reference: false,
                memory_action: null, save_key: null, save_value: null,
                user_entities: [], search_entities: []
            };
            if (isCtx) { Object.assign(userTextOrCtx, cls); _applyClassificationCorrections.call(this, userTextOrCtx, cls); return userTextOrCtx; }
            return cls;
        }
        if (intent === 'acknowledgment') {
            const cls = {
                is_greeting: false, is_command: false, is_acknowledgment: true,
                is_info_sharing: false, is_task_request: false,
                needs_tools: false, is_reference: false,
                memory_action: null, save_key: null, save_value: null,
                user_entities: [], search_entities: []
            };
            if (isCtx) { Object.assign(userTextOrCtx, cls); _applyClassificationCorrections.call(this, userTextOrCtx, cls); return userTextOrCtx; }
            return cls;
        }

        // ── Micro 2+3+4: run in parallel where possible ──
        // Entities and Reference are independent; Memory depends on intent
        const parallel = [];

        // Micro 2: Entities (always needed)
        parallel.push(this._microEntities(userText, _opts));

        // Micro 3: Reference (only if conversation history exists)
        const hasHistory = hist && hist.length > 0;
        const recent = hasHistory ? (this._ctx?.recent3 || this._getRecentContext(hist, 3)) : '';
        if (recent && recent.length > 10) {
            parallel.push(this._microReference(userText, recent, _opts));
        } else {
            parallel.push(Promise.resolve(false));
        }

        // Micro 4: Memory (only if intent suggests user info)
        const needsMemory = intent === 'info_sharing' || intent === 'command' || obs.is_about_user;
        if (needsMemory) {
            parallel.push(this._microMemory(userText, _opts));
        } else {
            parallel.push(Promise.resolve({ action: 'none', key: null, value: null, pairs: null }));
        }

        const [entities, isReference, memory] = await Promise.all(parallel);
        const groundedEntities = _groundEntitiesToUserText(entities, userText);
        const searchEntities = groundedEntities.filter(_isSubstantiveEntity);

        // ── Assemble classification (same shape as legacy _classifyIntent) ──
        const needsTools = intent === 'question' || intent === 'follow_up'
            || memory.action === 'save' || memory.action === 'recall';

        const cls = {
            is_greeting: false,
            is_command: intent === 'command',
            is_acknowledgment: false,
            is_info_sharing: intent === 'info_sharing',
            is_task_request: intent === 'task',
            needs_tools: needsTools,
            is_reference: isReference,
            memory_action: memory.action === 'none' ? null : memory.action,
            save_key: memory.key,
            save_value: memory.value,
            save_pairs: memory.pairs,
            user_entities: groundedEntities,
            search_entities: searchEntities
        };

        if (isCtx) {
            // Write classification fields to ctx, then apply observation corrections
            Object.assign(userTextOrCtx, cls);
            _applyClassificationCorrections.call(this, userTextOrCtx, cls);
            return userTextOrCtx;
        }
        return cls;
    } catch (e) {
        // Fallback to legacy classifier on any error
        console.warn('classifyMicro failed, falling back to legacy:', e.message);
        return this._classifyIntent(userText, obs, _opts);
    }
}

// ── COODAE helper: Apply observation corrections from classification ──
// Extracted from run() lines 164-271. Mutates ctx in-place.
function _applyClassificationCorrections(ctx, cls) {
    const userText = ctx.userText;

    if (cls.is_greeting) {
        ctx.intent = 'greeting';
        ctx.requires_tools = false;
        ctx.key_entities = [];
        ctx.summary = 'User is greeting';
    } else if (cls.is_command && cls.memory_action && !cls.is_reference) {
        ctx.intent = 'command';
        ctx.is_about_user = true;
        ctx.requires_tools = true;
        if (cls.user_entities) ctx.key_entities = cls.user_entities;
        ctx.summary = userText;
        ctx._memoryAction = cls.memory_action;
        if (cls.save_key) ctx._saveKey = cls.save_key;
        if (cls.save_value) ctx._saveValue = cls.save_value;
    } else if (cls.is_info_sharing && cls.memory_action) {
        const saveVal = (cls.save_value || '').trim();
        const isBogusValue = !saveVal || /^(unknown|null|undefined|none|\?)$/i.test(saveVal);
        if (ctx.intent === 'question' && (isBogusValue || cls.memory_action === 'recall')) {
            ctx.is_about_user = true;
            ctx._memoryAction = 'recall';
        } else {
            ctx.intent = 'information_sharing';
            ctx.is_about_user = true;
            ctx.requires_tools = true;
            ctx.summary = userText;
            ctx._memoryAction = cls.memory_action;
            if (cls.save_key) ctx._saveKey = cls.save_key;
            if (cls.save_value) ctx._saveValue = cls.save_value;
            if (Array.isArray(cls.save_pairs) && cls.save_pairs.length > 1) ctx._savePairs = cls.save_pairs;
        }
    } else if (!cls.is_info_sharing && cls.memory_action === 'recall') {
        ctx.is_about_user = true;
        ctx.requires_tools = true;
        ctx._memoryAction = 'recall';
    } else if (cls.is_task_request && !ctx.requires_tools) {
        ctx.requires_tools = false;
        ctx.intent = 'task_request';
    } else if (cls.is_acknowledgment) {
        ctx.requires_tools = false;
        ctx.intent = 'acknowledgment';
    } else if (cls.needs_tools && !ctx.requires_tools) {
        ctx.requires_tools = true;
    }

    // CLASSIFY-driven reference/deictic follow-up
    if (cls.is_reference && ctx._wsContextAvailable) {
        const wsContext = ctx._wsContextAvailable;
        // Guard: only block workspace injection when the current turn contains
        // grounded, searchable entities that clearly point to a different topic.
        const userEnts = (cls.search_entities || []).map(e => String(e).toLowerCase()).filter(e => e.length >= 2);
        const wsEnts = (wsContext.entities || []).map(e => String(e).toLowerCase());
        const noEntityOverlap = userEnts.length > 0
            && !userEnts.some(ue => wsEnts.some(we => we.includes(ue) || ue.includes(we)))
            && !wsEnts.some(we => we.length >= 3 && userText.toLowerCase().includes(we.slice(0, Math.min(we.length, 8))));
        if (!noEntityOverlap) {
            ctx.intent = 'follow_up';
            ctx.requires_tools = true;
            ctx.key_entities = [...new Set([...(wsContext.entities || []), ...(ctx.key_entities || [])])];
            if (wsContext.topic) ctx.summary = `${userText} (about: ${wsContext.topic})`;
        }
        delete ctx._wsContextAvailable;
    }

    // Topic switch detection (Layer 2)
    if (cls.user_entities && cls.user_entities.length > 0
        && !cls.is_greeting && !cls.is_command && !cls.is_acknowledgment) {
        const classifiedLower = cls.user_entities.map(e => String(e).toLowerCase());
        const observeLower = (ctx.key_entities || []).map(e => String(e).toLowerCase());
        const overlap = classifiedLower.filter(e => observeLower.some(oe => oe.includes(e) || e.includes(oe))).length;
        const overlapRatio = classifiedLower.length > 0 ? overlap / classifiedLower.length : 1;
        if (overlapRatio < 0.3 && ctx.intent === 'follow_up' && !cls.is_reference) {
            ctx.summary = userText;
            ctx.intent = 'question';
            ctx.key_entities = cls.user_entities;
        }
    }

    // Pass search_entities to ctx for multi-intent harness
    if (cls.search_entities) ctx._searchEntities = cls.search_entities;
}


// =============================================================
//  WRAPPER: _decideMicro — orchestrates 2 micro-agents
//  Returns same shape as legacy _decide: { plan: [{tool, args, reason}] }
// =============================================================

export async function _decideMicro(observationOrCtx, orientation, opts, previousResults = [], classification = null) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = observationOrCtx && typeof observationOrCtx === 'object' && 'userText' in observationOrCtx;
    const _orientation = isCtx ? observationOrCtx : orientation;
    const _opts        = isCtx ? observationOrCtx : opts;
    const _prevResults = isCtx ? (observationOrCtx.allActResults || []) : previousResults;
    const _cls         = isCtx ? observationOrCtx : classification;
    if (isCtx) observationOrCtx._phase = 'decide';
    // ctx IS observation — all observation fields are on the same object
    const observation  = observationOrCtx;

    try {
        // ── Short-circuit: memory operations don't need tool selection ──
        const saveValue = observation._saveValue || '';
        const isBogusValue = !saveValue || /^(unknown|null|undefined|none|\?)$/i.test(saveValue.trim());
        const isQuestionIntent = observation.intent === 'question' || observation.intent === 'follow_up';

        // Force save_memory when CLASSIFY says save with valid values
        if (_orientation.memory_action === 'save' && observation._saveKey && observation._saveValue
            && !isBogusValue && !isQuestionIntent) {
            const plan = [];
            if (Array.isArray(observation._savePairs) && observation._savePairs.length > 1) {
                for (const pair of observation._savePairs) {
                    if (pair.key && pair.value) {
                        plan.push({ tool: 'save_memory', args: { key: pair.key, value: pair.value }, reason: 'save user info' });
                    }
                }
            } else {
                plan.push({ tool: 'save_memory', args: { key: observation._saveKey, value: observation._saveValue }, reason: 'save user info' });
            }

            // ── Mixed-intent: command + knowledge question in the same message ──
            // e.g. "Please reply in Mandarin. What services does he offer?"
            // The save_memory handles the preference; also run search_knowledge for the question.
            if (this.registry.has('search_knowledge')) {
                const userText = observation.userText || '';
                const agentsCfg = isCtx ? observationOrCtx.agentsConfig : null;
                if (isSiteDomainQuery(userText, agentsCfg)) {
                    // Extract the question part — strip the command portion for a better search query
                    const query = userText
                        .replace(/^.*?(?:please|请|以后|从现在起)\s*/i, '')
                        .replace(/^(?:reply|respond|answer|use|speak|write)\s+(?:in\s+|me\s+)?\S+[\s.。，,!！]*\s*/i, '')
                        .trim() || observation.summary || userText;
                    plan.push({ tool: 'search_knowledge', args: { query, top_k: 5 }, reason: 'mixed-intent: answer concurrent question' });
                    if (isCtx) observationOrCtx._knowledgeBounded = true;
                }
            }

            const result = { plan };
            if (isCtx) observationOrCtx.plan = result;
            return result;
        }

        // Force recall_memory when CLASSIFY says recall
        if (_orientation.memory_action === 'recall' && this.registry.has('recall_memory')) {
            const recallQuery = (observation.key_entities || [])[0] || observation.summary;
            const plan = [{ tool: 'recall_memory', args: { query: recallQuery }, reason: 'recall user info' }];

            // Normalize recall key against existing memories
            if (_orientation.all_memories?.length > 0) {
                const existingKeys = _orientation.all_memories.map(m => m.key);
                const match = this._findMatchingMemKey(plan[0].args.query, existingKeys);
                if (match) plan[0].args.query = match;
            }
            const result = { plan };
            if (isCtx) observationOrCtx.plan = result;
            return result;
        }

        // ── Knowledge-first routing: site/owner questions → search_knowledge ──
        // Short-circuit before LLM tool selection for faster + more reliable routing.
        // Also blocks web_search escalation on loop 2+ for knowledge-bounded queries.
        if (this.registry.has('search_knowledge')) {
            const agentsCfg = isCtx ? observationOrCtx.agentsConfig : null;
            const userText = observation.userText || observation.summary || '';
            const isSiteDomain = isSiteDomainQuery(userText, agentsCfg);
            const isPrivate = isPrivateInfoQuery(userText);

            if (isSiteDomain || isPrivate) {
                if (_prevResults.length === 0) {
                    // Loop 1: route to search_knowledge
                    const query = userText
                        ? userText.replace(/\s*\(about:.*\)\s*$/, '').trim()
                        : (observation.summary ? observation.summary.replace(/\s*\(about:.*\)\s*$/, '') : userText);
                    const plan = { plan: [{ tool: 'search_knowledge', args: { query, top_k: 5 }, reason: 'site/persona question — knowledge-first' }] };
                    if (isCtx) {
                        observationOrCtx.plan = plan;
                        observationOrCtx._knowledgeBounded = true;
                    }
                    return plan;
                } else {
                    // Loop 2+: knowledge-bounded query already searched knowledge.
                    // Do NOT fall through to web_search — return empty plan to force final answer.
                    const plan = { plan: [] };
                    if (isCtx) observationOrCtx.plan = plan;
                    return plan;
                }
            }
        }

        // ── Micro 5: Select tool ──
        const toolDefs = this._buildToolDefsCompact();
        const entities = observation.key_entities || [];
        const memAction = _orientation.memory_action;

        const toolChoice = await this._microSelectTool(
            observation.summary, entities, memAction, toolDefs, _opts
        );

        // Validate tool exists
        let selectedTool = toolChoice.tool;
        if (!this.registry.has(selectedTool) && !(this.skillRegistry && this.skillRegistry.has(selectedTool))) {
            selectedTool = 'web_search';
        }

        // ── Micro 6: Generate arguments ──
        let extraCtx = '';
        if (_prevResults.length > 0) {
            const prevQueries = _prevResults
                .filter(r => r.name === 'web_search')
                .map(r => `"${r.args?.query || '?'}"`)
                .join(', ');
            if (prevQueries) extraCtx += `Previous searches tried: ${prevQueries}\nUse DIFFERENT keywords.\n`;
        }
        // COODAE: ctx path uses feedbackContext; legacy uses orientation._additionalContext
        const feedbackText = isCtx ? observationOrCtx.feedbackContext : _orientation._additionalContext;
        if (feedbackText) {
            extraCtx += `Feedback: ${feedbackText}\n`;
        }

        const toolArgs = await this._microArgs(
            observation.summary, selectedTool, entities, extraCtx, _opts
        );

        if (selectedTool === 'geocode') {
            const fallbackQuery = _extractGeoQuery(observation);
            if ((!toolArgs.query || !_matchesGeoContext(toolArgs.query, observation)) && fallbackQuery) {
                toolArgs.query = fallbackQuery;
            }
        }

        const plan = { plan: [{ tool: selectedTool, args: toolArgs, reason: toolChoice.reason }] };

        // ── Safety nets (same as legacy _decide) ──
        // Deictic correction for follow-ups
        this._applyDeicticCorrection(plan, observation, _cls);

        // Memory key normalization
        if (_orientation.all_memories?.length > 0) {
            const existingKeys = _orientation.all_memories.map(m => m.key);
            for (const step of plan.plan) {
                if (step.tool === 'save_memory' && step.args?.key) {
                    const match = this._findMatchingMemKey(step.args.key, existingKeys);
                    if (match && match !== step.args.key) step.args.key = match;
                }
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

        if (isCtx) observationOrCtx.plan = plan;
        return plan;

    } catch (e) {
        // Fallback to legacy _decide on any error
        console.warn('decideMicro failed, falling back to legacy:', e.message);
        return this._decide(observation, _orientation, _opts, _prevResults, _cls);
    }
}


// =============================================================
//  WRAPPER: _evaluateMicro — orchestrates 2 micro-agents
//  Returns same shape as legacy _evaluate
// =============================================================

export async function _evaluateMicro(observationOrCtx, orientation, actResults, userText, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = observationOrCtx && typeof observationOrCtx === 'object' && 'userText' in observationOrCtx;
    const _orientation = isCtx ? observationOrCtx : orientation;
    const _actResults  = isCtx ? (observationOrCtx.allActResults || []) : actResults;
    const _userText    = isCtx ? observationOrCtx.userText : userText;
    const _opts        = isCtx ? observationOrCtx : opts;
    if (isCtx) observationOrCtx._phase = 'evaluate';
    // ctx IS observation — all observation fields are on the same object
    const observation  = observationOrCtx;

    try {
        // ── Reuse existing result formatting (algorithmic, no LLM) ──
        const entities = (observation.key_entities || []).map(e => String(e).toLowerCase());
        const rankedResults = this._rankByRelevance(_actResults, observation.key_entities);

        const resultsText = rankedResults.map(r => {
            const data = r.result || r.error;
            if (r.name === 'web_search' && data?.results) {
                const sorted = entities.length > 0
                    ? [...data.results].sort((a, b) => {
                        const rel = (s) => {
                            const t = `${s.title || ''} ${s.snippet || ''}`.toLowerCase();
                            return entities.reduce((sc, e) => sc + (t.includes(e.slice(0, Math.min(e.length, HarnessConfig.truncation.entityMatchPrefix))) ? 1 : 0), 0);
                        };
                        return rel(b) - rel(a);
                    })
                    : data.results;
                const snippets = sorted.map(s => `- "${s.title}": ${s.snippet}`).join('\n');
                return `Tool: web_search\nQuery: "${data.query}"\nResults:\n${snippets}`;
            }
            if (r.name === 'fetch_url' && data?.content) {
                const maxFetch = HarnessConfig.truncation.fetchUrlContent;
                const content = data.content.length > maxFetch ? data.content.slice(0, maxFetch) + '...' : data.content;
                return `Tool: fetch_url\nURL: ${data.url || r.args?.url}\nTitle: ${data.title || ''}\nPage Content:\n${content}`;
            }
            if (r.name === 'search_knowledge' && data?.results) {
                const chunks = data.results.map(c => `- [${c.title}] (score: ${c.score}): ${c.text}`).join('\n');
                return `Tool: search_knowledge\nQuery: "${data.query || r.args?.query}"\nKnowledge Results:\n${chunks || '(no results)'}`;
            }
            return `Tool: ${r.name}\nResult: ${JSON.stringify(data, null, 2).slice(0, HarnessConfig.truncation.toolResultJson)}`;
        }).join('\n\n');

        // Profile context for recall scenarios
        let profileContext = '';
        if (_orientation.memory_action === 'recall' && Object.keys(_orientation.user_profile || {}).length > 0) {
            const formatted = this._ctx?.formattedProfileRecall
                || Object.entries(_orientation.user_profile).map(([k, v]) => `${k}=${v}`).join(', ');
            profileContext = `User profile (from memory): ${formatted}\nUse this to answer if tool results are insufficient.`;
        }

        // ── No-fabrication guard for knowledge-bounded queries ──
        // Case 1: search_knowledge was the only tool and returned empty → immediate fallback
        // Case 2: query is knowledge-bounded (site-domain / private-info) and search_knowledge
        //         returned results but they don't answer a private-info question → fallback
        const knowledgeResults = _actResults.filter(r => r.name === 'search_knowledge');
        const nonSummaryResults = _actResults.filter(r => r.name !== '_previous_summary');
        const onlyKnowledge = knowledgeResults.length > 0 && nonSummaryResults.length === knowledgeResults.length;
        const isKnowledgeBounded = isCtx && observationOrCtx._knowledgeBounded;
        const isPrivate = isPrivateInfoQuery(_userText);

        if (onlyKnowledge || (isKnowledgeBounded && knowledgeResults.length > 0)) {
            const allEmpty = knowledgeResults.every(r => {
                const data = r.result || {};
                return !data.results || data.results.length === 0 || data.error;
            });
            // For private-info queries, even if results exist they won't contain private data.
            // Produce fallback unless results explicitly contain the answer (high confidence from sufficiency).
            if (allEmpty || isPrivate) {
                const agentsCfg = isCtx ? observationOrCtx.agentsConfig : null;
                const fallbackText = agentsCfg
                    ? buildNoKnowledgeFallback(agentsCfg, _orientation.language)
                    : 'I don\'t have that information available at the moment.';
                const result = { needs_more: false, final_answer: fallbackText, confidence: 'medium' };
                if (isCtx) observationOrCtx.evaluation = result;
                return result;
            }
        }

        // ── Exact-fact extraction: deterministic answer for high-confidence public facts ──
        // If search_knowledge returned results, try to extract an exact answer (URL, location, project)
        // before falling through to LLM synthesis.
        if (knowledgeResults.length > 0) {
            const allChunks = [];
            for (const r of knowledgeResults) {
                if (r.result?.results) allChunks.push(...r.result.results);
            }
            if (allChunks.length > 0) {
                const exactFact = extractKnowledgeFact(_userText, allChunks, { language: _orientation.language });
                if (exactFact) {
                    const result = { needs_more: false, final_answer: exactFact.answer, confidence: 'high', _factType: exactFact.factType };
                    if (isCtx) observationOrCtx.evaluation = result;
                    return result;
                }
            }
        }

        // ── Micro 7: Check sufficiency ──
        const fullResults = resultsText + (profileContext ? `\n${profileContext}` : '');
        const sufficiency = _hasDeterministicToolCoverage(_actResults)
            ? { sufficient: true, reason: 'deterministic tool results available' }
            : await this._microSufficiency(
                _userText, observation.key_entities || [], fullResults, _opts
            );

        if (sufficiency.sufficient) {
            // ── Micro 8: Generate answer ──
            const answer = await this._microAnswer(
                _userText, fullResults, _orientation.language, profileContext, _opts
            );
            const result = { needs_more: false, final_answer: answer, confidence: 'high' };
            if (isCtx) observationOrCtx.evaluation = result;
            return result;
        } else {
            const result = { needs_more: true, reason: sufficiency.reason, confidence: 'low' };
            if (isCtx) observationOrCtx.evaluation = result;
            return result;
        }

    } catch (e) {
        // Fallback to legacy _evaluate on any error
        console.warn('evaluateMicro failed, falling back to legacy:', e.message);
        return this._evaluate(observation, _orientation, _actResults, _userText, _opts);
    }
}
