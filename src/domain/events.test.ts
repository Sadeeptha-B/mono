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

import { commitmentsFor, reduce, replay, type MonoEvent } from './events'
import type { Commitment, Ms, PlannedBreak, RecurringCommitment } from './types'

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

describe("the day's intentions", () => {
  const auth = { id: 'auth', title: 'Mono auth' }
  const billing = { id: 'billing', title: 'Billing ticket' }
  const named: MonoEvent[] = [
    { type: 'intention/added', at: at(8), intention: auth },
    { type: 'intention/added', at: at(8, 1), intention: billing },
  ]

  it('keeps the order they were named in, and ignores a duplicate id', () => {
    const state = replay([
      ...named,
      { type: 'intention/added', at: at(8, 2), intention: { id: 'auth', title: 'Again' } },
    ])
    expect(state.intentions.map((i) => i.title)).toEqual(['Mono auth', 'Billing ticket'])
  })

  it('patches a title', () => {
    const state = replay([
      ...named,
      { type: 'intention/updated', at: at(9), id: 'auth', patch: { title: 'Auth' } },
    ])
    expect(state.intentions[0]).toEqual({ id: 'auth', title: 'Auth' })
  })

  it('marks one done and reopens it, keeping its title and its tasks', () => {
    const linked: MonoEvent[] = [
      ...named,
      { type: 'intention/taskLinked', at: at(9), taskId: 't', intentionId: 'auth' },
    ]
    const done = replay([
      ...linked,
      { type: 'intention/updated', at: at(10), id: 'auth', patch: { done: true } },
    ])
    expect(done.intentions[0]).toEqual({ id: 'auth', title: 'Mono auth', done: true })
    expect(done.today).toEqual({ t: 'auth' })

    const reopened = replay([
      ...linked,
      { type: 'intention/updated', at: at(10), id: 'auth', patch: { done: true } },
      { type: 'intention/updated', at: at(11), id: 'auth', patch: { done: false } },
    ])
    expect(reopened.intentions[0]).toEqual({ id: 'auth', title: 'Mono auth', done: false })
  })

  it('puts a task under one intention at a time', () => {
    const state = replay([
      ...named,
      { type: 'intention/taskLinked', at: at(9), taskId: 't', intentionId: 'auth' },
      { type: 'intention/taskLinked', at: at(9, 1), taskId: 't', intentionId: 'billing' },
    ])
    expect(state.today).toEqual({ t: 'billing' })
  })

  it('ungroups with null, keeping the task today, and refuses a link to nothing', () => {
    const state = replay([
      ...named,
      { type: 'intention/taskLinked', at: at(9), taskId: 't', intentionId: 'auth' },
      { type: 'intention/taskLinked', at: at(9, 1), taskId: 't', intentionId: null },
      { type: 'intention/taskLinked', at: at(9, 2), taskId: 'u', intentionId: 'nowhere' },
      // Taking a task out of an intention it was never in does not choose it.
      { type: 'intention/taskLinked', at: at(9, 3), taskId: 'v', intentionId: null },
    ])
    expect(state.today).toEqual({ t: null })
  })

  it('leaves its tasks today, under no intention, when one is removed', () => {
    const state = replay([
      ...named,
      { type: 'intention/taskLinked', at: at(9), taskId: 't', intentionId: 'auth' },
      { type: 'intention/taskLinked', at: at(9), taskId: 'u', intentionId: 'billing' },
      { type: 'intention/removed', at: at(10), id: 'auth' },
    ])
    expect(state.intentions.map((i) => i.id)).toEqual(['billing'])
    expect(state.today).toEqual({ t: null, u: 'billing' })
  })

  it('are cleared at midnight with the rest of the day', () => {
    const state = replay([
      ...named,
      { type: 'intention/taskLinked', at: at(9), taskId: 't', intentionId: 'auth' },
      { type: 'day/reset', at: at(23, 59) },
    ])
    expect(state.intentions).toEqual([])
    expect(state.today).toEqual({})
  })
})

