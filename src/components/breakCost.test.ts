/**
 * The break-cost wording, which two panels now render from one description.
 *
 * Pure, so it is tested here rather than through either of them — the point is
 * the branching and the phrasing, not the markup that carries it.
 */

import { describe, expect, it } from 'vitest'

import { BREAK_DURATIONS, describeBreakCost } from './breakCost'

describe('describeBreakCost', () => {
  it('calls a break free when it displaces nothing', () => {
    expect(describeBreakCost({ blocksLost: 0, focusMinutesLost: 0 })).toEqual({ free: true })
  })

  it('quotes blocks in preference to minutes', () => {
    expect(describeBreakCost({ blocksLost: 1, focusMinutesLost: 0 })).toEqual({
      free: false,
      lost: '1 block',
      also: null,
    })
  })

  it('pluralises the blocks', () => {
    expect(describeBreakCost({ blocksLost: 2, focusMinutesLost: 0 }).free).toBe(false)
    expect(describeBreakCost({ blocksLost: 2, focusMinutesLost: 0 })).toMatchObject({
      lost: '2 blocks',
    })
  })

  it('falls back to minutes when no whole block is lost', () => {
    expect(describeBreakCost({ blocksLost: 0, focusMinutesLost: 15 })).toEqual({
      free: false,
      lost: '15 focus minutes',
      also: null,
    })
  })

  it('carries the loose minutes alongside whole blocks', () => {
    expect(describeBreakCost({ blocksLost: 1, focusMinutesLost: 10 })).toEqual({
      free: false,
      lost: '1 block',
      also: '10 focus minutes',
    })
  })

  // The case that made this shared in the first place: zero minutes on top of
  // whole blocks must not produce a dangling "and 0 focus minutes".
  it('says nothing extra when the blocks are the whole story', () => {
    expect(describeBreakCost({ blocksLost: 3, focusMinutesLost: 0 }).free).toBe(false)
    expect(describeBreakCost({ blocksLost: 3, focusMinutesLost: 0 })).toMatchObject({
      also: null,
    })
  })
})

describe('BREAK_DURATIONS', () => {
  it('is short, ascending, and starts at a real break', () => {
    expect(BREAK_DURATIONS.length).toBeLessThanOrEqual(6)
    expect([...BREAK_DURATIONS].sort((a, b) => a - b)).toEqual(BREAK_DURATIONS)
    expect(BREAK_DURATIONS[0]).toBeGreaterThan(0)
  })
})
