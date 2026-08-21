import { describe, expect, it } from 'vitest'

import { vitalsFor } from './vitals'
import { initialState, reduce, type MonoEvent, type SessionState } from './events'
import { initialPhase, transition, type Action, type Phase } from './machine'
import type { ActiveSegment, BlockKind, CompletedSegment, Ms } from './types'

/** 2pm on a fixed weekday, well clear of any DST boundary. */
const TWO_PM = new Date(2026, 7, 20, 14, 0, 0).getTime()
const YESTERDAY = new Date(2026, 7, 19, 14, 0, 0).getTime()
const minutes = (n: number): Ms => n * 60_000

let seq = 0
const id = () => `seg-${(seq += 1)}`

const block = (
  startedAt: Ms,
  lengthMin: number,
  outcome: 'completed' | 'abandoned' = 'completed',
  blockKind: BlockKind = 'deep',
): CompletedSegment => ({
  kind: 'block',
  id: id(),
  blockKind,
  purpose: 'something',
  startedAt,
  endedAt: startedAt + minutes(lengthMin),
  plannedEndsAt: startedAt + minutes(lengthMin),
  outcome,
})

const rest = (startedAt: Ms, lengthMin: number): CompletedSegment => ({
  kind: 'break',
  id: id(),
  startedAt,
  endedAt: startedAt + minutes(lengthMin),
  plannedEndsAt: startedAt + minutes(lengthMin),
})

const gone = (startedAt: Ms, lengthMin: number): CompletedSegment => ({
  kind: 'away',
  id: id(),
  startedAt,
  endedAt: startedAt + minutes(lengthMin),
})

describe('vitalsFor', () => {
  it('is all zeroes on an empty history', () => {
    expect(vitalsFor([], TWO_PM)).toEqual({
      blocksToday: 0,
      focusMinutesToday: 0,
      streak: 0,
    })
  })

  it('counts completed blocks and the minutes actually spent in them', () => {
    const history = [block(TWO_PM - minutes(120), 45), block(TWO_PM - minutes(60), 20)]
    expect(vitalsFor(history, TWO_PM)).toMatchObject({
      blocksToday: 2,
      focusMinutesToday: 65,
    })
  })

  it('credits a block that was cut short with nothing', () => {
    const history = [block(TWO_PM - minutes(60), 12, 'abandoned')]
    expect(vitalsFor(history, TWO_PM)).toMatchObject({
      blocksToday: 0,
      focusMinutesToday: 0,
    })
  })

  it('ignores yesterday entirely', () => {
    const history = [block(YESTERDAY, 45), block(TWO_PM - minutes(60), 45)]
    expect(vitalsFor(history, TWO_PM)).toMatchObject({ blocksToday: 1 })
  })

  it('keys a segment on the day it started, not the day it ended', () => {
    // Named at 23:50, finished at 00:35. It belongs to the day it was named in,
    // which is also the day the timeline drew it on.
    const lateLastNight = new Date(2026, 7, 19, 23, 50, 0).getTime()
    const justAfterMidnight = new Date(2026, 7, 20, 0, 35, 0).getTime()
    const history = [block(lateLastNight, 45)]

    expect(vitalsFor(history, justAfterMidnight)).toMatchObject({ blocksToday: 0 })
    expect(vitalsFor(history, lateLastNight)).toMatchObject({ blocksToday: 1 })
  })

  it('does not count the priorities timer as focus', () => {
    const history = [
      block(TWO_PM - minutes(60), 5, 'completed', 'reflect'),
      block(TWO_PM - minutes(50), 45),
    ]
    expect(vitalsFor(history, TWO_PM)).toMatchObject({
      blocksToday: 1,
      focusMinutesToday: 45,
    })
  })

  it('rounds part-minutes down', () => {
    const history: CompletedSegment[] = [
      {
        ...block(TWO_PM - minutes(60), 45),
        endedAt: TWO_PM - minutes(60) + minutes(45) + 59_000,
      },
    ]
    expect(vitalsFor(history, TWO_PM)).toMatchObject({ focusMinutesToday: 45 })
  })
})

describe('the streak', () => {
  it('counts the run of completed blocks at the end of the day so far', () => {
    const history = [
      block(TWO_PM - minutes(240), 45),
      block(TWO_PM - minutes(180), 45),
      block(TWO_PM - minutes(120), 45),
    ]
    expect(vitalsFor(history, TWO_PM).streak).toBe(3)
  })

  it('is reset by a block that was cut short', () => {
    const history = [
      block(TWO_PM - minutes(240), 45),
      block(TWO_PM - minutes(180), 10, 'abandoned'),
      block(TWO_PM - minutes(120), 45),
    ]
    expect(vitalsFor(history, TWO_PM).streak).toBe(1)
  })

  it('is reset by a stretch Mono could not account for', () => {
    const history = [block(TWO_PM - minutes(240), 45), gone(TWO_PM - minutes(180), 90)]
    expect(vitalsFor(history, TWO_PM).streak).toBe(0)
  })

  // The two things the app wants you to do deliberately. Punishing either of
  // them here would argue with the rest of the product.
  it('survives a break', () => {
    const history = [
      block(TWO_PM - minutes(240), 45),
      rest(TWO_PM - minutes(180), 15),
      block(TWO_PM - minutes(120), 45),
    ]
    expect(vitalsFor(history, TWO_PM).streak).toBe(2)
  })

  it('survives the priorities timer', () => {
    const history = [
      block(TWO_PM - minutes(240), 45),
      block(TWO_PM - minutes(180), 5, 'completed', 'reflect'),
      block(TWO_PM - minutes(120), 45),
    ]
    expect(vitalsFor(history, TWO_PM).streak).toBe(2)
  })

  it('starts again from zero tomorrow', () => {
    const history = [block(YESTERDAY, 45), block(YESTERDAY + minutes(60), 45)]
    expect(vitalsFor(history, TWO_PM).streak).toBe(0)
  })
})

