// Gallery — curated paper browser.
// Strategy: try direct CORS fetch → fallback to allorigins proxy → final
// fallback opens the URL in a new tab. Successfully fetched PDFs are
// hashed, rendered, and persisted to IDB so subsequent opens are offline.

import { renderPdf } from './pdf-viewer.js';
import { getDocHash, putPdf, touchPdf, getPdf } from './db.js';

const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

let cachedManifest = null;

export async function loadGallery() {
  if (cachedManifest) return cachedManifest;
  const url = `${import.meta.env.BASE_URL}gallery.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load gallery manifest');
  cachedManifest = await res.json();
  return cachedManifest;
}

/**
 * Open a paper from the gallery. Returns { docHash, hasTextLayer } on
 * success. On total failure (all fetches blocked), opens the URL in a
 * new browser tab and throws.
 */
export async function openGalleryPaper(entry, viewerEl, onStatus = () => {}) {
  // First, see if we already have this paper in IDB (returning user)
  // Try by URL-derived id since docHash isn't known yet without bytes.
  // We'll just race: fetch + IDB lookup simultaneously isn't worth it; just
  // try the fetch path, IDB will dedupe via docHash inside putPdf.

  onStatus('Downloading paper…');
  const buf = await fetchPdfBytes(entry.url, onStatus);
  if (!buf) {
    window.open(entry.url, '_blank');
    throw new Error('Could not load PDF in app — opened in a new tab');
  }

  const docHash = await getDocHash(buf);

  // If we already have it cached locally with this hash, just touch
  const existing = await getPdf(docHash);
  if (existing) {
    onStatus('Loading from cache…');
    const buf2 = await existing.blob.arrayBuffer();
    const { hasTextLayer } = await renderPdf(new Uint8Array(buf2), viewerEl);
    await touchPdf(docHash);
    onStatus(null);
    return { docHash, hasTextLayer };
  }

  onStatus('Rendering…');
  const data = new Uint8Array(buf);
  const { hasTextLayer } = await renderPdf(data.slice(), viewerEl);

  onStatus('Saving to your library…');
  try {
    await putPdf({
      docHash,
      name: `${entry.title}.pdf`,
      size: buf.byteLength,
      blob: new Blob([data.slice()], { type: 'application/pdf' }),
      thumbnail: null,
      lastOpenedAt: Date.now()
    });
  } catch (e) {
    console.warn('IDB save failed (continuing):', e);
  }
  onStatus(null);
  return { docHash, hasTextLayer };
}

async function fetchPdfBytes(url, onStatus) {
  // 1) Direct fetch (works for some arXiv mirrors / well-configured CDNs)
  try {
    onStatus('Downloading paper…');
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('pdf') || ct.includes('octet') || ct === '') {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 1024) {
          console.log('[gallery] direct fetch ok:', url);
          return buf;
        }
      }
    }
  } catch (e) {
    console.log('[gallery] direct fetch failed (CORS expected):', e.message);
  }

  // 2) CORS proxies in order
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyFn = CORS_PROXIES[i];
    const proxyUrl = proxyFn(url);
    try {
      onStatus(`Trying proxy ${i + 1}/${CORS_PROXIES.length}…`);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 1024) {
          console.log(`[gallery] proxy ${i + 1} ok`);
          return buf;
        } else {
          console.log(`[gallery] proxy ${i + 1} returned ${buf.byteLength} bytes (too small)`);
        }
      } else {
        console.log(`[gallery] proxy ${i + 1} status ${res.status}`);
      }
    } catch (e) {
      console.log(`[gallery] proxy ${i + 1} threw:`, e.message);
    }
  }
  console.log('[gallery] all fetch strategies failed for', url);
  return null;
}
