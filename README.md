# PDF Reader — Highlight to Translate

PWA for reading PDFs in the browser. Highlight any text → AI auto-translates to your chosen language.

**Live demo:** https://yapweijun1996.github.io/PDF-Reader/

## Features

- 📄 Renders any PDF with selectable text (uses [pdf.js](https://mozilla.github.io/pdf.js/))
- 🌐 Highlight-to-translate via the OpenAI-compatible gateway at `gpt.yapweijun1996.com` (`gpt-5.4-mini` by default) — 15 target languages
- 📱 Mobile responsive, installable as PWA, works offline after first load
- 🔐 Default Bearer key is XOR-obfuscated in `src/gateway.js`; users can override with their own key + model via Settings
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
  → src/translator.js builds the prompt
  → src/gateway.js POSTs to https://gpt.yapweijun1996.com/v1/responses
     (stream: true, reasoning.effort: 'low' by default — streaming avoids
     Cloudflare's 100s 524 timeout for reasoning models)
  → Floating tooltip shows the streamed translation
```

The gateway speaks the OpenAI Responses API. SSE frames of type
`response.output_text.delta` carry incremental tokens; the final
`response.completed` event holds the assembled message.

## Demo PDF

[*Attention Is All You Need*](https://arxiv.org/abs/1706.03762) (Vaswani et al., 2017) — bundled in `public/attention.pdf`.

## License

- Project code: MIT
- The Bearer key shipped in `src/gateway.js` is XOR-obfuscated for demo purposes only — **not production-safe encryption**. Anyone running the decrypt routine in devtools can recover it. For production, put a backend proxy in front of the gateway.
