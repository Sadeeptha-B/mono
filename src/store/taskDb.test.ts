import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import type { Later } from '@/domain/later'
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

const later = (id: string, title: string, updatedAt: number, extra: Partial<Later> = {}): Later => ({
  id,
  title,
  createdAt: 1,
  updatedAt,
  ...extra,
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
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [under('epic', 1), epic(5)], later: [] } })
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
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [], later: [] } })
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('personal')
  })

  it('lets a move out land in the same write as the delete it came before', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work'), area('personal')], items: [epic(), under('epic', 1)] }, 0)

    const result = await db.write({ items: [under('personal', 9), epic(5)] }, 0)
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [], later: [] } })
    expect((await db.readAll()).items.find((i) => i.id === 't')?.parentId).toBe('personal')
  })

  it('lets a record already under a deleted epic be edited in place, since that brings nothing back', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work')], items: [epic(), under('epic', 1)] }, 0)
    await db.write({ items: [epic(5)] }, 0)

    const renamed = { ...under('epic', 9), title: 'Renamed' }
    expect(await db.write({ items: [renamed] }, 0)).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [] },
    })
  })

  it('lets a delete land over a newer or equal live copy, since a delete is final', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Renamed', 101)] }, 0)

    const deleted = { ...task('t', 'Before the rename', 101), deletedAt: 100 }
    expect(await db.write({ items: [deleted] }, 0)).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [] },
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
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [deleted], later: [] } })
    expect((await db.readAll()).items).toEqual([deleted])
  })

  it('never replaces a newer record, and hands the newer one back', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Newer', 5)] }, 0)

    const result = await db.write({ items: [task('t', 'Older', 3)] }, 0)
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [task('t', 'Newer', 5)], later: [] } })
    expect((await db.readAll()).items).toEqual([task('t', 'Newer', 5)])
  })

  it('keeps the first of two different copies at the same version', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'First', 5)] }, 0)

    const result = await db.write({ items: [task('t', 'Second', 5)] }, 0)
    expect(result).toEqual({ kind: 'written', refused: [], stale: { areas: [], items: [task('t', 'First', 5)], later: [] } })
    expect((await db.readAll()).items.map((i) => i.title)).toEqual(['First'])
  })

  it('accepts a retry of the very same copy', async () => {
    const db = await open(new IDBFactory())
    await db.write({ items: [task('t', 'Same', 5)] }, 0)
    expect(await db.write({ items: [task('t', 'Same', 5)] }, 0)).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [] },
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

  it('adds an empty store for Later to a v2 database, keeping everything else', async () => {
    const factory = new IDBFactory()
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('mono', 2)
      request.onupgradeneeded = () => {
        const v2 = request.result
        v2.createObjectStore('areas', { keyPath: 'id' }).put(area('work'))
        v2.createObjectStore('items', { keyPath: 'id' }).put(task('t', 'Kept', 1))
        v2.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'generation', value: 3 })
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
    expect(read.later).toEqual([])
    expect(read.generation).toBe(3)
    expect(await db.write({ later: [later('l', 'Try WebGPU', 2)] }, 3)).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [] },
    })
  })
})

