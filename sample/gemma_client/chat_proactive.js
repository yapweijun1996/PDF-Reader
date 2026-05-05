// ============================================================
//  chat_proactive.js — ProactiveEngine browser integration
//  Coordination layer: wires ProactiveEngine ↔ OODAERunner ↔
//  GoalManager ↔ LearningSystem ↔ UI
//  References: GemmaClient (ProactiveEngine), MemoryDB, S, api, registry,
//              clog, esc, addMessage (from other modules)
// ============================================================

const { ProactiveEngine, TRIGGER_TYPE, TRIGGER_STATUS, APPROVAL_STATUS, HarnessConfig } = GemmaClient;

// ===== Proactive Engine instance =====
let proactiveEngine = null;
let proactiveTickTimer = null;

// ===== Initialize ProactiveEngine with full coordination =====
async function initProactive(goalMgr, learningSys) {
    if (!ProactiveEngine) { clog('warn', 'ProactiveEngine not available in dist'); return; }

    proactiveEngine = new ProactiveEngine(null, {
        goalManager: goalMgr || null,
        memoryDB: MemoryDB,
        // Coordination: UI callbacks
        onNotify: (entry) => {
            addProactiveNotification(entry);
        },
        onApprovalNeeded: (approval) => {
            renderPendingApprovals();
            addProactiveNotification({
                label: 'Approval needed',
                result: `Action "${approval.label}" requires your approval.`,
                firedAt: Date.now(),
                status: 'awaiting_approval'
            });
        }
    });

    // Restore persisted triggers
    try {
        await proactiveEngine.restore();
        const count = proactiveEngine.triggers.size;
        if (count > 0) clog('info', `Restored ${count} proactive trigger(s)`);
    } catch (e) { clog('warn', 'Proactive restore failed: ' + e.message); }

    // Start tick loop (with proper async + error handling)
    const interval = HarnessConfig?.proactive?.tickInterval || 60000;
    proactiveTickTimer = setInterval(() => {
        proactiveTick().catch(e => clog('warn', 'Proactive tick error: ' + e.message));
    }, interval);
    clog('info', `ProactiveEngine started (tick every ${interval / 1000}s)`);

    // Render initial state
    renderTriggerPanel();
    renderPendingApprovals();
}

// ===== Tick: evaluate all triggers (properly async) =====
async function proactiveTick() {
    if (!proactiveEngine) return;

    // Coordination: ensure runner is available before executing
    // Runner is created on first sendToolChat — use getRunner() from chat_send.js
    if (!proactiveEngine.runner && typeof getRunner === 'function') {
        const r = getRunner();
        if (r) proactiveEngine.runner = r;
    }

    // Auto-fetch condition values before evaluation
    await _updateConditionValues();

    const now = Date.now();
    const results = await proactiveEngine.tick(now);
    if (!results || results.length === 0) return;

    for (const result of results) {
        // Note: success/failed notifications are already sent via onNotify callback
        // in _executeTrigger(), so only handle approval rendering here
        if (result.status === 'awaiting_approval') {
            renderPendingApprovals();
        }
    }

    // Persist updated trigger state
    try { await proactiveEngine.persist(); } catch {}
    renderTriggerPanel();
}

// ===== Condition auto-fetch: use tools to check condition values =====
async function _updateConditionValues() {
    if (!proactiveEngine) return;
    const runner = proactiveEngine.runner;
    if (!runner) return; // can't fetch without runner

    for (const trigger of proactiveEngine.triggers.values()) {
        if (trigger.type !== 'condition' || trigger.status !== 'active') continue;
        // Skip if checked within last 5 minutes
        if (trigger.lastChecked && (Date.now() - trigger.lastChecked) < 300000) continue;

        const watch = trigger.watch;
        if (!watch) continue;

        try {
            // Map watch keys to tool calls
            let value = null;
            if (watch.startsWith('crypto_') || watch.includes('btc') || watch.includes('eth')) {
                const symbol = watch.replace('crypto_', '').replace('_price', '').toUpperCase() || 'BTC';
                const result = await registry.execute('crypto_price', { symbol });
                if (!result.error && result.result?.price) value = result.result.price;
            } else if (watch.includes('weather') || watch.includes('temp')) {
                const result = await registry.execute('get_weather', { location: 'current' });
                if (!result.error && result.result?.temp) value = result.result.temp;
            }
            // Generic: try running as OODA-E query
            if (value === null && runner) {
                try {
                    const r = await runner.run(`current value of ${watch}`, { chatHistory: [] });
                    const num = parseFloat(r.response);
                    if (!isNaN(num)) value = num;
                } catch {}
            }

            if (value !== null) {
                proactiveEngine.updateConditionValue(trigger.id, value);
            }
        } catch (e) {
            clog('debug', `Condition check failed for ${watch}: ${e.message}`);
        }
    }
}

