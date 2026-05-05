// ============================================================
//  chat_utils.js — Pure utility functions
//  No dependencies on other chat_* modules at load time.
//  References $console (from chat_app.js) at call time.
// ============================================================

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function deepClone(o) { try { return JSON.parse(JSON.stringify(o)); } catch { return o; } }

// --- Thinking block parser ---
function extractThinking(text) {
    const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const thinking = match ? match[1].trim() : null;
    const cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    return { thinking, cleaned };
}

function renderThinkingBlock(thinkingText, durationSec) {
    if (!thinkingText) return '';
    const durStr = durationSec ? `${Math.round(durationSec)}s` : '';
    const summary = durStr ? `Thought for ${durStr}` : 'Thought process';
    return `<details class="thinking-block"><summary><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="10" y1="22" x2="14" y2="22"/></svg><span>${summary}</span></summary><div class="thinking-content">${esc(thinkingText)}</div></details>`;
}

// Configure marked.js
(function initMarked() {
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,       // GFM line breaks
            gfm: true,          // GitHub Flavored Markdown
            headerIds: false,   // no auto IDs on headings
            mangle: false,      // don't mangle email addresses
        });
        // Sanitize HTML output — strip dangerous tags
        const renderer = new marked.Renderer();
        const origLink = renderer.link.bind(renderer);
        renderer.link = function(href, title, text) {
            // Handle marked v5+ object arg and v4 separate args
            if (typeof href === 'object') { title = href.title; text = href.text; href = href.href; }
            const html = `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
            return html;
        };
        marked.use({ renderer });
    }
})();

function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        try { return marked.parse(text); } catch {}
    }
    // Fallback if marked fails to load
    let h = esc(text);
    h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => `<pre>${code.trim()}</pre>`);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\n\n/g, '</p><p>');
    h = h.replace(/\n/g, '<br>');
    return '<p>' + h + '</p>';
}

// ===== Console Log =====
function clog(level, msg) {
    const t = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-' + level;
    line.textContent = `[${t}] ${msg}`;
    $console.appendChild(line);
    $console.scrollTop = $console.scrollHeight;
}

function toggleConsole() {
    $console.style.display = $console.style.display === 'none' ? 'block' : 'none';
}

// ===== Debug Proxy =====
function createDebugProxy(realApi) {
    return {
        generateContent: async function(opts) {
            S.debug.lastRequest = deepClone({ contents: opts.contents, model: opts.model || realApi.model, generationConfig: opts.generationConfig || realApi.generationConfig });
            const t0 = performance.now();
            const result = await realApi.generateContent(opts);
            const ms = performance.now() - t0;
            S.debug.lastTiming = { ms: Math.round(ms) };
            S.debug.lastResponse = deepClone(result);
            S.debug.lastTokens = result.usageMetadata || null;
            clog('debug', `API call: ${Math.round(ms)}ms` + (result.usageMetadata ? ` | ${result.usageMetadata.totalTokenCount || '?'} tokens` : ''));
            return result;
        },
        keyManager: realApi.keyManager,
        model: realApi.model,
        generationConfig: realApi.generationConfig,
    };
}
