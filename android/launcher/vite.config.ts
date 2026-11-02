import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Built into the APK's assets and served from
// https://appassets.androidplatform.net/assets/launcher/ — relative paths,
// and a target the oldest WebView the app accepts (Chromium 86) understands.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../app/src/main/assets/launcher', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome86',
    assetsDir: '.',
  },
})
