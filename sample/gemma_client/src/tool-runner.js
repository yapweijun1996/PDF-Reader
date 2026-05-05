// ============================================================
//  tool-runner.js — Agentic tool-calling loop
//  Legacy ToolRunner for direct prompt-based tool calling
// ============================================================

import { parseToolCalls, stripToolCalls, buildSystemPrompt } from './tool-parser.js';
import { HarnessConfig } from './config.js';
import { buildAgentsPromptBlock, hasAgentsConfig } from './agents-config.js';

const TOOL_RESULT_OPEN = '<tool_result>';
const TOOL_RESULT_CLOSE = '</tool_result>';

export class ToolRunner {
    constructor(api, registry, opts = {}) {
        this.api = api;
        this.registry = registry;
        this.maxIterations = opts.maxIterations ?? HarnessConfig.agent.toolRunnerMaxIterations;
        this.agentsConfig = opts.agentsConfig || null;
    }

    async run(userText, opts = {}) {
        const chatHistory = opts.chatHistory || [];
        const toolTrace = [];
        const startTime = Date.now();

        this._injectSystemPrompt(chatHistory);

        const userMsg = { role: 'user', parts: [{ text: userText }] };
        chatHistory.push(userMsg);

        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            // Strip internal _meta tags before sending to API (Gemini rejects unknown fields)
            const apiContents = chatHistory.map(({ _meta, ...rest }) => rest);
            const result = await this.api.generateContent({
                contents: apiContents,
                model: opts.model,
                generationConfig: opts.generationConfig
            });

            const modelParts = result.candidates[0].content.parts;
            const modelText = modelParts.map(p => p.text || '').join('');
            chatHistory.push({ role: 'model', parts: modelParts });

            if (opts.onModelReply) opts.onModelReply(modelText, iteration);

            const calls = parseToolCalls(modelText);
            if (calls.length === 0) {
                return {
                    response: modelText,
                    toolCalls: toolTrace,
                    chatHistory,
                    iterations: iteration + 1,
                    durationMs: Date.now() - startTime
                };
            }

            const results = [];
            for (const call of calls) {
                if (opts.onToolCall) opts.onToolCall(call);
                const execResult = await this.registry.execute(call.name, call.arguments);
                if (opts.onToolResult) opts.onToolResult(call, execResult);
                toolTrace.push({ ...call, ...execResult });
                results.push({
                    name: call.name,
                    ...(execResult.error ? { error: execResult.error } : { result: execResult.result })
                });
            }

            const resultsText = results.map(r =>
                `${TOOL_RESULT_OPEN}\n${JSON.stringify(r, null, 2)}\n${TOOL_RESULT_CLOSE}`
            ).join('\n\n');

            const toolResultMsg = {
                role: 'user',
                parts: [{ text: `Here are the results from the tool calls:\n\n${resultsText}\n\nUse these results to answer the original question.` }]
            };
            chatHistory.push(toolResultMsg);
        }

        const lastModel = chatHistory.filter(m => m.role === 'model').pop();
        const lastText = lastModel ? lastModel.parts.map(p => p.text || '').join('') : '';
        return {
            response: stripToolCalls(lastText) || '[Max tool iterations reached]',
            toolCalls: toolTrace,
            chatHistory,
            iterations: this.maxIterations,
            durationMs: Date.now() - startTime
        };
    }

    _injectSystemPrompt(chatHistory) {
        if (chatHistory.length > 0) {
            const first = chatHistory[0];
            if (first.role === 'user' && first.parts?.[0]?.text?.includes('Available tools:')) {
                return;
            }
        }

        let prompt = buildSystemPrompt(this.registry.list());
        if (this.agentsConfig && hasAgentsConfig(this.agentsConfig)) {
            prompt += '\n\n' + buildAgentsPromptBlock(this.agentsConfig, { mode: 'tool' });
        }
        chatHistory.unshift(
            { role: 'user', parts: [{ text: prompt }], _meta: 'system' },
            { role: 'model', parts: [{ text: 'Understood. I have access to the tools described above and will use them when appropriate to help answer your questions.' }], _meta: 'system' }
        );
    }
}

/**
 * @typedef {object} ToolRunResult
 * @property {string} response     - Final model text response
 * @property {Array}  toolCalls    - Array of { name, arguments, result|error }
 * @property {Array}  chatHistory  - Full conversation history
 * @property {number} iterations   - Number of model call rounds
 */