describe('later', () => {
  it('is judged as every record is: the newer copy stays, and a delete is final', async () => {
    const db = await open(new IDBFactory())
    await db.write({ later: [later('l', 'Newer', 5)] }, 0)

    const older = await db.write({ later: [later('l', 'Older', 4)] }, 0)
    expect(older).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [later('l', 'Newer', 5)] },
    })

    await db.write({ later: [later('l', 'Newer', 5, { deletedAt: 6 })] }, 0)
    const revived = await db.write({ later: [later('l', 'Revived', 9)] }, 0)
    expect(revived.kind === 'written' && revived.stale.later.map((l) => l.deletedAt)).toEqual([6])
    expect((await db.readAll()).later).toEqual([later('l', 'Newer', 5, { deletedAt: 6 })])
  })

  const filing = (taskId: string, parentId = 'work') => {
    const waiting = later('l', 'Look into WebGPU', 2)
    return {
      task: { ...task(taskId, 'Look into WebGPU', 3), parentId },
      later: { ...waiting, deletedAt: 3, updatedAt: 3 },
      waiting,
    }
  }

  it('is filed whole: the task and the tombstone land together', async () => {
    const db = await open(new IDBFactory())
    await db.write({ areas: [area('work')], later: [later('l', 'Look into WebGPU', 2)] }, 0)

    expect(await db.write({ filings: [filing('t1')] }, 0)).toEqual({
      kind: 'written',
      refused: [],
      stale: { areas: [], items: [], later: [] },
    })
    const read = await db.readAll()
    expect(read.items.map((i) => i.id)).toEqual(['t1'])
    expect(read.later).toEqual([filing('t1').later])
  })

  it('refuses a second filing of the same line whole, writing neither record', async () => {
    const db = await open(new IDBFactory())
    await db.write({ later: [later('l', 'Look into WebGPU', 2)] }, 0)
    await db.write({ filings: [filing('t1')] }, 0)

    const second = await db.write({ filings: [filing('t2')] }, 0)
    expect(second).toEqual({
      kind: 'written',
      refused: ['l'],
      stale: { areas: [], items: [], later: [filing('t1').later] },
    })
    expect((await db.readAll()).items.map((i) => i.id)).toEqual(['t1'])
  })

  it('refuses a filing into a deleted place, keeping the line waiting and handing back the delete', async () => {
    const db = await open(new IDBFactory())
    const gone = { ...area('home', 5), deletedAt: 5 }
    await db.write({ areas: [gone] }, 0)

    // The line never reached the disk before it was filed; the refusal keeps it.
    const result = await db.write({ filings: [filing('t1', 'home')] }, 0)
    expect(result).toEqual({
      kind: 'written',
      refused: ['l'],
      stale: { areas: [gone], items: [], later: [] },
    })
    const read = await db.readAll()
    expect(read.items).toEqual([])
    expect(read.later).toEqual([filing('t1').waiting])
  })

  it('walks through a new parent the same write brings, to a place deleted on disk', async () => {
    const db = await open(new IDBFactory())
    const gone = { ...area('home', 5), deletedAt: 5 }
    await db.write({ areas: [gone], later: [later('l', 'Look into WebGPU', 2)] }, 0)
    const epic: Item = { ...task('house', 'House', 3), kind: 'epic', parentId: 'home' }

    const result = await db.write({ items: [epic], filings: [filing('t1', 'house')] }, 0)
    expect(result).toMatchObject({ refused: ['l'], stale: { areas: [gone] } })
    expect((await db.readAll()).later).toEqual([later('l', 'Look into WebGPU', 2)])
  })

  it('refuses a filing made from a copy the disk has moved past, and hands that copy back', async () => {
    const db = await open(new IDBFactory())
    const reworded = later('l', 'Look into WebGPU properly', 4)
    await db.write({ areas: [area('work')], later: [reworded] }, 0)

    const result = await db.write({ filings: [filing('t1')] }, 0)
    expect(result).toEqual({
      kind: 'written',
      refused: ['l'],
      stale: { areas: [], items: [], later: [reworded] },
    })
    expect((await db.readAll()).items).toEqual([])
  })

  it('reads a saved line written in a block back as the same line, whatever it holds', async () => {
    const db = await open(new IDBFactory())
    const from = { blockId: 'b1', purpose: 'Draft the schema' }
    const saved = later('l', 'Look into WebGPU', 2, { from })
    await db.write({ areas: [area('work')], later: [saved] }, 0)

    // A retry of the same copy, and a filing made from it: the disk's copy is
    // a clone, with its own `from`, and is still the same line.
    expect(await db.write({ later: [{ ...saved, from: { ...from } }] }, 0)).toMatchObject({
      stale: { later: [] },
    })
    const filed = { ...filing('t1'), waiting: saved, later: { ...saved, deletedAt: 3, updatedAt: 3 } }
    expect(await db.write({ filings: [filed] }, 0)).toMatchObject({ refused: [] })
    expect((await db.readAll()).items.map((i) => i.id)).toEqual(['t1'])
  })

  it('walks a parent the same write moves, to where it is going', async () => {
    const db = await open(new IDBFactory())
    const gone = { ...area('home', 5), deletedAt: 5 }
    const house: Item = { ...task('house', 'House', 3), kind: 'epic', parentId: 'work' }
    await db.write({ areas: [area('work'), gone], items: [house], later: [later('l', 'Look into WebGPU', 2)] }, 0)

    const moved = { ...house, parentId: 'home', updatedAt: 6 }
    const result = await db.write({ items: [moved], filings: [filing('t1', 'house')] }, 0)
    expect(result).toMatchObject({ refused: ['l'] })
    expect((await db.readAll()).later).toEqual([later('l', 'Look into WebGPU', 2)])
  })

  it('takes a filing that has already landed without writing it again', async () => {
    const db = await open(new IDBFactory())
    await db.write({ filings: [filing('t1')] }, 0)
    await db.write({ items: [{ ...filing('t1').task, title: 'Renamed since', updatedAt: 9 }] }, 0)

    expect(await db.write({ filings: [filing('t1')] }, 0)).toMatchObject({ refused: [] })
    expect((await db.readAll()).items.map((i) => i.title)).toEqual(['Renamed since'])
  })

  it('goes with the rest of the backlog when it is replaced, and is replaced with it', async () => {
    const db = await open(new IDBFactory())
    await db.write({ later: [later('old', 'Before', 2)] }, 0)

    await db.replaceAll({ areas: [area('work')], items: [], later: [later('new', 'After', 3)] })
    expect((await db.readAll()).later.map((l) => l.id)).toEqual(['new'])

    // A file from before Later carries none, and is taken as having none.
    await db.replaceAll({ areas: [area('work')], items: [] })
    expect((await db.readAll()).later).toEqual([])
  })
})