/**
 * A block that has finished but has not been recorded.
 *
 * The machine deliberately holds a completed block open through the "break or
 * keep going?" prompt so that walking away from it cannot silently bank the
 * block. That is a settled decision with its own test in `machine.test.ts`.
 * The consequence is that anything reading the day back during that prompt
 * sees one block fewer than the user does — which is why `vitalsFor` takes it
 * as an argument rather than the companion inventing its own count.
 */
describe('a block waiting to be confirmed', () => {
  const pending = (startedAt: Ms, lengthMin: number, blockKind: BlockKind = 'deep') =>
    ({
      kind: 'block',
      id: 'pending',
      blockKind,
      purpose: 'the one thing',
      startedAt,
      endsAt: startedAt + minutes(lengthMin),
    }) satisfies ActiveSegment

  it('counts toward the day the moment its timer runs out', () => {
    const waiting = pending(TWO_PM - minutes(45), 45)
    expect(vitalsFor([], TWO_PM)).toMatchObject({ blocksToday: 0, streak: 0 })
    expect(vitalsFor([], TWO_PM, waiting)).toMatchObject({
      blocksToday: 1,
      focusMinutesToday: 45,
      streak: 1,
    })
  })

  it('is credited at the end of the block, not at the moment it is confirmed', () => {
    // The user sits on the prompt for ten minutes. The block was 45 minutes.
    const waiting = pending(TWO_PM - minutes(55), 45)
    expect(vitalsFor([], TWO_PM, waiting).focusMinutesToday).toBe(45)
  })

  it('extends a run rather than restarting it', () => {
    const history = [block(TWO_PM - minutes(180), 45), block(TWO_PM - minutes(120), 45)]
    const waiting = pending(TWO_PM - minutes(45), 45)
    expect(vitalsFor(history, TWO_PM, waiting).streak).toBe(3)
  })

  it('ignores a break that is merely running', () => {
    const running: ActiveSegment = {
      kind: 'break',
      id: 'b',
      startedAt: TWO_PM - minutes(5),
      endsAt: TWO_PM + minutes(10),
    }
    expect(vitalsFor([], TWO_PM, running)).toMatchObject({ blocksToday: 0 })
  })
})

/**
 * The coupling that actually broke: the machine's phases and what the day
 * looks like from the companion's side. Unit-testing `vitalsFor` and
 * `utteranceFor` separately could not catch it, because each was right on its
 * own — it was the handover between them that was off by one block.
 */
describe('driven through the real machine', () => {
  const drive = (actions: Action[]) => {
    let phase: Phase = initialPhase
    let session: SessionState = initialState
    const deps = { newId: () => 'id' }

    for (const action of actions) {
      const result = transition(phase, session, action, deps)
      phase = result.phase
      for (const event of result.events as MonoEvent[]) session = reduce(session, event)
    }
    return { phase, session }
  }

  const finishOneBlock: Action[] = [
    { type: 'startBlock', at: TWO_PM - minutes(45), blockKind: 'deep' },
    { type: 'setPurpose', at: TWO_PM - minutes(45), purpose: 'Write the planner' },
    { type: 'timerElapsed', at: TWO_PM },
  ]

  it('sees the first block of the day at the break prompt', () => {
    const { phase, session } = drive(finishOneBlock)
    expect(phase.name).toBe('blockComplete')

    // The log has not banked it yet, on purpose.
    expect(vitalsFor(session.history, TWO_PM).blocksToday).toBe(0)

    // The companion passes the open segment, because the user just watched
    // the timer hit zero. Without it this said "that makes 0 today".
    expect(vitalsFor(session.history, TWO_PM, session.active).blocksToday).toBe(1)
  })

  it('does not double-count once the answer lands', () => {
    const { phase, session } = drive([
      ...finishOneBlock,
      { type: 'takeBreak', at: TWO_PM },
    ])
    expect(phase.name).toBe('choosingBreak')
    expect(session.active).toBeNull()
    expect(vitalsFor(session.history, TWO_PM, session.active).blocksToday).toBe(1)
  })

  it('holds the count steady across the whole prompt-to-break handover', () => {
    const counts = [
      drive(finishOneBlock),
      drive([...finishOneBlock, { type: 'takeBreak', at: TWO_PM }]),
      drive([
        ...finishOneBlock,
        { type: 'takeBreak', at: TWO_PM },
        { type: 'confirmBreak', at: TWO_PM, durationMin: 15 },
      ]),
    ].map(({ session }) => vitalsFor(session.history, TWO_PM, session.active).blocksToday)

    expect(counts).toEqual([1, 1, 1])
  })
})
