import { describe, expect, it } from 'vitest'

import { initialState, reduce, replay, type MonoEvent, type SessionState } from './events'
import {
  initialPhase,
  isBlockRunning,
  transition,
  type Action,
  type Deps,
  type Phase,
} from './machine'
import { DEFAULT_SETTINGS, minutesToMs, type ActiveSegment, type Ms } from './types'
import { wantsAmbience } from '@/ambient/useAmbience'

const BASE_DAY = new Date(2026, 7, 20)

function at(hour: number, minute = 0): Ms {
  const d = new Date(BASE_DAY)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

function deps(): Deps {
  let n = 0
  return { newId: () => `id-${++n}` }
}

/** Drive the machine and the log together, the way the store does. */
function run(actions: Action[], from: SessionState = initialState) {
  const d = deps()
  let phase: Phase = initialPhase
  let session = from
  const events: MonoEvent[] = []

  for (const action of actions) {
    const result = transition(phase, session, action, d)
    phase = result.phase
    for (const event of result.events) {
      events.push(event)
      session = reduce(session, event)
    }
  }
  return { phase, session, events }
}

describe('starting a block', () => {
  it('asks for a purpose before the timer starts', () => {
    const { phase, session } = run([{ type: 'startBlock', at: at(14), blockKind: 'deep' }])

    expect(phase).toEqual({
      name: 'definingPurpose',
      blockKind: 'deep',
      afterReflection: false,
    })
    // Nothing is running yet — deciding is not focusing.
    expect(session.active).toBeNull()
  })

  it('starts the timer from when the purpose was set, not when the prompt opened', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14, 3), purpose: 'Write the planner' },
    ])

    expect(phase).toEqual({ name: 'focusing' })
    expect(session.active).toMatchObject({
      kind: 'block',
      blockKind: 'deep',
      purpose: 'Write the planner',
      startedAt: at(14, 3),
      endsAt: at(14, 3) + minutesToMs(45),
    })
  })

  it('trims the purpose', () => {
    const { session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14), purpose: '  Ship the timeline  ' },
    ])
    expect(session.active).toMatchObject({ purpose: 'Ship the timeline' })
  })

  it('honours the configured duration for a short block', () => {
    const session: SessionState = {
      ...initialState,
      settings: { ...DEFAULT_SETTINGS, shortMinutes: 25 },
    }
    const result = run(
      [
        { type: 'startBlock', at: at(14), blockKind: 'short' },
        { type: 'setPurpose', at: at(14), purpose: 'Inbox' },
      ],
      session,
    )
    expect(result.session.active?.endsAt).toBe(at(14) + minutesToMs(25))
  })
})

describe('not being able to name a purpose', () => {
  it('starts a five minute reflection block', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'cannotDecide', at: at(14) },
    ])

    expect(phase).toEqual({ name: 'reflecting' })
    expect(session.active).toMatchObject({
      kind: 'block',
      blockKind: 'reflect',
      purpose: null,
      endsAt: at(14) + minutesToMs(5),
    })
  })

  it('returns to the purpose prompt once reflection ends', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'cannotDecide', at: at(14) },
      { type: 'timerElapsed', at: at(14, 5) },
    ])

    expect(phase).toEqual({
      name: 'definingPurpose',
      blockKind: 'deep',
      afterReflection: true,
    })
    expect(session.active).toBeNull()
  })

  it('records the reflection in history like any other block', () => {
    const { session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'cannotDecide', at: at(14) },
      { type: 'timerElapsed', at: at(14, 5) },
    ])

    expect(session.history).toHaveLength(1)
    expect(session.history[0]).toMatchObject({
      kind: 'block',
      blockKind: 'reflect',
      outcome: 'completed',
    })
  })

  it('records an abandoned reflection and still returns to the prompt', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'cannotDecide', at: at(14) },
      { type: 'abandonBlock', at: at(14, 2) },
    ])

    expect(phase.name).toBe('definingPurpose')
    expect(session.history[0]).toMatchObject({ outcome: 'abandoned', endedAt: at(14, 2) })
  })
})

