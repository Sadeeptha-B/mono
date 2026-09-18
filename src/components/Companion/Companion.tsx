/**
 * The companion, as the stage mounts it: the cat, plus the one line it says.
 *
 * `PixelCat` is only a renderer — give it a phase and some numbers and it
 * draws. `App` owns the day projection because the postcard and both companion
 * surfaces consume it; this component adds the cat-specific vitals, mood and
 * movement without refolding the same history.
 *
 * Everything the cat and its room know about the day comes from the same
 * append-only log the timeline is drawn from. There is no companion state to
 * persist, none to migrate, and none that can survive a day it should not have.
 */

import { useMemo } from 'react'

import { PixelCat } from './PixelCat'
import { markTierFor, moodForPhase, walkProgress } from './cat'
import { utteranceFor } from './utterances'
import { dayKey } from '@/domain/time'
import { vitalsFor } from '@/domain/vitals'
import { dayProgressLabel, type DayProgress } from '@/domain/dayProgress'
import type { Phase } from '@/domain/machine'
import type { ActiveSegment, CompletedSegment, Ms, RoomId } from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  history: readonly CompletedSegment[]
  roomId: RoomId
  dayProgress: DayProgress
  /**
   * How big the cat is drawn. The mini window is the reason this is a prop:
   * deciding *which* numbers the cat knows is identical in both windows and
   * belongs in one place, while how much room there is to draw it in is not
   * something this component could work out for itself.
   */
  className?: string
  /** The Stage yields on a phone; the fixed-size mini window does not. */
  canShrink?: boolean
}

export function Companion({
  now,
  phase,
  active,
  history,
  roomId,
  dayProgress,
  className = 'aspect-[2/1] w-28 max-w-full sm:w-56 lg:w-64',
  canShrink = false,
}: Props) {
  const day = dayKey(now)

  // At `blockComplete` the timer has run out but the log has not recorded the
  // block: the machine holds it open until the user answers, so that walking
  // away from the prompt cannot silently bank it. The cat is reacting to a
  // block that has just landed, so it counts one the log cannot see yet.
  const justLanded = phase.name === 'blockComplete' ? active : null

  // Keyed on the day rather than on `now`. The whole app re-renders every
  // second off the shared ticker, and `vitalsFor` only reads the clock to work
  // out which day it is — so a `now` from earlier today gives the same answer,
  // and a history that is kept forever is not refiltered sixty times a minute.
  const vitals = useMemo(
    () => vitalsFor(history, now, justLanded),
    [history, day, justLanded],
  )
  const mood = moodForPhase(phase)
  const says = utteranceFor(mood, vitals, dayProgress.milestone)

  const progress = walkProgress(active, now)

  // Only a block has a purpose. A break is a break.
  const note = active?.kind === 'block' ? active.purpose : null

  return (
    // The Stage shares one narrow row between the clock and this scene, while
    // the mini window owns a fixed-width copy. Only the former yields: on the
    // smallest phone the scene scales in both dimensions and the sentence gets
    // three reserved lines, rather than either one widening or shifting the
    // page.
    <div
      className={`flex flex-col items-end gap-1.5 ${canShrink ? 'min-w-0' : 'shrink-0'}`}
    >
      <PixelCat
        phase={phase}
        progress={progress}
        note={note}
        tier={markTierFor(dayProgress.blocks)}
        roomId={roomId}
        sceneTier={dayProgress.sceneTier}
        trail={dayProgress.trail}
        milestone={dayProgress.milestone}
        progressLabel={dayProgressLabel(dayProgress)}
        interactive
        className={className}
      />

      {/* The narrow Stage reserves three lines because its sentence may wrap;
          everywhere else the original single line remains enough. */}
      <p
        className={`max-w-full pr-1 text-right text-xs leading-4 text-muted ${
          canShrink ? 'min-h-12 min-[375px]:min-h-4' : 'h-4'
        }`}
      >
        {says}
      </p>
    </div>
  )
}
