/**
 * When a recurring commitment comes round, and what it looks like on a day.
 *
 * A series is a rule, and a day's occurrence of it is a pure function of that
 * rule and the day — never a row written ahead of time. That is the planner's
 * first invariant reaching one step further back: there is no stored schedule
 * of standups for anything to keep in step with the rule, so editing the rule
 * cannot leave last week's copy of it behind on Thursday. `commitmentsFor` in
 * `events.ts` is where the day's own edits and skips are laid over this.
 *
 * Three shapes of rule, on purpose (`Repeat`): every N days, every N weeks on
 * some weekdays, every N months on a date. Between them they say "every
 * weekday", "Tuesdays and Thursdays", "fortnightly on Monday" and "on the 1st",
 * which is nearly everything a working day is fixed around. An RRULE says much
 * more, and every extra thing it can say is a form field nobody fills in and a
 * case the day has to be tested against. "The first Monday" was left out for
 * the same reason; it is the obvious next shape if one is ever wanted.
 *
 * Day arithmetic is done on calendar-day numbers (days since 1970-01-01, by
 * the date alone) rather than on instants. "Every other day" counts dates, and
 * a count of 24-hour spans would slip by one across a DST shift. Instants only
 * appear at the very end, where `occurrenceOn` resolves the wall-clock time on
 * the local day — exactly as `regionsForDay` does for working hours.
 */

import { format } from 'date-fns'

import { dayKey, wallClockOn, type DayKey } from './time'
import type { Commitment, Ms, RecurringCommitment, Repeat, Weekday } from './types'

const DAY_MS = 86_400_000

/** Monday first, which is how a working week is read. */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

/** Monday to Friday: what "every weekday" means. */
export const WORKWEEK: readonly Weekday[] = [1, 2, 3, 4, 5]

/** "Mon" … "Sun", indexed by `Weekday`. */
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * A local calendar day as a count of days, or null if the string is not a
 * real date. Round-tripped, so "2026-02-30" is refused rather than read as
 * the 2nd of March.
 */
export function dayNumber(day: DayKey): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const date = Number(match[3])
  const t = Date.UTC(year, month, date)
  const back = new Date(t)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month || back.getUTCDate() !== date) {
    return null
  }
  return t / DAY_MS
}

/** Whether a string names a real calendar day in Mono's `yyyy-MM-dd` form. */
export const isDayKey = (value: string): boolean => dayNumber(value) !== null

/** Whether a string is a wall-clock time in the "HH:mm" a time field produces. */
export const isWallClock = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

const partsOf = (n: number) => {
  const d = new Date(n * DAY_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    weekday: d.getUTCDay() as Weekday,
  }
}

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

/** The Monday of the week a day falls in, as a day number. */
const mondayOf = (n: number): number => n - ((partsOf(n).weekday + 6) % 7)

/**
 * Whether the series happens on this day.
 *
 * Every count starts from `startsOn`: every other day is every other day from
 * the first one, and every other week is every other week from the week the
 * series began in, whichever of its weekdays that first week had. A monthly
 * date that a month does not have — the 31st in April — falls on that month's
 * last day rather than being skipped, because "the end of the month" is what
 * someone who chose the 31st nearly always meant.
 */
export function occursOn(rule: RecurringCommitment, day: DayKey): boolean {
  const n = dayNumber(day)
  const start = dayNumber(rule.startsOn)
  if (n === null || start === null || n < start) return false
  if (rule.endsOn !== undefined) {
    const end = dayNumber(rule.endsOn)
    if (end !== null && n > end) return false
  }

  const interval = Math.max(1, Math.floor(rule.repeat.interval))
  const repeat = rule.repeat
  switch (repeat.every) {
    case 'day':
      return (n - start) % interval === 0

    case 'week': {
      if (!repeat.weekdays.includes(partsOf(n).weekday)) return false
      return ((mondayOf(n) - mondayOf(start)) / 7) % interval === 0
    }

    case 'month': {
      const here = partsOf(n)
      const first = partsOf(start)
      const months = (here.year - first.year) * 12 + (here.month - first.month)
      if (months % interval !== 0) return false
      return here.date === Math.min(repeat.monthDay, daysInMonth(here.year, here.month))
    }
  }
}

/**
 * The id of one day's occurrence of a series.
 *
 * Derived, never generated: the same series on the same day is the same id on
 * every derive, so the calendar's React keys hold still and an edit made to
 * today's standup can name it. `@` cannot appear in an id `newId` makes, so
 * one of these is never mistaken for a commitment typed in by hand.
 */
export const occurrenceId = (ruleId: string, day: DayKey): string => `${ruleId}@${day}`

