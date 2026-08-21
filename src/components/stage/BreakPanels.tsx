/**
 * The two break decisions, made in place.
 *
 * Keeping these on the stage rather than in a dialog matters most for the
 * duration picker: the cost of a break is a statement about the timeline, and
 * the timeline should stay visible while you weigh it.
 */

import { useState } from 'react'

import { GhostButton, PrimaryButton, StagePrompt } from '../ui'
import type { BlockKind } from '@/domain/types'

const DURATIONS = [5, 10, 15, 20, 30]

export function BlockCompletePanel({
  nextBlockKind,
  onTakeBreak,
  onSkipBreak,
}: {
  nextBlockKind: BlockKind | null
  onTakeBreak: () => void
  onSkipBreak: (kind: BlockKind) => void
}) {
  const nothingFits = nextBlockKind === null

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Block done"
        title={nothingFits ? 'That was the last one' : 'Need a break?'}
        detail={
          nothingFits
            ? 'Nothing more fits before your next commitment.'
            : 'Or go straight into the next block.'
        }
      />

      <div className="flex flex-wrap gap-2">
        {!nothingFits && (
          <PrimaryButton type="button" onClick={() => onSkipBreak(nextBlockKind)}>
            Keep going ({nextBlockKind === 'deep' ? 'deep' : 'short'})
          </PrimaryButton>
        )}
        <GhostButton type="button" onClick={onTakeBreak}>
          Take a break
        </GhostButton>
      </div>
    </div>
  )
}

export function BreakDurationPanel({
  costOf,
  onConfirm,
  onCancel,
}: {
  /** What a break of this length would cost, recomputed as the user picks. */
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
  onConfirm: (minutes: number) => void
  onCancel: () => void
}) {
  const [minutes, setMinutes] = useState(10)
  const cost = costOf(minutes)

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Break"
        title="How long?"
        detail="The plan fills every minute it can, so a break comes out of your focus time."
      />

      <div className="flex flex-wrap gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setMinutes(d)}
            aria-pressed={minutes === d}
            className={[
              'tnum rounded-lg border px-4 py-2.5 text-sm transition',
              minutes === d
                ? 'border-rest bg-rest/15 text-rest'
                : 'border-line text-body hover:bg-surface-raised hover:text-bright',
            ].join(' ')}
          >
            {d}m
          </button>
        ))}
      </div>

      <p aria-live="polite" className="mt-4 min-h-10 text-sm leading-relaxed text-muted">
        {cost.blocksLost === 0 && cost.focusMinutesLost === 0 ? (
          <>This fits in time that wasn't going to hold a block anyway. It's free.</>
        ) : (
          <>
            Costs you{' '}
            <span className="text-body">
              {cost.blocksLost > 0
                ? `${cost.blocksLost} block${cost.blocksLost === 1 ? '' : 's'}`
                : `${cost.focusMinutesLost} focus minutes`}
            </span>
            {cost.blocksLost > 0 && cost.focusMinutesLost > 0 && (
              <> and {cost.focusMinutesLost} focus minutes</>
            )}
            .
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <PrimaryButton type="button" onClick={() => onConfirm(minutes)}>
          Start break
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Cancel
        </GhostButton>
      </div>
    </div>
  )
}
