const KEY = 'pdfReader.targetLang';
const MODE_KEY = 'pdfReader.translateMode';

export const LANGUAGES = [
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'English',
  'Malay',
  'Indonesian',
  'Japanese',
  'Korean',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Arabic',
  'Hindi',
  'Thai',
  'Vietnamese'
];

export function getTargetLang() {
  return localStorage.getItem(KEY) || 'Chinese (Simplified)';
}

export function setTargetLang(lang) {
  localStorage.setItem(KEY, lang);
}

export const MODES = {
  SELECTION: 'selection',
  SIDE: 'side',
  BILINGUAL: 'bilingual'
};

export const MODE_LABELS = {
  selection: 'Selection only',
  side: 'Side panel',
  bilingual: 'Bilingual columns'
};

export function isAutoMode(mode) {
  return mode === MODES.SIDE || mode === MODES.BILINGUAL;
}

export function getTranslateMode() {
  const raw = localStorage.getItem(MODE_KEY) || MODES.SELECTION;
  // Migrate legacy 'auto' value (PR #3) -> 'side'
  if (raw === 'auto') return MODES.SIDE;
  if (![MODES.SELECTION, MODES.SIDE, MODES.BILINGUAL].includes(raw)) return MODES.SELECTION;
  return raw;
}

export function setTranslateMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function mountLangSelector(selectEl, onChangeExtra) {
  selectEl.innerHTML = '';
  const current = getTargetLang();
  for (const lang of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    if (lang === current) opt.selected = true;
    selectEl.appendChild(opt);
  }
  selectEl.addEventListener('change', () => {
    setTargetLang(selectEl.value);
    onChangeExtra?.(selectEl.value);
  });
}
