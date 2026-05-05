// Lightweight snackbar/toast — replaces the persistent status div.
// Usage: toast('Saved'), toast('⚠️ Failed', { duration: 5000 }), toast('Loading…', { sticky: true, id: 'load' })
// Sticky toasts can be dismissed via toast.dismiss(id) or toast.dismissAll().

let containerEl = null;
const live = new Map();

function ensureContainer() {
  if (containerEl) return containerEl;
  containerEl = document.createElement('div');
  containerEl.className = 'toast-container';
  document.body.appendChild(containerEl);
  return containerEl;
}

export function toast(message, opts = {}) {
  const { duration = 3000, sticky = false, id = `t${Date.now()}_${Math.random().toString(36).slice(2, 6)}` } = opts;
  const container = ensureContainer();

  // Replace existing toast with same id (so loading toasts can update text)
  if (live.has(id)) {
    const existing = live.get(id);
    existing.querySelector('.toast-msg').textContent = message;
    return id;
  }

  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;
  container.appendChild(el);
  live.set(id, el);

  requestAnimationFrame(() => el.classList.add('toast-in'));

  if (!sticky) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export function dismiss(id) {
  const el = live.get(id);
  if (!el) return;
  live.delete(id);
  el.classList.remove('toast-in');
  el.classList.add('toast-out');
  setTimeout(() => el.remove(), 220);
}

export function dismissAll() {
  for (const id of [...live.keys()]) dismiss(id);
}

toast.dismiss = dismiss;
toast.dismissAll = dismissAll;