/**
 * The series' occurrence on the local day containing `at`, or null when it
 * does not happen that day. A commitment like any other, carrying the series
 * it came from.
 */
export function occurrenceOn(rule: RecurringCommitment, at: Ms): Commitment | null {
  const day = dayKey(at)
  if (!occursOn(rule, day)) return null
  const startsAt = wallClockOn(at, rule.time)
  if (startsAt === null) return null
  return {
    id: occurrenceId(rule.id, day),
    title: rule.title,
    startsAt,
    durationMin: rule.durationMin,
    ...(rule.prepMin === undefined ? {} : { prepMin: rule.prepMin }),
    ...(rule.recoverMin === undefined ? {} : { recoverMin: rule.recoverMin }),
    recurringId: rule.id,
  }
}

/** How far ahead `upcoming` looks: long enough for a yearly series to come round twice. */
const SEARCH_DAYS = 800

/** The next few times a series comes round, and whether it ever will again. */
export type Upcoming = {
  /** Up to the number asked for, soonest first. */
  next: Commitment[]
  /**
   * True once the search has walked past the series' last day: whatever `next`
   * holds is all there will ever be. False with `next` empty means only that
   * nothing fell inside the search, which a series written in this app cannot
   * do but an imported one with a vast interval can, so the two are told apart
   * rather than every empty answer being read as "it has ended".
   */
  ended: boolean
}

/**
 * The next few times the series comes round, from `from` on — today's
 * included while it is still ahead — and whether that is the last of it.
 *
 * For showing someone what a rule they wrote means, which is the only check
 * there is on a fortnightly rule anchored to the wrong week. The walk starts at
 * the later of today and the series' first day, so a series that starts in
 * three years is shown starting in three years rather than falling outside a
 * window measured from now, and it stops at the series' last day or after
 * `SEARCH_DAYS`, whichever is first, rather than walking the calendar for ever.
 */
export function upcoming(rule: RecurringCommitment, from: Ms, count: number): Upcoming {
  const today = dayNumber(dayKey(from))
  const first = dayNumber(rule.startsOn)
  if (today === null || first === null) return { next: [], ended: false }
  const last = rule.endsOn === undefined ? null : dayNumber(rule.endsOn)

  const start = Math.max(today, first)
  const stop = start + SEARCH_DAYS
  const next: Commitment[] = []
  let n = start
  for (; n < stop && (last === null || n <= last) && next.length < count; n++) {
    const { year, month, date } = partsOf(n)
    // Noon, so the day is the intended one whatever DST does at either end.
    const occurrence = occurrenceOn(rule, new Date(year, month, date, 12).getTime())
    if (occurrence !== null && occurrence.startsAt >= from) next.push(occurrence)
  }
  // Ended when the walk ran out of series rather than out of patience or of
  // occurrences wanted — including a series whose last day is already behind.
  const ended = last !== null && n > last && next.length < count
  return { next, ended }
}

const sameDays = (a: readonly Weekday[], b: readonly Weekday[]): boolean =>
  a.length === b.length && a.every((d) => b.includes(d))

const ordinal = (n: number): string => {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

/**
 * The rule in words: "Every weekday", "Every 2 weeks on Mon, Thu", "Every
 * month on the 31st, or its last day". One wording, shared by the page that
 * writes series and the day that shows them, so the two cannot describe the
 * same standup differently.
 */
export function describeRepeat(repeat: Repeat): string {
  const n = Math.max(1, Math.floor(repeat.interval))
  switch (repeat.every) {
    case 'day':
      return n === 1 ? 'Every day' : `Every ${n} days`

    case 'week': {
      const days = WEEK_ORDER.filter((d) => repeat.weekdays.includes(d))
      if (n === 1 && sameDays(days, WEEK_ORDER)) return 'Every day'
      if (n === 1 && sameDays(days, WORKWEEK)) return 'Every weekday'
      const every = n === 1 ? 'Every week' : `Every ${n} weeks`
      return `${every} on ${days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`
    }

    case 'month': {
      const every = n === 1 ? 'Every month' : `Every ${n} months`
      const short = repeat.monthDay > 28 ? ', or its last day' : ''
      return `${every} on the ${ordinal(repeat.monthDay)}${short}`
    }
  }
}

/**
 * "Thu 20 Aug": how the page lists the days a series is coming round on, with
 * the year added ("Tue 20 Aug 2029") once it is not this one — a series can
 * start years ahead, and a bare date would read as this year's.
 */
export const formatOccurrenceDay = (at: Ms, now: Ms): string =>
  format(at, new Date(at).getFullYear() === new Date(now).getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy')
