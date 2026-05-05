// ============================================================
//  oodae-helpers.js — Shared utilities for OODA-E phases
//  JSON parsing, model calls, tool definitions, language, context
// ============================================================

import { HarnessConfig } from './config.js';
import { buildAgentsPromptBlock, hasAgentsConfig } from './agents-config.js';

const _GROUNDING_PRONOUNS = new Set([
    'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
    'this', 'that', 'these', 'those', 'who', 'whom', 'which', 'what',
    '他', '她', '它', '他们', '她们', '它们', '他的', '她的', '它的', '他们的', '她们的', '它们的',
    '这个', '那个', '这家', '那家', '这些', '那些', '谁', '哪个', '什么',
    'dia', 'mereka', 'ini', 'itu',
]);

const _GROUNDING_STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'get', 'how', 'i',
    'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'tell', 'that', 'the', 'this',
    'to', 'us', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your'
]);

const _GROUNDING_NUMBER_WORDS = new Set([
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty'
]);

function _normalizeGroundText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function _callModel(prompt, opts = {}) {
    // ── COODAE: duck-type — ctx passes itself as opts ──
    const isCtx      = opts && typeof opts === 'object' && 'userText' in opts;
    const _phase     = isCtx ? opts._phase          : opts._phase;
    const _confidence= isCtx ? opts._confidence     : opts._confidence;
    const _retryCount= isCtx ? opts._retryCount     : opts._retryCount;
    const _strategy  = isCtx ? opts.strategy        : opts._strategy;
    const genConfig  = isCtx ? opts.generationConfig: opts.generationConfig;

    // ── ModelRouter: auto-select model per phase when no explicit model ──
    let model = isCtx ? opts.model : opts.model;
    if (!model && this.modelRouter && _phase) {
        model = this.modelRouter.route(_phase, {
            confidence: _confidence,
            retryCount: _retryCount,
            strategy: _strategy
        });
    }

    return this.api.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        model,
        generationConfig: genConfig || { ...HarnessConfig.generation.helper }
    }).then(result => {
        // ── Token tracking: capture actual API-reported token usage ──
        const tokens = result.usageMetadata?.totalTokenCount || 0;
        if (tokens > 0) {
            this._runTokens = (this._runTokens || 0) + tokens;
            this._peakCallTokens = Math.max(this._peakCallTokens || 0, tokens);
        }
        return result.candidates[0].content.parts.map(p => p.text || '').join('');
    });
}

export function _parseJSON(text) {
    let s = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    // Progressive JSON parse: try raw → strip fences → extract braces → repair
    try { return JSON.parse(s); } catch { /* fallthrough: try stripping fences */ }
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try { return JSON.parse(s); } catch { /* fallthrough: try brace extraction */ }
    const match = s.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch { /* fallthrough: try trailing comma fix */ }
        try { return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); } catch { /* fallthrough: try array repair */ }
        // Layer 1: repair malformed plan arrays (e.g. reason as sibling in array)
        const repaired = this._repairPlanArray(match[0]);
        if (repaired) { try { return JSON.parse(repaired); } catch { /* all parse strategies exhausted */ } }
    }
    return null;
}

// Extract balanced {…} from a string starting at the given index
export function _extractBalancedBraces(str, start) {
    if (str[start] !== '{') return null;
    let depth = 0;
    let inStr = false;
    for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (inStr) {
            if (ch === '\\') { i++; continue; }
            if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') depth++;
        if (ch === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return null;
}

// Repair plan arrays where non-object elements leaked in
export function _repairPlanArray(jsonStr) {
    const planIdx = jsonStr.indexOf('"plan"');
    if (planIdx === -1) return null;
    const bracketIdx = jsonStr.indexOf('[', planIdx);
    if (bracketIdx === -1) return null;

    const objects = [];
    let i = bracketIdx + 1;
    while (i < jsonStr.length) {
        const ch = jsonStr[i];
        if (ch === ']') break;
        if (ch === '{') {
            const obj = this._extractBalancedBraces(jsonStr, i);
            if (obj) {
                if (obj.includes('"tool"')) objects.push(obj);
                i += obj.length;
                continue;
            }
        }
        i++;
    }
    if (objects.length === 0) return null;
    return `{"plan":[${objects.join(',')}]}`;
}

// Recover tool plan from malformed JSON
export function _recoverToolPlan(raw) {
    const plan = [];
    const cleaned = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    const toolPattern = /"tool"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = toolPattern.exec(cleaned)) !== null) {
        const toolName = match[1];
        if (this.registry && !this.registry.has(toolName)) continue;
        const afterTool = cleaned.slice(match.index);
        const argsStart = afterTool.search(/"args"\s*:\s*\{/);
        let args = {};
        if (argsStart !== -1) {
            const bracePos = match.index + afterTool.indexOf('{', argsStart);
            const extracted = this._extractBalancedBraces(cleaned, bracePos);
            if (extracted) { try { args = JSON.parse(extracted); } catch { /* malformed args JSON — use empty */ } }
        }
        const reasonMatch = afterTool.match(/"reason"\s*:\s*"([^"]*)"/);
        plan.push({ tool: toolName, args, reason: reasonMatch ? reasonMatch[1] : '' });
    }
    return plan;
}

