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

import { dayKey, type DayKey } from './time'
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
  /**
   * The record's version, which orders copies of it across tabs and the disk.
   * Usually the moment of the last edit, but never behind the version it
   * replaced — see `nextVersion` in the store — so read it as an order, not as
   * a time to show anyone.
   */
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

// -----------------------------------------------------------------------------
// Projections, over one index per backlog snapshot.
// -----------------------------------------------------------------------------

/**
 * Lookups over the items alone: by id, and children by parent.
 *
 * Every projection below reads the backlog through these rather than scanning
 * it, because they are asked often — the task picker and the tasks page both
 * render once a second for the clock — and a scan inside a per-task question
 * is quadratic. At ten thousand tasks that was the difference between a frame
 * and a frozen tab.
 *
 * Built once per items array and kept in a WeakMap keyed on it. That is safe
 * because the store never mutates an array it has published: every change makes
 * a new one, and the old one, with its index, is collected once nothing holds
 * it. The cache is invisible to callers — same inputs, same answers — so the
 * functions here stay pure in every sense that matters to their tests.
 */
type ItemIndex = {
  byId: Map<string, Item>
  /** Every child, tombstones included, by parent id, in display order. */
  allChildren: Map<string, Item[]>
  /** Live children only, by parent id, in display order. */
  liveChildren: Map<string, Item[]>
}

const itemIndexes = new WeakMap<readonly Item[], ItemIndex>()

function indexItems(items: readonly Item[]): ItemIndex {
  const cached = itemIndexes.get(items)
  if (cached) return cached

  const byId = new Map<string, Item>()
  const allChildren = new Map<string, Item[]>()
  for (const item of items) {
    byId.set(item.id, item)
    const siblings = allChildren.get(item.parentId)
    if (siblings) siblings.push(item)
    else allChildren.set(item.parentId, [item])
  }
  const liveChildren = new Map<string, Item[]>()
  for (const [parent, children] of allChildren) {
    children.sort(byOrder)
    const live = children.filter(isLive)
    if (live.length > 0) liveChildren.set(parent, live)
  }

  const index = { byId, allChildren, liveChildren }
  itemIndexes.set(items, index)
  return index
}

/**
 * Everything the active-tree questions need, for one items array and one areas
 * array. Memoised the same way as `indexItems`, on both identities. The
 * answers that cost a pass over the backlog are computed on first use and kept.
 */
type BacklogIndex = ItemIndex & {
  areasById: Map<string, Area>
  inActiveTree: (itemId: string) => boolean
  gone: (itemId: string) => boolean
  activeTasks: () => readonly Item[]
  activeTasksByParent: () => ReadonlyMap<string, readonly Item[]>
  tree: () => readonly TaskTreeNode[]
}

/**
 * Indexes by items array, each remembered with the areas it was built for.
 *
 * The areas are matched by their elements rather than by the array itself. A
 * caller that filters or spreads the areas — `[work]`, `activeAreas(areas)` —
 * makes a new array of the same records on every call, and keying on that
 * array's identity rebuilt the whole index each time, which is the quadratic
 * cost this exists to remove. There are only ever a handful of areas, so the
 * comparison is cheap.
 */
const backlogIndexes = new WeakMap<readonly Item[], { areas: readonly Area[]; index: BacklogIndex }[]>()

const sameRecords = (a: readonly Area[], b: readonly Area[]): boolean =>
  a === b || (a.length === b.length && a.every((area, i) => area === b[i]))

