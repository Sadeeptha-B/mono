/**
 * What All Tasks' tree is handed by its caller to act with. Handed in rather
 * than read from the store, so the tree stays a drawing of what it is given.
 */

import type { SlotKind } from '../carry'
import type { TaskTreeNode } from '@/domain/tasks'

/** What can be done to a place — an area, epic or outcome — from its `⋯`. */
export type PlaceActions = {
  rename: (node: TaskTreeNode, name: string) => void
  /** Write an epic under an area or an outcome under an epic; its id, or null when refused. */
  add: (parentId: string, kind: 'epic' | 'outcome', title: string) => string | null
  complete: (node: TaskTreeNode) => void
  archive: (node: TaskTreeNode) => void
  remove: (node: TaskTreeNode) => void
  /** How many live items would go with it if it were deleted. */
  inside: (node: TaskTreeNode) => number
}

/**
 * Put an area, epic, outcome or task immediately before a sibling under
 * `parentId`, or last when `beforeId` is null. Only a task ever arrives with a
 * parent other than its own.
 */
export type PlaceInOrder = (
  kind: SlotKind,
  id: string,
  parentId: string,
  beforeId: string | null,
) => void