describe('finishing a block', () => {
  const startAndFinish: Action[] = [
    { type: 'startBlock', at: at(14), blockKind: 'deep' },
    { type: 'setPurpose', at: at(14), purpose: 'Write the planner' },
    { type: 'timerElapsed', at: at(14, 45) },
  ]

  it('asks about a break when the timer elapses', () => {
    const { phase, session } = run(startAndFinish)

    expect(phase).toEqual({ name: 'blockComplete' })
    // Still open: the block is not recorded until the user answers, so a
    // forgotten prompt cannot silently bank a block.
    expect(session.active).not.toBeNull()
  })

  it('runs straight into the next purpose prompt when the break is skipped', () => {
    const { phase, session } = run([
      ...startAndFinish,
      { type: 'skipBreak', at: at(14, 45), nextBlockKind: 'deep' },
    ])

    expect(phase).toEqual({
      name: 'definingPurpose',
      blockKind: 'deep',
      afterReflection: false,
    })
    expect(session.active).toBeNull()
    expect(session.history[0]).toMatchObject({ outcome: 'completed' })
  })

  it('offers a short block next when that is all that fits', () => {
    const { phase } = run([
      ...startAndFinish,
      { type: 'skipBreak', at: at(14, 45), nextBlockKind: 'short' },
    ])
    expect(phase).toMatchObject({ blockKind: 'short' })
  })

  it('completes the block and opens the duration picker when a break is taken', () => {
    const { phase, session } = run([
      ...startAndFinish,
      { type: 'takeBreak', at: at(14, 45) },
    ])

    expect(phase).toEqual({ name: 'choosingBreak' })
    expect(session.active).toBeNull()
    expect(session.history[0]).toMatchObject({ outcome: 'completed' })
  })

  it('runs the break for the chosen duration', () => {
    const { phase, session } = run([
      ...startAndFinish,
      { type: 'takeBreak', at: at(14, 45) },
      { type: 'confirmBreak', at: at(14, 45), durationMin: 15 },
    ])

    expect(phase).toEqual({ name: 'onBreak' })
    expect(session.active).toMatchObject({
      kind: 'break',
      startedAt: at(14, 45),
      endsAt: at(15),
    })
  })

  it('returns to idle when the break ends', () => {
    const { phase, session } = run([
      ...startAndFinish,
      { type: 'takeBreak', at: at(14, 45) },
      { type: 'confirmBreak', at: at(14, 45), durationMin: 15 },
      { type: 'timerElapsed', at: at(15) },
    ])

    expect(phase).toEqual({ name: 'idle' })
    expect(session.active).toBeNull()
    expect(session.history.at(-1)).toMatchObject({ kind: 'break', endedAt: at(15) })
  })

  it('lets a break be cut short', () => {
    const { session } = run([
      ...startAndFinish,
      { type: 'takeBreak', at: at(14, 45) },
      { type: 'confirmBreak', at: at(14, 45), durationMin: 15 },
      { type: 'endBreak', at: at(14, 50) },
    ])

    expect(session.history.at(-1)).toMatchObject({
      kind: 'break',
      endedAt: at(14, 50),
      plannedEndsAt: at(15),
    })
  })
})

describe('abandoning', () => {
  it('records the partial block and returns to idle', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14), purpose: 'Write the planner' },
      { type: 'abandonBlock', at: at(14, 12) },
    ])

    expect(phase).toEqual({ name: 'idle' })
    expect(session.active).toBeNull()
    expect(session.history[0]).toMatchObject({
      outcome: 'abandoned',
      purpose: 'Write the planner',
      startedAt: at(14),
      endedAt: at(14, 12),
      plannedEndsAt: at(14, 45),
    })
  })

  it('backs out of the purpose prompt without recording anything', () => {
    const { phase, session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'abandonBlock', at: at(14) },
    ])

    expect(phase).toEqual({ name: 'idle' })
    expect(session.history).toHaveLength(0)
  })

  it('there is no pause: an unknown action leaves the phase untouched', () => {
    const { phase } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14), purpose: 'Focus' },
      { type: 'endBreak', at: at(14, 10) },
    ])
    expect(phase).toEqual({ name: 'focusing' })
  })
})

