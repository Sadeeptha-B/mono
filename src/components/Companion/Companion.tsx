/**
 * The companion, as the stage mounts it: the cat, plus the one line it says.
 *
 * `PixelCat` is only a renderer — give it a phase and some numbers and it
 * draws. Everything that decides *which* numbers lives here, so the header can
 * mount the same creature as a bare mark without dragging the day's history
 * along with it.
 *
 * All three things the cat knows about the day come from the same append-only
 * log the timeline is drawn from. There is no companion state to persist, none
 * to migrate, and none that can survive a day it should not have.
 */

import { useMemo } from 'react'

import { PixelCat } from './PixelCat'
import { markTierFor, moodForPhase } from './cat'
import { utteranceFor } from './utterances'
import { dayKey } from '@/domain/time'
import { vitalsFor } from '@/domain/vitals'
import type { Phase } from '@/domain/machine'
import type { ActiveSegment, CompletedSegment, Ms } from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  history: readonly CompletedSegment[]
}

export function Companion({ now, phase, active, history }: Props) {
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
  const says = utteranceFor(mood, vitals)

  // Walking is how a *block* shows its progress. A break has its own timer on
  // the stage, and a cat that is supposed to be resting should not be pacing.
  const progress =
    active?.kind === 'block'
      ? clamp01((now - active.startedAt) / Math.max(1, active.endsAt - active.startedAt))
      : null

  // Only a block has a purpose. A break is a break.
  const note = active?.kind === 'block' ? active.purpose : null

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <PixelCat
        phase={phase}
        progress={progress}
        note={note}
        tier={markTierFor(vitals.blocksToday)}
        interactive
        className="h-20 w-36 sm:h-24 sm:w-44"
      />

      {/* Reserved whether or not there is anything to say, so the cat does not
          shuffle up and down the stage as the day moves through its phases. */}
      <p className="h-4 pr-1 text-xs text-muted">{says}</p>
    </div>
  )
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
