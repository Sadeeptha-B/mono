import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBDatabase, IDBFactory } from 'fake-indexeddb'

import { letGoLater, waitingLater } from '@/domain/later'
import {
  activeAreas,
  activeTasks,
  inboxOf,
  isGone,
  openContainers,
  openTasksUnder,
  type Area,
  type Item,
} from '@/domain/tasks'
import { openTaskDb, type BacklogContents } from './taskDb'

/**
 * The backlog store, driven the way the app drives it.
 *
 * A "tab" is a fresh copy of the store module (`openTab`), so two of them
 * share one IndexedDB and the real BroadcastChannel the way two browser tabs
 * do. Another tab that this one has not heard from is a second database
 * connection writing directly (`savedElsewhere`), or a hand-made broadcast
 * (`announce`).
 *
 * Races are made deterministic rather than left to timing. `duringNext` runs
 * an action from inside the next transaction of a mode, after the store has
 * taken its snapshot and before the transaction commits. `holdNext` keeps the
 * next transaction of a mode open — by chaining a harmless read inside it —
 * until released, so broadcasts can be delivered while it is in flight, as
 * they would be behind a slow disk in a browser. `refuseWrites` makes every
 * transaction in the process fail, which is every tab at once.
 */

type TasksModule = typeof import('./tasks')
type HealthModule = typeof import('./storageHealth')

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

async function openTab(from: IDBFactory): Promise<TasksModule & HealthModule> {
  vi.resetModules()
  const tasks = await import('./tasks')
  const health = await import('./storageHealth')
  await tasks.hydrateTasks(from)
  opened.push(tasks)
  return { ...tasks, ...health }
}

/** A factory whose database can never be opened: site data blocked. */
const broken = {
  open: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
} as unknown as IDBFactory

/** Let pending IndexedDB transactions commit. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** The titles of everything a tab still shows: not deleted, nor gone with a parent. */
const visible = (tab: TasksModule) => {
  const { items, areas } = tab.useTasks.getState()
  return items
    .filter((i) => !isGone(i.id, items, areas))
    .map((i) => i.title)
    .sort()
}

const workOf = (tab: TasksModule) => activeAreas(tab.useTasks.getState().areas)[0]!.id

const taskIn = (parentId: string, title: string, updatedAt = 1): Item => ({
  id: title.toLowerCase().replace(/ /g, '-'),
  kind: 'task',
  title,
  parentId,
  status: 'open',
  order: 0,
  createdAt: 1,
  updatedAt,
})

const areaNamed = (id: string, name = id): Area => ({ id, name, order: 0, createdAt: 1, updatedAt: 1 })

/** This copy deleted, one version on. */
const deleted = <T extends Area | Item>(record: T): T => ({
  ...record,
  deletedAt: record.updatedAt + 1,
  updatedAt: record.updatedAt + 1,
})

/** Another tab's saved write, which this tab has not heard about. */
async function savedElsewhere(changes: Partial<BacklogContents>) {
  const elsewhere = await openTaskDb(factory)
  await elsewhere.write(changes, 0)
  elsewhere.close()
}

/** Another tab's broadcast. */
function announce(message: unknown) {
  const channel = new BroadcastChannel('mono.tasks')
  channel.postMessage(message)
  channel.close()
}

const refuseWrites = () =>
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })

function duringNext(mode: IDBTransactionMode, action: () => void) {
  const original = IDBDatabase.prototype.transaction
  let fired = false
  return vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ) {
    const tx = original.apply(this, args)
    if (!fired && (args[1] ?? 'readonly') === mode) {
      fired = true
      action()
    }
    return tx
  })
}

function holdNext(mode: IDBTransactionMode) {
  const original = IDBDatabase.prototype.transaction
  let fired = false
  let open = true
  let started!: () => void
  const holding = new Promise<void>((resolve) => (started = resolve))
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ) {
    const tx = original.apply(this, args)
    if (!fired && (args[1] ?? 'readonly') === mode) {
      fired = true
      const keepAlive = () => {
        if (open) tx.objectStore('meta').get('__held__').onsuccess = keepAlive
      }
      keepAlive()
      started()
    }
    return tx
  })
  return { holding, release: () => (open = false), spy, original }
}

describe('loading and seeding', () => {
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

  it('does not re-seed after the seeds are deleted', async () => {
    const tab = await openTab(factory)
    for (const area of tab.useTasks.getState().areas) tab.useTasks.getState().deleteArea(area.id)
    await settle()

    const again = await openTab(factory)
    expect(again.useTasks.getState().areas).toHaveLength(2)
    expect(activeAreas(again.useTasks.getState().areas)).toEqual([])
  })

  it('seeds one set of areas when two tabs open an empty backlog together', async () => {
    vi.resetModules()
    const a = await import('./tasks')
    vi.resetModules()
    const b = await import('./tasks')
    opened.push(a, b)

    await Promise.all([a.hydrateTasks(factory), b.hydrateTasks(factory)])
    const ids = (tab: TasksModule) => tab.useTasks.getState().areas.map((x) => x.id).sort()
    expect(ids(a)).toEqual(ids(b))
    expect(ids(await openTab(factory))).toHaveLength(2)
  })

  it('keeps a task created before the database was read', async () => {
    vi.resetModules()
    const tasks = await import('./tasks')
    opened.push(tasks)
    // No areas exist in memory yet, so park the task under an area written
    // straight to the database first — the shape of a returning user.
    await savedElsewhere({ areas: [areaNamed('work', 'Work')] })
    tasks.useTasks.setState({ areas: [areaNamed('work', 'Work')] })
    const id = tasks.useTasks.getState().addItem({ kind: 'task', title: 'Call Priya', parentId: 'work' })

    await tasks.hydrateTasks(factory)
    expect(tasks.useTasks.getState().items.map((i) => i.id)).toEqual([id])
    await settle()

    const again = await openTab(factory)
    expect(again.useTasks.getState().items.map((i) => i.title)).toEqual(['Call Priya'])
  })

  it('works in memory and says so when IndexedDB cannot be opened', async () => {
    const tab = await openTab(broken)

    expect(tab.useTasks.getState().hydrated).toBe(true)
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()
  })

  it('keeps an import made while the first load is seeding', async () => {
    vi.resetModules()
    const tasks = await import('./tasks')
    opened.push(tasks)
    const imported = areaNamed('imported', 'Imported')
    // The first read-write transaction of a load on an empty database is the seed.
    duringNext('readwrite', () =>
      void tasks.useTasks.getState().replaceAll({ areas: [imported], items: [taskIn('imported', 'Imported task')] }),
    )
    await tasks.hydrateTasks(factory)
    await settle()

    expect(tasks.useTasks.getState().areas.map((a) => a.id)).toEqual(['imported'])
    const reloaded = await openTab(factory)
    expect(reloaded.useTasks.getState().areas.map((a) => a.id)).toEqual(['imported'])
    expect(visible(reloaded)).toEqual(['Imported task'])
  })

  it('loads one consistent backlog when another tab imports between the read and the seed', async () => {
    const elsewhere = await openTaskDb(factory)
    const imported = areaNamed('imported', 'Imported')

    vi.resetModules()
    const tasks = await import('./tasks')
    opened.push(tasks)
    // The load's first read is the trigger: the import commits after it and
    // before the seed transaction the load opens next.
    duringNext('readonly', () => {
      void elsewhere
        .replaceAll({ areas: [imported], items: [taskIn('imported', 'Imported task')] })
        .then((generation) => announce({ type: 'replaced', generation }))
    })
    await tasks.hydrateTasks(factory)
    await settle()
    elsewhere.close()

    expect(tasks.useTasks.getState().areas.map((x) => x.id)).toEqual(['imported'])
    expect(visible(tasks)).toEqual(['Imported task'])
  })

  it('judges a broadcast heard during the load against the generation the load finds', async () => {
    // The disk is on generation 1, holding only the imported task.
    const elsewhere = await openTaskDb(factory)
    await elsewhere.replaceAll({ areas: [areaNamed('work', 'Work')], items: [taskIn('work', 'Imported')] })
    elsewhere.close()

    vi.resetModules()
    const tasks = await import('./tasks')
    opened.push(tasks)
    // A late broadcast from generation 0 arrives while the load is reading.
    const held = holdNext('readonly')
    const loading = tasks.hydrateTasks(factory)
    await held.holding
    announce({ type: 'changed', generation: 0, areas: [], items: [taskIn('work', 'Excluded', 5)] })
    await settle()
    held.release()
    await loading
    await settle()

    expect(visible(tasks)).toEqual(['Imported'])
  })
})

