// ============================================================
//  chat_debug.js — Debug Modal logic
//  Depends on: S, MemoryDB, registry, keyManager, esc, clog (from chat_app.js)
// ============================================================

let _currentDebugTab = 'all';

function openDebugModal() {
    document.getElementById('debugModal').classList.add('show');
    renderDebugTab(_currentDebugTab);
}

function closeDebugModal() {
    document.getElementById('debugModal').classList.remove('show');
}

function copyToClipboard(btn) {
    let el = btn.nextElementSibling;
    while (el && el.tagName !== 'PRE') el = el.nextElementSibling;
    const text = el ? el.textContent : '';
    _doCopy(text, btn);
}

function copyAllDebug() {
    const allData = {
        lastRequest: S.debug.lastRequest,
        lastResponse: S.debug.lastResponse,
        lastTiming: S.debug.lastTiming,
        lastTokens: S.debug.lastTokens,
        chatHistory: S.chatHistory,
        toolDebug: S.debug.toolDebug,
        oodaePhases: S.debug.oodaePhases,
        keyState: {
            totalKeys: keyManager.count,
            currentIndex: keyManager.index,
            useCount: keyManager.useCount,
            rotateEveryN: keyManager.rotateEveryN
        }
    };
    const text = JSON.stringify(allData, null, 2);
    const btn = document.getElementById('copyAllBtn');
    _doCopy(text, btn);
}

function _doCopy(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = btn.dataset.label || 'Copy', 1200); }
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = btn.dataset.label || 'Copy', 1200); }
    });
}

