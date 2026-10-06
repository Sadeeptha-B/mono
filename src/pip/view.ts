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
 * **It follows the stage exactly.** Whichever opening question the stage is
 * showing, this shows too — before the day is shaped and on every return to
 * them — so the two windows never disagree about where the day is. It used to
 * follow `dayShaped` instead and offer the next block while the tab was back
 * on the hours, on the argument that a question shown here was only a sign
 * pointing at the tab. That stopped holding once the window had more to show
 * than a sign: each question comes out with its current answer, and the
 * today's question with its timer.
 *
 * **Answers that need the day or the backlog are written in the tab.** Hours and
 * commitments are only answerable with the calendar drawn beside them — the
 * whole reason Mono has no modals — and intentions and a block's tasks are
 * chosen from the backlog. None of that fits a window this size, so those views
 * say what the answer is so far and point back to the tab, keeping only what
 * needs neither: the timers, and not starting a block after all. See
 * `MiniSetup` and `MiniPickInTab`.
 */

import type { DecidingTimer, Phase } from '@/domain/machine'
import type { SetupStageId } from '@/components/stage/stages'
import type { BlockKind, Ms } from '@/domain/types'

export type MiniView =
  /** One of the opening questions is on the stage. */
  | { kind: 'setup'; stage: SetupStageId; revisiting: boolean }
  /** Nothing running, and now is not time the user offered up. */
  | { kind: 'outsideHours'; nextStart: Ms | null }
  /** Nothing running, inside working hours, nothing more fits. */
  | { kind: 'nothingFits' }
  /** Nothing running, and there is a block to offer. */
  | { kind: 'ready'; blockKind: BlockKind }
  | { kind: 'purpose'; blockKind: BlockKind; deciding: DecidingTimer | null }
  /** A segment is running. The label and the one control differ by which. */
  | { kind: 'running'; segment: 'block' | 'break' }
  | { kind: 'done'; nextBlockKind: BlockKind | null }
  | { kind: 'breakLength' }
  | { kind: 'away'; blockEndedAt: Ms }

export type MiniFacts = {
  /**
   * The opening question the stage is showing, or null when it is showing
   * none; `revisiting` once the day has been shaped, as the stage words it.
   */
  setup: { stage: SetupStageId; revisiting: boolean } | null
  withinHours: boolean
  /** The first planned block on the derived timeline, if there is one. */
  nextBlockKind: BlockKind | null
  /** When working hours next open, or null if the day is done. */
  nextRegionStart: Ms | null
}

export function miniViewFor(phase: Phase, facts: MiniFacts): MiniView {
  switch (phase.name) {
    case 'idle':
      // The same precedence the stage uses, for the same reasons: an opening
      // question on screen outranks everything — a day not yet shaped always
      // has one — and after that, being outside working hours outranks
      // offering a block in time the user declared unstructured.
      if (facts.setup) return { kind: 'setup', ...facts.setup }
      if (!facts.withinHours) return { kind: 'outsideHours', nextStart: facts.nextRegionStart }
      if (facts.nextBlockKind === null) return { kind: 'nothingFits' }
      return { kind: 'ready', blockKind: facts.nextBlockKind }

    case 'definingPurpose':
      return { kind: 'purpose', blockKind: phase.blockKind, deciding: phase.deciding }

    case 'focusing':
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
