/**
 * How the day has gone so far, as three numbers.
 *
 * The companion changes over a day — it earns markings, and it says how much
 * is banked when nothing is running. None of that is stored anywhere. It is a
 * fold over the same append-only history the timeline is drawn from, for the
 * same reason the plan is: state you can derive is state that cannot drift,
 * cannot need migrating, and cannot survive a day it should not have.
 *
 * Pure, like everything else in this folder: `now` is a parameter, and nothing
 * here reads the clock.
 */

import { completeBlock } from './events'
import { dayKey } from './time'
import type { ActiveSegment, CompletedSegment, Ms } from './types'

export type Vitals = {
  /**
   * Focus blocks completed today. Deep and short only — the priorities timer
   * is recorded like any other block, but it is time spent working out what to
   * do rather than doing it, and counting it here would let a day of
   * indecision look like a day of work.
   */
  blocksToday: number
  /** Whole minutes actually spent inside those blocks, rounded down. */
  focusMinutesToday: number
  /**
   * Completed blocks since the last one you did not finish.
   *
   * Neither a break nor the priorities timer ends a streak. Both are things
   * this app actively wants you to do — a counter that punished them would be
   * arguing with the rest of the product, and the guide already says that
   * failing to name a purpose is worth knowing rather than worth hiding. Only
   * an abandoned block, or a stretch Mono could not account for, resets it.
   */
  streak: number
}

const EMPTY: Vitals = { blocksToday: 0, focusMinutesToday: 0, streak: 0 }

/**
 * Today's segments, oldest first.
 *
 * Keyed on when a segment *started*: the midnight reset never fires mid-block,
 * so a block that began at 23:50 and ended at 00:35 belongs to the day it was
 * named in, which is also the day it is drawn on.
 */
const today = (history: readonly CompletedSegment[], now: Ms): CompletedSegment[] => {
  const key = dayKey(now)
  return history.filter((segment) => dayKey(segment.startedAt) === key)
}

const isBankedFocus = (segment: CompletedSegment): boolean =>
  segment.kind === 'block' && segment.outcome === 'completed' && segment.blockKind !== 'reflect'

/**
 * @param pending A block whose timer has run out but which the log has not
 * recorded yet. Between the timer reaching zero and the user answering "break
 * or keep going?", the machine deliberately holds the block open so that a
 * forgotten prompt cannot silently bank it — but the companion is reacting to
 * a block that has, as far as the user is concerned, just landed. Without
 * this, the cat congratulates you on the block before last: the first block of
 * a day reported "that makes 0 today", and newly earned markings showed up one
 * interaction late. Credited at `endsAt` rather than at `now`, the same way
 * the reconcile path credits a block the user confirms.
 */
export function vitalsFor(
  history: readonly CompletedSegment[],
  now: Ms,
  pending: ActiveSegment | null = null,
): Vitals {
  const banked =
    pending?.kind === 'block'
      ? [...history, completeBlock(pending, pending.endsAt, 'completed')]
      : history

  const segments = today(banked, now)
  if (segments.length === 0) return EMPTY

  let blocksToday = 0
  let focusMs = 0

  for (const segment of segments) {
    if (!isBankedFocus(segment)) continue
    blocksToday += 1
    focusMs += Math.max(0, segment.endedAt - segment.startedAt)
  }

  // Walk backwards to the most recent thing that went wrong. Everything after
  // it that was finished counts.
  let streak = 0
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]!
    if (isBankedFocus(segment)) {
      streak += 1
      continue
    }
    // Breaks and the priorities timer are transparent: they neither add to the
    // run nor end it.
    const harmless =
      segment.kind === 'break' ||
      (segment.kind === 'block' &&
        segment.outcome === 'completed' &&
        segment.blockKind === 'reflect')
    if (harmless) continue

    // An abandoned block, or a stretch Mono could not account for.
    break
  }

  return {
    blocksToday,
    focusMinutesToday: Math.floor(focusMs / 60_000),
    streak,
  }
}
