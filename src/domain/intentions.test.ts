import { describe, expect, it } from 'vitest'

import { blockIntentions, tasksOfIntention } from './intentions'
import type { Intention } from './types'

const intentions: Intention[] = [
  { id: 'auth', title: 'Mono auth' },
  { id: 'billing', title: 'Billing ticket' },
  { id: 'reading', title: 'Read the paper' },
]

describe('blockIntentions', () => {
  it("derives a block's intentions from its tasks, in the day's order", () => {
    const links = { login: 'auth', invoice: 'billing', csrf: 'auth' }
    expect(
      blockIntentions(['invoice', 'login', 'csrf'], links, intentions).map((i) => i.id),
    ).toEqual(['auth', 'billing'])
  })

  it('leaves out a task from outside every intention', () => {
    expect(blockIntentions(['stray'], {}, intentions)).toEqual([])
  })
})

describe('tasksOfIntention', () => {
  it('finds the tasks linked to one intention', () => {
    const links = { login: 'auth', invoice: 'billing', csrf: 'auth' }
    expect(tasksOfIntention('auth', links).sort()).toEqual(['csrf', 'login'])
  })
})
