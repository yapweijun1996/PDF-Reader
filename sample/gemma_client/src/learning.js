// ============================================================
//  learning.js — LearningSystem: experience-driven improvement
//  Logs every run() outcome, discovers patterns across queries,
//  recommends strategies for DECIDE, and auto-generates skills
//  from repeated tool combinations.
// ============================================================

import { HarnessConfig } from './config.js';

export class LearningSystem {
    constructor(opts = {}) {
        this.memoryDB = opts.memoryDB || null;
        this.skillRegistry = opts.skillRegistry || null;

        const cfg = HarnessConfig.learning || {};
        this.maxHistory = opts.maxHistory ?? cfg.maxHistory ?? 500;
        this.minPatternsForRecommendation = opts.minPatterns ?? cfg.minPatterns ?? 5;
        this.skillDetectionThreshold = opts.skillThreshold ?? cfg.skillThreshold ?? 5;
        this.maxPatterns = opts.maxPatterns ?? cfg.maxPatterns ?? 50;

        // In-memory history (loaded from IndexedDB on restore)
        this.history = [];
        // Discovered patterns cache
        this._patterns = new Map();  // queryType → pattern
        this._lastDiscovery = 0;
        this._discoveryInterval = opts.discoveryInterval ?? cfg.discoveryInterval ?? 300000; // 5 min
    }

    // ================================================================
    //  1. Experience recording — log every run() outcome
    // ================================================================
    logOutcome(entry) {
        const toolsUsed = this._extractToolsUsed(entry);
        const toolCombo = this._extractToolCombo(entry);
        const record = {
            id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            intent: entry.intent || 'unknown',
            strategy: entry.strategy || 'default',
            toolsUsed,
            toolCombo,
            queryType: this._classifyQueryType({ ...entry, toolsUsed }),
            confidence: entry.confidence || 'medium',
            success: this._isSuccess(entry),
            iterations: entry.iterations || 0,
            duration: entry.duration || 0,
            tokenStats: entry.tokenStats || null
        };

        this.history.push(record);

        // Cap history
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }

        // Persist asynchronously (fire-and-forget)
        this._persistEntry(record);

