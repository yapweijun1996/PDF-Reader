// ============================================================
//  model-router.js — Phase-aware multi-model routing
//  Routes OODA-E phases to appropriate models based on
//  phase complexity, confidence level, and retry state.
//  Simple phases (OBSERVE/CLASSIFY) → fast/small model
//  Complex phases (DECIDE/EVALUATE) → default model
//  Low-confidence retries → strong/larger model
// ============================================================

import { HarnessConfig } from './config.js';

const MODEL_TIER = {
    FAST: 'fast',
    DEFAULT: 'default',
    STRONG: 'strong'
};

export { MODEL_TIER };

export class ModelRouter {
    constructor(opts = {}) {
        // Model names per tier — configurable via constructor or HarnessConfig
        const cfg = HarnessConfig.routing || {};
        this.models = {
            fast: opts.fast || cfg.fast || null,
            default: opts.default || cfg.default || null,
            strong: opts.strong || cfg.strong || null
        };

        // Phase → tier mapping (defaults, can be overridden)
        this.phaseMap = {
            observe: MODEL_TIER.FAST,
            classify: MODEL_TIER.FAST,
            orient: MODEL_TIER.DEFAULT,     // orient rarely calls model, but if it does
            decide: MODEL_TIER.DEFAULT,
            act: MODEL_TIER.DEFAULT,        // act itself doesn't call model, but subagent act does
            evaluate: MODEL_TIER.DEFAULT,
            decompose: MODEL_TIER.DEFAULT,  // goal/subagent decomposition
            synthesize: MODEL_TIER.DEFAULT, // goal synthesis
            replan: MODEL_TIER.DEFAULT,     // goal replanning
            direct: MODEL_TIER.DEFAULT,     // direct response (no tools)
            fallback: MODEL_TIER.DEFAULT,   // force final answer
            ...(cfg.phaseMap || {}),
            ...(opts.phaseMap || {})
        };

        // Confidence escalation: when confidence is low, bump tier
        this.escalateOnLowConfidence = opts.escalateOnLowConfidence ?? cfg.escalateOnLowConfidence ?? true;

        // Stats tracking
        this.stats = { fast: 0, default: 0, strong: 0, bypassed: 0 };
    }

    /**
     * Route a phase to the appropriate model.
     * @param {string} phase - OODA-E phase name (observe, classify, decide, etc.)
     * @param {object} context - Optional context for routing decisions
     * @param {string} context.confidence - Current confidence level (high/medium/low)
     * @param {number} context.retryCount - Number of retries for this phase
     * @param {string} context.strategy - Current strategy (default/narrow/broaden/etc.)
     * @returns {string|null} Model name to use, or null for API default
     */
    route(phase, context = {}) {
        const { confidence, retryCount, strategy } = context;

        // Determine base tier from phase mapping
        let tier = this.phaseMap[phase] || MODEL_TIER.DEFAULT;

        // Escalation rules
        if (this.escalateOnLowConfidence) {
            // Low confidence on retry → escalate to strong
            if (confidence === 'low' && (retryCount || 0) > 0) {
                tier = MODEL_TIER.STRONG;
            }
            // Deep research or decompose strategy → use strong model for DECIDE
            else if (phase === 'decide' && (strategy === 'deep_research' || strategy === 'decompose')) {
                tier = MODEL_TIER.STRONG;
            }
            // Medium confidence on 2nd+ retry → escalate to strong for EVALUATE
            else if (phase === 'evaluate' && confidence === 'medium' && (retryCount || 0) >= 2) {
                tier = MODEL_TIER.STRONG;
            }
        }

        // Resolve tier to model name
        const model = this.models[tier] || this.models.default || null;

        // Track stats
        if (model) {
            this.stats[tier] = (this.stats[tier] || 0) + 1;
        } else {
            this.stats.bypassed++;
        }

        return model;
    }

    /**
     * Get routing stats for monitoring/debugging.
     * @returns {object} Call counts per tier
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset routing stats.
     */
    resetStats() {
        this.stats = { fast: 0, default: 0, strong: 0, bypassed: 0 };
    }

    /**
     * Update model for a specific tier at runtime.
     * @param {string} tier - 'fast', 'default', or 'strong'
     * @param {string} modelName - New model name
     */
    setModel(tier, modelName) {
        if (this.models.hasOwnProperty(tier)) {
            this.models[tier] = modelName;
        }
    }

    /**
     * Update phase → tier mapping at runtime.
     * @param {string} phase - Phase name
     * @param {string} tier - Target tier
     */
    setPhaseMapping(phase, tier) {
        this.phaseMap[phase] = tier;
    }
}