describe('editing', () => {
  it('persists a task through its whole life', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const id = tab.useTasks.getState().addItem({ kind: 'task', title: '  Call Priya ', parentId: work })!

    expect(inboxOf(work, tab.useTasks.getState().items).map((i) => i.title)).toEqual([
      'Call Priya',
    ])

    tab.useTasks.getState().completeItem(id)
    await settle()
    const reloaded = await openTab(factory)
    const stored = reloaded.useTasks.getState().items.find((i) => i.id === id)
    expect(stored).toMatchObject({ status: 'done', title: 'Call Priya' })
    expect(stored?.doneAt).toBeTypeOf('number')
  })

  it('refuses a blank title or a parent that cannot hold a task', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    expect(tab.useTasks.getState().addItem({ kind: 'task', title: '   ', parentId: work })).toBeNull()
    expect(tab.useTasks.getState().addItem({ kind: 'task', title: 'x', parentId: 'nowhere' })).toBeNull()

    const task = tab.useTasks.getState().addItem({ kind: 'task', title: 'a', parentId: work })!
    expect(tab.useTasks.getState().addItem({ kind: 'task', title: 'b', parentId: task })).toBeNull()
  })

  it('nests epics and outcomes where the parenting rules allow, and nowhere else', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const add = tab.useTasks.getState().addItem

    const epic = add({ kind: 'epic', title: 'Mono auth', parentId: work })!
    const outcome = add({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    expect(add({ kind: 'task', title: 'Login form', parentId: outcome })).not.toBeNull()

    expect(add({ kind: 'outcome', title: 'Loose', parentId: work })).toBeNull()
    expect(add({ kind: 'epic', title: 'Nested', parentId: epic })).toBeNull()
  })

  it('moves a task between areas, and ignores a move into nowhere', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const id = tab.useTasks.getState().addItem({ kind: 'task', title: 'Groceries', parentId: work!.id })!

    tab.useTasks.getState().moveItem(id, personal!.id)
    expect(inboxOf(personal!.id, tab.useTasks.getState().items).map((i) => i.id)).toEqual([id])

    tab.useTasks.getState().moveItem(id, 'nowhere')
    expect(tab.useTasks.getState().items.find((i) => i.id === id)?.parentId).toBe(personal!.id)
  })

  it('refuses to move an epic underneath one of its own tasks', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const { addItem, moveItem } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work })!
    const task = addItem({ kind: 'task', title: 'Login form', parentId: work })!

    moveItem(task, epic)
    expect(tab.useTasks.getState().items.find((i) => i.id === task)?.parentId).toBe(epic)
    moveItem(epic, task)
    expect(tab.useTasks.getState().items.find((i) => i.id === epic)?.parentId).toBe(work)
  })

  it('archives and restores an epic without touching what is inside', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const { addItem, archiveItem, unarchiveItem } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work })!
    const task = addItem({ kind: 'task', title: 'Login form', parentId: epic })!

    archiveItem(epic)
    const before = tab.useTasks.getState().items.find((i) => i.id === task)
    expect(tab.useTasks.getState().items.find((i) => i.id === epic)?.archivedAt).toBeTypeOf('number')

    unarchiveItem(epic)
    expect('archivedAt' in tab.useTasks.getState().items.find((i) => i.id === epic)!).toBe(false)
    expect(tab.useTasks.getState().items.find((i) => i.id === task)).toBe(before)
  })

  it('lets a record imported from a clock running ahead be edited at once', async () => {
    const tab = await openTab(factory)
    const ahead = Date.now() + 60_000
    const imported = { ...taskIn(workOf(tab), 'From a fast clock', ahead), id: 'ahead', createdAt: ahead }
    await tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [imported] })

    tab.useTasks.getState().renameItem('ahead', 'Renamed here')
    tab.useTasks.getState().completeItem('ahead')
    await settle()

    const stored = (await openTab(factory)).useTasks.getState().items.find((i) => i.id === 'ahead')!
    expect(stored).toMatchObject({ title: 'Renamed here', status: 'done' })
    expect(stored.updatedAt).toBeGreaterThan(ahead)
    // The date a person would read stays on the real clock.
    expect(stored.doneAt).toBeLessThan(ahead)
  })

  it('lets a record at the last version be edited no further, and never past what can be read back', async () => {
    const tab = await openTab(factory)
    const last = Number.MAX_SAFE_INTEGER
    const imported = { ...taskIn(workOf(tab), 'At the edge', last - 1), id: 'edge' }
    await tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [imported] })

    tab.useTasks.getState().renameItem('edge', 'Renamed once')
    expect(tab.useTasks.getState().items.find((i) => i.id === 'edge')).toMatchObject({
      title: 'Renamed once',
      updatedAt: last,
    })
    // No version is left to give a second edit, so it is refused before
    // anything changes, rather than stamped with one the importer would drop.
    tab.useTasks.getState().renameItem('edge', 'Renamed twice')
    tab.useTasks.getState().deleteItem('edge')
    await settle()

    const stored = (await openTab(factory)).useTasks.getState().items.find((i) => i.id === 'edge')!
    expect(stored).toMatchObject({ title: 'Renamed once', updatedAt: last })
    expect(stored.deletedAt).toBeUndefined()
  })
})

