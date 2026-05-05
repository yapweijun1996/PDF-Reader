// ============================================================
//  proactive.js — ProactiveEngine: autonomous trigger system
//  Runs background checks (schedules, conditions, reminders)
//  and fires actions via OODAERunner when triggers match.
//  Persists triggers to IndexedDB for cross-session survival.
// ============================================================

import { HarnessConfig } from './config.js';

const TRIGGER_TYPE = {
    SCHEDULE: 'schedule',
    CONDITION: 'condition',
    REMINDER: 'reminder',
    FOLLOW_UP: 'follow_up'
};

const TRIGGER_STATUS = {
    ACTIVE: 'active',
    PAUSED: 'paused',
    FIRED: 'fired',
    EXPIRED: 'expired',
    FAILED: 'failed'
};

const APPROVAL_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
};

export { TRIGGER_TYPE, TRIGGER_STATUS, APPROVAL_STATUS };

export class ProactiveEngine {
    constructor(runner, opts = {}) {
        this.runner = runner;                      // OODAERunner instance
        this.goalManager = opts.goalManager || null;
        this.memoryDB = opts.memoryDB || null;
        this.triggers = new Map();                 // id → trigger
        this.pendingApprovals = [];                // actions awaiting user approval
        this.results = [];                         // recent proactive results
        this.onNotify = opts.onNotify || (() => {});
        this.onApprovalNeeded = opts.onApprovalNeeded || (() => {});
        this.maxResults = opts.maxResults ?? 50;

        // Safe action types that auto-execute without approval
        const cfg = HarnessConfig.proactive || {};
        this.safeActions = new Set(
            opts.safeActions || cfg.safeActions || ['search', 'weather', 'time', 'news', 'briefing']
        );
        this.tickInterval = opts.tickInterval ?? cfg.tickInterval ?? 60000;
        this._timer = null;
    }

    // ===== Add a schedule trigger (cron-like) =====
    addSchedule(cronExpr, action, opts = {}) {
        const parsed = this._parseCron(cronExpr);
        if (!parsed) return null;

        const id = this._makeId('sched');
        const trigger = {
            id,
            type: TRIGGER_TYPE.SCHEDULE,
            cron: parsed,
            cronExpr,
            action,
            label: opts.label || `Schedule: ${cronExpr}`,
            status: TRIGGER_STATUS.ACTIVE,
            repeat: opts.repeat !== false,        // schedules repeat by default
            lastFired: null,
            fireCount: 0,
            maxFires: opts.maxFires ?? Infinity,
            createdAt: Date.now()
        };
        this.triggers.set(id, trigger);
        return trigger;
    }

    // ===== Add a condition trigger (watch + threshold) =====
    addCondition(watch, operator, threshold, action, opts = {}) {
        if (!['>', '<', '>=', '<=', '==', '!='].includes(operator)) return null;

        const id = this._makeId('cond');
        const trigger = {
            id,
            type: TRIGGER_TYPE.CONDITION,
            watch,                                // e.g. "btc_price", "weather_temp"
            operator,
            threshold,
            action,
            label: opts.label || `Condition: ${watch} ${operator} ${threshold}`,
            status: TRIGGER_STATUS.ACTIVE,
            repeat: opts.repeat ?? false,          // conditions fire once by default
            cooldown: opts.cooldown ?? (HarnessConfig.proactive?.conditionCooldown) ?? 3600000,
            lastFired: null,
            lastChecked: null,
            lastValue: null,
            fireCount: 0,
            maxFires: opts.maxFires ?? 1,
            createdAt: Date.now()
        };
        this.triggers.set(id, trigger);
        return trigger;
    }

    // ===== Add a reminder (one-shot at datetime) =====
    addReminder(datetime, message, opts = {}) {
        const ts = typeof datetime === 'number' ? datetime : new Date(datetime).getTime();
        if (isNaN(ts) || ts <= Date.now()) return null;

        const id = this._makeId('rem');
        const trigger = {
            id,
            type: TRIGGER_TYPE.REMINDER,
            fireAt: ts,
            message,
            action: opts.action || { type: 'notify', message },
            label: opts.label || `Reminder: ${message.slice(0, 50)}`,
            status: TRIGGER_STATUS.ACTIVE,
            repeat: false,
            lastFired: null,
            fireCount: 0,
            maxFires: 1,
            createdAt: Date.now()
        };
        this.triggers.set(id, trigger);
        return trigger;
    }

