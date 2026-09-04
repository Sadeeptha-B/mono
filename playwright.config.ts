/**
 * Playwright runs against a production preview rather than the dev server,
 * because the things these specs check — the service worker, the built PWA
 * manifest, the picture-in-picture window — only exist in a real build.
 *
 * Who performs that build differs by environment, which is the one piece of
 * cleverness here. Locally `npm run test:e2e` is documented as self-contained,
 * so it builds first. In CI the workflow has already built the bundle that is
 * about to be deployed, and building it a second time here would both waste a
 * minute and test something other than what ships.
 */
import { defineConfig, devices } from '@playwright/test'

const preview = 'npx vite preview --port 4173 --strictPort'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `github` annotates the failing lines in the run's diff; the html report is
  // what gets uploaded when something fails, because a trace read after the
  // fact is the only way to see a flake that will not reproduce locally.
  reporter: process.env.CI
    ? ([['github'], ['html', { open: 'never' }]] as const)
    : 'list',
  // The suite is 64 short, fully independent specs against a paused clock, so
  // it is bounded by how many browsers can run at once. Playwright's default of
  // half the cores leaves half of a four-core runner idle for no reason.
  ...(process.env.CI ? { workers: 4 } : {}),
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.CI ? preview : `npm run build && ${preview}`,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
