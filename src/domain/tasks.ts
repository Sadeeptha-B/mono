/**
 * The backlog: areas of life, and the work items that live under them.
 *
 * This is a different kind of data from everything else in `domain/`. The
 * event log is the day's journal — append-only, replayed on load, reset at
 * midnight. The backlog is the opposite on every count: long-lived, edited in
 * place, and carried from one day to the next. A task written in March is
 * still a task in May, and folding a year of renames and moves out of a log on
 * every boot would be paying for a journal of something nobody wants to read.
 * So tasks are current-state records, kept in their own store, and the log
 * refers to them only by id.
 *
 * The hierarchy is Area → Epic → Outcome → Task, and the middle two are
 * optional. That is the important part. A task has to be cheap to write down,
 * and a system that wants "call Priya" filed three levels deep before it will
 * accept it is a system that stops being used. So a task may sit directly
 * under an area, and the tasks that do are that area's **inbox** — a view, not
 * a container. There is no inbox entity and no "triaged" flag: a one-off that
 * will never belong to an epic and a task that has not been filed yet are the
 * same thing, and both are found in the same place.
 *
 * Areas are a separate type rather than a fourth item kind because they never
 * finish. Work is not something you complete; an epic is. Everything that can
 * be done, dropped or reopened is an `Item`, one shape with a `kind`, so moving
 * and storing them is one code path rather than three.
 *
 * Shaped for sync later without building any of it now: ids are generated on
 * the client, every record carries `updatedAt`, references are by id only, and
 * a deletion is a tombstone rather than a missing row. A record that simply
 * vanished could not tell another copy of the backlog that it was deleted
 * rather than never seen, and history in the event log would be left pointing
 * at nothing.
 *
 * Pure, like everything in this folder: no clock and no ids. `at` and `id` are
 * passed in by the store.
 */

import type { Ms } from './types'

/** Something that never finishes: Work, Personal. */
export type Area = {
  id: string
  name: string
  /** Display order among areas. */
  order: number
  createdAt: Ms
  updatedAt: Ms
  /** Hidden from pickers, kept with everything under it. */
  archivedAt?: Ms
  deletedAt?: Ms
}

