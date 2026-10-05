/**
 * The backlog store: areas and work items, in memory and in IndexedDB.
 *
 * The second of Mono's two stores, and deliberately not part of the first. The
 * session store holds the day's event log and is rebuilt from it; this holds
 * long-lived records edited in place. See `domain/tasks.ts` for why the two are
 * different kinds of data, and `taskDb.ts` for why they live in different
 * storage.
 *
 * Like the session store, this is allowed to read the clock and make ids, and
 * nothing it calls is. Every action updates memory first and then writes the
 * one record it changed, so a checkbox is never waiting on a disk.
 *
 * Three things here are less obvious than the rest:
 *
 * - **Hydration is asynchronous, and writes can happen before it finishes.**
 *   Anything created before the database has been read is held, merged with
 *   what was read by `newer`, and written once the database is open — so a
 *   task added in the first half-second is neither lost nor overwritten by an
 *   empty read.
 * - **A failed write is retried by the next one.** Records that did not land
 *   stay pending and go out with every later write, and only a write that
 *   carried all of them clears the storage warning. Per-record storage has no
 *   other way to know that an earlier failure has been made good, and clearing
 *   the warning on any later success would report a task as saved that is
 *   still only in memory.
 * - **Other tabs are told.** Every landed write is broadcast, and a tab that
 *   hears one keeps whichever copy of each record is newer. Without it a tab
 *   left open since the morning holds a stale copy of a task and, on its next
 *   edit, writes that copy over the one changed elsewhere.
 */

import { create } from 'zustand'

import {
  canParent,
  complete,
  drop,
  isLive,
  newArea,
  newer,
  newItem,
  nextOrder,
  reopen,
  type Area,
  type Item,
  type ParentKind,
} from '@/domain/tasks'
import type { Ms } from '@/domain/types'
import { newId } from './ids'
import { useStorageHealth } from './storageHealth'
import { openTaskDb, type BacklogContents, type TaskDb } from './taskDb'

const CHANNEL = 'mono.tasks'

/**
 * The areas a brand-new backlog starts with. Seeded once, when the database
 * holds no areas at all — tombstones included, so archiving or deleting both
 * never brings them back.
 */
const SEED_AREAS = ['Work', 'Personal'] as const

type TaskStore = BacklogContents & {
  /** False until IndexedDB has been read. The task UI waits on this. */
  hydrated: boolean

  addArea: (name: string) => string | null
  renameArea: (id: string, name: string) => void
  archiveArea: (id: string) => void
  unarchiveArea: (id: string) => void

  /**
   * A new open task under an area or an item. Returns its id, or null when the
   * title is blank or the parent cannot hold a task.
   */
  addTask: (input: { title: string; parentId: string }) => string | null
  renameTask: (id: string, title: string) => void
  /** Ignored when the new parent cannot hold this kind, or lies inside it. */
  moveTask: (id: string, parentId: string) => void
  completeTask: (id: string) => void
  dropTask: (id: string) => void
  reopenTask: (id: string) => void
  /** A tombstone, so history and other tabs can tell deleted from unknown. */
  deleteTask: (id: string) => void

  /** Replace the whole backlog, from an import. */
  replaceAll: (contents: BacklogContents) => Promise<void>
}

type Message =
  | { type: 'changed'; areas: Area[]; items: Item[] }
  | { type: 'replaced' }

let db: Promise<TaskDb> | null = null
let channel: BroadcastChannel | null = null
const pending = { areas: new Map<string, Area>(), items: new Map<string, Item>() }

