import { describe, expect, it } from 'vitest'

import { dayProgressFor, dayProgressLabel } from './dayProgress'
import type { ActiveSegment, BlockKind, CompletedSegment } from './types'

const NOW = new Date(2026, 8, 4, 17, 0).getTime()
const minute = 60_000

const block = (
  offset: number,
  minutes: number,
  kind: BlockKind = 'deep',
  outcome: 'completed' | 'abandoned' = 'completed',
  purpose = 'Write',
): CompletedSegment => ({
  kind: 'block', id: `b-${offset}`, blockKind: kind, purpose,
  startedAt: NOW + offset * minute,
  endedAt: NOW + (offset + minutes) * minute,
  plannedEndsAt: NOW + (offset + minutes) * minute,
  outcome,
})

const rest = (offset: number, minutes: number): CompletedSegment => ({
  kind: 'break', id: `r-${offset}`, startedAt: NOW + offset * minute,
  endedAt: NOW + (offset + minutes) * minute,
  plannedEndsAt: NOW + (offset + minutes) * minute,
})

const pending = (offset: number, minutes: number, kind: BlockKind = 'deep'): ActiveSegment => ({
  kind: 'block', id: 'pending', blockKind: kind, purpose: 'Land it',
  startedAt: NOW + offset * minute, endsAt: NOW + (offset + minutes) * minute,
})

describe('dayProgressFor', () => {
  it('pluralises the companion day summary', () => {
    expect(dayProgressLabel({ blocks: 1, focusMinutes: 1 })).toBe(
      '1 focus block and 1 focus minute today',
    )
    expect(dayProgressLabel({ blocks: 2, focusMinutes: 45 })).toBe(
      '2 focus blocks and 45 focus minutes today',
    )
  })

  it('summarises completed focus, breaks, scene tier and the earliest longest block', () => {
    const progress = dayProgressFor([
      block(-180, 45, 'deep', 'completed', 'First longest'),
      rest(-130, 15),
      block(-110, 20, 'short', 'completed', 'Short'),
      block(-80, 45, 'deep', 'completed', 'Later tie'),
    ], NOW)

    expect(progress).toMatchObject({
      blocks: 3, deepBlocks: 2, shortBlocks: 1, focusMinutes: 110,
      breaks: 1, breakMinutes: 15, sceneTier: 2,
      longestBlock: { purpose: 'First longest', minutes: 45 },
    })
    expect(progress.trail.map((entry) => entry.kind)).toEqual(['deep', 'break', 'short', 'deep'])
  })

  it('counts a pending completion and gives once-only firsts priority', () => {
    const history = [block(-150, 10, 'deep', 'abandoned'), rest(-130, 10)]
    expect(dayProgressFor(history, NOW, pending(-45, 45)).milestone).toBe('first-deep')
  })

  it('does not let a return from break shadow the ninety-minute crossing', () => {
    const history = [block(-180, 45), block(-120, 25, 'short'), rest(-80, 15)]
    expect(dayProgressFor(history, NOW, pending(-45, 45)).milestone).toBe('ninety')
  })

  it('shows recovery and return at most once each per day', () => {
    const history = [
      block(-220, 10),
      rest(-205, 5),
      block(-195, 10, 'short'),
      block(-180, 5, 'short', 'abandoned'),
      block(-170, 10, 'short'),
      rest(-155, 5),
    ]
    expect(dayProgressFor(history.slice(0, 2), NOW, pending(-195, 10, 'short')).milestone).toBe('return')
    expect(dayProgressFor(history.slice(0, 4), NOW, pending(-170, 10, 'short')).milestone).toBe('recovery')
    expect(dayProgressFor(history, NOW, pending(-145, 10, 'short')).milestone).toBeNull()
  })

  it('uses honest gaps and compresses trails longer than 32 entries', () => {
    const history = Array.from({ length: 34 }, (_, index) =>
      block(-300 + index * 2, 1, 'short', index === 0 ? 'abandoned' : 'completed'),
    )
    const trail = dayProgressFor(history, NOW).trail
    expect(trail).toHaveLength(32)
    expect(trail[0]).toEqual({ kind: 'aggregate', count: 3 })
  })
})
