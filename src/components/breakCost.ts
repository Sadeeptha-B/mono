/**
 * The two things both break pickers have to agree about.
 *
 * There are two of them now — the stage's `BreakDurationPanel` and the mini
 * window's `MiniBreakLength` — and they are deliberately laid out differently,
 * because one has a timeline drawn beside it and the other has four hundred
 * pixels. What they must not differ about is what they *offer* and what they
 * *say*, and both had already started to: the lengths were two copies of one
 * array waiting to be edited singly, and the free-break sentence had already
 * drifted into two wordings of the same fact.
 *
 * So the choices and the words live here and the markup stays where it is. The
 * split is on purpose: the cost is described as parts rather than as a finished
 * string, because each panel emphasises the number differently and a formatter
 * that returned one sentence would have to own the markup to do that.
 *
 * Note what is *not* here: the short labels on buttons — `Start break`,
 * `Cancel`, `Keep going`. They are typed out in both panels, because they are
 * read at a glance rather than looked up, and because the two are allowed to
 * differ where room forces it. The stage says `Keep going (deep)` and the mini
 * window says `Keep going`; a shared constant would have to be one or the
 * other, and neither is wrong where it is.
 */

/**
 * The break lengths on offer, in minutes.
 *
 * Not a setting. Breaks are never planned for you, so this is a short list of
 * plausible answers to "how long?" rather than a shape the day is built from —
 * and a picker is only quick to use while it is short.
 */
export const BREAK_DURATIONS = [5, 10, 15, 20, 30]

/** Where the picker starts. Long enough to be a real break, short enough to cost little. */
export const DEFAULT_BREAK_MINUTES = 10

export type BreakCost = { blocksLost: number; focusMinutesLost: number }

/**
 * What a break of this length costs, in the pieces a panel needs to draw it.
 *
 * `lost` is the headline — the part each panel lifts out of the sentence — and
 * `also` is the remainder, present only when a break costs whole blocks *and*
 * loose minutes on top. Quoting blocks in preference to minutes is the honest
 * order: a block is the unit the day is actually made of, and "1 block" says
 * more about your afternoon than "45 focus minutes" does.
 */
export function describeBreakCost(
  cost: BreakCost,
): { free: true } | { free: false; lost: string; also: string | null } {
  if (cost.blocksLost === 0 && cost.focusMinutesLost === 0) return { free: true }

  const blocks = cost.blocksLost > 0
  return {
    free: false,
    lost: blocks
      ? `${cost.blocksLost} block${cost.blocksLost === 1 ? '' : 's'}`
      : `${cost.focusMinutesLost} focus minutes`,
    also:
      blocks && cost.focusMinutesLost > 0 ? `${cost.focusMinutesLost} focus minutes` : null,
  }
}

/**
 * The one break that is worth taking for free, said the same way in both places.
 *
 * A sentence rather than a fragment because it is the whole of what that panel
 * has to say in that case, and because it is the best moment in the day to
 * stop — which is worth saying plainly rather than implying with a zero.
 */
export const FREE_BREAK = "This fits in time that wasn't going to hold a block anyway. It's free."