// ===== Notification: show proactive result in chat =====
function addProactiveNotification(entry) {
    const type = entry.label || 'proactive';
    const msg = entry.result || entry.message || `Trigger fired`;
    const statusClass = entry.status === 'failed' ? 'proactive-error' : '';
    const el = document.createElement('div');
    el.className = 'msg msg-proactive ' + statusClass;
    el.innerHTML = `<div class="proactive-badge">${_triggerIcon(entry.triggerType || 'schedule')} Proactive</div>
        <div class="proactive-body">${esc(String(msg))}</div>
        <div class="proactive-time">${new Date(entry.firedAt || Date.now()).toLocaleTimeString()}</div>`;
    document.getElementById('messages').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth' });
    clog('info', `Proactive: ${msg}`);
}

// ===== Trigger Management Panel =====
function renderTriggerPanel() {
    const panel = document.getElementById('triggerList');
    if (!panel || !proactiveEngine) return;

    const triggers = [...proactiveEngine.triggers.values()];
    if (triggers.length === 0) {
        panel.innerHTML = '<div class="trigger-empty">No active triggers. Use the form above to add one.</div>';
        return;
    }

    panel.innerHTML = triggers.map(t => {
        const status = t.status === 'active' ? '<span class="t-active">active</span>' : `<span class="t-inactive">${esc(t.status)}</span>`;
        const typeLabel = _triggerIcon(t.type) + ' ' + (t.type || '?');
        let detail = '';
        if (t.type === 'schedule') detail = `Cron: ${esc(t.cronExpr || '?')}`;
        else if (t.type === 'condition') detail = `${esc(t.watch || '?')} ${esc(t.operator || '?')} ${t.threshold}${t.lastValue !== null ? ` (current: ${t.lastValue})` : ''}`;
        else if (t.type === 'reminder') detail = `At: ${new Date(t.fireAt).toLocaleString()}`;
        else if (t.type === 'follow_up') detail = `Goal: ${esc(t.goalId || '?')}`;

        return `<div class="trigger-item" data-id="${esc(t.id)}">
            <div class="trigger-info">
                <span class="trigger-type">${typeLabel}</span> ${status}
                <span class="trigger-detail">${detail}</span>
            </div>
            <button class="trigger-del" onclick="removeTrigger('${esc(t.id)}')" title="Remove">&times;</button>
        </div>`;
    }).join('');
}

// ===== Pending Approvals =====
function renderPendingApprovals() {
    const panel = document.getElementById('approvalList');
    if (!panel || !proactiveEngine) return;

    const pending = proactiveEngine.pendingApprovals || [];
    const waiting = pending.filter(a => a.status === 'pending');
    if (waiting.length === 0) {
        panel.innerHTML = '';
        return;
    }

    panel.innerHTML = '<div class="approval-header">Pending Approvals</div>' +
        waiting.map(a => {
            const msg = a.label || a.action?.message || a.action?.skill || a.action?.type || '?';
            return `<div class="approval-item" data-id="${esc(a.id)}">
                <span class="approval-desc">${esc(msg)}</span>
                <button class="approval-btn approve" onclick="approveAction('${esc(a.id)}')">Approve</button>
                <button class="approval-btn reject" onclick="rejectAction('${esc(a.id)}')">Reject</button>
            </div>`;
        }).join('');
}

