// ============================================================
//  oodae.js — OODA-E + COT Agent Runtime (Orchestrator)
//  Observe → Classify → Orient → Decide → Act → Evaluate (loop)
//  Each step is a separate, focused API call for weak models.
//
//  Modules:
//    oodae-observe.js    — OBSERVE, CLASSIFY
//    oodae-workspace.js  — Workspace resolution + topic persistence
//    oodae-decide.js     — ORIENT, DECIDE, multi-intent enrichment
//    oodae-act.js        — ACT, URL validation, fetch dedup, parallel execution
//    oodae-evaluate.js   — EVALUATE, direct response, final answer
//    oodae-subagent.js   — Sub-agent decomposition and delegation
//    oodae-helpers.js    — JSON parsing, model calls, shared utilities
//    skill-registry.js   — Named multi-step skill templates
// ============================================================

import { ToolRunner } from './tool-runner.js';
import { HarnessConfig } from './config.js';
import { ModelRouter } from './model-router.js';
import { SearchAgent } from './search-agent.js';

// Phase methods — mixed into OODAERunner.prototype below
import { _observe, _classifyIntent } from './oodae-observe.js';
import { _microIntent, _microEntities, _microReference, _microMemory, _microSelectTool, _microArgs, _microSufficiency, _microAnswer, _classifyMicro, _decideMicro, _evaluateMicro } from './oodae-micro.js';
import { _resolveFromWorkspace, _saveToWorkspace } from './oodae-workspace.js';
import { _orient, _decide, _decideSimplified, _buildFallbackPlan, _applyDeicticCorrection, _expandMultiTargetExchangeRatePlan } from './oodae-decide.js';
import { _enrichPlanForMissedIntents } from './oodae-plan-post.js';
import { _act, _actParallel, _actSearchChain, _validateUrl, _shortenQuery, _pickBestUrl, _visionEnhanceResult } from './oodae-act.js';
import { _evaluate, _directResponse, _forceFinalAnswer } from './oodae-evaluate.js';
import { _decompose, _runSubAgents, _evaluateSubAgents } from './oodae-subagent.js';
import { _callModel, _parseJSON, _extractBalancedBraces, _repairPlanArray, _recoverToolPlan, _buildToolDefsCompact, _getLangInstruction, _getRecentContext, _rankByRelevance, _extractKnownAnswers, _detectLanguage, _findMatchingMemKey, _stripThinking, _analyzeConfidenceTrend, _selectNextStrategy, _extractConfidence } from './oodae-helpers.js';

const MAX_LOOPS = HarnessConfig.agent.maxLoops;
const MAX_ACT_ITERATIONS = HarnessConfig.agent.maxActIterations;

export const PHASE = {
    OBSERVE: 'observe',
    CLASSIFY: 'classify',
    ORIENT: 'orient',
    DECIDE: 'decide',
    ACT: 'act',
    EVALUATE: 'evaluate'
};

export class OODAERunner {
    constructor(api, registry, opts = {}) {
        this.api = api;
        this.registry = registry;
        this.skillRegistry = opts.skillRegistry || null;
        this.maxLoops = opts.maxLoops ?? MAX_LOOPS;
        this.maxActIterations = opts.maxActIterations ?? MAX_ACT_ITERATIONS;
        this.enableSubAgents = opts.enableSubAgents ?? true;
        // Model routing: auto-select model per phase
        this.modelRouter = opts.modelRouter instanceof ModelRouter
            ? opts.modelRouter
            : (opts.modelRouter ? new ModelRouter(opts.modelRouter) : null);
        // Learning system: experience-driven improvement
        this.learningSystem = opts.learningSystem || null;
        // AGENTS.md persona & policy config
        this.agentsConfig = opts.agentsConfig || null;
        // SearchAgent: agentic web search with plan-execute-validate-refine loop
        this.searchAgent = new SearchAgent(api, registry);
    }

