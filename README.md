# PDF Reader — Highlight to Translate

PWA for reading PDFs in the browser. Highlight any text → AI auto-translates to your chosen language.

**Live demo:** https://yapweijun1996.github.io/PDF-Reader/

## Features

- 📄 Renders any PDF with selectable text (uses [pdf.js](https://mozilla.github.io/pdf.js/))
- 🌐 Highlight-to-translate via [Gemma 3 27B IT](https://ai.google.dev/gemma) — 15 target languages
- 📱 Mobile responsive, installable as PWA, works offline after first load
- 🔁 API key rotation + 429/500 retry (reuses [`sample/gemma.js`](sample/gemma.js) verbatim)
- 🚀 GitHub Actions auto-deploy to GitHub Pages on push to `main`

## Local development

```bash
npm install
npm run dev      # http://localhost:5173/PDF-Reader/
npm run build    # output → dist/
npm run preview  # preview production build
```

## How it works

```
User selects text in PDF
  → debounced 250ms
  → src/translator.js calls callGeminiAPI() from src/gemma.js
  → src/gemma.js rotates encrypted keys from public/gemma_code.jsonl
  → Floating tooltip shows translation
```

`src/gemma.js` is an unmodified copy of [`sample/gemma.js`](sample/gemma.js). All key encryption, rotation, and retry logic is reused as-is.

## Demo PDF

[*Attention Is All You Need*](https://arxiv.org/abs/1706.03762) (Vaswani et al., 2017) — bundled in `public/attention.pdf`.

## License

- Project code: MIT
- AI translation uses [Gemma 3](https://ai.google.dev/gemma/terms) — subject to Google's Gemma Terms of Use.
- API keys in `public/gemma_code.jsonl` are XOR-obfuscated for demo purposes only — **not production-safe encryption**. Use a backend proxy for production deployments.