function indexBacklog(items: readonly Item[], areas: readonly Area[]): BacklogIndex {
  let built = backlogIndexes.get(items)
  const cached = built?.find((entry) => sameRecords(entry.areas, areas))?.index
  if (cached) return cached

  const base = indexItems(items)
  const areasById = new Map(areas.map((a) => [a.id, a]))

  // Whether an id can be the parent of something in play: an active area, or a
  // live, unarchived, open epic or outcome whose own parent can be.
  const parentIsActive = ancestryWalk((id) => {
    const area = areasById.get(id)
    if (area) return isLive(area) && area.archivedAt === undefined
    const item = base.byId.get(id)
    if (!item || !isLive(item) || item.archivedAt !== undefined || item.status !== 'open') return false
    return item.parentId
  })

  const inActiveTree = (itemId: string): boolean => {
    const self = base.byId.get(itemId)
    if (!self || !isLive(self) || self.archivedAt !== undefined) return false
    return parentIsActive(self.parentId)
  }

  // Whether anything at or above an id is deleted. A missing parent is not a
  // deleted one.
  const parentIsGone = ancestryWalk((id) => {
    const area = areasById.get(id)
    if (area) return !isLive(area)
    const item = base.byId.get(id)
    if (!item) return false
    return isLive(item) ? item.parentId : true
  })
  const gone = (itemId: string): boolean => {
    const self = base.byId.get(itemId)
    return !self || !isLive(self) || parentIsGone(self.parentId)
  }

  let tasks: readonly Item[] | null = null
  const activeTasks = () =>
    (tasks ??= openTasks(items).filter((t) => inActiveTree(t.id)))

  let byParent: Map<string, Item[]> | null = null
  const activeTasksByParent = () => {
    if (byParent) return byParent
    const grouped = new Map<string, Item[]>()
    for (const task of activeTasks()) {
      const siblings = grouped.get(task.parentId)
      if (siblings) siblings.push(task)
      else grouped.set(task.parentId, [task])
    }
    byParent = grouped
    return grouped
  }

  let tree: readonly TaskTreeNode[] | null = null
  const treeOnce = () => {
    if (tree) return tree
    const open = (parentId: string, kind: 'epic' | 'outcome') =>
      (base.liveChildren.get(parentId) ?? []).filter(
        (i) => i.kind === kind && i.status === 'open' && i.archivedAt === undefined,
      )
    const node = (
      id: string,
      kind: TaskTreeNode['kind'],
      name: string,
      children: readonly TaskTreeNode[],
    ): TaskTreeNode => ({ id, kind, name, children, tasks: openTasksUnder(id, items) })
    tree = activeAreas(areas).map((area) =>
      node(
        area.id,
        'area',
        area.name,
        open(area.id, 'epic').map((epic) =>
          node(
            epic.id,
            'epic',
            epic.title,
            open(epic.id, 'outcome').map((outcome) => node(outcome.id, 'outcome', outcome.title, [])),
          ),
        ),
      ),
    )
    return tree
  }

  const index: BacklogIndex = {
    ...base,
    areasById,
    inActiveTree,
    gone,
    activeTasks,
    activeTasksByParent,
    tree: treeOnce,
  }
  if (!built) {
    built = []
    backlogIndexes.set(items, built)
  }
  // A few views of the same items at most (all areas, active areas); bounded so
  // a caller that keeps inventing area sets cannot grow it without end.
  built.unshift({ areas: [...areas], index })
  built.length = Math.min(built.length, 4)
  return index
}

/**
 * A question about an id's ancestry, answered by walking up its parents.
 * `step` answers for one id, or names the parent to ask about next. Every
 * answer is remembered for each id on the way, so a whole backlog costs one
 * visit per item, and a cycle — only possible in data from outside — answers
 * false rather than walking forever.
 */
function ancestryWalk(step: (id: string) => boolean | string): (startId: string) => boolean {
  const known = new Map<string, boolean>()
  return (startId) => {
    const path: string[] = []
    let id = startId
    let answer: boolean
    for (;;) {
      const remembered = known.get(id)
      if (remembered !== undefined) {
        answer = remembered
        break
      }
      if (path.includes(id)) {
        answer = false
        break
      }
      const next = step(id)
      if (typeof next === 'boolean') {
        answer = next
        break
      }
      path.push(id)
      id = next
    }
    for (const visited of path) known.set(visited, answer)
    return answer
  }
}

/** The live items directly under `parentId`, in display order. */
export const childrenOf = (parentId: string, items: readonly Item[]): Item[] =>
  (indexItems(items).liveChildren.get(parentId) ?? []).slice()

/**
 * An area's inbox: its open tasks that belong to nothing smaller.
 *
 * Deliberately not a stored list. See the header — it is the same set as "the
 * one-offs in this area", and that is the point.
 */
export const inboxOf = (areaId: string, items: readonly Item[]): Item[] =>
  openTasksUnder(areaId, items)

/**
 * The tasks directly under a parent that are still to do: open, and not put
 * away. Archiving is a way of putting away as much as finishing is, so an
 * archived task belongs with the done and dropped ones, where it can be
 * restored, and not in the list of work — the picker already leaves it out.
 */
export const openTasksUnder = (parentId: string, items: readonly Item[]): Item[] =>
  childrenOf(parentId, items).filter(
    (i) => i.kind === 'task' && i.status === 'open' && i.archivedAt === undefined,
  )

/** Every live, open task, wherever it sits. */
export const openTasks = (items: readonly Item[]): Item[] =>
  items.filter((i) => i.kind === 'task' && i.status === 'open' && isLive(i)).sort(byOrder)

/**
 * The live items beneath `id`, at any depth, nearest first: what deleting it
 * takes from view. Only through live records — anything under a child deleted
 * earlier went with that child — and guarded against cycles for the reason
 * `areaOf` is.
 */
export function liveDescendantsOf(id: string, items: readonly Item[]): Item[] {
  const { liveChildren } = indexItems(items)
  const found: Item[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const parent = queue.shift()!
    for (const item of liveChildren.get(parent) ?? []) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      found.push(item)
      queue.push(item.id)
    }
  }
  return found
}