describe('ordering', () => {
  /** The titles of a parent's open tasks, in the order a list draws them. */
  const titlesUnder = (tab: TasksModule, parentId: string) =>
    openTasksUnder(parentId, tab.useTasks.getState().items).map((i) => i.title)

  async function threeTasks() {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const add = (title: string) =>
      tab.useTasks.getState().addItem({ kind: 'task', title, parentId: work })!
    return { tab, work, a: add('A'), b: add('B'), c: add('C') }
  }

  it('reorders a task among its siblings with one write, and keeps the order through a reload', async () => {
    const { tab, work, a, c } = await threeTasks()
    const others = () => tab.useTasks.getState().items.filter((i) => i.id !== c)
    const untouched = others()

    tab.useTasks.getState().placeItem(c, work, a)
    expect(titlesUnder(tab, work)).toEqual(['C', 'A', 'B'])
    others().forEach((item, i) => expect(item).toBe(untouched[i]))
    tab.useTasks.getState().placeItem(c, work, null)
    expect(titlesUnder(tab, work)).toEqual(['A', 'B', 'C'])

    tab.useTasks.getState().placeItem(a, work, c)
    await settle()
    expect(titlesUnder(await openTab(factory), work)).toEqual(['B', 'A', 'C'])
  })

  it('moves a task to a spot among another parent’s tasks', async () => {
    const { tab, work, b } = await threeTasks()
    const personal = activeAreas(tab.useTasks.getState().areas)[1]!.id
    const { addItem, placeItem } = tab.useTasks.getState()
    const x = addItem({ kind: 'task', title: 'X', parentId: personal })!
    addItem({ kind: 'task', title: 'Y', parentId: personal })

    placeItem(b, personal, x)
    expect(titlesUnder(tab, personal)).toEqual(['B', 'X', 'Y'])
    expect(titlesUnder(tab, work)).toEqual(['A', 'C'])
  })

  it('numbers the siblings again when two share an order, and draws them as asked', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const tied = ['A', 'B', 'C'].map((title) => ({ ...taskIn(work, title), order: 1 }))
    await tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: tied })

    tab.useTasks.getState().placeItem('c', work, 'b')
    expect(titlesUnder(tab, work)).toEqual(['A', 'C', 'B'])
    await settle()
    expect(titlesUnder(await openTab(factory), work)).toEqual(['A', 'C', 'B'])
  })

  it('steps a task through the open tasks only, past one put away between', async () => {
    const { tab, work, a, b } = await threeTasks()
    tab.useTasks.getState().completeItem(b)

    tab.useTasks.getState().shiftItem(a, 1)
    expect(titlesUnder(tab, work)).toEqual(['C', 'A'])
    // Already last: nothing to step past, and nothing written.
    const before = tab.useTasks.getState().items
    tab.useTasks.getState().shiftItem(a, 1)
    expect(tab.useTasks.getState().items).toBe(before)
  })

  it('reorders outcomes within their epic, but never moves one under an area', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const { addItem } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work })!
    const login = addItem({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    addItem({ kind: 'task', title: 'Loose', parentId: epic })
    addItem({ kind: 'outcome', title: 'Password reset', parentId: epic })

    tab.useTasks.getState().shiftItem(login, 1)
    const outcomes = () =>
      openContainers(epic, 'outcome', tab.useTasks.getState().items).map((o) => o.title)
    expect(outcomes()).toEqual(['Password reset', 'Login pages'])

    tab.useTasks.getState().placeItem(login, work, null)
    expect(tab.useTasks.getState().items.find((i) => i.id === login)?.parentId).toBe(epic)
  })

  it('reorders areas, stepping through the active ones', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const names = () => activeAreas(tab.useTasks.getState().areas).map((a) => a.name)

    tab.useTasks.getState().shiftArea(personal!.id, -1)
    expect(names()).toEqual(['Personal', 'Work'])
    tab.useTasks.getState().placeArea(personal!.id, null)
    expect(names()).toEqual(['Work', 'Personal'])
    tab.useTasks.getState().shiftArea(work!.id, -1)
    expect(names()).toEqual(['Work', 'Personal'])
  })

  it('refuses to reorder what is gone, or before a sibling that has left', async () => {
    const { tab, work, a, b, c } = await threeTasks()
    tab.useTasks.getState().deleteItem(c)
    const before = tab.useTasks.getState().items

    tab.useTasks.getState().placeItem(c, work, a)
    tab.useTasks.getState().placeItem(a, work, c)
    tab.useTasks.getState().placeItem(b, work, 'nowhere')
    expect(tab.useTasks.getState().items).toBe(before)
  })

  it('files a Later before a sibling when asked, and last otherwise', async () => {
    const { tab, work, b } = await threeTasks()
    const { addLater, fileLater } = tab.useTasks.getState()

    fileLater(addLater('Before B')!, work, b)
    fileLater(addLater('At the end')!, work)
    expect(titlesUnder(tab, work)).toEqual(['A', 'Before B', 'B', 'C', 'At the end'])
  })
})

