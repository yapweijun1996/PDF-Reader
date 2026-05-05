// ============================================================
//  client.js — GemmaAPI: the main API call wrapper
// ============================================================

import { KeyManager, fetchWithRetry } from './core.js';
import { HarnessConfig } from './config.js';

export class GemmaAPI {
    /**
     * @param {object} opts
     * @param {KeyManager} [opts.keyManager]   - Pre-configured KeyManager
     * @param {string}     [opts.model]        - Default model name
     * @param {object}     [opts.generationConfig] - Default generation config
     * @param {object}     [opts.retryOpts]    - { maxRetries, baseDelay }
     */
    constructor(opts = {}) {
        this.keyManager = opts.keyManager || new KeyManager();
        this.model = opts.model || HarnessConfig.api.model;
        this.generationConfig = opts.generationConfig || { ...HarnessConfig.generation.client };
        this.retryOpts = opts.retryOpts || { ...HarnessConfig.api.retry };
    }

    /**
     * Load API keys from a JSONL file.
     */
    async loadKeys(url) {
        return this.keyManager.loadFromJSONL(url);
    }

    /**
     * Send a single generateContent request.
     * Tries all available keys before giving up.
     *
     * @param {object} opts
     * @param {Array}  opts.contents           - The contents array for the API
     * @param {string} [opts.model]            - Override model
     * @param {object} [opts.generationConfig] - Override generation config
     * @returns {Promise<object>} Raw API response JSON
     */
    async generateContent(opts = {}) {
        const model = opts.model || this.model;
        const config = opts.generationConfig || this.generationConfig;
        const contents = this._sanitizeContents(opts.contents);
        if (!contents) throw new Error('contents is required');

        let lastError = null;
        const advanceKey = () => {
            this.keyManager.rotate();
            if (this.keyManager.useCount > 0) this.keyManager.useCount--;
        };
        const invalidateKey = () => this.keyManager.invalidateCurrent();

        let attemptsRemaining = Math.max(this.keyManager.count || 1, 1);
        while (attemptsRemaining-- > 0) {
            const key = this.keyManager.current();
            const url = `${HarnessConfig.api.baseUrl}/${model}:generateContent?key=${key}`;
            try {
                const response = await fetchWithRetry(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents, generationConfig: config })
                }, this.retryOpts);

                if (!response.ok) {
                    const errText = await response.text();
                    lastError = new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
                    if (response.status === 401 || response.status === 403) {
                        invalidateKey();
                    } else if (attemptsRemaining > 0) {
                        advanceKey();
                    }
                    continue;
                }
                const result = await response.json();
                if (!result.candidates?.length) {
                    throw new Error('No candidates in API response');
                }
                return result;
            } catch (err) {
                lastError = err;
                if (attemptsRemaining > 0) {
                    advanceKey();
                    continue;
                }
            }
        }
        throw lastError || new Error('All API keys failed.');
    }

    /**
     * Convenience: send a text message in a chat conversation.
     * Manages chatHistory in place (push user msg, push model response).
     *
     * @param {string} text             - User's text message
     * @param {Array}  chatHistory      - Conversation array (mutated)
     * @param {object} [opts]           - Override model / generationConfig
     * @returns {Promise<string>} The model's text reply
     */
    async chat(text, chatHistory, opts = {}) {
        const userMsg = { role: 'user', parts: [{ text }] };
        chatHistory.push(userMsg);

        try {
            const result = await this.generateContent({
                contents: chatHistory,
                model: opts.model,
                generationConfig: opts.generationConfig
            });
            const modelParts = result.candidates[0].content.parts;
            chatHistory.push({ role: 'model', parts: modelParts });
            return modelParts.map(p => p.text || '').join('');
        } catch (err) {
            chatHistory.pop(); // rollback user message
            throw err;
        }
    }

    /**
     * Send a vision request (image + text).
     *
     * @param {string} text        - Prompt text
     * @param {string} base64Data  - Base64-encoded image data
     * @param {string} mimeType    - e.g. "image/jpeg"
     * @param {Array}  chatHistory - Conversation array (mutated)
     * @param {object} [opts]
     * @returns {Promise<string>} The model's text reply
     */
    async vision(text, base64Data, mimeType, chatHistory, opts = {}) {
        const userMsg = {
            role: 'user',
            parts: [
                { text },
                { inline_data: { data: base64Data, mime_type: mimeType } }
            ]
        };
        chatHistory.push(userMsg);

        try {
            const result = await this.generateContent({
                contents: chatHistory,
                model: opts.model,
                generationConfig: opts.generationConfig
            });
            const modelParts = result.candidates[0].content.parts;
            chatHistory.push({ role: 'model', parts: modelParts });
            return modelParts.map(p => p.text || '').join('');
        } catch (err) {
            chatHistory.pop();
            throw err;
        }
    }

    _sanitizeContents(contents) {
        if (!contents) return contents;
        return contents.map(({ _meta, ...rest }) => rest);
    }
}
