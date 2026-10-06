import { describe, expect, it } from 'vitest'

import { miniViewFor, type MiniFacts } from './view'
import type { Phase } from '@/domain/machine'

/** A shaped day, mid-morning, with a deep block waiting. The ordinary case. */
const facts = (over: Partial<MiniFacts> = {}): MiniFacts => ({
  setup: null,
  withinHours: true,
  nextBlockKind: 'deep',
  nextRegionStart: null,
  ...over,
})

const PHASES: Phase[] = [
  { name: 'idle' },
  { name: 'definingPurpose', blockKind: 'deep', deciding: null },
  { name: 'focusing' },
  { name: 'blockComplete' },
  { name: 'choosingBreak' },
  { name: 'onBreak' },
  { name: 'reconciling', lastSeenAt: 0, blockEndedAt: 0 },
]

describe('every phase has somewhere to go', () => {
  it.each(PHASES)('$name maps to a view', (phase) => {
    expect(miniViewFor(phase, facts())).toBeTruthy()
  })

  // The stage strip hides itself during "you were away" because being away is
  // an interruption rather than a place in the journey. The mini window does
  // not get to do that: nothing is recorded until the question is answered, so
  // it has to be asked wherever the user is looking.
  it('asks about being away rather than going blank', () => {
    const phase: Phase = { name: 'reconciling', lastSeenAt: 100, blockEndedAt: 900 }
    expect(miniViewFor(phase, facts())).toEqual({ kind: 'away', blockEndedAt: 900 })
  })
})

describe('the idle precedence', () => {
  const idle: Phase = { name: 'idle' }

  it('puts an opening question on the stage above everything else', () => {
    expect(
      miniViewFor(
        idle,
        facts({
          setup: { stage: 'hours', revisiting: false },
          withinHours: false,
          nextBlockKind: null,
        }),
      ),
    ).toEqual({ kind: 'setup', stage: 'hours', revisiting: false })
  })

  it('will not offer a block in time the user declared unstructured', () => {
    expect(miniViewFor(idle, facts({ withinHours: false, nextRegionStart: 500 }))).toEqual({
      kind: 'outsideHours',
      nextStart: 500,
    })
  })

  it('says so when the day is over rather than naming a next stretch', () => {
    expect(miniViewFor(idle, facts({ withinHours: false }))).toEqual({
      kind: 'outsideHours',
      nextStart: null,
    })
  })

  it('distinguishes nothing fitting from nothing being offered', () => {
    expect(miniViewFor(idle, facts({ nextBlockKind: null }))).toEqual({ kind: 'nothingFits' })
    expect(miniViewFor(idle, facts({ nextBlockKind: 'short' }))).toEqual({
      kind: 'ready',
      blockKind: 'short',
    })
  })
})

describe('what the phases carry through', () => {
  it('keeps the block kind for the purpose prompt', () => {
    const phase: Phase = { name: 'definingPurpose', blockKind: 'short', deciding: null }
    expect(miniViewFor(phase, facts())).toEqual({
      kind: 'purpose',
      blockKind: 'short',
      deciding: null,
    })
  })

  it("carries the purpose prompt's deciding timer, so the window can show it", () => {
    const deciding = { startedAt: 100, endsAt: 400 }
    const phase: Phase = { name: 'definingPurpose', blockKind: 'deep', deciding }
    expect(miniViewFor(phase, facts())).toEqual({ kind: 'purpose', blockKind: 'deep', deciding })
  })

  it('runs a block as a block, and a break as a break', () => {
    expect(miniViewFor({ name: 'focusing' }, facts())).toEqual({
      kind: 'running',
      segment: 'block',
    })
    expect(miniViewFor({ name: 'onBreak' }, facts())).toEqual({
      kind: 'running',
      segment: 'break',
    })
  })

  it('carries what comes next into the block-done question', () => {
    expect(miniViewFor({ name: 'blockComplete' }, facts({ nextBlockKind: null }))).toEqual({
      kind: 'done',
      nextBlockKind: null,
    })
  })
})

/**
 * The window follows the stage exactly. It used to follow `dayShaped` instead,
 * and offered the next block while the tab was back on the hours.
 */
describe('the opening questions', () => {
  const idle: Phase = { name: 'idle' }

  it.each(['commitments', 'hours', 'today'] as const)(
    'shows %s whenever the stage does, first time or not',
    (stage) => {
      for (const revisiting of [false, true]) {
        expect(miniViewFor(idle, facts({ setup: { stage, revisiting } }))).toEqual({
          kind: 'setup',
          stage,
          revisiting,
        })
      }
    },
  )

  it('only while nothing is running', () => {
    const setup = { stage: 'today' as const, revisiting: true }
    expect(miniViewFor({ name: 'focusing' }, facts({ setup }))).toEqual({
      kind: 'running',
      segment: 'block',
    })
  })
})