describe('saving, and the warning when it fails', () => {
  it('holds a failed write and clears the warning only once it lands', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    await settle()

    const refusing = refuseWrites()
    const first = tab.useTasks.getState().addItem({ kind: 'task', title: 'First', parentId: work })!
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()

    refusing.mockRestore()
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Second', parentId: work })
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

  it('keeps the warning up in a tab with no database, whatever other tabs save', async () => {
    const tab = await openTab(broken)
    const work = areaNamed('work', 'Work')
    const task = taskIn('work', 'Imported')
    await tab.useTasks.getState().replaceAll({ areas: [work], items: [task] })

    // Newer copies of every imported record, saved by a tab that can save.
    announce({
      type: 'changed',
      generation: 0,
      areas: [{ ...work, updatedAt: 5 }],
      items: [{ ...task, updatedAt: 5 }],
    })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()
  })
})

describe('other tabs', () => {
  it('hear an edit and keep the newer copy', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)

    const id = a.useTasks.getState().addItem({ kind: 'task', title: 'Shared', parentId: workOf(a) })!
    await vi.waitFor(() => expect(b.useTasks.getState().items.map((i) => i.id)).toContain(id))

    a.useTasks.getState().completeItem(id)
    await vi.waitFor(() =>
      expect(b.useTasks.getState().items.find((i) => i.id === id)?.status).toBe('done'),
    )
  })

  it("drop an older pending edit when another tab's newer one arrives", async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const id = a.useTasks.getState().addItem({ kind: 'task', title: 'Draft', parentId: workOf(a) })!
    await vi.waitFor(() => expect(visible(b)).toContain('Draft'))

    const refusing = refuseWrites()
    a.useTasks.getState().renameItem(id, 'Older title')
    await settle()
    refusing.mockRestore()

    b.useTasks.getState().renameItem(id, 'Newer title')
    await vi.waitFor(() => expect(visible(a)).toContain('Newer title'))

    // Otherwise an unrelated write from A would carry its older rename out with it.
    a.useTasks.getState().addItem({ kind: 'task', title: 'Unrelated', parentId: workOf(a) })
    await settle()
    expect(visible(await openTab(factory))).toEqual(['Newer title', 'Unrelated'])
  })

  it('adopt the newer copy when the disk refuses an older write', async () => {
    const tab = await openTab(factory)
    const id = tab.useTasks.getState().addItem({ kind: 'task', title: 'Draft', parentId: workOf(tab) })!
    await settle()

    // A newer copy lands without this tab hearing about it.
    const current = tab.useTasks.getState().items.find((i) => i.id === id)!
    await savedElsewhere({ items: [{ ...current, title: 'From elsewhere', updatedAt: Date.now() + 60_000 }] })

    tab.useTasks.getState().renameItem(id, 'Stale here')
    await settle()
    expect(visible(tab)).toEqual(['From elsewhere'])
    expect(visible(await openTab(factory))).toEqual(['From elsewhere'])
  })

  it('settle a same-millisecond edit the way the disk did', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    const id = a.useTasks.getState().addItem({ kind: 'task', title: 'Doomed', parentId: workOf(a) })!
    await vi.waitFor(() => expect(visible(b)).toContain('Doomed'))
    b.useTasks.getState().deleteItem(id)

    // Equal timestamps: the disk took the later write, and so must tab A.
    await vi.waitFor(() => expect(visible(a)).toEqual([]))
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('end agreeing with the disk when two edits share a version', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    // A record from a clock running ahead: both tabs will stamp edits to it
    // one past its version, so the two renames below share a version.
    const ahead = taskIn(workOf(a), 'Ahead', Date.now() + 60_000)
    await a.useTasks.getState().replaceAll({ areas: a.useTasks.getState().areas, items: [ahead] })
    await vi.waitFor(() => expect(visible(b)).toEqual(['Ahead']))

    // B's write is in flight when A makes its own edit.
    duringNext('readwrite', () => a.useTasks.getState().renameItem(ahead.id, 'From A'))
    b.useTasks.getState().renameItem(ahead.id, 'From B')
    await settle()
    await settle()

    const disk = visible(await openTab(factory))
    expect(disk).toHaveLength(1)
    expect(visible(a)).toEqual(disk)
    expect(visible(b)).toEqual(disk)
  })

  it("build an edit on another tab's copy that arrived while this tab was busy", async () => {
    const tab = await openTab(factory)
    await settle()
    const parent = workOf(tab)
    // From a clock running ahead, so edits to it are stamped one past its
    // version, and two of them made from the same copy would tie.
    const ahead = taskIn(parent, 'Ahead', Date.now() + 60_000)
    await tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [ahead] })

    // A slow write is out; another tab's rename of the record arrives, and its
    // turn in the queue is behind that write; then this tab completes it.
    const held = holdNext('readwrite')
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Slow write', parentId: parent })
    await held.holding
    announce({
      type: 'changed',
      generation: 1,
      areas: [],
      items: [{ ...ahead, title: 'Renamed there', updatedAt: ahead.updatedAt + 1 }],
    })
    await settle()
    tab.useTasks.getState().completeItem(ahead.id)
    held.release()
    await settle()
    await settle()

    const mine = tab.useTasks.getState().items.find((i) => i.id === ahead.id)
    expect(mine).toMatchObject({ title: 'Renamed there', status: 'done' })
    const stored = (await openTab(factory)).useTasks.getState().items.find((i) => i.id === ahead.id)
    expect(stored).toMatchObject({ title: 'Renamed there', status: 'done' })
  })

  it('ignore a replacement notice older than what this tab already holds', async () => {
    const tab = await openTab(factory)
    const areas = tab.useTasks.getState().areas
    await tab.useTasks.getState().replaceAll({ areas, items: [] })
    await tab.useTasks.getState().replaceAll({ areas, items: [] })

    // Unsaved work on generation 2.
    const refusing = refuseWrites()
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Unsaved', parentId: workOf(tab) })
    await settle()
    refusing.mockRestore()

    // A notice about generation 1, arriving late.
    announce({ type: 'replaced', generation: 1 })
    await settle()

    expect(visible(tab)).toEqual(['Unsaved'])
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()
  })
})

