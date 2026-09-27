import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    /*
     * The host is pinned rather than left to Vite's default. On Windows the
     * default resolves to ::1, while baseURL asks for 127.0.0.1, and the
     * mismatch presents as an unexplained 120s webServer timeout.
     */
    command: 'npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    /*
     * Off unless asked for, and that is the opposite of Playwright's default.
     *
     * `webServer.command` is what builds. If a server is already listening on the
     * port, Playwright skips the command entirely — including the `npm run build`
     * in front of it — and points the tests at whatever `dist` happens to contain.
     * That is silent: the suite passes against a build from an earlier session, and
     * a layout change appears to do nothing at all, which is exactly how a CSS fix
     * gets measured as having failed twice for no reason.
     *
     * Opt in with KALD_REUSE_SERVER=1 when you deliberately want to test a server
     * you started yourself; make sure you built first.
     */
    reuseExistingServer: process.env.KALD_REUSE_SERVER === '1',
    timeout: 120_000,
  },
})
