/**
 * Where a block's logs and urges are drawn, down its height on the calendar
 * or along the mini window's strip.
 *
 * Each goes at the minute it happened, measured against the block's own span,
 * because the calendar is an axis and a mark anywhere else would be a claim
 * about a different minute. The judgement is in the logs. An hour is 96
 * pixels, so a minute is 1.6 of them, and two logs written a minute apart
 * would be one mark — the second impossible to point at, and pointing at a
 * log's mark is how it is read and corrected. So logs are pushed apart to
 * at least `minGap` (`markOffsets`), and where a block is too short to hold
 * them all that far apart, the nearest neighbours share one mark until the
 * rest fit (`stackRuns`). Pushing further cannot help a block that is simply
 * full, and letting marks overlap buried a log under the next one.
 *
 * Urges take no part in that. Nothing is done with a past urge, so it needs no
 * room to be pointed at: it is drawn at its own minute (`offsetAt`), under
 * any log there, and a burst of them reads as the burst it was.
 *
 * And where a log's card opens (`placeCard`): the side of its mark with room
 * for it, inside whatever it is seen through, which its host measures.
 *
 * Pure and DOM-free, and the variations are tested beside it.
 */

import type { Interval, Ms } from '@/domain/types'

/**
 * Whether an instant written into a block spanning `whole` belongs on the
 * part of it that is drawn, `shown`.
 *
 * Only a cut drops anything. The calendar stops at midnight, so a block that
 * ran across it is drawn in two days, and each day draws only its own side of
 * the cut: a minute after midnight is tomorrow's from midnight on, and a
 * minute before it is yesterday's. Where the drawing reaches the block's own
 * end nothing is dropped, so a line written in the moment after the block
 * ended, before it was banked, is still drawn at its edge.
 */
export function drawnWithin(at: Ms, whole: Interval, shown: Interval): boolean {
  const cutBefore = shown.start > whole.start
  const cutAfter = shown.end < whole.end
  return (!cutBefore || at >= shown.start) && (!cutAfter || at < shown.end)
}

/**
 * Where an instant falls on a block of `height` pixels spanning
 * `[start, end)`, within `[0, height]`: an instant outside the span, written
 * in the moment after the block ended, is drawn at its edge.
 */
export function offsetAt(at: Ms, start: Ms, end: Ms, height: number): number {
  const span = end - start
  const offset = span > 0 ? ((at - start) / span) * height : 0
  return Math.min(height, Math.max(0, offset))
}

/** Logs sharing one mark: indexes into the list, `first` to `last` inclusive. */
export type Run = { first: number; last: number }

/**
 * The marks a block's logs are drawn as: one per log where `height` holds
 * them all at least `minGap` apart, and otherwise as few runs of neighbours
 * sharing a mark as it takes to fit. The two logs nearest each other — the
 * end of one run and the start of the next, in pixels — join first, the
 * earlier pair on a tie, so a cluster is grouped before logs that stand
 * apart are. The instants are expected oldest first, as a block keeps them.
 *
 * A run is drawn at its first log (`markOffsets` of each run's first
 * instant), which holds them at `minGap` because there are no more runs than
 * fit.
 */
export function stackRuns(
  instants: readonly Ms[],
  start: Ms,
  end: Ms,
  height: number,
  minGap: number,
): Run[] {
  const fits = Math.floor(Math.max(0, height) / minGap) + 1
  const at = (i: number) => offsetAt(instants[i]!, start, end, height)
  const runs: Run[] = instants.map((_, i) => ({ first: i, last: i }))
  while (runs.length > fits) {
    const gap = (i: number) => at(runs[i + 1]!.first) - at(runs[i]!.last)
    let nearest = 0
    for (let i = 1; i < runs.length - 1; i++) {
      if (gap(i) < gap(nearest)) nearest = i
    }
    runs.splice(nearest, 2, { first: runs[nearest]!.first, last: runs[nearest + 1]!.last })
  }
  return runs
}