describe('imports', () => {
  it('reach other tabs wholesale rather than merged', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)

    await a.useTasks.getState().replaceAll({ areas: [areaNamed('only', 'Only')], items: [] })
    await vi.waitFor(() => expect(b.useTasks.getState().areas.map((x) => x.id)).toEqual(['only']))
  })

  // A refused import changes nothing at all, including what was already owed
  // before it, which goes out with the next write as if it had never been asked.
  it('are refused whole when the disk refuses them, leaving the backlog and what it owed as they were', async () => {
    const tab = await openTab(factory)
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Old', parentId: workOf(tab) })
    await settle()

    const refusing = refuseWrites()
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Unsaved', parentId: workOf(tab) })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()

    await expect(
      tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [] }),
    ).rejects.toThrow()
    expect(visible(tab)).toEqual(['Old', 'Unsaved'])
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()

    refusing.mockRestore()
    tab.useTasks.getState().addItem({ kind: 'task', title: 'After', parentId: workOf(tab) })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).toBeNull()
    expect(visible(await openTab(factory))).toEqual(['After', 'Old', 'Unsaved'])
  })

  it('are refused before the store has loaded', async () => {
    vi.resetModules()
    const tasks = await import('./tasks')
    await expect(tasks.useTasks.getState().replaceAll({ areas: [], items: [] })).rejects.toThrow()
    // And edits work again afterwards.
    expect(tasks.useTasks.getState().addArea('Later')).not.toBeNull()
  })

  it('refuse edits from the moment one is asked for until it settles', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const imported = tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [] })
    expect(tab.useTasks.getState().addItem({ kind: 'task', title: 'Too soon', parentId: work })).toBeNull()
    expect(tab.useTasks.getState().addArea('Too soon')).toBeNull()
    await imported

    expect(tab.useTasks.getState().addItem({ kind: 'task', title: 'In time', parentId: work })).not.toBeNull()
  })

  // Memory still shows the backlog being replaced while an import lands, and an
  // edit to that could not be carried onto the import correctly.
  it('refuse an edit made while one is landing, and land exactly as they were', async () => {
    const tab = await openTab(factory)
    const areas = tab.useTasks.getState().areas
    let made: string | null | undefined
    duringNext('readwrite', () => {
      made = tab.useTasks.getState().addItem({ kind: 'task', title: 'Made meanwhile', parentId: workOf(tab) })
    })
    await tab.useTasks.getState().replaceAll({ areas, items: [taskIn(workOf(tab), 'Imported')] })
    await settle()

    expect(made).toBeNull()
    expect(visible(tab)).toEqual(['Imported'])
    expect(visible(await openTab(factory))).toEqual(['Imported'])
  })

  // Not thrown away as superseded: the edit is written against the generation
  // the import produced.
  it('let an edit made once one has landed be written against it', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    await tab.useTasks.getState().replaceAll({ areas: tab.useTasks.getState().areas, items: [] })
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Straight after', parentId: work })
    await settle()

    expect(visible(tab)).toEqual(['Straight after'])
    expect(visible(await openTab(factory))).toEqual(['Straight after'])
  })

  it('let a second made while the first is landing be the one that stays', async () => {
    const tab = await openTab(factory)
    const areas = tab.useTasks.getState().areas
    const second = { ...taskIn(workOf(tab), 'From the second file'), id: 'second' }
    duringNext('readwrite', () => void tab.useTasks.getState().replaceAll({ areas, items: [second] }))
    await tab.useTasks.getState().replaceAll({ areas, items: [] })
    await settle()

    expect(visible(await openTab(factory))).toEqual(['From the second file'])
    expect(tab.useStorageHealth.getState().failures.tasks).toBeNull()
  })

  it('do not let a write answered after one put back what it left out', async () => {
    const tab = await openTab(factory)
    const id = tab.useTasks.getState().addItem({ kind: 'task', title: 'Draft', parentId: workOf(tab) })!
    await settle()

    // A newer copy on disk, so this tab's next write comes back stale.
    const current = tab.useTasks.getState().items.find((i) => i.id === id)!
    await savedElsewhere({ items: [{ ...current, title: 'Newer', updatedAt: current.updatedAt + 60_000 }] })

    const areas = tab.useTasks.getState().areas
    duringNext('readwrite', () => void tab.useTasks.getState().replaceAll({ areas, items: [] }))
    tab.useTasks.getState().renameItem(id, 'Older')
    await settle()

    expect(visible(tab)).toEqual([])
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('do not let a broadcast heard while one lands put back what it left out', async () => {
    const tab = await openTab(factory)
    await settle()
    const areas = tab.useTasks.getState().areas
    const parent = workOf(tab)

    const held = holdNext('readwrite')
    const imported = tab.useTasks.getState().replaceAll({ areas, items: [taskIn(parent, 'Imported')] })
    await held.holding
    // A write from another tab on the backlog being replaced.
    announce({ type: 'changed', generation: 0, areas: [], items: [taskIn(parent, 'Excluded', 5)] })
    await settle()
    held.release()
    await imported
    await settle()

    expect(visible(tab)).toEqual(['Imported'])
    expect(visible(await openTab(factory))).toEqual(['Imported'])
  })

  it("from another tab discard this tab's unsaved work", async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)

    const refusing = refuseWrites()
    a.useTasks.getState().addItem({ kind: 'task', title: 'Ghost', parentId: workOf(a) })
    await settle()
    refusing.mockRestore()

    await b.useTasks.getState().replaceAll({ areas: b.useTasks.getState().areas, items: [] })
    await vi.waitFor(() => expect(visible(a)).toEqual([]))
    expect(a.useStorageHealth.getState().failures.tasks).toBeNull()

    a.useTasks.getState().addItem({ kind: 'task', title: 'Real', parentId: workOf(a) })
    await settle()
    expect(visible(await openTab(factory))).toEqual(['Real'])
  })

  it('made here while a reload for another tab is reading are kept', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const areas = a.useTasks.getState().areas
    const work = workOf(a)

    await b.useTasks.getState().replaceAll({ areas, items: [taskIn(work, 'Remote')] })
    // A hears it and queues a reload; A imports while that reload is reading.
    duringNext('readonly', () =>
      void a.useTasks.getState().replaceAll({ areas, items: [taskIn(work, 'Local')] }),
    )
    await vi.waitFor(() => expect(visible(b)).toEqual(['Local']))

    expect(visible(a)).toEqual(['Local'])
    expect(a.useStorageHealth.getState().failures.tasks).toBeNull()
    expect(visible(await openTab(factory))).toEqual(['Local'])
  })

  it('made here while a reload waited behind a slow write are kept', async () => {
    const tab = await openTab(factory)
    const areas = tab.useTasks.getState().areas
    const work = workOf(tab)

    // A write is out and slow; another tab's replacement notice arrives and
    // its reload queues behind the write; then this tab imports.
    const held = holdNext('readwrite')
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Slow write', parentId: work })
    await held.holding
    announce({ type: 'replaced', generation: 1 })
    await settle()
    const imported = tab.useTasks.getState().replaceAll({ areas, items: [taskIn(work, 'Local import')] })
    held.release()
    await imported
    await settle()

    expect(visible(tab)).toEqual(['Local import'])
    expect(visible(await openTab(factory))).toEqual(['Local import'])
  })

  it('that fail behind a broadcast heard while loading are refused, not silently lost', async () => {
    const work = areaNamed('work', 'Work')
    const elsewhere = await openTaskDb(factory)
    await elsewhere.seedIfEmpty([work])

    vi.resetModules()
    const tasks = await import('./tasks')
    const { useStorageHealth } = await import('./storageHealth')
    opened.push(tasks)

    // The load's read is held open. Another tab's import queues behind it and
    // lands at generation 1, and a write made on top of that is heard before
    // this tab's load has finished.
    const held = holdNext('readonly')
    const loading = tasks.hydrateTasks(factory)
    await held.holding
    const replaced = elsewhere.replaceAll({ areas: [work], items: [taskIn('work', 'Remote')] })
    announce({ type: 'changed', generation: 1, areas: [], items: [] })
    await settle()

    // Then this tab imports a file, and its disk refuses every write.
    held.spy.mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      if (args[1] === 'readwrite') throw new DOMException('full', 'QuotaExceededError')
      return held.original.apply(this, args)
    })
    const imported = tasks.useTasks.getState().replaceAll({ areas: [work], items: [taskIn('work', 'Local')] })
    held.release()
    await loading
    await replaced
    await expect(imported).rejects.toThrow()
    await settle()
    held.spy.mockRestore()
    elsewhere.close()

    // The caller was told, and this tab agrees with the disk.
    expect(visible(tasks)).toEqual(['Remote'])
    expect(visible(await openTab(factory))).toEqual(['Remote'])
    expect(useStorageHealth.getState().failures.tasks).toBeNull()
  })

  it('are taken in memory when there is no database, and the tab keeps saying it is not saved', async () => {
    const tab = await openTab(broken)

    await tab.useTasks.getState().replaceAll({ areas: [areaNamed('work', 'Work')], items: [taskIn('work', 'Imported')] })
    expect(visible(tab)).toEqual(['Imported'])
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()

    announce({ type: 'changed', generation: 0, areas: [], items: [taskIn('work', 'Elsewhere')] })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).not.toBeNull()
  })
})

/**
 * A delete writes one tombstone, and what sat beneath it is gone by ancestry
 * (`isGone`), so these assert what is *visible* rather than which records carry
 * tombstones. Most involve a tab that has not heard of something another did.
 */
