/**
 * What one tab owes the disk: the backlog's edits made in memory and not yet
 * written, and the decisions among them that must be judged whole.
 *
 * Temporary bookkeeping for `tasks.ts`, never stored and never shown. The
 * backlog itself stays what it is, current state edited in place; this only
 * remembers what has not reached the disk yet, and what to do with the disk's
 * answer. No clock, no ids, no React and no IndexedDB, so its rules are tested
 * on their own (`owed.test.ts`).
 *
 * **One copy per record.** Every record owed is owed once, in its latest
 * form, whatever asked for it — a rename, a tick, a drop between two rows,
 * the task a Later was filed as. Groups that must be judged whole name their
 * records by id and hold no copies of their own:
 *
 * - **A renumbering** is the placements one or more drops decided since the
 *   last write: for each record, the order it was given and, for the record
 *   that was moved, its parent — and where it stood before, which is where it
 *   goes back to when the disk refuses the renumbering and has no copy of its
 *   own to go back to. The placement is laid over the record's latest copy
 *   when the write is made, so an edit made since the drop — renamed, ticked,
 *   built on another tab's copy — goes with it and is judged with it.
 * - **A filing** is a Later made a task: the task's id, the Later's, and the
 *   Later as it waited, which is what stays if the disk refuses it.
 *
 * This replaced three exclusive places a record could be owed in — plain
 * edits, the renumbering, a filing's task — each holding whole copies. Moving
 * a copy from one to another lost which act had changed which field: a
 * refused renumbering put a rename back along with the order it had refused,
 * a record never written was dropped with it, and a filed task taken into a
 * renumbering was written twice in one transaction, the older copy last.
 *
 * **A refused renumbering puts back only what it placed.** Each member takes
 * its order, and its parent, from the disk's copy — or from where it stood
 * before the drop, when the disk has never had it — and keeps every other
 * field. What is then still different from the disk stays owed, as an edit of
 * its own. Where the disk's copy is newer than ours, it simply wins.
 *
 * **A placed record stays owed whatever another tab says**, so its
 * renumbering is refused whole rather than landing without it, and the screen
 * keeps the order the drop gave it until the disk has answered.
 *
 * Released by identity: a copy, placement or filing still the very object
 * that was sent is settled by the disk's answer, and one replaced since —
 * edited while the write was on its way — is still owed, for the next.
 */

import type { Later } from '@/domain/later'
import { outranks, type Area, type Item } from '@/domain/tasks'
import {
  beats,
  sameValue,
  type BacklogContents,
  type Changes,
  type Filing,
  type Renumbering,
  type WriteResult,
} from './taskDb'

/** Where a record stands among its siblings: its order, and an item's parent. */
export type Position = { order: number; parentId?: string }

/** What a renumbering decided for one record, and where it stood before. */
export type Placement = Position & { from: Position }

/** A Later being made a task, by id: see the header. */
export type OwedFiling = { taskId: string; waiting: Later; needsRoom: boolean }

type Placed = Area | Item
type PlacedKind = 'areas' | 'items'

/** One write's worth of what was owed, as it was sent, for `settle` to release. */
export type Sent = {
  changes: Changes
  /** The owed copy of every record sent, by kind and id: the objects released by identity. */
  records: { areas: Map<string, Area>; items: Map<string, Item>; later: Map<string, Later> }
  /** The placements sent in the renumbering, which settles them. */
  placements: { areas: Map<string, Placement>; items: Map<string, Placement> }
  /** The filings sent, by the Later's id. */
  filings: Map<string, OwedFiling>
}

/** What the disk's answer means for memory, and for the other tabs. */
export type Settled = {
  memory: BacklogContents
  /** What landed, for the other tabs. */
  broadcast: BacklogContents
  /** Whether something refused is owed again, as an edit of its own, and wants a write. */
  again: boolean
}

export type Owed = ReturnType<typeof createOwed>

