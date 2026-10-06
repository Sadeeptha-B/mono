import { describe, expect, it } from 'vitest'

import {
  blockIntentions,
  emptyIntentionDraft,
  planIntentionSave,
  tasksOfIntention,
} from './intentions'
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

describe('planIntentionSave', () => {
  const backlog = (taskIntentions: Record<string, string> = {}) => ({
    offered: ['form', 'cookie', 'csrf', 'gate'],
    taskIntentions,
  })

  it('saves nothing without a title', () => {
    expect(planIntentionSave({ ...emptyIntentionDraft, title: '  ' }, backlog())).toBeNull()
  })

  it('adds an intention and links its tasks', () => {
    expect(
      planIntentionSave({ title: ' Ship it ', taskIds: ['form', 'gate'], editing: null }, backlog()),
    ).toEqual({ kind: 'add', intention: { title: 'Ship it' }, link: ['form', 'gate'] })
  })

  it('counts only tasks the backlog still offers, once each', () => {
    expect(
      planIntentionSave(
        { title: 'Ship it', taskIds: ['form', 'gone', 'form'], editing: null },
        backlog(),
      ),
    ).toEqual({ kind: 'add', intention: { title: 'Ship it' }, link: ['form'] })
  })

  it('on an edit, links only what is new and unlinks what was taken out', () => {
    expect(
      planIntentionSave(
        { title: 'Ship it', taskIds: ['form', 'cookie'], editing: 'i1' },
        backlog({ form: 'i1', csrf: 'i1', gate: 'i2' }),
      ),
    ).toEqual({
      kind: 'update',
      id: 'i1',
      patch: { title: 'Ship it' },
      link: ['cookie'],
      unlink: ['csrf'],
    })
  })
})