    // ===== Add a follow-up trigger (fires after goal step completes) =====
    addFollowUp(goalId, stepIndex, action, opts = {}) {
        const id = this._makeId('fup');
        const trigger = {
            id,
            type: TRIGGER_TYPE.FOLLOW_UP,
            goalId,
            stepIndex,
            action,
            label: opts.label || `Follow-up: goal ${goalId} step ${stepIndex}`,
            status: TRIGGER_STATUS.ACTIVE,
            repeat: false,
            lastFired: null,
            fireCount: 0,
            maxFires: 1,
            createdAt: Date.now()
        };
        this.triggers.set(id, trigger);
        return trigger;
    }

    // ===== Remove a trigger =====
    remove(triggerId) {
        return this.triggers.delete(triggerId);
    }

    // ===== Pause / resume a trigger =====
    pause(triggerId) {
        const t = this.triggers.get(triggerId);
        if (t && t.status === TRIGGER_STATUS.ACTIVE) {
            t.status = TRIGGER_STATUS.PAUSED;
            return true;
        }
        return false;
    }

    resume(triggerId) {
        const t = this.triggers.get(triggerId);
        if (t && t.status === TRIGGER_STATUS.PAUSED) {
            t.status = TRIGGER_STATUS.ACTIVE;
            return true;
        }
        return false;
    }

    // ===== Get all triggers (optionally filtered) =====
    list(filter) {
        const all = [...this.triggers.values()];
        if (!filter) return all;
        if (filter.type) return all.filter(t => t.type === filter.type);
        if (filter.status) return all.filter(t => t.status === filter.status);
        return all;
    }

    // ===== Get a trigger by ID =====
    get(triggerId) {
        return this.triggers.get(triggerId) || null;
    }

    // ===== Tick: check all active triggers =====
    async tick(now) {
        now = now || Date.now();
        const fired = [];

        for (const trigger of this.triggers.values()) {
            if (trigger.status !== TRIGGER_STATUS.ACTIVE) continue;

            const shouldFire = this.evaluate(trigger, now);
            if (shouldFire) {
                fired.push(trigger);
            }
        }

        // Execute fired triggers
        const results = [];
        for (const trigger of fired) {
            const result = await this._executeTrigger(trigger, now);
            if (result) results.push(result);
        }

        return results;
    }

    // ===== Evaluate whether a trigger should fire =====
    evaluate(trigger, now) {
        now = now || Date.now();

        switch (trigger.type) {
            case TRIGGER_TYPE.SCHEDULE:
                return this._evalSchedule(trigger, now);

            case TRIGGER_TYPE.CONDITION:
                return this._evalCondition(trigger, now);

            case TRIGGER_TYPE.REMINDER:
                return this._evalReminder(trigger, now);

            case TRIGGER_TYPE.FOLLOW_UP:
                return this._evalFollowUp(trigger);

            default:
                return false;
        }
    }

    // ===== Permission model =====
    isSafeAction(action) {
        if (!action) return false;
        const type = action.type || action.skill || '';
        return this.safeActions.has(type);
    }

    setAutoApprove(types) {
        this.safeActions = new Set(types);
    }

    addAutoApprove(type) {
        this.safeActions.add(type);
    }

    // ===== Approve / reject a pending action =====
    approve(approvalId) {
        const idx = this.pendingApprovals.findIndex(a => a.id === approvalId);
        if (idx === -1) return null;
        const approval = this.pendingApprovals.splice(idx, 1)[0];
        approval.status = APPROVAL_STATUS.APPROVED;
        return approval;
    }