export function _buildToolDefsCompact() {
    return this.registry.list().map(t => {
        const params = Object.entries(t.parameters || {})
            .map(([k, v]) => `${k}${v.required ? '*' : ''}:${v.type || 'str'}`)
            .join(', ');
        return `- ${t.name}(${params}): ${(t.description || '').slice(0, HarnessConfig.truncation.toolDescLength)}`;
    }).join('\n');
}

export function _getLangInstruction(language) {
    const preserve = 'IMPORTANT: NEVER translate proper nouns. Keep these in their ORIGINAL form: people names, company names, brand names, addresses, email addresses, phone numbers, URLs/websites, product names. Example: "John Smith" stays "John Smith", NOT "约翰·史密斯". "123 Main Street" stays "123 Main Street", NOT "主街123号".';
    const m = {
        mandarin: `REPLY ONLY IN 中文. No pinyin. No English translation. No bilingual output. ${preserve}`,
        malay: `REPLY ONLY IN Bahasa Melayu. No English translation. No bilingual output. ${preserve}`,
        japanese: `REPLY ONLY IN 日本語. No romaji. No English translation. No bilingual output. ${preserve}`,
        english: 'Reply in English.'
    };
    return m[language] || `Reply in ${language}. ${preserve}`;
}

export function _groundEntitiesToUserText(entities, userText) {
    const haystack = _normalizeGroundText(userText);
    if (!haystack) return [];
    const seen = new Set();
    const grounded = [];

    for (const entity of entities || []) {
        const raw = String(entity || '').trim();
        const normalized = _normalizeGroundText(raw);
        if (!normalized) continue;
        if (normalized.length === 1 && !/\d/.test(normalized)) continue;
        if (!haystack.includes(normalized)) continue;

        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        grounded.push(raw);
    }

    return grounded;
}

const _MATH_OPERATOR_WORDS = new Set([
    'plus', 'minus', 'times', 'divided', 'multiplied', 'added', 'subtracted',
    'by', 'over', 'of', 'to', 'the', 'power', 'mod', 'percent'
]);

export function _isSubstantiveEntity(entity) {
    const normalized = _normalizeGroundText(entity);
    if (!normalized) return false;
    if (_GROUNDING_PRONOUNS.has(normalized)) return false;
    if (/^\d+(?:\.\d+)?$/.test(normalized)) return false;
    if (_GROUNDING_NUMBER_WORDS.has(normalized)) return false;

    // Reject multi-token math expressions like "6 by five", "three times two"
    const tokens = normalized.split(' ').filter(Boolean);
    if (tokens.length >= 2) {
        const isMathExpr = tokens.every(t =>
            /^\d+(?:\.\d+)?$/.test(t) ||
            _GROUNDING_NUMBER_WORDS.has(t) ||
            _MATH_OPERATOR_WORDS.has(t)
        );
        if (isMathExpr) return false;
    }

    return normalized.length >= 2;
}

export function _looksUnderspecified(userText, entities = []) {
    const normalized = _normalizeGroundText(userText);
    if (!normalized) return true;

    const substantiveEntities = (entities || []).filter(_isSubstantiveEntity);
    if (substantiveEntities.length > 0) return false;

    const tokens = normalized.split(' ').filter(Boolean);
    if (tokens.some(t => _GROUNDING_PRONOUNS.has(t))) return true;
    if ((normalized.match(/\d+(?:\.\d+)?/g) || []).length >= 2) return false;

    const contentTokens = tokens.filter(t =>
        t.length > 1
        && !_GROUNDING_STOPWORDS.has(t)
        && !_GROUNDING_PRONOUNS.has(t)
    );

    return contentTokens.length < 2;
}

// ── P21 fix: auto-detect reply language from user input text ──
export function _detectLanguage(text) {
    if (!text || text.trim().length === 0) return null;
    // Japanese-specific kana takes priority over shared CJK
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'japanese';
    if (/[\uac00-\ud7af]/.test(text)) return 'korean';
    // CJK Unified Ideographs — shared by Chinese/Japanese, but if no kana → Chinese
    if (/[\u4e00-\u9fff]/.test(text)) return 'mandarin';
    if (/[\u0e00-\u0e7f]/.test(text)) return 'thai';
    if (/[\u0600-\u06ff]/.test(text)) return 'arabic';
    // Latin-script languages (Malay, French, etc.) can't be reliably detected by charset alone
    return null;
}

