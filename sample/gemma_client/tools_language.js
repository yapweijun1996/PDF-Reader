// ============================================================
//  tools_language.js — Language & fun tools (4 tools)
//  Called by registerTools() in chat_tools.js
// ============================================================

function registerLanguageTools(registry) {
    const _svc = (typeof GemmaClient !== 'undefined' && GemmaClient.HarnessConfig) ? GemmaClient.HarnessConfig.services : null;

    // --- Translate via SearXNG ---
    registry.add({
        name: 'translate',
        description: 'Translate text between languages using web search.',
        parameters: { text:{type:'string',required:true}, from:{type:'string',required:false,default:'auto'}, to:{type:'string',required:true} },
        handler: async (args) => {
            const res = await fetch(`${_svc?.search?.searxng || 'https://search.yapweijun1996.com/search'}?q=${encodeURIComponent(`translate "${args.text}" from ${args.from} to ${args.to}`)}&format=json`);
            if (!res.ok) throw new Error('Translation lookup failed');
            const data = await res.json();
            return { text:args.text, from:args.from, to:args.to, answers:data.answers||[], search_results:(data.results||[]).slice(0,3).map(r=>({title:r.title,snippet:r.content})) };
        }
    });

    // --- Dictionary ---
    registry.add({
        name: 'dictionary',
        description: 'Look up the definition, phonetics, and examples of an English word.',
        parameters: { word: { type: 'string', required: true, description: 'English word to look up' } },
        handler: async (args) => {
            const res = await fetch(`${_svc?.language?.dictionary || 'https://api.dictionaryapi.dev/api/v2/entries/en/'}${encodeURIComponent(args.word)}`);
            if (!res.ok) throw new Error('Word not found: ' + args.word);
            const data = await res.json();
            const entry = data[0];
            return { word: entry.word, phonetic: entry.phonetic || '', meanings: entry.meanings.map(m => ({ partOfSpeech: m.partOfSpeech, definitions: m.definitions.slice(0, 3).map(d => ({ definition: d.definition, example: d.example || null })) })), source: entry.sourceUrls?.[0] || '' };
        }
    });

    // --- Joke ---
    registry.add({ name: 'joke', description: 'Get a random joke.', parameters: {},
        handler: async () => { const res = await fetch(_svc?.language?.joke || 'https://official-joke-api.appspot.com/random_joke'); if (!res.ok) throw new Error('Joke API error'); const d = await res.json(); return { type: d.type, setup: d.setup, punchline: d.punchline }; }
    });

    // --- Advice ---
    registry.add({ name: 'advice', description: 'Get a random piece of life advice.', parameters: {},
        handler: async () => { const res = await fetch(_svc?.language?.advice || 'https://api.adviceslip.com/advice'); if (!res.ok) throw new Error('Advice API error'); const d = await res.json(); return { id: d.slip.id, advice: d.slip.advice }; }
    });
}
