import { describe, expect, it } from 'vitest'

import { SPRITE_H } from '@/components/Companion/frames'
import { GROUND_Y, SCENE_W, SPRITE_TOP, trailShapes } from './scene'

describe('companion scene geometry', () => {
  it('keeps the authored sprite standing on the room floor', () => {
    expect(GROUND_Y).toBe(SPRITE_TOP + SPRITE_H)
  })

  it('grows a sparse trail from the left at the cap density', () => {
    const sparse = trailShapes([{ kind: 'deep' }, { kind: 'short' }])
    const capped = trailShapes(Array.from({ length: 32 }, () => ({ kind: 'deep' as const })))
    const [first, second] = sparse
    const last = capped.at(-1)

    expect(sparse).toHaveLength(2)
    expect(first?.kind).toBe('rect')
    expect(second?.kind).toBe('rect')
    expect(last?.kind).toBe('rect')
    if (first?.kind !== 'rect' || second?.kind !== 'rect' || last?.kind !== 'rect') return

    expect(first.x).toBeCloseTo(0.15)
    expect(first.width).toBeCloseTo(1.2)
    expect(second.x).toBeCloseTo(1.95)
    expect(second.width).toBeCloseTo(0.6)
    expect(last.x).toBeCloseTo(46.65)
    expect(last.x + last.width).toBeLessThanOrEqual(SCENE_W)
  })
})
