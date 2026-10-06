/**
 * The backlog as today's surfaces read it, per snapshot rather than per tick:
 * the today question, the purpose prompt and the tasks page all render every
 * second, and the backlog has not changed on most of those.
 *
 * Two trees. `tree` is the open tasks in play, which is what a choice is made
 * from. `pickerTree` is the same tree with the tasks done today put back in,
 * crossed out, so the day's progress shows where the next choice is made — in
 * the backlog browser and in today's own lists, which are cut from it. Today
 * is the session's day, which changes at the midnight reset and not on the
 * tick.
 *
 * A task chosen for today and then dropped, archived or deleted is still a key
 * in the day's map — the day does not watch the backlog — but it is in neither
 * tree, so it simply is not drawn, and it does not count towards the day
 * having something chosen (`chosen`).
 */

import { useCallback, useMemo } from 'react'

import {
  activeTasks,
  groupTasks,
  taskTree,
  taskTreeWithDone,
  type Item,
  type TaskTreeNode,
} from '@/domain/tasks'
import { carriedOver, todayTaskIds, type Today } from '@/domain/today'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'

export function useTodayBacklog(today: Today) {
  const hydrated = useTasks((s) => s.hydrated)
  const items = useTasks((s) => s.items)
  const areas = useTasks((s) => s.areas)
  const day = useSession((s) => s.dayKey)
  const lastDay = useSession((s) => s.session.lastDay)

  const tree = taskTree(items, areas)
  const pickerTree = useMemo(() => taskTreeWithDone(items, areas, day), [items, areas, day])
  // Every task the tree offers: what a choice can still name.
  const offered = useMemo(() => activeTasks(items, areas).map((t) => t.id), [items, areas])
  // Every task drawn anywhere today, open or finished today, by id.
  const drawn = useMemo(() => {
    const found = new Map<string, Item>()
    const walk = (node: TaskTreeNode) => {
      for (const task of node.tasks) found.set(task.id, task)
      node.children.forEach(walk)
    }
    pickerTree.forEach(walk)
    return found
  }, [pickerTree])
  // Today's tasks that are still drawn, in the order they were chosen.
  const chosen = useMemo(
    () => todayTaskIds(today).filter((id) => drawn.has(id)),
    [today, drawn],
  )
  const carried = useMemo(() => carriedOver(lastDay, today, offered), [lastDay, today, offered])
  // Stable per snapshot, so a caller can memoise on them.
  const task = useCallback((id: string): Item | undefined => drawn.get(id), [drawn])
  const group = useCallback(
    (taskIds: readonly string[]) => groupTasks(taskIds, pickerTree),
    [pickerTree],
  )

  return {
    hydrated,
    items,
    areas,
    tree,
    pickerTree,
    offered,
    chosen,
    carried,
    /** A task drawn today by id: open in play, or finished today. */
    task,
    /** Some tasks under the places they live in, finished ones crossed out after the open. */
    group,
  }
}
