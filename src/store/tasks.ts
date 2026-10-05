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
 * nothing it calls is.
 *
 * **Everything that touches the disk, or judges what another tab said, is one
 * job on one queue,** run one at a time in the order it was asked for: the
 * load, each flush, each import, and each broadcast heard. The generation this
 * tab is on only changes inside a job, so every question about it is asked
 * once, by the job that acts on the answer, and nothing can change it between
 * the question and the act. The load is the first job — this tab listens from
 * before it is queued, so a broadcast heard while loading is judged against
 * what the load found rather than missed — and nothing flushes until it has
 * said which generation is on disk.
 *
 * **Edits are optimistic.** Every action updates memory first and records what
 * it changed as pending, so a checkbox is never waiting on a disk. A flush
 * sends everything pending in one write; records that did not land stay
 * pending and go out with the next, and only a flush that leaves nothing
 * pending clears the storage warning. Anything edited before the load finished
 * is merged with what it read, by `outranks`, and written after it.
 *
 * **A pending edit never outlives a newer one.** `updatedAt` is a version, and
 * the disk refuses to put a record over a newer copy (`taskDb.ts`), handing
 * that copy back for this tab to adopt; a broadcast of a newer record drops
 * this tab's pending copy too. Broadcasts at this tab's generation are adopted
 * the moment they arrive, so the next edit builds on the other tab's copy
 * rather than on the one it replaced, and judged again in their turn, which
 * repairs a reload that read the disk just before the other tab's write. An
 * edit is stamped the later of now and one past the version it replaces
 * (`nextVersion`), so a record imported from a clock running ahead can be
 * edited at once; the dates a person reads stay on the real clock.
 *
 * **An import is all or nothing.** It writes the disk first, then replaces
 * memory, then tells the other tabs. If the disk refuses, `replaceAll` rejects
 * and nothing has changed, which Settings reports. Edits are refused from the
 * moment an import is asked for until it settles: until then memory still
 * shows the backlog being replaced, and an edit to that could not be carried
 * onto the import correctly — it would bring back what the import left out,
 * or undo what it changed. Anything pending when the import lands was an edit
 * to the old backlog and goes with it.
 *
 * **A delete is final, and takes only the thing deleted.** It writes one
 * tombstone; whatever sits beneath is gone with it by ancestry (`isGone`).
 * Tombstoning the subtree too meant stamping what this tab believed was
 * underneath, which another tab could have just changed. A tombstone beats any
 * live copy, here and on disk (`outranks`), so a delete that races a rename
 * still lands, and an edit from a tab that had not heard of it cannot undo it.
 * Nor can a move: nothing gone may be edited here, and the disk refuses to
 * move a record out of a subtree it already holds as deleted, handing back
 * its own copy, which this tab then takes even though it is the older one,
 * and the tombstone that refused it, so this tab learns of the delete too.
 *
 * **An import elsewhere voids this tab's unsaved work.** A broadcast from a
 * newer generation, or a write that comes back `superseded`, drops everything
 * pending and reloads from disk: those edits were made to a backlog that no
 * longer exists. A notice no newer than what this tab already holds changes
 * nothing.
 */

import { create } from 'zustand'

import {
  archive,
  canParent,
  complete,
  drop,
  isGone,
  isLive,
  newArea,
  newItem,
  nextOrder,
  nextVersion,
  outranks,
  reopen,
  unarchive,
  type Area,
  type Item,
  type ItemKind,
  type ParentKind,
} from '@/domain/tasks'
import type { Ms } from '@/domain/types'
import { newId } from './ids'
import { useStorageHealth } from './storageHealth'
import { openTaskDb, type BacklogContents, type TaskDb, type WriteResult } from './taskDb'

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
   * Delete the area, and with it everything beneath it — `deleteItem` one
   * level up. Only the area is written; the rest goes by ancestry.
   */
  deleteArea: (id: string) => void

  /*
   * The item verbs work on epics, outcomes and tasks alike: they are one shape
   * with a `kind`, and finishing an epic is the same act as finishing a task.
   * None of them touches an item's children: an epic that is done, dropped or
   * archived hides its subtree by ancestry (`isInActiveTree`), so bringing it
   * back restores everything exactly, and a deleted one takes its subtree with
   * it the same way (`isGone`), for good.
   */

  /**
   * A new open item under an area or another item. Returns its id, or null when
   * the title is blank or the parent cannot hold that kind (`canParent`).
   */
  addItem: (input: { kind: ItemKind; title: string; parentId: string }) => string | null
  renameItem: (id: string, title: string) => void
  /** Ignored when the new parent cannot hold this kind, or lies inside it. */
  moveItem: (id: string, parentId: string) => void
  completeItem: (id: string) => void
  dropItem: (id: string) => void
  reopenItem: (id: string) => void
  archiveItem: (id: string) => void
  unarchiveItem: (id: string) => void
  /**
   * Delete the item, and with it everything beneath it.
   *
   * Only the item is written. Its subtree goes by ancestry (`isGone`), so what
   * is deleted is decided by the backlog as it stands, in every tab, rather
   * than by what this tab believed was underneath at the moment of the click.
   */
  deleteItem: (id: string) => void

  /**
   * Replace the whole backlog, from an import. Resolves once the disk holds it
   * and this tab shows it; rejects, having changed nothing, when the disk
   * refuses it. Every edit is refused until it settles. Without a database at
   * all the backlog only ever lives in memory, so the import is taken there and
   * the warning stays up.
   */
  replaceAll: (contents: BacklogContents) => Promise<void>
}

