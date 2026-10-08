import { describe, expect, it } from 'vitest'

import type { Later } from '@/domain/later'
import type { Item } from '@/domain/tasks'
import { createOwed, positionOf, type Position } from './owed'
import type { BacklogContents, WriteResult } from './taskDb'

/**
 * What one tab owes the disk, without a disk: the write each state of it
 * builds, and what each answer leaves owed and shown. The store drives the
 * same rules against IndexedDB in `tasks.test.ts`.
 */

const task = (id: string, order: number, patch: Partial<Item> = {}): Item => ({
  id,
  kind: 'task',
  title: id.toUpperCase(),
  parentId: 'work',
  status: 'open',
  order,
  createdAt: 1,
  updatedAt: 10,
  ...patch,
})

const line = (id: string, patch: Partial<Later> = {}): Later => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 10,
  ...patch,
})

const nothing = (): BacklogContents => ({ areas: [], items: [], later: [] })

const written = (
  stale: Partial<BacklogContents> = {},
  more: { refused?: string[]; renumberingRefused?: boolean } = {},
): Extract<WriteResult, { kind: 'written' }> => ({
  kind: 'written',
  stale: { ...nothing(), ...stale },
  refused: more.refused ?? [],
  ...(more.renumberingRefused !== undefined ? { renumberingRefused: more.renumberingRefused } : {}),
})

const before = (...records: Item[]) =>
  new Map<string, Position>(records.map((r) => [r.id, positionOf(r)]))

/** B and C renumbered after they tied at 5: B 1, C 2. */
function renumbered() {
  const owed = createOwed()
  const b = task('b', 5)
  const c = task('c', 5)
  const b2 = { ...b, order: 1, updatedAt: 11 }
  const c2 = { ...c, order: 2, updatedAt: 11 }
  owed.place('items', [b2, c2], before(b, c))
  return { owed, b, c, b2, c2 }
}

describe('what is sent', () => {
  it('sends a renumbering whole, and a plain edit beside it', () => {
    const { owed, b2, c2 } = renumbered()
    const d = task('d', 3, { title: 'Renamed', updatedAt: 11 })
    owed.owe('items', d)

    const sent = owed.batch()!
    expect(sent.changes.renumbering).toEqual({ areas: [], items: [b2, c2] })
    expect(sent.changes.items).toEqual([d])
  })

  it('sends a filed task once, inside its filing, where its renumbering put it', () => {
    const owed = createOwed()
    const filed = task('filed', 2.5, { updatedAt: 11 })
    const waiting = line('l')
    owed.file(filed, { ...waiting, deletedAt: 11, updatedAt: 11 }, waiting, false)
    // A sibling dropped among them afterwards numbers the filed task again.
    const moved = { ...filed, order: 0, updatedAt: 12 }
    owed.place('items', [moved, task('a', 2, { updatedAt: 12 })], before(filed, task('a', 0)))

    const sent = owed.batch()!
    expect(sent.changes.filings).toEqual([
      expect.objectContaining({ task: moved, needsRoom: true }),
    ])
    expect(sent.changes.renumbering!.items.map((i) => i.id)).toEqual(['a'])
    expect(sent.changes.items).toEqual([])
  })

  it('takes a placed record dropped again where there was room to where it was dropped last', () => {
    const { owed, c2 } = renumbered()
    const later = { ...c2, order: 9, updatedAt: 12 }
    owed.owe('items', later)

    expect(owed.batch()!.changes.renumbering!.items).toContainEqual(later)
  })

  it('lays a placement over an edit built on a copy that does not carry it', () => {
    const { owed, c2 } = renumbered()
    // Another tab's copy, adopted and renamed here: its order is not ours.
    owed.owe('items', { ...c2, order: 5, title: 'C here', updatedAt: 30 })
    // Owing it moved the placement along with it…
    const sent = owed.batch()!
    const c = sent.changes.renumbering!.items.find((i) => i.id === 'c')!
    // …so it is the record as it now is that goes.
    expect(c).toMatchObject({ title: 'C here', order: 5 })
  })
})