    reject(approvalId) {
        const idx = this.pendingApprovals.findIndex(a => a.id === approvalId);
        if (idx === -1) return null;
        const approval = this.pendingApprovals.splice(idx, 1)[0];
        approval.status = APPROVAL_STATUS.REJECTED;
        return approval;
    }

    // ===== Start / stop background tick =====
    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this.tick(), this.tickInterval);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    // ===== Persist triggers to IndexedDB =====
    async persist() {
        if (!this.memoryDB?.saveTriggers) return;
        try {
            const data = [...this.triggers.values()].map(t => ({
                ...t,
                // Don't persist Infinity — convert for JSON
                maxFires: t.maxFires === Infinity ? -1 : t.maxFires
            }));
            await this.memoryDB.saveTriggers(data);
        } catch (e) { console.warn('ProactiveEngine persist failed:', e.message); }
    }

    // ===== Restore triggers from IndexedDB =====
    async restore() {
        if (!this.memoryDB?.getTriggers) return;
        try {
            const stored = await this.memoryDB.getTriggers();
            for (const t of stored) {
                // Restore Infinity from sentinel
                if (t.maxFires === -1) t.maxFires = Infinity;
                this.triggers.set(t.id, t);
            }
        } catch (e) { console.warn('ProactiveEngine restore failed:', e.message); }
    }

    // ═══════════════════════════════════════════
    //  Internal methods
    // ═══════════════════════════════════════════

    // ── Execute a fired trigger ──
    async _executeTrigger(trigger, now) {
        const action = trigger.action;

        // Check permission
        if (!this.isSafeAction(action)) {
            const approval = {
                id: this._makeId('appr'),
                triggerId: trigger.id,
                action,
                label: trigger.label,
                status: APPROVAL_STATUS.PENDING,
                createdAt: now
            };
            this.pendingApprovals.push(approval);
            this.onApprovalNeeded(approval);
            return { triggerId: trigger.id, status: 'awaiting_approval', approvalId: approval.id };
        }

        // Mark as fired
        trigger.lastFired = now;
        trigger.fireCount++;

        // Check max fires
        if (trigger.fireCount >= trigger.maxFires) {
            trigger.status = trigger.type === TRIGGER_TYPE.SCHEDULE && trigger.repeat
                ? TRIGGER_STATUS.ACTIVE
                : TRIGGER_STATUS.FIRED;
        }
        if (!trigger.repeat && trigger.fireCount >= trigger.maxFires) {
            trigger.status = TRIGGER_STATUS.FIRED;
        }

        // Execute action
        let result;
        try {
            if (action.type === 'notify') {
                result = { response: action.message, toolCalls: [] };
            } else if (action.type === 'run' || action.skill) {
                const query = action.query || action.message || action.skill || trigger.label;
                result = await this.runner.run(query, {
                    chatHistory: [],
                    ...(action.opts || {})
                });
            } else if (action.type === 'goal' && this.goalManager) {
                const goal = this.goalManager.create(action.description || trigger.label);
                result = await this.goalManager.execute(goal, action.opts || {});
            } else {
                result = { response: `Trigger fired: ${trigger.label}`, toolCalls: [] };
            }
        } catch (err) {
            trigger.status = TRIGGER_STATUS.FAILED;
            result = { response: `Error: ${err.message}`, toolCalls: [], error: err.message };
        }

        // Store result and notify
        const entry = {
            triggerId: trigger.id,
            label: trigger.label,
            result: result.response || result.finalAnswer || '',
            firedAt: now,
            status: trigger.status === TRIGGER_STATUS.FAILED ? 'failed' : 'success'
        };
        this.results.push(entry);
        if (this.results.length > this.maxResults) {
            this.results = this.results.slice(-this.maxResults);
        }

        this.onNotify(entry);
        await this.persist();

        return entry;
    }

    // ── Schedule evaluation (cron matching) ──
    _evalSchedule(trigger, now) {
        const d = new Date(now);
        const c = trigger.cron;

        // Prevent double-fire within same minute
        if (trigger.lastFired) {
            const lastD = new Date(trigger.lastFired);
            if (d.getFullYear() === lastD.getFullYear() &&
                d.getMonth() === lastD.getMonth() &&
                d.getDate() === lastD.getDate() &&
                d.getHours() === lastD.getHours() &&
                d.getMinutes() === lastD.getMinutes()) {
                return false;
            }
        }

        return this._cronFieldMatch(c.minute, d.getMinutes()) &&
               this._cronFieldMatch(c.hour, d.getHours()) &&
               this._cronFieldMatch(c.dayOfMonth, d.getDate()) &&
               this._cronFieldMatch(c.month, d.getMonth() + 1) &&
               this._cronFieldMatch(c.dayOfWeek, d.getDay());
    }

    // ── Condition evaluation ──
    _evalCondition(trigger, now) {
        // Conditions are checked externally (via tool calls)
        // This method checks if cooldown has elapsed
        if (trigger.lastFired && (now - trigger.lastFired) < trigger.cooldown) {
            return false;
        }
        if (trigger.lastValue === null || trigger.lastValue === undefined) {
            return false;  // No value yet — needs external update
        }
        return this._compare(trigger.lastValue, trigger.operator, trigger.threshold);
    }

    // ── Reminder evaluation ──
    _evalReminder(trigger, now) {
        return now >= trigger.fireAt;
    }

    // ── Follow-up evaluation ──
    _evalFollowUp(trigger) {
        if (!this.goalManager) return false;
        const goal = this.goalManager.get(trigger.goalId);
        if (!goal) return false;
        const step = goal.subgoals[trigger.stepIndex];
        return step && (step.status === 'completed' || step.status === 'failed');
    }

    // ── Update condition value (called externally after checking) ──
    updateConditionValue(triggerId, value) {
        const t = this.triggers.get(triggerId);
        if (!t || t.type !== TRIGGER_TYPE.CONDITION) return false;
        t.lastValue = value;
        t.lastChecked = Date.now();
        return true;
    }

    // ── Compare values ──
    _compare(value, operator, threshold) {
        switch (operator) {
            case '>':  return value > threshold;
            case '<':  return value < threshold;
            case '>=': return value >= threshold;
            case '<=': return value <= threshold;
            case '==': return value == threshold;  // eslint-disable-line eqeqeq
            case '!=': return value != threshold;  // eslint-disable-line eqeqeq
            default:   return false;
        }
    }

    // ── Parse cron expression (5-field: min hour dom month dow) ──
    _parseCron(expr) {
        if (!expr || typeof expr !== 'string') return null;
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return null;

        const parse = (field, min, max) => {
            if (field === '*') return { type: 'any' };
            if (field.includes('/')) {
                const [, step] = field.split('/');
                const s = parseInt(step, 10);
                if (isNaN(s) || s < 1) return null;
                return { type: 'step', step: s };
            }
            if (field.includes(',')) {
                const vals = field.split(',').map(v => parseInt(v, 10));
                if (vals.some(isNaN)) return null;
                return { type: 'list', values: vals };
            }
            if (field.includes('-')) {
                const [lo, hi] = field.split('-').map(v => parseInt(v, 10));
                if (isNaN(lo) || isNaN(hi)) return null;
                return { type: 'range', lo, hi };
            }
            const n = parseInt(field, 10);
            if (isNaN(n) || n < min || n > max) return null;
            return { type: 'exact', value: n };
        };

        const minute = parse(parts[0], 0, 59);
        const hour = parse(parts[1], 0, 23);
        const dayOfMonth = parse(parts[2], 1, 31);
        const month = parse(parts[3], 1, 12);
        const dayOfWeek = parse(parts[4], 0, 6);

        if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
        return { minute, hour, dayOfMonth, month, dayOfWeek };
    }

    // ── Match a cron field against a value ──
    _cronFieldMatch(field, value) {
        switch (field.type) {
            case 'any':   return true;
            case 'exact':  return value === field.value;
            case 'list':   return field.values.includes(value);
            case 'range':  return value >= field.lo && value <= field.hi;
            case 'step':   return value % field.step === 0;
            default:       return false;
        }
    }

    // ── Generate unique ID ──
    _makeId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
}