    // ===== COODAE: Build unified context object =====
    // Creates a single ctx that flows through all OODA-E phases,
    // replacing scattered observation/classification/orientation/loopOpts locals.
    _buildCtx(userText, chatHistory, opts) {
        return {
            // ── Run inputs (set once) ──
            userText,
            chatHistory,
            memoryDB:        opts.memoryDB        || null,
            model:           opts.model           || null,
            generationConfig:opts.generationConfig|| null,
            callbacks: {
                onPhase:      opts.onPhase      || (() => {}),
                onToolCall:   opts.onToolCall   || (() => {}),
                onToolResult: opts.onToolResult || (() => {}),
            },
            _lastTopicId: opts._lastTopicId || null,
            _goalContext:  opts._goalContext  || null,
            agentsConfig:  this.agentsConfig  || null,

            // ── Cached context (set at run() start, replaces this._ctx) ──
            recent3:  null,
            recent6:  null,
            recent10: null,
            formattedProfile:       null,   // set by ORIENT
            formattedProfileRecall: null,   // set by ORIENT

            // ── OBSERVE output fields ──
            intent: null, requires_tools: null, key_entities: [],
            is_about_user: false, summary: null,
            _memoryAction: null, _saveKey: null, _saveValue: null,
            _savePairs: null, _searchEntities: null,
            _wsContextAvailable: null, _wsRecentEntity: null, _thinkingSummary: null,

            // ── CLASSIFY output fields ──
            is_greeting: false, is_command: false, is_acknowledgment: false,
            is_task_request: false, is_reference: false, is_info_sharing: false,
            needs_tools: false, memory_action: null, save_key: null,
            save_value: null, user_entities: [], search_entities: [],

            // ── ORIENT output fields ──
            language: 'english', language_raw: null, user_profile: {},
            all_memories: [], timezone: null,

            // ── Loop state (replaces local vars in run()) ──
            loopCount: 0,
            allActResults: [],
            confidenceHistory: [],
            strategy: 'default',
            triedStrategies: new Set(['default']),
            feedbackContext: null,   // replaces orientation._additionalContext
            plan: null,
            evaluation: null,

            // ── Phase routing (replaces loopOpts fields) ──
            _phase: null, _confidence: null, _retryCount: 0,

            // ── Output accumulation ──
            phaseLog:  [],
            toolTrace: [],
        };
    }

