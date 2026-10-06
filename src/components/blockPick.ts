/**
 * What the purpose prompt has ticked for the block it is naming.
 *
 * Held by `App` rather than by the prompt, because the prompt is not the only
 * place a tick is made: All Tasks, beside it in the calendar's column, ticks
 * for the same block. Both read this one answer, so a task ticked in either is
 * ticked in both. It lasts while the prompt is open; `App` starts it empty each
 * time the prompt opens and whenever the session is replaced.
 *
 * A tick in All Tasks also chooses the task for today (`App`), so everything
 * ticked is one of today's tasks, grouped as today groups it.
 */

import { isToday, type Today } from '@/domain/today'

export type BlockPick = readonly string[]

export const emptyBlockPick: BlockPick = []

/** The pick with these tasks ticked or unticked. */
export function tickTasks(pick: BlockPick, ids: readonly string[], on: boolean): BlockPick {
  return on
    ? [...pick, ...ids.filter((id) => !pick.includes(id))]
    : pick.filter((id) => !ids.includes(id))
}

/**
 * The ticks that still name a task in play and still today's. A task can leave
 * from under a tick — deleted or finished in another tab, its epic archived,
 * or taken out of today with its × — and its row goes with it; the tick must
 * too, or Start would stay enabled for a block recording a task nobody can
 * see on the prompt. Every tick chooses its task for today, so the second
 * test only bites when one is taken out again. Derived rather than pruned, so
 * every reader gets the same answer.
 */
export function pickedInPlay(
  pick: BlockPick,
  offered: readonly string[],
  today: Today,
): string[] {
  const live = new Set(offered)
  return pick.filter((id) => live.has(id) && isToday(today, id))
}
