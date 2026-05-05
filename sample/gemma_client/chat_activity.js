// ============================================================
//  chat_activity.js — Activity panel + phase indicator
//  References $activityBody (from chat_app.js), esc (from chat_utils.js),
//  saveUIState (from chat_ui.js) at call time.
// ============================================================

let currentActivityGroup = null;
const toolActivityQueue = []; // queue to match onToolCall → onToolResult

function toggleActivity() {
    document.body.classList.toggle('panel-open');
    saveUIState();
}

function openActivityPanel() {
    if (!document.body.classList.contains('panel-open')) {
        document.body.classList.add('panel-open');
        saveUIState();
    }
}

function clearActivity() {
    if ($activityBody) {
        $activityBody.innerHTML = '<div class="activity-empty">Agent activity will appear here.</div>';
    }
    currentActivityGroup = null;
    toolActivityQueue.length = 0;
}

function startActivityGroup(text) {
    if (!$activityBody) return;
    const empty = $activityBody.querySelector('.activity-empty');
    if (empty) empty.remove();
    currentActivityGroup = document.createElement('div');
    currentActivityGroup.className = 'activity-group';
    const truncated = text.length > 50 ? text.slice(0, 50) + '...' : text;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentActivityGroup.innerHTML = `<div class="activity-group-label"><span class="group-text">${esc(truncated)}</span><span class="activity-group-time">${time}</span></div>`;
    $activityBody.appendChild(currentActivityGroup);
    $activityBody.scrollTop = $activityBody.scrollHeight;
}

function renderDebugBlock(debugData) {
    if (!debugData) return '';
    const json = typeof debugData === 'string' ? debugData : JSON.stringify(debugData, null, 2);
    return `<details class="activity-debug" open><summary>Debug</summary><pre>${esc(json)}</pre></details>`;
}

function addActivityItem(phase, icon, label, detail, debugData) {
    if (!currentActivityGroup) return null;
    const item = document.createElement('div');
    item.className = 'activity-item expanded';
    item.setAttribute('data-phase', phase);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.innerHTML = `<div class="activity-icon">${icon}</div><div class="activity-info"><div class="activity-label">${label}<span class="expand-arrow">&#9656;</span></div><div class="activity-detail"><div class="activity-summary">${detail || ''}</div>${renderDebugBlock(debugData)}</div><div class="activity-meta">${time}</div></div>`;
    item.addEventListener('click', (e) => {
        // Don't toggle if clicking debug details
        if (e.target.closest('.activity-debug')) return;
        item.classList.toggle('expanded');
    });
    currentActivityGroup.appendChild(item);
    $activityBody.scrollTop = $activityBody.scrollHeight;
    return item;
}

function updateActivityItem(item, label, detail, debugData) {
    if (!item) return;
    if (label !== undefined) {
        const labelEl = item.querySelector('.activity-label');
        if (labelEl) labelEl.innerHTML = label + '<span class="expand-arrow">&#9656;</span>';
    }
    if (detail !== undefined || debugData !== undefined) {
        const detailEl = item.querySelector('.activity-detail');
        if (detailEl) {
            const summaryHtml = detail !== undefined ? detail : (detailEl.querySelector('.activity-summary')?.innerHTML || '');
            detailEl.innerHTML = `<div class="activity-summary">${summaryHtml}</div>${renderDebugBlock(debugData)}`;
        }
    }
    const metaEl = item.querySelector('.activity-meta');
    if (metaEl) metaEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ===== Phase Indicator (ChatGPT-style — single line, current action only) =====
let _piCurrentText = '';  // what's shown right now
let _piMode = false;      // true = tool/OODA-E mode active

function setPhaseIndicatorLine(key, icon, text, running) {
    // Only track the current action — no history accumulation
    if (running) _piCurrentText = text;
}

function clearPhaseIndicator() { _piCurrentText = ''; _piMode = false; }
