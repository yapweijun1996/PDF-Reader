// ============================================================
//  knowledge-fact-extractor.js — Deterministic fact extraction
//  from search_knowledge results.
//
//  For high-confidence public facts (GitHub URL, CodePen, location,
//  project descriptions, contact routes), extracts the answer directly
//  from retrieved chunk text without relying on LLM summarization.
//
//  Returns null when no exact match is found, allowing fallback
//  to the standard LLM synthesis path.
//
//  IMPORTANT: Every extracted value is validated before return.
//  Invalid/ambiguous extractions return null → safe fallback.
// ============================================================

// ── Value validators ──
// Each returns true only if the extracted value looks like a real fact.

function _isValidUrl(val) {
    if (!val) return false;
    // Must contain a dot and at least a domain-like structure
    return /^(?:https?:\/\/)?[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(val) && val.length >= 5;
}

function _isValidGithubProfile(val) {
    if (!val) return false;
    // github.com/username or just a handle-like value with /
    if (/github\.com\/[a-z0-9_-]+/i.test(val)) return true;
    return false;
}

function _isValidCodepenProfile(val) {
    if (!val) return false;
    if (/codepen\.io\/[a-z0-9_-]+/i.test(val)) return true;
    return false;
}

function _isValidLocation(val) {
    if (!val) return false;
    const v = val.trim();
    if (v.length < 2) return false;
    // Reject if it looks like code
    if (/[{}()\[\]<>;=]/.test(v)) return false;
    // Reject values starting with stopwords/conjunctions (e.g. "and around the city")
    const REJECT_START = /^(and|or|the|a|an|in|at|to|for|is|are|was|were|be|not|no|yes|with|from|on|by|about|around|near)\b/i;
    if (REJECT_START.test(v)) return false;
    // Reject single stopwords
    const REJECT_EXACT = /^(and|or|the|a|an|in|at|to|for|is|are|was|were|be|not|no|yes|with|from|on|by|about)$/i;
    if (REJECT_EXACT.test(v)) return false;
    return true;
}

// ── Extraction helpers ──

/**
 * Extract a URL-like value from chunk text.
 * Tries domain-specific patterns first, then generic field:value patterns.
 * Returns null if no valid URL found.
 */
function _extractUrl(chunks, domainPattern, fieldPattern) {
    // Pass 1: Look for explicit domain URL (highest confidence)
    for (const chunk of chunks) {
        const match = chunk.text.match(domainPattern);
        if (match) return (match[0]).trim().replace(/[.,;:!?）)]+$/, '');
    }
    // Pass 2: Look for field: value pattern in bullet lists (e.g. "- GitHub: github.com/...")
    if (fieldPattern) {
        for (const chunk of chunks) {
            const match = chunk.text.match(fieldPattern);
            if (match && match[1]) {
                const val = match[1].trim().replace(/[.,;:!?）)]+$/, '');
                if (_isValidUrl(val)) return val;
            }
        }
    }
    return null;
}

/**
 * Extract a non-URL field value from chunk text.
 */
function _extractFieldFromText(chunks, pattern) {
    for (const chunk of chunks) {
        const match = chunk.text.match(pattern);
        if (match) return (match[1] || match[0]).trim();
    }
    return null;
}

/**
 * Extract a formatted contact info block from chunks.
 */
function _extractContactBlock(chunks) {
    for (const chunk of chunks) {
        const lower = (chunk.title || '').toLowerCase();
        if (lower.includes('contact') || lower.includes('reach') || lower.includes('how to')) {
            const bullets = chunk.text.match(/^-\s+.+$/gm);
            if (bullets && bullets.length > 0) {
                return bullets.map(b => b.replace(/^-\s+/, '').trim()).join('\n');
            }
            return chunk.text.trim();
        }
    }
    for (const chunk of chunks) {
        if (/contact\s+form|reach\s+out/i.test(chunk.text) && /yapweijun/i.test(chunk.text)) {
            return chunk.text.trim();
        }
    }
    return null;
}

/**
 * Extract a project description by matching the project name in the query
 * against chunk titles.
 */
function _extractProjectFact(query, chunks) {
    const q = query.toLowerCase()
        .replace(/what\s+is\s+(?:the\s+)?/i, '')
        .replace(/tell\s+me\s+about\s+/i, '')
        .replace(/是什么.*$/, '')
        .replace(/介绍一下/, '')
        .replace(/[？?。.!！]/g, '')
        .trim();

    if (q.length < 3) return null;

    for (const chunk of chunks) {
        const title = (chunk.title || '').toLowerCase();
        const titleLeaf = title.replace(/^.*>\s*/, '').trim();
        if (titleLeaf.length >= 3 && (titleLeaf.includes(q) || q.includes(titleLeaf))) {
            return { title: chunk.title.replace(/^.*>\s*/, '').trim(), text: chunk.text.trim() };
        }
    }

    for (const chunk of chunks) {
        const textLower = chunk.text.toLowerCase();
        if (textLower.includes(q) && chunk.source?.includes('project')) {
            return { title: chunk.title.replace(/^.*>\s*/, '').trim(), text: chunk.text.trim() };
        }
    }

    return null;
}

// ── Fact type definitions ──

