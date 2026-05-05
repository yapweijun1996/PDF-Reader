// ============================================================
//  test/test_knowledge_retriever.js — Unit tests for
//  src/knowledge-retriever.js (vector retrieval + cosine sim)
// ============================================================

import { KnowledgeRetriever, cosineSimilarity } from '../src/knowledge-retriever.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { assertEqual, assertTrue, assertFalse, assertGreater, group, results, resetResults, summarize } from './helpers.js';

const CHUNKS_PATH     = join(import.meta.dirname, '..', 'public', 'knowledge', 'chunks.json');
const EMBEDDINGS_PATH = join(import.meta.dirname, '..', 'public', 'knowledge', 'embeddings.json');

export async function run() {
    resetResults();
    console.log('\n🧠 test_knowledge_retriever.js');

    // ── cosineSimilarity ──
    group('cosineSimilarity');

    // Identical vectors → 1.0
    const v1 = [1, 0, 0, 0];
    assertEqual(cosineSimilarity(v1, v1), 1, 'identical vectors → 1.0');

    // Orthogonal vectors → 0.0
    const v2 = [0, 1, 0, 0];
    assertEqual(cosineSimilarity(v1, v2), 0, 'orthogonal vectors → 0.0');

    // Opposite vectors → -1.0
    const v3 = [-1, 0, 0, 0];
    assertEqual(cosineSimilarity(v1, v3), -1, 'opposite vectors → -1.0');

    // Similar vectors → high positive
    const v4 = [0.9, 0.1, 0, 0];
    const sim = cosineSimilarity(v1, v4);
    assertTrue(sim > 0.9, `similar vectors → ${sim.toFixed(3)} > 0.9`);

    // Mismatched lengths → 0
    assertEqual(cosineSimilarity([1, 0], [1, 0, 0]), 0, 'mismatched lengths → 0');

    // Empty → 0
    assertEqual(cosineSimilarity([], []), 0, 'empty vectors → 0');

    // Zero vector → 0
    assertEqual(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0, 'zero vector → 0');

    // ── KnowledgeRetriever construction ──
    group('KnowledgeRetriever construction');

    const kr = new KnowledgeRetriever();
    assertFalse(kr.ready, 'not ready before load');
    assertEqual(kr.stats.chunks, 0, 'no chunks before load');
    assertEqual(kr.stats.embeddings, 0, 'no embeddings before load');

    // ── Load from static files ──
    group('loadFromData');

    const hasFiles = existsSync(CHUNKS_PATH) && existsSync(EMBEDDINGS_PATH);
    if (!hasFiles) {
        console.log('  ⚠ Skipping data tests — run scripts/build_knowledge_chunks.js and scripts/build_knowledge_embeddings.js first');
    } else {
        const chunks = JSON.parse(readFileSync(CHUNKS_PATH, 'utf-8'));
        const embData = JSON.parse(readFileSync(EMBEDDINGS_PATH, 'utf-8'));

        kr.loadFromData(chunks, embData);
        assertTrue(kr.ready, 'ready after loadFromData');
        assertGreater(kr.stats.chunks, 0, `${kr.stats.chunks} chunks loaded`);
        assertGreater(kr.stats.embeddings, 0, `${kr.stats.embeddings} embeddings loaded`);
        assertEqual(kr.stats.chunks, kr.stats.embeddings, 'chunk count matches embedding count');
        assertEqual(kr.stats.dimension, 384, 'dimension is 384');

        // ── searchWithVector (no model needed) ──
        group('searchWithVector');

        // Use a real embedding vector from the first chunk for testing
        const firstId = chunks[0].id;
        const firstVec = new Float32Array(embData.embeddings.find(e => e.id === firstId).vector);

        // Searching with the exact vector of a chunk should return that chunk first
        const exactResult = kr.searchWithVector(firstVec, { topK: 3 });
        assertTrue(exactResult.results.length > 0, 'exact vector search returns results');
        assertEqual(exactResult.results[0].id, firstId, 'exact vector returns matching chunk first');
        assertEqual(exactResult.results[0].score, 1, 'exact vector match has score 1.0');

        // ── Top-k ordering ──
        group('top-k ordering');

        const topKResult = kr.searchWithVector(firstVec, { topK: 5 });
        assertTrue(topKResult.results.length <= 5, `topK=5 returns ≤5 results (got ${topKResult.results.length})`);
        for (let i = 1; i < topKResult.results.length; i++) {
            assertTrue(
                topKResult.results[i - 1].score >= topKResult.results[i].score,
                `result[${i - 1}].score (${topKResult.results[i - 1].score}) >= result[${i}].score (${topKResult.results[i].score})`
            );
        }

        // ── minScore filtering ──
        group('minScore filtering');

        const highThreshold = kr.searchWithVector(firstVec, { topK: 100, minScore: 0.99 });
        assertTrue(highThreshold.results.length <= 3, `minScore=0.99 filters aggressively (${highThreshold.results.length} results)`);
        for (const r of highThreshold.results) {
            assertTrue(r.score >= 0.99, `score ${r.score} >= 0.99`);
        }

        // ── Result shape ──
        group('result shape');

        const result = topKResult.results[0];
        assertTrue(typeof result.id === 'string', 'result has id (string)');
        assertTrue(typeof result.source === 'string', 'result has source (string)');
        assertTrue(typeof result.title === 'string', 'result has title (string)');
        assertTrue(typeof result.text === 'string', 'result has text (string)');
        assertTrue(typeof result.score === 'number', 'result has score (number)');
        assertTrue(result.text.length > 0, 'result text is not empty');

        // ── Random vector should return lower scores ──
        group('random vector search');

        const randomVec = new Float32Array(384);
        for (let i = 0; i < 384; i++) randomVec[i] = Math.random() * 2 - 1;
        // Normalize
        let norm = 0;
        for (let i = 0; i < 384; i++) norm += randomVec[i] * randomVec[i];
        norm = Math.sqrt(norm);
        for (let i = 0; i < 384; i++) randomVec[i] /= norm;

        const randomResult = kr.searchWithVector(randomVec, { topK: 3, minScore: 0 });
        assertTrue(randomResult.results.length > 0, 'random vector returns some results');
        assertTrue(randomResult.results[0].score < 1, `random vector top score (${randomResult.results[0].score}) < 1.0`);

        // ── Lexical boost for exact public-profile links ──
        group('lexical boost for exact public-profile links');

        const boostedKr = new KnowledgeRetriever();
        boostedKr.loadFromData(
            [
                { id: 'faq-1', source: 'knowledge/faq.md', title: 'FAQ > Contact', text: 'Public profiles also include GitHub and CodePen.' },
                { id: 'profile-1', source: 'knowledge/profile.md', title: 'Profile > Online Presence', text: '- GitHub: github.com/yapweijun1996\n- CodePen: codepen.io/yapweijun1996' },
            ],
            {
                dimension: 3,
                embeddings: [
                    { id: 'faq-1', vector: [0.9, 0, 0] },
                    { id: 'profile-1', vector: [0.6, 0, 0] },
                ],
            }
        );
        boostedKr.embed = async () => new Float32Array([1, 0, 0]);

        const boostedGithub = await boostedKr.search("What is Yap Wei Jun's GitHub?", { topK: 2, minScore: 0 });
        assertEqual(boostedGithub.results[0].id, 'profile-1', 'GitHub URL chunk outranks vague GitHub mention');
        assertTrue(boostedGithub.results[0].score > boostedGithub.results[1].score, 'GitHub URL chunk gets higher boosted score');
    }

    // ── Empty corpus ──
    group('empty corpus');

    const emptyKr = new KnowledgeRetriever();
    assertFalse(emptyKr.ready, 'empty retriever is not ready');
    const emptyResult = emptyKr.searchWithVector(new Float32Array(384));
    assertTrue(emptyResult.error !== undefined, 'empty corpus returns error');
    assertEqual(emptyResult.results.length, 0, 'empty corpus returns no results');

    // ── loadFromData with empty data ──
    group('loadFromData with empty data');

    const emptyKr2 = new KnowledgeRetriever();
    emptyKr2.loadFromData([], { dimension: 384, embeddings: [] });
    assertFalse(emptyKr2.ready, 'empty data → not ready');
    assertEqual(emptyKr2.stats.chunks, 0, 'empty data → 0 chunks');

    return summarize();
}
