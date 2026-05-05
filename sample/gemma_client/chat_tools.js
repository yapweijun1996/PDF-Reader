// ============================================================
//  chat_tools.js — Tool registration orchestrator
//  Delegates to: tools_search.js, tools_data.js, tools_compute.js,
//                tools_language.js, tools_memory.js
//  Depends on: MemoryDB (chat_memory.js), registry (chat_app.js)
// ============================================================

function registerTools(registry, clog) {
    registerSearchTools(registry);
    registerDataTools(registry);
    registerComputeTools(registry);
    registerLanguageTools(registry);
    registerMemoryTools(registry);
    if (typeof registerKnowledgeTools === 'function') registerKnowledgeTools(registry);

    clog('info', `Registered ${registry.size} tools: ${registry.list().map(t=>t.name).join(', ')}`);
}
