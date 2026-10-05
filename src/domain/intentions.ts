/**
 * Reading the day's intentions against the tasks that serve them.
 *
 * Nothing here is stored. A block records only the tasks it was for, and which
 * intentions it served is worked out from those tasks and today's links — so a
 * task moved from one intention to another after the block is reported where
 * it now belongs, the same way the plan is re-derived rather than kept.
 */

import type { Intention } from './types'

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