// ── P18 fix: fuzzy memory key matching to prevent duplicate keys ──
export function _findMatchingMemKey(newKey, existingKeys) {
    if (existingKeys.includes(newKey)) return newKey;

    const normalize = k => k.toLowerCase().replace(/^(user_|my_)/, '').replace(/[-\s]/g, '_');
    const nn = normalize(newKey);
    const SCOPE_GROUPS = {
        pet: ['pet', 'cat', 'dog', 'kitten', 'puppy', '猫', '狗', '宠物', '猫咪']
    };
    const _hasScope = (normalized, group) => {
        const words = normalized.split('_');
        return group.some(term => words.includes(term) || normalized.includes(term));
    };

    // Exact match after normalization
    for (const existing of existingKeys) {
        if (normalize(existing) === nn) return existing;
    }

    // P27 fix: semantic alias group matching BEFORE substring containment.
    // Alias groups are more precise — "cat_name" should match "pet_name" (alias: cat↔pet)
    // NOT "user_name" (substring: "cat_name" contains "name").
    //
    // "cat_name" should match "pet_name"; "job" should match "occupation".
    // Require that DIFFERENT words from each key are aliased (not same word in both).
    // e.g., cat↔pet (from alias group), name=name (direct match) → "cat_name" ↔ "pet_name"
    // But "cat_name" should NOT match "user_name" (only "name" overlaps, no alias bridging).
    const ALIAS_GROUPS = [
        ['cat', 'kitten', 'pet', 'dog', 'puppy', '猫', '狗', '宠物', '猫咪'],
        ['name', 'nickname', 'alias', '名字', '名前', '叫'],
        ['location', 'city', 'address', 'place', 'hometown', 'home', '住', '地址', '城市', '家乡', '住址', '地方'],
        ['job', 'occupation', 'career', 'profession', 'work', '工作', '职业', '职位'],
        ['age', 'birthday', 'birth_date', 'born', '年龄', '生日', '岁'],
        ['language', 'lang', 'reply_language', '语言', '语言偏好'],
        ['programming_language', 'coding_language', 'favorite_language', '编程语言'],
        ['color', 'colour', 'favorite_color', '颜色', '喜欢的颜色'],
        ['food', 'favorite_food', 'cuisine', '食物', '美食', '喜欢吃'],
        ['hobby', 'hobbies', 'interest', 'interests', '爱好', '兴趣'],
    ];
    // P28 fix: build a set of all alias terms for CJK character extraction.
    // CJK keys like "猫の名前" have no underscores, so split('_') produces one token.
    // Extract individual CJK characters that appear in alias groups to enable matching.
    const allAliasTerms = new Set(ALIAS_GROUPS.flat());
    const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;
    const _addCJKAliasChars = (words, normalized) => {
        const chars = normalized.match(CJK_RE) || [];
        for (const ch of chars) {
            if (allAliasTerms.has(ch)) words.add(ch);
        }
        // Also try 2-char CJK substrings (e.g., "名字", "名前", "工作")
        for (let i = 0; i < normalized.length - 1; i++) {
            const pair = normalized.slice(i, i + 2);
            if (allAliasTerms.has(pair)) words.add(pair);
        }
    };
    const nnWords = new Set(nn.split('_'));
    _addCJKAliasChars(nnWords, nn);
    for (const existing of existingKeys) {
        const ne = normalize(existing);
        const neWords = new Set(ne.split('_'));
        _addCJKAliasChars(neWords, ne);
        for (const group of ALIAS_GROUPS) {
            // Find words from query key that are in this alias group but NOT in the existing key
            const qAliasWords = [...nnWords].filter(w => group.includes(w) && !neWords.has(w));
            // Find words from existing key that are in this alias group but NOT in the query key
            const eAliasWords = [...neWords].filter(w => group.includes(w) && !nnWords.has(w));
            // Match if both sides have alias words that bridge across (different words, same group)
            if (qAliasWords.length > 0 && eAliasWords.length > 0) return existing;
        }
    }

    // Substring containment (e.g., "favorite_sport" ⊂ "user_favorite_sport")
    // Checked AFTER alias groups to prevent "cat_name" matching "user_name" via "name" substring.
    for (const existing of existingKeys) {
        const ne = normalize(existing);
        if (nn.length >= 3 && ne.length >= 3) {
            const petMismatch = _hasScope(nn, SCOPE_GROUPS.pet) !== _hasScope(ne, SCOPE_GROUPS.pet);
            if (petMismatch) continue;
            if (ne.includes(nn) || nn.includes(ne)) return existing;
        }
    }

    return null;
}

