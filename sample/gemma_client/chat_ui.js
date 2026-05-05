// ============================================================
//  chat_ui.js — Theme, toggles, clear, export/import
//  References S, $msgs, $suggestions (from chat_app.js),
//  clog, esc, extractThinking, renderThinkingBlock, renderMarkdown (from chat_utils.js),
//  addMessage (from chat_message.js), clearActivity (from chat_activity.js),
//  updateTokenDisplay, updateSaveIndicator (from chat_context.js),
//  stripToolCalls (from GemmaClient), MemoryDB (from chat_memory.js)
//  at call time.
// ============================================================

// ===== Theme =====
function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    document.getElementById('themeBtn').textContent = next === 'dark' ? '\u{1F313}' : '\u{2600}\u{FE0F}';
    localStorage.setItem('gemma-theme', next);
}
(function restoreTheme() {
    const saved = localStorage.getItem('gemma-theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
        const btn = document.getElementById('themeBtn');
        if (btn) btn.textContent = saved === 'dark' ? '\u{1F313}' : '\u{2600}\u{FE0F}';
    }
})();

// ===== UI State persistence =====
function saveUIState() {
    localStorage.setItem('gemma_ui', JSON.stringify({
        toolMode: S.toolMode, showRaw: S.showRaw,
        model: document.getElementById('modelSel').value,
        panelOpen: document.body.classList.contains('panel-open')
    }));
}

function restoreUIState() {
    try {
        const saved = JSON.parse(localStorage.getItem('gemma_ui'));
        if (!saved) return;
        if (saved.toolMode) { S.toolMode = true; document.getElementById('toolToggle').checked = true; document.getElementById('modeInfo').textContent = 'Tool Calling'; }
        if (saved.showRaw) { S.showRaw = true; document.getElementById('rawToggle').checked = true; }
        if (saved.model) document.getElementById('modelSel').value = saved.model;
        if (saved.panelOpen) document.body.classList.add('panel-open');
        clog('info', `Restored UI: mode=${S.toolMode?'Tool Calling':'Simple'}, raw=${S.showRaw}, panel=${saved.panelOpen?'open':'closed'}`);
    } catch {}
}

function toggleToolMode() {
    S.toolMode = document.getElementById('toolToggle').checked;
    document.getElementById('modeInfo').textContent = S.toolMode ? 'Tool Calling' : 'Simple';
    saveUIState();
    clog('info', 'Mode: ' + (S.toolMode ? 'Tool Calling' : 'Simple'));
}

function toggleShowRaw() {
    S.showRaw = document.getElementById('rawToggle').checked;
    document.querySelectorAll('.raw-block').forEach(el => el.classList.toggle('show', S.showRaw));
    saveUIState();
}

function clearConversation() {
    S.chatHistory = [];
    S.sessionTokens = 0;
    S.debug = { lastRequest: null, lastResponse: null, lastTiming: null, lastTokens: null, toolDebug: null };
    $msgs.innerHTML = '';
    $msgs.appendChild($suggestions);
    $suggestions.style.display = 'grid';
    clearActivity();
    MemoryDB.clearSession();
    MemoryDB.clearWorkspace();
    updateTokenDisplay();
    clog('info', 'Conversation cleared (memories preserved, workspace cleared)');
    const si = document.getElementById('saveInfo');
    if (si) si.textContent = '';
}

// ===== Export / Import =====
async function exportConversation() {
    if (S.chatHistory.length === 0) { clog('warn', 'Nothing to export'); return; }
    const workspace = await MemoryDB.getRecentTopics(100).catch(() => []);
    const memories = await MemoryDB.getAllMemories().catch(() => []);
    const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessionTokens: S.sessionTokens,
        chatHistory: S.chatHistory,
        workspace,
        memories
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemma-chat-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    clog('info', `Exported: ${S.chatHistory.length} messages, ${workspace.length} topics, ${memories.length} memories`);
}

function importConversation() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.chatHistory || !Array.isArray(data.chatHistory)) {
                clog('error', 'Invalid file: missing chatHistory array');
                return;
            }
            // Restore chatHistory
            clearConversation();
            S.chatHistory = data.chatHistory;
            S.sessionTokens = data.sessionTokens || 0;

            // Re-render messages
            $suggestions.style.display = 'none';
            for (const msg of S.chatHistory) {
                if (msg._meta === 'system') continue;
                const msgText = msg.parts?.map(p => p.text || '').join('') || '';
                if (msg.role === 'user') {
                    if (msgText.startsWith('[User context]') || msgText.startsWith('[Context ') || msgText.includes('Available tools:')) continue;
                    addMessage('user', esc(msgText));
                } else if (msg.role === 'model') {
                    if (msgText.startsWith('Noted.') || msgText.startsWith('Understood.')) continue;
                    const { thinking: t, cleaned: c } = extractThinking(msgText);
                    if (t) addMessage('thinking', renderThinkingBlock(t));
                    const cleaned = stripToolCalls(c);
                    if (cleaned) addMessage('model', renderMarkdown(cleaned), msgText, {});
                }
            }

            // Restore workspace topics
            if (data.workspace && Array.isArray(data.workspace)) {
                await MemoryDB.clearWorkspace();
                for (const topic of data.workspace) {
                    await MemoryDB.addTopic(topic);
                }
            }

            // Restore memories
            if (data.memories && Array.isArray(data.memories)) {
                for (const mem of data.memories) {
                    await MemoryDB.saveMemory(mem.key, mem.value, mem.category);
                }
            }

            MemoryDB.saveSession(S.chatHistory, S.sessionTokens);
            updateSaveIndicator();
            updateTokenDisplay();
            clog('info', `Imported: ${S.chatHistory.length} messages, ${(data.workspace || []).length} topics, ${(data.memories || []).length} memories`);
        } catch (err) {
            clog('error', 'Import failed: ' + err.message);
        }
    };
    input.click();
}
