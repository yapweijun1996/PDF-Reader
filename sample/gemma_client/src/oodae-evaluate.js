// ============================================================
//  oodae-evaluate.js — EVALUATE phase + response generation
//  Result checking, final answer, direct response
// ============================================================

import { HarnessConfig } from './config.js';
import { COT, quoteForPrompt } from './cot-standard.js';
import { _getAgentsBlock } from './oodae-helpers.js';
import { buildNoKnowledgeFallback, isPrivateInfoQuery } from './agents-config.js';
import { extractKnowledgeFact } from './knowledge-fact-extractor.js';

function _getStrictLanguageRules(language) {
    const base = 'Use exactly one language in the final answer. Do not append translations, transliterations, pinyin, romaji, or bilingual glosses unless the user explicitly asked for them.';
    if (language === 'mandarin') return `${base} Write only in 中文.`;
    if (language === 'japanese') return `${base} Write only in 日本語.`;
    if (language === 'malay') return `${base} Write only in Bahasa Melayu.`;
    if (language === 'english') return `${base} Write only in English.`;
    return base;
}

// ===== EVALUATE: Check results and generate response =====
export async function _evaluate(observation, orientation, actResults, userText, opts) {
    // ── No-fabrication guard for knowledge-bounded queries ──
    const knowledgeResults = (actResults || []).filter(r => r.name === 'search_knowledge');
    const nonSummaryResults = (actResults || []).filter(r => r.name !== '_previous_summary');
    const onlyKnowledge = knowledgeResults.length > 0 && nonSummaryResults.length === knowledgeResults.length;
    const isPrivate = isPrivateInfoQuery(userText);
    if (onlyKnowledge || (knowledgeResults.length > 0 && isPrivate)) {
        const allEmpty = knowledgeResults.every(r => {
            const data = r.result || {};
            return !data.results || data.results.length === 0 || data.error;
        });
        if (allEmpty || isPrivate) {
            const agentsCfg = opts?.agentsConfig;
            const fallbackText = agentsCfg
                ? buildNoKnowledgeFallback(agentsCfg, orientation.language)
                : 'I don\'t have that information available at the moment.';
            return { needs_more: false, final_answer: fallbackText, confidence: 'medium' };
        }
    }

    // ── Exact-fact extraction: deterministic answer for high-confidence public facts ──
    if (knowledgeResults.length > 0) {
        const allChunks = [];
        for (const r of knowledgeResults) {
            if (r.result?.results) allChunks.push(...r.result.results);
        }
        if (allChunks.length > 0) {
            const exactFact = extractKnowledgeFact(userText, allChunks, { language: orientation.language });
            if (exactFact) {
                return { needs_more: false, final_answer: exactFact.answer, confidence: 'high', _factType: exactFact.factType };
            }
        }
    }

    // ── Harness: rank results by entity relevance ──
    const entities = (observation.key_entities || []).map(e => String(e).toLowerCase());
    const rankedResults = this._rankByRelevance(actResults, observation.key_entities);

    const resultsText = rankedResults.map(r => {
        const data = r.result || r.error;
        if (r.name === 'web_search' && data?.results) {
            // ── Harness: sort snippets by entity relevance ──
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

    const lang = this._getLangInstruction(orientation.language);
    const strictLanguageRules = _getStrictLanguageRules(orientation.language);

    // ── Bug 2 fix: inject user_profile when memory_action=recall ──
    // recall_memory's string matching may miss keys (e.g. query "name" vs key "user_info").
    // ORIENT already loaded ALL memories — provide them so EVALUATE can answer from profile.
    let profileContext = '';
    if (orientation.memory_action === 'recall' && Object.keys(orientation.user_profile || {}).length > 0) {
        const formatted = this._ctx?.formattedProfileRecall
            || Object.entries(orientation.user_profile).map(([k, v]) => `${k}=${v}`).join(', ');
        profileContext = `\nUSER PROFILE (from memory): ${formatted}\nUse this profile data to answer if the tool results are insufficient.\n`;
    }

    const agentsBlock = _getAgentsBlock(opts, 'tool');
    const prompt = `Read the tool results CAREFULLY and answer the user's question.
${agentsBlock ? `\n${agentsBlock}\n` : ''}
QUESTION: ${quoteForPrompt(userText)}
${lang}${profileContext}

TOOL RESULTS:
${resultsText}

${COT.evaluate()}

IMPORTANT RULES:
1. ONLY state facts EXPLICITLY written in tool results. Never infer or guess.
2. ENTITY NAME VERIFICATION (CRITICAL): The entity in the results must match the user's query EXACTLY.
   - "ZetaCorp" ≠ "Zeta Global" — these are DIFFERENT companies.
   - "Star Alliance" ≠ "Allied Stars" — these are DIFFERENT entities.
   - If the user asks about an entity and NO results contain that EXACT name, it likely does not exist or is not well-known. Say so honestly. Do NOT answer about a similar-sounding entity instead.
3. If a snippet says "X is the primary contact" → that's a valid answer.
4. If LinkedIn shows "Experience: Company X" but NO title/role → say the role is not stated.
5. If tool returned an ERROR, set needs_more=true.
6. If results are about a WRONG entity, set needs_more=true and suggest a more specific search.
7. If same search tried before with same results, give the best answer you have — be honest about what is and isn't confirmed.
8. TANGENTIAL MENTION FILTER (CRITICAL): If a result mentions the entity only IN PASSING (e.g., in a list, comparison, or aside), but the result is NOT fundamentally ABOUT that entity, IGNORE it.
   - A result is relevant ONLY if the entity is the MAIN SUBJECT.
   - "Tesla leads the EV market..." → RELEVANT (Tesla is main subject)
   - "...competitors like Tesla..." → NOT RELEVANT (mentioned in passing)
   - When in doubt, check the result TITLE — if the entity is not in the title, the result is likely tangential.
9. ${lang}
10. ${strictLanguageRules}
11. NO-FABRICATION RULE: If tool results (especially search_knowledge) do not contain the answer, do NOT invent one. Say clearly that the information is not available. Never fabricate personal details, pricing, client lists, or private data.
12. KNOWLEDGE GROUNDING: When results contain specific facts (URLs, project names, descriptions), include them directly in the answer. Do not paraphrase away concrete details like URLs or project descriptions.

{"needs_more":false,"final_answer":"your answer based ONLY on evidence from tool results","confidence":"high|medium|low"} if you can answer
{"needs_more":true,"reason":"specific missing info","suggested_query":"a different search query to try","confidence":"low"} if truly cannot answer

JSON:`;

    const raw = await this._callModel(prompt, {
        ...opts,
        _phase: 'evaluate',
        generationConfig: { ...HarnessConfig.generation.deterministic }
    });
    const parsed = this._parseJSON(raw);
    if (!parsed) return { needs_more: false, final_answer: this._stripThinking(raw), _raw: raw };
    return { ...parsed, _raw: raw };
}

// ===== Direct response (no tools needed) =====
export async function _directResponse(userTextOrCtx, observation, orientation, chatHistory, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = userTextOrCtx && typeof userTextOrCtx === 'object' && 'userText' in userTextOrCtx;
    const userText     = isCtx ? userTextOrCtx.userText     : userTextOrCtx;
    const _observation = isCtx ? userTextOrCtx              : observation;
    const _orientation = isCtx ? userTextOrCtx              : orientation;
    const _chatHistory = isCtx ? userTextOrCtx.chatHistory  : chatHistory;
    const _opts        = isCtx ? userTextOrCtx              : opts;

    const lang = this._getLangInstruction(_orientation.language);
    const strictLanguageRules = _getStrictLanguageRules(_orientation.language);

    // ── P16 fix: format profile with semantic key descriptions ──
    // Instead of flat "cat_name=小白", describe what each key means
    // so the model won't confuse pet names with user names
    // ── Greeting/acknowledgment guard: don't inject profile to prevent memory leak ──
    let profile = '';
    const skipProfile = _observation.intent === 'greeting' || _observation.intent === 'acknowledgment';
    if (!skipProfile && Object.keys(_orientation.user_profile).length > 0) {
        const formatted = this._ctx?.formattedProfile
            || Object.entries(_orientation.user_profile).map(([k, v]) => {
                const kl = k.toLowerCase();
                if (kl.includes('cat_') || kl.includes('dog_') || kl.includes('pet_')) return `${k}=${v} (this is about the user's PET, not the user)`;
                return `${k}=${v}`;
            }).join(', ');
        profile = `Known about user: ${formatted}
IMPORTANT: Memory keys describe WHAT the value is. "user_name" = the user's name. "cat_name" = the user's cat's name (NOT the user's name). "user_birthday" = user's birthday. Match the question to the correct key. If no matching key exists, say you don't have that information.`;
    }

    // ── P19 fix: include recent chat history for conversation-aware responses ──
    const recent = this._ctx?.recent10 || this._getRecentContext(_chatHistory, HarnessConfig.context.evaluateRecentMessages);
    const historyBlock = recent ? `\nRecent conversation:\n${recent}\n` : '';

    const agentsBlock = _getAgentsBlock(_opts, 'tool');
    const prompt = `${lang}
${agentsBlock ? `${agentsBlock}\n` : ''}${profile}
${historyBlock}
User says: ${quoteForPrompt(userText)}

${COT.direct(_orientation.language || 'english')}

Extra final-answer rule:
- ${strictLanguageRules}
- If the user asks to summarize the conversation, use ONLY the conversation history above and do NOT fabricate or guess.

Reply naturally and helpfully. ${lang}`;

    const raw = await this._callModel(prompt, {
        ..._opts,
        _phase: 'direct',
        generationConfig: { ...HarnessConfig.generation.creative }
    });
    return this._stripThinking(raw);
}

// ===== Force final answer after max loops =====
export async function _forceFinalAnswer(userTextOrCtx, observation, orientation, actResults, opts) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    const isCtx        = userTextOrCtx && typeof userTextOrCtx === 'object' && 'userText' in userTextOrCtx;
    const userText     = isCtx ? userTextOrCtx.userText     : userTextOrCtx;
    const _orientation = isCtx ? userTextOrCtx              : orientation;
    const _actResults  = isCtx ? (userTextOrCtx.allActResults || []) : actResults;
    const _opts        = isCtx ? userTextOrCtx              : opts;

    const resultsText = _actResults.map(r =>
        `${r.name}: ${JSON.stringify(r.result || r.error).slice(0, HarnessConfig.truncation.forceAnswerResult)}`
    ).join('\n');
    const lang = this._getLangInstruction(_orientation.language);
    const strictLanguageRules = _getStrictLanguageRules(_orientation.language);

    const agentsBlock = _getAgentsBlock(_opts, 'tool');
    const prompt = `${lang}
${strictLanguageRules}
${agentsBlock ? `${agentsBlock}\n` : ''}Answer this question using the information below. This is your final attempt.

Question: ${quoteForPrompt(userText)}
Information:
${resultsText}

${COT.forceAnswer()}

${lang} write your answer now:`;

    const raw = await this._callModel(prompt, {
        ..._opts,
        _phase: 'fallback',
        generationConfig: { ...HarnessConfig.generation.creative }
    });
    return this._stripThinking(raw);
}