// ── Strip <thinking> tags from free-text model responses ──
export function _stripThinking(text) {
    if (!text) return '';
    return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
}

// ── Proactive re-planning: analyze confidence trend across loops ──
export function _analyzeConfidenceTrend(history) {
    const scores = history.map(c => c === 'high' ? 3 : c === 'medium' ? 2 : 1);
    if (scores.length === 0) return 'start';
    if (scores.length === 1) {
        return scores[0] >= 2 ? 'progressing' : 'struggling';
    }
    const latest = scores[scores.length - 1];
    const previous = scores[scores.length - 2];
    if (latest > previous) return 'improving';
    if (latest < previous) return 'declining';
    if (latest === 1) return 'stuck_low';
    if (latest === 2) return 'plateaued';
    return 'stable';
}

// ── Proactive re-planning: select next strategy based on confidence trend ──
// Strategies: default → narrow → broaden → deep_research → alternative_source → decompose
export function _selectNextStrategy(trend, triedStrategies, evaluation) {
    // If improving, keep current approach
    if (trend === 'improving' || trend === 'progressing') return 'default';

    // Strategy priority depends on the failure pattern
    let candidates;
    switch (trend) {
        case 'declining':
        case 'stuck_low':
            // Current approach is failing badly → big pivot
            candidates = ['deep_research', 'alternative_source', 'decompose', 'broaden'];
            break;
        case 'plateaued':
            // Some progress but stuck → moderate change
            candidates = ['narrow', 'broaden', 'alternative_source', 'deep_research'];
            break;
        case 'struggling':
            // First loop was bad → try different angle
            candidates = ['narrow', 'deep_research', 'broaden'];
            break;
        default:
            candidates = ['narrow', 'broaden', 'deep_research'];
    }

    // Pick first untried strategy
    for (const s of candidates) {
        if (!triedStrategies.has(s)) return s;
    }
    return 'default';
}

// ── COT enhancement: extract confidence level from parsed evaluation result ──
export function _extractConfidence(parsed) {
    if (!parsed) return 'medium';
    if (parsed.confidence) return parsed.confidence.toLowerCase();
    const raw = parsed._raw || '';
    const match = raw.match(/confidence[:\s]*(high|medium|low)/i);
    return match ? match[1].toLowerCase() : 'medium';
}

// ── Harness: rank tool results by entity relevance ──
export function _rankByRelevance(actResults, entities) {
    if (!entities || entities.length === 0) return actResults;
    const eLower = entities.map(e => String(e).toLowerCase().slice(0, HarnessConfig.truncation.entityMatchLong));

    return [...actResults].sort((a, b) => {
        const score = (r) => {
            const text = JSON.stringify(r.result || r.error || '').toLowerCase().slice(0, HarnessConfig.truncation.resultRankingText);
            return eLower.reduce((s, e) => s + (text.includes(e) ? 1 : 0), 0);
        };
        return score(b) - score(a);
    });
}

// ── Harness: extract recent model answers from chatHistory (cross-turn dedup) ──
export function _extractKnownAnswers(chatHistory, maxItems) {
    maxItems = maxItems ?? HarnessConfig.context.knownAnswersMax;
    if (!chatHistory || chatHistory.length === 0) return [];
    return chatHistory
        .filter(m => m.role === 'model')
        .slice(-maxItems)
        .map(m => (m.parts || []).map(p => p.text || '').join('').slice(0, HarnessConfig.truncation.knownAnswerText))
        .filter(t => t.length > 30);
}

export function _getRecentContext(chatHistory, n) {
    const recent = chatHistory.slice(-n * HarnessConfig.context.recentContextMultiplier);
    if (recent.length === 0) return '';
    const maxLen = HarnessConfig.truncation.recentContextMessage;
    return recent.map(m => {
        // ── Metadata tag filter (preferred) with legacy prefix fallback ──
        if (m._meta === 'system') return null;
        const text = m.parts?.map(p => p.text || '').join('') || '';
        if (text.startsWith('[User context]') || text.startsWith('[Context ') || text.startsWith('[Conversation ') ||
            text.startsWith('Understood.') || text.startsWith('Noted.')) return null;
        if (text.length > maxLen) return `${m.role}: ${text.slice(0, maxLen)}...`;
        return `${m.role}: ${text}`;
    }).filter(Boolean).join('\n');
}

// ── AGENTS.md: build prompt block from ctx.agentsConfig ──
export function _getAgentsBlock(ctxOrOpts, mode) {
    const config = ctxOrOpts?.agentsConfig;
    if (!config || !hasAgentsConfig(config)) return '';
    return buildAgentsPromptBlock(config, { mode: mode || 'tool' });
}