        return record;
    }

    // ================================================================
    //  2. Pattern discovery — analyze accumulated outcomes
    // ================================================================
    discoverPatterns() {
        if (this.history.length < this.minPatternsForRecommendation) {
            return this._patterns;
        }

        // Group by query type
        const groups = new Map();
        for (const h of this.history) {
            const key = h.queryType;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(h);
        }

        this._patterns.clear();

        for (const [queryType, entries] of groups) {
            if (entries.length < 3) continue; // Need minimum data

            // Strategy success rates
            const strategyStats = new Map();
            for (const e of entries) {
                if (!strategyStats.has(e.strategy)) {
                    strategyStats.set(e.strategy, { total: 0, success: 0, avgConfidence: 0 });
                }
                const s = strategyStats.get(e.strategy);
                s.total++;
                if (e.success) s.success++;
                s.avgConfidence += (e.confidence === 'high' ? 3 : e.confidence === 'medium' ? 2 : 1);
            }

            // Find best strategy
            let bestStrategy = 'default';
            let bestRate = 0;
            for (const [strategy, stats] of strategyStats) {
                stats.avgConfidence = stats.avgConfidence / stats.total;
                const rate = stats.success / stats.total;
                if (rate > bestRate || (rate === bestRate && stats.avgConfidence > (strategyStats.get(bestStrategy)?.avgConfidence || 0))) {
                    bestRate = rate;
                    bestStrategy = strategy;
                }
            }

            // Tool frequency
            const toolFreq = new Map();
            for (const e of entries) {
                for (const tool of e.toolsUsed) {
                    toolFreq.set(tool, (toolFreq.get(tool) || 0) + 1);
                }
            }
            const bestTools = [...toolFreq.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name]) => name);

            // Confidence distribution
            const confDist = { high: 0, medium: 0, low: 0 };
            for (const e of entries) {
                confDist[e.confidence] = (confDist[e.confidence] || 0) + 1;
            }

            // Average iterations
            const avgIterations = entries.reduce((s, e) => s + e.iterations, 0) / entries.length;

            this._patterns.set(queryType, {
                queryType,
                sampleSize: entries.length,
                bestStrategy,
                successRate: bestRate,
                bestTools,
                avgConfidence: strategyStats.get(bestStrategy)?.avgConfidence || 2,
                confidenceDistribution: confDist,
                avgIterations: Math.round(avgIterations * 10) / 10,
                strategyStats: Object.fromEntries(
                    [...strategyStats.entries()].map(([k, v]) => [k, { ...v, successRate: v.success / v.total }])
                )
            });
        }

        // Cap patterns
        if (this._patterns.size > this.maxPatterns) {
            const sorted = [...this._patterns.entries()]
                .sort((a, b) => b[1].sampleSize - a[1].sampleSize);
            this._patterns = new Map(sorted.slice(0, this.maxPatterns));
        }

        this._lastDiscovery = Date.now();
        return this._patterns;
    }

    // ================================================================
    //  3. Strategy recommendation — called by DECIDE phase
    // ================================================================
    recommendStrategy(observation) {
        // Auto-discover if stale
        if (Date.now() - this._lastDiscovery > this._discoveryInterval && this.history.length >= this.minPatternsForRecommendation) {
            this.discoverPatterns();
        }

        if (this._patterns.size === 0) {
            return null; // Not enough data yet
        }

        const queryType = this._classifyQueryType({
            intent: observation.intent,
            toolsUsed: [],
            entities: observation.key_entities
        });

        let pattern = this._patterns.get(queryType);

        // Fallback: at recommendation time, tools are unknown → queryType may be 'general'.
        // Try to find the best matching pattern by largest sample size for this intent.
        if ((!pattern || pattern.sampleSize < this.minPatternsForRecommendation) && queryType === 'general') {
            let best = null;
            for (const p of this._patterns.values()) {
                if (p.sampleSize >= this.minPatternsForRecommendation) {
                    if (!best || p.sampleSize > best.sampleSize) best = p;
                }
            }
            if (best) pattern = best;
        }

        if (!pattern || pattern.sampleSize < this.minPatternsForRecommendation) {
            return null;
        }

        // Only recommend if significantly better than default
        if (pattern.bestStrategy === 'default') {
            return null;
        }

        return {
            strategy: pattern.bestStrategy,
            tools: pattern.bestTools,
            confidence: pattern.avgConfidence,
            successRate: pattern.successRate,
            sampleSize: pattern.sampleSize,
            reason: `Based on ${pattern.sampleSize} similar "${queryType}" queries: "${pattern.bestStrategy}" strategy has ${Math.round(pattern.successRate * 100)}% success rate`
        };
    }

    // ================================================================
    //  4. Auto-skill generation — detect repeated tool combos
    // ================================================================
    detectNewSkills() {
        if (!this.skillRegistry) return [];

        // Count tool combo frequencies
        const comboFreq = new Map();
        for (const h of this.history) {
            if (!h.success || h.toolCombo.length < 2) continue;
            const key = h.toolCombo.join(' → ');
            if (!comboFreq.has(key)) {
                comboFreq.set(key, { combo: h.toolCombo, count: 0, queryTypes: new Set() });
            }
            const entry = comboFreq.get(key);
            entry.count++;
            entry.queryTypes.add(h.queryType);
        }

        const newSkills = [];
        for (const [key, data] of comboFreq) {
            if (data.count < this.skillDetectionThreshold) continue;

            // Generate skill name from combo
            const skillName = `auto_${data.combo.map(t => t.replace(/[^a-z0-9]/gi, '')).join('_')}`;

            // Skip if already registered
            if (this.skillRegistry.has(skillName)) continue;

            const steps = data.combo.map(tool => ({
                tool,
                args: {},
                reason: `auto-skill: ${skillName}`
            }));

            const skill = {
                name: skillName,
                description: `Auto-generated: ${data.combo.join(' → ')} (${data.count} occurrences)`,
                steps,
                parameters: {}
            };

            try {
                this.skillRegistry.add(skill);
                newSkills.push(skill);
            } catch (e) { console.warn('LearningSystem: failed to register auto-skill:', e.message); }
        }

        return newSkills;
    }

    // ================================================================
    //  5. Best practices — surface tips per phase
    // ================================================================
    getBestPractices(phase) {
        if (this._patterns.size === 0) return '';

        const practices = [];

        if (phase === 'decide') {
            // Strategy recommendations per query type
            for (const [, p] of this._patterns) {
                if (p.bestStrategy !== 'default' && p.successRate > 0.7 && p.sampleSize >= 5) {
                    practices.push(`For "${p.queryType}" queries, "${p.bestStrategy}" strategy works best (${Math.round(p.successRate * 100)}% success).`);
                }
            }
        }

        if (phase === 'evaluate') {
            // Average iterations insight
            const avgIter = [...this._patterns.values()]
                .filter(p => p.sampleSize >= 5)
                .reduce((s, p) => s + p.avgIterations, 0) / Math.max(this._patterns.size, 1);
            if (avgIter > 2) {
                practices.push(`Queries typically need ${avgIter.toFixed(1)} iterations. Consider being more decisive.`);
            }
        }

        return practices.slice(0, 3).join('\n');
    }

    // ================================================================
    //  Query stats — summary for debugging/monitoring
    // ================================================================
    getStats() {
        const total = this.history.length;
        const success = this.history.filter(h => h.success).length;
        const byType = {};
        for (const h of this.history) {
            byType[h.queryType] = (byType[h.queryType] || 0) + 1;
        }
        const byStrategy = {};
        for (const h of this.history) {
            byStrategy[h.strategy] = (byStrategy[h.strategy] || 0) + 1;
        }
        return {
            totalQueries: total,
            successRate: total > 0 ? success / total : 0,
            patternCount: this._patterns.size,
            queryTypes: byType,
            strategies: byStrategy
        };
    }

    // ================================================================
    //  Persistence — IndexedDB
    // ================================================================
    async persist() {
        if (!this.memoryDB?.saveLearning) return;
        try {
            await this.memoryDB.saveLearning(this.history);
        } catch (e) { console.warn('LearningSystem persist failed:', e.message); }
    }

    async restore() {
        if (!this.memoryDB?.getLearning) return;
        try {
            const stored = await this.memoryDB.getLearning();
            if (Array.isArray(stored) && stored.length > 0) {
                this.history = stored.slice(-this.maxHistory);
                // Auto-discover patterns on restore if enough data
                if (this.history.length >= this.minPatternsForRecommendation) {
                    this.discoverPatterns();
                }
            }
        } catch (e) { console.warn('LearningSystem restore failed:', e.message); }
    }

    // ═══════════════════════════════════════════
    //  Internal helpers
    // ═══════════════════════════════════════════

    _classifyQueryType(entry) {
        const intent = entry.intent || 'unknown';
        const tools = entry.toolsUsed || [];
        const entities = entry.entities || [];

        // Simple classification based on intent + tool usage
        if (intent === 'greeting') return 'greeting';
        if (intent === 'acknowledgment') return 'acknowledgment';
        if (intent === 'command') return 'command';
        if (intent === 'information_sharing') return 'info_sharing';
        if (intent === 'task_request') return 'task_request';

        // Tool-based classification
        if (tools.includes('recall_memory') || tools.includes('save_memory')) return 'memory';
        if (tools.includes('get_weather')) return 'weather';
        if (tools.includes('get_time')) return 'time';
        if (tools.includes('exchange_rate')) return 'finance';
        if (tools.includes('fetch_url')) return 'research';
        if (tools.includes('web_search')) return 'search';

        // Entity-based
        if (entities.length >= 2) return 'comparison';

        return intent === 'follow_up' ? 'follow_up' : 'general';
    }

    _extractToolsUsed(entry) {
        const tools = new Set();
        const toolCalls = entry.toolCalls || [];
        for (const tc of toolCalls) {
            if (tc.tool) tools.add(tc.tool);
            if (tc.name) tools.add(tc.name);
        }
        // Also extract from phases
        const phases = entry.phases || [];
        for (const p of phases) {
            if (p.phase === 'act' && Array.isArray(p.data)) {
                for (const r of p.data) {
                    if (r.tool) tools.add(r.tool);
                }
            }
        }
        return [...tools];
    }

    _extractToolCombo(entry) {
        // Ordered sequence of tools as actually executed
        const combo = [];
        const phases = entry.phases || [];
        for (const p of phases) {
            if (p.phase === 'act' && Array.isArray(p.data)) {
                for (const r of p.data) {
                    if (r.tool) combo.push(r.tool);
                }
            }
        }
        if (combo.length > 0) return combo;

        // Fallback: extract from toolCalls
        const toolCalls = entry.toolCalls || [];
        for (const tc of toolCalls) {
            if (tc.tool) combo.push(tc.tool);
            else if (tc.name) combo.push(tc.name);
        }
        return combo;
    }

    _isSuccess(entry) {
        if (typeof entry.success === 'boolean') return entry.success;
        // Infer from confidence
        if (entry.confidence === 'high') return true;
        if (entry.confidence === 'low' && entry.iterations >= 3) return false;
        // Infer from response presence
        if (entry.response && entry.response.length > 50) return true;
        return entry.confidence !== 'low';
    }

    async _persistEntry(record) {
        if (!this.memoryDB?.appendLearning) return;
        try {
            await this.memoryDB.appendLearning(record);
        } catch (e) { console.warn('LearningSystem _persistEntry failed:', e.message); }
    }
}
