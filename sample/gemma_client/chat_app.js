// ============================================================
//  chat_app.js — Main orchestrator (state, DOM refs, events, init)
//  Depends on: GemmaClient (dist/gemma_client.js), MemoryDB (chat_memory.js),
//              registerTools (chat_tools.js), debug functions (chat_debug.js),
//              chat_utils.js, chat_activity.js, chat_message.js,
//              chat_context.js, chat_ui.js, chat_send.js, chat_queue.js
// ============================================================

const { GemmaAPI, KeyManager, ToolRegistry, ToolRunner, OODAERunner, PHASE, parseToolCalls, hasToolCalls, stripToolCalls, GoalManager, LearningSystem, loadAgentsMd, buildAgentsPromptBlock, hasAgentsConfig, KnowledgeRetriever, registerKnowledgeKeywords } = GemmaClient;

// ===== Coordination layer: shared instances for autonomous agent =====
let goalManager = null;
let learningSystem = null;
let agentsConfig = null;  // parsed AGENTS.md config
let _knowledgeRetriever = null;  // browser-side vector knowledge retriever

// ===== State =====
const S = {
    chatHistory: [],
    toolMode: false,
    showRaw: false,
    busy: false,
    sessionTokens: 0, // cumulative actual API tokens (from usageMetadata)
    debug: { lastRequest: null, lastResponse: null, lastTiming: null, lastTokens: null, toolDebug: null }
};

const keyManager = new KeyManager({ rotateEveryN: 1 });
const api = new GemmaAPI({ keyManager });
const registry = new ToolRegistry();

// ===== DOM refs =====
const $msgs = document.getElementById('messages');
const $input = document.getElementById('userInput');
const $sendBtn = document.getElementById('sendBtn');
const $suggestions = document.getElementById('suggestions');
const $console = document.getElementById('consoleBox');
const $chatWrapper = document.getElementById('chatWrapper');
const $activityBody = document.getElementById('activityBody');
const $queuePanel = document.getElementById('queuePanel');

// ===== Events =====
$input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});
$input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});
$suggestions.addEventListener('click', function(e) {
    const chip = e.target.closest('.chip');
    if (chip) { $input.value = chip.dataset.q; handleSend(); }
});
document.getElementById('modelSel').addEventListener('change', saveUIState);

