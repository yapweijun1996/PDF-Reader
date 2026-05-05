// ============================================================
//  chat_send.js — sendSimpleChat + sendToolChat
//  References S, api, registry (from chat_app.js),
//  clog, esc, extractThinking, deepClone, createDebugProxy (from chat_utils.js),
//  addMessage, showThinking, removeThinking, _stopThinkingTimer (from chat_message.js),
//  startActivityGroup, addActivityItem, updateActivityItem, clearPhaseIndicator,
//    setPhaseIndicatorLine, toolActivityQueue (from chat_activity.js),
//  compactHistory, injectUserContext, updateTokenDisplay, updateSaveIndicator (from chat_context.js),
//  stripToolCalls (from GemmaClient), MemoryDB (from chat_memory.js),
//  renderMarkdown, renderThinkingBlock (from chat_utils.js)
//  at call time.
// ============================================================

// ===== Send: Simple mode =====
async function sendSimpleChat(text) {
    await injectUserContext();
    compactHistory();
    const proxy = createDebugProxy(api);
    const userMsg = { role: 'user', parts: [{ text }] };
    S.chatHistory.push(userMsg);
    S.debug.toolDebug = null;

    // Activity tracking for simple mode
    startActivityGroup(text);
    addActivityItem('observe', '\u{1F4AC}', 'Generating response <span class="running-dot"></span>');

    try {
        const result = await proxy.generateContent({
            contents: buildSimpleModeContents(S.chatHistory),
            model: document.getElementById('modelSel').value,
        });
        const parts = result.candidates[0].content.parts;
        const modelText = parts.map(p => p.text || '').join('');
        S.chatHistory.push({ role: 'model', parts });
        const thinkDur = _stopThinkingTimer();
        removeThinking();
        const tokens = result.usageMetadata?.totalTokenCount || null;
        if (tokens) S.sessionTokens += tokens; // accumulate actual API tokens
        const { thinking, cleaned } = extractThinking(modelText);
        if (thinking) {
            addMessage('thinking', renderThinkingBlock(thinking, thinkDur));
            addActivityItem('thinking', '\u{1F4AD}', 'Thinking', esc(thinking.slice(0, 150)));
        }
        const displayText = stripToolCalls(cleaned);
        if (displayText) addMessage('model', renderMarkdown(displayText), modelText, { ms: S.debug.lastTiming?.ms, tokens });
        // Update activity
        const ms = S.debug.lastTiming?.ms;
        addActivityItem('response', '\u{2728}', `Response <span class="status">${ms ? (ms/1000).toFixed(1) + 's' : ''} ${tokens ? tokens + ' tokens' : ''}</span>`);
        clog('info', `Model replied: ${modelText.length} chars`);
        MemoryDB.saveSession(S.chatHistory, S.sessionTokens);
        MemoryDB.saveKeyState(keyManager.index, keyManager.useCount);
        updateSaveIndicator();
        updateTokenDisplay();
    } catch (err) {
        S.chatHistory.pop();
        _stopThinkingTimer();
        removeThinking();
        addMessage('error', esc(err.message));
        addActivityItem('fallback', '\u{26A0}\u{FE0F}', `Error: ${esc(err.message.slice(0, 80))}`);
        clog('error', err.message);
    }
}

// ===== Global runner reference for ProactiveEngine coordination =====
let _lastRunner = null;
function getRunner() { return _lastRunner; }

