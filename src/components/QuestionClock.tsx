/**
 * A timer on a question: counting, run out, or not yet started.
 *
 * Two questions carry one — what today is for, and what this block is for —
 * and both for the same reason. The way they go wrong is not the empty answer
 * but the opposite, sitting over it for half an hour, so each can give itself
 * a few minutes. Neither is a block: nothing is recorded, no plan time is
 * spent, no site is blocked, and the face is derived from two instants and
 * `now` like every other timer here. Whoever owns the question owns the
 * instants and the chime at zero.
 *
 * Run out is the interesting state, and it is quiet on purpose. Nothing is
 * taken away and nothing moves on; the time is simply up, and the one control
 * offered is another round of it. A question that hurried you along would be
 * the app deciding the answer was finished, which is not its call.
 *
 * It sits level with the question's title rather than above the answers,
 * because it belongs to the question and not to any one answer. Before it is
 * started it is only the play button; what pressing it does is said when the
 * pointer or focus is on it, rather than as a sentence beside it all along.
 *
 * The pop-out window shows the same clock beside the same question, on the
 * same instants, so a round started in either place runs in both. Its hint
 * opens downwards and leftwards from the button, which is why it is only ever
 * placed at the right of a title, near the top of whatever holds it.
 */

import { formatTimer } from '@/domain/time'
import type { Ms } from '@/domain/types'

export function QuestionClock({
  now,
  timer,
  minutes,
  onStart,
  timeLeftLabel,
  hint,
}: {
  now: Ms
  /** Null until it has been started. */
  timer: { endsAt: Ms } | null
  /** The setting, for the label on the button that starts a round. */
  minutes: number
  onStart: () => void
  /** The running time's accessible name: "Time left for intentions". */
  timeLeftLabel: string
  /** What the running time is for, on hover. */
  hint: string
}) {
  const remaining = timer === null ? null : timer.endsAt - now
  const running = remaining !== null && remaining > 0

  const offer =
    timer === null ? `Take ${minutes} mins to decide` : `Take another ${minutes} mins`

  return (
    <div className="flex h-8 items-center gap-2 text-sm" aria-live="polite">
      {running ? (
        <span className="tnum text-bright" aria-label={timeLeftLabel} title={hint}>
          {formatTimer(remaining)}
        </span>
      ) : (
        <>
          {timer !== null && <span className="text-xs text-muted">Time's up</span>}
          <span className="group relative">
            <button
              type="button"
              onClick={onStart}
              aria-label={offer}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-muted/70 text-body transition hover:bg-surface-raised hover:text-bright"
            >
              ▶
            </button>
            {/* The button's own name says this to a screen reader. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 rounded-md border border-muted/70 bg-surface-raised px-2 py-1 text-xs whitespace-nowrap text-body opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100"
            >
              {offer}
            </span>
          </span>
        </>
      )}
    </div>
  )
}