export function createOwed() {
  const records = {
    areas: new Map<string, Area>(),
    items: new Map<string, Item>(),
    later: new Map<string, Later>(),
  }
  const placements = {
    areas: new Map<string, Placement>(),
    items: new Map<string, Placement>(),
  }
  const filings = new Map<string, OwedFiling>()

  const placedIn = (kind: PlacedKind) => placements[kind]
  const filedTasks = () => new Set([...filings.values()].map((f) => f.taskId))

  /**
   * Owe a record as it is now. A placed record moved again — dropped a second
   * time where there was room, or moved to another parent — takes its
   * placement with it, so the renumbering never puts it back where it was
   * dropped before; it keeps where it stood before the first.
   */
  function owe(kind: 'areas', record: Area): void
  function owe(kind: 'items', record: Item): void
  function owe(kind: 'later', record: Later): void
  function owe(kind: keyof typeof records, record: Area | Item | Later): void {
    ;(records[kind] as Map<string, typeof record>).set(record.id, record)
    if (kind === 'later') return
    const placement = placedIn(kind).get(record.id)
    const now = positionOf(record as Placed)
    if (placement && !samePosition(placement, now)) {
      placedIn(kind).set(record.id, { ...now, from: placement.from })
    }
  }

  /**
   * Owe records a renumbering wrote, each placed where it is now. `before` is
   * where each stood before this drop; a record already placed keeps where it
   * stood before the first.
   */
  function place<T extends Placed>(
    kind: PlacedKind,
    written: readonly T[],
    before: ReadonlyMap<string, Position>,
  ): void {
    for (const record of written) {
      ;(records[kind] as Map<string, Placed>).set(record.id, record)
      const from = placedIn(kind).get(record.id)?.from ?? before.get(record.id) ?? positionOf(record)
      placedIn(kind).set(record.id, { ...positionOf(record), from })
    }
  }

  /**
   * Owe a filing: the new task, the Later's tombstone, and the Later as it
   * waited. `needsRoom` when its task's order was chosen in room a
   * renumbering makes, so it lands only if that does.
   */
  function file(task: Item, gone: Later, waiting: Later, needsRoom: boolean): void {
    records.items.set(task.id, task)
    records.later.set(gone.id, gone)
    filings.set(gone.id, { taskId: task.id, waiting, needsRoom })
  }

  const isEmpty = () =>
    records.areas.size === 0 &&
    records.items.size === 0 &&
    records.later.size === 0 &&
    placements.areas.size === 0 &&
    placements.items.size === 0 &&
    filings.size === 0

  function clear(): void {
    records.areas.clear()
    records.items.clear()
    records.later.clear()
    placements.areas.clear()
    placements.items.clear()
    filings.clear()
  }

  /**
   * Everything owed, as one write: plain records, filings and a renumbering,
   * each record once. Null when nothing is owed.
   *
   * A filed task goes inside its filing only, with any placement laid over
   * it, and lands only with the renumbering when it has one: its order was
   * chosen among siblings the renumbering moves. Sent in the renumbering as
   * well, it was two copies of one record in one transaction.
   */
  function batch(): Sent | null {
    if (isEmpty()) return null
    const sent: Sent = {
      changes: {},
      records: { areas: new Map(), items: new Map(), later: new Map() },
      placements: { areas: new Map(placements.areas), items: new Map(placements.items) },
      filings: new Map(filings),
    }
    const filed = filedTasks()

    const outgoing: Filing[] = []
    for (const [laterId, filing] of filings) {
      const task = records.items.get(filing.taskId)
      const gone = records.later.get(laterId)
      // Both are owed from the moment it is filed and released only with it;
      // a filing without them is nothing to write, and would be owed forever.
      if (!task || !gone) {
        filings.delete(laterId)
        continue
      }
      const placement = placements.items.get(filing.taskId)
      sent.records.items.set(task.id, task)
      sent.records.later.set(laterId, gone)
      outgoing.push({
        task: placement ? at(task, placement) : task,
        later: gone,
        waiting: filing.waiting,
        ...(filing.needsRoom || placement ? { needsRoom: true } : {}),
      })
    }

    const renumbering: Renumbering = { areas: [], items: [] }
    for (const [id, placement] of placements.areas) {
      const area = records.areas.get(id)
      if (!area) {
        placements.areas.delete(id)
        continue
      }
      sent.records.areas.set(id, area)
      renumbering.areas.push(at(area, placement))
    }
    for (const [id, placement] of placements.items) {
      const item = records.items.get(id)
      if (!item) {
        placements.items.delete(id)
        continue
      }
      if (filed.has(id)) continue
      sent.records.items.set(id, item)
      renumbering.items.push(at(item, placement))
    }

    const plain: BacklogContents = { areas: [], items: [], later: [] }
    for (const [id, area] of records.areas) {
      if (placements.areas.has(id)) continue
      sent.records.areas.set(id, area)
      plain.areas.push(area)
    }
    for (const [id, item] of records.items) {
      if (placements.items.has(id) || filed.has(id)) continue
      sent.records.items.set(id, item)
      plain.items.push(item)
    }
    for (const [id, later] of records.later) {
      if (filings.has(id)) continue
      sent.records.later.set(id, later)
      plain.later.push(later)
    }

    const renumbers = renumbering.areas.length + renumbering.items.length > 0
    sent.changes = { ...plain, filings: outgoing, ...(renumbers ? { renumbering } : {}) }
    return sent
  }

  /**
   * Settle a write the disk took — `written`, not `superseded` — against
   * memory as it is now: release what was settled, put back what was
   * refused, and say what landed. See the header for the rules.
   */
  function settle(
    sent: Sent,
    result: Extract<WriteResult, { kind: 'written' }>,
    memory: BacklogContents,
  ): Settled {
    const owedNow = {
      areas: (id: string) => records.areas.get(id) ?? sent.records.areas.get(id),
      items: (id: string) => records.items.get(id) ?? sent.records.items.get(id),
    }
    // The newer placement of a member placed again since it was sent, if any.
    const placedSince = (kind: PlacedKind, id: string) => {
      const now = placements[kind].get(id)
      return now !== undefined && now !== sent.placements[kind].get(id)
    }
    // Released whichever way it went: landed, or put back below from the
    // disk's answer. Anything replaced since is still owed, in its turn.
    for (const kind of ['areas', 'items', 'later'] as const) {
      const owed = records[kind] as Map<string, unknown>
      for (const [id, copy] of sent.records[kind] as Map<string, unknown>) {
        if (owed.get(id) === copy) owed.delete(id)
      }
    }
    for (const kind of ['areas', 'items'] as const) {
      for (const [id, placement] of sent.placements[kind]) {
        if (placements[kind].get(id) === placement) placements[kind].delete(id)
      }
    }
    for (const [laterId, filing] of sent.filings) {
      if (filings.get(laterId) === filing) filings.delete(laterId)
    }

    let { areas, items, later } = memory
    let again = false

    // A filing the disk refused never happened: the task goes, with any edit
    // owed to it since, and the line is waiting again — as the disk has it
    // when the disk kept its own, as it was filed when the disk took that.
    const refused = new Set(result.refused)
    const sentFilings = [...sent.filings]
    const undone = sentFilings.filter(([laterId]) => refused.has(laterId))
    const landed = sentFilings.filter(([laterId]) => !refused.has(laterId))
    const disksLater = new Map(result.stale.later.map((l) => [l.id, l]))
    const keptWaiting = undone
      .filter(([laterId]) => !disksLater.has(laterId))
      .map(([, filing]) => filing.waiting)
    if (undone.length > 0) {
      const tasks = new Set(undone.map(([, filing]) => filing.taskId))
      for (const id of tasks) {
        records.items.delete(id)
        placements.items.delete(id)
      }
      for (const [laterId] of undone) records.later.delete(laterId)
      items = items.filter((i) => !tasks.has(i.id))
      later = undone.reduce(
        (list, [laterId, filing]) => upsert(list, disksLater.get(laterId) ?? filing.waiting),
        later,
      )
    }

    // The disk kept its own copies of these plain records. Believe it where
    // memory still holds exactly what was sent. Usually its copy is newer and
    // would win anyway; a move refused for leaving a deleted subtree hands
    // back an *older* one, which version order alone would let the refused
    // copy outrank.
    const plain = sent.changes
    const sentPlain = new Map<string, unknown>(
      [...(plain.areas ?? []), ...(plain.items ?? []), ...(plain.later ?? [])].map((r) => [r.id, r]),
    )
    const theDisks = <T extends { id: string }>(list: readonly T[], kept: readonly T[]): T[] => {
      const byId = new Map(kept.map((r) => [r.id, r]))
      return list.map((r) => (byId.has(r.id) && sentPlain.get(r.id) === r ? byId.get(r.id)! : r))
    }
    areas = theDisks(areas, result.stale.areas)
    items = theDisks(items, result.stale.items)
    later = theDisks(later, result.stale.later)

    // A refused renumbering puts back only what it placed, member by member.
    if (result.renumberingRefused === true) {
      const onDisk = new Map<string, Placed>(
        [...result.stale.areas, ...result.stale.items].map((r) => [r.id, r]),
      )
      const putBack = <T extends Placed>(kind: PlacedKind, list: T[]): T[] => {
        let next = list
        for (const [id, placement] of sent.placements[kind]) {
          // Placed again since, it is owed in that renumbering now.
          if (placedSince(kind, id)) continue
          const ours = owedNow[kind](id) as T | undefined
          if (!ours) continue
          const disk = onDisk.get(id) as T | undefined
          const shown = next.find((r) => r.id === id)
          if (disk && beats(disk, ours)) {
            // Newer on disk, or deleted there: ours is out of date.
            ;(records[kind] as Map<string, T>).delete(id)
            const keep = shown && outranks(shown, disk) ? shown : disk
            next = upsert(next, keep)
            continue
          }
          const restored = at(ours, disk ? positionOf(disk) : placement.from)
          // Compared apart from the version the renumbering stamped on it:
          // a member that was only placed has nothing left to say.
          if (disk && sameValue({ ...restored, updatedAt: disk.updatedAt }, disk)) {
            ;(records[kind] as Map<string, T>).delete(id)
            next = upsert(next, disk)
          } else {
            ;(records[kind] as Map<string, T>).set(id, restored)
            next = upsert(next, restored)
            again = true
          }
        }
        return next
      }
      areas = putBack('areas', areas)
      items = putBack('items', items)
    }

    const merged = adopt(result.stale, { areas, items, later })

    const staleIds = new Set(
      [...result.stale.areas, ...result.stale.items, ...result.stale.later].map((r) => r.id),
    )
    const renumbered = result.renumberingRefused === true ? undefined : plain.renumbering
    const broadcast: BacklogContents = {
      areas: [...(plain.areas ?? []).filter((a) => !staleIds.has(a.id)), ...(renumbered?.areas ?? [])],
      items: [
        ...(plain.items ?? []).filter((i) => !staleIds.has(i.id)),
        ...(renumbered?.items ?? []),
        ...(plain.filings ?? [])
          .filter((f) => !refused.has(f.later.id))
          .map((f) => f.task),
      ],
      later: [
        ...(plain.later ?? []).filter((l) => !staleIds.has(l.id)),
        ...landed.map(([laterId]) => sent.records.later.get(laterId)!),
        ...keptWaiting,
      ],
    }
    return { memory: merged, broadcast, again }
  }

  /**
   * Take records known to be newer than this tab's — from the disk or from
   * another tab — and stop owing any copy they make obsolete.
   *
   * Dropping is the half that matters. Adopting alone left the older copy
   * owed, so this tab's next unrelated write sent it out again over the newer
   * one. A tie goes to the incoming copy: everything arriving here is what
   * reached the disk, and the disk keeps the first of two different copies at
   * one version (`beats`), so a copy at this version that reached the disk is
   * the one it holds.
   *
   * A placed record is not let go, though the newer copy is shown with the
   * placement laid over it: the renumbering is one decision, and with one
   * member dropped here the rest would land without it. Sent still owed, it
   * is refused whole by the disk, which has the newer copy, unless it was
   * edited again here on top of that copy — and then it lands whole. Nor is
   * a record a filing owes, which goes with its filing.
   */
  function adopt(incoming: BacklogContents, memory: BacklogContents): BacklogContents {
    if (incoming.areas.length === 0 && incoming.items.length === 0 && incoming.later.length === 0) {
      return memory
    }
    const filed = filedTasks()
    for (const area of incoming.areas) {
      const owed = records.areas.get(area.id)
      if (owed && !placements.areas.has(area.id) && !outranks(owed, area)) {
        records.areas.delete(area.id)
      }
    }
    for (const item of incoming.items) {
      const owed = records.items.get(item.id)
      if (owed && !placements.items.has(item.id) && !filed.has(item.id) && !outranks(owed, item)) {
        records.items.delete(item.id)
      }
    }
    for (const record of incoming.later) {
      const owed = records.later.get(record.id)
      if (owed && !filings.has(record.id) && !outranks(owed, record)) records.later.delete(record.id)
    }
    const placedOver = <T extends Placed>(kind: PlacedKind, list: T[], heard: readonly T[]): T[] => {
      const ids = new Set(heard.map((r) => r.id))
      return list.map((r) => {
        const placement = placements[kind].get(r.id)
        return placement && ids.has(r.id) ? at(r, placement) : r
      })
    }
    return {
      areas: placedOver('areas', merge(memory.areas, incoming.areas, 'incoming'), incoming.areas),
      items: placedOver('items', merge(memory.items, incoming.items, 'incoming'), incoming.items),
      later: merge(memory.later, incoming.later, 'incoming'),
    }
  }

  return { owe, place, file, isEmpty, clear, batch, settle, adopt }
}

