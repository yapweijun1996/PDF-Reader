// ============================================================
//  tools_memory.js — Persistent memory CRUD tools (4 tools)
//  Called by registerTools() in chat_tools.js
//  References MemoryDB (from chat_memory.js) at call time.
// ============================================================

function registerMemoryTools(registry) {

    registry.add({
        name: 'save_memory',
        description: 'Save information to persistent memory (IndexedDB). Use to remember user preferences, facts, names. Persists across sessions.',
        parameters: { key:{type:'string',required:true,description:'e.g. "user_name"'}, value:{type:'string',required:true}, category:{type:'string',required:false,default:'general',enum:['general','user_profile','preferences','facts','tasks','notes']} },
        handler: async (args) => { await MemoryDB.saveMemory(args.key, args.value, args.category||'general'); return {saved:true,key:args.key,value:args.value,category:args.category||'general'}; }
    });

    registry.add({
        name: 'recall_memory',
        description: 'Search persistent memory for previously saved information.',
        parameters: { query:{type:'string',required:true} },
        handler: async (args) => { const r=await MemoryDB.searchMemories(args.query); return {query:args.query,found:r.length,memories:r.map(m=>({key:m.key,value:m.value,category:m.category,saved_at:new Date(m.timestamp).toLocaleString()}))}; }
    });

    registry.add({
        name: 'list_memories',
        description: 'List all saved memories.',
        parameters: { category:{type:'string',required:false} },
        handler: async (args) => { let m=await MemoryDB.getAllMemories(); if(args.category)m=m.filter(x=>x.category===args.category); return {total:m.length,memories:m.map(x=>({key:x.key,value:x.value,category:x.category,saved_at:new Date(x.timestamp).toLocaleString()}))}; }
    });

    registry.add({
        name: 'delete_memory',
        description: 'Delete a specific memory by key.',
        parameters: { key:{type:'string',required:true} },
        handler: async (args) => { await MemoryDB.deleteMemory(args.key); return {deleted:true,key:args.key}; }
    });
}
