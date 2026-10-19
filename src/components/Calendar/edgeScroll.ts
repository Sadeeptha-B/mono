/**
 * How a drag held near an edge of what scrolls the day scrolls it, and grows
 * the day once there is nothing left to scroll.
 *
 * Near the top of what is seen of the day the drag scrolls up, near the bottom
 * down, faster the nearer the edge and at full speed on it or past it. But an
 * edge is *armed* only once the pointer has been clear of its zone since the
 * drag began. A block picked up near the top of the column and pulled down
 * used to set the column scrolling up at once, against the way it was going,
 * because the press itself was in the top zone. Now the zone it starts in is
 * asleep until the pointer has left it and come back, which is what reaching
 * for an edge looks like.
 *
 * Once the day is scrolled as far as it goes, holding the edge grows the axis
 * an hour at a time towards it, up to midnight (`grownAxis`).
 *
 * The rules are pure — pixels and instants in, pixels and instants out — so
 * they can be tested without a browser, `scrollStep` among them. The two
 * readers of the page at the foot (`scrollsItself`, `dayScroller`) are what
 * measures it for them, and `useCalendarDrag` does the scrolling.
 */

import { HOUR_MS } from './geometry'
import type { Interval } from '@/domain/types'

/** How near an edge of what scrolls the day a drag starts scrolling it. */
export const EDGE_PX = 40
/** How far it scrolls a frame with the pointer at, or past, the edge itself. */
export const EDGE_STEP_PX = 14

/** The part of what scrolls the day that is on screen, in viewport pixels. */
export type Seen = { top: number; bottom: number }

/** Which edges a drag may scroll towards. */
export type Armed = { top: boolean; bottom: boolean }

/**
 * The edges armed for a drag whose pointer is now at `y`: any already armed,
 * and any whose zone the pointer is clear of. Asked when the drag begins, so
 * an edge the press was nowhere near is armed from the start, and again on
 * every move.
 */
export function armedAt(armed: Armed | null, y: number, seen: Seen): Armed {
  return {
    top: (armed?.top ?? false) || y >= seen.top + EDGE_PX,
    bottom: (armed?.bottom ?? false) || y <= seen.bottom - EDGE_PX,
  }
}

/**
 * How far to scroll this frame for a pointer at `y`: negative up, positive
 * down, zero between the zones or towards an edge not armed.
 */
export function edgeStep(y: number, seen: Seen, armed: Armed): number {
  const speed = (depth: number) =>
    Math.max(1, Math.round(EDGE_STEP_PX * Math.min(1, depth / EDGE_PX)))
  if (armed.top && y < seen.top + EDGE_PX) return -speed(seen.top + EDGE_PX - y)
  if (armed.bottom && y > seen.bottom - EDGE_PX) return speed(y - (seen.bottom - EDGE_PX))
  return 0
}

/**
 * How far to actually scroll for a step asked for, given the room left
 * towards it: never past the end of the day (`dayScroller`), and zero once
 * there is none, which is when the day grows instead.
 */
export function scrollStep(step: number, room: { up: number; down: number }): number {
  const by = step < 0 ? Math.max(step, -room.up) : Math.min(step, room.down)
  // No room up is 0, not -0, for whoever compares it.
  return by === 0 ? 0 : by
}

/**
 * The axis grown one hour towards the edge held, within `day`, or null when
 * that edge is already at midnight.
 */
export function grownAxis(base: Interval, day: Interval, earlier: boolean): Interval | null {
  const next = earlier
    ? { start: Math.max(day.start, base.start - HOUR_MS), end: base.end }
    : { start: base.start, end: Math.min(day.end, base.end + HOUR_MS) }
  return next.start === base.start && next.end === base.end ? null : next
}

/**
 * Whether the column scrolls the day itself, as it does beside the stage,
 * rather than being as tall as the day inside a page that scrolls. Asked of
 * how it is styled, not of whether it overflows: a short day beside the stage
 * still ends at the column's edges, not the window's.
 */
export function scrollsItself(column: HTMLElement | null): column is HTMLElement {
  if (column === null) return false
  const { overflowY } = getComputedStyle(column)
  return overflowY === 'auto' || overflowY === 'scroll'
}

/**
 * What scrolls the day, and how far: the column, or null for the page; the
 * part of the day on screen; and how much further it can be scrolled up or
 * down before that end of the day is in view.
 *
 * Bounded by the day in both cases, not only beside the stage. Stacked under
 * it, what scrolls is the page, and the page goes on above the calendar into
 * the stage: measured by the page, a drag held at the top scrolled up past
 * the start of the day and on into the stage, leaving the block it held
 * below the bottom of the screen, and only grew the day once the page had
 * nothing left above it. Measured by the day (`axis`), the page stops where
 * the day's first hour comes into view, which is where growing it begins.
 */
export function dayScroller(
  column: HTMLElement | null,
  axis: HTMLElement | null,
): { column: HTMLElement | null; seen: Seen; room: { up: number; down: number } } {
  if (scrollsItself(column)) {
    const rect = column.getBoundingClientRect()
    return {
      column,
      seen: { top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, window.innerHeight) },
      room: roomOf(column.scrollTop, column.scrollHeight - column.clientHeight - column.scrollTop),
    }
  }
  const day = axis?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
  const page = document.scrollingElement ?? document.documentElement
  return {
    column: null,
    seen: { top: Math.max(day.top, 0), bottom: Math.min(day.bottom, window.innerHeight) },
    room: roomOf(
      Math.min(-day.top, window.scrollY),
      Math.min(
        day.bottom - window.innerHeight,
        page.scrollHeight - window.innerHeight - window.scrollY,
      ),
    ),
  }
}

/**
 * Whole pixels only, and none under one: a scroll position can be fractional,
 * and half a pixel of room left is a step that moves nothing, frame after
 * frame, while the day waits to grow.
 */
const roomOf = (up: number, down: number) => ({
  up: Math.max(0, Math.floor(up)),
  down: Math.max(0, Math.floor(down - 1)),
})