export const ITEM_KINDS = ['epic', 'outcome', 'task'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/**
 * `dropped` is its own state rather than a deletion. Deciding not to do
 * something is a decision, and erasing it would lose the one thing worth
 * knowing about the task — the same honesty that records an abandoned block
 * rather than forgetting it.
 */
export const ITEM_STATUSES = ['open', 'done', 'dropped'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export type Item = {
  id: string
  kind: ItemKind
  title: string
  /**
   * An area's id or another item's id. Which kinds may sit under which is
   * `canParent`'s question. The area is never stored on the item: it is found
   * by walking up, so moving an epic moves everything under it with no second
   * write to forget.
   */
  parentId: string
  status: ItemStatus
  /** Display order among siblings. */
  order: number
  createdAt: Ms
  updatedAt: Ms
  /** When it was marked done. Absent while open or dropped. */
  doneAt?: Ms
  /**
   * Put away, not finished and not deleted. Independent of `status`: an epic can
   * be archived half done and come back exactly as it was. Only the top of a
   * subtree is stamped; everything beneath it is hidden by ancestry, so
   * restoring it is one write and leaves no child half-restored.
   */
  archivedAt?: Ms
  deletedAt?: Ms
}

/** What a parent can be, by kind. */
export type ParentKind = 'area' | ItemKind

/**
 * Which kinds may sit under which.
 *
 * Tasks go anywhere, which is what makes the middle of the hierarchy optional.
 * Epics belong to an area, and outcomes to an epic: an outcome is a piece of
 * an epic by definition, and one floating under an area would just be an epic
 * with a smaller name.
 */
export function canParent(child: ItemKind, parent: ParentKind): boolean {
  switch (child) {
    case 'task':
      return parent !== 'task'
    case 'outcome':
      return parent === 'epic'
    case 'epic':
      return parent === 'area'
  }
}

/** Not tombstoned. */
export const isLive = (record: { deletedAt?: Ms }): boolean => record.deletedAt === undefined

/** Areas a picker should offer: live and not archived, in display order. */
export const activeAreas = (areas: readonly Area[]): Area[] =>
  areas.filter((a) => isLive(a) && a.archivedAt === undefined).sort(byOrder)

/** The live items directly under `parentId`, in display order. */
export const childrenOf = (parentId: string, items: readonly Item[]): Item[] =>
  items.filter((i) => i.parentId === parentId && isLive(i)).sort(byOrder)

/**
 * An area's inbox: its open tasks that belong to nothing smaller.
 *
 * Deliberately not a stored list. See the header — it is the same set as "the
 * one-offs in this area", and that is the point.
 */
export const inboxOf = (areaId: string, items: readonly Item[]): Item[] =>
  childrenOf(areaId, items).filter((i) => i.kind === 'task' && i.status === 'open')

/** Every live, open task, wherever it sits. */
export const openTasks = (items: readonly Item[]): Item[] =>
  items.filter((i) => i.kind === 'task' && i.status === 'open' && isLive(i)).sort(byOrder)

/**
 * Every item beneath `id`, at any depth, tombstoned or not, nearest first.
 *
 * Tombstones included because the one caller that needs the whole subtree is
 * deletion, and a child deleted earlier is still part of what is being deleted.
 * Guarded against cycles for the reason `areaOf` is.
 */
export function descendantsOf(id: string, items: readonly Item[]): Item[] {
  const found: Item[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const parent = queue.shift()!
    for (const item of items) {
      if (item.parentId !== parent || seen.has(item.id)) continue
      seen.add(item.id)
      found.push(item)
      queue.push(item.id)
    }
  }
  return found
}

/**
 * Whether an item sits in the working part of the backlog.
 *
 * True when the item and everything above it are live and unarchived, every
 * epic or outcome above it is still open, and its area is active. The item's own
 * status is not asked — a done task inside an open epic is still in the tree,
 * just finished — so callers that want open things check that themselves.
 *
 * This is the whole of "hidden with it". Finishing, dropping or archiving an
 * epic never touches the tasks inside it; they drop out of view because their
 * chain stopped being active, and come back unchanged the moment it is again.
 * A broken chain or a cycle reads as inactive rather than as everywhere.
 */
export function isInActiveTree(
  itemId: string,
  items: readonly Item[],
  areas: readonly Area[],
): boolean {
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const areasById = new Map(areas.map((a) => [a.id, a]))
  const self = itemsById.get(itemId)
  if (!self || !isLive(self) || self.archivedAt !== undefined) return false

  const seen = new Set([itemId])
  let id = self.parentId
  while (!seen.has(id)) {
    seen.add(id)
    const area = areasById.get(id)
    if (area) return isLive(area) && area.archivedAt === undefined
    const item = itemsById.get(id)
    if (!item || !isLive(item) || item.archivedAt !== undefined || item.status !== 'open') {
      return false
    }
    id = item.parentId
  }
  return false
}

/** Open tasks whose whole chain is active: what a block may be for. */
export const activeTasks = (items: readonly Item[], areas: readonly Area[]): Item[] =>
  openTasks(items).filter((t) => isInActiveTree(t.id, items, areas))

/**
 * The names above an item, area first: `['Work', 'Mono auth', 'Login pages']`
 * for a task under that outcome. The item's own title is not included, so a
 * task straight under an area reads as just the area.
 */
export function pathOf(
  itemId: string,
  items: readonly Item[],
  areas: readonly Area[],
): string[] {
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const areasById = new Map(areas.map((a) => [a.id, a]))
  const names: string[] = []
  const seen = new Set([itemId])
  let id = itemsById.get(itemId)?.parentId
  while (id !== undefined && !seen.has(id)) {
    seen.add(id)
    const area = areasById.get(id)
    if (area) return [area.name, ...names]
    const item = itemsById.get(id)
    if (!item) break
    names.unshift(item.title)
    id = item.parentId
  }
  return names
}

/** How a path reads on one line. */
export const PATH_SEPARATOR = ' › '

/** Somewhere a task can be put: an area, an epic or an outcome. */
export type Place = { id: string; kind: ParentKind; label: string; depth: number }

/**
 * Every active place a task can go, in the order the tasks page draws them:
 * each area, then its open epics, each followed by its open outcomes. Labels are
 * full paths, because a select shows one line and "Login pages" alone does not
 * say whose.
 */
export function placesForTasks(items: readonly Item[], areas: readonly Area[]): Place[] {
  const places: Place[] = []
  for (const area of activeAreas(areas)) {
    places.push({ id: area.id, kind: 'area', label: area.name, depth: 0 })
    for (const epic of openContainers(area.id, 'epic', items)) {
      const epicLabel = `${area.name}${PATH_SEPARATOR}${epic.title}`
      places.push({ id: epic.id, kind: 'epic', label: epicLabel, depth: 1 })
      for (const outcome of openContainers(epic.id, 'outcome', items)) {
        places.push({
          id: outcome.id,
          kind: 'outcome',
          label: `${epicLabel}${PATH_SEPARATOR}${outcome.title}`,
          depth: 2,
        })
      }
    }
  }
  return places
}

/** The open, unarchived epics or outcomes directly under a parent. */
export const openContainers = (
  parentId: string,
  kind: 'epic' | 'outcome',
  items: readonly Item[],
): Item[] =>
  childrenOf(parentId, items).filter(
    (i) => i.kind === kind && i.status === 'open' && i.archivedAt === undefined,
  )

/**
 * The area an item ultimately belongs to, or `null` if the chain is broken.
 *
 * Walks parent links rather than reading a stored field. A visited set guards
 * the walk, because records arrive from an import and another tab as well as
 * from this one, and a cycle in data from outside should read as "no area"
 * rather than hang the tab.
 */
export function areaOf(
  itemId: string,
  items: readonly Item[],
  areas: readonly Area[],
): Area | null {
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const areasById = new Map(areas.map((a) => [a.id, a]))
  const seen = new Set<string>()

  let id = itemId
  while (!seen.has(id)) {
    seen.add(id)
    const area = areasById.get(id)
    if (area) return area
    const item = itemsById.get(id)
    if (!item) return null
    id = item.parentId
  }
  return null
}

/** The order a new sibling should take: after everything already there. */
export const nextOrder = (siblings: readonly { order: number }[]): number =>
  siblings.reduce((max, s) => Math.max(max, s.order + 1), 0)

/**
 * The longest purpose a block can carry.
 *
 * The purpose prompt's field enforces it while typing; this is what keeps a
 * purpose *assembled* from task titles inside the same limit, since an input's
 * `maxLength` only constrains what is typed into it, not what it is given.
 */
export const PURPOSE_MAX_LENGTH = 120

/**
 * What a block's purpose says before the user says anything.
 *
 * One task is its own purpose. Several are joined, which is a starting point
 * and not an answer: the prompt still leaves the cursor in the field, because
 * naming the block is the product and an assembled list of titles is the least
 * interesting version of that name. Clipped with an ellipsis rather than cut
 * mid-word without a mark, so a long list reads as shortened rather than as a
 * typo.
 */
export function defaultPurpose(titles: readonly string[]): string {
  const joined = titles
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join(', ')
  if (joined.length <= PURPOSE_MAX_LENGTH) return joined
  return `${joined.slice(0, PURPOSE_MAX_LENGTH - 1).trimEnd()}…`
}

/**
 * The open tasks an outcome still holds, in order: what ticking the outcome
 * picks. Only tasks whose chain is active, so an outcome inside an archived epic
 * holds nothing to pick.
 */
export const tasksOfOutcome = (
  outcomeId: string,
  items: readonly Item[],
  areas: readonly Area[],
): Item[] => activeTasks(items, areas).filter((t) => t.parentId === outcomeId)

/**
 * The names a block's default purpose is made of, in the order things were
 * picked.
 *
 * Each task contributes its title, except that an outcome whose open tasks are
 * all picked contributes its own title once, where its first task was. Ticking
 * "Login pages" is a statement about the outcome, and a purpose reading
 * "Login form, Session cookie, Remember me" says the same thing worse. An
 * outcome only partly picked is not claimed: the user chose some of it, and the
 * purpose says which. Nor is one holding a single task, whose own title is the
 * more specific of the two names for the same work.
 */
export function purposeParts(
  selected: readonly string[],
  items: readonly Item[],
  areas: readonly Area[],
): string[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const picked = new Set(selected)
  const parts: string[] = []
  const claimed = new Set<string>()

  for (const id of selected) {
    const task = byId.get(id)
    if (!task) continue
    const parent = byId.get(task.parentId)
    if (parent?.kind === 'outcome') {
      if (claimed.has(parent.id)) continue
      const whole = tasksOfOutcome(parent.id, items, areas)
      if (whole.length > 1 && whole.every((t) => picked.has(t.id))) {
        claimed.add(parent.id)
        parts.push(parent.title)
        continue
      }
    }
    parts.push(task.title)
  }
  return parts
}

// -----------------------------------------------------------------------------
// Transitions. Each returns a new record stamped with `at`.
// -----------------------------------------------------------------------------

export const newArea = (id: string, name: string, order: number, at: Ms): Area => ({
  id,
  name: name.trim(),
  order,
  createdAt: at,
  updatedAt: at,
})

export const newItem = (
  input: { id: string; kind: ItemKind; title: string; parentId: string; order: number },
  at: Ms,
): Item => ({
  ...input,
  title: input.title.trim(),
  status: 'open',
  createdAt: at,
  updatedAt: at,
})

export const complete = (item: Item, at: Ms): Item => ({
  ...withoutDoneAt(item),
  status: 'done',
  doneAt: at,
  updatedAt: at,
})

export const drop = (item: Item, at: Ms): Item => ({
  ...withoutDoneAt(item),
  status: 'dropped',
  updatedAt: at,
})

export const reopen = (item: Item, at: Ms): Item => ({
  ...withoutDoneAt(item),
  status: 'open',
  updatedAt: at,
})

export const archive = (item: Item, at: Ms): Item => ({ ...item, archivedAt: at, updatedAt: at })

export const unarchive = (item: Item, at: Ms): Item => {
  const { archivedAt, ...rest } = item
  void archivedAt
  return { ...rest, updatedAt: at }
}

/**
 * The newer of two copies of the same record.
 *
 * Last write wins, per record. Two tabs editing the same task within the same
 * millisecond is not a case worth a merge strategy for a single user; two tabs
 * where one is holding a stale copy is, and this is what stops the stale one
 * writing over the fresh one.
 */
export const newer = <T extends { updatedAt: Ms }>(a: T, b: T): T =>
  b.updatedAt > a.updatedAt ? b : a

const byOrder = (a: { order: number }, b: { order: number }): number => a.order - b.order

// `exactOptionalPropertyTypes` forbids `doneAt: undefined`, so leaving the
// state that carries it means leaving the key out altogether.
function withoutDoneAt(item: Item): Item {
  const { doneAt, ...rest } = item
  void doneAt
  return rest
}
