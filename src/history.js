import { listPdfs, deletePdf } from './db.js';

let openCallback = null;

export function initHistoryDrawer({ drawerEl, openButton, closeButton, onOpen }) {
  openCallback = onOpen;
  openButton?.addEventListener('click', () => openDrawer(drawerEl));
  closeButton?.addEventListener('click', () => closeDrawer(drawerEl));
  drawerEl?.addEventListener('click', (e) => {
    if (e.target === drawerEl) closeDrawer(drawerEl);
  });
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
        <p>No history yet.</p>
        <p>Drag a PDF onto the page or use the 📤 button to start.</p>
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
