/**
 * What the mini window is showing, as one value.
 *
 * The same idea as `stageFor` in `components/stage/stages.ts`: the phase
 * machine already knows what Mono is asking, and this is that told in the terms
 * a 380-pixel window can answer in. Pure, and a discriminated union rather than
 * a switch buried in JSX, because the interesting part is not the markup — it
 * is which of ten things a given phase means out here, and that is worth
 * testing without mounting anything.
 *
 * Two rules shape it, and both are about the boundary rather than the layout.
 *
 * **The day's shape is not answerable here.** Hours and commitments are only
 * answerable with the calendar drawn beside them — the whole reason Mono has no
 * modals — and there is no calendar in a window this size. So an unshaped day
 * gets a signpost back to the tab and nothing else. This is the one question the
 * mini window declines.
 *
 * **`dayShaped`, not `setupOpen`.** The stage re-opens the opening questions
 * whenever the user goes back to them, and that is where the *user* is looking
 * rather than a fact about the day. Following it out here would turn the mini
 * window into a sign pointing at the window they are already reading, for as
 * long as they read it.
 */

import type { Phase } from '@/domain/machine'
import type { BlockKind, Ms } from '@/domain/types'

export type MiniView =
  /** The day has never been shaped. The only case that sends you back. */
  | { kind: 'unshaped' }
  /** Nothing running, and now is not time the user offered up. */
  | { kind: 'outsideHours'; nextStart: Ms | null }
  /** Nothing running, inside working hours, nothing more fits. */
  | { kind: 'nothingFits' }
  /** Nothing running, and there is a block to offer. */
  | { kind: 'ready'; blockKind: BlockKind }
  | { kind: 'purpose'; blockKind: BlockKind; afterReflection: boolean }
  /** A segment is running. The label and the one control differ by which. */
  | { kind: 'running'; segment: 'block' | 'break' }
  | { kind: 'done'; nextBlockKind: BlockKind | null }
  | { kind: 'breakLength' }
  | { kind: 'away'; blockEndedAt: Ms }

export type MiniFacts = {
  /** `session.shapedAt !== null` — deliberately not the stage's `setupOpen`. */
  dayShaped: boolean
  withinHours: boolean
  /** The first planned block on the derived timeline, if there is one. */
  nextBlockKind: BlockKind | null
  /** When working hours next open, or null if the day is done. */
  nextRegionStart: Ms | null
}

export function miniViewFor(phase: Phase, facts: MiniFacts): MiniView {
  switch (phase.name) {
    case 'idle':
      // The same precedence the stage uses, for the same reasons: a day that
      // was never given a shape outranks everything, because refusing to plan
      // until it has one and then not saying so is a closed loop; and after
      // that, being outside working hours outranks offering a block in time the
      // user declared unstructured.
      if (!facts.dayShaped) return { kind: 'unshaped' }
      if (!facts.withinHours) return { kind: 'outsideHours', nextStart: facts.nextRegionStart }
      if (facts.nextBlockKind === null) return { kind: 'nothingFits' }
      return { kind: 'ready', blockKind: facts.nextBlockKind }

    case 'definingPurpose':
      return {
        kind: 'purpose',
        blockKind: phase.blockKind,
        afterReflection: phase.afterReflection,
      }

    case 'focusing':
    case 'reflecting':
      return { kind: 'running', segment: 'block' }

    case 'onBreak':
      return { kind: 'running', segment: 'break' }

    case 'blockComplete':
      return { kind: 'done', nextBlockKind: facts.nextBlockKind }

    case 'choosingBreak':
      return { kind: 'breakLength' }

    // Unlike the stage strip, which hides itself for this one, the mini window
    // shows it. The strip hides because being away is an interruption rather
    // than a place in the journey; but the question itself has to be asked
    // wherever the user is, and nothing is recorded until it is answered.
    case 'reconciling':
      return { kind: 'away', blockEndedAt: phase.blockEndedAt }
  }
}