describe('deleting', () => {
  it('takes an epic and everything in it, writing the epic alone', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const { addItem, deleteItem } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work })!
    const outcome = addItem({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    const inside = addItem({ kind: 'task', title: 'Login form', parentId: outcome })!
    const outside = addItem({ kind: 'task', title: 'Call Priya', parentId: work })!

    deleteItem(epic)
    await settle()

    const reloaded = await openTab(factory)
    const { items, areas } = reloaded.useTasks.getState()
    for (const id of [epic, outcome, inside]) expect(isGone(id, items, areas)).toBe(true)
    expect(isGone(outside, items, areas)).toBe(false)
    expect(items.filter((i) => i.deletedAt !== undefined).map((i) => i.id)).toEqual([epic])
  })

  it('takes an area and everything in it, writing the area alone', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const { addItem, deleteArea } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const outcome = addItem({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    const inside = addItem({ kind: 'task', title: 'Login form', parentId: outcome })!
    const inbox = addItem({ kind: 'task', title: 'Call Priya', parentId: work! })!
    const outside = addItem({ kind: 'task', title: 'Fix the gate', parentId: personal! })!

    deleteArea(work!)
    await settle()

    const state = (await openTab(factory)).useTasks.getState()
    expect(state.areas.find((a) => a.id === work)?.deletedAt).toBeTypeOf('number')
    expect(activeAreas(state.areas).map((a) => a.id)).toEqual([personal])
    for (const id of [epic, outcome, inside, inbox]) {
      expect(isGone(id, state.items, state.areas)).toBe(true)
    }
    expect(isGone(outside, state.items, state.areas)).toBe(false)
    expect(state.items.some((i) => i.deletedAt !== undefined)).toBe(false)
  })

  it('leaves a deleted task uneditable', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const id = tab.useTasks.getState().addItem({ kind: 'task', title: 'Old', parentId: work })!

    tab.useTasks.getState().deleteItem(id)
    tab.useTasks.getState().renameItem(id, 'New')

    const item = tab.useTasks.getState().items.find((i) => i.id === id)
    expect(item?.deletedAt).toBeTypeOf('number')
    expect(item?.title).toBe('Old')
    expect(inboxOf(work, tab.useTasks.getState().items)).toEqual([])
  })

  it('refuses to move, edit or add to what is gone with a deleted epic', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const { addItem, deleteItem, moveItem, renameItem } = tab.useTasks.getState()
    const epic = addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const outcome = addItem({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    const child = addItem({ kind: 'task', title: 'Login form', parentId: outcome })!
    deleteItem(epic)

    moveItem(child, personal!)
    renameItem(child, 'Renamed')
    expect(addItem({ kind: 'task', title: 'New', parentId: outcome })).toBeNull()
    await settle()

    const stored = (await openTab(factory)).useTasks.getState().items.find((i) => i.id === child)!
    expect(stored).toMatchObject({ parentId: outcome, title: 'Login form' })
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('keeps a task another tab moved out before it heard of the delete, at ordinary versions', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Moved out', parentId: epic })!
    await settle()

    // The move is saved at the next version; the delete, later by the clock,
    // is stamped well past it. Had the delete tombstoned the subtree it saw,
    // that copy of the child would have won.
    const current = tab.useTasks.getState().items.find((i) => i.id === child)!
    await savedElsewhere({ items: [{ ...current, parentId: personal!, updatedAt: current.updatedAt + 1 }] })
    vi.spyOn(Date, 'now').mockReturnValue(current.updatedAt + 1_000)

    tab.useTasks.getState().deleteItem(epic)
    await settle()
    vi.restoreAllMocks()

    const reloaded = await openTab(factory)
    expect(visible(reloaded)).toEqual(['Moved out'])
    expect(reloaded.useTasks.getState().items.find((i) => i.id === child)?.parentId).toBe(personal)
  })

  it('keeps a moved-out task when an older copy of it arrives after the delete', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    await settle()
    const created = { ...taskIn(epic, 'Created there'), id: 'late' }
    // Created under the epic and then moved out, both saved elsewhere.
    await savedElsewhere({ items: [{ ...created, parentId: personal!, updatedAt: 2 }] })

    tab.useTasks.getState().deleteItem(epic)
    await settle()
    // The creation's broadcast arrives late, describing the task where it was.
    announce({ type: 'changed', generation: 0, areas: [], items: [created] })
    await settle()

    expect(visible(await openTab(factory))).toEqual(['Created there'])
  })

  it('takes a child renamed elsewhere with the epic, without a write of its own', async () => {
    const tab = await openTab(factory)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: workOf(tab) })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })!
    await settle()

    const current = tab.useTasks.getState().items.find((i) => i.id === child)!
    await savedElsewhere({ items: [{ ...current, title: 'Renamed there', updatedAt: current.updatedAt + 60_000 }] })

    tab.useTasks.getState().deleteItem(epic)
    await settle()

    expect(visible(tab)).toEqual([])
    const reloaded = await openTab(factory)
    expect(visible(reloaded)).toEqual([])
    // Only the epic was written; the child is gone because the epic is.
    expect(reloaded.useTasks.getState().items.find((i) => i.id === child)?.deletedAt).toBeUndefined()
  })

  it('takes a child another tab added just before it heard of the delete', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const epic = a.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: workOf(a) })!
    await vi.waitFor(() => expect(b.useTasks.getState().items.map((i) => i.id)).toContain(epic))

    // In the same moment: A deletes the epic, B adds a task to it.
    a.useTasks.getState().deleteItem(epic)
    b.useTasks.getState().addItem({ kind: 'task', title: 'Added there', parentId: epic })

    await vi.waitFor(() => {
      expect(visible(a)).toEqual([])
      expect(visible(b)).toEqual([])
    })
    await settle()
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('takes everything in a deleted area, including a child renamed elsewhere', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Call Priya', parentId: work })!
    await settle()

    const current = tab.useTasks.getState().items.find((i) => i.id === child)!
    await savedElsewhere({ items: [{ ...current, title: 'Renamed there', updatedAt: current.updatedAt + 60_000 }] })

    tab.useTasks.getState().deleteArea(work)
    await settle()

    expect(visible(await openTab(factory))).toEqual([])
  })

  it('wins over a rename of the same epic that reached the disk first', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const epic = a.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: workOf(a) })!
    a.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })
    await vi.waitFor(() => expect(visible(b)).toEqual(['Login form', 'Mono auth']))

    // The same millisecond in both tabs, before either hears the other, so the
    // two copies share a version; the rename was asked for first and commits
    // first, and the disk then sees a different copy at the same version.
    const current = a.useTasks.getState().items.find((i) => i.id === epic)!
    vi.spyOn(Date, 'now').mockReturnValue(current.updatedAt + 1)
    b.useTasks.getState().renameItem(epic, 'Renamed')
    a.useTasks.getState().deleteItem(epic)
    expect(a.useTasks.getState().items.find((i) => i.id === epic)?.updatedAt).toBe(
      b.useTasks.getState().items.find((i) => i.id === epic)?.updatedAt,
    )
    await settle()
    await settle()
    vi.restoreAllMocks()

    expect(visible(a)).toEqual([])
    await vi.waitFor(() => expect(visible(b)).toEqual([]))
    expect(visible(await openTab(factory))).toEqual([])
    expect(a.useStorageHealth.getState().failures.tasks).toBeNull()
  })

  it('cannot be undone by an edit from a tab that had not heard', async () => {
    const tab = await openTab(factory)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: workOf(tab) })!
    await settle()

    await savedElsewhere({ items: [deleted(tab.useTasks.getState().items.find((i) => i.id === epic)!)] })

    // A rename stamped well after the delete still cannot bring the epic back.
    tab.useTasks.getState().renameItem(epic, 'Too late')
    await settle()

    expect(visible(tab)).toEqual([])
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('cannot be undone by moving a task out, from a tab that had not heard', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })!
    await settle()

    await savedElsewhere({ items: [deleted(tab.useTasks.getState().items.find((i) => i.id === epic)!)] })

    tab.useTasks.getState().moveItem(child, personal!)
    await settle()

    // The disk kept the task where it was, and this tab took the disk's word
    // for it rather than go on showing — and owing — the refused move.
    expect(tab.useTasks.getState().items.find((i) => i.id === child)?.parentId).toBe(epic)
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Unrelated', parentId: personal! })
    await settle()
    expect(tab.useStorageHealth.getState().failures.tasks).toBeNull()
    expect(visible(await openTab(factory))).toEqual(['Unrelated'])
  })

  it('of an area cannot be undone by moving an epic out, which would bring its subtree back', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work!.id })!
    tab.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })
    await settle()

    await savedElsewhere({ areas: [deleted(work!)] })

    tab.useTasks.getState().moveItem(epic, personal!.id)
    await settle()

    expect(visible(await openTab(factory))).toEqual([])
  })

  it('that refused a move is learnt, so the task stops being offered as work', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })!
    await settle()

    // Deleted by a connection that broadcasts nothing.
    await savedElsewhere({ items: [deleted(tab.useTasks.getState().items.find((i) => i.id === epic)!)] })

    tab.useTasks.getState().moveItem(child, personal!)
    await settle()

    const { items, areas } = tab.useTasks.getState()
    expect(items.find((i) => i.id === epic)?.deletedAt).toBeTypeOf('number')
    expect(activeTasks(items, areas).map((t) => t.id)).not.toContain(child)
    expect(visible(tab)).toEqual([])
  })

  it('already on disk still refuses a move when the same write deletes it again', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Login form', parentId: epic })!
    await settle()

    await savedElsewhere({ items: [deleted(tab.useTasks.getState().items.find((i) => i.id === epic)!)] })

    // Both owed at once, so they go out in one write.
    tab.useTasks.getState().moveItem(child, personal!)
    tab.useTasks.getState().deleteItem(epic)
    await settle()

    expect(visible(tab)).toEqual([])
    expect(visible(await openTab(factory))).toEqual([])
  })

  it('of an area already on disk still refuses a move when the same write deletes it again', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work!.id })!
    await settle()

    await savedElsewhere({ areas: [deleted(work!)] })

    tab.useTasks.getState().moveItem(epic, personal!.id)
    tab.useTasks.getState().deleteArea(work!.id)
    await settle()

    expect(visible(await openTab(factory))).toEqual([])
  })

  it('lets a move out survive when the same write moves its old epic into a deleted area', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const old = tab.useTasks.getState().addArea('Old')!
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const outcome = tab.useTasks.getState().addItem({ kind: 'outcome', title: 'Login pages', parentId: epic })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Moved first', parentId: outcome })!
    await settle()

    // Another tab deletes the third area; this one has not heard.
    await savedElsewhere({ areas: [deleted(tab.useTasks.getState().areas.find((a) => a.id === old)!)] })

    // First the task moves out, then its epic moves into the deleted area,
    // both in one write, which is judged by the disk as it found it.
    tab.useTasks.getState().moveItem(child, personal!)
    tab.useTasks.getState().moveItem(epic, old)
    await settle()

    expect(visible(await openTab(factory))).toEqual(['Moved first'])
  })

  it('keeps a task the same tab moved out just before it deleted the old epic', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'Mono auth', parentId: work! })!
    const child = tab.useTasks.getState().addItem({ kind: 'task', title: 'Moved first', parentId: epic })!
    await settle()

    // Both owed at once, so they go out in one write.
    tab.useTasks.getState().moveItem(child, personal!)
    tab.useTasks.getState().deleteItem(epic)
    await settle()

    expect(visible(tab)).toEqual(['Moved first'])
    expect(visible(await openTab(factory))).toEqual(['Moved first'])
  })
})

