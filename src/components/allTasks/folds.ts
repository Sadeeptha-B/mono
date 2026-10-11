/**
 * Which places All Tasks has folded down to their own row: an area, epic or
 * outcome whose name was pressed, so that what is under it stops taking the
 * column's height. A backlog that has grown is hard to read whole, and the
 * place being chosen from is usually one or two of many.
 *
 * Held for the tab, not by the column. All Tasks is drawn afresh for every
 * question that asks for it (`App` keys it by what it is choosing for), and a
 * fold made on today's question and lost on the next block's purpose prompt
 * would be made again before every block — which is exactly when a crowded
 * backlog is in the way. Not persisted, for the reason the timer face and the
 * session mute are not: how much of the backlog is in view is a way of
 * looking, not something the day decided, so it is not in the log, and a
 * reload opens everything again.
 *
 * Held by id, and a place that goes keeps its id here. That is not the trap
 * of state outliving its row (`decisions.md`, *Traps*): a fold is not a
 * gesture under way that comes back unasked, it is a choice about that place,
 * and one archived and restored, or hidden by a search and found again, is
 * still the place that was folded.
 */

import { create } from 'zustand'

export const useFolds = create<{
  folded: ReadonlySet<string>
  /** Fold an open place, or open a folded one. */
  toggle: (placeId: string) => void
  /** Open a place, if it was folded: something is about to be written in it. */
  unfold: (placeId: string) => void
}>()((set) => ({
  folded: new Set(),
  toggle: (placeId) =>
    set(({ folded }) => {
      const next = new Set(folded)
      if (!next.delete(placeId)) next.add(placeId)
      return { folded: next }
    }),
  unfold: (placeId) =>
    set(({ folded }) => {
      if (!folded.has(placeId)) return {}
      const next = new Set(folded)
      next.delete(placeId)
      return { folded: next }
    }),
}))