// ===== Init =====
async function init() {
    restoreUIState();
    await MemoryDB.open();
    clog('info', 'IndexedDB initialized');

    // Restore session
    try {
        const session = await MemoryDB.loadSession();
        if (session && session.chatHistory && session.chatHistory.length > 0) {
            S.chatHistory = session.chatHistory;
            if (session.sessionTokens > 0) S.sessionTokens = session.sessionTokens;
            $suggestions.style.display = 'none';
            for (const msg of S.chatHistory) {
                // Skip system/context messages (tagged with _meta or detected by prefix)
                if (msg._meta === 'system') continue;
                const text = msg.parts?.map(p => p.text || '').join('') || '';
                if (msg.role === 'user') {
                    if (text.startsWith('[User context]') || text.startsWith('[Context ') || text.startsWith('[Conversation ')
                        || text.startsWith('Here are the results from the tool calls:') || text.includes('Available tools:')) continue;
                    addMessage('user', esc(text));
                } else if (msg.role === 'model') {
                    if (text.startsWith('Noted.') || text.startsWith('Understood.')) continue;
                    const { thinking: restoredThinking, cleaned: restoredCleaned } = extractThinking(text);
                    if (restoredThinking) addMessage('thinking', renderThinkingBlock(restoredThinking));
                    const cleaned = stripToolCalls(restoredCleaned);
                    if (!cleaned) continue;
                    addMessage('model', renderMarkdown(cleaned), text, {});
                }
            }
            clog('info', `Restored session: ${S.chatHistory.length} messages, ${S.sessionTokens} tokens`);
            const si = document.getElementById('saveInfo');
            if (si) si.textContent = `Restored ${new Date(session.timestamp).toLocaleTimeString()}`;
        }
    } catch (e) { clog('warn', 'Session restore failed: ' + e.message); }

    updateTokenDisplay();

    try {
        const memories = await MemoryDB.getAllMemories();
        if (memories.length > 0) clog('info', `${memories.length} saved memories available`);
    } catch {}

    registerTools(registry, clog);

    // ── AGENTS.md: load persona & policy config ──
    try {
        agentsConfig = await loadAgentsMd();
        if (hasAgentsConfig(agentsConfig)) {
            // Inject into simple-mode context (chat_context.js)
            setAgentsPromptBlock(buildAgentsPromptBlock(agentsConfig, { mode: 'simple' }));
            clog('info', `AGENTS.md loaded: role=${agentsConfig.role ? 'yes' : 'no'}, behavior=${agentsConfig.behavior.length}, forbidden=${agentsConfig.forbidden.length}`);
        }
    } catch (e) { clog('debug', 'AGENTS.md not found or parse failed (safe no-op): ' + e.message); }

    // ── Knowledge Retriever: load chunks + embeddings for RAG ──
    try {
        _knowledgeRetriever = new KnowledgeRetriever();
        const loaded = await _knowledgeRetriever.load();
        if (loaded) {
            const stats = _knowledgeRetriever.stats;
            // Register project/entity names from chunks for domain classification
            if (_knowledgeRetriever._chunks) {
                registerKnowledgeKeywords(_knowledgeRetriever._chunks);
            }
            clog('info', `Knowledge base loaded: ${stats.chunks} chunks, ${stats.embeddings} embeddings (dim=${stats.dimension})`);
        } else {
            clog('debug', 'Knowledge base not available (safe no-op)');
        }
    } catch (e) { clog('debug', 'KnowledgeRetriever init failed (safe no-op): ' + e.message); }

    const paths = ['./gemma_code.jsonl', '../gemma_code.jsonl', 'gemma_code.jsonl'];
    let loaded = false;
    for (const p of paths) {
        try {
            const count = await keyManager.loadFromJSONL(p);
            clog('info', `Loaded ${count} key(s) from ${p}`);

            // Restore key rotation state
            try {
                const ks = await MemoryDB.loadKeyState();
                if (ks && ks.index < count) {
                    keyManager.index = ks.index;
                    keyManager.useCount = ks.useCount;
                    clog('info', `Restored key state: Key #${ks.index + 1}, useCount=${ks.useCount}`);
                }
            } catch {}

            document.getElementById('statusDot').className = 'dot ok';
            document.getElementById('statusText').textContent = 'Ready';
            document.getElementById('keyInfo').textContent = `${count} keys | Key #${keyManager.index + 1}`;
            $sendBtn.disabled = false;
            loaded = true; break;
        } catch {}
    }
    if (!loaded) {
        document.getElementById('statusDot').className = 'dot err';
        document.getElementById('statusText').textContent = 'Key load failed';
        clog('error', 'gemma_code.jsonl not found.');
    }
    // Initialize coordination layer: GoalManager + LearningSystem
    try {
        if (GoalManager) {
            goalManager = new GoalManager(null, { memoryDB: MemoryDB }); // runner set later on first sendToolChat
            await goalManager.restore();
            const goals = goalManager.getActive?.() || [];
            if (goals.length > 0) clog('info', `Restored ${goals.length} active goal(s)`);
        }
    } catch (e) { clog('warn', 'GoalManager init failed: ' + e.message); }

    try {
        if (LearningSystem) {
            learningSystem = new LearningSystem({ memoryDB: MemoryDB });
            await learningSystem.restore();
            clog('info', 'LearningSystem initialized');
        }
    } catch (e) { clog('warn', 'LearningSystem init failed: ' + e.message); }

    // Initialize ProactiveEngine (tick loop + restore triggers)
    if (typeof initProactive === 'function') {
        try { await initProactive(goalManager, learningSystem); } catch (e) { clog('warn', 'ProactiveEngine init failed: ' + e.message); }
    }

    keyManager.onRotate((prev, next) => {
        document.getElementById('keyInfo').textContent = `${keyManager.count} keys | Key #${next + 1}`;
        MemoryDB.saveKeyState(next, keyManager.useCount);
        clog('debug', `Key rotated: #${prev+1} → #${next+1}`);
    });
}

init();