describe('coming back after being away', () => {
  const focusing: Action[] = [
    { type: 'startBlock', at: at(14), blockKind: 'deep' },
    { type: 'setPurpose', at: at(14), purpose: 'Write the planner' },
  ]

  it('never auto-completes a block that ended while the machine slept', () => {
    const { phase, session } = run([
      ...focusing,
      { type: 'awayDetected', at: at(16), lastSeenAt: at(14, 20) },
    ])

    expect(phase).toEqual({
      name: 'reconciling',
      lastSeenAt: at(14, 20),
      blockEndedAt: at(14, 45),
    })
    // Still unresolved. The user decides what happened, not the app.
    expect(session.active).not.toBeNull()
    expect(session.history).toHaveLength(0)
  })

  it('credits the block at its planned end, not at the moment of waking', () => {
    const { session } = run([
      ...focusing,
      { type: 'awayDetected', at: at(16), lastSeenAt: at(14, 20) },
      { type: 'resolveAway', at: at(16), outcome: 'completed' },
    ])

    const block = session.history.find((s) => s.kind === 'block')
    expect(block).toMatchObject({ outcome: 'completed', endedAt: at(14, 45) })
  })

  it('records the unaccounted stretch so the day adds up', () => {
    const { session } = run([
      ...focusing,
      { type: 'awayDetected', at: at(16), lastSeenAt: at(14, 20) },
      { type: 'resolveAway', at: at(16), outcome: 'completed' },
    ])

    expect(session.history.find((s) => s.kind === 'away')).toMatchObject({
      startedAt: at(14, 45),
      endedAt: at(16),
    })
  })

  it('can resolve as abandoned', () => {
    const { phase, session } = run([
      ...focusing,
      { type: 'awayDetected', at: at(16), lastSeenAt: at(14, 20) },
      { type: 'resolveAway', at: at(16), outcome: 'abandoned' },
    ])

    expect(phase).toEqual({ name: 'idle' })
    expect(session.history.find((s) => s.kind === 'block')).toMatchObject({
      outcome: 'abandoned',
    })
  })

  it('outranks whichever dialog was open', () => {
    const { phase } = run([
      ...focusing,
      { type: 'timerElapsed', at: at(14, 45) },
      { type: 'awayDetected', at: at(16), lastSeenAt: at(14, 46) },
    ])
    expect(phase.name).toBe('reconciling')
  })

  it('is ignored when nothing was running', () => {
    const { phase } = run([{ type: 'awayDetected', at: at(16), lastSeenAt: at(14) }])
    expect(phase).toEqual({ name: 'idle' })
  })
})

describe('the event log', () => {
  it('rebuilds the same state when replayed', () => {
    const { session, events } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14), purpose: 'Write the planner' },
      { type: 'timerElapsed', at: at(14, 45) },
      { type: 'takeBreak', at: at(14, 45) },
      { type: 'confirmBreak', at: at(14, 45), durationMin: 15 },
      { type: 'timerElapsed', at: at(15) },
    ])

    expect(replay(events)).toEqual(session)
  })

  it('clears the pinned break a new commitment covers, and leaves the others', () => {
    // This used to assert that *every* future pin went. A five o'clock meeting
    // has nothing to say about a break pinned for half past three.
    let session = initialState
    const events: MonoEvent[] = [
      {
        type: 'break/planned',
        at: at(14),
        plannedBreak: { id: 'clear', startsAt: at(15, 30), durationMin: 15 },
      },
      {
        type: 'break/planned',
        at: at(14),
        plannedBreak: { id: 'covered', startsAt: at(17, 5), durationMin: 15 },
      },
      {
        type: 'commitment/added',
        at: at(14, 5),
        commitment: { id: 'c1', title: 'Standup', startsAt: at(17), durationMin: 30 },
      },
    ]
    for (const e of events) session = reduce(session, e)

    expect(session.overrides.map((b) => b.id)).toEqual(['clear'])
    expect(session.commitments).toHaveLength(1)
  })

  it('leaves a break under way alone when the commitment is nowhere near it', () => {
    let session = initialState
    session = reduce(session, {
      type: 'break/planned',
      at: at(14),
      plannedBreak: { id: 'b1', startsAt: at(14), durationMin: 15 },
    })
    session = reduce(session, {
      type: 'commitment/added',
      at: at(14, 5),
      commitment: { id: 'c1', title: 'Standup', startsAt: at(17), durationMin: 15 },
    })

    expect(session.overrides).toHaveLength(1)
  })

  it('does not spare a break under way that the commitment covers', () => {
    // Being in progress used to be the one thing that saved a pin from the
    // clearing. What saves it now is not clashing: rest the planner would merge
    // into a meeting is rest nobody gets, whatever its clock says.
    let session = initialState
    session = reduce(session, {
      type: 'break/planned',
      at: at(14),
      plannedBreak: { id: 'b1', startsAt: at(14), durationMin: 30 },
    })
    session = reduce(session, {
      type: 'commitment/added',
      at: at(14, 5),
      commitment: { id: 'c1', title: 'Standup', startsAt: at(14, 10), durationMin: 30 },
    })

    expect(session.overrides).toHaveLength(0)
  })

  it('keeps history across the midnight reset and drops the plan', () => {
    const { session } = run([
      { type: 'startBlock', at: at(14), blockKind: 'deep' },
      { type: 'setPurpose', at: at(14), purpose: 'Write the planner' },
      { type: 'timerElapsed', at: at(14, 45) },
      { type: 'skipBreak', at: at(14, 45), nextBlockKind: 'deep' },
    ])

    const withPlan = reduce(session, {
      type: 'break/planned',
      at: at(15),
      plannedBreak: { id: 'b1', startsAt: at(16), durationMin: 15 },
    })
    const afterReset = reduce(withPlan, { type: 'day/reset', at: at(24) })

    expect(afterReset.history).toHaveLength(1)
    expect(afterReset.overrides).toHaveLength(0)
  })

  it('never strands an open segment', () => {
    let session = initialState
    session = reduce(session, {
      type: 'block/started',
      at: at(14),
      id: 'a',
      blockKind: 'deep',
      endsAt: at(14, 45),
      purpose: 'One',
    })
    // A malformed log that starts a second block without closing the first.
    session = reduce(session, {
      type: 'block/started',
      at: at(14, 20),
      id: 'b',
      blockKind: 'deep',
      endsAt: at(15, 5),
      purpose: 'Two',
    })

    expect(session.history).toHaveLength(1)
    expect(session.history[0]).toMatchObject({ id: 'a', outcome: 'abandoned' })
    expect(session.active).toMatchObject({ id: 'b' })
  })
})

