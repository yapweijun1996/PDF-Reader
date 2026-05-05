// ============================================================
//  knowledge-retriever.js — Browser-side vector knowledge retrieval
//
//  Loads pre-built chunks + embeddings from static JSON files,
//  generates query embeddings at runtime via Transformers.js (CDN),
//  and returns top-k most relevant chunks by cosine similarity.
//
//  Design:
//    - Chunks: public/knowledge/chunks.json (text + metadata)
//    - Embeddings: public/knowledge/embeddings.json (384-dim vectors)
//    - Query embedding: Xenova/all-MiniLM-L6-v2 loaded from HF CDN
//    - Similarity: cosine similarity computed in pure JS
//    - Fully browser-side, no server required
// ============================================================

const DEFAULT_CHUNKS_URL     = './public/knowledge/chunks.json';
const DEFAULT_EMBEDDINGS_URL = './public/knowledge/embeddings.json';
const DEFAULT_MODEL          = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_TOP_K          = 3;
const DEFAULT_MIN_SCORE      = 0.25;
const QUERY_STOPWORDS        = new Set([
    'a', 'an', 'and', 'are', 'at', 'can', 'do', 'does', 'for', 'have', 'he', 'her',
    'his', 'how', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'she',
    'tell', 'the', 'their', 'there', 'they', 'to', 'what', 'where', 'who', 'with',
    'you', 'your',
]);

// ── Cosine similarity ──
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
}

export { cosineSimilarity };

function _tokenizeQuery(query) {
    const tokens = String(query || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || [];
    return tokens.filter(t => t.length >= 2 && !QUERY_STOPWORDS.has(t));
}

function _lexicalBoost(query, chunk) {
    const q = String(query || '').toLowerCase();
    const title = String(chunk.title || '').toLowerCase();
    const text = String(chunk.text || '').toLowerCase();
    const tags = Array.isArray(chunk.tags) ? chunk.tags.map(t => String(t).toLowerCase()) : [];
    const tokens = _tokenizeQuery(query);

    let boost = 0;

    for (const token of tokens) {
        if (title.includes(token)) boost += 0.05;
        else if (text.includes(token)) boost += 0.02;
        if (tags.some(tag => tag.includes(token))) boost += 0.04;
    }

    // Exact-profile questions should strongly prefer chunks that contain the actual public link.
    if (q.includes('github')) {
        if (/github\.com\/[^\s)]+/i.test(text)) boost += 0.35;
        else if (/\bgithub\b/i.test(text)) boost += 0.03;
    }
    if (q.includes('codepen')) {
        if (/codepen\.io\/[^\s)]+/i.test(text)) boost += 0.35;
        else if (/\bcodepen\b/i.test(text)) boost += 0.03;
    }
    if (q.includes('website') || q.includes('site')) {
        if (/yapweijun1996\.com/i.test(text)) boost += 0.28;
    }

    return boost;
}

export class KnowledgeRetriever {
    constructor(opts = {}) {
        this.chunksUrl     = opts.chunksUrl     || DEFAULT_CHUNKS_URL;
        this.embeddingsUrl = opts.embeddingsUrl  || DEFAULT_EMBEDDINGS_URL;
        this.modelName     = opts.modelName      || DEFAULT_MODEL;
        this.topK          = opts.topK           || DEFAULT_TOP_K;
        this.minScore      = opts.minScore       ?? DEFAULT_MIN_SCORE;

        // State
        this._chunks     = null;   // Array<{id, source, title, text, tags}>
        this._embeddings = null;   // Map<id → Float32Array>
        this._dimension  = 0;
        this._embedder   = null;   // Transformers.js pipeline (lazy-loaded)
        this._loading    = null;   // Promise for concurrent load protection
        this._modelLoading = null;
    }

    // ── Load chunks + embeddings from static JSON ──
    async load() {
        if (this._chunks && this._embeddings) return true;
        if (this._loading) return this._loading;

        this._loading = this._doLoad();
        const ok = await this._loading;
        this._loading = null;
        return ok;
    }

