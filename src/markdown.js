// Lightweight markdown rendering for translated paragraphs.
// LLMs commonly emit markdown tables / bold / lists when translating
// structured content; rendering them produces much better readability.
// Sanitized via DOMPurify so any HTML embedded in LLM output is safe.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false
});

/**
 * Render a translated text fragment as sanitized HTML. Returns the
 * original text wrapped in a paragraph if it contains no markdown
 * structure, otherwise returns rendered HTML.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const html = marked.parse(String(text));
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'code', 'pre',
                   'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4',
                   'table', 'thead', 'tbody', 'tr', 'td', 'th',
                   'a', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'class']
  });
}

/**
 * Detect whether a string looks like it has markdown structure worth
 * rendering. Used to skip the heavier render for plain paragraphs.
 */
export function looksLikeMarkdown(text) {
  if (!text) return false;
  // Markdown table separator
  if (/^\s*\|.*\|.*$/m.test(text) && /^\s*\|?\s*-+\s*\|/m.test(text)) return true;
  // Bullet/numbered list
  if (/^\s*[-*+]\s+\S/m.test(text)) return true;
  if (/^\s*\d+\.\s+\S/m.test(text)) return true;
  // Heading
  if (/^#{1,6}\s+\S/m.test(text)) return true;
  // Bold or italic
  if (/\*\*\S.*?\S\*\*/.test(text) || /__\S.*?\S__/.test(text)) return true;
  return false;
}
