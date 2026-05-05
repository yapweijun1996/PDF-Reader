// ============================================================
//  chat_message.js — Message rendering + thinking indicator
//  References S, $suggestions, $msgs, $chatWrapper (from chat_app.js),
//  esc, renderMarkdown (from chat_utils.js),
//  _piCurrentText (from chat_activity.js) at call time.
// ============================================================

function addMessage(type, html, rawText, timing) {
    $suggestions.style.display = 'none';
    const row = document.createElement('div');
    row.className = 'msg-row ' + type;
    let inner = '';
    if (type !== 'user') inner += '<div class="msg-avatar">G</div>';
    let bodyContent = html;
    if (type === 'model' && rawText) {
        bodyContent += `<div class="raw-block${S.showRaw ? ' show' : ''}">${esc(rawText)}</div>`;
    }
    if (timing) {
        let meta = timing.ms ? `${(timing.ms/1000).toFixed(2)}s` : '';
        if (timing.tokens) meta += ` | ${timing.tokens} tokens`;
        if (meta) bodyContent += `<div class="meta">${meta}</div>`;
    }
    inner += `<div class="msg-body">${bodyContent}</div>`;
    row.innerHTML = inner;
    $msgs.appendChild(row);
    $chatWrapper.scrollTop = $chatWrapper.scrollHeight;
    return row;
}

// Thinking timer
let _thinkingStart = 0;
let _thinkingTimer = null;

function _updateThinkingTimer() {
    const el = document.getElementById('thinkingTimer');
    if (!el || !_thinkingStart) return;
    const sec = Math.round((Date.now() - _thinkingStart) / 1000);
    el.textContent = `${sec}s`;
}

function showThinking() {
    removeThinking();
    if (!_thinkingStart) _thinkingStart = Date.now();
    const row = document.createElement('div');
    row.id = 'thinkingEl';
    row.className = 'thinking-indicator-row';
    const sec = Math.round((Date.now() - _thinkingStart) / 1000);

    // ChatGPT-style: pill with spinner, shimmer text, animated dots, timer
    const text = _piCurrentText || 'Thinking';
    row.innerHTML = `<div class="msg-avatar">G</div><div class="thinking-indicator" onclick="openActivityPanel()"><span class="ti-spinner"></span><span class="ti-text">${esc(text)}</span><span class="ti-dots"><span></span><span></span><span></span></span><span class="ti-timer" id="thinkingTimer">${sec}s</span></div>`;

    $msgs.appendChild(row);
    $chatWrapper.scrollTop = $chatWrapper.scrollHeight;
    clearInterval(_thinkingTimer);
    _thinkingTimer = setInterval(_updateThinkingTimer, 1000);
}

function _stopThinkingTimer() {
    clearInterval(_thinkingTimer);
    _thinkingTimer = null;
    const elapsed = _thinkingStart ? (Date.now() - _thinkingStart) / 1000 : 0;
    _thinkingStart = 0;
    return elapsed;
}

let _lastThinkDuration = 0;
function removeThinking() {
    const el = document.getElementById('thinkingEl');
    if (el) el.remove();
    // Only stop timer on final removal (not refresh)
}
