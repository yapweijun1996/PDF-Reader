import { listPdfs, deletePdf } from './db.js';
import { loadGallery } from './gallery.js';

let openCallback = null;
let openGalleryCallback = null;
let galleryLoaded = false;

export function initHistoryDrawer({ drawerEl, openButton, closeButton, onOpen, onOpenGallery }) {
  openCallback = onOpen;
  openGalleryCallback = onOpenGallery;
  openButton?.addEventListener('click', () => openDrawer(drawerEl));
  closeButton?.addEventListener('click', () => closeDrawer(drawerEl));
  drawerEl?.addEventListener('click', (e) => {
    if (e.target === drawerEl) closeDrawer(drawerEl);
  });
  wireSwipeToClose(drawerEl);
  wireTabs(drawerEl);
}

function wireTabs(drawerEl) {
  drawerEl?.querySelectorAll('.drawer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      drawerEl.querySelectorAll('.drawer-tab').forEach(t => t.classList.toggle('drawer-tab-active', t === tab));
      drawerEl.querySelectorAll('[data-tab-pane]').forEach(pane => {
        pane.hidden = pane.dataset.tabPane !== target;
      });
      if (target === 'discover' && !galleryLoaded) renderGallery(drawerEl);
    });
  });
}

function wireSwipeToClose(drawerEl) {
  const panel = drawerEl?.querySelector('.drawer-panel');
  if (!panel) return;

  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let horizontal = false;

  panel.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dx = 0;
    dragging = true;
    horizontal = false;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const ax = t.clientX - startX;
    const ay = t.clientY - startY;
    if (!horizontal) {
      // Lock direction on first significant move
      if (Math.abs(ax) > 8 || Math.abs(ay) > 8) {
        horizontal = Math.abs(ax) > Math.abs(ay);
        if (!horizontal) { dragging = false; panel.style.transition = ''; return; }
      } else {
        return;
      }
    }
    dx = Math.max(0, ax);
    panel.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    const threshold = panel.offsetWidth * 0.3;
    if (dx > threshold) {
      closeDrawer(drawerEl);
      panel.style.transform = '';
    } else {
      panel.style.transform = '';
    }
  };
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
}

async function openDrawer(drawerEl) {
  drawerEl.hidden = false;
  requestAnimationFrame(() => drawerEl.classList.add('drawer-open'));
  await renderList(drawerEl);
}

function closeDrawer(drawerEl) {
  drawerEl.classList.remove('drawer-open');
  setTimeout(() => { drawerEl.hidden = true; }, 200);
}

async function renderList(drawerEl) {
  const list = drawerEl.querySelector('.drawer-list');
  list.innerHTML = '<div class="drawer-loading">Loading…</div>';
  const records = await listPdfs();

  if (records.length === 0) {
    list.innerHTML = `
      <div class="drawer-empty">
        <svg class="empty-illustration" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="30" y="20" width="55" height="72" rx="4" />
          <rect x="38" y="14" width="55" height="72" rx="4" />
          <line x1="48" y1="32" x2="83" y2="32" />
          <line x1="48" y1="44" x2="83" y2="44" />
          <line x1="48" y1="56" x2="74" y2="56" />
          <circle cx="92" cy="98" r="14" />
          <line x1="92" y1="91" x2="92" y2="105" />
          <line x1="85" y1="98" x2="99" y2="98" />
        </svg>
        <p class="empty-title">No PDFs yet</p>
        <p class="empty-sub">Drag a PDF onto the page, or tap the upload button to start reading.</p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  for (const r of records) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-thumb">
        ${r.thumbnail
          ? `<img src="${r.thumbnail}" alt="thumbnail" loading="lazy" />`
          : '<div class="thumb-placeholder">PDF</div>'}
      </div>
      <div class="history-meta">
        <div class="history-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="history-sub">${formatSize(r.size)} · ${formatTime(r.lastOpenedAt)}</div>
      </div>
      <button class="history-delete" aria-label="Delete">×</button>
    `;
    card.querySelector('.history-thumb').addEventListener('click', () => {
      closeDrawer(drawerEl);
      openCallback?.(r);
    });
    card.querySelector('.history-meta').addEventListener('click', () => {
      closeDrawer(drawerEl);
      openCallback?.(r);
    });
    card.querySelector('.history-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${r.name}" from history?`)) return;
      await deletePdf(r.docHash);
      await renderList(drawerEl);
    });
    list.appendChild(card);
  }
}

async function renderGallery(drawerEl) {
  const pane = drawerEl.querySelector('[data-tab-pane="discover"]');
  if (!pane) return;
  pane.innerHTML = '<div class="gallery-loading">Loading curated papers…</div>';
  let manifest;
  try {
    manifest = await loadGallery();
  } catch (e) {
    pane.innerHTML = `<div class="gallery-loading">⚠️ Failed to load gallery: ${escapeHtml(e.message)}</div>`;
    return;
  }
  galleryLoaded = true;

  // Tag filter row
  const tagSet = new Set();
  manifest.papers.forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
  const allTags = ['all', ...Array.from(tagSet).sort()];

  pane.innerHTML = `
    <div class="gallery-filters">
      ${allTags.map(t => `<button class="gallery-tag ${t === 'all' ? 'gallery-tag-active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
    </div>
    <div class="gallery-grid"></div>
  `;

  const grid = pane.querySelector('.gallery-grid');
  function renderCards(filterTag) {
    const list = filterTag && filterTag !== 'all'
      ? manifest.papers.filter(p => (p.tags || []).includes(filterTag))
      : manifest.papers;
    grid.innerHTML = list.map(p => `
      <article class="gallery-card" data-id="${escapeHtml(p.id)}" style="--card-accent: ${p.color || 'var(--accent)'}">
        <div class="gallery-cover">
          <span class="gallery-year">${escapeHtml(String(p.year || ''))}</span>
        </div>
        <h3 class="gallery-title">${escapeHtml(p.title)}</h3>
        <p class="gallery-authors">${escapeHtml(p.authors || '')} · ${escapeHtml(p.venue || '')}</p>
        <p class="gallery-summary">${escapeHtml(p.summary || '')}</p>
        <div class="gallery-tags">
          ${(p.tags || []).slice(0, 3).map(t => `<span class="gallery-tag-chip">${escapeHtml(t)}</span>`).join('')}
        </div>
      </article>
    `).join('');
    grid.querySelectorAll('.gallery-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const entry = manifest.papers.find(p => p.id === id);
        if (entry && openGalleryCallback) {
          closeDrawer(drawerEl);
          openGalleryCallback(entry);
        }
      });
    });
  }

  pane.querySelectorAll('.gallery-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      pane.querySelectorAll('.gallery-tag').forEach(b => b.classList.toggle('gallery-tag-active', b === btn));
      renderCards(btn.dataset.tag);
    });
  });

  renderCards('all');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