/**
 * Whether an item is deleted: tombstoned itself, or beneath a deleted epic,
 * outcome or area. An id this backlog does not hold counts as gone.
 *
 * A delete tombstones only the thing deleted. What sits under it goes with it
 * by ancestry, the way finishing or archiving an epic hides its tasks, and
 * never comes back: nothing is ever undeleted, nothing gone can be edited,
 * and the disk refuses to move anything out of a deleted subtree. Tombstoning the subtree
 * as well used to race other tabs: the deleting tab could only stamp what *it*
 * believed was underneath, so a task another tab had just moved out could be
 * deleted where it no longer was, and one added a moment before the delete
 * was heard was missed. Asked of the backlog as it stands, the question has
 * one answer everywhere: a task moved out first is under a live parent and
 * stays; one renamed or added underneath is gone.
 */
export const isGone = (itemId: string, items: readonly Item[], areas: readonly Area[]): boolean =>
  indexBacklog(items, areas).gone(itemId)

/**
 * Why a backlog cannot be taken whole, or null when it can.
 *
 * Asked of an import, which replaces everything: a backlog whose records do
 * not fit together would leave some of them in no view at all. Mono never
 * writes such a thing — tombstones are kept, so a parent is never missing, ids
 * are random, and every move is checked against `canParent` — so finding one
 * means the file was damaged or edited, and the safe answer is to take none of
 * it. A deleted parent is fine: what is under it is gone with it
 * (`isGone`). A cycle needs no check of its own: tasks hold nothing, epics sit only
 * under areas and outcomes only under epics, so any loop puts something under
 * a parent that cannot hold it.
 */
export function backlogProblem(contents: {
  areas: readonly Area[]
  items: readonly Item[]
}): string | null {
  const kinds = new Map<string, ParentKind>()
  for (const record of [...contents.areas, ...contents.items]) {
    if (kinds.has(record.id)) return 'two of its records share an id'
    kinds.set(record.id, 'kind' in record ? record.kind : 'area')
  }
  for (const item of contents.items) {
    const parent = kinds.get(item.parentId)
    if (parent === undefined) return `“${item.title}” belongs to something the file does not have`
    if (!canParent(item.kind, parent)) return `“${item.title}” sits somewhere a ${item.kind} cannot`
  }
  return null
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
export const isInActiveTree = (
  itemId: string,
  items: readonly Item[],
  areas: readonly Area[],
): boolean => indexBacklog(items, areas).inActiveTree(itemId)

/** Open tasks whose whole chain is active: what a block may be for. */
export const activeTasks = (items: readonly Item[], areas: readonly Area[]): readonly Item[] =>
  indexBacklog(items, areas).activeTasks()

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
  const { byId, areasById } = indexBacklog(items, areas)
  const names: string[] = []
  const seen = new Set([itemId])
  let id = byId.get(itemId)?.parentId
  while (id !== undefined && !seen.has(id)) {
    seen.add(id)
    const area = areasById.get(id)
    if (area) return [area.name, ...names]
    const item = byId.get(id)
    if (!item) break
    names.unshift(item.title)
    id = item.parentId
  }
  return names
}

/** How a path reads on one line. */
export const PATH_SEPARATOR = ' › '

/**
 * One level of the backlog as a tree: an area, an open epic or an open outcome,
 * the places beneath it, and the open tasks that sit directly under it — and,
 * in the picker's copy of the tree only, the tasks finished there today
 * (`taskTreeWithDone`).
 */
export type TaskTreeNode = {
  id: string
  kind: 'area' | 'epic' | 'outcome'
  name: string
  children: readonly TaskTreeNode[]
  tasks: readonly Item[]
}

/**
 * Every open task in play, under the area, epic and outcome it sits in, in the
 * order the tasks page draws them. What a picker of tasks draws: the places
 * are there as well as the tasks, empty ones included, so a task can be
 * written straight into any of them.
 */
export const taskTree = (items: readonly Item[], areas: readonly Area[]): readonly TaskTreeNode[] =>
  indexBacklog(items, areas).tree()

/**
 * The task tree with the tasks finished on one day put back in, each after the
 * open tasks of the place it sits in.
 *
 * What the task picker draws, so the day's progress is in front of whoever is
 * choosing what to do next: what was done today is there, crossed out, under
 * the same outcome as what is left. Only today's, because the picker is for
 * choosing, and a list carrying every task ever ticked would bury the open
 * ones within a month. Done tasks are not choices — a caller tells them apart
 * by `status` — and nothing else that reads the tree sees them.
 *
 * Only under places in play, as the tree itself is: a task done today inside an
 * epic finished since is put away with the epic. `null` is a day not known
 * yet, which adds nothing. Not memoised here; it is cheap beside the tree, and
 * the picker's caller keeps it per backlog snapshot and day.
 */
