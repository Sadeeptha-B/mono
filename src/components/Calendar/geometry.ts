/**
 * Where things go on the calendar's axis, in pixels, as pure arithmetic.
 *
 * An hour is the same height on every screen, because a 45-minute block
 * looking like 45 minutes is the reason the day is drawn against an axis at
 * all. Everything here turns instants into offsets against the top of that
 * axis (`yAt`) and lengths into heights (`pxFor`), so the blocks, the hour
 * rows, the work bands, the now line and the label a drag carries cannot come
 * to disagree about where a minute is. No React: what is drawn where is a
 * function of the timeline, and testable as one.
 */

import { dayBounds } from '@/domain/time'
import type { Interval, Ms, Timeline, TimelineEntry } from '@/domain/types'

export const HOUR_PX = 96
export const HOUR_MS = 3_600_000
export const GUTTER_PX = 52
/** Headroom so the first hour label is not clipped by the scroll container. */
export const TOP_PAD_PX = 12

/** How far down the axis `at` is drawn, on an axis starting at `rangeStart`. */
export const yAt = (at: Ms, rangeStart: Ms): number =>
  TOP_PAD_PX + ((at - rangeStart) / HOUR_MS) * HOUR_PX

/** How tall a stretch of `ms` is drawn. */
export const pxFor = (ms: Ms): number => (ms / HOUR_MS) * HOUR_PX

/** How long a stretch `px` tall is: the axis's scale, the other way round. */
export const msFor = (px: number): Ms => (px / HOUR_PX) * HOUR_MS

export type Placed = {
  key: string
  entry: TimelineEntry
  /** Clipped to the visible day — see `layout`. The entry keeps the truth. */
  top: number
  height: number
  /** The stretch of time `top` and `height` draw: the entry's, clipped the same way. */
  shown: Interval
  lane: number
  lanes: number
}

/**
 * Where everything on the day goes, and the stretch of it the axis draws.
 *
 * `reach` widens that stretch while a drag is held at its end, so what is
 * being carried can go where nothing is drawn yet (`useCalendarDrag`).
 */
export function layout(timeline: Timeline, now: Ms, reach: Interval | null = null) {
  // Margins are dropped: on a time axis an empty gap already reads as empty,
  // and drawing a box labelled "nothing" only adds noise.
  const entries = timeline.entries.filter((e) => e.kind !== 'margin')

  /**
   * Where the axis starts, and the only judgement in this function.
   *
   * `now` and the entries hold it open; a work region does not. Open Mono at
   * two o'clock against a nine-to-six day and the region alone used to drag the
   * top of the grid back to nine, for five hours that hold nothing — you were
   * not using Mono in them, so there is nothing to draw and nothing to read.
   * Beside the stage that was merely dead scroll above the part you came to
   * see, hidden by the column scrolling itself to `now` on mount. Stacked under
   * the stage on a phone, where nothing scrolls itself, it was the entire first
   * screenful of calendar: an empty grid, under a heading that says Today, for a
   * day that is in fact full. The timeline looked broken.
   *
   * Only genuinely empty hours go. Anything that happened up there — a block
   * banked this morning, a meeting already sat through, a break taken — is an
   * entry, and entries still reach back as far as they need to. The region
   * bands are clipped to what is left rather than positioned outside it, which
   * is the job the region starts used to be doing here.
   */
  const ends = [
    ...entries.map((e) => e.endsAt),
    ...timeline.regions.map((r) => r.end),
    ...(reach ? [reach.end] : []),
  ]
  const earliest = Math.min(now, ...entries.map((e) => e.startsAt), reach?.start ?? now)
  const latest = Math.max(timeline.horizon, now, ...(ends.length ? ends : [now]))

  /**
   * Midnight is the wall, at both ends.
   *
   * The planner scopes the day by when a thing *starts*, which is the right
   * question to ask of a commitment — and leaves the two ways a span can reach
   * out of the day it started in. A one-minute-past-midnight meeting with half
   * an hour of getting ready begins at twenty to twelve *yesterday*, and that
   * one entry used to drag the whole axis back across the night; a late one
   * with travel after it reaches the other way. Both are legitimate things to
   * write down, so neither is refused — the day simply stops where the day
   * stops, and what is left of the entry is drawn against the edge.
   *
   * The clipping is on the drawing, not on the entry. `startsAt` and `endsAt`
   * keep saying what the commitment really is, which is what the block's own
   * label reads back, so the axis can be honest about the part it can show
   * without the timeline lying about the part it cannot.
   */
  const day = dayBounds(now)
  const rangeStart = Math.max(floorToHour(earliest), day.start)
  const hourCount = Math.max(
    1,
    Math.ceil((Math.min(latest, day.end) - rangeStart) / HOUR_MS),
  )
  const hours = Array.from({ length: hourCount }, (_, i) => rangeStart + i * HOUR_MS)
  const rangeEnd = rangeStart + hourCount * HOUR_MS

  const placed = assignLanes(entries)
    .map(({ entry, lane, lanes }, index) => {
      // Lanes are assigned on the real spans above, so two entries that overlap
      // only outside the visible day still get columns of their own. That is
      // the honest answer: they do overlap.
      const startsAt = Math.max(entry.startsAt, rangeStart)
      const endsAt = Math.min(entry.endsAt, rangeEnd)

      return {
        key: keyFor(entry, index),
        entry,
        top: yAt(startsAt, rangeStart),
        height: pxFor(endsAt - startsAt),
        shown: { start: startsAt, end: endsAt },
        lane,
        lanes,
        visible: endsAt > startsAt,
      }
    })
    // Nothing of it falls inside today. The entry is still in the timeline —
    // this is the drawing declining to draw a box of no height.
    .filter((item) => item.visible)

  return { rangeStart, rangeEnd, hours, placed }
}

