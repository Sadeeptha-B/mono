/**
 * Arithmetic on one working stretch while it is still wall clock: two "HH:mm"
 * strings, as `RegionShapeEditor` drafts them.
 *
 * The rule worth a module is what a new start does to the end. Moving a
 * stretch is almost always what changing its start means — the morning starts
 * at ten today rather than nine — and a form that leaves the end where it was
 * answers a different question, shortening the stretch by an hour that the
 * user then has to give back by hand. So the end follows, keeping the length
 * the stretch had, and stops at 23:59: regions never wrap past midnight (see
 * `regionsForDay`), so a stretch pushed into the night is cut there rather
 * than carried into tomorrow.
 *
 * Kept as minutes and strings rather than resolved to instants, because the
 * routine page edits the same shape with no day attached. A DST shift inside a
 * stretch is the planner's business once the draft is resolved, not this one's.
 */

import { isWallClock } from '@/domain/recurrence'
import type { DefaultRegion } from '@/domain/types'

/** The last minute a stretch may end on: regions stop at midnight. */
const LAST_MINUTE = 23 * 60 + 59

/** "HH:mm" as minutes past midnight, or null for anything else. */
const minutesOf = (hhmm: string): number | null => {
  if (!isWallClock(hhmm)) return null
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * How long a stretch runs, in minutes, or null when it is not a stretch yet —
 * a field half typed or cleared, or an end at or before the start. Null is the
 * signal not to carry anything: there is no length worth keeping in a stretch
 * that does not run forwards.
 */
export function lengthOf(region: DefaultRegion): number | null {
  const start = minutesOf(region.start)
  const end = minutesOf(region.end)
  return start === null || end === null || end <= start ? null : end - start
}

/**
 * The stretch with a new start, its end moved to keep `length` and capped at
 * 23:59. With no length to keep, or a start that is not a time, only the start
 * changes and the end is left exactly as it was written.
 */
export function withStart(
  region: DefaultRegion,
  start: string,
  length: number | null,
): DefaultRegion {
  const from = minutesOf(start)
  if (from === null || length === null) return { ...region, start }
  return { start, end: toHHMM(Math.min(from + length, LAST_MINUTE)) }
}

/** A two-hour stretch beginning where the previous one ended. */
export function nextAfter(end: string): DefaultRegion {
  const [h = 0, m = 0] = end.split(':').map(Number)
  const startMinutes = Math.min(h * 60 + m, 22 * 60)
  const endMinutes = Math.min(startMinutes + 120, LAST_MINUTE)
  return { start: toHHMM(startMinutes), end: toHHMM(endMinutes) }
}