    async _doLoad() {
        try {
            const [chunksRes, embRes] = await Promise.all([
                fetch(this.chunksUrl),
                fetch(this.embeddingsUrl),
            ]);
            if (!chunksRes.ok || !embRes.ok) {
                console.warn('KnowledgeRetriever: failed to load data files');
                return false;
            }
            const chunksData = await chunksRes.json();
            const embData    = await embRes.json();

            this._chunks = chunksData;
            this._dimension = embData.dimension || 384;

            // Build id → vector map
            this._embeddings = new Map();
            for (const entry of embData.embeddings) {
                this._embeddings.set(entry.id, new Float32Array(entry.vector));
            }

            return true;
        } catch (e) {
            console.warn('KnowledgeRetriever: load failed:', e.message);
            return false;
        }
    }

    // ── Lazy-load the embedding model from CDN ──
    async _loadModel() {
        if (this._embedder) return;
        if (this._modelLoading) { await this._modelLoading; return; }

        this._modelLoading = (async () => {
            // Dynamically import Transformers.js from CDN
            // Works in browser via ES module import from jsdelivr
            const { pipeline } = await import(
                /* webpackIgnore: true */
                'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
            );
            this._embedder = await pipeline('feature-extraction', this.modelName, {
                quantized: true,
            });
        })();

        await this._modelLoading;
        this._modelLoading = null;
    }

    // ── Generate query embedding ──
    async embed(text) {
        await this._loadModel();
        const output = await this._embedder(text, { pooling: 'mean', normalize: true });
        return new Float32Array(output.data);
    }

    // ── Search: embed query → cosine similarity → top-k ──
    async search(query, opts = {}) {
        const topK     = opts.topK     ?? this.topK;
        const minScore = opts.minScore ?? this.minScore;

        // Ensure data is loaded
        const loaded = await this.load();
        if (!loaded || !this._chunks || this._chunks.length === 0) {
            return { query, results: [], error: 'Knowledge base not loaded' };
        }

        // Generate query embedding
        let queryVec;
        try {
            queryVec = await this.embed(query);
        } catch (e) {
            return { query, results: [], error: 'Embedding model failed: ' + e.message };
        }

        // Compute similarities
        const scored = [];
        for (const chunk of this._chunks) {
            const docVec = this._embeddings.get(chunk.id);
            if (!docVec) continue;
            const score = cosineSimilarity(queryVec, docVec);
            if (score >= minScore) {
                const boostedScore = Math.min(1, score + _lexicalBoost(query, chunk));
                scored.push({ ...chunk, score: Math.round(boostedScore * 1000) / 1000 });
            }
        }

        // Sort descending and take top-k
        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, topK);

        return { query, results };
    }

    // ── Static search without runtime embedding (pre-computed query vectors) ──
    // Used for testing or when the embedding model cannot load
    searchWithVector(queryVec, opts = {}) {
        const topK     = opts.topK     ?? this.topK;
        const minScore = opts.minScore ?? this.minScore;

        if (!this._chunks || this._chunks.length === 0) {
            return { results: [], error: 'Knowledge base not loaded' };
        }

        const scored = [];
        for (const chunk of this._chunks) {
            const docVec = this._embeddings.get(chunk.id);
            if (!docVec) continue;
            const score = cosineSimilarity(queryVec, docVec);
            if (score >= minScore) {
                scored.push({ ...chunk, score: Math.round(score * 1000) / 1000 });
            }
        }

        scored.sort((a, b) => b.score - a.score);
        return { results: scored.slice(0, topK) };
    }

    // ── Check if loaded and ready ──
    get ready() {
        return !!(this._chunks && this._embeddings && this._chunks.length > 0);
    }

    // ── Stats ──
    get stats() {
        return {
            chunks: this._chunks?.length || 0,
            embeddings: this._embeddings?.size || 0,
            dimension: this._dimension,
            modelLoaded: !!this._embedder,
        };
    }

    // ── Load data from pre-parsed objects (for testing / Node.js) ──
    loadFromData(chunks, embeddingsData) {
        this._chunks = chunks;
        this._dimension = embeddingsData.dimension || 384;
        this._embeddings = new Map();
        for (const entry of embeddingsData.embeddings) {
            this._embeddings.set(entry.id, new Float32Array(entry.vector));
        }
    }
}
