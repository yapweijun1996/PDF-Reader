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
  AUTO: 'auto'
};

export function getTranslateMode() {
  return localStorage.getItem(MODE_KEY) || MODES.SELECTION;
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
