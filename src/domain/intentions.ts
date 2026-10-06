/**
 * Reading the day's intentions against the tasks that serve them.
 *
 * Nothing here is stored. A block records only the tasks it was for, and which
 * intentions it served is worked out from those tasks and today's links — so a
 * task moved from one intention to another after the block is reported where
 * it now belongs, the same way the plan is re-derived rather than kept.
 */

import type { Intention, IntentionPatch } from './types'

/**
 * The intentions a block served, in the order the day named them.
 *
 * A task with no intention today contributes nothing, which is allowed: a
 * small thing from outside today's intentions is still a reasonable use of the
 * end of a block, and refusing it would make the intentions a fence.
 */
export function blockIntentions(
  taskIds: readonly string[],
  taskIntentions: Readonly<Record<string, string>>,
  intentions: readonly Intention[],
): Intention[] {
  const served = new Set(
    taskIds.map((id) => taskIntentions[id]).filter((id): id is string => id !== undefined),
  )
  return intentions.filter((i) => served.has(i.id))
}

/** The ids of the tasks under an intention today, in no particular order. */
export const tasksOfIntention = (
  intentionId: string,
  taskIntentions: Readonly<Record<string, string>>,
): string[] =>
  Object.entries(taskIntentions)
    .filter(([, id]) => id === intentionId)
    .map(([taskId]) => taskId)

/**
 * What is being written: a new intention, or an edit to one already named,
 * and the tasks chosen to go under it.
 */
export type IntentionDraft = {
  title: string
  taskIds: readonly string[]
  /** The intention being edited, or null for a new one. */
  editing: string | null
}

export const emptyIntentionDraft: IntentionDraft = { title: '', taskIds: [], editing: null }

/**
 * The writes that saving a draft comes to: the intention itself, then the
 * tasks to put under it and the ones to take out. A new intention's tasks are
 * linked once the store has given it an id.
 */
export type IntentionSave =
  | { kind: 'add'; intention: Omit<Intention, 'id'>; link: string[] }
  | { kind: 'update'; id: string; patch: IntentionPatch; link: string[]; unlink: string[] }

/**
 * Saving a draft, worked out before any of it is written. Null when there is
 * no title to save.
 *
 * The same answer wherever an intention is written — the opening question and
 * the tasks page — so the two cannot drift. A choice counts only the tasks the
 * backlog still offers (`offered`): one finished or deleted since it was ticked
 * leaves the choice with it.
 */
export function planIntentionSave(
  draft: IntentionDraft,
  backlog: {
    offered: readonly string[]
    taskIntentions: Readonly<Record<string, string>>
  },
): IntentionSave | null {
  const title = draft.title.trim()
  if (title === '') return null
  const live = new Set(backlog.offered)
  const chosen = [...new Set(draft.taskIds)].filter((id) => live.has(id))

  if (draft.editing === null) return { kind: 'add', intention: { title }, link: chosen }
  const id = draft.editing
  const before = backlog.offered.filter((taskId) => backlog.taskIntentions[taskId] === id)
  return {
    kind: 'update',
    id,
    patch: { title },
    link: chosen.filter((taskId) => backlog.taskIntentions[taskId] !== id),
    unlink: before.filter((taskId) => !chosen.includes(taskId)),
  }
}