    // ===== Main orchestration =====
    async run(userText, opts = {}) {
        const chatHistory = opts.chatHistory || [];
        const toolTrace = [];
        const phaseLog = [];
        const onPhase = opts.onPhase || (() => {});
        const onToolCall = opts.onToolCall || (() => {});
        const onToolResult = opts.onToolResult || (() => {});

        // ── Token tracking: reset per-run counters ──
        this._runTokens = 0;
        this._peakCallTokens = 0;
        const _startTime = Date.now();
        const _finish = (payload) => ({ ...payload, durationMs: Date.now() - _startTime });

        // ── COODAE: build unified context, replaces this._ctx and all scattered locals ──
        const ctx = this._buildCtx(userText, chatHistory, opts);
        ctx.recent3  = this._getRecentContext(chatHistory, 3);
        ctx.recent6  = this._getRecentContext(chatHistory, 6);
        ctx.recent10 = this._getRecentContext(chatHistory, 10);
        // Alias this._ctx → ctx so helpers using this._ctx.recent3 etc. continue to work
        this._ctx = ctx;

        // P27 fix: pass _lastTopicId to workspace resolution for pronoun follow-ups
        if (this._lastTopicId) {
            opts._lastTopicId = this._lastTopicId;
            ctx._lastTopicId  = this._lastTopicId;
        }

        try {
            // === OBSERVE ===
            onPhase(PHASE.OBSERVE, { status: 'start' });
            const observation = await this._observe(ctx);  // COODAE: writes to ctx; returns ctx as alias
            onPhase(PHASE.OBSERVE, { status: 'done', data: observation });
            phaseLog.push({ phase: PHASE.OBSERVE, data: observation });

            // === CLASSIFY (micro-agents — ctx path applies corrections internally) ===
            onPhase(PHASE.CLASSIFY, { status: 'start' });
            const classification = await this._classifyMicro(ctx);  // COODAE: writes to ctx + applies corrections
            onPhase(PHASE.CLASSIFY, { status: 'done', data: classification });
            phaseLog.push({ phase: PHASE.CLASSIFY, data: classification });

            // === ORIENT (no API call) ===
            onPhase(PHASE.ORIENT, { status: 'start' });
            const orientation = await this._orient(ctx);   // COODAE: writes to ctx; returns legacy obj too
            // ── GoalManager: goal context already on ctx; keep on legacy orientation alias too ──
            if (opts._goalContext) {
                orientation._goalContext = opts._goalContext;
            }

            onPhase(PHASE.ORIENT, { status: 'done', data: orientation });
            phaseLog.push({ phase: PHASE.ORIENT, data: orientation });

            // P26 fix: if ORIENT detected recall action, force tool path even if CLASSIFY missed it
            // ORIENT checks observation.is_about_user which OBSERVE detects more reliably than CLASSIFY
            if (orientation.memory_action === 'recall' && !observation.requires_tools) {
                observation.requires_tools = true;
                observation._memoryAction = 'recall';
            }

            // Fast path: no tools needed → direct response
            if (!observation.requires_tools && !observation.intent?.includes('information_sharing')) {
                const response = await this._directResponse(ctx);  // COODAE: reads ctx.userText/observation/orientation/chatHistory
                chatHistory.push(
                    { role: 'user', parts: [{ text: userText }] },
                    { role: 'model', parts: [{ text: response }] }
                );
                this._lastTopicId = await this._saveToWorkspace(ctx, response);  // COODAE
                const _r0 = _finish({ response, toolCalls: [], chatHistory, phases: phaseLog, iterations: 0, tokenStats: this._tokenStats() });
                this._logToLearning(_r0, observation, _startTime);
                return _r0;
            }

            // === Sub-agent path: complex multi-part queries ===
            // Skip decomposition for memory operations — compound info saves (e.g. "我叫小明，我住在上海")
            // are NOT multi-part queries; they should go through the DECIDE→save_memory path.
            const isMemoryOp = observation.intent === 'information_sharing' || observation.intent === 'command'
                || observation._memoryAction === 'save' || observation._memoryAction === 'recall';
            if (this.enableSubAgents && !isMemoryOp && (classification.user_entities || []).length >= 2) {
                const subtasks = await this._decompose(userText, observation, classification, opts);
                if (subtasks && subtasks.length >= 2) {
                    onPhase('decompose', { status: 'done', data: subtasks });
                    phaseLog.push({ phase: 'decompose', data: subtasks });

                    onPhase(PHASE.ACT, { status: 'start', subAgents: subtasks.length });
                    const subResults = await this._runSubAgents(subtasks, observation, orientation, opts, { onPhase, onToolCall, onToolResult });
                    onPhase(PHASE.ACT, { status: 'done', data: subResults, subAgents: subtasks.length });
                    phaseLog.push({ phase: PHASE.ACT, data: subResults, subAgents: subtasks.length });

                    onPhase(PHASE.EVALUATE, { status: 'start', subAgents: subtasks.length });
                    const evaluation = await this._evaluateSubAgents(subtasks, subResults, userText, orientation, opts);
                    onPhase(PHASE.EVALUATE, { status: 'done', data: evaluation });
                    phaseLog.push({ phase: PHASE.EVALUATE, data: evaluation });

                    const finalText = evaluation.final_answer || '';
                    chatHistory.push(
                        { role: 'user', parts: [{ text: userText }] },
                        { role: 'model', parts: [{ text: finalText }] }
                    );
                    this._lastTopicId = await this._saveToWorkspace(ctx, finalText);  // COODAE
                    const _r1 = _finish({ response: finalText, toolCalls: toolTrace, chatHistory, phases: phaseLog, iterations: 1, subAgents: subtasks.length, tokenStats: this._tokenStats() });
                    this._logToLearning(_r1, observation, _startTime);
                    return _r1;
                }
            }

            // === DECIDE → ACT → EVALUATE loop (with proactive re-planning) ===
            // COODAE: loop state lives on ctx — loopCount, allActResults, confidenceHistory, strategy, triedStrategies

            // ── LearningSystem: recommend initial strategy from historical patterns ──
            if (this.learningSystem) {
                const rec = this.learningSystem.recommendStrategy(ctx);
                if (rec && rec.strategy && rec.strategy !== 'default') {
                    ctx.strategy = rec.strategy;
                    ctx.triedStrategies.add(rec.strategy);
                }
            }

            while (ctx.loopCount < this.maxLoops) {
                ctx.loopCount++;

                // DECIDE (strategy-aware, with routing context)
                ctx._confidence = ctx.confidenceHistory[ctx.confidenceHistory.length - 1] || null;
                ctx._retryCount = ctx.loopCount - 1;
                onPhase(PHASE.DECIDE, { status: 'start', loop: ctx.loopCount, strategy: ctx.strategy });
                let plan = await this._decideMicro(ctx);  // COODAE: reads ctx.allActResults, feedbackContext

                // ── Harness: skill expansion ──
                // If DECIDE selected a skill, expand it into concrete tool calls
                if (this.skillRegistry && plan.plan) {
                    plan.plan = this._expandSkills(plan.plan);
                }

                // Layer 3: retry with simplified prompt if plan is empty
                if (!plan.plan || plan.plan.length === 0) {
                    plan = await this._decideSimplified(ctx);  // COODAE: reads/writes ctx.plan
                }

                // Layer 4: deterministic fallback if still empty
                if (!plan.plan || plan.plan.length === 0) {
                    const fb = this._buildFallbackPlan(ctx);  // COODAE: reads ctx observation/orientation
                    if (fb.length > 0) {
                        plan = { plan: fb, _raw: '[deterministic fallback]' };
                        ctx.plan = plan;
                    }
                }

                // ── Harness: multi-intent detection ──
                ctx.plan = plan;  // sync before enrichment (plan may have changed via fallbacks)
                plan = this._enrichPlanForMissedIntents(ctx);  // COODAE: reads/writes ctx.plan

                // ── P25 fix: apply deictic correction to ALL decide paths ──
                // Previously only ran inside _decide's main JSON parse path.
                // Now catches _decideSimplified, _recoverToolPlan, _buildFallbackPlan too.
                this._applyDeicticCorrection(plan, ctx, ctx);  // COODAE: ctx IS observation+classification

                // ── P28 fix: normalize memory keys for ALL decide paths ──
                // _decide's internal normalization only runs on successful JSON parse.
                // _recoverToolPlan, _decideSimplified, _buildFallbackPlan bypass it.
                // Apply here as catch-all before execution.
                if (ctx.all_memories?.length > 0 && plan.plan?.length > 0) {
                    const existingKeys = ctx.all_memories.map(m => m.key);
                    for (const step of plan.plan) {
                        if (step.tool === 'recall_memory') {
                            const recallKey = step.args?.key || step.args?.query;
                            if (recallKey) {
                                const match = this._findMatchingMemKey(recallKey, existingKeys);
                                if (match) {
                                    if (step.args.key) step.args.key = match;
                                    if (step.args.query) step.args.query = match;
                                }
                            }
                        }
                        if (step.tool === 'save_memory' && step.args?.key) {
                            const match = this._findMatchingMemKey(step.args.key, existingKeys);
                            if (match && match !== step.args.key) {
                                step.args.key = match;
                            }
                        }
                    }
                }
                _expandMultiTargetExchangeRatePlan(plan, ctx);

                onPhase(PHASE.DECIDE, { status: 'done', data: plan, loop: ctx.loopCount, strategy: ctx.strategy });
                phaseLog.push({ phase: PHASE.DECIDE, data: plan, loop: ctx.loopCount, strategy: ctx.strategy });

                // ACT — delegate web_search to SearchAgent for intelligent search
                if (plan.plan && plan.plan.length > 0) {
                    onPhase(PHASE.ACT, { status: 'start', loop: ctx.loopCount });

                    // ── SearchAgent integration: extract web_search steps for agentic handling ──
                    const searchSteps = plan.plan.filter(s => s.tool === 'web_search');
                    const otherSteps = plan.plan.filter(s => s.tool !== 'web_search');
                    let actResults = [];

                    // Execute non-search tools via regular path
                    if (otherSteps.length > 0) {
                        const otherResults = await this._act({ plan: otherSteps }, { onToolCall, onToolResult, toolTrace });
                        actResults = actResults.concat(otherResults);
                    }

                    // Execute search via SearchAgent (agentic: plan → search → validate → refine)
                    if (searchSteps.length > 0) {
                        const searchContext = {
                            intent: ctx.intent,
                            summary: ctx.summary,
                            userText,  // raw user input — critical for SearchAgent to see actual question
                            entities: ctx.key_entities || [],
                            language: ctx.language,
                            recentConversation: ctx.recent3 || this._getRecentContext(chatHistory, 3),
                            userProfile: ctx.user_profile,
                            previousQueries: ctx.allActResults
                                .filter(r => r.name === 'web_search')
                                .map(r => r.args?.query).filter(Boolean)
                        };

                        for (const step of searchSteps) {
                            const agentResult = await this.searchAgent.search(
                                step.args?.query || ctx.summary,
                                searchContext,
                                { onToolCall, onToolResult, toolTrace }
                            );

                            // Convert SearchAgent results to standard actResult format
                            for (const r of agentResult.results) {
                                actResults.push({
                                    name: 'web_search',
                                    args: { query: r._query || step.args?.query },
                                    result: { results: [r] }
                                });
                            }
                            for (const fc of agentResult.fetchedContent) {
                                actResults.push({
                                    name: 'fetch_url',
                                    args: { url: fc.url },
                                    result: fc.content
                                });
                            }

                            // Feed used queries back for dedup in next rounds
                            searchContext.previousQueries.push(...agentResult.queriesUsed);
                        }
                    }

                    ctx.allActResults = ctx.allActResults.concat(actResults);

                    // ── Compress old results to reduce EVALUATE token load ──
                    // Keep full details only for last 4 results; summarize older ones
                    if (ctx.allActResults.length > 4) {
                        const older = ctx.allActResults.slice(0, -4);
                        const recent = ctx.allActResults.slice(-4);
                        const summary = older.map(r => {
                            const val = r.error ? `error: ${String(r.error).slice(0, 80)}` :
                                (r.result?.results ? `${r.result.results.length} results` :
                                 (typeof r.result === 'string' ? r.result.slice(0, 100) : 'ok'));
                            return `${r.name}(${JSON.stringify(r.args || {}).slice(0, 60)}): ${val}`;
                        }).join('; ');
                        ctx.allActResults = [
                            { name: '_previous_summary', args: {}, result: { summary, count: older.length } },
                            ...recent
                        ];
                    }

                    onPhase(PHASE.ACT, { status: 'done', data: actResults, loop: ctx.loopCount });
                    phaseLog.push({ phase: PHASE.ACT, data: actResults, loop: ctx.loopCount });
                } else {
                    break;
                }

                // EVALUATE
                onPhase(PHASE.EVALUATE, { status: 'start', loop: ctx.loopCount });
                const evaluation = await this._evaluateMicro(ctx);  // COODAE: reads ctx.allActResults, writes ctx.evaluation
                const confidence = this._extractConfidence(evaluation);
                ctx.confidenceHistory.push(confidence);
                onPhase(PHASE.EVALUATE, { status: 'done', data: evaluation, loop: ctx.loopCount, confidence });
                phaseLog.push({ phase: PHASE.EVALUATE, data: evaluation, loop: ctx.loopCount, confidence });

                if (!evaluation.needs_more) {
                    const finalText = evaluation.final_answer || '';
                    chatHistory.push(
                        { role: 'user', parts: [{ text: userText }] },
                        { role: 'model', parts: [{ text: finalText }] }
                    );
                    this._lastTopicId = await this._saveToWorkspace(ctx, finalText);  // COODAE
                    const _r2 = _finish({ response: finalText, toolCalls: toolTrace, chatHistory, phases: phaseLog, iterations: ctx.loopCount, confidence, strategy: ctx.strategy, tokenStats: this._tokenStats() });
                    this._logToLearning(_r2, ctx, _startTime);
                    return _r2;
                }

                // ── REPLAN: analyze confidence trend and switch strategy if failing ──
                const trend = this._analyzeConfidenceTrend(ctx.confidenceHistory);
                const nextStrategy = this._selectNextStrategy(trend, ctx.triedStrategies, evaluation);

                if (nextStrategy !== ctx.strategy) {
                    const prevStrategy = ctx.strategy;
                    ctx.strategy = nextStrategy;
                    ctx.triedStrategies.add(nextStrategy);
                    onPhase('replan', { status: 'done', data: { from: prevStrategy, to: nextStrategy, trend, confidence } });
                    phaseLog.push({ phase: 'replan', data: { from: prevStrategy, to: nextStrategy, trend, confidence } });
                }

                // ── Enhanced feedback: pass suggested_query + strategy to next DECIDE ──
                let feedback = evaluation.reason || 'Need more information';
                if (evaluation.suggested_query) {
                    feedback += `\nSUGGESTED QUERY: "${evaluation.suggested_query}"`;
                }
                ctx.feedbackContext = feedback;
            }

            // Max loops — force final answer
            const fallback = await this._forceFinalAnswer(ctx);  // COODAE
            chatHistory.push(
                { role: 'user', parts: [{ text: userText }] },
                { role: 'model', parts: [{ text: fallback }] }
            );
            this._lastTopicId = await this._saveToWorkspace(ctx, fallback);  // COODAE
            const _r3 = _finish({ response: fallback, toolCalls: toolTrace, chatHistory, phases: phaseLog, iterations: ctx.loopCount, confidenceHistory: ctx.confidenceHistory, strategy: ctx.strategy, tokenStats: this._tokenStats() });
            this._logToLearning(_r3, ctx, _startTime);
            return _r3;

        } catch (err) {
            console.warn('OODA-E failed, falling back to ToolRunner:', err);
            onPhase('fallback', { status: 'start', error: err.message });
            const fallbackResult = await this._fallbackToToolRunner(userText, chatHistory, opts);
            if (!fallbackResult.durationMs) fallbackResult.durationMs = Date.now() - _startTime;
            return fallbackResult;
        }
    }

