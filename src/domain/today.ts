/**
 * Reading today: the tasks chosen for it, the intentions some of them are
 * gathered under, and what the day before left to offer again.
 *
 * The day is answered by its tasks. An intention is a name given to some of
 * them — narrower than an outcome or broader than an epic, whichever the day
 * needs — and a task can be today's under none. That order is the point: an
 * intention written first, before anything was scoped, came out as the name of
 * an epic the backlog already had.
 *
 * Nothing here is stored. A block records only the tasks it was for, and which
 * intentions it served is worked out from those tasks and today's links — so a
 * task moved from one intention to another after the block is reported where
 * it now belongs, the same way the plan is re-derived rather than kept.
 */

import type { Intention } from './types'

/** Today's tasks, each with the intention it is under or `null` — see `SessionState.today`. */
export type Today = Readonly<Record<string, string | null>>

/** Whether a task is chosen for today. */
export const isToday = (today: Today, taskId: string): boolean => Object.hasOwn(today, taskId)

/** Every task chosen for today, in the order they were chosen. */
export const todayTaskIds = (today: Today): string[] => Object.keys(today)

/** The ids of the tasks under an intention today, in the order they were chosen. */
export const tasksOfIntention = (intentionId: string, today: Today): string[] =>
  Object.entries(today)
    .filter(([, id]) => id === intentionId)
    .map(([taskId]) => taskId)

/** Today's tasks under no intention, in the order they were chosen. */
export const ungroupedToday = (today: Today): string[] =>
  Object.entries(today)
    .filter(([, id]) => id === null)
    .map(([taskId]) => taskId)

/**
 * The intentions a block served, in the order the day named them.
 *
 * A task with no intention today contributes nothing, which is allowed: a
 * small thing from outside today's intentions is still a reasonable use of the
 * end of a block, and refusing it would make the intentions a fence.
 */
export function blockIntentions(
  taskIds: readonly string[],
  today: Today,
  intentions: readonly Intention[],
): Intention[] {
  const served = new Set(
    taskIds.map((id) => today[id]).filter((id): id is string => typeof id === 'string'),
  )
  return intentions.filter((i) => served.has(i.id))
}

/**
 * What the last day left to offer again: the tasks it chose that are still
 * open and in play (`offered`) and have not been chosen today already, in the
 * order that day chose them.
 *
 * Offered, never added. Carrying a task over by itself would be the day
 * deciding for you, and yesterday's list is the commonest thing to have
 * changed your mind about overnight. A suggestion nobody takes lasts until the
 * next reset, which replaces `lastDay` with whatever today chose instead.
 */
export function carriedOver(
  lastDay: readonly string[],
  today: Today,
  offered: readonly string[],
): string[] {
  const live = new Set(offered)
  return [...new Set(lastDay)].filter((id) => live.has(id) && !isToday(today, id))
}
