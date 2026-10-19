import { describe, expect, it } from 'vitest'

import {
  breakClash,
  firstRoom,
  freeTime,
  nearestRoom,
  pinLeft,
  pinsMovedOff,
  restTaken,
  roomFor,
  type BreakSurroundings,
} from './breakRoom'
import type { Commitment, CompletedSegment, Ms, PlannedBreak } from './types'

const at = (h: number, m = 0): Ms => new Date(2026, 7, 20, h, m).getTime()
const MIN = 60_000

describe('free time', () => {
  it('is what is left of the stretch from a moment on, less what is taken', () => {
    expect(
      freeTime(
        [{ start: at(9), end: at(18) }],
        [
          { start: at(12), end: at(13) },
          { start: at(17), end: at(19) },
        ],
        at(10),
      ),
    ).toEqual([
      { start: at(10), end: at(12) },
      { start: at(13), end: at(17) },
    ])
  })

  it('reads overlapping stretches as one', () => {
    expect(
      freeTime(
        [
          { start: at(9), end: at(12) },
          { start: at(11), end: at(14) },
        ],
        [],
        at(0),
      ),
    ).toEqual([{ start: at(9), end: at(14) }])
  })
})

describe('the nearest room for a dragged break', () => {
  const free = [
    { start: at(9), end: at(12) },
    { start: at(13), end: at(18) },
  ]

  it('is where it was asked for, when that is free', () => {
    expect(nearestRoom(at(10), 15 * MIN, free)).toBe(at(10))
  })

  it('hops to whichever side of a commitment is nearer', () => {
    // Dragged onto a midday meeting: just before it from the top half, just
    // after it from the bottom.
    expect(nearestRoom(at(12, 5), 15 * MIN, free)).toBe(at(11, 45))
    expect(nearestRoom(at(12, 50), 15 * MIN, free)).toBe(at(13))
  })

  it('skips a gap too short to hold it, and is null with nowhere to go', () => {
    expect(nearestRoom(at(10), 4 * 60 * MIN, free)).toBe(at(13))
    expect(nearestRoom(at(10), 6 * 60 * MIN, free)).toBeNull()
  })
})

describe('the first room after a moment', () => {
  it('is the first free place that holds it', () => {
    const free = [
      { start: at(9), end: at(9, 10) },
      { start: at(10), end: at(11) },
    ]
    expect(firstRoom(at(9), 15 * MIN, free)).toBe(at(10))
    expect(firstRoom(at(10, 50), 15 * MIN, free)).toBeNull()
  })
})

describe('pins a commitment lands on', () => {
  const meeting: Commitment = { id: 'm', title: 'Meeting', startsAt: at(14), durationMin: 60 }
  const tea: PlannedBreak = { id: 'tea', startsAt: at(14, 30), durationMin: 15 }
  const walk: PlannedBreak = { id: 'walk', startsAt: at(16), durationMin: 30 }

  it('move to just after it, and the rest stay where they are', () => {
    expect(pinsMovedOff([tea, walk], meeting, [], at(9))).toEqual([
      { ...tea, startsAt: at(15) },
      walk,
    ])
  })

  it('move in order, one after another rather than on top of each other', () => {
    const coffee: PlannedBreak = { id: 'coffee', startsAt: at(14), durationMin: 10 }
    expect(pinsMovedOff([coffee, tea], meeting, [], at(9))).toEqual([
      { ...coffee, startsAt: at(15) },
      { ...tea, startsAt: at(15, 10) },
    ])
  })

  it('go when nothing before midnight can hold them', () => {
    const late: Commitment = { id: 'late', title: 'Late', startsAt: at(23, 30), durationMin: 25 }
    const nightcap: PlannedBreak = { id: 'n', startsAt: at(23, 40), durationMin: 10 }
    expect(pinsMovedOff([nightcap], late, [], at(9))).toEqual([])
  })

  it('leave the ones already over alone, unless it lands on them', () => {
    // Both are the record of rest that was planned. The meeting put right
    // onto the earlier one says that time went to the meeting instead.
    const early: Commitment = { id: 'early', title: 'Early', startsAt: at(8), durationMin: 30 }
    const skipped: PlannedBreak = { id: 'skipped', startsAt: at(8, 10), durationMin: 15 }
    const kept: PlannedBreak = { id: 'kept', startsAt: at(9), durationMin: 15 }
    expect(pinsMovedOff([skipped, kept], meeting, [], at(11))).toEqual([skipped, kept])
    expect(pinsMovedOff([skipped, kept], early, [], at(11))).toEqual([kept])
  })

  it('clear one already under way, rather than hand back rest already had', () => {
    // Twenty minutes into a half-hour walk, a meeting lands on the rest of it.
    // The walk not yet begun after it still moves.
    const walking: PlannedBreak = { id: 'walking', startsAt: at(13, 50), durationMin: 30 }
    const later: PlannedBreak = { id: 'later', startsAt: at(14, 20), durationMin: 15 }
    expect(pinsMovedOff([walking, later], meeting, [], at(14, 10))).toEqual([
      { ...later, startsAt: at(15) },
    ])
  })
})

