import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { childDocument } from './vite.child.ts'

/**
 * The child document's build, kept separate from the host's.
 *
 * The split is not tidiness, it is a hard requirement of the sandbox. The child
 * runs in an iframe with an opaque origin, and an opaque-origin document cannot
 * load an ES module from a static host, because every module load is a CORS
 * request. The host is same-origin with its own assets and needs no such care, so
 * forcing one output format on both documents would break one or the other. Here
 * the child becomes a single self-executing classic bundle; see
 * `toClassicScript` in vite.child.ts for the browser behaviour that forces this.
 */
export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/<repo>/) and locally.
  base: './',
  plugins: [react(), childDocument()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The host build owns dist/ and empties it; this one adds the child beside it.
    emptyOutDir: false,
    outDir: 'dist',
    // The engine and content are the bulk of the repo; keep the client bundle honest.
    target: 'es2023',
    /*
     * A classic bundle has no import graph to preload, and one file each for
     * script and style is easier to reason about than a graph when the whole point
     * is that the child shares nothing with the host document.
     *
     * `cssCodeSplit: false` is not a style preference. With `format: 'iife'` and
     * code splitting left on, Vite 8 emits the JavaScript and silently drops the
     * stylesheet entirely, which produces a child that runs and looks unstyled.
     * One entry, one CSS file is also all this document needs.
     */
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: { frame: fileURLToPath(new URL('./frame.html', import.meta.url)) },
      output: { format: 'iife', codeSplitting: false },
    },
  },
})