// ===== Add Trigger (from UI form) =====
function addTriggerFromForm() {
    if (!proactiveEngine) { clog('warn', 'ProactiveEngine not initialized'); return; }
    const typeEl = document.getElementById('triggerType');
    const paramEl = document.getElementById('triggerParam');
    const actionEl = document.getElementById('triggerAction');
    if (!typeEl || !paramEl || !actionEl) return;

    const type = typeEl.value;
    const param = paramEl.value.trim();
    const actionText = actionEl.value.trim();
    if (!param || !actionText) { clog('warn', 'Fill in all trigger fields'); return; }

    try {
        // Parse action: support "run:query", "notify:message", or plain type
        const action = _parseAction(actionText);

        if (type === 'schedule') {
            proactiveEngine.addSchedule(param, action);
        } else if (type === 'condition') {
            const parts = param.split(/\s+/);
            if (parts.length < 3) { clog('warn', 'Condition format: watch operator threshold'); return; }
            proactiveEngine.addCondition(parts[0], parts[1], parseFloat(parts[2]), action);
        } else if (type === 'reminder') {
            proactiveEngine.addReminder(param, actionText, { action });
        }

        proactiveEngine.persist().catch(() => {});
        renderTriggerPanel();
        paramEl.value = '';
        actionEl.value = '';
        clog('info', `Added ${type} trigger`);
    } catch (e) {
        clog('error', 'Add trigger failed: ' + e.message);
    }
}

// ===== Parse action string into action object =====
function _parseAction(text) {
    if (text.startsWith('run:')) return { type: 'run', query: text.slice(4).trim() };
    if (text.startsWith('notify:')) return { type: 'notify', message: text.slice(7).trim() };
    if (text.startsWith('goal:')) return { type: 'goal', description: text.slice(5).trim() };
    // Default: treat as run query for actionable text, notify for simple text
    if (/search|find|check|get|fetch|look/i.test(text)) return { type: 'run', query: text };
    return { type: 'notify', message: text };
}

// ===== Remove trigger =====
async function removeTrigger(id) {
    if (!proactiveEngine) return;
    proactiveEngine.remove(id);
    try { await proactiveEngine.persist(); } catch {}
    renderTriggerPanel();
    clog('info', `Removed trigger ${id}`);
}

// ===== Approve: execute the approved action =====
async function approveAction(id) {
    if (!proactiveEngine) return;
    const approval = proactiveEngine.approve(id);
    if (!approval) { clog('warn', `Approval ${id} not found`); return; }

    // Coordination: actually execute the approved action
    const trigger = proactiveEngine.get(approval.triggerId);
    if (trigger && proactiveEngine.runner) {
        try {
            clog('info', `Executing approved action: ${trigger.label}`);
            const result = await proactiveEngine._executeTrigger(trigger, Date.now());
            if (result) addProactiveNotification(result);
        } catch (e) {
            clog('error', `Approved action failed: ${e.message}`);
            addProactiveNotification({
                label: trigger.label,
                result: `Error: ${e.message}`,
                firedAt: Date.now(),
                status: 'failed'
            });
        }
    } else if (!proactiveEngine.runner) {
        clog('warn', 'Cannot execute: send a message first to initialize the runner');
        addProactiveNotification({
            label: 'Action queued',
            result: 'Send a message first to initialize the agent, then re-approve.',
            firedAt: Date.now(),
            status: 'failed'
        });
    }

    try { await proactiveEngine.persist(); } catch {}
    renderPendingApprovals();
}

async function rejectAction(id) {
    if (!proactiveEngine) return;
    proactiveEngine.reject(id);
    try { await proactiveEngine.persist(); } catch {}
    renderPendingApprovals();
    clog('info', `Rejected action ${id}`);
}

// ===== Toggle trigger panel visibility =====
function toggleTriggerPanel() {
    const panel = document.getElementById('triggerPanel');
    if (!panel) return;
    panel.classList.toggle('open');
}

// ===== Helpers =====
function _triggerIcon(type) {
    const icons = { schedule: '\u23F0', condition: '\u{1F4CA}', reminder: '\u{1F514}', follow_up: '\u{1F517}' };
    return icons[type] || '\u26A1';
}
