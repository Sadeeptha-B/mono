/**
 * The day as a sequence of named stages.
 *
 * The phase machine already knows what Mono is asking; this is the same thing
 * told as a journey, which is what the carousel under the stage needs. It is
 * deliberately a *view* of the phase rather than state of its own — there is
 * exactly one exception, which stage of the opening questions the user is
 * looking at, and that is passed in rather than stored here.
 *
 * Two of these are freely navigable and the rest are not, and the difference is
 * not cosmetic. The opening questions are a form: answer them in whatever order
 * you like, and they stay answerable — between blocks the day's shape is still
 * a question, and re-opening it is how you change your mind about it.
 * Everything after "One thing" is a gate — you do not get to skip naming the
 * block by clicking a dot, because naming it is the product.
 */

import type { Phase } from '@/domain/machine'
import type { Ms } from '@/domain/types'

/** The two questions the day opens with, in the order they are asked. */
export type SetupStageId = 'commitments' | 'hours'

export type StageId =
  | SetupStageId
  | 'ready'
  | 'purpose'
  | 'priorities'
  | 'focus'
  | 'done'
  | 'break'

export type StageMeta = {
  id: StageId
  /** Shown on hover, and as the accessible name of the dot. */
  name: string
  setup: boolean
}

/**
 * Commitments come before hours on purpose. What is already fixed is the thing
 * you cannot change, and it decides how much of the day is yours to declare —
 * answering "when am I working?" first means answering it again once you
 * remember the school run.
 */
export const STAGES: readonly StageMeta[] = [
  { id: 'commitments', name: "What's already fixed", setup: true },
  { id: 'hours', name: "Today's hours", setup: true },
  { id: 'ready', name: 'Ready', setup: false },
  { id: 'purpose', name: 'One thing', setup: false },
  { id: 'priorities', name: 'Priorities', setup: false },
  { id: 'focus', name: 'Focusing', setup: false },
  { id: 'done', name: 'Block done', setup: false },
  { id: 'break', name: 'Break', setup: false },
]

export const FIRST_SETUP_STAGE: SetupStageId = 'commitments'

export const otherSetupStage = (stage: SetupStageId): SetupStageId =>
  stage === 'commitments' ? 'hours' : 'commitments'

/**
 * Whether the two opening questions can be reached from the strip right now.
 *
 * Only while nothing is running, which is a stronger rule than "before the day
 * is shaped" and a weaker one than "never again afterwards". Shaping the day
 * used to close the questions for good, and there is nothing behind that: what
 * is fixed today and which hours are yours are ordinary facts about the day
 * that keep changing, and answering them once should not be the only chance.
 *
 * Mid-block is the case this excludes, and deliberately. The strip must never
 * offer a way out of "One thing" — naming the block is the product — and the
 * calendar's own `Hours` and `+ Commitment` are right there for a day whose
 * shape changed while you were working.
 */
export const setupReachable = (phase: Phase): boolean => phase.name === 'idle'

/**
 * Whether the main stage is showing the completed-day postcard.
 *
 * This includes where the user is looking, not only facts about the clock: an
 * open setup question outranks the postcard even after the final work region.
 * `App` uses the same answer to decide whether the ordinary companion should
 * yield its place to the postcard scene.
 */
export function dayDoneFor({
  phase,
  setupOpen,
  withinHours,
  nextRegionStart,
  hasRegions,
}: {
  phase: Phase
  setupOpen: boolean
  withinHours: boolean
  nextRegionStart: Ms | null
  hasRegions: boolean
}): boolean {
  return (
    phase.name === 'idle' &&
    !setupOpen &&
    !withinHours &&
    nextRegionStart === null &&
    hasRegions
  )
}

/**
 * Where the day is now, or `null` when the question on screen is not part of
 * the journey at all.
 *
 * `setupOpen` is the one thing here the phase cannot tell us. A day that has
 * not been shaped yet is always in setup; a day that has can be *put back*
 * there, which is a decision `App` holds rather than the event log — re-reading
 * the opening questions is not a fact about the day, it is where the user is
 * looking.
 *
 * "You were away" is the null case. It is an interruption rather than a stage —
 * it can arrive from any of them and returns to where it came from — and a
 * strip implying you might move on from it would undercut the one thing that
 * panel is for, which is that nothing is recorded until you answer.
 */
export function stageFor(
  phase: Phase,
  setupOpen: boolean,
  setupStage: SetupStageId,
): StageId | null {
  switch (phase.name) {
    case 'idle':
      return setupOpen ? setupStage : 'ready'
    case 'definingPurpose':
      return 'purpose'
    case 'reflecting':
      return 'priorities'
    case 'focusing':
      return 'focus'
    case 'blockComplete':
      return 'done'
    case 'choosingBreak':
    case 'onBreak':
      return 'break'
    case 'reconciling':
      return null
  }
}
