import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The host document's build.
 *
 * index.html is the trusted host: it owns the wallet connection, owned-Friend
 * discovery, the fresh ownership check, and the sandboxed frame. The game lives in
 * frame.html and is built separately by vite.frame.config.ts, because a sandboxed
 * child has to be a classic bundle and cannot share a build with its host. Run
 * `npm run build`, which runs both.
 */
export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/<repo>/) and locally.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // The engine and content are the bulk of the repo; keep the client bundle honest.
    target: 'es2023',
    rollupOptions: {
      input: {
        host: fileURLToPath(new URL('./index.html', import.meta.url)),
        // The reviewer path: the real story UI with a preview-mode session and
        // no wallet. Built alongside the host (relative base) so it can be
        // served anywhere — including GitHub Pages — without the runtime.
        playtest: fileURLToPath(new URL('./playtest.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      include: ['src/engine/**', 'src/economy/**', 'content/**'],
    },
  },
})