/** What tabs tell each other. Both carry the generation the sender is on. */
type Message =
  | { type: 'changed'; generation: number; areas: Area[]; items: Item[] }
  | { type: 'replaced'; generation: number }

let db: Promise<TaskDb> | null = null
let channel: BroadcastChannel | null = null
const pending = { areas: new Map<string, Area>(), items: new Map<string, Item>() }
/** The disk's generation as this tab last saw it. See `taskDb.ts`. */
let generation = 0
/** False until the first read has set `generation`; nothing flushes before. */
let ready = false
/** Every job in this tab, one after another. Never rejects. */
let queue: Promise<unknown> = Promise.resolve()
/** Imports asked for and not yet settled. Edits are refused while any are. */
let importsInFlight = 0
/**
 * True once the database has failed to open. Nothing this tab holds can then
 * be saved by it, whatever arrives from tabs that can, so the warning stays up
 * for as long as the tab is open.
 */
let diskless = false

const importing = () => importsInFlight > 0

export const useTasks = create<TaskStore>()((set, get) => {
  const putArea = (area: Area) => {
    set((s) => ({ areas: upsert(s.areas, area) }))
    save({ areas: [area] })
  }
  const putItem = (item: Item) => {
    set((s) => ({ items: upsert(s.items, item) }))
    save({ items: [item] })
  }
  // Both refuse an edit with no version to give it (`nextVersion`), before
  // anything changes, rather than write a record the importer would drop.
  const editArea = (id: string, edit: (area: Area, at: Ms) => Area | null) => {
    if (importing()) return
    const area = get().areas.find((a) => a.id === id)
    if (!area || !isLive(area)) return
    const at = Date.now()
    const version = nextVersion(area.updatedAt, at)
    if (version === null) return
    const next = edit(area, at)
    if (next) putArea({ ...next, updatedAt: version })
  }
  // Refused for anything deleted by ancestry as well as by its own tombstone:
  // moving a task out of a deleted epic would otherwise bring it back.
  const editItem = (id: string, edit: (item: Item, at: Ms) => Item | null) => {
    if (importing()) return
    const { items, areas } = get()
    const item = items.find((i) => i.id === id)
    if (!item || isGone(id, items, areas)) return
    const at = Date.now()
    const version = nextVersion(item.updatedAt, at)
    if (version === null) return
    const next = edit(item, at)
    if (next) putItem({ ...next, updatedAt: version })
  }

  return {
    hydrated: false,
    areas: [],
    items: [],

    addArea: (name) => {
      if (name.trim() === '' || importing()) return null
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

    deleteArea: (id) => editArea(id, (area, at) => ({ ...area, deletedAt: at })),

    addItem: ({ kind, title, parentId }) => {
      if (importing()) return null
      const { areas, items } = get()
      const parent = parentKindOf(parentId, areas, items)
      if (title.trim() === '' || parent === null || !canParent(kind, parent)) return null
      const id = newId()
      const siblings = items.filter((i) => i.parentId === parentId)
      putItem(newItem({ id, kind, title, parentId, order: nextOrder(siblings) }, Date.now()))
      return id
    },

    renameItem: (id, title) =>
      editItem(id, (item, at) =>
        title.trim() === '' ? null : { ...item, title: title.trim(), updatedAt: at },
      ),

    moveItem: (id, parentId) =>
      editItem(id, (item, at) => {
        const { areas, items } = get()
        const parent = parentKindOf(parentId, areas, items)
        if (parent === null || !canParent(item.kind, parent)) return null
        if (parentId === item.parentId || liesWithin(parentId, item.id, items)) return null
        const siblings = items.filter((i) => i.parentId === parentId)
        return { ...item, parentId, order: nextOrder(siblings), updatedAt: at }
      }),

    completeItem: (id) =>
      editItem(id, (item, at) => (item.status === 'done' ? null : complete(item, at))),
    dropItem: (id) =>
      editItem(id, (item, at) => (item.status === 'dropped' ? null : drop(item, at))),
    reopenItem: (id) =>
      editItem(id, (item, at) => (item.status === 'open' ? null : reopen(item, at))),
    archiveItem: (id) =>
      editItem(id, (item, at) => (item.archivedAt !== undefined ? null : archive(item, at))),
    unarchiveItem: (id) =>
      editItem(id, (item, at) => (item.archivedAt === undefined ? null : unarchive(item, at))),

    deleteItem: (id) => editItem(id, (item, at) => ({ ...item, deletedAt: at })),

    replaceAll: (contents) => {
      // Raised now, not when the job's turn comes: from this moment an edit
      // would be to the backlog the import is about to replace.
      importsInFlight += 1
      return schedule(() => replace(contents)).finally(() => {
        importsInFlight -= 1
      })
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
  // Attached now so a rejection is never unhandled; the jobs re-await it.
  db.catch(() => undefined)
  // Listening starts before the first read, so a replacement made by another
  // tab while this one loads is heard rather than missed. Every message is
  // judged as a queued job, so one heard now is judged after this load,
  // against the generation the load actually read.
  listen()

  // A queued job itself, for that reason: nothing this tab hears or does while
  // loading can act on the disk until the load has said what is there.
  await schedule(load)

  // Best effort, and only asked once there is something worth keeping. Without
  // it some browsers clear an uninstalled site's data after a quiet week, and
  // losing a backlog would cost far more trust than losing a day's log.
  void globalThis.navigator?.storage?.persist?.().catch(() => undefined)
}

/**
 * Settles once the backlog has been read, or has given up on the disk and
 * gone to memory. For anything that must not mistake the empty arrays this
 * store starts with for an empty backlog — an export above all, which would
 * write them down as one, and an import of that file would then delete
 * everything saved. Independent of when `hydrateTasks` is called.
 */
export function whenHydrated(): Promise<void> {
  if (useTasks.getState().hydrated) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = useTasks.subscribe((state) => {
      if (!state.hydrated) return
      stop()
      resolve()
    })
  })
}

async function load(): Promise<void> {
  let open: TaskDb | null = null
  let stored: BacklogContents = { areas: [], items: [] }
  try {
    open = await db!
  } catch {
    diskless = true
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
  }
  if (open) {
    try {
      const read = await open.readAll()
      stored = { areas: read.areas, items: read.items }
      generation = read.generation
    } catch {
      useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
    }
  }

  if (stored.areas.length === 0 && useTasks.getState().areas.length === 0) {
    const at = Date.now()
    const seeds = SEED_AREAS.map((name, order) => newArea(newId(), name, order, at))
    let landed = false
    if (open) {
      // One transaction decides whether to seed and reads what is there after,
      // so a second tab opening the same empty database a moment later finds
      // these instead of adding its own — and a tab that finds another tab's
      // import instead takes all of it, items and generation included, rather
      // than its areas beside the empty items read a moment earlier.
      try {
        const snapshot = await open.seedIfEmpty(seeds)
        stored = { areas: snapshot.areas, items: snapshot.items }
        generation = snapshot.generation
        landed = true
      } catch {
        useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
      }
    }
    if (!landed) {
      stored = { areas: seeds, items: stored.items }
      for (const seed of seeds) pending.areas.set(seed.id, seed)
    }
  }

  // Composed only now, after the last await, from memory as it is now: anything
  // made before the read finished is merged in, not overwritten. An import asked
  // for meanwhile is a job queued behind this one, so it cannot be here yet.
  const memory = useTasks.getState()
  useTasks.setState({
    areas: merge(stored.areas, memory.areas, 'base'),
    items: merge(stored.items, memory.items, 'base'),
    hydrated: true,
  })
  ready = true
  if (pending.areas.size > 0 || pending.items.size > 0) void schedule(flush)
}

/** Close the database and the channel. For tests, which open one per case. */
export function closeTasks(): void {
  channel?.close()
  channel = null
  void db?.then((open) => open.close()).catch(() => undefined)
  db = null
  ready = false
}

/** Record these changes as owed to the disk, and flush when this tab's turn comes. */
function save(changes: Partial<BacklogContents>): void {
  for (const area of changes.areas ?? []) pending.areas.set(area.id, area)
  for (const item of changes.items ?? []) pending.items.set(item.id, item)
  void schedule(flush)
}

/**
 * Run `work` after every job already queued in this tab, whatever happened to
 * them. The returned promise settles as `work` does — only an import rejects,
 * for its caller to report — while the queue itself carries on regardless.
 */
function schedule<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work)
  queue = run.catch(() => undefined)
  return run
}

