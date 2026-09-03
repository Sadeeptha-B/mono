/**
 * The boundary between wall-clock time (what the user types and reads) and
 * epoch milliseconds (what the domain computes with).
 *
 * Everything here resolves against the *local calendar*, which is what makes
 * DST behave: "the day ends at 18:00" means 18:00 on today's calendar, so a
 * day containing a DST shift is genuinely 23 or 25 hours long rather than
 * sliding an hour sideways.
 */

import { format, isValid, parse } from 'date-fns'
import type { DefaultRegion, Interval, Ms, WorkRegion } from './types'

/** Stable identity for a local calendar day, e.g. "2026-08-20". */
export type DayKey = string

export const dayKey = (at: Ms): DayKey => format(at, 'yyyy-MM-dd')

/**
 * Whether two instants fall on the same local calendar day.
 *
 * One definition, because three things ask it and they have to agree: the
 * planner about what to draw, the vitals about what the day has banked, and
 * the store about when to roll over. Local rather than UTC throughout — a day
 * in Mono is the one you are living in.
 */
export const onSameDay = (a: Ms, b: Ms): boolean => dayKey(a) === dayKey(b)

/**
 * Midnight either side of the day an instant falls in.
 *
 * `end` is the next day's midnight rather than 23:59:59.999, so the pair is a
 * half-open interval and arithmetic across it does not lose a millisecond.
 * Built by moving the date and re-flooring rather than by adding 24 hours,
 * which is a different length twice a year.
 */
export function dayBounds(at: Ms): Interval {
  const start = new Date(at)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  end.setHours(0, 0, 0, 0)

  return { start: start.getTime(), end: end.getTime() }
}

/**
 * Resolve an "HH:mm" wall-clock time against the local calendar day
 * containing `at`. Returns `null` if the string is not a valid time.
 */
export function wallClockOn(at: Ms, hhmm: string): Ms | null {
  const parsed = parse(hhmm, 'HH:mm', new Date(at))
  return isValid(parsed) ? parsed.getTime() : null
}

/**
 * Resolve the recurring default shape onto the calendar day containing `now`.
 *
 * Regions that are malformed, empty, or backwards are dropped rather than
 * throwing: a typo in settings should cost you that one region, not the day.
 * Overnight regions are not supported — the plan is scoped to a calendar day,
 * so an evening stretch ends at 23:59 rather than wrapping.
 */
export function regionsForDay(now: Ms, defaults: readonly DefaultRegion[]): WorkRegion[] {
  const resolved: WorkRegion[] = []

  for (const [index, region] of defaults.entries()) {
    const startsAt = wallClockOn(now, region.start)
    const endsAt = wallClockOn(now, region.end)
    if (startsAt === null || endsAt === null || endsAt <= startsAt) continue
    resolved.push({ id: `default-${index}-${region.start}`, startsAt, endsAt })
  }

  return resolved.sort((a, b) => a.startsAt - b.startsAt)
}

/** Whether `at` falls inside any of the regions. */
export const isWithinRegions = (at: Ms, regions: readonly Interval[]): boolean =>
  regions.some((r) => at >= r.start && at < r.end)

/** The next region to open after `at`, or null if the day is done. */
export function nextRegionStart(at: Ms, regions: readonly Interval[]): Ms | null {
  const upcoming = regions.filter((r) => r.start > at).sort((a, b) => a.start - b.start)
  return upcoming[0]?.start ?? null
}

/**
 * The next round half hour after `at` — the default both time fields open on,
 * because "half past" is what people actually say when scheduling something
 * shortly. Always strictly ahead of `at`, so the default is never a moment
 * already gone.
 */
export function nextHalfHour(at: Ms): Ms {
  const d = new Date(at)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() >= 30 ? 60 : 30)
  return d.getTime()
}

/** "2:05 PM" — for the clock and timeline labels. */
export const formatClock = (at: Ms): string => format(at, 'h:mm a')

/** "45m", "1h 05m", "0m" — for durations, never for instants. */
export function formatDuration(ms: Ms): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

/** "12:34" / "1:02:33" — the counting-down timer face. */
export function formatTimer(ms: Ms): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