/**
 * Pixel offsets from the top of a block of `height` pixels spanning
 * `[start, end)`, one per instant, in the order given, each within
 * `[0, height]` and at least `minGap` apart where the block holds them so —
 * `stackRuns` sees that it does. The instants are expected oldest first.
 */
export function markOffsets(
  instants: readonly Ms[],
  start: Ms,
  end: Ms,
  height: number,
  minGap: number,
): number[] {
  if (instants.length === 0) return []
  const clamp = (v: number) => Math.min(height, Math.max(0, v))
  const ideal = instants.map((at) => offsetAt(at, start, end, height))

  // Down from the top: each at least `minGap` below the one before it.
  const offsets: number[] = []
  for (const [i, want] of ideal.entries()) {
    offsets.push(i === 0 ? want : Math.max(want, offsets[i - 1]! + minGap))
  }
  // Back up from the bottom where that ran past the end of the block.
  for (let i = offsets.length - 1; i >= 0; i--) {
    const ceiling = i === offsets.length - 1 ? height : offsets[i + 1]! - minGap
    offsets[i] = Math.min(offsets[i]!, ceiling)
  }
  return offsets.map(clamp)
}

/** A rectangle as the browser measures one, every side from the same origin. */
export type Box = { left: number; top: number; right: number; bottom: number }

/** Where a mark's card goes, in the coordinates of the boxes it was worked out from. */
export type CardPlace = {
  left: number
  width: number
  /**
   * Which way it opens from its mark, and the edge it is held by: its top
   * opening down, its bottom opening up.
   */
  opens: 'up' | 'down'
  edge: number
  maxHeight: number
}

/** How far a card keeps in from the edge of what is visible. */
const CARD_MARGIN = 4

/**
 * Where a mark's card opens, given the mark's target and the box it is seen
 * through — the calendar's scrolling column or the mini window's body — so
 * the card is kept where it can be read and its controls reached, rather than
 * at a fixed size in a fixed direction that the window, a scroll or a crowded
 * lane can cut off.
 *
 * Beside a mark on a block's edge (`beside`), the card opens over the block,
 * toward whichever side has room for it, or the most room; on a strip, above
 * or below it, sliding along to stay in view. Down or up is chosen the same
 * way, and the card is no taller or wider than the room on the side it took,
 * scrolling inside itself if its words need more. Either way it reaches a few
 * pixels into the target, so the pointer can cross from one to the other
 * without a gap that would close it.
 */
export function placeCard(
  target: Box,
  clip: Box,
  beside: boolean,
  size: { width: number; height: number },
): CardPlace {
  const inside = {
    left: clip.left + CARD_MARGIN,
    top: clip.top + CARD_MARGIN,
    right: clip.right - CARD_MARGIN,
    bottom: clip.bottom - CARD_MARGIN,
  }

  if (beside) {
    const toLeft = target.left + 4 - inside.left
    const toRight = inside.right - (target.right - 4)
    const leftward = toLeft >= size.width || toLeft >= toRight
    const width = Math.max(0, Math.min(size.width, leftward ? toLeft : toRight))
    const below = inside.bottom - target.top
    const above = target.bottom - inside.top
    const down = below >= size.height || below >= above
    return {
      left: leftward ? target.left + 4 - width : target.right - 4,
      width,
      opens: down ? 'down' : 'up',
      edge: down ? target.top : target.bottom,
      maxHeight: Math.max(0, Math.min(size.height, down ? below : above)),
    }
  }

  const above = target.top + 2 - inside.top
  const below = inside.bottom - (target.bottom - 2)
  const up = above >= size.height || above >= below
  const width = Math.max(0, Math.min(size.width, inside.right - inside.left))
  const wanted =
    (target.left + target.right) / 2 < (inside.left + inside.right) / 2
      ? target.left + 4
      : target.right - 4 - width
  return {
    left: Math.min(Math.max(wanted, inside.left), inside.right - width),
    width,
    opens: up ? 'up' : 'down',
    edge: up ? target.top + 2 : target.bottom - 2,
    maxHeight: Math.max(0, Math.min(size.height, up ? above : below)),
  }
}
