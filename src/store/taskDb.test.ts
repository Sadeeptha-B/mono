import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import type { Area, Item } from '@/domain/tasks'
import { openTaskDb, type TaskDb } from './taskDb'

const area = (id: string, updatedAt = 1): Area => ({
  id,
  name: id,
  order: 0,
  createdAt: 1,
  updatedAt,
})

const task = (id: string, title: string, updatedAt: number): Item => ({
  id,
  kind: 'task',
  title,
  parentId: 'work',
  status: 'open',
  order: 0,
  createdAt: 1,
  updatedAt,
})

let opened: TaskDb[] = []
const open = async (factory: IDBFactory) => {
  const db = await openTaskDb(factory)
  opened.push(db)
  return db
}

afterEach(() => {
  for (const db of opened) db.close()
  opened = []
})

describe('writing', () => {
  const epic = (deletedAt?: number): Item => ({
    id: 'epic',
    kind: 'epic',
    title: 'Mono auth',
    parentId: 'work',
    status: 'open',
    order: 0,
    createdAt: 1,
    updatedAt: deletedAt ?? 1,
    ...(deletedAt === undefined ? {} : { deletedAt }),
  })
  const under = (parentId: string, updatedAt: number): Item => ({
    ...task('t', 'Login form', updatedAt),
    parentId,
  })

  it('refuses to move a record out of a subtree already deleted, handing back its copy and the delete', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work'), area('personal')], items: [epic(), under('epic', 1)] }, 0)
    await db.write({ items: [epic(5)] }, 0)

    // The tombstone comes back too, so a writer that had not heard of the
    // delete learns of it, rather than go on showing the task as work.
    const result = await db.write({ items: [under('personal', 9)] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [under('epic', 1), epic(5)] } })
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('epic')
  })

  it('refuses it through any depth, and for a deleted area too', async () => {
    const db = await open(new IDBFactory())
    const outcome = { ...epic(), id: 'pages', kind: 'outcome' as const, parentId: 'epic' }
    await db.write({ areas: [area('work'), area('personal')], items: [epic(), outcome, under('pages', 1)] }, 0)
    await db.write({ areas: [{ ...area('work', 5), deletedAt: 5 }] }, 0)

    const result = await db.write({ items: [under('personal', 9)] }, 0)
    expect(result.kind === 'written' && result.stale.items.map((i) => i.id)).toEqual(['t'])
  })

  it('refuses a move whose subtree was deleted before, even when the same write deletes it again', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work'), area('personal')], items: [epic(), under('epic', 1)] }, 0)
    await db.write({ items: [epic(5)] }, 0)

    const result = await db.write({ items: [under('personal', 9), epic(7)] }, 0)
    expect(result.kind === 'written' && result.stale.items.map((i) => i.id)).toEqual(['t'])
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('epic')
  })

  it('judges a move by the disk as the write found it, not by a later edit in it', async () => {
    const db = await open(new IDBFactory())
    const gone = { ...area('old', 5), deletedAt: 5 }
    await db.write({ areas: [area('work'), area('personal'), gone], items: [epic(), under('epic', 1)] }, 0)

    // The task moves out, and the same write moves its epic into a deleted area.
    const movedEpic = { ...epic(), parentId: 'old', updatedAt: 9 }
    const result = await db.write({ items: [under('personal', 9), movedEpic] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [] } })
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('personal')
  })

  it('lets a move out land in the same write as the delete it came before', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work'), area('personal')], items: [epic(), under('epic', 1)] }, 0)

    const result = await db.write({ items: [under('personal', 9), epic(5)] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [] } })
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('personal')
  })

  it('lets a record already under a deleted epic be edited in place, since that brings nothing back', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work')], items: [epic(), under('epic', 1)] }, 0)
    await db.write({ items: [epic(5)] }, 0)

    const renamed = { ...under('epic', 9), title: 'Renamed' }
    expect(await db.write({ items: [renamed] }, 0)).toEqual({
      kind: 'written',
      stale: { areas: [], items: [] },
    })
  })

  it('lets a delete land over a newer or equal live copy, since a delete is final', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Renamed', 101)] }, 0)

    const deleted = { ...task('t', 'Before the rename', 101), deletedAt: 100 }
    expect(await db.write({ items: [deleted] }, 0)).toEqual({
      kind: 'written',
      stale: { areas: [], items: [] },
    })
    expect((await db.readAll()).items).toEqual([deleted])

    const goneArea = { ...area('work', 1), deletedAt: 1 }
    await db.write({ areas: [area('work', 9)] }, 0)
    await db.write({ areas: [goneArea] }, 0)
    expect((await db.readAll()).areas).toEqual([goneArea])
  })

  it('never puts a live copy back over a delete, however new, and hands the delete back', async () => {
    const db = await open(new IDBFactory())
    const deleted = { ...task('t', 'Gone', 5), deletedAt: 5 }
    await db.write({ items: [deleted] }, 0)

    const result = await db.write({ items: [task('t', 'Edited later', 50)] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [deleted] } })
    expect((await db.readAll()).items).toEqual([deleted])
  })

  it('never replaces a newer record, and hands the newer one back', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Newer', 5)] }, 0)

    const result = await db.write({ items: [task('t', 'Older', 3)] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [task('t', 'Newer', 5)] } })
    expect((await db.readAll()).items).toEqual([task('t', 'Newer', 5)])
  })

  it('keeps the first of two different copies at the same version', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'First', 5)] }, 0)

    const result = await db.write({ items: [task('t', 'Second', 5)] }, 0)
    expect(result).toEqual({ kind: 'written', stale: { areas: [], items: [task('t', 'First', 5)] } })
    expect((await db.readAll()).items.map((i) => i.title)).toEqual(['First'])
  })

  it('accepts a retry of the very same copy', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Same', 5)] }, 0)
    expect(await db.write({ items: [task('t', 'Same', 5)] }, 0)).toEqual({
      kind: 'written',
      stale: { areas: [], items: [] },
    })
  })

  it('writes nothing against a backlog that has since been replaced', async () => {
    const db = await open(new IDBFactory())
    const generation = await db.replaceAll({ areas: [area('work')], items: [] })
    expect(generation).toBe(1)

    expect(await db.write({ items: [task('ghost', 'Ghost', 9)] }, 0)).toEqual({
      kind: 'superseded',
    })
    const after = await db.readAll()
    expect(after.items).toEqual([])
    expect(after.generation).toBe(1)
  })

  it('replaces both stores whole, removing what the replacement leaves out', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('old')], items: [task('t', 'Old', 1)] }, 0)

    await db.replaceAll({ areas: [area('new')], items: [] })
    const after = await db.readAll()
    expect(after.areas.map((a) => a.id)).toEqual(['new'])
    expect(after.items).toEqual([])
  })
})

