/**
 * Generates the favicon and the PWA icons from the companion's own frames.
 *
 *   node scripts/gen-icons.ts
 *
 * The art itself is in `icon-tile.ts`, shared with the extension build, which
 * needs the same head at four smaller sizes. This file is the app's half: which
 * sizes, at what inset, written where.
 *
 * The maskable variant sits well inside the safe zone, since Android crops
 * icons to whatever shape the launcher happens to use.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

import { FIELD, svg } from './icon-tile.ts'

await mkdir('public/icons', { recursive: true })

// The favicon is the SVG itself: at 16px a browser tab is almost exactly one
// screen pixel per sprite pixel, which is the size this art was drawn for.
await writeFile('public/mono.svg', `${svg(FIELD, 1)}\n`)
console.log('wrote public/mono.svg')

const targets: [string, number, number][] = [
  ['public/icons/icon-192.png', 192, 0.88],
  ['public/icons/icon-512.png', 512, 0.88],
  ['public/icons/icon-maskable-512.png', 512, 0.6],
]

for (const [path, size, inset] of targets) {
  const png = await sharp(Buffer.from(svg(size, inset))).png().toFile(path)
  console.log(`wrote ${path} (${size}px, ${png.width}x${png.height})`)
}
