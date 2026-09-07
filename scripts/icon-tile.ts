/**
 * The icon tile: the cat's head, on a square, as an SVG string.
 *
 * Pulled out of `gen-icons.ts` when the browser extension needed the same art
 * at four more sizes. It is the art and nothing else — no file writing, no
 * `sharp`, no side effects at import — so both generators can render it and
 * neither has to run the other.
 *
 * The same rule the companion contact sheet already follows: a second consumer
 * shares the *coordinates*, never a copy. Nothing here is redrawn, so the tab
 * icon, the PWA icons and the extension icons cannot quietly stop being
 * pictures of the thing in the corner of the app.
 */

import { BODIES, FACES } from '../src/components/Companion/frames.ts'

const BG = '#08080b'

/** Deep amber: the app's primary, and the accent the cat wears while working. */
const COLOURS: Record<string, string> = {
  f: '#e6e1d6',
  s: '#a99f8c',
  e: '#14141c',
  h: '#ffffff',
  a: '#e8a33d',
  n: '#e8a33d',
}

/**
 * The head, in sprite coordinates — the same crop the app header shows.
 *
 * `MARK_CROP` and `markCropTop` in `cat.ts` are the live version, and there
 * the top of the crop follows each pose's face anchor. The literal `y: 0` is
 * right here because the icon is always the sitting pose, whose head is at the
 * top of the sprite. A different pose would need the derivation, and this
 * cannot import it: `cat.ts` reaches into the app's module graph, and these
 * stay plain node scripts.
 */
const CROP = { x: 2, y: 0, w: 16, h: 10 }

/**
 * A square field for the head to sit in, centred.
 *
 * Two units wider than the head so the ears are not flush against the tile
 * edge. A head is wider than it is tall, so the margin above and below is the
 * larger one — squaring that up would mean cropping into the face.
 */
export const FIELD = 18

const OFFSET_X = Math.round((FIELD - CROP.w) / 2)
const OFFSET_Y = Math.round((FIELD - CROP.h) / 2)

const stamp = (base: readonly string[], face: readonly string[], x: number, y: number) => {
  const rows = base.map((row) => [...row])
  face.forEach((row, dy) => {
    const target = rows[y + dy]
    if (!target) return
    for (let dx = 0; dx < row.length; dx += 1) {
      const ch = row[dx]!
      if (ch !== '.' && x + dx < target.length) target[x + dx] = ch
    }
  })
  return rows.map((row) => row.join(''))
}

/** Sitting up, eyes open — the pose the header mark shows. */
const HEAD = stamp(BODIES.sit, FACES.open, 5, 5)

/**
 * `inset` shrinks the head inside the square: 1 fills it, and anything less
 * leaves the margin a maskable icon needs.
 */
export function svg(size: number, inset: number): string {
  const pixels: string[] = []

  for (let y = CROP.y; y < CROP.y + CROP.h; y += 1) {
    const row = HEAD[y]
    if (!row) continue
    for (let x = CROP.x; x < CROP.x + CROP.w; x += 1) {
      const fill = COLOURS[row[x]!]
      if (!fill) continue
      pixels.push(
        `<rect x="${x - CROP.x + OFFSET_X}" y="${y + OFFSET_Y}" width="1" height="1" fill="${fill}"/>`,
      )
    }
  }

  const scale = inset
  const shift = (FIELD * (1 - scale)) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${FIELD} ${FIELD}" shape-rendering="crispEdges">
  <rect width="${FIELD}" height="${FIELD}" fill="${BG}"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">${pixels.join('')}</g>
</svg>`
}