describe('what the disk answers', () => {
  it('releases what landed, and keeps what was edited while the write was out', () => {
    const { owed, b2 } = renumbered()
    const sent = owed.batch()!
    const renamed = { ...b2, title: 'B again', updatedAt: 12 }
    owed.owe('items', renamed)

    owed.settle(sent, written(), { ...nothing(), items: [renamed] })
    expect(owed.isEmpty()).toBe(false)
    expect(owed.batch()!.changes.items).toEqual([renamed])
  })

  it('puts back only the order a refused renumbering gave, and still owes the rest', () => {
    const owed = createOwed()
    const b = task('b', 5)
    const c = task('c', 5)
    // C renamed, then numbered again with B.
    const cRenamed = { ...c, title: 'C renamed', updatedAt: 11 }
    owed.owe('items', cRenamed)
    const b2 = { ...b, order: 1, updatedAt: 12 }
    const c2 = { ...cRenamed, order: 2, updatedAt: 12 }
    owed.place('items', [b2, c2], before(b, cRenamed))

    const sent = owed.batch()!
    const theirs = { ...b, title: 'B elsewhere', updatedAt: 50 }
    const settled = owed.settle(
      sent,
      written({ items: [theirs, c] }, { renumberingRefused: true }),
      { ...nothing(), items: [b2, c2] },
    )
    const shown = new Map(settled.memory.items.map((i) => [i.id, i]))
    expect(shown.get('b')).toEqual(theirs)
    expect(shown.get('c')).toMatchObject({ title: 'C renamed', order: 5 })
    expect(settled.again).toBe(true)
    expect(owed.batch()!.changes.items).toEqual([expect.objectContaining({ id: 'c', title: 'C renamed', order: 5 })])
    expect(settled.broadcast.items).toEqual([])
  })

  it('keeps a record the disk never had owed, where it stood before, when its renumbering is refused', () => {
    const owed = createOwed()
    const fresh = task('fresh', 7, { updatedAt: 11 })
    owed.owe('items', fresh)
    const b = task('b', 5)
    const b2 = { ...b, order: 0, updatedAt: 12 }
    const fresh2 = { ...fresh, order: 1, updatedAt: 12 }
    owed.place('items', [b2, fresh2], before(b, fresh))

    const sent = owed.batch()!
    const settled = owed.settle(
      sent,
      written({ items: [{ ...b, updatedAt: 50 }] }, { renumberingRefused: true }),
      { ...nothing(), items: [b2, fresh2] },
    )
    expect(settled.memory.items.find((i) => i.id === 'fresh')).toMatchObject({ order: 7 })
    expect(owed.batch()!.changes.items).toEqual([expect.objectContaining({ id: 'fresh', order: 7 })])
  })

  it('owes nothing for a member the refusal leaves exactly as the disk has it', () => {
    const { owed, b, c, b2, c2 } = renumbered()
    const sent = owed.batch()!
    const settled = owed.settle(
      sent,
      written({ items: [{ ...b, updatedAt: 50 }, c] }, { renumberingRefused: true }),
      { ...nothing(), items: [b2, c2] },
    )
    expect(settled.memory.items.find((i) => i.id === 'c')).toEqual(c)
    expect(owed.isEmpty()).toBe(true)
    expect(settled.again).toBe(false)
  })

  it('undoes a refused filing: the task goes, and the line waits as it did', () => {
    const owed = createOwed()
    const filed = task('filed', 3, { updatedAt: 11 })
    const waiting = line('l')
    const gone = { ...waiting, deletedAt: 11, updatedAt: 11 }
    owed.file(filed, gone, waiting, false)

    const sent = owed.batch()!
    const settled = owed.settle(sent, written({}, { refused: ['l'] }), {
      ...nothing(),
      items: [filed],
      later: [gone],
    })
    expect(settled.memory.items).toEqual([])
    expect(settled.memory.later).toEqual([waiting])
    expect(owed.isEmpty()).toBe(true)
  })
})

describe("what another tab says", () => {
  it('lets go of an owed copy a newer one replaces', () => {
    const owed = createOwed()
    const mine = task('a', 1, { updatedAt: 11 })
    owed.owe('items', mine)
    const theirs = { ...mine, title: 'Theirs', updatedAt: 20 }

    expect(owed.adopt({ ...nothing(), items: [theirs] }, { ...nothing(), items: [mine] }).items).toEqual([
      theirs,
    ])
    expect(owed.isEmpty()).toBe(true)
  })

  it('shows a placed record as another tab has it, where the drop put it, and still owes it', () => {
    const { owed, c2 } = renumbered()
    const theirs = { ...c2, order: 5, title: 'C elsewhere', updatedAt: 20 }

    const memory = owed.adopt({ ...nothing(), items: [theirs] }, { ...nothing(), items: [c2] })
    expect(memory.items).toEqual([{ ...theirs, order: 2 }])
    expect(owed.batch()!.changes.renumbering!.items.map((i) => i.id)).toEqual(['b', 'c'])
  })
})
