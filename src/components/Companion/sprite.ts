/**
 * Turning authored pixels into something an SVG can draw.
 *
 * Two operations, both pure, both trivially testable — which is the point of
 * keeping them away from the component. `compose` stamps a face onto a body;
 * `runs` collapses the result into horizontal spans so the renderer emits
 * something like seventy rectangles instead of three hundred.
 *
 * Run-length is not a micro-optimisation here. Two cats are mounted at once
 * and the whole app re-renders every second off the shared ticker, so the
 * element count is paid for sixty times a minute whether the cat moved or not.
 */

import { TRANSPARENT, type Grid } from './frames'

/** A grid stamped at a position in another grid's coordinates. */
export type Layer = { grid: Grid; x: number; y: number }

/**
 * Paint layers onto a copy of `base`, in order.
 *
 * Transparent pixels in a layer leave what is underneath alone, so a face is a
 * patch rather than a rectangle punched into the head. Anything falling
 * outside the base is dropped rather than growing it: the body defines how big
 * the cat is, and a misplaced face should be visibly wrong, not silently
 * resize the sprite.
 */
export function compose(base: Grid, ...layers: readonly Layer[]): Grid {
  const rows = base.map((row) => [...row])

  for (const layer of layers) {
    layer.grid.forEach((row, dy) => {
      const target = rows[layer.y + dy]
      if (!target) return

      for (let dx = 0; dx < row.length; dx += 1) {
        const ch = row[dx]!
        if (ch === TRANSPARENT) continue
        const x = layer.x + dx
        if (x < 0 || x >= target.length) continue
        target[x] = ch
      }
    })
  }

  return rows.map((row) => row.join(''))
}

/** One horizontal span of a single colour. */
export type Run = { x: number; y: number; w: number; ch: string }

/** Every non-transparent span in the grid, left to right, top to bottom. */
export function runs(grid: Grid): Run[] {
  const out: Run[] = []

  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      if (ch === TRANSPARENT) {
        x += 1
        continue
      }
      let w = 1
      while (row[x + w] === ch) w += 1
      out.push({ x, y, w, ch })
      x += w
    }
  })

  return out
}