/**
 * Send every pending record to the disk, in one write.
 *
 * Pending is keyed by id, so a record edited twice while the disk is refusing
 * is written once, in its latest form. Only records still identical to what was
 * sent are removed from pending afterwards — one edited again while this write
 * was in flight has to go out again.
 */
async function flush(): Promise<void> {
  if (!db || !ready) return
  let open: TaskDb
  try {
    open = await db
  } catch {
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
    return
  }

  const batch = { areas: [...pending.areas.values()], items: [...pending.items.values()] }
  if (batch.areas.length === 0 && batch.items.length === 0) return

  let result: WriteResult
  try {
    result = await open.write(batch, generation)
  } catch {
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
    return
  }

  if (result.kind === 'superseded') {
    // Another tab replaced the backlog after this one last read it. These
    // edits were made to a backlog that no longer exists.
    await reload(open)
    return
  }

  for (const area of batch.areas) {
    if (pending.areas.get(area.id) === area) pending.areas.delete(area.id)
  }
  for (const item of batch.items) {
    if (pending.items.get(item.id) === item) pending.items.delete(item.id)
  }
  // The disk kept its own copies of these. Believe it, and stop owing ours.
  // Usually its copy is newer and would win anyway; a move refused for
  // leaving a deleted subtree hands back an *older* one, which version order
  // alone would let this tab's refused copy outrank — so where memory still
  // holds exactly what was sent, the disk's copy replaces it outright.
  const sent = new Map<string, Area | Item>([...batch.areas, ...batch.items].map((r) => [r.id, r]))
  const theDisks = <T extends Area | Item>(list: readonly T[], kept: readonly T[]): T[] => {
    const byId = new Map(kept.map((r) => [r.id, r]))
    return list.map((r) => (byId.has(r.id) && sent.get(r.id) === r ? byId.get(r.id)! : r))
  }
  useTasks.setState((s) => ({
    areas: theDisks(s.areas, result.stale.areas),
    items: theDisks(s.items, result.stale.items),
  }))
  adoptNewer(result.stale)
  if (pending.areas.size === 0 && pending.items.size === 0) {
    useStorageHealth.getState().noteSuccess('tasks')
  }

  const staleIds = new Set([...result.stale.areas, ...result.stale.items].map((r) => r.id))
  channel?.postMessage({
    type: 'changed',
    generation,
    areas: batch.areas.filter((a) => !staleIds.has(a.id)),
    items: batch.items.filter((i) => !staleIds.has(i.id)),
  } satisfies Message)
}