/** Where a record stands now. */
export const positionOf = (record: Placed): Position =>
  'parentId' in record ? { order: record.order, parentId: record.parentId } : { order: record.order }

const samePosition = (a: Position, b: Position) => a.order === b.order && a.parentId === b.parentId

/** The record at a position: the same object when it already stands there. */
function at<T extends Placed>(record: T, position: Position): T {
  const parentMoves = 'parentId' in record && position.parentId !== undefined && record.parentId !== position.parentId
  if (record.order === position.order && !parentMoves) return record
  return { ...record, order: position.order, ...(parentMoves ? { parentId: position.parentId } : {}) }
}

export const upsert = <T extends { id: string }>(list: readonly T[], record: T): T[] => {
  const index = list.findIndex((r) => r.id === record.id)
  if (index === -1) return [...list, record]
  const next = [...list]
  next[index] = record
  return next
}

/**
 * Union by id, keeping whichever copy of a record in both `outranks` the
 * other, and on a tie the one from the side named. Another tab's write wins a
 * tie, being what reached the disk (`adopt`); the load keeps the disk's copy
 * over an edit made before it finished at the same version.
 */
export function merge<T extends { id: string; updatedAt: number; deletedAt?: number }>(
  base: readonly T[],
  incoming: readonly T[],
  ties: 'base' | 'incoming',
): T[] {
  const byId = new Map(base.map((r) => [r.id, r]))
  for (const record of incoming) {
    const existing = byId.get(record.id)
    const keep =
      existing && (outranks(existing, record) || (ties === 'base' && !outranks(record, existing)))
    byId.set(record.id, keep ? existing : record)
  }
  return [...byId.values()]
}
