import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/PDF-Reader/',
  build: {
    outDir: 'dist',
    target: 'es2020'
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['attention.pdf', 'gemma_code.jsonl', 'icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,pdf,jsonl,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      },
      manifest: {
        name: 'PDF Reader — Highlight to Translate',
        short_name: 'PDF Reader',
        description: 'Read PDFs with AI-powered highlight-to-translate.',
        theme_color: '#1f2937',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