const FACT_TYPES = [
    {
        name: 'github_profile',
        queryPatterns: [
            /github/i,
            /(?:his|her|your)\s+(?:git|repo)/i,
            /代码仓库|源代码/,
        ],
        extract: (chunks) => _extractUrl(
            chunks,
            /github\.com\/[a-z0-9_-]+/i,                          // domain URL (highest priority)
            /[-*]\s*GitHub[:\s]+([^\s,\n]+)/i                      // bullet "- GitHub: value"
        ),
        validate: _isValidGithubProfile,
        template: (val, lang) => lang === 'mandarin'
            ? `Yap Wei Jun 的公开 GitHub 主页是 ${val}。`
            : `Yap Wei Jun's public GitHub profile is ${val}.`,
    },
    {
        name: 'codepen_profile',
        queryPatterns: [
            /codepen/i,
        ],
        extract: (chunks) => _extractUrl(
            chunks,
            /codepen\.io\/[a-z0-9_-]+/i,
            /[-*]\s*CodePen[:\s]+([^\s,\n]+)/i
        ),
        validate: _isValidCodepenProfile,
        template: (val, lang) => lang === 'mandarin'
            ? `是的，Yap Wei Jun 有 CodePen 主页：${val}。`
            : `Yes, Yap Wei Jun has a CodePen profile at ${val}.`,
    },
    {
        name: 'website_url',
        queryPatterns: [
            /(?:his|her|your|the)\s+website/i,
            /(?:personal|official)\s+(?:site|website|page)/i,
            /网站|主页|官网/,
        ],
        extract: (chunks) => _extractUrl(
            chunks,
            /yapweijun1996\.com/i,
            /[-*]\s*(?:Personal\s+)?[Ww]ebsite[:\s]+([^\s,\n]+)/i
        ),
        validate: _isValidUrl,
        template: (val, lang) => lang === 'mandarin'
            ? `Yap Wei Jun 的个人网站是 ${val}。`
            : `Yap Wei Jun's personal website is ${val}.`,
    },
    {
        name: 'location',
        queryPatterns: [
            /where\s+(?:is\s+he|is\s+she|are\s+you|does\s+he)\s+(?:based|located|live|from)/i,
            /(?:his|her|your)\s+location/i,
            /在哪里|哪个国家|哪个城市|位于|坐落/,
        ],
        extract: (chunks) => {
            // Prefer explicit "Location: X" in bullet list
            const bulletVal = _extractFieldFromText(chunks, /[-*]\s*Location[:\s]+([^\n,]+)/i);
            if (bulletVal && _isValidLocation(bulletVal)) return bulletVal;
            // Fallback: "Based in X."
            const proseVal = _extractFieldFromText(chunks, /[Bb]ased in ([^.。\n,]+)/);
            if (proseVal && _isValidLocation(proseVal)) return proseVal;
            return null;
        },
        validate: _isValidLocation,
        template: (val, lang) => lang === 'mandarin'
            ? `Yap Wei Jun 位于${val}。`
            : `Yap Wei Jun is based in ${val}.`,
    },
    {
        name: 'contact_route',
        queryPatterns: [
            /how\s+(?:can|do|to)\s+(?:i\s+)?contact/i,
            /(?:reach|get\s+in\s+touch|connect\s+with)/i,
            /联系|怎么联系|如何联系|联系方式/,
        ],
        extract: (chunks) => _extractContactBlock(chunks),
        validate: (val) => val && val.length >= 10, // contact block should have substance
        template: null,
    },
    {
        name: 'project_description',
        queryPatterns: [
            /what\s+is\s+(?:the\s+)?(.+?)(?:\s+project|\s+tool|\s+app)?\s*\??$/i,
            /tell\s+me\s+about\s+(.+)/i,
            /(.+?)是什么/,
            /介绍一下(.+)/,
        ],
        extract: null, // handled by extractProjectFact
        validate: null,
        template: null,
    },
];

// ── Public API ──

/**
 * Attempt to extract an exact fact from search_knowledge results.
 * Returns null if no high-confidence fact is found.
 *
 * @param {string} query — the user's question
 * @param {Array<{id, source, title, text, score}>} results — search_knowledge results
 * @param {object} [opts]
 * @param {string} [opts.language='english'] — reply language
 * @returns {{ answer: string, factType: string } | null}
 */
export function extractKnowledgeFact(query, results, opts = {}) {
    if (!query || !results || results.length === 0) return null;

    const language = (opts.language || 'english').toLowerCase();
    const q = query.toLowerCase();

    // Try each fact type (except project_description which is handled separately)
    for (const factType of FACT_TYPES) {
        if (factType.name === 'project_description') continue;

        const matches = factType.queryPatterns.some(p => p.test(q));
        if (!matches) continue;

        const value = factType.extract(results);

        // ── Validation gate: reject invalid/ambiguous extracted values ──
        if (!value) continue;
        if (factType.validate && !factType.validate(value)) continue;

        const answer = factType.template
            ? factType.template(value, language)
            : value;

        return { answer, factType: factType.name };
    }

    // Project description: special handling with name matching
    const projectMatch = FACT_TYPES.find(f => f.name === 'project_description');
    if (projectMatch) {
        const isProjectQ = projectMatch.queryPatterns.some(p => p.test(q));
        if (isProjectQ) {
            const fact = _extractProjectFact(query, results);
            if (fact && fact.text && fact.text.length >= 10) {
                const answer = language === 'mandarin'
                    ? `${fact.title}：${fact.text}`
                    : `${fact.title}: ${fact.text}`;
                return { answer, factType: 'project_description' };
            }
        }
    }

    return null;
}
