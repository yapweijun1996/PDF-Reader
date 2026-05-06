// Reader-mode toolbar — declarative, modular.
//
// One source of truth for every button/control in READ mode. Each entry
// describes: where it goes (group), how it looks (variant + icon + label),
// and which handler key in `handlers` it calls. Adding a new button is one
// line in BUTTONS; no HTML/CSS plumbing needed.
//
// Why declarative: the previous toolbar mixed static HTML in index.html
// with imperative querySelector wiring in reader.js. Two places to edit
// per button → drift. This collapses to one.

import { READER_THEMES, getReaderPrefs } from './settings.js';

// Inline SVG so we don't need a sprite system. Same stroke style as the rest of the app.
const ICONS = {
  play:    `<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>`,
  pause:   `<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>`,
  stop:    `<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>`,
  refresh: `<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 4 21 9 16 9"/>`,
  download:`<path d="M12 4v12"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/>`,
  wav:     `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  fontDec: null,  // text label "A−"
  fontInc: null,  // text label "A+"
};

function svg(pathInner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pathInner}</svg>`;
}

/**
 * Toolbar layout: 3 logical groups separated by a divider.
 *   playback  | display          | export
 *   ────────  | ───────────      | ──────
 *   Read All  | A− A+ Theme Src  | Cache  WAV  TXT
 *   Stop
 *   Speed
 *
 * Each entry:
 *   - kind: 'button' | 'slider' | 'select' | 'toggle' | 'spacer'
 *   - id: handler key in `handlers` (or DOM id for sliders/selects)
 *   - group: 'playback' | 'display' | 'export'
 *   - variant: 'primary' | 'ghost' | 'icon' | 'compact'   (button only)
 *   - label, mobileLabel, title, icon
 */
export const TOOLBAR_SPEC = [
  // ── playback group ──
  { kind: 'button', id: 'playAll', group: 'playback', variant: 'primary', icon: 'play', label: 'Read All', title: 'Read all paragraphs aloud' },
  { kind: 'button', id: 'stop',    group: 'playback', variant: 'ghost',   icon: 'stop', title: 'Stop' },
  { kind: 'slider', id: 'rate',    group: 'playback', label: 'Speed', min: 0.5, max: 2, step: 0.05, defaultValue: 1, format: v => `${Number(v).toFixed(2)}x` },

  // ── display group (right-aligned via spacer) ──
  { kind: 'spacer' },
  { kind: 'toggle', id: 'showSource', group: 'display', label: 'Show original', defaultChecked: true, title: 'Toggle the source-language text' },
  { kind: 'button', id: 'fontDec', group: 'display', variant: 'compact', label: 'A−', title: 'Decrease font size' },
  { kind: 'button', id: 'fontInc', group: 'display', variant: 'compact', label: 'A+', title: 'Increase font size' },
  { kind: 'select', id: 'theme',   group: 'display', title: 'Theme', options: [
      { value: 'dark',  label: '🌙 Dark'  },
      { value: 'light', label: '☀️ Light' },
      { value: 'sepia', label: '📜 Sepia' },
      { value: 'black', label: '⚫ Black' }
    ] },

  // ── export group ──
  { kind: 'button', id: 'cacheAll', group: 'export', variant: 'ghost', icon: 'refresh',  label: 'Cache', mobileLabel: '', title: 'Pre-synthesize all paragraphs (Gemini TTS) for offline playback' },
  { kind: 'button', id: 'downloadWav', group: 'export', variant: 'ghost', icon: 'wav',   label: 'WAV',   mobileLabel: '', title: 'Download all cached audio as one .wav' },
  { kind: 'button', id: 'exportTxt',   group: 'export', variant: 'ghost', icon: 'download', label: 'TXT', mobileLabel: '', title: 'Export translation as .txt' },
];

/**
 * Render the toolbar inside `toolbarEl` and wire each control to handlers.
 *
 * handlers shape:
 *   {
 *     playAll:    () => void,
 *     stop:       () => void,
 *     rate:       (value: number) => void,
 *     showSource: (checked: boolean) => void,
 *     fontDec:    () => void,
 *     fontInc:    () => void,
 *     theme:      (themeKey: string) => void,
 *     cacheAll:   () => void,
 *     downloadWav:() => void,
 *     exportTxt:  () => void,
 *   }
 *
 * Returns a `controls` object exposing `setPlaying(bool)`, `setRate(num)`,
 * `setShowSource(bool)`, `setTheme(str)` so the caller (reader.js) can
 * sync UI state without re-querying the DOM.
 */
