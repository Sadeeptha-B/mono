/**
 * Build the browser extension into `dist-extension/`.
 *
 * A script rather than a config file because the extension needs *two* Vite
 * builds, and they differ in a way no single config can express.
 *
 * The first is an ordinary ES build: the service worker, the interstitial and
 * the popup, which may all be modules and may all share chunks. The second is
 * the content script, which may not. A content script declared in a manifest is
 * executed as a classic script, so an `import` in the file that ships is a
 * runtime error — it needs `format: 'iife'` and `inlineDynamicImports`, and it
 * has to be written into the same directory without erasing the first build.
 *
 * A script rather than two configs and an env var because `VAR=x vite build`
 * is not a thing on Windows, and this repo already runs its generators as plain
 * `node scripts/*.ts` under Node's type stripping. This is another generator.
 *
 * Two details that will bite whoever changes this:
 *
 * - **Nothing is hashed.** The manifest names `background.js` and `bridge.js`
 *   literally, so `entryFileNames` is fixed. This is the opposite of the app's
 *   build, where hashing is what lets the service worker cache chunks across
 *   releases; here there is no cache to be careful about and a name a JSON file
 *   has to match instead.
 * - **`emptyOutDir` is true exactly once**, on the first build. The second
 *   would otherwise delete everything the first produced, silently, leaving a
 *   directory that loads as an extension and does nothing.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import sharp from 'sharp'
import { build } from 'vite'

import { svg } from './icon-tile.ts'

import { buildManifest } from '../extension/src/manifest.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = 'dist-extension'
const development = process.argv.includes('--dev')

const resolve = {
  alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
}

/**
 * `publicDir: false` on both builds, and it is not an optimisation.
 *
 * Vite's default public directory is `<root>/public`, and the root here has to
 * be the repo so the `@/` alias and `node_modules` resolve — which means the
 * default would copy the *app's* icons, web manifest and `mono.svg` into the
 * extension. Not fatal, but an extension that ships a PWA manifest it does not
 * use is one more thing for a store reviewer to ask about. The two icons it
 * genuinely wants are copied explicitly at the bottom of this file.
 */
const publicDir = false

/** The three module entries. Each HTML entry pulls in its own script and CSS. */
await build({
  root,
  resolve,
  publicDir,
  configFile: false,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // A blocked page that has to be readable while the user is mildly annoyed
    // is not the place to save four kilobytes by inlining a stylesheet into a
    // script that has to parse first.
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        background: 'extension/src/background.ts',
        blocked: 'extension/src/blocked.html',
        popup: 'extension/src/popup.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})

/** The content script, alone, as a classic script. */
await build({
  root,
  resolve,
  publicDir,
  configFile: false,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: false,
    rollupOptions: {
      input: { bridge: 'extension/src/bridge.content.ts' },
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'bridge.js',
      },
    },
  },
})

/**
 * Vite emits an HTML entry at its path relative to the root, so these land at
 * `extension/src/blocked.html`. The manifest and every redirect rule name them
 * at the top level, so they are moved rather than referenced where they fell —
 * a redirect to a path that does not exist means a blocked navigation shows a
 * broken page instead of the user's own words, which is worse than not blocking.
 *
 * Moving them needs no path rewriting: Vite emits the script and stylesheet
 * hrefs as absolute (`/blocked.js`), and in a `chrome-extension://` page an
 * absolute path is already relative to the extension root. That is a genuine
 * difference from the app, where `base` has to be set for GitHub Pages.
 */
for (const page of ['blocked.html', 'popup.html']) {
  await rename(
    new URL(`../${OUT_DIR}/extension/src/${page}`, import.meta.url),
    new URL(`../${OUT_DIR}/${page}`, import.meta.url),
  )
}

// The now-empty source-shaped directory. Left behind it would ship two copies
// of every page, and the ones a reviewer opens first are the wrong ones.
await rm(new URL(`../${OUT_DIR}/extension`, import.meta.url), { recursive: true, force: true })

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

await writeFile(
  new URL(`../${OUT_DIR}/manifest.json`, import.meta.url),
  `${JSON.stringify(buildManifest(version, { development }), null, 2)}\n`,
)

/**
 * The extension's icons, rendered rather than copied.
 *
 * The app ships 192 and 512 for the PWA; an extension wants a different set
 * entirely — 128 for installation and the Web Store listing, 48 for
 * `chrome://extensions`, 32 and 16 for the toolbar and the pages' own favicons.
 * The store treats the 128 as required.
 *
 * They come off the same head as the app icons, at the same inset, via
 * `icon-tile.ts`. Downscaling the existing 512 would have been fewer lines and
 * the wrong thing: this is pixel art, and 512 is not an integer multiple of 48,
 * so a resample would land the sprite grid between screen pixels and produce a
 * blurred cat at exactly the size Chrome shows most often.
 */
await mkdir(new URL(`../${OUT_DIR}/icons`, import.meta.url), { recursive: true })

for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg(size, 0.88)))
    .png()
    .toFile(fileURLToPath(new URL(`../${OUT_DIR}/icons/icon-${size}.png`, import.meta.url)))
}

console.log(
  `\n${development ? 'Development extension' : 'Store extension'} built into ${OUT_DIR}/. ` +
    'Load it unpacked from there.',
)