describe('seeding', () => {
  it('seeds once, however many tabs open an empty database together', async () => {
    const factory = new IDBFactory()
    const [a, b] = await Promise.all([open(factory), open(factory)])

    const [seenByA, seenByB] = await Promise.all([
      a.seedIfEmpty([area('a-work'), area('a-personal')]),
      b.seedIfEmpty([area('b-work'), area('b-personal')]),
    ])
    expect(seenByA).toEqual(seenByB)
    expect(seenByA.areas).toHaveLength(2)
    expect((await a.readAll()).areas).toHaveLength(2)
  })

  it('leaves a database that has areas alone, and answers with all of it', async () => {
    const db = await open(new IDBFactory())
    // Another tab's import, with a task and a bumped generation.
    await db.replaceAll({ areas: [area('mine')], items: [task('t', 'Theirs', 1)] })

    const snapshot = await db.seedIfEmpty([area('seed')])
    expect(snapshot.areas.map((a) => a.id)).toEqual(['mine'])
    expect(snapshot.items.map((i) => i.title)).toEqual(['Theirs'])
    expect(snapshot.generation).toBe(1)
  })
})

describe('upgrading', () => {
  it('keeps a v1 database intact and reads its generation as 0', async () => {
    const factory = new IDBFactory()
    // The v1 schema exactly: two stores and nothing else.
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('mono', 1)
      request.onupgradeneeded = () => {
        const v1 = request.result
        v1.createObjectStore('areas', { keyPath: 'id' }).put(area('work'))
        v1.createObjectStore('items', { keyPath: 'id' }).put(task('t', 'Kept', 1))
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    const db = await open(factory)
    const read = await db.readAll()
    expect(read.areas.map((a) => a.id)).toEqual(['work'])
    expect(read.items.map((i) => i.title)).toEqual(['Kept'])
    expect(read.generation).toBe(0)
  })
})
