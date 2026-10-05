import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'

import { activeAreas, inboxOf } from '@/domain/tasks'
import { openTaskDb } from './taskDb'

type TasksModule = typeof import('./tasks')
type HealthModule = typeof import('./storageHealth')

/**
 * One "tab": a fresh copy of the store module, so two of them can share an
 * IndexedDB and a BroadcastChannel the way two browser tabs do.
 */
async function openTab(factory: IDBFactory): Promise<TasksModule & HealthModule> {
  vi.resetModules()
  const tasks = await import('./tasks')
  const health = await import('./storageHealth')
  await tasks.hydrateTasks(factory)
  opened.push(tasks)
  return { ...tasks, ...health }
}

let opened: TasksModule[] = []
let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
  opened = []
})

afterEach(() => {
  for (const tab of opened) tab.closeTasks()
  vi.restoreAllMocks()
})

/** Let pending IndexedDB transactions commit. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('hydration', () => {
  it('seeds Work and Personal into an empty backlog, once', async () => {
    const tab = await openTab(factory)
    expect(tab.useTasks.getState().hydrated).toBe(true)
    // IndexedDB returns records in key order, which for random ids is no order
    // at all. Display order is `order`, read through `activeAreas`.
    expect(activeAreas(tab.useTasks.getState().areas).map((a) => a.name)).toEqual(['Work', 'Personal'])
    await settle()

    const again = await openTab(factory)
    expect(activeAreas(again.useTasks.getState().areas).map((a) => a.name)).toEqual([
      'Work',
      'Personal',
    ])
  })

  it('does not re-seed after the seeds are archived', async () => {
    const tab = await openTab(factory)
    for (const area of tab.useTasks.getState().areas) tab.useTasks.getState().archiveArea(area.id)
    await settle()

    const again = await openTab(factory)
    expect(again.useTasks.getState().areas).toHaveLength(2)
    expect(again.useTasks.getState().areas.every((a) => a.archivedAt !== undefined)).toBe(true)
  })

  it('keeps a task created before the database was read', async () => {
    vi.resetModules()
    const tasks = await import('./tasks')
    opened.push(tasks)
    // No areas exist in memory yet, so park the task under an area we write
    // straight to the database first — the shape of a returning user.
    const db = await openTaskDb(factory)
    await db.write({
      areas: [{ id: 'work', name: 'Work', order: 0, createdAt: 1, updatedAt: 1 }],
    })
    db.close()
    tasks.useTasks.setState({
      areas: [{ id: 'work', name: 'Work', order: 0, createdAt: 1, updatedAt: 1 }],
    })
    const id = tasks.useTasks.getState().addTask({ title: 'Call Priya', parentId: 'work' })

    await tasks.hydrateTasks(factory)
    expect(tasks.useTasks.getState().items.map((i) => i.id)).toEqual([id])
    await settle()

    const again = await openTab(factory)
    expect(again.useTasks.getState().items.map((i) => i.title)).toEqual(['Call Priya'])
  })

  it('works in memory and says so when IndexedDB cannot be opened', async () => {
    const broken = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    } as unknown as IDBFactory
    const tab = await openTab(broken)

    expect(tab.useTasks.getState().hydrated).toBe(true)
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()
  })
})

describe('editing', () => {
  it('persists a task through its whole life', async () => {
    const tab = await openTab(factory)
    const work = activeAreas(tab.useTasks.getState().areas)[0]!.id
    const id = tab.useTasks.getState().addTask({ title: '  Call Priya ', parentId: work })!

    expect(inboxOf(work, tab.useTasks.getState().items).map((i) => i.title)).toEqual([
      'Call Priya',
    ])

    tab.useTasks.getState().completeTask(id)
    await settle()
    const reloaded = await openTab(factory)
    const stored = reloaded.useTasks.getState().items.find((i) => i.id === id)
    expect(stored).toMatchObject({ status: 'done', title: 'Call Priya' })
    expect(stored?.doneAt).toBeTypeOf('number')
  })

  it('refuses a blank title or a parent that cannot hold a task', async () => {
    const tab = await openTab(factory)
    const work = activeAreas(tab.useTasks.getState().areas)[0]!.id
    expect(tab.useTasks.getState().addTask({ title: '   ', parentId: work })).toBeNull()
    expect(tab.useTasks.getState().addTask({ title: 'x', parentId: 'nowhere' })).toBeNull()

    const task = tab.useTasks.getState().addTask({ title: 'a', parentId: work })!
    expect(tab.useTasks.getState().addTask({ title: 'b', parentId: task })).toBeNull()
  })

  it('moves a task between areas, and ignores a move into nowhere', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const id = tab.useTasks.getState().addTask({ title: 'Groceries', parentId: work!.id })!

    tab.useTasks.getState().moveTask(id, personal!.id)
    expect(inboxOf(personal!.id, tab.useTasks.getState().items).map((i) => i.id)).toEqual([id])

    tab.useTasks.getState().moveTask(id, 'nowhere')
    expect(tab.useTasks.getState().items.find((i) => i.id === id)?.parentId).toBe(personal!.id)
  })

  it('deletes with a tombstone, and a deleted task cannot be edited', async () => {
    const tab = await openTab(factory)
    const work = activeAreas(tab.useTasks.getState().areas)[0]!.id
    const id = tab.useTasks.getState().addTask({ title: 'Old', parentId: work })!

    tab.useTasks.getState().deleteTask(id)
    tab.useTasks.getState().renameTask(id, 'New')

    const item = tab.useTasks.getState().items.find((i) => i.id === id)
    expect(item?.deletedAt).toBeTypeOf('number')
    expect(item?.title).toBe('Old')
    expect(inboxOf(work, tab.useTasks.getState().items)).toEqual([])
  })
})

describe('storage failures', () => {
  it('holds a failed write and clears the warning only once it lands', async () => {
    const tab = await openTab(factory)
    const work = activeAreas(tab.useTasks.getState().areas)[0]!.id
    await settle()

    const failing = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
    const first = tab.useTasks.getState().addTask({ title: 'First', parentId: work })!
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()

    failing.mockRestore()
    tab.useTasks.getState().addTask({ title: 'Second', parentId: work })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).toBeNull()

    // The first one went out with the second rather than being forgotten.
    const reloaded = await openTab(factory)
    expect(reloaded.useTasks.getState().items.map((i) => i.id)).toContain(first)
  })

  it('keeps a session success from clearing a tasks failure', async () => {
    const { useStorageHealth } = await import('./storageHealth')
    useStorageHealth.getState().noteFailure(5, 'tasks')
    useStorageHealth.getState().noteSuccess('session')
    expect(useStorageHealth.getState().failedAt).toBe(5)
    useStorageHealth.getState().noteSuccess('tasks')
    expect(useStorageHealth.getState().failedAt).toBeNull()
  })
})

describe('other tabs', () => {
  it('hear an edit and keep the newer copy', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const work = activeAreas(a.useTasks.getState().areas)[0]!.id

    const id = a.useTasks.getState().addTask({ title: 'Shared', parentId: work })!
    await vi.waitFor(() =>
      expect(b.useTasks.getState().items.map((i) => i.id)).toContain(id),
    )

    a.useTasks.getState().completeTask(id)
    await vi.waitFor(() =>
      expect(b.useTasks.getState().items.find((i) => i.id === id)?.status).toBe('done'),
    )
  })

  it('take an import wholesale rather than merging it', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)

    await a.useTasks.getState().replaceAll({
      areas: [{ id: 'only', name: 'Only', order: 0, createdAt: 1, updatedAt: 1 }],
      items: [],
    })
    await vi.waitFor(() =>
      expect(b.useTasks.getState().areas.map((x) => x.id)).toEqual(['only']),
    )
  })
})
