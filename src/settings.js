const KEY = 'pdfReader.targetLang';

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

export function mountLangSelector(selectEl, onChange) {
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
    onChange?.(selectEl.value);
  });
}