function renderDebugTab(tab) {
    _currentDebugTab = tab;
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const $body = document.getElementById('debugBody');
    let html = '';

    // Copy All button at the top of every tab
    html += `<button class="copy-btn" id="copyAllBtn" data-label="Copy All" onclick="copyAllDebug()" style="margin-bottom:12px;">Copy All</button>`;

    if (tab === 'all') {
        const allData = {
            lastRequest: S.debug.lastRequest,
            lastResponse: S.debug.lastResponse,
            lastTiming: S.debug.lastTiming,
            lastTokens: S.debug.lastTokens,
            chatHistory: S.chatHistory,
            toolDebug: S.debug.toolDebug,
            oodaePhases: S.debug.oodaePhases,
            keyState: { totalKeys: keyManager.count, currentIndex: keyManager.index, useCount: keyManager.useCount, rotateEveryN: keyManager.rotateEveryN }
        };
        const data = JSON.stringify(allData, null, 2);
        html += `<div class="section-label">Complete Debug Dump</div>`;
        html += `<button class="copy-btn" data-label="Copy All" onclick="copyToClipboard(this)">Copy All</button><pre>${esc(data)}</pre>`;
    }
    else if (tab === 'request') {
        const data = S.debug.lastRequest ? JSON.stringify(S.debug.lastRequest, null, 2) : 'No request yet.';
        html += `<div class="section-label">Last Request Payload</div>`;
        html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(data)}</pre>`;
        if (S.debug.lastTiming) html += `<div class="debug-stat">Timing: ${S.debug.lastTiming.ms}ms</div>`;
    }
    else if (tab === 'response') {
        const data = S.debug.lastResponse ? JSON.stringify(S.debug.lastResponse, null, 2) : 'No response yet.';
        html += `<div class="section-label">Last API Response</div>`;
        html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(data)}</pre>`;
        if (S.debug.lastTokens) {
            const t = S.debug.lastTokens;
            html += `<div class="debug-stat">Prompt: ${t.promptTokenCount || '?'}</div>`;
            html += `<div class="debug-stat">Response: ${t.candidatesTokenCount || '?'}</div>`;
            html += `<div class="debug-stat">Total: ${t.totalTokenCount || '?'}</div>`;
        }
    }
    else if (tab === 'history') {
        const data = JSON.stringify(S.chatHistory, null, 2);
        html += `<div class="section-label">Chat History (${S.chatHistory.length} messages)</div>`;
        html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(data)}</pre>`;
    }
    else if (tab === 'oodae') {
        const phases = S.debug.oodaePhases || [];
        if (phases.length === 0) {
            html += '<div style="color:var(--text3);padding:20px;">No OODA-E data yet. Enable Tool Calling and send a message.</div>';
        } else {
            html += `<div class="section-label">OODA-E Phase Log (${phases.length} phases)</div>`;
            for (const p of phases) {
                const phaseIcons = { observe:'🔍', orient:'🧭', decide:'🎯', act:'⚡', evaluate:'✅' };
                const icon = phaseIcons[p.phase] || '•';
                const loop = p.loop ? ` (loop ${p.loop})` : '';
                const dataStr = JSON.stringify(p.data, null, 2);
                html += `<details class="debug-phase-detail" style="margin-bottom:8px;">`;
                html += `<summary style="cursor:pointer;padding:6px 0;font-size:13px;font-weight:500;">${icon} ${esc(p.phase.toUpperCase())}${loop}</summary>`;
                html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(dataStr)}</pre>`;
                html += `</details>`;
            }
        }
    }
    else if (tab === 'tools') {
        const td = S.debug.toolDebug || {};
        if (!S.toolMode && !td.parsedCalls) {
            html += '<div style="color:var(--text3);padding:20px;">Enable Tool Calling and send a message.</div>';
        } else {
            html += `<div class="section-label">Mode: ${td.systemPrompt || 'N/A'}</div>`;
            html += `<div class="section-label" style="margin-top:12px;">Tool Calls (${(td.parsedCalls||[]).length})</div>`;
            html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(JSON.stringify(td.parsedCalls || [], null, 2))}</pre>`;
            html += `<div class="section-label" style="margin-top:12px;">Results</div>`;
            html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(JSON.stringify(td.executionResults || [], null, 2))}</pre>`;
            if (td.iterations) html += `<div class="debug-stat">Iterations: ${td.iterations}</div>`;
            html += `<div class="section-label" style="margin-top:12px;">Registered Tools (${registry.size})</div>`;
            html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(JSON.stringify(registry.list(), null, 2))}</pre>`;
        }
    }
    else if (tab === 'memory') {
        MemoryDB.getAllMemories().then(memories => {
            let mhtml = html; // keep Copy All button
            mhtml += `<div class="section-label">Saved Memories (${memories.length})</div>`;
            if (memories.length === 0) {
                mhtml += '<div style="color:var(--text3);padding:12px;">No memories saved yet.</div>';
            } else {
                const data = JSON.stringify(memories.map(m => ({ key: m.key, value: m.value, category: m.category, saved: new Date(m.timestamp).toLocaleString() })), null, 2);
                mhtml += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(data)}</pre>`;
                mhtml += `<button class="copy-btn" style="margin-top:12px;float:none;background:var(--red);border-color:var(--red);color:#fff;" onclick="if(confirm('Delete all memories?')){MemoryDB.clearAllMemories().then(()=>renderDebugTab('memory'))}">Clear All</button>`;
            }
            $body.innerHTML = mhtml;
        });
        return;
    }
    else if (tab === 'keys') {
        html += `<div class="section-label">Key Manager State</div>`;
        html += `<button class="copy-btn" data-label="Copy" onclick="copyToClipboard(this)">Copy</button><pre>${esc(JSON.stringify({
            totalKeys: keyManager.count,
            currentIndex: keyManager.index,
            useCount: keyManager.useCount,
            rotateEveryN: keyManager.rotateEveryN,
            seed: keyManager.seed,
            keysPreview: keyManager.keys.map((k,i) => `#${i+1}: ${k.slice(0,8)}...${k.slice(-4)}`)
        }, null, 2))}</pre>`;
    }

    $body.innerHTML = html;
}

// Wire up tab clicks
document.getElementById('debugTabs').addEventListener('click', function(e) {
    const tab = e.target.closest('.modal-tab');
    if (tab) renderDebugTab(tab.dataset.tab);
});