describe('what a break runs into', () => {
  const call: Commitment = { id: 'call', title: 'Call', startsAt: at(12), durationMin: 30 }
  const tea: PlannedBreak = { id: 'tea', startsAt: at(15), durationMin: 15 }
  const morning: CompletedSegment = {
    kind: 'block',
    id: 'morning',
    blockKind: 'deep',
    purpose: 'Write',
    startedAt: at(9),
    endedAt: at(9, 45),
    plannedEndsAt: at(9, 45),
    result: 'completed',
    taskIds: [],
    logs: [],
    urges: [],
  }
  const rest: CompletedSegment = {
    kind: 'break',
    id: 'rest',
    startedAt: at(10),
    endedAt: at(10, 15),
    plannedEndsAt: at(10, 15),
  }
  const day: BreakSurroundings = {
    commitments: [call],
    pins: [tea],
    history: [morning, rest],
    active: null,
    at: at(13),
  }
  const span = (h: number, m: number, minutes: number) => ({
    start: at(h, m),
    end: at(h, m) + minutes * MIN,
  })

  it('for a plan, is anything already on the day, and says what', () => {
    expect(breakClash(span(12, 10, 10), 'pin', day)).toEqual({ kind: 'commitment', commitment: call })
    expect(breakClash(span(15, 10, 10), 'pin', day)).toEqual({ kind: 'pin', startsAt: at(15) })
    expect(breakClash(span(9, 30, 10), 'pin', day)).toEqual({
      kind: 'block',
      startsAt: at(9),
      running: false,
    })
    expect(breakClash(span(16, 0, 30), 'pin', day)).toBeNull()
  })

  it('for a plan, is only what an edit newly runs into', () => {
    // The tea is moved ten minutes later, still on itself: nothing new.
    expect(
      breakClash(span(9, 40, 15), 'pin', day, { previous: span(9, 30, 15) }),
    ).toBeNull()
    expect(
      breakClash(span(11, 55, 15), 'pin', day, { previous: span(9, 30, 15) }),
    ).toEqual({ kind: 'commitment', commitment: call })
  })

  it('for a record, is only the rest of the record, and never the future', () => {
    expect(breakClash(span(12, 5, 10), 'record', day)).toBeNull()
    expect(breakClash(span(9, 40, 10), 'record', day, { except: 'rest' })).toEqual({
      kind: 'block',
      startsAt: at(9),
      running: false,
    })
    expect(breakClash(span(12, 55, 10), 'record', day)).toEqual({ kind: 'ahead' })
    expect(
      breakClash(span(10, 5, 15), 'record', day, { except: 'rest', previous: span(10, 0, 15) }),
    ).toBeNull()
  })

  it('for a record, includes whatever is running, until now if it has run over', () => {
    const running: BreakSurroundings = {
      ...day,
      active: {
        kind: 'block',
        id: 'now',
        blockKind: 'deep',
        purpose: null,
        startedAt: at(12),
        endsAt: at(12, 45),
        taskIds: [],
        logs: [],
        urges: [],
      },
    }
    expect(breakClash(span(12, 30, 10), 'record', { ...running, at: at(13) })).toEqual({
      kind: 'block',
      startsAt: at(12),
      running: true,
    })
    expect(breakClash(span(12, 50, 5), 'record', running)).toEqual({
      kind: 'block',
      startsAt: at(12),
      running: true,
    })
  })

  it('for a record, keeps it on the day it was taken', () => {
    const yesterday = span(10, 0, 15)
    const moved = { start: yesterday.start - 24 * 60 * MIN, end: yesterday.end - 24 * 60 * MIN }
    expect(breakClash(moved, 'record', day, { previous: yesterday })).toEqual({
      kind: 'elsewhere',
    })
  })

  it('leaves the room a drag can put each down in', () => {
    const axis = { start: at(9), end: at(18) }
    expect(roomFor('pin', day, axis, 'tea')).toEqual([
      { start: at(9, 45), end: at(10) },
      { start: at(10, 15), end: at(12) },
      { start: at(12, 30), end: at(18) },
    ])
    expect(roomFor('record', day, axis, 'rest')).toEqual([{ start: at(9, 45), end: at(13) }])
  })
})

describe('what of a pin is left once rest is taken over it', () => {
  const tea: PlannedBreak = { id: 'tea', startsAt: at(14), durationMin: 60 }

  it('is all of it, with no rest taken over it', () => {
    expect(pinLeft(tea, [{ start: at(12), end: at(12, 15) }])).toEqual({
      start: at(14),
      end: at(15),
    })
  })

  it('is what comes after the last break taken over it', () => {
    expect(pinLeft(tea, [{ start: at(14), end: at(14, 10) }])).toEqual({
      start: at(14, 10),
      end: at(15),
    })
    expect(
      pinLeft(tea, [
        { start: at(14, 30), end: at(14, 40) },
        { start: at(13, 55), end: at(14, 5) },
      ]),
    ).toEqual({ start: at(14, 40), end: at(15) })
  })

  it('is nothing once a break has run through its end', () => {
    expect(pinLeft(tea, [{ start: at(14, 50), end: at(15, 5) }])).toBeNull()
  })

  it('counts the rest of the day, on the record and running, and nothing else', () => {
    const rest: CompletedSegment = {
      kind: 'break',
      id: 'rest',
      startedAt: at(10),
      endedAt: at(10, 15),
      plannedEndsAt: at(10, 15),
    }
    const DAY = 86_400_000
    const yesterday: CompletedSegment = {
      ...rest,
      id: 'old',
      startedAt: at(10) - DAY,
      endedAt: at(10, 15) - DAY,
    }
    expect(
      restTaken(
        [yesterday, rest],
        { kind: 'break', id: 'now', startedAt: at(14), endsAt: at(14, 15) },
        at(14),
      ),
    ).toEqual([
      { start: at(10), end: at(10, 15) },
      { start: at(14), end: at(14, 15) },
    ])
  })
})
