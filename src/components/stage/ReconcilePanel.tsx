/**
 * "You were away."
 *
 * Shown when the app comes back to find a block ended while it was frozen or
 * the machine was asleep. There is no correct default — banking a block the
 * user spent at lunch would poison the history, and discarding one they
 * actually finished is just as wrong — so nothing is recorded until they say.
 *
 * Inline rather than modal on purpose: the timeline beside it shows exactly
 * where the gap falls, which is the context needed to answer.
 */

import { GhostButton, PrimaryButton, StagePrompt } from '../ui'
import { formatClock, formatDuration } from '@/domain/time'

type Props = {
  blockEndedAt: number
  now: number
  /** A break can be slept through too, and it asks a different question. */
  kind: 'block' | 'break'
  purpose: string | null
  onResolve: (outcome: 'completed' | 'abandoned') => void
}

export function ReconcilePanel({ blockEndedAt, now, kind, purpose, onResolve }: Props) {
  const awayFor = formatDuration(now - blockEndedAt)
  const isBreak = kind === 'break'

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="You were away"
        title={isBreak ? 'Welcome back' : 'Did you finish it?'}
        detail={
          isBreak
            ? `Your break was due to end at ${formatClock(blockEndedAt)} — about ${awayFor} ago.`
            : `This block was due to end at ${formatClock(blockEndedAt)} — about ${awayFor} ago. Mono won't guess.`
        }
      />

      {purpose && (
        <p className="mb-4 rounded-lg border border-line bg-ink px-3.5 py-3 text-body">
          {purpose}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isBreak ? (
          // A break has no outcome to record — either answer ends it at its
          // planned end and books the rest as unaccounted.
          <PrimaryButton type="button" onClick={() => onResolve('completed')}>
            Back to work
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton type="button" onClick={() => onResolve('completed')}>
              Finished it
            </PrimaryButton>
            <GhostButton type="button" onClick={() => onResolve('abandoned')}>
              Didn't finish it
            </GhostButton>
          </>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {isBreak ? 'The' : 'Either way the'} {awayFor} since then is recorded as
        unaccounted, so the day still adds up.
      </p>
    </div>
  )
}
