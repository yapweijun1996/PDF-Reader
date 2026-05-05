// ============================================================
//  tools_knowledge.js — Local knowledge retrieval tool
//  Registers search_knowledge for vector-based RAG.
//  Called by registerTools() in chat_tools.js
//  References _knowledgeRetriever (set by chat_app.js) at call time.
// ============================================================

function registerKnowledgeTools(registry) {

    registry.add({
        name: 'search_knowledge',
        description: 'Search the local knowledge base about Yap Wei Jun, his projects, services, and website. Use this BEFORE web_search for questions about the site owner, GemmaClient, or the website. Returns relevant text chunks ranked by relevance.',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query about the site, owner, projects, or services' },
            top_k: { type: 'number', required: false, default: 3, description: 'Number of results to return (1-10)' }
        },
        handler: async (args) => {
            if (typeof _knowledgeRetriever === 'undefined' || !_knowledgeRetriever) {
                return { query: args.query, results: [], error: 'Knowledge base not initialized' };
            }
            if (!_knowledgeRetriever.ready) {
                const loaded = await _knowledgeRetriever.load();
                if (!loaded) {
                    return { query: args.query, results: [], error: 'Knowledge base failed to load' };
                }
            }

            const topK = Math.min(Math.max(parseInt(args.top_k) || 3, 1), 10);

            try {
                const result = await _knowledgeRetriever.search(args.query, { topK });
                return {
                    query: args.query,
                    results: result.results.map(r => ({
                        id: r.id,
                        source: r.source,
                        title: r.title,
                        text: r.text,
                        score: r.score,
                    })),
                    total: result.results.length,
                };
            } catch (e) {
                return { query: args.query, results: [], error: 'Search failed: ' + e.message };
            }
        }
    });
}
