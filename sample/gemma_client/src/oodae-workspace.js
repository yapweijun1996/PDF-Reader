// ============================================================
//  oodae-workspace.js — Workspace resolution + topic persistence
//  Resolve context from IndexedDB topic tree, save topics after runs
// ============================================================

import { HarnessConfig } from './config.js';
import { _groundEntitiesToUserText, _isSubstantiveEntity, _looksUnderspecified } from './oodae-helpers.js';

// ── Pronouns/demonstratives that should NOT count as real entities ──
const PRONOUNS = new Set([
    // English
    'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
    'this', 'that', 'these', 'those', 'who', 'whom', 'which', 'what',
    // Chinese
    '他', '她', '它', '他们', '她们', '它们', '他的', '她的', '它的', '他们的', '她们的', '它们的',
    '这个', '那个', '这家', '那家', '这些', '那些', '谁', '哪个', '什么',
    // Malay
    'dia', 'mereka', 'ini', 'itu',
]);

// ===== Workspace: resolve context from topic tree (IndexedDB) =====
export async function _resolveFromWorkspace(userText, observation, opts) {
    const memoryDB = opts.memoryDB;
    if (!memoryDB?.getRecentTopics) return null;

    const trimmed = userText.trim();
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount > HarnessConfig.workspace.maxWordCount) return null;

    // ── Punctuation-only guard: bare "?" or "!" etc. should not trigger follow-up ──
    if (/^[\p{P}\p{S}\s]+$/u.test(trimmed)) return null;

    // ── Acknowledgment detection ──
    // P22 fix: also check fullwidth question mark '？' for CJK languages
    const modelEntities = _groundEntitiesToUserText(observation.key_entities || [], userText);
    const hasQuestion = trimmed.includes('?') || trimmed.includes('？');
    if (wordCount <= HarnessConfig.workspace.ackMaxWords && !observation.requires_tools && modelEntities.length === 0 && !hasQuestion) {
        return null;
    }

    // ── User-about-self detection ──
    if (observation.is_about_user) {
        return null;
    }

    // ── Command/preference detection ──
    if (!observation.requires_tools && (observation.intent?.includes('command') || observation.intent?.includes('information_sharing'))) {
        return null;
    }

    // ── P22 fix: filter pronouns from entities — pronouns are not real entities ──
    const realEntities = modelEntities.filter(e => !PRONOUNS.has(String(e).toLowerCase()));
    const substantiveEntities = realEntities.filter(_isSubstantiveEntity);

    // Only use workspace fallback for messages that are genuinely underspecified.
    // Self-contained prompts should not inherit the previous topic just because they are short.
    if (substantiveEntities.length === 0 && !_looksUnderspecified(userText, realEntities)) {
        return null;
    }

    // Already self-contained → don't look up workspace
    if (observation.intent === 'question' && realEntities.length > 0) {
        const entityStr = realEntities.map(e => String(e)).join(' ').toLowerCase();
        const userWords = trimmed.toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const coverage = userWords.filter(w => entityStr.includes(w)).length / (userWords.length || 1);
        if (coverage > HarnessConfig.workspace.entityCoverageThreshold) return null;
    }

    try {
        const recentTopics = await memoryDB.getRecentTopics(HarnessConfig.workspace.recentTopicsFetch);
        if (recentTopics.length === 0) return null;

        // ── Entity-matched topic resolution ──
        // Score each topic chain by overlap with user's entities to avoid
        // cross-topic contamination (e.g., "go back to SIA" returning Tesla chain)
        // P22 fix: use realEntities (pronouns filtered out) for matching
        const filteredEntities = substantiveEntities
            .map(e => String(e).toLowerCase())
            .filter(e => !PRONOUNS.has(e));
        let selectedTopic = null;
        let selectedChain = null;

        if (filteredEntities.length > 0) {
            let bestScore = 0;
            let fallbackTopic = null;
            let fallbackChain = null;

            for (const topic of recentTopics) {
                if (topic.intent === 'greeting') continue;
                if (topic.userText === trimmed) continue;

                const chain = await memoryDB.getTopicChain(topic.id);

                // Remember first valid candidate for fallback
                if (!fallbackTopic) {
                    fallbackTopic = topic;
                    fallbackChain = chain;
                }

                const chainEntities = [];
                for (const node of chain) {
                    if (node.entities) {
                        for (const e of node.entities) chainEntities.push(String(e).toLowerCase());
                    }
                }

                const score = filteredEntities.filter(me =>
                    chainEntities.some(ce => ce.includes(me) || me.includes(ce))
                ).length;

                if (score > bestScore) {
                    bestScore = score;
                    selectedTopic = topic;
                    selectedChain = chain;
                }
            }

            // No entity match → use most recent valid topic
            if (!selectedTopic && fallbackTopic) {
                selectedTopic = fallbackTopic;
                selectedChain = fallbackChain;
            }
        } else {
            // No user entities → fall back to most recent topic
            for (const topic of recentTopics) {
                if (topic.intent === 'greeting') continue;
                if (topic.userText === trimmed) continue;
                selectedTopic = topic;
                selectedChain = await memoryDB.getTopicChain(topic.id);
                break;
            }
        }

        if (!selectedTopic) return null;

        // ── Process selected chain ──
        let rootTopic = '';
        const rootEntities = [];
        const recentEntities = [];
        for (const node of selectedChain) {
            if (node.depth === 0 && node.intent !== 'greeting') {
                rootTopic = node.summary || node.userText;
                if (node.entities) rootEntities.push(...node.entities);
            } else {
                if (node.entities) recentEntities.push(...node.entities);
            }
        }

        // ── Harness: entity pruning — root entities first, then newest, cap at 10 ──
        const seen = new Set();
        const deduped = [];
        for (const e of rootEntities) {
            const key = String(e).toLowerCase();
            if (key.length > 0 && !seen.has(key)) {
                seen.add(key);
                deduped.push(e);
            }
        }
        for (let i = recentEntities.length - 1; i >= 0; i--) {
            const key = String(recentEntities[i]).toLowerCase();
            if (key.length > 0 && !seen.has(key)) {
                seen.add(key);
                deduped.push(recentEntities[i]);
            }
        }
        const cap = HarnessConfig.workspace.entityCap;
        const prunedEntities = deduped.length > cap ? deduped.slice(0, cap) : deduped;

        // P27 fix: add recentEntity — the leaf node's primary entity.
        // For pronoun follow-ups, this is the most likely referent (e.g., the person
        // just discussed), whereas prunedEntities[0] may be the root topic entity.
        const leafNode = selectedChain[selectedChain.length - 1];
        const recentEntity = leafNode?.entities?.[0] || prunedEntities[0] || null;

        return {
            topic: rootTopic || selectedTopic.topic || selectedTopic.userText,
            entities: prunedEntities,
            recentEntity,
            parentId: selectedTopic.id,
            chain: selectedChain
        };
    } catch (e) { console.warn('resolveFromWorkspace: failed:', e.message); }

    return null;
}

