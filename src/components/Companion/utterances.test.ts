import { describe, expect, it } from 'vitest'

import { utteranceFor } from './utterances'
import { MOODS, type MoodName } from './cat'
import type { Vitals } from '@/domain/vitals'

const day = (over: Partial<Vitals> = {}): Vitals => ({
  blocksToday: 0,
  focusMinutesToday: 0,
  streak: 0,
  ...over,
})

/**
 * The rule this file exists to hold: the cat is allowed to remark at the seams
 * of a block and nowhere else. Everything in the middle has something better
 * on the stage — a timer, or a question waiting on an answer.
 */
const SPEAKS: MoodName[] = ['idle', 'complete', 'resting']

describe('when the cat speaks at all', () => {
  it.each(Object.keys(MOODS) as MoodName[])('%s is silent or not, deliberately', (mood) => {
    const said = utteranceFor(mood, day({ blocksToday: 3, focusMinutesToday: 100, streak: 3 }))
    expect(said === null).toBe(!SPEAKS.includes(mood))
  })

  it('says nothing during a block, however the day has gone', () => {
    for (const vitals of [day(), day({ blocksToday: 9, focusMinutesToday: 400, streak: 9 })]) {
      expect(utteranceFor('focusing', vitals)).toBeNull()
      expect(utteranceFor('reflecting', vitals)).toBeNull()
    }
  })
})

describe('what it says', () => {
  it('admits an empty day rather than dressing it up', () => {
    expect(utteranceFor('idle', day())).toBe('Nothing banked yet today.')
  })

  it('counts what is behind you, in blocks and in time', () => {
    expect(utteranceFor('idle', day({ blocksToday: 1, focusMinutesToday: 45 }))).toBe(
      '1 block banked · 45m',
    )
    expect(utteranceFor('idle', day({ blocksToday: 3, focusMinutesToday: 110 }))).toBe(
      '3 blocks banked · 1h 50m',
    )
  })

  it('marks the first block of the day as the first', () => {
    expect(utteranceFor('complete', day({ blocksToday: 1, streak: 1 }))).toBe(
      'First one today.',
    )
  })

  it('prefers the run to the total once there is a run', () => {
    expect(utteranceFor('complete', day({ blocksToday: 5, streak: 3 }))).toBe('3 in a row.')
  })

  it('falls back to the total when the run was just broken', () => {
    expect(utteranceFor('complete', day({ blocksToday: 4, streak: 1 }))).toBe(
      'That makes 4 today.',
    )
  })

  it('has nothing to add to a break taken before anything was banked', () => {
    expect(utteranceFor('resting', day())).toBeNull()
    expect(utteranceFor('resting', day({ blocksToday: 2 }))).toBe('2 blocks behind you.')
  })
})
