import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'

import {
  describeRepeat,
  isDayKey,
  isWallClock,
  formatOccurrenceDay,
  upcoming,
  occurrenceOn,
  occursOn,
  WORKWEEK,
} from './recurrence'
import type { RecurringCommitment, Repeat } from './types'

/** 2026-08-20 is a Thursday. */
const series = (repeat: Repeat, extra: Partial<RecurringCommitment> = {}): RecurringCommitment => ({
  id: 'series',
  title: 'Standup',
  time: '09:00',
  durationMin: 15,
  repeat,
  startsOn: '2026-08-20',
  ...extra,
})

/** Which of these days the series happens on. */
const daysOf = (rule: RecurringCommitment, days: string[]) => days.filter((d) => occursOn(rule, d))

describe('a daily series', () => {
  it('happens every day from its first', () => {
    const rule = series({ every: 'day', interval: 1 })
    expect(daysOf(rule, ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'])).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ])
  })

  it('counts every other day from the first, by date', () => {
    const rule = series({ every: 'day', interval: 2 })
    expect(daysOf(rule, ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'])).toEqual([
      '2026-08-20',
      '2026-08-22',
    ])
  })

  it('keeps counting dates across a change of clocks', () => {
    // Both hemispheres' and both continents' changes sit inside these weeks.
    const rule = series({ every: 'day', interval: 2 }, { startsOn: '2026-03-01' })
    expect(occursOn(rule, '2026-04-04')).toBe(true)
    expect(occursOn(rule, '2026-04-05')).toBe(false)
    expect(occursOn(rule, '2026-11-01')).toBe(false)
    expect(occursOn(rule, '2026-11-02')).toBe(true)
  })
})

describe('a weekly series', () => {
  it('happens on its weekdays, which is what every weekday means', () => {
    const rule = series({ every: 'week', interval: 1, weekdays: [...WORKWEEK] })
    expect(
      daysOf(rule, ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24']),
    ).toEqual(['2026-08-20', '2026-08-21', '2026-08-24'])
  })

  it('counts every other week from the week it starts in', () => {
    // Started on a Thursday, for Mondays and Thursdays: the Monday of the
    // starting week is before it begins, and the next week is skipped.
    const rule = series({ every: 'week', interval: 2, weekdays: [1, 4] })
    expect(
      daysOf(rule, ['2026-08-17', '2026-08-20', '2026-08-24', '2026-08-27', '2026-08-31', '2026-09-03']),
    ).toEqual(['2026-08-20', '2026-08-31', '2026-09-03'])
  })

  it('reads a week as Monday to Sunday', () => {
    // A Sunday belongs to the week before it, so it is in the started week.
    const rule = series({ every: 'week', interval: 2, weekdays: [0] })
    expect(daysOf(rule, ['2026-08-23', '2026-08-30', '2026-09-06'])).toEqual([
      '2026-08-23',
      '2026-09-06',
    ])
  })
})

describe('a monthly series', () => {
  it('happens on its date, every N months from the first', () => {
    const rule = series({ every: 'month', interval: 2, monthDay: 20 })
    expect(daysOf(rule, ['2026-08-20', '2026-09-20', '2026-10-20', '2026-10-21'])).toEqual([
      '2026-08-20',
      '2026-10-20',
    ])
  })

  it('falls on the last day of a month too short for its date', () => {
    const rule = series({ every: 'month', interval: 1, monthDay: 31 }, { startsOn: '2027-01-01' })
    expect(
      daysOf(rule, ['2027-01-31', '2027-02-27', '2027-02-28', '2027-04-30', '2027-05-30']),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-04-30'])
    // And on the 29th in a leap year.
    const leap = series({ every: 'month', interval: 1, monthDay: 30 }, { startsOn: '2028-01-01' })
    expect(daysOf(leap, ['2028-02-28', '2028-02-29'])).toEqual(['2028-02-29'])
  })
})

describe('the bounds of a series', () => {
  it('never happens before it starts or after it ends, the last day included', () => {
    const rule = series({ every: 'day', interval: 1 }, { endsOn: '2026-08-22' })
    expect(
      daysOf(rule, ['2026-08-19', '2026-08-20', '2026-08-22', '2026-08-23']),
    ).toEqual(['2026-08-20', '2026-08-22'])
  })
})

describe("a day's occurrence", () => {
  const thursday = new Date(2026, 7, 20, 14).getTime()

  it('is a commitment at the wall-clock time, with an id derived from the day', () => {
    const rule = series({ every: 'day', interval: 1 }, { prepMin: 5 })
    const occurrence = occurrenceOn(rule, thursday)
    expect(occurrence).toEqual({
      id: 'series@2026-08-20',
      title: 'Standup',
      startsAt: new Date(2026, 7, 20, 9).getTime(),
      durationMin: 15,
      prepMin: 5,
      recurringId: 'series',
    })
    // The same call, the same answer: nothing random, nothing stored.
    expect(occurrenceOn(rule, thursday)).toEqual(occurrence)
  })

  it('is nothing on a day the series does not happen', () => {
    expect(occurrenceOn(series({ every: 'week', interval: 1, weekdays: [1] }), thursday)).toBeNull()
  })

  it('keeps its wall-clock time on a day the clocks change', () => {
    const rule = series({ every: 'day', interval: 1 }, { startsOn: '2026-01-01' })
    for (const day of [
      new Date(2026, 2, 8, 12),
      new Date(2026, 2, 29, 12),
      new Date(2026, 9, 25, 12),
      new Date(2026, 10, 1, 12),
    ]) {
      expect(format(occurrenceOn(rule, day.getTime())!.startsAt, 'HH:mm')).toBe('09:00')
    }
  })
})

describe('the next occurrences', () => {
  const thursdayMorning = new Date(2026, 7, 20, 8).getTime()

  it("lists today's while it is still ahead, then the days after", () => {
    const rule = series({ every: 'week', interval: 1, weekdays: [...WORKWEEK] })
    const early = upcoming(rule, thursdayMorning, 3)
    expect(early.next.map((c) => c.id)).toEqual([
      'series@2026-08-20',
      'series@2026-08-21',
      'series@2026-08-24',
    ])
    expect(early.ended).toBe(false)
    const late = upcoming(rule, new Date(2026, 7, 20, 14).getTime(), 1)
    expect(late.next.map((c) => c.id)).toEqual(['series@2026-08-21'])
  })

  it('stops with what it has once the series ends, and says it has', () => {
    const rule = series({ every: 'day', interval: 1 }, { endsOn: '2026-08-21' })
    expect(upcoming(rule, thursdayMorning, 5)).toMatchObject({ ended: true })
    expect(upcoming(rule, thursdayMorning, 5).next).toHaveLength(2)
    // Already over before today.
    expect(upcoming(rule, new Date(2026, 8, 1, 8).getTime(), 1)).toEqual({ next: [], ended: true })
  })

  it('finds a series that starts years ahead, however far', () => {
    const rule = series({ every: 'month', interval: 1, monthDay: 1 }, { startsOn: '2031-03-01' })
    const { next, ended } = upcoming(rule, thursdayMorning, 2)
    expect(next.map((c) => c.id)).toEqual(['series@2031-03-01', 'series@2031-04-01'])
    expect(ended).toBe(false)
  })

  it('tells nothing inside the search from a series that has ended', () => {
    // No series written here comes round less than yearly, but an imported
    // one can; that is not the same as being over.
    const rule = series({ every: 'day', interval: 5000 }, { startsOn: '2026-08-19' })
    expect(upcoming(rule, thursdayMorning, 1)).toEqual({ next: [], ended: false })
  })
})

describe('a day as the page lists it', () => {
  it('names the year only when it is not this one', () => {
    const now = new Date(2026, 7, 20, 8).getTime()
    expect(formatOccurrenceDay(new Date(2026, 7, 21, 9).getTime(), now)).toBe('Fri 21 Aug')
    expect(formatOccurrenceDay(new Date(2031, 2, 1, 9).getTime(), now)).toBe('Sat 1 Mar 2031')
  })
})

describe('the rule in words', () => {
  it('names the common shapes the way people say them', () => {
    expect(describeRepeat({ every: 'day', interval: 1 })).toBe('Every day')
    expect(describeRepeat({ every: 'day', interval: 3 })).toBe('Every 3 days')
    expect(describeRepeat({ every: 'week', interval: 1, weekdays: [5, 1, 2, 3, 4] })).toBe(
      'Every weekday',
    )
    expect(describeRepeat({ every: 'week', interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      'Every day',
    )
    expect(describeRepeat({ every: 'week', interval: 2, weekdays: [4, 1] })).toBe(
      'Every 2 weeks on Mon, Thu',
    )
    expect(describeRepeat({ every: 'week', interval: 1, weekdays: [0, 6] })).toBe(
      'Every week on Sat, Sun',
    )
    expect(describeRepeat({ every: 'month', interval: 1, monthDay: 1 })).toBe(
      'Every month on the 1st',
    )
    expect(describeRepeat({ every: 'month', interval: 3, monthDay: 31 })).toBe(
      'Every 3 months on the 31st, or its last day',
    )
    expect(describeRepeat({ every: 'month', interval: 1, monthDay: 12 })).toBe(
      'Every month on the 12th',
    )
  })
})

describe('reading what a form or a file says', () => {
  it('accepts only real days and real times', () => {
    expect(isDayKey('2026-08-20')).toBe(true)
    expect(isDayKey('2026-02-30')).toBe(false)
    expect(isDayKey('20/08/2026')).toBe(false)
    expect(isWallClock('09:00')).toBe(true)
    expect(isWallClock('23:59')).toBe(true)
    expect(isWallClock('24:00')).toBe(false)
    expect(isWallClock('9:00')).toBe(false)
  })
})
