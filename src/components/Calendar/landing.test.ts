import { describe, expect, it } from 'vitest'

import { breakLanding, movedStart, pushedPins, pushedReach, SNAP_MS } from './landing'
import { freeTime } from '@/domain/breakRoom'
import type { Commitment, PlannedBreak } from '@/domain/types'

const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m).getTime()
const MIN = 60_000
const axis = { start: at(9), end: at(18) }
const meetingAt = (startsAt: number, durationMin = 60, margins: Partial<Commitment> = {}) => ({
  id: 'm',
  title: 'Meeting',
  startsAt,
  durationMin,
  ...margins,
})

describe('moving a commitment on the calendar', () => {
  it('lands on five minutes of the clock, not five-minute steps from where it was', () => {
    expect(movedStart(meetingAt(at(12, 3)), at(12, 3) + 30 * MIN, axis)).toBe(at(12, 35))
    expect(movedStart(meetingAt(at(12, 3)), at(12, 3) + 26 * MIN, axis)).toBe(at(12, 30))
    expect(SNAP_MS).toBe(5 * MIN)
  })

  it('stays where it was picked up within half a step of it', () => {
    // Snapped to the clock, a 12:03 meeting lifted and put back would be 12:05.
    expect(movedStart(meetingAt(at(12, 3)), at(12, 3) + 2 * MIN, axis)).toBe(at(12, 3))
    expect(movedStart(meetingAt(at(12, 3)), at(12, 3) - 2 * MIN, axis)).toBe(at(12, 3))
  })

  it('moves earlier as readily as later, into the past included', () => {
    // Nothing here knows the time: a meeting that ran early is put right on
    // the record anywhere the axis reaches.
    expect(movedStart(meetingAt(at(12)), at(12) - 90 * MIN, axis)).toBe(at(10, 30))
  })

  it('stays whole on the axis it was dragged along, the time either side included', () => {
    expect(movedStart(meetingAt(at(12)), at(12) - 6 * 60 * MIN, axis)).toBe(at(9))
    expect(movedStart(meetingAt(at(12)), at(12) + 6 * 60 * MIN, axis)).toBe(at(17))

    const travelled = meetingAt(at(12), 60, { prepMin: 30, recoverMin: 20 })
    expect(movedStart(travelled, travelled.startsAt - 6 * 60 * MIN, axis)).toBe(at(9, 30))
    expect(movedStart(travelled, travelled.startsAt + 6 * 60 * MIN, axis)).toBe(at(16, 40))
  })

  it('is never pushed further off an axis too short to hold it', () => {
    // Two hours on an axis of one: it can go no earlier than the top, and no
    // later than it already is.
    const long = meetingAt(at(9, 30), 120)
    const hour = { start: at(9), end: at(10) }
    expect(movedStart(long, long.startsAt + 15 * MIN, hour)).toBe(at(9, 30))
    expect(movedStart(long, long.startsAt - 15 * MIN, hour)).toBe(at(9, 15))
  })
})

describe('moving a break on the calendar', () => {
  // A meeting from twelve to one, its margins included.
  const meeting = [{ start: at(12), end: at(13) }]
  const room = freeTime([axis], meeting, axis.start)

  it('lands where it is dragged, snapped, when nothing is there', () => {
    expect(breakLanding(at(15), at(15) + 32 * MIN, 15 * MIN, room)).toBe(at(15, 30))
  })

  it('stays where it was picked up within half a step of it', () => {
    expect(breakLanding(at(15, 3), at(15, 3) + 2 * MIN, 15 * MIN, room)).toBe(at(15, 3))
  })

  it('goes to the nearer side of a commitment it is dragged onto', () => {
    expect(breakLanding(at(11), at(11) + 65 * MIN, 15 * MIN, room)).toBe(at(11, 45))
    expect(breakLanding(at(11), at(11) + 110 * MIN, 15 * MIN, room)).toBe(at(13))
  })

  it('goes to the nearer side of another break, as of a commitment', () => {
    const withTea = freeTime([axis], [...meeting, { start: at(15), end: at(15, 30) }], axis.start)
    expect(breakLanding(at(14), at(14) + 65 * MIN, 15 * MIN, withTea)).toBe(at(14, 45))
    expect(breakLanding(at(14), at(14) + 80 * MIN, 15 * MIN, withTea)).toBe(at(15, 30))
  })

  it('stays on the axis, the past of it included', () => {
    // Nothing here knows the time: a walk taken early is put right on the
    // record anywhere the axis reaches.
    expect(breakLanding(at(11), at(11) - 6 * 60 * MIN, 15 * MIN, room)).toBe(at(9))
    expect(breakLanding(at(11), at(11) + 9 * 60 * MIN, 15 * MIN, room)).toBe(at(17, 45))
  })

  it('goes outside working hours as readily as in them', () => {
    // The axis here runs on to nine at night; nothing about the hours stops it.
    const evening = freeTime([{ start: at(9), end: at(21) }], meeting, at(9))
    expect(breakLanding(at(17), at(17) + 2 * 60 * MIN, 15 * MIN, evening)).toBe(at(19))
  })
})

describe('the pins a commitment in the air would push', () => {
  const tea: PlannedBreak = { id: 'tea', startsAt: at(15), durationMin: 15 }
  const walk: PlannedBreak = { id: 'walk', startsAt: at(17), durationMin: 30 }
  const meeting = meetingAt(at(11))
  const call = { ...meetingAt(at(16)), id: 'call', title: 'Call' }

  it('are where the reducer would put them, measured against the rest of the day', () => {
    // Dragged to half past two, the meeting lands on the tea, which goes to
    // half past three — past the meeting's own old slot, which it has left,
    // and clear of the call, which it has not.
    const pushed = pushedPins(meeting, at(14, 30), [meeting, call], [tea, walk], at(9))
    expect(pushed).toEqual(
      new Map([
        ['tea', at(15, 30)],
        ['walk', at(17)],
      ]),
    )
  })

  it('leave out a pin it would clear', () => {
    // Under way at ten past three, the tea cannot be moved down: it goes.
    const pushed = pushedPins(meeting, at(14, 30), [meeting], [tea], at(15, 10))
    expect(pushed.has('tea')).toBe(false)
  })
})

describe('the axis a push needs while the commitment is in the air', () => {
  const tea: PlannedBreak = { id: 'tea', startsAt: at(17, 30), durationMin: 15 }
  const walk: PlannedBreak = { id: 'walk', startsAt: at(12), durationMin: 30 }

  it('reaches over every pin it moves, wherever it moves them', () => {
    const pushed = new Map([
      ['tea', at(18)],
      ['walk', at(12)],
    ])
    expect(pushedReach(pushed, [tea, walk])).toEqual({ start: at(18), end: at(18, 15) })
  })

  it('needs nothing when no pin moves, or one is cleared', () => {
    expect(pushedReach(new Map([['tea', at(17, 30)]]), [tea])).toBeNull()
    expect(pushedReach(new Map(), [tea])).toBeNull()
  })
})
