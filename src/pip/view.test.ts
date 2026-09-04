import { describe, expect, it } from 'vitest'

import { miniViewFor, type MiniFacts } from './view'
import type { Phase } from '@/domain/machine'

/** A shaped day, mid-morning, with a deep block waiting. The ordinary case. */
const facts = (over: Partial<MiniFacts> = {}): MiniFacts => ({
  dayShaped: true,
  withinHours: true,
  nextBlockKind: 'deep',
  nextRegionStart: null,
  ...over,
})

const PHASES: Phase[] = [
  { name: 'idle' },
  { name: 'definingPurpose', blockKind: 'deep', afterReflection: false },
  { name: 'reflecting' },
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

  it('puts an unshaped day above everything else', () => {
    expect(
      miniViewFor(idle, facts({ dayShaped: false, withinHours: false, nextBlockKind: null })),
    ).toEqual({ kind: 'unshaped' })
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
  it('keeps the block kind and the reflection flag for the purpose prompt', () => {
    const phase: Phase = { name: 'definingPurpose', blockKind: 'short', afterReflection: true }
    expect(miniViewFor(phase, facts())).toEqual({
      kind: 'purpose',
      blockKind: 'short',
      afterReflection: true,
    })
  })

  // Priorities is a real block, so it runs like one out here. The difference
  // between it and a deep block is the label on the timer, which reads it off
  // the active segment rather than off this.
  it('runs a reflection as a block, and a break as a break', () => {
    expect(miniViewFor({ name: 'focusing' }, facts())).toEqual({
      kind: 'running',
      segment: 'block',
    })
    expect(miniViewFor({ name: 'reflecting' }, facts())).toEqual({
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
 * The one place the mini window deliberately disagrees with the stage.
 *
 * Going back to re-read the opening questions is where the user is *looking*,
 * not a fact about the day. Following it out here would point the mini window
 * at the window they are already reading, for as long as they read it.
 */
describe('re-opening the questions in the tab', () => {
  it('does not turn the mini window into a signpost', () => {
    expect(miniViewFor({ name: 'idle' }, facts({ dayShaped: true }))).toEqual({
      kind: 'ready',
      blockKind: 'deep',
    })
  })
})
