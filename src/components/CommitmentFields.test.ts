import { describe, expect, it } from 'vitest'

import { editsOf, readCommitmentChanges, shownDraft } from './CommitmentFields'
import type { Commitment } from '@/domain/types'

const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m).getTime()
const now = at(9)
const review: Commitment = {
  id: 'c1',
  title: 'Review',
  startsAt: at(17),
  durationMin: 30,
  prepMin: 10,
}

describe('an edit to a commitment', () => {
  it('shows the commitment as it is now, under what was typed', () => {
    const edits = editsOf(review, { ...shownDraft(review, {}), title: 'Design review' })
    expect(edits).toEqual({ title: 'Design review' })

    // Moved to four while the form was open: the time it shows follows.
    const moved = { ...review, startsAt: at(16) }
    expect(shownDraft(moved, edits)).toMatchObject({ title: 'Design review', time: '16:00' })
  })

  it('saves only what was typed, so a move made meanwhile stays', () => {
    const edits = editsOf(review, { ...shownDraft(review, {}), title: 'Design review' })
    const moved = { ...review, startsAt: at(16) }
    expect(readCommitmentChanges(now, moved, edits)).toEqual({ title: 'Design review' })
    expect(readCommitmentChanges(now, moved, {})).toEqual({})
  })

  it('forgets a field typed back to what it was', () => {
    const changed = editsOf(review, { ...shownDraft(review, {}), time: '18:00' })
    expect(changed).toEqual({ time: '18:00' })
    expect(editsOf(review, shownDraft(review, { time: '17:00' }))).toEqual({})
  })

  it('sends a cleared margin as zero, and waits while the form does not read', () => {
    expect(readCommitmentChanges(now, review, { prepText: '0' })).toEqual({ prepMin: 0 })
    expect(readCommitmentChanges(now, review, { time: '18:30' })).toEqual({ startsAt: at(18, 30) })
    expect(readCommitmentChanges(now, review, { title: '  ' })).toBeNull()
  })
})
