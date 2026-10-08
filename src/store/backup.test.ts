// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'

import type { Area, Item } from '@/domain/tasks'
import { dayKey } from '@/domain/time'
import { SCHEMA_VERSION } from './schema'
import { openTaskDb } from './taskDb'

/**
 * Both stores at once, as Settings drives them. Each case gets fresh copies of
 * the modules and a fresh database, because the task store keeps its database,
 * queue and generation at module level and a case must not inherit another's.
 */
async function openApp(factory = new IDBFactory(), { hydrate = true } = {}) {
  vi.resetModules()
  const backup = await import('./backup')
  const { useSession } = await import('./session')
  const tasks = await import('./tasks')
  if (hydrate) await tasks.hydrateTasks(factory)
  closers.push(tasks.closeTasks)
  return { ...backup, useSession, useTasks: tasks.useTasks, hydrateTasks: tasks.hydrateTasks }
}

let closers: (() => void)[] = []

beforeEach(() => {
  closers = []
  let data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear() {
      data = new Map<string, string>()
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
})

afterEach(() => {
  for (const close of closers) close()
  vi.restoreAllMocks()
})

const file = (shortMinutes: number, tasks?: unknown) =>
  JSON.stringify({
    version: SCHEMA_VERSION,
    dayKey: dayKey(Date.now()),
    events: [{ type: 'settings/changed', at: Date.now(), patch: { shortMinutes } }],
    ...(tasks === undefined ? {} : { tasks }),
  })

const backlog: { areas: Area[]; items: Item[] } = {
  areas: [{ id: 'home', name: 'Home', order: 0, createdAt: 1, updatedAt: 1 }],
  items: [
    {
      id: 'fix',
      kind: 'task',
      title: 'Fix the gate',
      parentId: 'home',
      status: 'open',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}

const areaNames = (app: Awaited<ReturnType<typeof openApp>>) =>
  app.useTasks.getState().areas.map((a) => a.name).sort()

describe('importing a backup', () => {
  it('replaces both the day and the backlog', async () => {
    const app = await openApp()
    await app.importBackup(file(25, backlog))

    expect(app.useSession.getState().session.settings.shortMinutes).toBe(25)
    expect(areaNames(app)).toEqual(['Home'])
    expect(app.useTasks.getState().items.map((i) => i.title)).toEqual(['Fix the gate'])
  })

  it('carries what was put down for later out and back', async () => {
    const app = await openApp()
    app.useTasks.getState().addLater('Try WebGPU', { blockId: 'b', purpose: 'Draft the schema' })
    const exported = await app.exportBackup()

    const other = await openApp(new IDBFactory())
    await other.importBackup(exported)
    expect(other.useTasks.getState().later).toMatchObject([
      { title: 'Try WebGPU', from: { blockId: 'b', purpose: 'Draft the schema' } },
    ])
  })

  it('changes neither when the browser will not save the backlog', async () => {
    const app = await openApp()
    const before = app.useSession.getState().events
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    await expect(app.importBackup(file(25, backlog))).rejects.toThrow(/nothing was imported/)
    expect(app.useSession.getState().events).toBe(before)
    expect(areaNames(app)).toEqual(['Personal', 'Work'])
  })

  it('changes neither for a file that is not a Mono export', async () => {
    const app = await openApp()
    const before = app.useSession.getState().events

    await expect(app.importBackup('{"not": "mono"}')).rejects.toThrow()
    expect(app.useSession.getState().events).toBe(before)
    expect(areaNames(app)).toEqual(['Personal', 'Work'])
  })

  it('leaves the backlog alone for a file from before tasks existed', async () => {
    const app = await openApp()
    await app.importBackup(file(25))

    expect(app.useSession.getState().session.settings.shortMinutes).toBe(25)
    expect(areaNames(app)).toEqual(['Personal', 'Work'])
  })
})

/**
 * Two review findings. Both stores start out empty or idle and fill in later,
 * so an export or a second import that runs in the gap acts on the wrong
 * thing: the empty arrays before the backlog has loaded, or the day of a file
 * whose backlog has not landed yet.
 */
describe('imports and exports that overlap', () => {
  /** Hold the next read-write transaction open until released. */
  const holdNextWrite = () => {
    const original = IDBDatabase.prototype.transaction
    let fired = false
    let open = true
    let started!: () => void
    const holding = new Promise<void>((resolve) => (started = resolve))
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = original.apply(this, args)
      if (!fired && args[1] === 'readwrite') {
        fired = true
        const keepAlive = () => {
          if (open) tx.objectStore('meta').get('__held__').onsuccess = keepAlive
        }
        keepAlive()
        started()
      }
      return tx
    })
    return { holding, release: () => (open = false) }
  }

  it('waits for the backlog to load before exporting it', async () => {
    const factory = new IDBFactory()
    const saved = await openTaskDb(factory)
    await saved.seedIfEmpty(backlog.areas)
    await saved.write({ items: backlog.items }, 0)
    saved.close()

    // Asked for before the store has even started to load, as a click on
    // Export during a slow first read would be.
    const app = await openApp(factory, { hydrate: false })
    const exported = app.exportBackup()
    void app.hydrateTasks(factory)

    const tasks = JSON.parse(await exported).tasks
    expect(tasks.areas.map((a: { name: string }) => a.name)).toEqual(['Home'])
    expect(tasks.items.map((i: { title: string }) => i.title)).toEqual(['Fix the gate'])
  })

  it("does not let an earlier import's day land over a later one's", async () => {
    const app = await openApp()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const held = holdNextWrite()
    const first = app.importBackup(file(25, backlog))
    await held.holding
    // A file from before tasks existed: nothing for it to wait on.
    const second = app.importBackup(file(35))
    await new Promise((resolve) => setTimeout(resolve, 20))
    held.release()
    await first
    await second

    expect(app.useSession.getState().session.settings.shortMinutes).toBe(35)
    expect(areaNames(app)).toEqual(['Home'])
  })

  it('exports what an import in flight produces, not what it is replacing', async () => {
    const app = await openApp()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const held = holdNextWrite()
    const imported = app.importBackup(file(25, backlog))
    await held.holding
    const exported = app.exportBackup()
    held.release()
    await imported

    const contents = JSON.parse(await exported)
    expect(contents.tasks.areas.map((a: { name: string }) => a.name)).toEqual(['Home'])
    expect(contents.events).toHaveLength(1)
  })
})
