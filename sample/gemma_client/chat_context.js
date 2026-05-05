// ============================================================
//  chat_context.js — Token tracking, compaction, user context injection
//  References S, $msgs, $chatWrapper (from chat_app.js),
//  esc, extractThinking, clog (from chat_utils.js),
//  stripToolCalls (from GemmaClient), MemoryDB (from chat_memory.js)
//  at call time.
// ============================================================

// ===== AGENTS.md persona & policy (set by chat_app.js on init) =====
let _agentsPromptBlock = '';
function setAgentsPromptBlock(block) { _agentsPromptBlock = block || ''; }

// ===== Context Compaction =====
// Use centralized config — single source of truth (see src/config.js)
const _cfg = typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig?.context || {};
const COMPACT_THRESHOLD = _cfg.compactThreshold || 99000;
const CHARS_PER_TOKEN = _cfg.charsPerToken || 3.5;
const KEEP_RECENT = _cfg.keepRecent || 10;

function estimateTokens(history) {
    let chars = 0;
    for (const msg of history) {
        for (const part of (msg.parts || [])) {
            chars += (part.text || '').length;
        }
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

let _saveTimer = null;
function updateSaveIndicator() {
    const el = document.getElementById('saveInfo');
    if (!el) return;
    const now = new Date();
    el.textContent = `Saved ${now.toLocaleTimeString()}`;
    el.classList.add('just-saved');
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => el.classList.remove('just-saved'), 2000);
}

function updateTokenDisplay() {
    const el = document.getElementById('tokenInfo');
    if (!el) return;
    // Prefer actual API-reported tokens; fall back to text-based estimate
    const actual = S.sessionTokens;
    if (actual > 0) {
        const k = (actual / 1000).toFixed(1);
        el.textContent = `${k}K tokens`;
        el.className = actual > COMPACT_THRESHOLD ? 'token-crit' : actual > 80000 ? 'token-warn' : '';
    } else {
        const est = estimateTokens(S.chatHistory);
        const k = (est / 1000).toFixed(1);
        el.textContent = `~${k}K tokens`;
        el.className = est > COMPACT_THRESHOLD ? 'token-crit' : est > 80000 ? 'token-warn' : '';
    }
}

function compactHistory() {
    // Use actual API tokens if available; fall back to text estimate
    const oldTokens = S.sessionTokens > 0 ? S.sessionTokens : estimateTokens(S.chatHistory);
    if (oldTokens < COMPACT_THRESHOLD) return false;

    // Find system context (first 2 messages from injectUserContext)
    let sysCount = 0;
    if (S.chatHistory.length >= 2) {
        const firstText = S.chatHistory[0].parts?.[0]?.text || '';
        if (firstText.startsWith('[User context]')) sysCount = 2;
    }

    const totalMsgs = S.chatHistory.length;
    const keep = Math.min(KEEP_RECENT, totalMsgs - sysCount);
    if (totalMsgs - sysCount - keep < 4) return false; // too few to compact

    const systemMsgs = S.chatHistory.slice(0, sysCount);
    const recentMsgs = S.chatHistory.slice(-keep);
    const middleMsgs = S.chatHistory.slice(sysCount, totalMsgs - keep);

    // Extract clean Q&A pairs — strip thinking, tool calls, tool results
    const pairs = [];
    for (const msg of middleMsgs) {
        const text = msg.parts?.map(p => p.text || '').join('') || '';
        if (!text) continue;
        // Skip system/internal messages
        if (text.startsWith('[User context]') || text.startsWith('Understood.') || text.startsWith('Noted.')) continue;
        if (text.startsWith('[Context compacted') || text.startsWith('[Conversation summary')) continue;
        if (text.includes('results from the tool calls')) continue;

        if (msg.role === 'user') {
            const clean = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
            if (clean) pairs.push(`User: ${clean.slice(0, 150)}`);
        } else if (msg.role === 'model') {
            const { cleaned } = extractThinking(text);
            const stripped = stripToolCalls(cleaned).trim();
            if (stripped) pairs.push(`Assistant: ${stripped.slice(0, 200)}`);
        }
    }

    if (pairs.length === 0) return false;

    // Build compact summary
    let summaryText = `[Context compacted — ${middleMsgs.length} older messages summarized]\n${pairs.join('\n')}`;

    // Assemble new history
    S.chatHistory = [
        ...systemMsgs,
        { role: 'user', parts: [{ text: summaryText }] },
        { role: 'model', parts: [{ text: 'Understood, I have the conversation context. Continuing.' }] },
        ...recentMsgs
    ];

    // If still over threshold, aggressively shorten
    let newTokens = estimateTokens(S.chatHistory);
    if (newTokens > COMPACT_THRESHOLD) {
        const shortPairs = pairs.map(p => p.slice(0, 60));
        summaryText = `[Context heavily compacted — ${middleMsgs.length} messages]\n${shortPairs.join('\n')}`;
        S.chatHistory = [
            ...systemMsgs,
            { role: 'user', parts: [{ text: summaryText }], _meta: 'system' },
            { role: 'model', parts: [{ text: 'Understood.' }], _meta: 'system' },
            ...recentMsgs
        ];
        newTokens = estimateTokens(S.chatHistory);
    }

    // If STILL over (recent messages themselves are huge), trim recent
    if (newTokens > COMPACT_THRESHOLD && recentMsgs.length > 4) {
        const trimmedRecent = recentMsgs.slice(-4);
        S.chatHistory = [
            ...systemMsgs,
            { role: 'user', parts: [{ text: summaryText }], _meta: 'system' },
            { role: 'model', parts: [{ text: 'Understood.' }], _meta: 'system' },
            ...trimmedRecent
        ];
        newTokens = estimateTokens(S.chatHistory);
    }

    const oldK = (oldTokens / 1000).toFixed(1);
    const newK = (newTokens / 1000).toFixed(1);
    clog('warn', `Context compacted: ~${oldK}K → ~${newK}K tokens (${middleMsgs.length} messages → ${pairs.length} pairs, ${S.chatHistory.length - sysCount - 2} recent kept)`);

    // Show notice in chat
    const notice = document.createElement('div');
    notice.className = 'compact-notice';
    notice.textContent = `\u{26A1} Context compacted: ~${oldK}K \u{2192} ~${newK}K tokens (${middleMsgs.length} older messages summarized)`;
    $msgs.appendChild(notice);
    $chatWrapper.scrollTop = $chatWrapper.scrollHeight;

    MemoryDB.saveSession(S.chatHistory, S.sessionTokens);
    updateSaveIndicator();
    updateTokenDisplay();
    return true;
}

// ===== User context =====
function getUserContext() {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = navigator.language || 'en-US';
    return `[User context] Timezone: ${tz} | Local time: ${now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' })} | Locale: ${locale}`;
}

function _joinedText(msg) {
    return (msg.parts || []).map(p => p.text || '').join('');
}

function _visibleChatMessages(history) {
    return history.filter(msg => {
        const text = _joinedText(msg);
        if (!text) return false;
        if (msg._meta === 'system') return false;
        if (text.startsWith('[User context]')) return false;
        return true;
    });
}

function _detectReplyLanguage(text) {
    if (/[\u4e00-\u9fff]/.test(text || '')) return 'zh';
    return 'same-as-user';
}

function _extractGroupLedger(history) {
    const visible = _visibleChatMessages(history);
    const state = {
        groups: [],
        current: null,
        language: 'same-as-user',
    };
    let current = null;

    for (const msg of visible) {
        const text = _joinedText(msg).trim();
        if (!text) continue;

        const detectedLanguage = _detectReplyLanguage(text);
        if (detectedLanguage !== 'same-as-user') state.language = detectedLanguage;

        const enterMatch = msg.role === 'user'
            ? text.match(/进入第\s*(\d+)\s*组[\s\S]*?项目=([^\s，。,；;]+)[\s\S]*?基数=(\d+)[\s\S]*?颜色=([^\s，。,；;]+)/)
            : null;
        if (enterMatch) {
            current = {
                group: Number(enterMatch[1]),
                project: enterMatch[2],
                base: Number(enterMatch[3]),
                updatedBase: null,
                color: enterMatch[4],
                lastResult: null,
            };
            state.groups.push(current);
            state.current = current;
            continue;
        }

        if (!current) continue;

        // Explicit update requests are the only time a computed value becomes the new stable base.
        if (msg.role === 'user' && /更新为前一个结果减1/.test(text) && Number.isFinite(current.lastResult)) {
            current.updatedBase = current.lastResult - 1;
            continue;
        }

        // Track plain numeric model results as temporary calculation outputs.
        if (msg.role === 'model') {
            const numeric = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
            if (numeric) {
                current.lastResult = Number(numeric[1]);
            }
        }
    }

    return state;
}

function _findGroupRecord(ledger, groupNumber) {
    if (!ledger || !Array.isArray(ledger.groups)) return null;
    if (groupNumber === null || groupNumber === undefined) return ledger.current || null;
    return ledger.groups.find(group => group.group === groupNumber) || null;
}

function _shouldUseFocusedLedger(ledger, currentUserText) {
    if (!ledger?.groups?.length || !currentUserText) return false;
    return /第\s*\d+\s*组|基数|新基数|颜色|项目|前一个结果/.test(currentUserText);
}

function _buildFocusedSimpleContents(history, systemMsg, ledger, currentUserText, targetGroup, useChineseRules) {
    const apiContents = [];
    const included = [];
    const pushGroup = (group) => {
        if (!group || included.includes(group.group)) return;
        included.push(group.group);
    };

    pushGroup(targetGroup);
    pushGroup(ledger.current);
    for (const group of ledger.groups.slice(-3).reverse()) pushGroup(group);

    const ledgerLines = ['[Structured group ledger]'];
    for (const groupNumber of included) {
        const group = _findGroupRecord(ledger, groupNumber);
        if (!group) continue;
        const details = [
            `项目=${group.project}`,
            `稳定基数=${group.base}`,
            `颜色=${group.color}`
        ];
        if (group.updatedBase !== null) details.push(`新基数=${group.updatedBase}`);
        if (Number.isFinite(group.lastResult)) details.push(`最近临时结果=${group.lastResult}`);
        ledgerLines.push(`- 第${group.group}组：${details.join('，')}。`);
    }
    ledgerLines.push(useChineseRules
        ? '- 只有上面的结构化台账是事实来源；不要根据旧的模型回复文本改写基数、项目或颜色。'
        : '- Only the structured ledger above is the source of truth. Do not infer stable facts from prior model replies.');

    if (history.length >= 2) {
        const firstText = _joinedText(history[0]);
        if (firstText.startsWith('[User context]')) {
            apiContents.push(history[0], history[1]);
        }
    }

    apiContents.push(systemMsg);
    apiContents.push({ role: 'user', parts: [{ text: ledgerLines.join('\n') }], _meta: 'system' });
    apiContents.push({
        role: 'model',
        parts: [{ text: useChineseRules ? '明白，我会只按结构化台账回答。' : 'Understood. I will answer from the structured ledger only.' }],
        _meta: 'system'
    });
    apiContents.push({ role: 'user', parts: [{ text: currentUserText }] });
    return apiContents;
}

function buildSimpleModeContents(history) {
    const visible = _visibleChatMessages(history);
    const ledger = _extractGroupLedger(history);
    const facts = ledger.current || null;
    const currentUserText = visible.filter(msg => msg.role === 'user').slice(-1).map(_joinedText)[0] || '';
    const guidance = [];
    const summaryMatch = currentUserText.match(/总结第\s*(\d+)\s*组/);
    const targetGroup = _findGroupRecord(ledger, summaryMatch ? Number(summaryMatch[1]) : null);
    const useChineseRules = ledger.language === 'zh' || _detectReplyLanguage(currentUserText) === 'zh';

    guidance.push('[Simple-mode working rules]');
    if (useChineseRules) {
        guidance.push('- 本轮必须只用中文回答，除非用户明确要求别的语言。');
        guidance.push('- 不要添加英文翻译、拼音、罗马字，必要的专有名词保持用户原写法。');
        guidance.push('- 保持标识原样，不要把“项目1”改写成“Project1”。');
        guidance.push('- 算术结果只是临时结果，除非用户明确要求更新、替换、保存或记住，否则不能覆盖稳定事实。');
        guidance.push('- 不能把项目、基数、颜色这些稳定事实改成衍生计算结果。');
        guidance.push('- 不要擅自发明下一组、下一个项目或未来步骤。');
        guidance.push('- 用户问“项目和颜色”时，只回答项目和颜色。');
        guidance.push('- “基数”始终指原始稳定基数；“新基数”只指用户明确更新后的基数。');
    } else {
        guidance.push('- Reply in the same language as the latest user message.');
        guidance.push('- Keep identifiers exactly as the user wrote them. Do not translate or anglicize names like "项目1" into "Project1".');
        guidance.push('- Arithmetic answers are temporary results unless the user explicitly says to update, replace, store, or remember a value.');
        guidance.push('- Do not overwrite the stable project/base/color with derived calculations unless the user explicitly updates them.');
        guidance.push('- Do not invent the next group, next project, or any future step unless the user explicitly defines it.');
        guidance.push('- When the user asks for project and color, answer only project and color. Do not substitute base or calculation results.');
        guidance.push('- "基数" means the original stable base. "新基数" means the explicitly updated base only after an update instruction.');
    }

    if (facts && (facts.group !== null || facts.project || facts.base !== null || facts.color)) {
        guidance.push('[Current stable facts]');
        if (facts.group !== null) guidance.push(`- Current group: 第${facts.group}组`);
        if (facts.project) guidance.push(`- Current project: ${facts.project}`);
        if (facts.base !== null) guidance.push(`- Current stable base: ${facts.base}`);
        if (facts.updatedBase !== null) guidance.push(`- Current updated base: ${facts.updatedBase}`);
        if (facts.color) guidance.push(`- Current color: ${facts.color}`);
    }

    if (facts && Number.isFinite(facts.lastResult)) {
        guidance.push(`[Last temporary calculation result] ${facts.lastResult}`);
    }

    if (currentUserText) {
        guidance.push('[Current turn grounding]');
        if (/项目和颜色/.test(currentUserText)) {
            guidance.push('- The user asked only for project and color. Answer with project and color only.');
            if (facts?.project && facts?.color) {
                guidance.push(`- Exact facts for this reply: 项目=${facts.project}，颜色=${facts.color}。`);
                if (useChineseRules) guidance.push(`- 推荐回答格式：${facts.project}，${facts.color}。`);
            }
        }
        if (/颜色是什么/.test(currentUserText) && facts?.color) {
            guidance.push(useChineseRules
                ? `- 本轮只回答颜色本身：${facts.color}`
                : `- Answer with the color only: ${facts.color}`);
        }
        if (/基数是多少/.test(currentUserText) && targetGroup?.base !== null) {
            guidance.push(useChineseRules
                ? `- 本轮只回答稳定基数的数字：${targetGroup.base}`
                : `- Answer with the stable base number only: ${targetGroup.base}`);
        }
        if (/继续下一组前/.test(currentUserText)) {
            guidance.push(useChineseRules
                ? '- 用户要的是一句简短确认，不要提任何下一组编号。'
                : '- The user asked for a short readiness confirmation. Do not mention any next group number.');
            if (useChineseRules) guidance.push('- 直接回答“准备好了。”，不要超过12个字。');
        }
        if (/新基数/.test(currentUserText)) {
            if (facts?.updatedBase !== null) {
                guidance.push(`- Use the updated base ${facts.updatedBase} for this reply.`);
            } else {
                guidance.push(useChineseRules
                    ? '- 目前还没有已更新的新基数；不要把临时运算结果当成新基数。'
                    : '- No updated base exists yet. Do not reuse the last temporary result unless the user explicitly updated it.');
            }
            if (/更新为前一个结果减1/.test(currentUserText) && facts && Number.isFinite(facts.lastResult)) {
                const nextUpdatedBase = facts.lastResult - 1;
                guidance.push(useChineseRules
                    ? `- 本轮要把新基数设为最近临时结果减1：${facts.lastResult} - 1 = ${nextUpdatedBase}。只回答这个数字。`
                    : `- Set the updated base to the latest temporary result minus 1: ${facts.lastResult} - 1 = ${nextUpdatedBase}. Answer with that number only.`);
            }
        } else if (/基数/.test(currentUserText) || /总结第/.test(currentUserText)) {
            if (targetGroup?.base !== null) {
                guidance.push(`- Use the stable base ${targetGroup.base} for this reply, not the last temporary calculation result.`);
            }
        }
        if (/总结第/.test(currentUserText) && targetGroup) {
            guidance.push('[Resolved summary facts]');
            guidance.push(`- Target group: 第${targetGroup.group}组`);
            guidance.push(`- Stable summary facts: 项目=${targetGroup.project}，基数=${targetGroup.base}，颜色=${targetGroup.color}。`);
            if (targetGroup.updatedBase !== null) {
                guidance.push(`- Updated base exists separately: ${targetGroup.updatedBase}. Do not call it "基数" unless the user explicitly asks for "新基数".`);
            }
            if (Number.isFinite(targetGroup.lastResult)) {
                guidance.push(`- Temporary arithmetic result exists separately: ${targetGroup.lastResult}. Do not replace "基数" with it.`);
            }
            if (useChineseRules) {
                guidance.push(`- 本轮一句话总结应锚定这些稳定事实：第${targetGroup.group}组是${targetGroup.project}，基数是${targetGroup.base}，颜色是${targetGroup.color}。`);
            }
        }
    }

    const systemMsg = { role: 'user', parts: [{ text: guidance.join('\n') }], _meta: 'system' };
    if (_shouldUseFocusedLedger(ledger, currentUserText)) {
        return _buildFocusedSimpleContents(history, systemMsg, ledger, currentUserText, targetGroup, useChineseRules);
    }

    const apiContents = [];
    if (history.length >= 2) {
        const firstText = _joinedText(history[0]);
        if (firstText.startsWith('[User context]')) {
            apiContents.push(history[0], history[1]);
            apiContents.push(systemMsg);
            apiContents.push(...history.slice(2));
            return apiContents;
        }
    }

    apiContents.push(systemMsg, ...history);
    return apiContents;
}

async function injectUserContext() {
    if (S.chatHistory.length === 0) {
        let ctx = getUserContext();
        let ack = 'Understood.';

        // ── AGENTS.md persona & policy injection ──
        if (typeof _agentsPromptBlock === 'string' && _agentsPromptBlock.length > 0) {
            ctx += `\n\n${_agentsPromptBlock}`;
        }

        if (S.toolMode) {
            ctx += `\n\n[Memory instructions]
You have persistent memory tools (save_memory, recall_memory, list_memories, delete_memory).
You have saved memories from previous sessions stored in your memory database, but you do NOT know what they contain right now.

IMPORTANT RULES:
1. At the START of every new conversation, you MUST call list_memories() first to check what you already know about the user. Do this BEFORE responding to the user's first message.
2. After retrieving memories, you MUST FOLLOW all user preferences found in the "preferences" category. Especially:
   - If "user_language_preference" is set (e.g. "mandarin", "malay", "japanese"), you MUST reply in that language for ALL subsequent messages. This is NOT optional.
   - If other preferences exist (units, style, etc.), follow them too.
3. When the user ASKS about their personal info ("my name", "my car color") → call recall_memory or list_memories. NEVER guess.
4. When the user TELLS you personal info with a CONCRETE VALUE ("I'm Wei Jun", "my car is red") → call save_memory to store it.
5. NEVER answer questions about the user's personal data from your own knowledge. ALWAYS use memory tools.

The rule for ASKING vs TELLING:
- "my name" / "what is my name" = ASKING → recall_memory(query="user_name")
- "my name is Wei Jun" / "I'm Wei Jun" = TELLING → save_memory(key="user_name", value="Wei Jun", category="user_profile")
- No concrete value = asking. Has concrete value = telling.

Language preference rules:
- "mandarin" or "chinese" → reply in 中文. NO pinyin. NO romanization.
- "malay" or "bahasa" → reply in Bahasa Melayu.
- "japanese" → reply in 日本語. No romaji.
- "english" → reply in English only.
- If no preference saved, default to the language the user writes in.

CRITICAL: NEVER translate proper nouns. Always keep these in their ORIGINAL form exactly as found in source data:
- People names (e.g. "John Smith" stays "John Smith", NOT "约翰·史密斯")
- Company/brand names (e.g. "Acme Corp Pte Ltd" stays "Acme Corp Pte Ltd")
- Addresses (e.g. "123 Main Street" stays "123 Main Street", NOT "主街123号")
- Email addresses, phone numbers, URLs/websites, product names
Only translate your descriptive sentences, not the factual data itself.

When language preference is set, your sentences must be in that language, but proper nouns stay untranslated. Do not add pinyin, romanizations, or translations in parentheses.

When user says "remember X" or "save X" with a preference, save the COMPLETE instruction as the value, not just one word. Example: user says "remember reply mandarin only no pinyin" → save_memory(key="reply_style", value="mandarin only, no pinyin, no english translation, no romanization", category="preferences")

Categories: "user_profile" for personal info, "preferences" for settings, "facts" for general knowledge.

[Tool usage best practices]
- When you get search results (web_search, tech_news, ddg_search), do NOT just list titles and URLs. Use fetch_url or summarize_url to READ the most relevant article(s) and provide a proper summary of the content.
- When the user asks about a topic, search first, then read the top result to give a detailed answer.
- When the user shares a URL, always use fetch_url to read it before responding.
- Prefer giving substantive answers with real content over just listing links.
- You can chain tools: web_search → fetch_url → summarize. This gives the best answers.

[Thinking process — REQUIRED]
Before EVERY response, you MUST think step-by-step inside <thinking> tags. This is mandatory.
Your thinking should include:
1. What is the user asking for?
2. What language should I reply in? (check memory preferences)
3. Which tool(s) do I need? Why?
4. What is my plan to answer this?
5. Any preferences I need to follow?

Format:
<thinking>
[your step-by-step reasoning here]
</thinking>

[your actual response or tool calls here]

Example:
<thinking>
User says "hi". This is a greeting. I need to:
1. Check memories first (list_memories)
2. After getting memories, greet in their preferred language
3. Mention what I remember about them
</thinking>
<tool_call>
{"name": "list_memories", "arguments": {}}
</tool_call>

ALWAYS include <thinking> before your response. Never skip it.`;
            ack = 'Understood. I will use list_memories() to check saved data before responding, and always use memory tools to recall or save user information. Let me check what I know about the user.';

            // Do NOT inject memory contents — force agent to use tools
            let memCount = 0;
            try {
                const memories = await MemoryDB.getAllMemories();
                memCount = memories.length;
            } catch {}
            if (memCount > 0) {
                ctx += `\n\nYou have ${memCount} saved memories from previous sessions. Call list_memories() to see them.`;
            }
            clog('info', `Injected user context (${memCount} memories in DB, not pre-loaded)`);
        } else {
            ctx += `\n\n[Response rules]
- Reply in the language the user writes in.
- Keep proper nouns and identifiers exactly as the user wrote them.
- Do not output tool_call tags.
- If you do not know something, say so plainly.
- Do not fabricate information. If unsure, say you do not have that information.`;
            clog('info', 'Injected simple-mode user context');
        }

        S.chatHistory.push(
            { role: 'user', parts: [{ text: ctx }], _meta: 'system' },
            { role: 'model', parts: [{ text: ack }], _meta: 'system' }
        );
    }
}
