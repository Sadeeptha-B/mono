/**
 * Editing what is already on the day, and what taking a break does to it.
 *
 * The rest of the log is covered through `machine.test.ts`, which drives the
 * reducer the way the store does. The two edit events have no machine
 * transition behind them — the calendar appends them directly — so they are
 * exercised here, and the cases that earn a test are the ones where a patch
 * behaves differently from a replacement.
 *
 * The break case is here for a different reason: what a pinned break survives
 * is a rule with three different answers depending on the event, and it was
 * wrong for one of them.
 */

import { describe, expect, it } from 'vitest'

import { replay, type MonoEvent } from './events'
import type { Commitment, Ms, PlannedBreak } from './types'

const BASE_DAY = new Date(2026, 7, 20)

function at(hour: number, minute = 0): Ms {
  const d = new Date(BASE_DAY)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

const swim: Commitment = {
  id: 'swim',
  title: 'Swim',
  startsAt: at(16),
  durationMin: 60,
  prepMin: 30,
  recoverMin: 20,
}

const tea: PlannedBreak = { id: 'tea', startsAt: at(15), durationMin: 15 }

/** Quarter past four: inside the hour the swim itself occupies. */
const inPool: PlannedBreak = { id: 'inPool', startsAt: at(16, 15), durationMin: 20 }

const added = (commitment: Commitment): MonoEvent => ({
  type: 'commitment/added',
  at: at(9),
  commitment,
})

const pinned = (plannedBreak: PlannedBreak): MonoEvent => ({
  type: 'break/planned',
  at: at(9),
  plannedBreak,
})

describe('editing a commitment', () => {
  it('changes the one with that id and leaves the rest alone', () => {
    const other: Commitment = {
      id: 'standup',
      title: 'Standup',
      startsAt: at(9, 30),
      durationMin: 15,
    }
    const session = replay([
      added(swim),
      added(other),
      { type: 'commitment/updated', at: at(10), id: 'swim', patch: { startsAt: at(17) } },
    ])

    expect(session.commitments).toEqual([{ ...swim, startsAt: at(17) }, other])
  })

  it('clears a margin when the patch says zero', () => {
    // The trap `readCommitmentEdit` exists for: a patch is merged, so deleting
    // the half hour of travel has to be sent as a zero. Omitting it would keep
    // the old margin while the form insisted it was gone.
    const session = replay([
      added(swim),
      {
        type: 'commitment/updated',
        at: at(10),
        id: 'swim',
        patch: { prepMin: 0, recoverMin: 0 },
      },
    ])

    expect(session.commitments[0]!).toMatchObject({ prepMin: 0, recoverMin: 0 })
  })

  it('drops a pin the moved commitment now covers, and only that one', () => {
    // Swim moves to two o'clock, which with half an hour of getting ready puts
    // its span over the three o'clock tea. The half past five walk is nowhere
    // near it and is left alone — and was clear of the swim where it started
    // too, since the twenty minutes of getting back run to twenty past.
    const walk: PlannedBreak = { id: 'walk', startsAt: at(17, 30), durationMin: 30 }
    const session = replay([
      added(swim),
      pinned(tea),
      pinned(walk),
      { type: 'commitment/updated', at: at(10), id: 'swim', patch: { startsAt: at(14) } },
    ])

    expect(session.overrides.map((b) => b.id)).toEqual(['walk'])
  })

  it('measures against where the meeting ends up, not where it was', () => {
    // The tea is clear of the swim at four and squarely inside it at two, so
    // the edit is decided by where the swim lands rather than by where it was.
    // This is the only direction the question can be asked from now: a pin
    // inside a commitment, waiting to be freed by one moving away, is a state
    // `break/planned` refuses to create — see below.
    const session = replay([
      added(swim),
      pinned(tea),
      { type: 'commitment/updated', at: at(10), id: 'swim', patch: { startsAt: at(14) } },
    ])

    expect(session.overrides).toEqual([])
  })

  it('ignores an id that is not there, pins included', () => {
    const session = replay([
      added(swim),
      pinned(tea),
      { type: 'commitment/updated', at: at(10), id: 'gone', patch: { title: 'Nothing' } },
    ])

    expect(session.commitments).toEqual([swim])
    expect(session.overrides).toEqual([tea])
  })
})

describe('adding a commitment', () => {
  it('clears the pins it would swallow', () => {
    // A quarter past four is in the pool. The planner merges a pin overlapping
    // a commitment into one busy interval, so this is rest that would be drawn
    // as part of the swim and had by nobody.
    const session = replay([pinned(inPool), added(swim)])

    expect(session.overrides).toEqual([])
  })

  it('leaves the pins it does not touch', () => {
    // The regression this whole filter exists to avoid over-correcting: adding
    // a meeting used to delete every pin still to come, so a nine o'clock
    // standup wiped the afternoon's rest. Where the day's shape changed under a
    // pin that can still be kept, moving it is the user's call.
    const standup: Commitment = {
      id: 'standup',
      title: 'Standup',
      startsAt: at(9, 30),
      durationMin: 15,
    }
    const session = replay([pinned(tea), added(standup)])

    expect(session.overrides).toEqual([tea])
  })

  it('counts the time either side of the commitment as part of it', () => {
    // 15:00 tea against a swim whose pool time starts at 16:00: nothing
    // overlaps until the half hour of getting ready is counted, and then the
    // 15:15 end of the tea is clear of the 15:30 start by fifteen minutes.
    const early: PlannedBreak = { id: 'early', startsAt: at(15, 20), durationMin: 15 }
    const session = replay([pinned(tea), pinned(early), added(swim)])

    expect(session.overrides.map((b) => b.id)).toEqual(['tea'])
  })

  it('drops pins already spent, whether they clash or not', () => {
    const morning: PlannedBreak = { id: 'morning', startsAt: at(9), durationMin: 15 }
    const session = replay([
      pinned(morning),
      { type: 'commitment/added', at: at(11), commitment: swim },
    ])

    expect(session.overrides).toEqual([])
  })
})

describe('a break where a commitment already is', () => {
  it('is refused, rather than stored and cleared later', () => {
    const session = replay([added(swim), pinned(inPool)])

    expect(session.overrides).toEqual([])
  })

  it('counts the time either side, exactly as the clearing does', () => {
    // Twenty past three is not in the pool. It is in the half hour of getting
    // there, which is time the swim costs just as surely.
    const early: PlannedBreak = { id: 'early', startsAt: at(15, 20), durationMin: 15 }
    const session = replay([added(swim), pinned(early)])

    expect(session.overrides).toEqual([])
  })

  it('allows one that begins exactly as the span ends', () => {
    // Half-open, so a pin starting at twenty past five is clear of a span
    // ending at twenty past five rather than touching it. Rest the moment you
    // are back through the door is rest, and refusing it would be pedantry.
    const after: PlannedBreak = { id: 'after', startsAt: at(17, 20), durationMin: 20 }
    const session = replay([added(swim), pinned(after)])

    expect(session.overrides).toEqual([after])
  })

  it('refuses a move onto one and leaves the break where it was', () => {
    // Not deleted: the user tried to put it somewhere it cannot go, which is a
    // reason to decline the move and no reason at all to lose the break.
    const session = replay([
      added(swim),
      pinned(tea),
      { type: 'break/updated', at: at(10), id: 'tea', patch: { startsAt: at(16, 15) } },
    ])

    expect(session.overrides).toEqual([tea])
  })

  it('lands in the same state whichever order the log is in', () => {
    // The rule is enforced from both sides, which is what lets it be stated as
    // a rule. An imported log — or one written by a version of Mono that had
    // neither filter — replays to the same day either way round.
    const pinFirst = replay([pinned(inPool), added(swim)])
    const meetingFirst = replay([added(swim), pinned(inPool)])

    expect(pinFirst.overrides).toEqual([])
    expect(meetingFirst.overrides).toEqual(pinFirst.overrides)
    expect(meetingFirst.commitments).toEqual(pinFirst.commitments)
  })
})

describe('editing a pinned break', () => {
  it('keeps the list in start order when one moves past another', () => {
    const later: PlannedBreak = { id: 'walk', startsAt: at(16), durationMin: 30 }
    const session = replay([
      pinned(tea),
      pinned(later),
      { type: 'break/updated', at: at(10), id: 'tea', patch: { startsAt: at(17) } },
    ])

    expect(session.overrides.map((b) => b.id)).toEqual(['walk', 'tea'])
  })

  it('keeps its id, so the plan re-derives around the same break moved', () => {
    const session = replay([
      pinned(tea),
      { type: 'break/updated', at: at(10), id: 'tea', patch: { durationMin: 45 } },
    ])

    expect(session.overrides).toEqual([{ id: 'tea', startsAt: at(15), durationMin: 45 }])
  })
})

describe('taking a break', () => {
  const walk: PlannedBreak = { id: 'walk', startsAt: at(17), durationMin: 30 }

  /** Fifteen minutes off, taken and finished. */
  const breakTaken = (from: Ms, to: Ms): MonoEvent[] => [
    { type: 'break/started', at: from, id: 'taken', endsAt: to },
    { type: 'break/ended', at: to },
  ]

  it('consumes the pin it was fulfilling and nothing else', () => {
    // The regression: this used to share the commitment filter, which keeps
    // only a break actually under way — so ending one deleted every pin still
    // to come. A walk pinned for five o'clock has nothing to do with a break
    // taken at three.
    const session = replay([
      pinned(tea),
      pinned(walk),
      ...breakTaken(at(15), at(15, 15)),
    ])

    expect(session.overrides.map((b) => b.id)).toEqual(['walk'])
  })

  it('leaves a pin that begins exactly as the break ends', () => {
    const session = replay([pinned(tea), ...breakTaken(at(14, 45), at(15))])

    expect(session.overrides.map((b) => b.id)).toEqual(['tea'])
  })

  it('leaves what is left of a longer pin it happened inside', () => {
    // The reservation is two hours; the break taken inside it is fifteen
    // minutes. Dropping the pin would hand the remaining hour and three
    // quarters back to the planner as focus time, which is not what taking a
    // short break says. This is also the case where the filter must stay a
    // superset of the old one: a pin under way survived before and survives now.
    const afternoon: PlannedBreak = { id: 'afternoon', startsAt: at(14), durationMin: 120 }
    const session = replay([pinned(afternoon), ...breakTaken(at(14, 30), at(14, 45))])

    expect(session.overrides).toEqual([afternoon])
  })

  it('drops pins already behind us, which nothing reads', () => {
    const morning: PlannedBreak = { id: 'morning', startsAt: at(10), durationMin: 15 }
    const session = replay([
      pinned(morning),
      pinned(walk),
      ...breakTaken(at(15), at(15, 15)),
    ])

    expect(session.overrides.map((b) => b.id)).toEqual(['walk'])
  })

  it('records the break itself, at the length it really ran', () => {
    // Ending early is the ordinary case — the pin says fifteen minutes, the
    // history says what actually happened.
    const session = replay([
      { type: 'break/started', at: at(15), id: 'taken', endsAt: at(15, 15) },
      { type: 'break/ended', at: at(15, 6) },
    ])

    expect(session.history).toEqual([
      {
        kind: 'break',
        id: 'taken',
        startedAt: at(15),
        endedAt: at(15, 6),
        plannedEndsAt: at(15, 15),
      },
    ])
  })
})