describe("today's tasks", () => {
  it('are chosen once each, in order, and a repeat keeps its intention', () => {
    const state = replay([
      { type: 'intention/added', at: at(8), intention: { id: 'auth', title: 'Mono auth' } },
      { type: 'today/taskAdded', at: at(8, 1), taskId: 'a' },
      { type: 'intention/taskLinked', at: at(8, 2), taskId: 'b', intentionId: 'auth' },
      { type: 'today/taskAdded', at: at(8, 3), taskId: 'b' },
      { type: 'today/taskAdded', at: at(8, 4), taskId: 'a' },
    ])
    expect(state.today).toEqual({ a: null, b: 'auth' })
    expect(Object.keys(state.today)).toEqual(['a', 'b'])
  })

  it('are put back out of today with their intention, and an unknown one changes nothing', () => {
    const chosen = replay([
      { type: 'intention/added', at: at(8), intention: { id: 'auth', title: 'Mono auth' } },
      { type: 'intention/taskLinked', at: at(8, 1), taskId: 'a', intentionId: 'auth' },
      { type: 'today/taskAdded', at: at(8, 2), taskId: 'b' },
    ])
    const removed = reduce(chosen, { type: 'today/taskRemoved', at: at(9), taskId: 'a' })
    expect(removed.today).toEqual({ b: null })
    expect(reduce(removed, { type: 'today/taskRemoved', at: at(9), taskId: 'zz' })).toBe(removed)
  })

  it("take in a block's tasks when it starts, leaving the ones already chosen alone", () => {
    const before = replay([
      { type: 'intention/added', at: at(8), intention: { id: 'auth', title: 'Mono auth' } },
      { type: 'intention/taskLinked', at: at(8, 1), taskId: 'a', intentionId: 'auth' },
    ])
    const started = reduce(before, {
      type: 'block/started',
      at: at(9),
      id: 'b1',
      blockKind: 'deep',
      endsAt: at(9, 45),
      purpose: 'Login',
      taskIds: ['a', 'outside'],
    })
    expect(started.today).toEqual({ a: 'auth', outside: null })

    // A block on today's own tasks hands the same map back.
    const again = reduce(before, {
      type: 'block/started',
      at: at(9),
      id: 'b2',
      blockKind: 'deep',
      endsAt: at(9, 45),
      purpose: 'Login',
      taskIds: ['a'],
    })
    expect(again.today).toBe(before.today)
  })

  it('are kept aside at midnight for the new day to offer, until the next one', () => {
    const first = replay([
      { type: 'today/taskAdded', at: at(9), taskId: 'a' },
      { type: 'today/taskAdded', at: at(9, 1), taskId: 'b' },
      { type: 'day/reset', at: at(23, 59) },
    ])
    expect(first.today).toEqual({})
    expect(first.lastDay).toEqual(['a', 'b'])

    const second = reduce(reduce(first, { type: 'today/taskAdded', at: at(24, 9), taskId: 'c' }), {
      type: 'day/reset',
      at: at(47, 59),
    })
    expect(second.lastDay).toEqual(['c'])
  })

  it('keep the last working day aside through days that chose nothing', () => {
    // A tab left open over a weekend turns over at each midnight.
    const monday = replay([
      { type: 'today/taskAdded', at: at(9), taskId: 'friday' },
      { type: 'day/reset', at: at(23, 59) },
      { type: 'day/reset', at: at(47, 59) },
      { type: 'day/reset', at: at(71, 59) },
    ])
    expect(monday.lastDay).toEqual(['friday'])
  })
})

describe('the tasks a block is for', () => {
  it('ride from the start event into history', () => {
    const state = replay([
      {
        type: 'block/started',
        at: at(9),
        id: 'b',
        blockKind: 'deep',
        endsAt: at(9, 45),
        purpose: 'Login',
        taskIds: ['t', 'u'],
      },
      { type: 'block/completed', at: at(9, 45) },
    ])
    expect(state.history[0]).toMatchObject({ kind: 'block', taskIds: ['t', 'u'] })
  })

  it('are none for a block started before tasks existed', () => {
    const state = replay([
      {
        type: 'block/started',
        at: at(9),
        id: 'b',
        blockKind: 'deep',
        endsAt: at(9, 45),
        purpose: 'Old',
      },
    ])
    expect(state.active).toMatchObject({ kind: 'block', taskIds: [] })
  })
})

