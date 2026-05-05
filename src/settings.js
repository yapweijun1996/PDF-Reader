const KEY = 'pdfReader.targetLang';
const MODE_KEY = 'pdfReader.translateMode';

export const LANGUAGES = [
  { value: 'Chinese (Simplified)', label: '中文（简）' },
  { value: 'Chinese (Traditional)', label: '中文（繁）' },
  { value: 'English', label: 'English' },
  { value: 'Malay', label: 'Melayu' },
  { value: 'Indonesian', label: 'Indonesia' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
  { value: 'Spanish', label: 'Español' },
  { value: 'French', label: 'Français' },
  { value: 'German', label: 'Deutsch' },
  { value: 'Portuguese', label: 'Português' },
  { value: 'Arabic', label: 'العربية' },
  { value: 'Hindi', label: 'हिन्दी' },
  { value: 'Thai', label: 'ไทย' },
  { value: 'Vietnamese', label: 'Tiếng Việt' }
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
  BILINGUAL: 'bilingual',
  OVERLAY: 'overlay',
  READER: 'reader'
};

export const MODE_LABELS = {
  selection: 'Selection',
  side: 'Side panel',
  bilingual: 'Bilingual',
  overlay: 'Overlay',
  reader: 'Reader'
};

export function isAutoMode(mode) {
  return mode === MODES.SIDE || mode === MODES.BILINGUAL || mode === MODES.OVERLAY;
}

export function isReaderMode(mode) {
  return mode === MODES.READER;
}

export function getTranslateMode() {
  const raw = localStorage.getItem(MODE_KEY) || MODES.SELECTION;
  // Migrate legacy 'auto' value (PR #3) -> 'side'
  if (raw === 'auto') return MODES.SIDE;
  if (![MODES.SELECTION, MODES.SIDE, MODES.BILINGUAL, MODES.OVERLAY, MODES.READER].includes(raw)) return MODES.SELECTION;
  return raw;
}

export function setTranslateMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function mountLangSelector(selectEl, onChangeExtra) {
  selectEl.innerHTML = '';
  const current = getTargetLang();
  for (const { value, label } of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === current) opt.selected = true;
    selectEl.appendChild(opt);
  }
  selectEl.addEventListener('change', () => {
    setTargetLang(selectEl.value);
    onChangeExtra?.(selectEl.value);
  });
}
