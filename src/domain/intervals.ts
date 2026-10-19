/**
 * Arithmetic on half-open stretches of time, `[start, end)`.
 *
 * The planner fills what is left of the working hours once commitments and
 * pinned breaks are taken out, and `breakRoom` asks the same question of where
 * a break can go; both are this file. It holds no rule about what any stretch
 * is — that belongs to the callers — only what overlapping, merging and taking
 * away mean, so the two cannot come to disagree about them.
 *
 * Pure, like everything in this folder.
 */

import type { Interval } from './types'

/**
 * Do these two stretches want any of the same minutes?
 *
 * Half-open, like `Interval` says: a thing ending at ten and a thing starting
 * at ten are clear of each other, not touching. That is what makes a break
 * pinned to the minute a meeting ends legal, and it should be — the whole
 * reason to care about an overlap is time that cannot be spent twice.
 */
export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end

/** Sort, then coalesce anything that touches or overlaps. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)

  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

/** `span` minus every interval in `busy`. Assumes `busy` is already merged. */
export function subtractIntervals(span: Interval, busy: readonly Interval[]): Interval[] {
  const free: Interval[] = []
  let cursor = span.start

  for (const interval of busy) {
    if (interval.end <= cursor) continue
    if (interval.start >= span.end) break
    if (interval.start > cursor) {
      free.push({ start: cursor, end: Math.min(interval.start, span.end) })
    }
    cursor = Math.max(cursor, interval.end)
    if (cursor >= span.end) break
  }

  if (cursor < span.end) free.push({ start: cursor, end: span.end })
  return free.filter((i) => i.end > i.start)
}
