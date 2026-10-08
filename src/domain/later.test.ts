import { describe, expect, it } from 'vitest'

import { letGo, letGoLater, newLater, restore, waitingLater, type Later } from './later'

const later = (id: string, createdAt: number, extra: Partial<Later> = {}): Later => ({
  ...newLater({ id, title: id }, createdAt),
  ...extra,
})

describe('later', () => {
  it('trims what was written, and keeps where it came from only when it came from a block', () => {
    expect(newLater({ id: 'a', title: '  Try WebGPU  ' }, 5)).toEqual({
      id: 'a',
      title: 'Try WebGPU',
      createdAt: 5,
      updatedAt: 5,
    })
    const from = { blockId: 'b', purpose: 'Draft the schema' }
    expect(newLater({ id: 'a', title: 'x', from }, 5).from).toEqual(from)
  })

  it('is let go and brought back as it was, with a new version each way', () => {
    const waiting = later('a', 1)
    const gone = letGo(waiting, 7)
    expect(gone).toMatchObject({ letGoAt: 7, updatedAt: 7 })
    const back = restore(gone, 9)
    expect(back).toEqual({ ...waiting, updatedAt: 9 })
    expect('letGoAt' in back).toBe(false)
  })

  it('lists what is waiting and what was let go apart, oldest first, without the deleted', () => {
    const list = [
      later('c', 3),
      later('a', 1),
      later('gone', 2, { deletedAt: 4 }),
      later('l2', 6, { letGoAt: 8 }),
      later('l1', 5, { letGoAt: 9 }),
      later('lgone', 4, { letGoAt: 9, deletedAt: 10 }),
    ]
    expect(waitingLater(list).map((l) => l.id)).toEqual(['a', 'c'])
    expect(letGoLater(list).map((l) => l.id)).toEqual(['l1', 'l2'])
  })
})
