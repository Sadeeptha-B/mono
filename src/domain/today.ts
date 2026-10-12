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
 * Nothing here is stored. A block records only the tasks it was for; which
 * intention a task is under is today's map, read when it is drawn, so a task
 * carried from one intention to another is shown where it now belongs.
 */

import type { NamedTasks } from './tasks'
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
 * The open intention a name already belongs to, if any: where an outcome's
 * tasks go when its heading is made an intention, so pressing it again after
 * ticking more of the outcome fills the one it made rather than naming a
 * second. Matched as a person reads a name, ignoring case and the space
 * around it. One marked done is left alone: the day has said it got what it
 * wanted from it, and filling it again would undo that without asking.
 */
export const intentionNamed = (
  intentions: readonly Intention[],
  title: string,
): Intention | undefined => {
  const name = title.trim().toLowerCase()
  return intentions.find((i) => i.done !== true && i.title.trim().toLowerCase() === name)
}

/**
 * Today's intentions as names a block's purpose may use (`purposeParts`), each
 * with the tasks under it. One marked done is left out: the day has said it
 * got what it wanted from it, so a block for its leftovers is about them
 * rather than about it, and is named by their own titles.
 */
export const intentionNames = (
  intentions: readonly Intention[],
  today: Today,
): NamedTasks[] =>
  intentions
    .filter((i) => i.done !== true)
    .map((i) => ({ title: i.title, taskIds: tasksOfIntention(i.id, today) }))

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