// ===== Workspace: save topic after each run =====
export async function _saveToWorkspace(userTextOrCtx, observationOrAnswer, opts, answer) {
    // ── COODAE: duck-type — ctx passes itself as first arg ──
    // Legacy: _saveToWorkspace(userText, observation, opts, answer)
    // Ctx:    _saveToWorkspace(ctx, answer)
    const isCtx      = userTextOrCtx && typeof userTextOrCtx === 'object' && 'userText' in userTextOrCtx;
    const userText   = isCtx ? userTextOrCtx.userText : userTextOrCtx;
    const observation = isCtx ? userTextOrCtx : observationOrAnswer;
    const _opts      = isCtx ? userTextOrCtx : opts;
    const _answer    = isCtx ? observationOrAnswer : answer;
    const memoryDB   = _opts.memoryDB;
    if (!memoryDB?.addTopic) return;

    try {
        let parentId = null;
        let depth = 0;
        if (observation.intent === 'follow_up' || observation._wsParentId) {
            const recentTopics = await memoryDB.getRecentTopics(1);
            if (recentTopics.length > 0 && recentTopics[0].userText !== userText) {
                parentId = recentTopics[0].id;
                depth = (recentTopics[0].depth || 0) + 1;
            }
        }

        // P22 fix: extract key entities from the answer text too.
        // When the answer is "Tesla的CEO是Elon Musk", we should save "Elon Musk"
        // so follow-up questions like "他的净资产多少？" can resolve the pronoun.
        const questionEntities = observation.key_entities || [];
        const answerEntities = _answer ? _extractAnswerEntities(_answer, questionEntities) : [];
        const allEntities = [...questionEntities];
        const seen = new Set(questionEntities.map(e => String(e).toLowerCase()));
        for (const e of answerEntities) {
            const key = String(e).toLowerCase();
            if (!seen.has(key) && !PRONOUNS.has(key)) {
                seen.add(key);
                allEntities.push(e);
            }
        }

        // P27 fix: return the new topic ID for _lastTopicId tracking
        const newId = await memoryDB.addTopic({
            topic: observation.summary || userText,
            entities: allEntities,
            summary: observation.summary || userText,
            userText: userText,
            answer: _answer ? _answer.slice(0, HarnessConfig.truncation.workspaceAnswer) : null,
            intent: observation.intent || 'question',
            parentId,
            depth
        });
        return newId;
    } catch (e) { console.warn('saveToWorkspace: failed:', e.message); }
}

// ===== Extract named entities from answer text =====
function _extractAnswerEntities(answer, existingEntities) {
    if (!answer || answer.length < 2) return [];
    const entities = [];

    // Extract capitalized multi-word names (e.g., "Elon Musk", "Tim Cook", "Star Alliance")
    const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    let match;
    while ((match = namePattern.exec(answer)) !== null) {
        const name = match[1];
        // Skip common phrases that aren't entities
        if (!/^(The |This |That |These |Those |It |I |We |They |He |She )/i.test(name)) {
            entities.push(name);
        }
    }

    // Extract CJK proper nouns preceded by "是" (is) — common answer pattern
    // e.g., "CEO是马斯克" → "马斯克", "CEO是Elon Musk" → "Elon Musk"
    // Skip grammatical constructs: "是一个/一位..." (generic classification) or "是否..." (conditional)
    const GENERIC_STARTS = /^(?:一[个位种类名批项场次套份只头条辆架艘张块]|否|不是|没有|无法|这[个些]?|那[个些]?|某)/;
    const isPattern = /是\s*([A-Za-z\u4e00-\u9fff][\w\s\u4e00-\u9fff·•]{1,30}?)[\s。，,.!！？?]/g;
    while ((match = isPattern.exec(answer)) !== null) {
        const name = match[1].trim();
        if (name.length >= 2 && name.length <= 30 && !GENERIC_STARTS.test(name)) {
            entities.push(name);
        }
    }

    // Deduplicate against existing entities
    const existingLower = new Set(existingEntities.map(e => String(e).toLowerCase()));
    return entities.filter(e => !existingLower.has(e.toLowerCase()));
}
