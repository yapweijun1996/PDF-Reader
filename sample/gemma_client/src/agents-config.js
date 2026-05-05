// ============================================================
//  agents-config.js — AGENTS.md persona & policy loader
//  Parses a workspace-level AGENTS.md into structured config
//  that influences model behavior in simple mode and tool mode.
//
//  Supported sections:
//    ## Role       — persona / system role
//    ## Behavior   — behavioral guidelines (bullet list)
//    ## Language   — language rules (bullet list)
//    ## Tool Policy — tool usage rules (bullet list)
//    ## Forbidden  — things the model must not do (bullet list)
//
//  Missing file or sections are no-ops (safe default).
// ============================================================

const SECTION_KEYS = ['role', 'behavior', 'language', 'toolpolicy', 'forbidden'];

/**
 * Normalize a markdown heading to a section key.
 * "## Tool Policy" → "toolpolicy", "## Forbidden" → "forbidden"
 */
function _headingToKey(heading) {
    return heading.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Parse bullet items from a markdown block.
 * Each line starting with "- " or "* " becomes one item.
 * Non-bullet lines are joined as a paragraph (for Role section).
 */
function _parseBullets(lines) {
    const bullets = [];
    const prose = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
        if (bulletMatch) {
            bullets.push(bulletMatch[1].trim());
        } else {
            prose.push(trimmed);
        }
    }
    return { bullets, prose: prose.join(' ').trim() };
}

/**
 * Parse AGENTS.md content into structured config.
 * @param {string} markdown — raw AGENTS.md content
 * @returns {AgentsConfig}
 */
