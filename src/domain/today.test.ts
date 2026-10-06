import { describe, expect, it } from 'vitest'

import {
  blockIntentions,
  carriedOver,
  isToday,
  tasksOfIntention,
  todayTaskIds,
  ungroupedToday,
} from './today'
import type { Intention } from './types'

const intentions: Intention[] = [
  { id: 'auth', title: 'Mono auth' },
  { id: 'billing', title: 'Billing ticket' },
  { id: 'reading', title: 'Read the paper' },
]

const today = { login: 'auth', invoice: 'billing', stray: null, csrf: 'auth' }

describe('today', () => {
  it('lists its tasks in the order they were chosen', () => {
    expect(todayTaskIds(today)).toEqual(['login', 'invoice', 'stray', 'csrf'])
  })

  it('knows its own tasks, and nothing an object inherits', () => {
    expect(isToday(today, 'stray')).toBe(true)
    expect(isToday(today, 'constructor')).toBe(false)
  })

  it('finds the tasks under one intention, and the ones under none', () => {
    expect(tasksOfIntention('auth', today)).toEqual(['login', 'csrf'])
    expect(ungroupedToday(today)).toEqual(['stray'])
  })
})

describe('blockIntentions', () => {
  it("derives a block's intentions from its tasks, in the day's order", () => {
    expect(
      blockIntentions(['invoice', 'login', 'csrf'], today, intentions).map((i) => i.id),
    ).toEqual(['auth', 'billing'])
  })

  it('leaves out a task under no intention, or not today at all', () => {
    expect(blockIntentions(['stray', 'elsewhere'], today, intentions)).toEqual([])
  })
})

describe('carriedOver', () => {
  it('offers what the last day chose that is still open, in its order', () => {
    expect(carriedOver(['b', 'a', 'c'], {}, ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('leaves out what was finished, put away or deleted since', () => {
    expect(carriedOver(['done', 'open'], {}, ['open'])).toEqual(['open'])
  })

  it('leaves out what today has already chosen again', () => {
    expect(carriedOver(['a', 'b'], { a: null }, ['a', 'b'])).toEqual(['b'])
  })

  it('offers each task once', () => {
    expect(carriedOver(['a', 'a'], {}, ['a'])).toEqual(['a'])
  })
})
