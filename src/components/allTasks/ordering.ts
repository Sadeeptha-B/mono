/**
 * Putting All Tasks' tree in order, when the caller says how (`onPlace`).
 *
 * An area, epic or outcome is dragged by its row up or down among its own
 * siblings; a task is dragged between two rows of any place, its own or
 * another, or onto a place's row to go last in it; a line shows where it
 * would land. The keyboard's way is a step at a time, with the ↑ and ↓ in a
 * row's `⋯`, which stays open and keeps the focus on the arrow so a row can
 * be stepped several places in a run.
 *
 * That is the tree's own carry (`useCarryState`), apart from the one around
 * it: a task's drag is both at once (`dragInto`), so it can still be let go on
 * one of today's intentions, and whichever takes it, the other lets go when it
 * lands. What putting it down writes is the caller's.
 *
 * The lists are the rows as shown, a search included, so a step passes the
 * next row on screen, an arrow is disabled at the end of what is drawn, and no
 * line is drawn where letting go would change nothing visible. Read from the
 * whole tree, a step under a search passed a row it hid and nothing on screen
 * moved. Where the record lands among everything, hidden rows and put-away
 * ones included, stays the store's (`placeAmong`).
 */

import { useCallback, useMemo } from 'react'

import { TOP, useCarryState, type Slot, type SlotKind } from '../carry'
import type { PlaceInOrder } from './types'
import { staysPut, stepTarget, type TaskTreeNode } from '@/domain/tasks'

/** A row the tree can put in order: what it is, and where it hangs. */
type OrderRow = { id: string; title: string; kind: SlotKind; parent: string }

/**
 * Every row of the tree that can be put in order, and the list of each kind
 * under each parent, in order: open tasks only, since a task done today is
 * drawn after them and is not moved. Kept per tree, which is per backlog
 * snapshot.
 */
function orderRows(tree: readonly TaskTreeNode[]) {
  const rows = new Map<string, OrderRow>()
  const lists = new Map<string, OrderRow[]>()
  const add = (row: OrderRow) => {
    rows.set(row.id, row)
    const key = `${row.parent}:${row.kind}`
    const list = lists.get(key)
    if (list) list.push(row)
    else lists.set(key, [row])
  }
  const walk = (node: TaskTreeNode, parent: string) => {
    add({ id: node.id, title: node.name, kind: node.kind, parent })
    for (const child of node.children) walk(child, node.id)
    for (const task of node.tasks) {
      if (task.status === 'open') add({ id: task.id, title: task.title, kind: 'task', parent: node.id })
    }
  }
  for (const node of tree) walk(node, TOP)
  return {
    rows,
    of: (parent: string, kind: SlotKind): readonly OrderRow[] => lists.get(`${parent}:${kind}`) ?? [],
  }
}

/** The tree's carry takes nothing into a column; only between rows. */
const takesNoColumn = () => false
const movesNowhere = () => undefined

export type Ordering = ReturnType<typeof useTreeOrdering>

/**
 * The tree's carry, and a row's steps through its own list. A place moves only
 * among its own siblings, a task anywhere a task can go, and neither to where
 * it already stands. `focusNext` keeps the focus on the arrow that was pressed.
 */
export function useTreeOrdering(
  shown: readonly TaskTreeNode[],
  onPlace: PlaceInOrder | undefined,
  focusNext: (key: string) => void,
) {
  const order = useMemo(() => orderRows(shown), [shown])
  const findRow = useCallback(({ id }: { id: string }) => order.rows.get(id), [order])
  const fitsRow = useCallback(
    (row: OrderRow, { parent, kind, before }: Slot) =>
      row.kind === kind &&
      (row.parent === parent
        ? !staysPut(order.of(parent, kind), row.id, before)
        : kind === 'task'),
    [order],
  )
  const placeRow = useCallback(
    (row: OrderRow, slot: Slot) => onPlace?.(row.kind, row.id, slot.parent, slot.before),
    [onPlace],
  )
  const reorder = useCarryState({
    find: findRow,
    takes: takesNoColumn,
    move: movesNowhere,
    fits: fitsRow,
    place: placeRow,
  })
  const ordering = onPlace !== undefined

  /** A step through its own list, from a `⋯`, with the focus kept on the arrow pressed. */
  const step = (kind: SlotKind, id: string, parent: string, by: -1 | 1) => {
    const before = stepTarget(order.of(parent, kind), id, by)
    if (before === undefined) return
    focusNext(`${by < 0 ? 'up' : 'down'}:${id}`)
    onPlace?.(kind, id, parent, before)
  }
  /** Where a row stands in its own list, for its arrows. */
  const ends = (kind: SlotKind, id: string, parent: string) => {
    const list = order.of(parent, kind)
    return { first: list[0]?.id === id, last: list[list.length - 1]?.id === id }
  }

  return { ordering, reorder, step, ends }
}