export function renderReaderToolbar(toolbarEl, handlers) {
  toolbarEl.innerHTML = '';
  toolbarEl.classList.add('r-toolbar');

  const refs = {};
  let currentGroup = null;
  let groupEl = null;

  for (const spec of TOOLBAR_SPEC) {
    if (spec.kind === 'spacer') {
      const sp = document.createElement('div');
      sp.className = 'r-toolbar-spacer';
      toolbarEl.appendChild(sp);
      currentGroup = null;
      continue;
    }
    if (spec.group !== currentGroup) {
      groupEl = document.createElement('div');
      groupEl.className = `r-toolbar-group r-toolbar-group-${spec.group}`;
      toolbarEl.appendChild(groupEl);
      currentGroup = spec.group;
    }

    if (spec.kind === 'button') refs[spec.id] = mountButton(groupEl, spec, handlers);
    else if (spec.kind === 'slider') refs[spec.id] = mountSlider(groupEl, spec, handlers);
    else if (spec.kind === 'toggle') refs[spec.id] = mountToggle(groupEl, spec, handlers);
    else if (spec.kind === 'select') refs[spec.id] = mountSelect(groupEl, spec, handlers);
  }

  // Initial sync from prefs (theme + font come from settings.js)
  const prefs = getReaderPrefs();
  if (refs.theme && READER_THEMES.includes(prefs.theme)) refs.theme.value = prefs.theme;
  if (refs.showSource) refs.showSource.checked = !!prefs.showSource;

  return {
    setPlaying(on) {
      const btn = refs.playAll;
      if (!btn) return;
      btn.classList.toggle('is-playing', on);
      const labelEl = btn.querySelector('.r-btn-label');
      const iconEl = btn.querySelector('.r-btn-icon');
      if (labelEl) labelEl.textContent = on ? 'Pause' : 'Read All';
      if (iconEl) iconEl.innerHTML = svg(on ? ICONS.pause : ICONS.play);
    },
    setRate(v) {
      if (!refs.rate) return;
      refs.rate.input.value = String(v);
      refs.rate.value.textContent = `${Number(v).toFixed(2)}x`;
    },
    setShowSource(on) {
      if (refs.showSource) refs.showSource.checked = on;
    },
    setTheme(t) {
      if (refs.theme) refs.theme.value = t;
    },
    refs
  };
}

function mountButton(parent, spec, handlers) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `r-btn r-btn-${spec.variant || 'ghost'}`;
  if (spec.title) b.title = spec.title;
  if (spec.icon && ICONS[spec.icon]) {
    const ico = document.createElement('span');
    ico.className = 'r-btn-icon';
    ico.innerHTML = svg(ICONS[spec.icon]);
    b.appendChild(ico);
  }
  if (spec.label) {
    const lab = document.createElement('span');
    lab.className = 'r-btn-label';
    lab.textContent = spec.label;
    b.appendChild(lab);
  }
  // Hint to CSS that this button can collapse to icon-only on small screens
  if (spec.mobileLabel === '' && spec.icon) b.dataset.mobileCollapse = 'icon';

  b.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers[spec.id]?.();
  });
  return b;
}

function mountSlider(parent, spec, handlers) {
  const wrap = document.createElement('label');
  wrap.className = 'r-toolbar-slider';
  const lab = document.createElement('span');
  lab.className = 'r-toolbar-slider-label';
  lab.textContent = spec.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'r-toolbar-slider-input';
  input.min = spec.min;
  input.max = spec.max;
  input.step = spec.step;
  input.value = spec.defaultValue;
  const value = document.createElement('span');
  value.className = 'r-toolbar-slider-value';
  value.textContent = spec.format ? spec.format(spec.defaultValue) : String(spec.defaultValue);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    value.textContent = spec.format ? spec.format(v) : String(v);
    handlers[spec.id]?.(v);
  });
  wrap.append(lab, input, value);
  parent.appendChild(wrap);
  return { input, value };
}

function mountToggle(parent, spec, handlers) {
  const wrap = document.createElement('label');
  wrap.className = 'r-toolbar-toggle';
  if (spec.title) wrap.title = spec.title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!spec.defaultChecked;
  const lab = document.createElement('span');
  lab.textContent = spec.label;
  input.addEventListener('change', () => handlers[spec.id]?.(input.checked));
  wrap.append(input, lab);
  parent.appendChild(wrap);
  return input;
}

function mountSelect(parent, spec, handlers) {
  const sel = document.createElement('select');
  sel.className = 'r-toolbar-select';
  if (spec.title) sel.title = spec.title;
  for (const opt of spec.options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => handlers[spec.id]?.(sel.value));
  parent.appendChild(sel);
  return sel;
}
