/**
 * The fast local browser loop.
 *
 * The ordinary Playwright config deliberately builds and previews production:
 * it is the deployment gate, and CI runs it against the exact bundle that
 * ships. Most UI work does not need to repay that build on every focused run,
 * so this config keeps every browser/test setting and changes only the server.
 * It reuses an existing `npm run dev` on Vite's normal port when one is there,
 * or starts one itself when it is not. Reuse is port-based: if another
 * checkout owns 5173, that is the checkout Playwright will exercise.
 */
import { defineConfig } from '@playwright/test'

import production from './playwright.config'

const url = 'http://localhost:5173'

export default defineConfig({
  // `defineConfig(production, overrides)` would merge both `webServer` values
  // into an array and quietly start the production build as well. A plain
  // object spread makes the development server a replacement.
  ...production,
  use: { ...production.use, baseURL: url },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
