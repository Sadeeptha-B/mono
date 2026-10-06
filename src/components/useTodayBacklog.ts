/**
 * The backlog as today's surfaces read it, per snapshot rather than per tick:
 * the today question, the purpose prompt and the tasks page all render every
 * second, and the backlog has not changed on most of those.
 *
 * `pickerTree` is the tree of open tasks in play with the tasks done today put
 * back in, crossed out, so the day's progress shows where the next choice is
 * made — in the backlog browser and in today's own lists, which are cut from
 * it. Today is the session's day, which changes at the midnight reset and not
 * on the tick.
 *
 * A task chosen for today and then dropped, archived or deleted is still a key
 * in the day's map — the day does not watch the backlog — but it is not in the
 * tree, so it simply is not drawn, and it does not count towards the day
 * having something chosen (`chosen`).
 *
 * Several surfaces call this at once, so the per-snapshot part is built once
 * and shared (`snapshotOf`), as the backlog's own index is.
 */

import { useMemo } from 'react'

import {
  activeTasks,
  groupTasks,
  taskTreeWithDone,
  type Area,
  type Item,
  type TaskTreeNode,
} from '@/domain/tasks'
import { carriedOver, todayTaskIds } from '@/domain/today'
import type { DayKey } from '@/domain/time'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'

type Snapshot = {
  /** The tree in play with today's finished tasks put back, crossed out. */
  pickerTree: readonly TaskTreeNode[]
  /** Every task the tree offers: what a choice can still name. */
  offered: readonly string[]
  /** A task drawn today by id: open in play, or finished today. */
  task: (id: string) => Item | undefined
  /** Some tasks under the places they live in, finished ones crossed out after the open. */
  group: (taskIds: readonly string[]) => readonly TaskTreeNode[]
}

const snapshots = new WeakMap<
  readonly Item[],
  { areas: readonly Area[]; day: DayKey | null; snapshot: Snapshot }
>()

/** One backlog snapshot as today's surfaces read it, built once for all of them. */
function snapshotOf(items: readonly Item[], areas: readonly Area[], day: DayKey | null): Snapshot {
  const hit = snapshots.get(items)
  if (hit && hit.areas === areas && hit.day === day) return hit.snapshot
  const pickerTree = taskTreeWithDone(items, areas, day)
  const drawn = new Map<string, Item>()
  const walk = (node: TaskTreeNode) => {
    for (const task of node.tasks) drawn.set(task.id, task)
    node.children.forEach(walk)
  }
  pickerTree.forEach(walk)
  const snapshot: Snapshot = {
    pickerTree,
    offered: activeTasks(items, areas).map((t) => t.id),
    task: (id) => drawn.get(id),
    group: (taskIds) => groupTasks(taskIds, pickerTree),
  }
  snapshots.set(items, { areas, day, snapshot })
  return snapshot
}

export function useTodayBacklog() {
  const hydrated = useTasks((s) => s.hydrated)
  const items = useTasks((s) => s.items)
  const areas = useTasks((s) => s.areas)
  const day = useSession((s) => s.dayKey)
  const today = useSession((s) => s.session.today)
  const lastDay = useSession((s) => s.session.lastDay)

  const snapshot = snapshotOf(items, areas, day)
  // Today's tasks that are still drawn, in the order they were chosen.
  const chosen = useMemo(
    () => todayTaskIds(today).filter((id) => snapshot.task(id) !== undefined),
    [today, snapshot],
  )
  const carried = useMemo(
    () => carriedOver(lastDay, today, snapshot.offered),
    [lastDay, today, snapshot],
  )

  return { hydrated, ...snapshot, chosen, carried }
}