export const useTasks = create<TaskStore>()((set, get) => {
  const putArea = (area: Area) => {
    set((s) => ({ areas: upsert(s.areas, area) }))
    save({ areas: [area] })
  }
  const putItem = (item: Item) => {
    set((s) => ({ items: upsert(s.items, item) }))
    save({ items: [item] })
  }
  const editArea = (id: string, edit: (area: Area, at: Ms) => Area | null) => {
    const area = get().areas.find((a) => a.id === id)
    if (!area || !isLive(area)) return
    const next = edit(area, Date.now())
    if (next) putArea(next)
  }
  const editItem = (id: string, edit: (item: Item, at: Ms) => Item | null) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || !isLive(item)) return
    const next = edit(item, Date.now())
    if (next) putItem(next)
  }

  return {
    hydrated: false,
    areas: [],
    items: [],

    addArea: (name) => {
      if (name.trim() === '') return null
      const id = newId()
      putArea(newArea(id, name, nextOrder(get().areas), Date.now()))
      return id
    },

    renameArea: (id, name) =>
      editArea(id, (area, at) =>
        name.trim() === '' ? null : { ...area, name: name.trim(), updatedAt: at },
      ),

    archiveArea: (id) => editArea(id, (area, at) => ({ ...area, archivedAt: at, updatedAt: at })),

    unarchiveArea: (id) =>
      editArea(id, (area, at) => {
        const { archivedAt, ...rest } = area
        void archivedAt
        return { ...rest, updatedAt: at }
      }),

    addTask: ({ title, parentId }) => {
      const { areas, items } = get()
      const parent = parentKindOf(parentId, areas, items)
      if (title.trim() === '' || parent === null || !canParent('task', parent)) return null
      const id = newId()
      const siblings = items.filter((i) => i.parentId === parentId)
      putItem(
        newItem({ id, kind: 'task', title, parentId, order: nextOrder(siblings) }, Date.now()),
      )
      return id
    },

    renameTask: (id, title) =>
      editItem(id, (item, at) =>
        title.trim() === '' ? null : { ...item, title: title.trim(), updatedAt: at },
      ),

    moveTask: (id, parentId) =>
      editItem(id, (item, at) => {
        const { areas, items } = get()
        const parent = parentKindOf(parentId, areas, items)
        if (parent === null || !canParent(item.kind, parent)) return null
        if (parentId === item.parentId || liesWithin(parentId, item.id, items)) return null
        const siblings = items.filter((i) => i.parentId === parentId)
        return { ...item, parentId, order: nextOrder(siblings), updatedAt: at }
      }),

    completeTask: (id) => editItem(id, (item, at) => (item.status === 'done' ? null : complete(item, at))),
    dropTask: (id) => editItem(id, (item, at) => (item.status === 'dropped' ? null : drop(item, at))),
    reopenTask: (id) => editItem(id, (item, at) => (item.status === 'open' ? null : reopen(item, at))),
    deleteTask: (id) => editItem(id, (item, at) => ({ ...item, deletedAt: at, updatedAt: at })),

    replaceAll: async (contents) => {
      pending.areas.clear()
      pending.items.clear()
      set({ areas: contents.areas, items: contents.items })
      try {
        if (!db) throw new Error('The task store is not open.')
        await (await db).replaceAll(contents)
        useStorageHealth.getState().noteSuccess('tasks')
        channel?.postMessage({ type: 'replaced' } satisfies Message)
      } catch {
        // Held as pending so the next write tries again with everything.
        for (const area of contents.areas) pending.areas.set(area.id, area)
        for (const item of contents.items) pending.items.set(item.id, item)
        useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
      }
    },
  }
})

/**
 * Read the backlog and start listening to other tabs. Called once at boot.
 *
 * Resolves rather than rejects when IndexedDB is unavailable — a private window
 * in some browsers, or site data blocked. The backlog then works in memory, the
 * header says it is not being saved, and nothing waits forever on `hydrated`.
 */
