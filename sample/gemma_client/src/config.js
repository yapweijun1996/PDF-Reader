// ============================================================
//  config.js — HarnessConfig: centralized configuration
//  All hardcoded values in one place for easy tuning.
//  Use HarnessConfig.load(overrides) for per-deployment customization.
// ============================================================

const HarnessConfig = {
    // ── API ──
    api: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
        model: 'gemma-3-27b-it',
        retry: { maxRetries: 5, baseDelay: 1000 }
    },

    // ── Key Management ──
    keys: {
        rotateEveryN: 1,
        seed: '20250710'
    },

    // ── Generation Configs (per phase) ──
    generation: {
        // Default for GemmaAPI client (creative, general chat)
        client: { temperature: 1, topP: 0.95, topK: 40, responseMimeType: 'text/plain' },
        // Default for OODA-E helper model calls (focused, lower temp)
        helper: { temperature: 0.3, topP: 0.9, topK: 20, responseMimeType: 'text/plain' },
        // Deterministic phases — OBSERVE, CLASSIFY, DECIDE, DECIDE simplified, EVALUATE, DECOMPOSE
        deterministic: { temperature: 0.1, topP: 0.8, topK: 10, responseMimeType: 'text/plain' },
        // Creative phases — DIRECT_RESPONSE, FORCE_FINAL_ANSWER
        creative: { temperature: 0.7, topP: 0.95, topK: 40, responseMimeType: 'text/plain' }
    },

    // ── Agent Loop Thresholds ──
    agent: {
        maxLoops: 3,
        maxActIterations: 5,
        toolRunnerMaxIterations: 5
    },

    // ── Context & Compaction ──
    context: {
        compactThreshold: 99000,
        charsPerToken: 3.5,
        keepRecent: 10,
        observeRecentMessages: 6,
        evaluateRecentMessages: 10,
        knownAnswersMax: 3,
        recentContextMultiplier: 2
    },

    // ── Truncation Limits ──
    truncation: {
        fetchUrlContent: 2000,        // _evaluate: fetched page content cap
        toolResultJson: 1500,         // _evaluate: JSON result display cap
        forceAnswerResult: 300,       // _forceFinalAnswer: result per tool
        workspaceAnswer: 500,         // _saveToWorkspace: answer cap
        subagentFetchContent: 1000,   // _runSubAgents: fetch content cap
        subagentResultJson: 500,      // _runSubAgents: JSON result cap
        errorText: 200,               // client.js: API error text cap
        recentContextMessage: 200,    // _getRecentContext: message text cap
        knownAnswerText: 200,         // _extractKnownAnswers: answer text cap
        resultRankingText: 3000,      // _rankByRelevance: result text cap
        entityMatchPrefix: 10,        // entity matching prefix length
        entityMatchLong: 12,          // entity matching longer prefix
        topicMatchPrefix: 15,         // topic string matching prefix
        queryMaxWords: 8,             // _shortenQuery: max words (P29b: increased from 6)
        entityCap: 10,               // max entities after dedup
        toolDescLength: 80,          // _buildToolDefsCompact: description cap
        searchMaxResults: 10,        // web_search: max results
        fetchUrlMaxLength: 15000,    // fetch_url: default max_length
        visionFallbackThreshold: 300 // fetch_url: use screenshot vision when content < this
    },

    // ── Service URLs ──
    services: {
        search: {
            searxng: 'https://search.yapweijun1996.com/search',
            ddg: 'https://api.duckduckgo.com/',
            readUrl: 'https://readurl.b1122333.com/read-url',
            readUrlApiKey: null,
            readUrlTimeoutMs: 8000,
            directFetchTimeoutMs: 5000
        },
        knowledge: {
            wikipedia: 'https://en.wikipedia.org/api/rest_v1/page/summary/',
            wikidata: 'https://www.wikidata.org/w/api.php',
            openLibrary: 'https://openlibrary.org/search.json',
            crossRef: 'https://api.crossref.org/works',
            stackExchange: 'https://api.stackexchange.com/2.3/search'
        },
        data: {
            timeApi: 'https://timeapi.io/api/time/current/zone',
            nominatim: 'https://nominatim.openstreetmap.org/search',
            openMeteo: 'https://api.open-meteo.com/v1/forecast',
            frankfurter: 'https://api.frankfurter.app/latest',
            coinGecko: 'https://api.coingecko.com/api/v3/simple/price',
            restCountries: 'https://restcountries.com/v3.1/name/',
            worldBank: 'https://api.worldbank.org/v2/country/',
            hackerNews: 'https://hacker-news.firebaseio.com/v0',
            ipApi: 'https://ipwho.is/',
            bigDataCloud: 'https://api.bigdatacloud.net/data/reverse-geocode-client'
        },
        language: {
            dictionary: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
            joke: 'https://official-joke-api.appspot.com/random_joke',
            advice: 'https://api.adviceslip.com/advice',
            mathJs: 'https://api.mathjs.org/v4/'
        }
    },

    // ── Policies ──
    policies: {
        searchTools: ['web_search', 'fetch_url', 'summarize_url'],
        skipExtensions: /\.(pdf|jpg|jpeg|png|gif|svg|mp4|mp3|zip|doc|docx|xls|xlsx)(\?|$)/i,
        skipSites: /(facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com|reddit\.com\/r\/|zhihu\.com)/i,
        preferredDomains: [
            'wikipedia.org', 'britannica.com', 'github.com', 'stackoverflow.com',
            'developer.mozilla.org', 'docs.python.org', 'nodejs.org',
            'npmjs.com', 'pypi.org', 'w3.org'
        ],
        langAliases: {
            chinese: 'mandarin', '中文': 'mandarin', '华语': 'mandarin',
            bahasa: 'malay', '日本語': 'japanese'
        }
    },

    // ── Model Routing ──
    routing: {
        fast: null,                          // e.g. 'gemma-3-4b-it' — null = use API default
        default: null,                       // e.g. 'gemma-3-27b-it' — null = use API default
        strong: null,                        // e.g. 'gemini-2.0-flash' — null = use API default
        escalateOnLowConfidence: true,
        phaseMap: {}                         // override per-phase tier, e.g. { observe: 'default' }
    },

    // ── Learning System ──
    learning: {
        maxHistory: 500,                         // max outcome records
        minPatterns: 5,                          // min samples before recommending
        skillThreshold: 5,                       // tool combo occurrences to auto-skill
        maxPatterns: 50,                         // max cached patterns
        discoveryInterval: 300000                // ms between auto-discovery (5 min)
    },

    // ── Proactive Engine ──
    proactive: {
        tickInterval: 60000,                     // ms between tick() calls
        conditionCooldown: 3600000,              // ms — cooldown between condition re-checks (1 hour)
        safeActions: ['search', 'weather', 'time', 'news', 'briefing', 'notify'],
        maxResults: 50                           // max stored proactive results
    },

    // ── Workspace Thresholds ──
    workspace: {
        maxWordCount: 10,
        ackMaxWords: 4,
        entityCoverageThreshold: 0.5,
        recentTopicsFetch: 10,          // P27: increased from 5 for better follow-up resolution
        recentTopicsExtended: 20,       // P27: two-pass search fallback window
        entityCap: 10
    },

    // ── Runtime Override ──
    load(overrides) {
        if (!overrides || typeof overrides !== 'object') return;
        _deepMerge(this, overrides);
    }
};

function _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (key === 'load') continue; // don't overwrite the method
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && !(source[key] instanceof RegExp)) {
            if (!target[key] || typeof target[key] !== 'object') target[key] = {};
            _deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
}

export { HarnessConfig };
