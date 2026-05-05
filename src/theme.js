// Whole-app light/dark theme controller.
// Strategy:
//  - localStorage 'pdfReader.theme' ∈ { 'system' | 'light' | 'dark' }
//  - 'system' → no data-theme attr → CSS @media (prefers-color-scheme) rules win
//  - 'light' / 'dark' → set <html data-theme="…"> overriding the media query
// Listens to system theme changes when in 'system' mode and updates
// theme-color meta + manifest indication automatically.

const KEY = 'pdfReader.theme';

export const THEMES = ['system', 'light', 'dark'];

export function getAppTheme() {
  const raw = localStorage.getItem(KEY);
  return THEMES.includes(raw) ? raw : 'system';
}

export function setAppTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  if (theme === 'system') {
    localStorage.removeItem(KEY);
    document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem(KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
  syncMetaThemeColor();
}

export function initTheme() {
  const theme = getAppTheme();
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  syncMetaThemeColor();

  // Watch system changes for users in 'system' mode
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (getAppTheme() === 'system') syncMetaThemeColor();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

function syncMetaThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const isLight = effectiveTheme() === 'light';
  meta.setAttribute('content', isLight ? '#f3f3ee' : '#1f2937');
}

export function effectiveTheme() {
  const t = getAppTheme();
  if (t !== 'system') return t;
  return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}