export function taskTreeWithDone(
  items: readonly Item[],
  areas: readonly Area[],
  day: DayKey | null,
): readonly TaskTreeNode[] {
  const tree = taskTree(items, areas)
  if (day === null) return tree
  const { liveChildren } = indexItems(items)
  const doneOn = (parentId: string) =>
    (liveChildren.get(parentId) ?? []).filter(
      (i) =>
        i.kind === 'task' &&
        i.status === 'done' &&
        i.archivedAt === undefined &&
        i.doneAt !== undefined &&
        dayKey(i.doneAt) === day,
    )
  // A node with nothing done anywhere beneath it is returned as it was.
  const withDone = (node: TaskTreeNode): TaskTreeNode => {
    const children = node.children.map(withDone)
    const done = doneOn(node.id)
    const same = done.length === 0 && children.every((child, i) => child === node.children[i])
    return same ? node : { ...node, children, tasks: [...node.tasks, ...done] }
  }
  return tree.map(withDone)
}

/**
 * Some of the backlog's tasks, under the places they sit in: the backlog tree
 * with everything else taken out, places left with nothing in them included.
 *
 * How today's tasks are shown, and an intention's. Tasks from two areas are
 * under both areas, so nothing about where they live has to be reduced to one
 * place, and each place is said once for all the tasks in it rather than once
 * per task. Only what the given tree holds is found: cut from `taskTree`, the
 * open tasks still in play; cut from `taskTreeWithDone`, today's finished ones
 * too, after the open ones of their place.
 */
export function groupTasks(
  taskIds: readonly string[],
  tree: readonly TaskTreeNode[],
): readonly TaskTreeNode[] {
  const wanted = new Set(taskIds)
  const prune = (node: TaskTreeNode): TaskTreeNode | null => {
    const children = node.children.flatMap((child) => prune(child) ?? [])
    const tasks = node.tasks.filter((t) => wanted.has(t.id))
    return children.length > 0 || tasks.length > 0 ? { ...node, children, tasks } : null
  }
  return tree.flatMap((node) => prune(node) ?? [])
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
  const { byId, areasById } = indexBacklog(items, areas)
  const seen = new Set<string>()

  let id = itemId
  while (!seen.has(id)) {
    seen.add(id)
    const area = areasById.get(id)
    if (area) return area
    const item = byId.get(id)
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
): readonly Item[] => indexBacklog(items, areas).activeTasksByParent().get(outcomeId) ?? []

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
  const { byId } = indexBacklog(items, areas)
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
 * Whether copy `a` of a record beats copy `b`.
 *
 * A delete is final: a tombstone beats any live copy, whatever their
 * versions, and no live copy beats a tombstone. Mono has no undelete, so a
 * live copy newer than a tombstone can only be an edit made by a tab that had
 * not yet heard of the delete — a rename racing it, a move made a moment
 * before — and letting it win would bring back something deliberately
 * deleted. Otherwise last write wins, by version. Two tabs editing the same
 * task in the same millisecond is not a case worth a merge strategy for a
 * single user; two tabs where one is holding a stale copy is, and this is what
 * stops the stale one writing over the fresh one. `taskDb.ts` applies the same
 * rule on disk, so memory and disk cannot settle differently.
 */
export const outranks = <T extends { updatedAt: Ms; deletedAt?: Ms }>(a: T, b: T): boolean =>
  isLive(a) !== isLive(b) ? !isLive(a) : a.updatedAt > b.updatedAt

/**
 * Whether a number can be a record's version: a whole number of milliseconds
 * from zero to `Number.MAX_SAFE_INTEGER`, the range in which every version and
 * the one after it are exact. The importer accepts exactly these, and
 * `nextVersion` never leaves them, so whatever Mono exports it can read back.
 */
export const isVersion = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

/**
 * The version an edit gets: now, or one past the version it replaces when the
 * clock is behind that version — after an import from a machine whose clock
 * ran ahead, or after this clock was set back. Null when there is no next
 * version to give: a record already at `Number.MAX_SAFE_INTEGER` cannot be
 * edited, rather than be stamped with a version the importer would refuse.
 * Only a damaged or edited file can bring one that far.
 */
export const nextVersion = (previous: Ms, at: Ms): Ms | null => {
  const next = Math.max(at, previous + 1)
  return isVersion(next) ? next : null
}

const byOrder = (a: { order: number }, b: { order: number }): number => a.order - b.order

// `exactOptionalPropertyTypes` forbids `doneAt: undefined`, so leaving the
// state that carries it means leaving the key out altogether.
function withoutDoneAt(item: Item): Item {
  const { doneAt, ...rest } = item
  void doneAt
  return rest
}