/**
 * Replace the backlog with an import: the disk first, then memory, then the
 * other tabs. A refusal from the disk rejects before anything else has
 * changed — memory, pending and the warning are exactly as they were, and the
 * backlog carries on as if the import had never been asked for.
 */
async function replace(contents: BacklogContents): Promise<void> {
  if (!db) throw new Error('The task store has not loaded.')
  let open: TaskDb
  try {
    open = await db
  } catch {
    // No database at all, so the backlog only ever lives in memory, and the
    // import is taken there like every other edit. `diskless` keeps the
    // warning up over it: pending records could not, since a newer copy of
    // each from another tab would clear them without saving what the import
    // left out.
    diskless = true
    pending.areas.clear()
    pending.items.clear()
    useTasks.setState({ areas: contents.areas, items: contents.items })
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
    return
  }

  generation = await open.replaceAll(contents)
  // Edits have been refused since the import was asked for, so everything
  // still pending was an edit to the backlog it replaced.
  pending.areas.clear()
  pending.items.clear()
  useTasks.setState({ areas: contents.areas, items: contents.items })
  useStorageHealth.getState().noteSuccess('tasks')
  channel?.postMessage({ type: 'replaced', generation } satisfies Message)
}

/**
 * Take the disk's backlog as this tab's, dropping everything owed. Used when the
 * backlog was replaced elsewhere: what was pending belonged to the old one.
 */
async function reload(open: TaskDb): Promise<void> {
  try {
    const read = await open.readAll()
    generation = read.generation
    pending.areas.clear()
    pending.items.clear()
    useTasks.setState({ areas: read.areas, items: read.items })
    useStorageHealth.getState().noteSuccess('tasks')
  } catch {
    useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
  }
}