    // ===== Token stats for this run =====
    _tokenStats() {
        return {
            totalTokens: this._runTokens || 0,
            peakCallTokens: this._peakCallTokens || 0,
            ...(this.modelRouter ? { routing: this.modelRouter.getStats() } : {})
        };
    }

    // ===== Learning: log outcome after run completes =====
    _logToLearning(result, observation, startTime) {
        if (!this.learningSystem) return;
        try {
            this.learningSystem.logOutcome({
                intent: observation?.intent,
                strategy: result.strategy || 'default',
                confidence: result.confidence,
                iterations: result.iterations || 0,
                toolCalls: result.toolCalls || [],
                phases: result.phases || [],
                response: result.response || '',
                tokenStats: result.tokenStats,
                duration: Date.now() - startTime,
                entities: observation?.key_entities
            });
        } catch (e) { console.warn('LearningSystem logOutcome failed:', e.message); }
    }

    // ===== Skill expansion: replace skill references with concrete tool calls =====
    _expandSkills(planSteps) {
        if (!this.skillRegistry) return planSteps;
        const expanded = [];
        for (const step of planSteps) {
            if (this.skillRegistry.has(step.tool)) {
                const skillSteps = this.skillRegistry.expand(step.tool, step.args || {});
                expanded.push(...skillSteps);
            } else {
                expanded.push(step);
            }
        }
        return expanded;
    }