/**
 * The predicate two unrelated subsystems depend on: ambience fades in only
 * while this is true, and the browser extension arms site blocking only while
 * it is true. They were one expression written in one place, and this is the
 * table that stops them quietly meaning different things.
 *
 * The rows that matter are the false ones. `blockComplete` and `reconciling`
 * both still carry an `active` block — the timer reached zero but nothing is
 * banked until the user answers — and anything reading `active` alone would
 * keep a sound playing and a website blocked after the block was over.
 */
describe('whether a block is actually running', () => {
  const block: ActiveSegment = {
    kind: 'block',
    id: 'b1',
    blockKind: 'deep',
    purpose: 'ship it',
    startedAt: at(9),
    endsAt: at(9, 45),
  }

  const rest: ActiveSegment = { kind: 'break', id: 'r1', startedAt: at(9), endsAt: at(9, 10) }

  const PHASES: Phase[] = [
    { name: 'idle' },
    { name: 'definingPurpose', blockKind: 'deep', afterReflection: false },
    { name: 'reflecting' },
    { name: 'focusing' },
    { name: 'blockComplete' },
    { name: 'choosingBreak' },
    { name: 'onBreak' },
    { name: 'reconciling', lastSeenAt: at(9, 30), blockEndedAt: at(9, 45) },
  ]

  it.each(['focusing', 'reflecting'])('is true while %s a block', (name) => {
    expect(isBlockRunning({ name } as Phase, block)).toBe(true)
  })

  it.each(['idle', 'definingPurpose', 'blockComplete', 'choosingBreak', 'onBreak', 'reconciling'])(
    'is false in %s, even with a block still active',
    (name) => {
      const phase = PHASES.find((candidate) => candidate.name === name)!
      expect(isBlockRunning(phase, block)).toBe(false)
    },
  )

  it('is false for a break, in every phase', () => {
    for (const phase of PHASES) expect(isBlockRunning(phase, rest)).toBe(false)
  })

  it('is false with nothing active, in every phase', () => {
    for (const phase of PHASES) expect(isBlockRunning(phase, null)).toBe(false)
  })

  /**
   * The seam itself. `wantsAmbience` is the older name and the one the ambient
   * tests use; it delegates here now, and this is what holds that shut. Two
   * copies of this expression is how a break ends up silent but still blocked.
   */
  it('is the same question the ambience asks', () => {
    for (const phase of PHASES) {
      for (const active of [block, rest, null]) {
        expect(wantsAmbience(phase, active)).toBe(isBlockRunning(phase, active))
      }
    }
  })
})