describe("a block's notes and urges", () => {
  const start: MonoEvent = {
    type: 'block/started',
    at: at(14),
    id: 'b1',
    blockKind: 'deep',
    endsAt: at(14, 45),
    purpose: 'Write the migration',
    taskIds: ['t'],
  }
  const noted = (id: string, minute: number, text: string): MonoEvent => ({
    type: 'block/noted',
    at: at(14, minute),
    id,
    text,
  })

  it('are dropped with no block running, and on a break', () => {
    const state = replay([
      noted('n1', 0, 'Nothing running'),
      { type: 'block/urged', at: at(13) },
      { type: 'break/started', at: at(13), id: 'rest', endsAt: at(13, 10) },
      noted('n2', 1, 'On a break'),
      { type: 'block/urged', at: at(13, 1) },
    ])
    expect(state.active).toMatchObject({ kind: 'break' })
    expect(state.history).toEqual([])
  })

  it('go into history with the block however it closes', () => {
    const written = [noted('n1', 5, 'Schema done'), { type: 'block/urged', at: at(14, 6) } as const]
    const closings: MonoEvent[] = [
      { type: 'block/completed', at: at(14, 45) },
      { type: 'block/abandoned', at: at(14, 20) },
      // A malformed log that starts something over the top still keeps them.
      { type: 'break/started', at: at(14, 20), id: 'rest', endsAt: at(14, 30) },
    ]
    for (const closing of closings) {
      const block = replay([start, ...written, closing]).history[0]
      expect(block).toMatchObject({
        notes: [{ id: 'n1', text: 'Schema done' }],
        urges: [at(14, 6)],
      })
    }
  })

  it('take back only the last urge, and nothing when there is none', () => {
    const state = replay([
      start,
      { type: 'block/urgeTakenBack', at: at(14, 1) },
      { type: 'block/urged', at: at(14, 2) },
      { type: 'block/urged', at: at(14, 3) },
      { type: 'block/urgeTakenBack', at: at(14, 3) },
    ])
    expect(state.active).toMatchObject({ urges: [at(14, 2)] })
  })

  it('correct a note in the running block, keeping the minute it was written', () => {
    const state = replay([
      start,
      noted('n1', 5, 'Shcema done'),
      { type: 'block/noteEdited', at: at(14, 30), blockId: 'b1', noteId: 'n1', text: ' Schema done ' },
    ])
    expect(state.active).toMatchObject({
      notes: [{ id: 'n1', at: at(14, 5), text: 'Schema done' }],
    })
  })

  it('correct and delete a note in a block already over', () => {
    const state = replay([
      start,
      noted('n1', 5, 'Shcema done'),
      noted('n2', 9, 'Wrong block'),
      { type: 'block/completed', at: at(14, 45) },
      { type: 'block/noteEdited', at: at(15), blockId: 'b1', noteId: 'n1', text: 'Schema done' },
      { type: 'block/noteRemoved', at: at(15), blockId: 'b1', noteId: 'n2' },
    ])
    expect(state.history[0]).toMatchObject({
      notes: [{ id: 'n1', at: at(14, 5), text: 'Schema done' }],
    })
  })

  it('change nothing for a correction aimed at nothing, or a blank one', () => {
    const before = replay([start, noted('n1', 5, 'Schema done')])
    const misses: MonoEvent[] = [
      { type: 'block/noteEdited', at: at(15), blockId: 'b1', noteId: 'n1', text: '   ' },
      { type: 'block/noteEdited', at: at(15), blockId: 'b1', noteId: 'missing', text: 'x' },
      { type: 'block/noteEdited', at: at(15), blockId: 'other', noteId: 'n1', text: 'x' },
      { type: 'block/noteRemoved', at: at(15), blockId: 'b1', noteId: 'missing' },
      { type: 'block/noteRemoved', at: at(15), blockId: 'other', noteId: 'n1' },
    ]
    for (const miss of misses) expect(reduce(before, miss)).toBe(before)
  })
})

