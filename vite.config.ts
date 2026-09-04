import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Which installed package a module belongs to, or nothing for our own source.
 *
 * By package rather than by substring on purpose. `id.includes('react')` also
 * matches `react-remove-scroll`, which arrives with the dialog and is wanted
 * in the lazy settings chunk rather than dragged onto the first paint.
 */
const packageOf = (id: string): string | undefined =>
  // Rollup normalises module ids to forward slashes on every platform.
  /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1]

const VENDOR_CHUNKS: Record<string, string | undefined> = {
  react: 'react',
  'react-dom': 'react',
  scheduler: 'react',
  motion: 'motion',
  'motion-dom': 'motion',
  'motion-utils': 'motion',
  'framer-motion': 'motion',
}

export default defineConfig({
  // GitHub Pages serves this as a project site at /mono/, not the domain root.
  base: process.env.GITHUB_ACTIONS ? '/mono/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app registers the SW itself so it can defer activation while a
      // focus block is running — see src/pwa/registerServiceWorker.ts.
      injectRegister: null,
      registerType: 'prompt',
      manifest: {
        name: 'Mono',
        short_name: 'Mono',
        description: 'A companion to help you focus and get stuff done.',
        start_url: '.',
        display: 'standalone',
        background_color: '#0b0b0f',
        theme_color: '#0b0b0f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        /**
         * React and the animation engine are split out by hand, and it is a
         * caching decision rather than a size one — the same bytes still ship.
         *
         * Mono is a precached PWA, so every deploy makes the service worker
         * refetch whatever changed. Left in the app chunk, changing a line of
         * copy would rewrite a file with React inside it and cost the user a
         * fresh 180 KB to receive it. Split, these two keep their hashes across
         * every release that does not upgrade them, and an ordinary update is
         * the app chunk alone.
         *
         * Only libraries that the first paint genuinely needs belong here.
         * Anything reached from a `lazy()` boundary is already its own chunk
         * and naming it would drag it back onto the critical path.
         */
        manualChunks: (id) => VENDOR_CHUNKS[packageOf(id) ?? ''],
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Playwright owns e2e/; vitest must not try to run those specs.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
