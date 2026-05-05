#!/usr/bin/env node
// ============================================================
//  scripts/build_knowledge_chunks.js
//  Parse knowledge/*.md into public/knowledge/chunks.json
//
//  Usage: node scripts/build_knowledge_chunks.js
//
//  Chunk strategy:
//    - Split on ## headings (level 2)
//    - Each section becomes one chunk
//    - Attach metadata: id, source, title, text, tags
// ============================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const KNOWLEDGE_DIR = join(import.meta.dirname, '..', 'knowledge');
const OUTPUT_DIR    = join(import.meta.dirname, '..', 'public', 'knowledge');
const OUTPUT_FILE   = join(OUTPUT_DIR, 'chunks.json');

const MAX_CHUNK_CHARS = 1500;  // hard cap per chunk

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractTags(text) {
    const tags = new Set();
    // Extract capitalized multi-word names as potential tags
    const names = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
    for (const n of names) tags.add(n);
    // Extract known keywords
    const keywords = ['GemmaClient', 'Gemma', 'Gemini', 'OODA-E', 'JavaScript', 'Python',
        'Singapore', 'AI', 'LLM', 'browser', 'IndexedDB', 'API', 'tools', 'memory',
        'Yap Wei Jun', 'open source', 'GitHub'];
    for (const kw of keywords) {
        if (text.includes(kw)) tags.add(kw);
    }
    return [...tags].slice(0, 10);
}

function parseMarkdownFile(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const sourceFile = `knowledge/${basename(filePath)}`;
    const sourceSlug = slugify(basename(filePath, '.md'));
    const chunks = [];

    // Split by ## headings
    const sections = raw.split(/^##\s+/m);
    let fileTitle = '';

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        if (!section) continue;

        // First section may contain # top-level heading
        if (i === 0) {
            const titleMatch = section.match(/^#\s+(.+)/m);
            if (titleMatch) fileTitle = titleMatch[1].trim();
            // If first section only has the # heading and nothing else, skip
            const body = section.replace(/^#\s+.+\n?/, '').trim();
            if (!body) continue;
            // Has content under the # heading (before first ##)
            const chunkId = `${sourceSlug}-000`;
            chunks.push({
                id: chunkId,
                source: sourceFile,
                title: fileTitle || sourceSlug,
                text: body.slice(0, MAX_CHUNK_CHARS),
                tags: extractTags(body),
            });
            continue;
        }

        // Extract section title from first line
        const lines = section.split('\n');
        const sectionTitle = lines[0].trim();
        const body = lines.slice(1).join('\n').trim();
        if (!body) continue;

        const chunkId = `${sourceSlug}-${String(i).padStart(3, '0')}`;
        const fullTitle = fileTitle ? `${fileTitle} > ${sectionTitle}` : sectionTitle;

        // Split oversized sections into sub-chunks
        if (body.length <= MAX_CHUNK_CHARS) {
            chunks.push({
                id: chunkId,
                source: sourceFile,
                title: fullTitle,
                text: body,
                tags: extractTags(body),
            });
        } else {
            // Split on paragraph boundaries
            const paragraphs = body.split(/\n\n+/);
            let buffer = '';
            let subIdx = 0;
            for (const para of paragraphs) {
                if (buffer.length + para.length + 2 > MAX_CHUNK_CHARS && buffer) {
                    chunks.push({
                        id: `${chunkId}-${String(subIdx).padStart(2, '0')}`,
                        source: sourceFile,
                        title: `${fullTitle} (${subIdx + 1})`,
                        text: buffer.trim(),
                        tags: extractTags(buffer),
                    });
                    buffer = '';
                    subIdx++;
                }
                buffer += (buffer ? '\n\n' : '') + para;
            }
            if (buffer.trim()) {
                chunks.push({
                    id: subIdx > 0 ? `${chunkId}-${String(subIdx).padStart(2, '0')}` : chunkId,
                    source: sourceFile,
                    title: subIdx > 0 ? `${fullTitle} (${subIdx + 1})` : fullTitle,
                    text: buffer.trim().slice(0, MAX_CHUNK_CHARS),
                    tags: extractTags(buffer),
                });
            }
        }
    }

    return chunks;
}

// ── Main ──
const mdFiles = readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md')).sort();
if (mdFiles.length === 0) {
    console.error('No .md files found in knowledge/');
    process.exit(1);
}

const allChunks = [];
for (const file of mdFiles) {
    const chunks = parseMarkdownFile(join(KNOWLEDGE_DIR, file));
    allChunks.push(...chunks);
    console.log(`  ${file}: ${chunks.length} chunks`);
}

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, JSON.stringify(allChunks, null, 2));
console.log(`\n✅ ${allChunks.length} chunks → ${OUTPUT_FILE}`);
