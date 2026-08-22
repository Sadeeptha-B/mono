/**
 * The strip of dots under the stage.
 *
 * Two jobs. During the opening questions it is a control: the two setup stages
 * can be answered in either order, and this is how you move between them.
 * Afterwards it is an indicator — it says where in the day you are, and the
 * rest of the dots are there so that "where" means something.
 *
 * Every dot names itself on hover rather than in the layout. Eight labels under
 * a focus timer would be a navigation bar, and the whole design of the stage is
 * that one question is on screen at a time.
 *
 * The dots carry no text content, only `aria-label` and `title`. That is
 * deliberate: visually-hidden labels here would collide with the timer's own
 * words — "Break" is both a stage and what the timer says during one — and
 * turn every text query on the stage ambiguous.
 */

import { STAGES, type SetupStageId, type StageId } from './stages'

export function StageCarousel({
  current,
  onNavigate,
}: {
  /** Null hides the strip entirely — see `stageFor`. */
  current: StageId | null
  /** Provided only while the opening questions are still open. */
  onNavigate?: ((id: SetupStageId) => void) | undefined
}) {
  if (current === null) return null

  return (
    <nav aria-label="Stages of the day" className="flex justify-center">
      <ol className="flex items-center gap-1">
        {STAGES.map((stage, index) => {
          const active = stage.id === current
          // Setup dots are buttons that go somewhere; the rest are buttons that
          // do not, kept as buttons so the tooltip and the accessible name have
          // somewhere legitimate to live.
          const go = stage.setup && onNavigate ? () => onNavigate(stage.id as SetupStageId) : null
          const previous = STAGES[index - 1]
          const seam = previous !== undefined && previous.setup !== stage.setup

          return (
            <li key={stage.id} className="flex items-center">
              {seam && <span aria-hidden className="mr-1 h-3 w-px bg-line" />}
              <button
                type="button"
                title={stage.name}
                aria-label={stage.name}
                {...(active ? { 'aria-current': 'step' as const } : {})}
                {...(go ? {} : { 'aria-disabled': true, tabIndex: -1 })}
                onClick={go ?? undefined}
                className={`group flex items-center p-1.5 ${go ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span
                  className={`h-1.5 rounded-full transition-all ${
                    active
                      ? 'w-6 bg-deep'
                      : go
                        ? 'w-1.5 bg-muted group-hover:bg-body'
                        : 'w-1.5 bg-line'
                  }`}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