export async function hydrateTasks(factory?: IDBFactory): Promise<void> {
  db = openTaskDb(factory)
  // Attached now so a rejection is never unhandled; `save` re-awaits it.
  db.catch(() => undefined)

  let stored: BacklogContents = { areas: [], items: [] }
  try {
    stored = await (await db).readAll()
  } catch {
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
  }

  // Anything made before the read finished is merged in, not overwritten.
  const memory = useTasks.getState()
  const areas = mergeNewer(stored.areas, memory.areas)
  const items = mergeNewer(stored.items, memory.items)
  useTasks.setState({ areas, items, hydrated: true })

  if (areas.length === 0) {
    const at = Date.now()
    const seeds = SEED_AREAS.map((name, order) => newArea(newId(), name, order, at))
    useTasks.setState({ areas: seeds })
    save({ areas: seeds })
  } else if (pending.areas.size > 0 || pending.items.size > 0) {
    save({})
  }

  listen()
  // Best effort, and only asked once there is something worth keeping. Without
  // it some browsers clear an uninstalled site's data after a quiet week, and
  // losing a backlog would cost far more trust than losing a day's log.
  void globalThis.navigator?.storage?.persist?.().catch(() => undefined)
}

/** Close the database and the channel. For tests, which open one per case. */
export function closeTasks(): void {
  channel?.close()
  channel = null
  void db?.then((open) => open.close()).catch(() => undefined)
  db = null
}

/**
 * Write these records, plus anything still pending from a failed write.
 *
 * Pending is keyed by id, so a record edited twice while the disk is refusing
 * is written once, in its latest form. Only records still identical to what was
 * sent are removed from pending afterwards — one edited again while this write
 * was in flight has to go out again.
 */
function save(changes: Partial<BacklogContents>): void {
  for (const area of changes.areas ?? []) pending.areas.set(area.id, area)
  for (const item of changes.items ?? []) pending.items.set(item.id, item)
  // Before hydration there is nowhere to write yet. `hydrateTasks` flushes.
  if (!db) return

  const batch = { areas: [...pending.areas.values()], items: [...pending.items.values()] }
  if (batch.areas.length === 0 && batch.items.length === 0) return

  db.then((open) => open.write(batch)).then(
    () => {
      for (const area of batch.areas) {
        if (pending.areas.get(area.id) === area) pending.areas.delete(area.id)
      }
      for (const item of batch.items) {
        if (pending.items.get(item.id) === item) pending.items.delete(item.id)
      }
      if (pending.areas.size === 0 && pending.items.size === 0) {
        useStorageHealth.getState().noteSuccess('tasks')
      }
      channel?.postMessage({ type: 'changed', ...batch } satisfies Message)
    },
    () => useStorageHealth.getState().noteFailure(Date.now(), 'tasks'),
  )
}

function listen(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data
    if (message.type === 'changed') {
      useTasks.setState((s) => ({
        areas: mergeNewer(s.areas, message.areas),
        items: mergeNewer(s.items, message.items),
      }))
    } else if (message.type === 'replaced') {
      // Another tab imported a file. Its contents are the backlog now, so they
      // replace this tab's rather than merging into it.
      void db
        ?.then((open) => open.readAll())
        .then((contents) => useTasks.setState(contents))
        .catch(() => undefined)
    }
  }
}

/** What kind of thing `id` names, or null if it names nothing live. */
function parentKindOf(
  id: string,
  areas: readonly Area[],
  items: readonly Item[],
): ParentKind | null {
  const area = areas.find((a) => a.id === id)
  if (area) return isLive(area) ? 'area' : null
  const item = items.find((i) => i.id === id)
  return item && isLive(item) ? item.kind : null
}

/** Whether `id` is `ancestorId` or sits somewhere beneath it. */
function liesWithin(id: string, ancestorId: string, items: readonly Item[]): boolean {
  const byId = new Map(items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = byId.get(current)?.parentId
  }
  return false
}

const upsert = <T extends { id: string }>(list: readonly T[], record: T): T[] => {
  const index = list.findIndex((r) => r.id === record.id)
  if (index === -1) return [...list, record]
  const next = [...list]
  next[index] = record
  return next
}

/** Union by id, keeping the newer copy of anything in both. */
function mergeNewer<T extends { id: string; updatedAt: Ms }>(
  base: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map(base.map((r) => [r.id, r]))
  for (const record of incoming) {
    const existing = byId.get(record.id)
    byId.set(record.id, existing ? newer(existing, record) : record)
  }
  return [...byId.values()]
}
