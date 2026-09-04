import { describe, expect, it } from 'vitest'

import { dayDoneFor } from './stages'

const completedDay = {
  phase: { name: 'idle' } as const,
  setupOpen: false,
  withinHours: false,
  nextRegionStart: null,
  hasRegions: true,
}

describe('dayDoneFor', () => {
  it('shows the postcard only when the completed day is the current stage', () => {
    expect(dayDoneFor(completedDay)).toBe(true)
    expect(dayDoneFor({ ...completedDay, setupOpen: true })).toBe(false)
  })

  it('requires an idle day with work regions and no later region', () => {
    expect(dayDoneFor({ ...completedDay, phase: { name: 'focusing' } })).toBe(false)
    expect(dayDoneFor({ ...completedDay, hasRegions: false })).toBe(false)
    expect(dayDoneFor({ ...completedDay, nextRegionStart: 1 })).toBe(false)
    expect(dayDoneFor({ ...completedDay, withinHours: true })).toBe(false)
  })
})