// ===== Send: Tool mode (OODA-E) =====
async function sendToolChat(text) {
    compactHistory(); // auto-compact if over 99K tokens
    const proxy = createDebugProxy(api);
    const runner = new OODAERunner(proxy, registry, {
        maxLoops: 3,
        maxActIterations: 5,
        learningSystem: typeof learningSystem !== 'undefined' ? learningSystem : null,
        agentsConfig: typeof agentsConfig !== 'undefined' ? agentsConfig : null,
    });
    _lastRunner = runner;

    // Coordination: wire runner to all autonomous systems
    if (typeof proactiveEngine !== 'undefined' && proactiveEngine) {
        proactiveEngine.runner = runner;
    }
    if (typeof goalManager !== 'undefined' && goalManager) {
        goalManager.runner = runner;
    }

    const toolCalls = [];
    const toolResults = [];

    // Initialize phase indicator + activity group (panel does NOT auto-open)
    clearPhaseIndicator();
    startActivityGroup(text);

    const phaseIcons = { observe: '\u{1F50D}', orient: '\u{1F9ED}', decide: '\u{1F3AF}', act: '\u{26A1}', evaluate: '\u{2705}', fallback: '\u{26A0}\u{FE0F}' };
    const phaseNames = { observe: 'Observing', orient: 'Orienting', decide: 'Planning', act: 'Executing', evaluate: 'Evaluating', fallback: 'Fallback' };
    // User-facing action labels (ChatGPT style — no OODA jargon)
    const phaseActions = { observe: 'Analyzing request', orient: 'Loading context', decide: 'Planning response', act: 'Running tools', evaluate: 'Reviewing results', fallback: 'Retrying' };
    const activityItems = {};
    const piToolKeys = []; // queue to match tool call → result in indicator

    try {
        const result = await runner.run(text, {
            chatHistory: S.chatHistory,
            model: document.getElementById('modelSel').value,
            memoryDB: MemoryDB,

            onPhase: function(phase, data) {
                if (data.status === 'start') {
                    removeThinking();
                    const loop = data.loop ? ` #${data.loop}` : '';
                    const phaseKey = phase + (data.loop || '');
                    _piMode = true;
                    // Inline indicator — user-friendly action text
                    setPhaseIndicatorLine(phaseKey, '', phaseActions[phase] || phase, true);
                    // Activity panel
                    const item = addActivityItem(phase, phaseIcons[phase] || '\u{25CF}',
                        `${phaseNames[phase] || phase}${loop} <span class="running-dot"></span>`);
                    activityItems[phaseKey] = item;
                    showThinking();
                    clog('info', `OODA-E: ${phase}${loop}`);
                } else if (data.status === 'done' && data.data) {
                    const phaseKey = phase + (data.loop || '');
                    const item = activityItems[phaseKey];
                    const d = data.data;
                    let label = '', detail = '', piLabel = '';

                    if (phase === 'observe') {
                        piLabel = 'Observed';
                        label = `Observed: ${esc(d.summary || d.intent || '?')}`;
                        detail = `<b>Intent:</b> ${esc(d.intent || '?')}<br><b>Tools needed:</b> ${d.requires_tools}<br><b>Entities:</b> ${esc((d.key_entities || []).join(', '))}`;
                    } else if (phase === 'orient') {
                        piLabel = 'Oriented';
                        label = `Oriented <span class="status">${esc(d.language || 'auto')}</span>`;
                        detail = `<b>Language:</b> ${esc(d.language)}<br><b>Memories:</b> ${d.memory_count || 0}<br><b>Action:</b> ${esc(d.memory_action || 'none')}`;
                    } else if (phase === 'decide') {
                        const tools = (d.plan || []).map(s => s.tool).join(', ');
                        piLabel = tools ? `Planned: ${tools}` : 'Planned';
                        label = `Planned: ${esc(tools || 'no tools')}`;
                        detail = (d.plan || []).map(s => `<code>${esc(s.tool)}</code>: ${esc(s.reason || '')}`).join('<br>');
                    } else if (phase === 'act') {
                        const count = Array.isArray(d) ? d.length : 0;
                        piLabel = `Executed ${count} tool${count !== 1 ? 's' : ''}`;
                        label = piLabel;
                        detail = Array.isArray(d) ? d.map(r => `<code>${esc(r.name)}</code>: ${r.error ? '<span style="color:var(--red)">error</span>' : 'ok'}`).join('<br>') : '';
                    } else if (phase === 'evaluate') {
                        piLabel = d.needs_more ? 'Needs more info' : 'Evaluated';
                        label = d.needs_more ? 'Needs more info \u{1F504}' : 'Response ready \u{2705}';
                        detail = d.reason ? esc(d.reason) : (d.final_answer ? `${d.final_answer.length} chars` : '');
                    } else {
                        piLabel = `${phase} done`;
                        label = piLabel;
                        detail = esc(JSON.stringify(d).slice(0, 200));
                    }

                    // Inline indicator — no update on done (next phase start will replace it)
                    removeThinking(); showThinking(); // refresh to keep timer alive
                    // Activity panel update with full debug data
                    updateActivityItem(item, label, detail, d);
                    clog('debug', `${phase} done: ${JSON.stringify(data.data).slice(0, 150)}`);
                }
            },

            onToolCall: function(call) {
                removeThinking();
                // Inline indicator — show friendly tool action
                const toolKey = 'tool_' + toolCalls.length;
                const toolActions = {
                    web_search: 'Searching the web',
                    fetch_url: 'Reading page',
                    summarize_url: 'Reading article',
                    get_weather: 'Checking weather',
                    get_time: 'Checking time',
                    calculate: 'Calculating',
                    save_memory: 'Saving to memory',
                    recall_memory: 'Searching memory',
                    list_memories: 'Loading memories',
                    delete_memory: 'Updating memory',
                    crypto_price: 'Checking crypto price',
                    tech_news: 'Fetching news',
                    country_info: 'Looking up info',
                };
                const toolLabel = toolActions[call.name] || call.name.replace(/_/g, ' ');
                setPhaseIndicatorLine(toolKey, '', toolLabel, true);
                piToolKeys.push(toolKey);
                // Activity panel
                const argsStr = JSON.stringify(call.arguments);
                const argsSummary = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
                const item = addActivityItem('tool-call', '\u{1F527}',
                    `${esc(call.name)} <span class="running-dot"></span>`,
                    esc(argsSummary), { name: call.name, arguments: call.arguments });
                toolActivityQueue.push(item);
                toolCalls.push(deepClone(call));
                showThinking();
                clog('info', `Tool: ${call.name}(${JSON.stringify(call.arguments)})`);
            },

            onToolResult: function(call, res) {
                removeThinking();
                const isErr = !!res.error;
                // Inline indicator — tool done, keep current text until next action
                const toolKey = piToolKeys.shift();
                // Activity panel
                const item = toolActivityQueue.shift();
                if (item) {
                    const resultData = res.error || res.result;
                    const resultStr = JSON.stringify(resultData);
                    const summary = resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr;
                    updateActivityItem(item,
                        `${esc(call.name)} ${isErr ? '<span class="status" style="color:var(--red)">error</span>' : '<span class="status" style="color:var(--green)">done</span>'}`,
                        esc(summary),
                        { name: call.name, arguments: call.arguments, result: resultData });
                }
                toolResults.push(deepClone({ call, res }));
                showThinking();
                clog(isErr ? 'error' : 'info', `Result: ${call.name} \u{2192} ${isErr ? 'ERROR' : 'OK'}`);
            }
        });

        const thinkDur = _stopThinkingTimer();
        removeThinking();
        clearPhaseIndicator();
        // Accumulate actual API tokens from OODA-E run
        if (result.tokenStats?.totalTokens) S.sessionTokens += result.tokenStats.totalTokens;
        const tokens = result.tokenStats?.totalTokens || S.debug.lastTokens?.totalTokenCount || null;
        const responseMs = result.durationMs || (thinkDur ? Math.round(thinkDur * 1000) : 0) || S.debug.lastTiming?.ms || null;
        const { thinking, cleaned } = extractThinking(result.response);
        if (thinking) {
            addMessage('thinking', renderThinkingBlock(thinking, thinkDur));
            addActivityItem('thinking', '\u{1F4AD}', 'Thinking', esc(thinking.slice(0, 150)) + (thinking.length > 150 ? '...' : ''), thinking);
        }
        const displayText = stripToolCalls(cleaned);
        if (displayText) addMessage('model', renderMarkdown(displayText), result.response, { ms: responseMs, tokens });
        const responseMeta = [
            responseMs ? (responseMs / 1000).toFixed(1) + 's' : '',
            `${result.iterations} loop${result.iterations !== 1 ? 's' : ''}`,
            `${toolCalls.length} tool${toolCalls.length !== 1 ? 's' : ''}`
        ].filter(Boolean).join(', ');
        addActivityItem('response', '\u{2728}', `Response <span class="status">${responseMeta}</span>`);

        S.debug.toolDebug = {
            systemPrompt: 'OODA-E mode',
            parsedCalls: toolCalls,
            executionResults: toolResults,
            iterations: result.iterations,
        };
        S.debug.oodaePhases = result.phases || [];
        clog('info', `OODA-E done: ${result.iterations} loop(s), ${toolCalls.length} tool(s), ${(result.phases || []).length} phases`);
        MemoryDB.saveSession(S.chatHistory, S.sessionTokens);
        MemoryDB.saveKeyState(keyManager.index, keyManager.useCount);
        updateSaveIndicator();
        updateTokenDisplay();
    } catch (err) {
        _stopThinkingTimer();
        removeThinking();
        clearPhaseIndicator();
        addMessage('error', esc(err.message));
        addActivityItem('fallback', '\u{26A0}\u{FE0F}', `Error: ${esc(err.message.slice(0, 80))}`);
        clog('error', err.message);
    }
}
