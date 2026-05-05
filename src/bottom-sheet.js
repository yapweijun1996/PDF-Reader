// Draggable bottom-sheet for the translation panel on mobile.
// Three snap points: collapsed (header only), half (~50vh), full (~92vh).
// Touch + mouse drag with velocity-aware snap. Falls back to pure-tap toggle
// when user taps the handle without dragging.
//
// Only active on viewports where the panel becomes a bottom sheet
// (configured CSS at <= 1023px). On wider screens this module is a no-op.

const SNAP = {
  collapsed: 0.88, // translateY = 88vh (only ~12vh visible — header)
  half:      0.50, // 50vh hidden = ~50vh visible
  full:      0.00  // fully cover (panel sits at top, includes topbar area)
};

const VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick wins over distance
const NARROW_BREAKPOINT = 1024;

let panelEl = null;
let handleEl = null;
let bound = false;
let currentSnap = 'half';

export function initBottomSheet({ panel, handle }) {
  panelEl = panel;
  handleEl = handle;
  if (!panelEl || !handleEl) return;

  bindHandlers();
  applySnap('half');

  // Tap the handle (no drag) → cycle snap points up
  handleEl.addEventListener('click', (e) => {
    if (!isNarrow()) return;
    if (e.detail === 0) return; // synthesized click; ignore
    const order = ['collapsed', 'half', 'full'];
    const idx = order.indexOf(currentSnap);
    const next = order[(idx + 1) % order.length];
    applySnap(next);
  });
}

function isNarrow() {
  return window.innerWidth < NARROW_BREAKPOINT;
}

function bindHandlers() {
  if (bound) return;
  bound = true;

  let startY = 0;
  let startTranslate = 0;
  let dragging = false;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let moved = false;

  const onStart = (e) => {
    if (!isNarrow()) return;
    const y = pointY(e);
    startY = y;
    lastY = y;
    lastT = performance.now();
    velocity = 0;
    moved = false;
    startTranslate = currentTranslateVh();
    panelEl.style.transition = 'none';
    dragging = true;
  };

  const onMove = (e) => {
    if (!dragging) return;
    const y = pointY(e);
    const dy = y - startY;
    if (Math.abs(dy) > 4) moved = true;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = (y - lastY) / dt; // px/ms; positive = moving down
    lastY = y;
    lastT = now;

    const vh = window.innerHeight / 100;
    const newTranslateVh = clamp(startTranslate + dy / vh, SNAP.full * 100, SNAP.collapsed * 100);
    panelEl.style.transform = `translateY(${newTranslateVh}vh)`;
    if (e.cancelable) e.preventDefault();
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    panelEl.style.transition = '';

    if (!moved) {
      // No drag → handler-level click fires natural toggle. Do nothing here.
      return;
    }

    const currentVh = currentTranslateVh();
    let target;

    // Velocity-aware snap: a fast flick wins over nearest-distance.
    if (velocity > VELOCITY_THRESHOLD) {
      target = currentVh > SNAP.half * 100 ? 'collapsed' : 'half';
    } else if (velocity < -VELOCITY_THRESHOLD) {
      target = currentVh < SNAP.half * 100 ? 'full' : 'half';
    } else {
      // Nearest snap by distance
      target = nearestSnap(currentVh);
    }
    applySnap(target);
  };

  handleEl.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);
  window.addEventListener('touchcancel', onEnd);

  handleEl.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
}

function applySnap(name) {
  if (!panelEl) return;
  currentSnap = name;
  panelEl.classList.remove('snap-collapsed', 'snap-half', 'snap-full');
  panelEl.classList.add(`snap-${name}`);
  panelEl.style.transform = ''; // let CSS class drive it
}

function nearestSnap(currentVh) {
  const points = {
    collapsed: SNAP.collapsed * 100,
    half: SNAP.half * 100,
    full: SNAP.full * 100
  };
  let best = 'half';
  let bestDist = Infinity;
  for (const [name, vh] of Object.entries(points)) {
    const d = Math.abs(vh - currentVh);
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

function currentTranslateVh() {
  const tr = window.getComputedStyle(panelEl).transform;
  if (!tr || tr === 'none') {
    return (currentSnap in SNAP ? SNAP[currentSnap] : SNAP.half) * 100;
  }
  // matrix(a, b, c, d, e, f) — translateY is f
  const m = tr.match(/matrix.*\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    const ty = parts.length === 6 ? parts[5] : parts[13];
    return (ty / window.innerHeight) * 100;
  }
  return SNAP.half * 100;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pointY(e) {
  return e.touches?.[0]?.clientY ?? e.clientY ?? 0;
}