    // ===== Fallback to ToolRunner =====
    _fallbackToToolRunner(userText, chatHistory, opts) {
        const runner = new ToolRunner(this.api, this.registry, { maxIterations: this.maxActIterations });
        return runner.run(userText, {
            chatHistory,
            model: opts.model,
            generationConfig: opts.generationConfig,
            onToolCall: opts.onToolCall,
            onToolResult: opts.onToolResult
        });
    }
}

// ── Mixin: attach all phase methods to OODAERunner.prototype ──
Object.assign(OODAERunner.prototype, {
    // Observe + Classify
    _observe, _resolveFromWorkspace, _saveToWorkspace, _classifyIntent,
    // Micro-agents (focused single-decision calls)
    _microIntent, _microEntities, _microReference, _microMemory,
    _microSelectTool, _microArgs, _microSufficiency, _microAnswer,
    _classifyMicro, _decideMicro, _evaluateMicro,
    // Orient + Decide
    _orient, _decide, _decideSimplified, _buildFallbackPlan, _applyDeicticCorrection, _enrichPlanForMissedIntents,
    // Act
    _act, _actParallel, _actSearchChain, _validateUrl, _shortenQuery, _pickBestUrl, _visionEnhanceResult,
    // Evaluate
    _evaluate, _directResponse, _forceFinalAnswer,
    // Sub-agents
    _decompose, _runSubAgents, _evaluateSubAgents,
    // Helpers
    _callModel, _parseJSON, _extractBalancedBraces, _repairPlanArray, _recoverToolPlan,
    _buildToolDefsCompact, _getLangInstruction, _getRecentContext, _rankByRelevance, _extractKnownAnswers,
    _detectLanguage, _findMatchingMemKey, _stripThinking, _analyzeConfidenceTrend, _selectNextStrategy, _extractConfidence
});