/**
 * Accept records known to be newer than this tab's — from the disk or from
 * another tab — and drop any pending copy they make obsolete.
 *
 * Dropping is the half that matters. Adopting alone left the older copy queued,
 * so this tab's next unrelated write sent it out again over the newer one.
 *
 * A tie goes to the incoming copy. Everything arriving here is what reached the
 * disk, and the disk keeps the first of two different copies at the same
 * version and refuses the second (`taskDb.ts`) — so a copy at this version that
 * reached the disk is the one it holds, and this tab's, if different, is the
 * one it refused or will refuse. Equal versions happen in use: two tabs editing
 * a record whose version is ahead of the clock both stamp it one past it.
 *
 * Adopting the same records twice changes nothing the second time: anything
 * edited in between was stamped past them, so it is kept.
 */
function adoptNewer(incoming: BacklogContents): void {
  if (incoming.areas.length === 0 && incoming.items.length === 0) return
  for (const area of incoming.areas) {
    const owed = pending.areas.get(area.id)
    if (owed && !outranks(owed, area)) pending.areas.delete(area.id)
  }
  for (const item of incoming.items) {
    const owed = pending.items.get(item.id)
    if (owed && !outranks(owed, item)) pending.items.delete(item.id)
  }
  useTasks.setState((s) => ({
    areas: merge(s.areas, incoming.areas, 'incoming'),
    items: merge(s.items, incoming.items, 'incoming'),
  }))
}

function listen(): void {
  // Without BroadcastChannel this tab hears nothing from others and shows what
  // it loaded until reloaded. Two tabs at once are supported only where it
  // exists; the disk's rules still keep such a tab from undoing anything.
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data
    // Another tab's write at this tab's generation is adopted at once, so an
    // edit made while the message waits its turn builds on that tab's copy
    // rather than on the one it replaced — otherwise the edit would either lose
    // to it or undo it. Safe to do outside the queue: a reload or import in
    // flight replaces memory after this anyway, and the queued turn below
    // judges the message again against whatever that left.
    if (message.type === 'changed' && ready && message.generation === generation) adopt(message)
    void schedule(() => receive(message))
  }
}

/** Another tab's message, judged in its turn against the generation this tab is on. */
async function receive(message: Message): Promise<void> {
  if (!db) return
  if (message.generation > generation) {
    // A replacement this tab has not caught up with — announced, or implied by
    // a write made on top of it. Whatever was pending here belonged to the
    // backlog it replaced.
    try {
      await reload(await db)
    } catch {
      useStorageHealth.getState().noteFailure(Date.now(), 'tasks')
    }
    return
  }
  // A replacement this tab already holds, or has since moved past; or a write
  // from a tab on an older backlog, which finds out when its write comes back
  // superseded.
  if (message.type === 'replaced' || message.generation < generation) return
  adopt(message)
}

function adopt(message: Extract<Message, { type: 'changed' }>): void {
  adoptNewer({ areas: message.areas, items: message.items })
  if (!diskless && pending.areas.size === 0 && pending.items.size === 0) {
    useStorageHealth.getState().noteSuccess('tasks')
  }
}

/**
 * What kind of thing `id` names, or null if it names nothing live — a
 * deleted area, or an item deleted itself or with something above it, can
 * take nothing new.
 */
function parentKindOf(
  id: string,
  areas: readonly Area[],
  items: readonly Item[],
): ParentKind | null {
  const area = areas.find((a) => a.id === id)
  if (area) return isLive(area) ? 'area' : null
  const item = items.find((i) => i.id === id)
  return item && !isGone(id, items, areas) ? item.kind : null
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

/**
 * Union by id, keeping whichever copy of a record in both `outranks` the
 * other, and on a tie the one from the side named. Another tab's write wins a
 * tie, being what reached the disk (`adoptNewer`); the load keeps the disk's
 * copy over an edit made before it finished at the same version.
 */
function merge<T extends { id: string; updatedAt: Ms; deletedAt?: Ms }>(
  base: readonly T[],
  incoming: readonly T[],
  ties: 'base' | 'incoming',
): T[] {
  const byId = new Map(base.map((r) => [r.id, r]))
  for (const record of incoming) {
    const existing = byId.get(record.id)
    const keep = existing && (outranks(existing, record) || (ties === 'base' && !outranks(record, existing)))
    byId.set(record.id, keep ? existing : record)
  }
  return [...byId.values()]
}
