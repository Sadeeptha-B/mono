import { describe, expect, it } from 'vitest'

import {
  dayKey,
  formatDuration,
  formatTimer,
  isWithinRegions,
  nextRegionStart,
  regionsForDay,
  wallClockOn,
} from './time'

const BASE_DAY = new Date(2026, 7, 20)

function at(hour: number, minute = 0): number {
  const d = new Date(BASE_DAY)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

describe('dayKey', () => {
  it('identifies the local calendar day', () => {
    expect(dayKey(at(14))).toBe('2026-08-20')
  })

  it('changes at local midnight, not UTC midnight', () => {
    expect(dayKey(at(23, 59))).toBe('2026-08-20')
    expect(dayKey(at(23, 59) + 60_000)).toBe('2026-08-21')
  })
})

describe('wallClockOn', () => {
  it('resolves an HH:mm setting against the day containing the instant', () => {
    expect(wallClockOn(at(14), '18:00')).toBe(at(18))
    expect(wallClockOn(at(14), '09:30')).toBe(at(9, 30))
  })

  it('returns null for a malformed time', () => {
    expect(wallClockOn(at(14), 'not a time')).toBeNull()
    expect(wallClockOn(at(14), '')).toBeNull()
  })
})

describe('regionsForDay', () => {
  it('resolves the recurring shape onto the given day', () => {
    expect(
      regionsForDay(at(14), [
        { start: '09:00', end: '12:30' },
        { start: '13:30', end: '18:00' },
      ]),
    ).toMatchObject([
      { startsAt: at(9), endsAt: at(12, 30) },
      { startsAt: at(13, 30), endsAt: at(18) },
    ])
  })

  it('sorts regions by start time regardless of how they were entered', () => {
    const resolved = regionsForDay(at(14), [
      { start: '20:00', end: '22:00' },
      { start: '09:00', end: '12:00' },
    ])
    expect(resolved.map((r) => r.startsAt)).toEqual([at(9), at(20)])
  })

  it.each([
    ['malformed', { start: 'nope', end: '18:00' }],
    ['backwards', { start: '18:00', end: '09:00' }],
    ['empty', { start: '09:00', end: '09:00' }],
  ])('drops a %s region rather than throwing', (_label, bad) => {
    // A typo in settings should cost you that one region, not the whole day.
    expect(regionsForDay(at(14), [bad, { start: '09:00', end: '18:00' }])).toHaveLength(1)
  })

  it('returns nothing for an empty shape, rather than inventing a day', () => {
    expect(regionsForDay(at(14), [])).toEqual([])
  })

  it('produces stable ids so re-deriving does not churn React keys', () => {
    const shape = [{ start: '09:00', end: '18:00' }]
    expect(regionsForDay(at(14), shape)[0]?.id).toBe(regionsForDay(at(16), shape)[0]?.id)
  })
})

describe('isWithinRegions', () => {
  const regions = [
    { start: at(9), end: at(12) },
    { start: at(13), end: at(18) },
  ]

  it.each([
    ['inside the first', at(10), true],
    ['inside the second', at(15), true],
    ['in the gap', at(12, 30), false],
    ['before the day', at(8), false],
    ['after the day', at(19), false],
  ])('is %s -> %s', (_label, instant, expected) => {
    expect(isWithinRegions(instant, regions)).toBe(expected)
  })

  it('treats a region as half-open, so its end is already outside', () => {
    expect(isWithinRegions(at(12), regions)).toBe(false)
    expect(isWithinRegions(at(9), regions)).toBe(true)
  })
})

describe('nextRegionStart', () => {
  const regions = [
    { start: at(9), end: at(12) },
    { start: at(13), end: at(18) },
  ]

  it('finds the next region from inside a gap', () => {
    expect(nextRegionStart(at(12, 30), regions)).toBe(at(13))
  })

  it('returns null once the last region has opened', () => {
    expect(nextRegionStart(at(15), regions)).toBeNull()
  })

  it('finds the first region before the day has begun', () => {
    expect(nextRegionStart(at(7), regions)).toBe(at(9))
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0m'],
    [45 * 60_000, '45m'],
    [60 * 60_000, '1h 00m'],
    [95 * 60_000, '1h 35m'],
    [-5000, '0m'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  it('rounds down, so it never overstates remaining time', () => {
    expect(formatDuration(59_999)).toBe('0m')
  })
})

describe('formatTimer', () => {
  it.each([
    [45 * 60_000, '45:00'],
    [90_000, '1:30'],
    [1000, '0:01'],
    [0, '0:00'],
    [-5000, '0:00'],
    [3600_000, '1:00:00'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatTimer(ms)).toBe(expected)
  })

  it('rounds up, so the face reads 45:00 for a full block rather than 44:59', () => {
    expect(formatTimer(45 * 60_000 - 1)).toBe('45:00')
  })
})