export function parseAgentsMd(markdown) {
    const config = {
        role: '',
        behavior: [],
        language: [],
        toolPolicy: [],
        forbidden: [],
        _raw: markdown || '',
    };

    if (!markdown || typeof markdown !== 'string') return config;

    // Split into sections by ## headings
    const lines = markdown.split('\n');
    let currentKey = null;
    let currentLines = [];

    const flush = () => {
        if (!currentKey) return;
        const { bullets, prose } = _parseBullets(currentLines);
        switch (currentKey) {
            case 'role':
                config.role = prose || bullets.join(' ');
                break;
            case 'behavior':
                config.behavior = bullets;
                break;
            case 'language':
                config.language = bullets;
                break;
            case 'toolpolicy':
                config.toolPolicy = bullets;
                break;
            case 'forbidden':
                config.forbidden = bullets;
                break;
        }
        currentLines = [];
    };

    for (const line of lines) {
        // Match ## headings (level 2) — ignore # AGENTS.md (level 1)
        const headingMatch = line.match(/^##\s+(.+)/);
        if (headingMatch) {
            flush();
            const key = _headingToKey(headingMatch[1]);
            currentKey = SECTION_KEYS.includes(key) ? key : null;
            continue;
        }
        // Skip level-1 heading
        if (/^#\s+/.test(line)) continue;
        if (currentKey) currentLines.push(line);
    }
    flush();

    return config;
}

/**
 * Build a compact prompt block from parsed AGENTS.md config.
 * Returns empty string if config is empty (no-op).
 * @param {AgentsConfig} config
 * @param {object} [opts]
 * @param {'simple'|'tool'} [opts.mode='tool'] — injection context
 * @returns {string}
 */
export function buildAgentsPromptBlock(config, opts = {}) {
    if (!config) return '';
    const mode = opts.mode || 'tool';
    const parts = [];

    if (config.role) {
        parts.push(`[ROLE] ${config.role}`);
    }
    if (config.behavior.length > 0) {
        parts.push(`[BEHAVIOR]\n${config.behavior.map(b => `- ${b}`).join('\n')}`);
    }
    if (config.language.length > 0) {
        parts.push(`[LANGUAGE]\n${config.language.map(l => `- ${l}`).join('\n')}`);
    }
    if (mode === 'tool' && config.toolPolicy.length > 0) {
        parts.push(`[TOOL POLICY]\n${config.toolPolicy.map(t => `- ${t}`).join('\n')}`);
    }
    if (config.forbidden.length > 0) {
        parts.push(`[FORBIDDEN — you must NEVER do these]\n${config.forbidden.map(f => `- ${f}`).join('\n')}`);
    }

    if (parts.length === 0) return '';
    return `[AGENTS.md persona & policy]\n${parts.join('\n')}`;
}

/**
 * Load and parse AGENTS.md from a URL (browser fetch).
 * Returns empty config on any error (silent no-op).
 * @param {string} [url='./AGENTS.md']
 * @returns {Promise<AgentsConfig>}
 */
export async function loadAgentsMd(url) {
    const target = url || './AGENTS.md';
    try {
        const res = await fetch(target);
        if (!res.ok) return parseAgentsMd('');
        const text = await res.text();
        return parseAgentsMd(text);
    } catch {
        return parseAgentsMd('');
    }
}

/**
 * Check if config has any meaningful content.
 * @param {AgentsConfig} config
 * @returns {boolean}
 */
export function hasAgentsConfig(config) {
    if (!config) return false;
    return !!(
        config.role ||
        config.behavior.length > 0 ||
        config.language.length > 0 ||
        config.toolPolicy.length > 0 ||
        config.forbidden.length > 0
    );
}

/**
 * Detect whether a user query is about the site/owner domain
 * (should prefer search_knowledge over web_search).
 * @param {string} text — user message
 * @param {AgentsConfig} [config] — optional config for role-based keywords
 * @returns {boolean}
 */
// ── Static keywords for site-domain detection ──
const _SITE_KEYWORDS = [
    'yap wei jun', 'yapweijun', 'wei jun', 'site owner', 'website owner',
    'gemmaclient', 'gemma client', 'gemma-jsonl',
    'your service', 'your project', 'your portfolio', 'your work',
    'this site', 'this website', 'about you', 'who are you',
    'contact', 'hire', 'engage', 'service', 'consulting',
    // Platform / profile keywords
    'github', 'codepen', 'portfolio', 'his profile', 'her profile',
    'your profile', 'his github', 'his codepen', 'his repo',
    'does he have', 'does she have',
    // CJK equivalents
    '你是谁', '这个网站', '你的服务', '你的项目', '联系', '网站',
    '站长', '创始人', '开发者',
    // CJK pronoun + service/project patterns (about the site owner)
    '他提供', '她提供', '提供什么服务', '提供什么项目',
    '什么服务', '什么项目', '他的服务', '她的服务', '他的项目', '她的项目',
];

// ── Dynamic keywords extracted from loaded knowledge chunks ──
// Set via registerKnowledgeKeywords() after chunks load.
let _knowledgeKeywords = [];

/**
 * Register additional keywords extracted from knowledge chunks.
 * Called once after KnowledgeRetriever loads chunk data.
 * @param {Array<{id, source, title, text, tags}>} chunks
 */
export function registerKnowledgeKeywords(chunks) {
    if (!chunks || chunks.length === 0) { _knowledgeKeywords = []; return; }
    const keywords = new Set();
    for (const chunk of chunks) {
        // Extract project/section names from chunk titles
        // e.g. "Projects > ScreenClip Pro" → "screenclip pro"
        const title = (chunk.title || '').replace(/^.*>\s*/, '').trim();
        if (title.length >= 3) keywords.add(title.toLowerCase());
        // Extract multi-word proper nouns from text (capitalized sequences)
        const nouns = (chunk.text || '').match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)+\b/g) || [];
        for (const n of nouns) {
            if (n.length >= 5) keywords.add(n.toLowerCase());
        }
        // Add tags
        for (const tag of (chunk.tags || [])) {
            if (tag.length >= 3) keywords.add(tag.toLowerCase());
        }
    }
    // Filter out overly generic terms
    const GENERIC = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'about', 'what']);
    _knowledgeKeywords = [...keywords].filter(k => !GENERIC.has(k));
}

export function isSiteDomainQuery(text, config) {
    if (!text) return false;
    const t = text.toLowerCase();

    // Static keywords
    for (const kw of _SITE_KEYWORDS) {
        if (t.includes(kw)) return true;
    }

    // Dynamic knowledge keywords (project names, entities from chunks)
    for (const kw of _knowledgeKeywords) {
        if (t.includes(kw)) return true;
    }

    // Role-based detection: if persona mentions a name/brand, match it too
    if (config?.role) {
        // Extract key proper nouns from role (capitalized words in original)
        const properNouns = (config._raw || '').match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
        for (const noun of properNouns) {
            if (noun.length >= 3 && t.includes(noun.toLowerCase())) return true;
        }
    }

    return false;
}