describe('recurring commitments', () => {
  /** Weekdays at nine, from the Monday before `BASE_DAY` (a Thursday). */
  const standup: RecurringCommitment = {
    id: 'standup',
    title: 'Standup',
    time: '09:00',
    durationMin: 15,
    repeat: { every: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] },
    startsOn: '2026-08-17',
  }
  const today = 'standup@2026-08-20'
  const started = (when: Ms, rule: RecurringCommitment = standup): MonoEvent => ({
    type: 'recurring/added',
    at: when,
    rule,
  })
  const ids = (events: MonoEvent[], when: Ms) => commitmentsFor(replay(events), when).map((c) => c.id)
  const nextDay = new Date(2026, 7, 21, 8).getTime()

  it("put today's occurrence among the day's commitments, under an id the day derives", () => {
    const state = replay([started(at(7))])
    expect(state.commitments).toEqual([])
    expect(commitmentsFor(state, at(8))).toEqual([
      {
        id: today,
        title: 'Standup',
        startsAt: at(9),
        durationMin: 15,
        recurringId: 'standup',
      },
    ])
    expect(commitmentsFor(state, nextDay).map((c) => c.id)).toEqual(['standup@2026-08-21'])
    // A Saturday has none.
    expect(commitmentsFor(state, new Date(2026, 7, 22, 8).getTime())).toEqual([])
  })

  it('stay with the series when an edit to today changes nothing', () => {
    // Done on an untouched form sends the whole draft back, margins as zeros.
    const before = replay([started(at(7))])
    const unchanged = reduce(before, {
      type: 'commitment/updated',
      at: at(7, 30),
      id: today,
      patch: { title: 'Standup', startsAt: at(9), durationMin: 15, prepMin: 0, recoverMin: 0 },
    })
    expect(unchanged).toBe(before)

    const moved = reduce(unchanged, {
      type: 'recurring/updated',
      at: at(7, 45),
      id: 'standup',
      patch: { time: '08:30' },
    })
    expect(commitmentsFor(moved, at(8))).toEqual([
      expect.objectContaining({ id: today, startsAt: at(8, 30) }),
    ])
  })

  it("give the day its own copy when today's is edited, which a later change to the series leaves alone", () => {
    const events: MonoEvent[] = [
      started(at(7)),
      { type: 'commitment/updated', at: at(7, 30), id: today, patch: { startsAt: at(10) } },
      { type: 'recurring/updated', at: at(7, 45), id: 'standup', patch: { time: '11:00' } },
    ]
    const state = replay(events)
    expect(commitmentsFor(state, at(8))).toEqual([
      expect.objectContaining({ id: today, startsAt: at(10), recurringId: 'standup' }),
    ])
    // Tomorrow follows the series, changed.
    expect(commitmentsFor(state, nextDay).find((c) => c.id === 'standup@2026-08-21')?.startsAt).toBe(
      new Date(2026, 7, 21, 11).getTime(),
    )
  })

  it('skip today when today is removed, edited or not, and come back the next day', () => {
    const skipped = [started(at(7)), { type: 'commitment/removed', at: at(7, 30), id: today }] as MonoEvent[]
    expect(ids(skipped, at(8))).toEqual([])

    const editedThenRemoved = [
      started(at(7)),
      { type: 'commitment/updated', at: at(7, 15), id: today, patch: { durationMin: 30 } },
      { type: 'commitment/removed', at: at(7, 30), id: today },
    ] as MonoEvent[]
    expect(ids(editedThenRemoved, at(8))).toEqual([])

    const reset = [...skipped, { type: 'day/reset', at: nextDay }] as MonoEvent[]
    expect(replay(reset).skipped).toEqual([])
    expect(ids(reset, nextDay)).toEqual(['standup@2026-08-21'])
  })

  it("move today's with the series while it is still ahead", () => {
    const events: MonoEvent[] = [
      started(at(7)),
      { type: 'recurring/updated', at: at(8), id: 'standup', patch: { time: '10:00' } },
    ]
    const state = replay(events)
    expect(state.commitments).toEqual([])
    expect(commitmentsFor(state, at(8))[0]?.startsAt).toBe(at(10))
  })

  it('never rewrite one that has already begun, whether changed or ended', () => {
    const changed = replay([
      started(at(7)),
      { type: 'recurring/updated', at: at(9, 5), id: 'standup', patch: { time: '10:00' } },
    ])
    expect(commitmentsFor(changed, at(12))).toEqual([
      expect.objectContaining({ id: today, startsAt: at(9) }),
    ])
    expect(commitmentsFor(changed, nextDay).find((c) => c.id === 'standup@2026-08-21')?.startsAt).toBe(
      new Date(2026, 7, 21, 10).getTime(),
    )

    const ended = replay([started(at(7)), { type: 'recurring/removed', at: at(9, 5), id: 'standup' }])
    expect(ended.recurring).toEqual([])
    expect(commitmentsFor(ended, at(12)).map((c) => c.id)).toEqual([today])
    const tomorrow = reduce(ended, { type: 'day/reset', at: nextDay })
    expect(commitmentsFor(tomorrow, nextDay)).toEqual([])

    // Ended before it began, today's goes with the series.
    const endedEarly = replay([started(at(7)), { type: 'recurring/removed', at: at(8), id: 'standup' }])
    expect(commitmentsFor(endedEarly, at(8))).toEqual([])
  })

  it('count getting ready as having begun', () => {
    const state = replay([
      started(at(7), { ...standup, prepMin: 30 }),
      { type: 'recurring/removed', at: at(8, 40), id: 'standup' },
    ])
    expect(commitmentsFor(state, at(12)).map((c) => c.id)).toEqual([today])
  })

  it("clear the pins today's occurrence lands on, and refuse a pin across it", () => {
    const covered: PlannedBreak = { id: 'covered', startsAt: at(9, 5), durationMin: 10 }
    expect(replay([pinned(covered), started(at(8))]).overrides).toEqual([])
    expect(replay([started(at(8)), { ...pinned(covered), at: at(8, 30) }]).overrides).toEqual([])

    // Moved onto a pin by a change to the series, the pin goes too.
    const later: PlannedBreak = { id: 'later', startsAt: at(11), durationMin: 10 }
    expect(
      replay([
        started(at(7)),
        { ...pinned(later), at: at(7, 30) },
        { type: 'recurring/updated', at: at(8), id: 'standup', patch: { time: '11:00' } },
      ]).overrides,
    ).toEqual([])
  })

  it('end a series given an end, and lose the end when told it has none', () => {
    const state = replay([
      started(at(7)),
      { type: 'recurring/updated', at: at(8), id: 'standup', patch: { endsOn: '2026-08-20' } },
    ])
    expect(commitmentsFor(state, nextDay)).toEqual([])
    const reopened = reduce(state, {
      type: 'recurring/updated',
      at: at(8),
      id: 'standup',
      patch: { endsOn: null },
    })
    expect(reopened.recurring[0]).not.toHaveProperty('endsOn')
    expect(commitmentsFor(reopened, nextDay)).toHaveLength(1)
  })

  it('survive midnight, and ignore a duplicate', () => {
    const state = replay([started(at(7)), started(at(7)), { type: 'day/reset', at: nextDay }])
    expect(state.recurring).toEqual([standup])
  })

  it('replay to the same day every time', () => {
    const events: MonoEvent[] = [
      started(at(7)),
      { type: 'commitment/updated', at: at(7, 30), id: today, patch: { durationMin: 20 } },
      { type: 'recurring/updated', at: at(9, 30), id: 'standup', patch: { title: 'Sync' } },
    ]
    expect(commitmentsFor(replay(events), at(12))).toEqual(commitmentsFor(replay(events), at(12)))
  })
})
