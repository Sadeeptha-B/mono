/**
 * Generates the PWA icons from one inline SVG source.
 *
 * The maskable variant needs the line pulled well inside the safe zone, since
 * Android crops icons to whatever shape the launcher uses.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BG = '#08080b'
const ACCENT = '#e8a33d'

const line = (scale, dy) => `
  <g transform="translate(0 ${dy}) scale(${scale}) translate(-62 -40) translate(62 40)">
    <path d="M 8 54 C 26 55, 36 50, 50 49 C 64 48, 72 50, 84 48 C 96 46, 100 42, 104 40 C 108 38, 112 39, 114 42"
          fill="none" stroke="${ACCENT}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="108" cy="26" r="6" fill="${ACCENT}"/>
  </g>`

const svg = (size, inset) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 124 124">
  <rect width="124" height="124" fill="${BG}"/>
  <g transform="translate(62 62) scale(${inset}) translate(-62 -62)">
    <g transform="translate(0 22)">${line(1, 0)}</g>
  </g>
</svg>`

await mkdir('public/icons', { recursive: true })

const targets = [
  ['public/icons/icon-192.png', 192, 0.92],
  ['public/icons/icon-512.png', 512, 0.92],
  ['public/icons/icon-maskable-512.png', 512, 0.62],
]

for (const [path, size, inset] of targets) {
  const png = await sharp(Buffer.from(svg(size, inset))).png().toBuffer()
  await writeFile(path, png)
  console.log(`wrote ${path} (${size}px)`)
}