describe('later', () => {
  const titles = (tab: TasksModule) =>
    waitingLater(tab.useTasks.getState().later).map((l) => l.title)

  it('persists through its whole life, keeping the block it came from', async () => {
    const tab = await openTab(factory)
    const from = { blockId: 'b1', purpose: 'Draft the schema' }
    const id = tab.useTasks.getState().addLater('  Try WebGPU ', from)!
    expect(tab.useTasks.getState().addLater('   ')).toBeNull()

    tab.useTasks.getState().retitleLater(id, 'Try WebGPU for the scene')
    tab.useTasks.getState().letGoLater(id)
    await settle()
    let reloaded = await openTab(factory)
    expect(titles(reloaded)).toEqual([])
    expect(letGoLater(reloaded.useTasks.getState().later)).toMatchObject([
      { id, title: 'Try WebGPU for the scene', from },
    ])

    reloaded.useTasks.getState().restoreLater(id)
    await settle()
    reloaded = await openTab(factory)
    expect(titles(reloaded)).toEqual(['Try WebGPU for the scene'])

    reloaded.useTasks.getState().deleteLater(id)
    await settle()
    const after = await openTab(factory)
    expect(after.useTasks.getState().later).toMatchObject([{ id, deletedAt: expect.any(Number) }])
    expect(titles(after)).toEqual([])
  })

  it('reaches another tab, and so does its delete', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)

    const id = a.useTasks.getState().addLater('Shared thought')!
    await vi.waitFor(() => expect(titles(b)).toEqual(['Shared thought']))
    a.useTasks.getState().deleteLater(id)
    await vi.waitFor(() => expect(titles(b)).toEqual([]))
  })

  it('becomes a task where it is filed, gone in the same write that adds the task', async () => {
    const tab = await openTab(factory)
    await settle()
    const work = workOf(tab)
    const id = tab.useTasks.getState().addLater('Look into WebGPU')!
    await settle()

    const writes = vi.spyOn(IDBDatabase.prototype, 'transaction')
    const taskId = tab.useTasks.getState().fileLater(id, work)!
    await settle()
    expect(writes.mock.calls.filter((call) => call[1] === 'readwrite')).toHaveLength(1)
    writes.mockRestore()

    const reloaded = await openTab(factory)
    expect(inboxOf(work, reloaded.useTasks.getState().items)).toMatchObject([
      { id: taskId, kind: 'task', title: 'Look into WebGPU', status: 'open' },
    ])
    expect(titles(reloaded)).toEqual([])
    expect(reloaded.useTasks.getState().later.find((l) => l.id === id)?.deletedAt).toBeTypeOf(
      'number',
    )
  })

  it('is filed only while it waits, and only where a task can go', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas).map((a) => a.id)
    const store = () => tab.useTasks.getState()
    const epic = store().addItem({ kind: 'epic', title: 'Epic', parentId: work! })!

    const waiting = store().addLater('Waiting')!
    expect(store().fileLater(waiting, 'nowhere')).toBeNull()
    store().deleteArea(personal!)
    expect(store().fileLater(waiting, personal!)).toBeNull()

    const letGo = store().addLater('Let go')!
    store().letGoLater(letGo)
    expect(store().fileLater(letGo, work!)).toBeNull()

    expect(store().fileLater(waiting, epic)).toBeTypeOf('string')
    expect(store().fileLater(waiting, work!)).toBeNull()
    expect(visible(tab)).toEqual(['Epic', 'Waiting'])
  })

  it('is filed once when two tabs file it before hearing each other', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const id = a.useTasks.getState().addLater('Look into WebGPU')!
    await vi.waitFor(() => expect(titles(b)).toEqual(['Look into WebGPU']))
    const [work, personal] = activeAreas(a.useTasks.getState().areas).map((x) => x.id)

    // Both in the same tick: neither has heard of the other's filing.
    a.useTasks.getState().fileLater(id, work!)
    b.useTasks.getState().fileLater(id, personal!)
    await settle()

    const filed = (tab: TasksModule) =>
      visible(tab).filter((title) => title === 'Look into WebGPU')
    await vi.waitFor(() => expect(filed(a)).toHaveLength(1))
    await vi.waitFor(() => expect(filed(b)).toHaveLength(1))
    const reloaded = await openTab(factory)
    expect(filed(reloaded)).toHaveLength(1)
    expect(titles(reloaded)).toEqual([])
  })

  it('stays waiting when it is filed into a place another tab has just deleted', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const id = a.useTasks.getState().addLater('Call the plumber')!
    await vi.waitFor(() => expect(titles(b)).toEqual(['Call the plumber']))
    const personal = activeAreas(a.useTasks.getState().areas)[1]!.id

    a.useTasks.getState().deleteArea(personal)
    b.useTasks.getState().fileLater(id, personal)
    await settle()

    // The tab that filed it learns of the delete and gets the line back.
    await vi.waitFor(() => expect(titles(b)).toEqual(['Call the plumber']))
    expect(b.useTasks.getState().items.some((i) => i.title === 'Call the plumber')).toBe(false)
    const reloaded = await openTab(factory)
    expect(titles(reloaded)).toEqual(['Call the plumber'])
    expect(reloaded.useTasks.getState().items).toEqual([])
  })

  it('stays waiting when filed into a new epic whose area was deleted elsewhere', async () => {
    const tab = await openTab(factory)
    const id = tab.useTasks.getState().addLater('Call the plumber')!
    await settle()
    const personal = activeAreas(tab.useTasks.getState().areas)[1]!
    // Deleted by a tab this one has not heard from yet.
    await savedElsewhere({ areas: [deleted(personal)] })

    // The epic and the filing go to the disk in the same write.
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'House', parentId: personal.id })!
    tab.useTasks.getState().fileLater(id, epic)
    await settle()

    expect(titles(tab)).toEqual(['Call the plumber'])
    const reloaded = await openTab(factory)
    expect(titles(reloaded)).toEqual(['Call the plumber'])
    expect(reloaded.useTasks.getState().items.some((i) => i.title === 'Call the plumber')).toBe(false)
  })

  it('is not filed from a copy another tab has since changed, and shows that change', async () => {
    const tab = await openTab(factory)
    const work = workOf(tab)
    const renamed = tab.useTasks.getState().addLater('Shcema notes')!
    const letGo = tab.useTasks.getState().addLater('Learn the cello')!
    await settle()
    const copy = (id: string) => tab.useTasks.getState().later.find((l) => l.id === id)!
    // Corrected in one tab and let go in another, neither heard here yet.
    await savedElsewhere({
      later: [
        { ...copy(renamed), title: 'Schema notes', updatedAt: copy(renamed).updatedAt + 1 },
        { ...copy(letGo), letGoAt: 5, updatedAt: copy(letGo).updatedAt + 1 },
      ],
    })

    tab.useTasks.getState().fileLater(renamed, work)
    tab.useTasks.getState().fileLater(letGo, work)
    await settle()

    expect(titles(tab)).toEqual(['Schema notes'])
    expect(letGoLater(tab.useTasks.getState().later).map((l) => l.title)).toEqual([
      'Learn the cello',
    ])
    const reloaded = await openTab(factory)
    expect(visible(reloaded)).toEqual([])
    expect(titles(reloaded)).toEqual(['Schema notes'])

    // Filed again from the copy it now holds, it lands.
    reloaded.useTasks.getState().fileLater(renamed, workOf(reloaded))
    await settle()
    expect(visible(await openTab(factory))).toEqual(['Schema notes'])
  })

  it('refuses a line put down while an import is landing, saying so', async () => {
    const tab = await openTab(factory)
    await settle()
    const held = holdNext('readwrite')
    const importing = tab.useTasks.getState().replaceAll({ areas: [areaNamed('only')], items: [] })
    await held.holding
    expect(tab.useTasks.getState().addLater('Lost in the import')).toBeNull()
    held.release()
    await importing
    held.spy.mockRestore()
    expect(tab.useTasks.getState().addLater('After it')).toBeTypeOf('string')
  })

  it('files a line written in a block once it is saved, and after a reload', async () => {
    const tab = await openTab(factory)
    const from = { blockId: 'b1', purpose: 'Draft the schema' }
    const saved = tab.useTasks.getState().addLater('Try WebGPU', from)!
    const reloadedToo = tab.useTasks.getState().addLater('Read the spec', from)!
    await settle()

    // Saved: the disk's copy is a clone of this one, and must still count as it.
    tab.useTasks.getState().fileLater(saved, workOf(tab))
    await settle()
    expect(visible(tab)).toEqual(['Try WebGPU'])

    const reloaded = await openTab(factory)
    reloaded.useTasks.getState().fileLater(reloadedToo, workOf(reloaded))
    await settle()
    expect(titles(reloaded)).toEqual([])
    const after = await openTab(factory)
    expect(visible(after)).toEqual(['Read the spec', 'Try WebGPU'])
    expect(titles(after)).toEqual([])
  })

  it('stays waiting when filed into an epic the same write moves under an area deleted elsewhere', async () => {
    const tab = await openTab(factory)
    const [work, personal] = activeAreas(tab.useTasks.getState().areas)
    const epic = tab.useTasks.getState().addItem({ kind: 'epic', title: 'House', parentId: work!.id })!
    const id = tab.useTasks.getState().addLater('Call the plumber')!
    await settle()
    await savedElsewhere({ areas: [deleted(personal!)] })

    // The move and the filing go to the disk in the same write.
    tab.useTasks.getState().moveItem(epic, personal!.id)
    tab.useTasks.getState().fileLater(id, epic)
    await settle()

    expect(titles(tab)).toEqual(['Call the plumber'])
    const reloaded = await openTab(factory)
    expect(titles(reloaded)).toEqual(['Call the plumber'])
    expect(reloaded.useTasks.getState().items.some((i) => i.title === 'Call the plumber')).toBe(false)
  })

  it('carries an edit to the new task made before the filing reached the disk', async () => {
    const tab = await openTab(factory)
    await settle()
    const id = tab.useTasks.getState().addLater('Look into WebGPU')!
    const taskId = tab.useTasks.getState().fileLater(id, workOf(tab))!
    tab.useTasks.getState().renameItem(taskId, 'Read the WebGPU spec')
    await settle()

    const reloaded = await openTab(factory)
    expect(visible(reloaded)).toEqual(['Read the WebGPU spec'])
    expect(titles(reloaded)).toEqual([])
  })

  it('says when the backlog was replaced, here or in another tab', async () => {
    const a = await openTab(factory)
    await settle()
    const b = await openTab(factory)
    const before = b.useTasks.getState().replaced

    await a.useTasks.getState().replaceAll({ areas: [areaNamed('only')], items: [] })
    expect(a.useTasks.getState().replaced).toBe(before + 1)
    await vi.waitFor(() => expect(b.useTasks.getState().replaced).toBe(before + 1))

    // An edit is not a replacement.
    a.useTasks.getState().addLater('Not a replacement')
    await vi.waitFor(() => expect(titles(b)).toEqual(['Not a replacement']))
    expect(b.useTasks.getState().replaced).toBe(before + 1)
  })

  it('goes with an import, which brings its own or none', async () => {
    const tab = await openTab(factory)
    tab.useTasks.getState().addLater('Before the import')
    const imported = {
      id: 'imported',
      title: 'From the file',
      createdAt: 1,
      updatedAt: 1,
    }
    await tab.useTasks.getState().replaceAll({
      areas: [areaNamed('only')],
      items: [],
      later: [imported],
    })
    expect(titles(tab)).toEqual(['From the file'])
    expect(titles(await openTab(factory))).toEqual(['From the file'])

    await tab.useTasks.getState().replaceAll({ areas: [areaNamed('only')], items: [] })
    expect(tab.useTasks.getState().later).toEqual([])
  })
})