/**
 * Detect whether a query asks for private/personal info that should
 * NEVER be answered from external web search — only from local knowledge.
 * If local knowledge doesn't have it, the answer is "not available."
 *
 * This is stricter than isSiteDomainQuery: it identifies queries that
 * are specifically about unpublished personal data.
 * @param {string} text
 * @returns {boolean}
 */
export function isPrivateInfoQuery(text) {
    if (!text) return false;
    const t = text.toLowerCase();

    const PRIVATE_PATTERNS = [
        // English
        /private\s+(?:phone|number|email|address|contact)/,
        /personal\s+(?:phone|number|email|address|contact|info)/,
        /home\s+address/,
        /phone\s+number/,
        /(?:his|her|their|your)\s+(?:phone|number|email|address|salary|income|age|birthday)/,
        /secret|password|credential|ssn|social security|bank account|credit card/,
        // Chinese
        /私人(?:电话|手机|号码|邮箱|地址|联系)/,
        /个人(?:电话|手机|号码|邮箱|地址|信息)/,
        /家庭地址|家里地址/,
        /手机号|电话号/,
        /(?:他|她|你)的(?:电话|手机|号码|邮箱|地址|薪[资水]|收入|年龄|生日)/,
        /密码|银行账[户号]|信用卡/,
    ];

    return PRIVATE_PATTERNS.some(p => p.test(t));
}

/**
 * Extract the default reply language from AGENTS.md Language section.
 * Returns a normalized language name or null if not specified.
 * @param {AgentsConfig} config
 * @returns {string|null} — e.g. 'mandarin', 'english', 'malay', 'japanese', or null
 */
export function getAgentsDefaultLanguage(config) {
    if (!config || config.language.length === 0) return null;

    const LANG_MAP = {
        mandarin: 'mandarin', '中文': 'mandarin', chinese: 'mandarin', '华语': 'mandarin',
        english: 'english',
        malay: 'malay', 'bahasa': 'malay', 'bahasa melayu': 'malay',
        japanese: 'japanese', '日本語': 'japanese', '日本语': 'japanese',
        korean: 'korean', '한국어': 'korean',
    };

    // Scan language rules for "Reply in X", "default X", etc.
    for (const rule of config.language) {
        const lower = rule.toLowerCase();
        // Match "reply in X by default" or "reply in X unless..."
        const match = lower.match(/(?:reply|respond|answer|write)\s+(?:in\s+)?(\S+(?:\s+\S+)?)\s+(?:by default|unless|only)/);
        if (match) {
            const candidate = match[1].trim();
            if (LANG_MAP[candidate]) return LANG_MAP[candidate];
        }
        // Match "default language: X" or "default: X"
        const defaultMatch = lower.match(/default(?:\s+language)?[\s:]+(\S+)/);
        if (defaultMatch && LANG_MAP[defaultMatch[1]]) return LANG_MAP[defaultMatch[1]];
    }

    // Fallback: check if any language name appears in any rule
    for (const rule of config.language) {
        const lower = rule.toLowerCase();
        for (const [key, val] of Object.entries(LANG_MAP)) {
            if (lower.includes(key)) return val;
        }
    }

    return null;
}

/**
 * Build no-fabrication fallback text from persona config.
 * Used when search_knowledge finds no results.
 * @param {AgentsConfig} config
 * @param {string} [language='english']
 * @returns {string}
 */
export function buildNoKnowledgeFallback(config, language) {
    const lang = (language || 'english').toLowerCase();
    if (lang === 'mandarin') {
        return '抱歉，我目前没有关于这个问题的信息。建议您访问 yapweijun1996.com 了解更多详情，或通过网站联系方式直接咨询。';
    }
    if (lang === 'malay') {
        return 'Maaf, saya tidak mempunyai maklumat mengenai perkara ini. Sila layari yapweijun1996.com untuk maklumat lanjut.';
    }
    if (lang === 'japanese') {
        return '申し訳ございませんが、この件に関する情報を持っておりません。詳細は yapweijun1996.com をご覧ください。';
    }
    return 'I don\'t have that information available. Please visit yapweijun1996.com for more details or reach out through the contact page.';
}

/**
 * @typedef {object} AgentsConfig
 * @property {string}   role         — persona / system role
 * @property {string[]} behavior     — behavioral guidelines
 * @property {string[]} language     — language rules
 * @property {string[]} toolPolicy   — tool usage rules
 * @property {string[]} forbidden    — things the model must not do
 * @property {string}   _raw         — original markdown
 */
