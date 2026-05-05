#!/usr/bin/env node
// ============================================================
//  scripts/build_knowledge_embeddings.js
//  Generate vector embeddings for knowledge chunks
//  using @xenova/transformers (Transformers.js)
//
//  Usage:
//    npm install @xenova/transformers   (one-time)
//    node scripts/build_knowledge_embeddings.js
//
//  Input:  public/knowledge/chunks.json
//  Output: public/knowledge/embeddings.json
//
//  Model: Xenova/all-MiniLM-L6-v2 (22M params, ~80MB, fast)
//  Dimension: 384
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHUNKS_FILE     = join(import.meta.dirname, '..', 'public', 'knowledge', 'chunks.json');
const EMBEDDINGS_FILE = join(import.meta.dirname, '..', 'public', 'knowledge', 'embeddings.json');
const MODEL_NAME      = 'Xenova/all-MiniLM-L6-v2';

async function main() {
    // ── Load chunks ──
    if (!existsSync(CHUNKS_FILE)) {
        console.error('chunks.json not found. Run build_knowledge_chunks.js first.');
        process.exit(1);
    }
    const chunks = JSON.parse(readFileSync(CHUNKS_FILE, 'utf-8'));
    console.log(`Loaded ${chunks.length} chunks from ${CHUNKS_FILE}`);

    // ── Import Transformers.js ──
    let pipeline;
    try {
        const transformers = await import('@xenova/transformers');
        pipeline = transformers.pipeline;
    } catch (e) {
        console.error('Failed to import @xenova/transformers. Install it:\n  npm install @xenova/transformers');
        process.exit(1);
    }

    // ── Load embedding model ──
    console.log(`Loading model: ${MODEL_NAME} ...`);
    const embedder = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,  // use quantized for smaller size
    });
    console.log('Model loaded.');

    // ── Generate embeddings ──
    const embeddings = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Combine title + text for richer embedding
        const input = `${chunk.title}: ${chunk.text}`;
        const output = await embedder(input, { pooling: 'mean', normalize: true });
        // output.data is a Float32Array
        const vector = Array.from(output.data);

        embeddings.push({
            id: chunk.id,
            vector,
        });

        if ((i + 1) % 5 === 0 || i === chunks.length - 1) {
            console.log(`  ${i + 1}/${chunks.length} embedded`);
        }
    }

    // ── Write output ──
    const output = {
        model: MODEL_NAME,
        dimension: embeddings[0]?.vector.length || 384,
        count: embeddings.length,
        embeddings,
    };
    writeFileSync(EMBEDDINGS_FILE, JSON.stringify(output));
    console.log(`\n✅ ${embeddings.length} embeddings (dim=${output.dimension}) → ${EMBEDDINGS_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
