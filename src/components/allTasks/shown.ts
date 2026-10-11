/**
 * The tree as All Tasks draws it: what a search leaves of it, and whether a
 * row or place is still in it, which every editor and popup held by id asks
 * before it is drawn (`editors.ts`).
 *
 * A search narrows the tree as it is typed: a task stays when its title or a
 * place above it matches, a place when it, a place above it or anything beneath
 * it does — so searching for an epic shows the whole epic, and searching for a
 * task shows the path down to it. A search looks through folds, so what it
 * finds is drawn whatever was folded over it.
 */

import type { Item, TaskTreeNode } from '@/domain/tasks'

/** The task as this tree draws it, or undefined when it has no row. */
export const drawnTask = (nodes: readonly TaskTreeNode[], taskId: string): Item | undefined => {
  for (const node of nodes) {
    const task = node.tasks.find((t) => t.id === taskId) ?? drawnTask(node.children, taskId)
    if (task) return task
  }
  return undefined
}

/** Whether this tree, as drawn, has the place. */
export const drawsPlace = (nodes: readonly TaskTreeNode[], placeId: string): boolean =>
  nodes.some((node) => node.id === placeId || drawsPlace(node.children, placeId))

/**
 * The tree as a search leaves it. Empty asks for nothing and gets the whole
 * tree back; otherwise a place whose name matches keeps everything beneath it.
 */
export function narrow(tree: readonly TaskTreeNode[], needle: string): readonly TaskTreeNode[] {
  if (needle === '') return tree
  const matches = (text: string) => text.toLowerCase().includes(needle)
  const prune = (node: TaskTreeNode): TaskTreeNode | null => {
    if (matches(node.name)) return node
    const children = node.children.flatMap((child) => prune(child) ?? [])
    const tasks = node.tasks.filter((task) => matches(task.title))
    return children.length > 0 || tasks.length > 0 ? { ...node, children, tasks } : null
  }
  return tree.flatMap((node) => prune(node) ?? [])
}

/**
 * The tree as its folds leave it: a folded place keeps its row and draws
 * nothing under it (`folds.ts`). What an editor or popup asks before it is
 * drawn, so one held on a row a fold has hidden is let go rather than coming
 * back when the place opens.
 */
export function foldAway(
  tree: readonly TaskTreeNode[],
  folded: ReadonlySet<string>,
): readonly TaskTreeNode[] {
  if (folded.size === 0) return tree
  const fold = (node: TaskTreeNode): TaskTreeNode =>
    folded.has(node.id) ? { ...node, children: [], tasks: [] } : { ...node, children: node.children.map(fold) }
  return tree.map(fold)
}