/**
 * The same block drawn over another stretch — where a drag would put it —
 * clipped to the axis as `layout` clips, in the lane it already has.
 */
export function placedAt(item: Placed, at: Interval, rangeStart: Ms, rangeEnd: Ms): Placed {
  const start = Math.min(Math.max(at.start, rangeStart), rangeEnd)
  const end = Math.max(Math.min(at.end, rangeEnd), start)
  return {
    ...item,
    top: yAt(start, rangeStart),
    height: pxFor(end - start),
    shown: { start, end },
  }
}

/**
 * Side-by-side columns for anything that overlaps.
 *
 * The planner guarantees blocks never collide with commitments, but a
 * commitment added *during* a running block legitimately does — that is the
 * case the user resolves by hand. Lanes are counted per overlapping cluster so
 * one collision late in the day does not narrow every block above it.
 */
function assignLanes(entries: readonly TimelineEntry[]) {
  const sorted = [...entries].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)
  const result: { entry: TimelineEntry; lane: number; lanes: number }[] = []

  let cluster: { entry: TimelineEntry; lane: number }[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const lanes = cluster.reduce((max, c) => Math.max(max, c.lane + 1), 1)
    for (const c of cluster) result.push({ ...c, lanes })
    cluster = []
    clusterEnd = -Infinity
  }

  for (const entry of sorted) {
    if (entry.startsAt >= clusterEnd) flush()

    const laneEnds: number[] = []
    for (const c of cluster) {
      laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.entry.endsAt)
    }
    let lane = laneEnds.findIndex((end) => end <= entry.startsAt)
    if (lane === -1) lane = laneEnds.length

    cluster.push({ entry, lane })
    clusterEnd = Math.max(clusterEnd, entry.endsAt)
  }
  flush()

  return result
}

const floorToHour = (at: Ms): Ms => {
  const d = new Date(at)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

function keyFor(entry: TimelineEntry, index: number): string {
  switch (entry.kind) {
    // One key for a segment whether it is running or over: the block that
    // ends is the block that ran, and drawing it as a new one at that moment
    // threw away what its marks were holding, an edit under way included.
    case 'past':
    case 'active':
      return `segment-${entry.segment.id}`
    case 'commitment':
      return `commit-${entry.commitment.id}`
    case 'commitment-margin':
      return `commit-${entry.commitment.id}-${entry.side}`
    case 'planned-break':
      return `break-${entry.id}`
    case 'planned-block':
      return entry.id
    case 'margin':
      return `margin-${index}`
  }
}
