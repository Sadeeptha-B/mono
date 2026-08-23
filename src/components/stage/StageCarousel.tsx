/**
 * The strip of dots under the stage.
 *
 * Two jobs. Between blocks it is a control: the two setup stages can be
 * answered in either order, and this is how you move between them — before the
 * day starts and, since the day's shape keeps changing, whenever nothing is
 * running afterwards. The rest of the time it is an indicator — it says where
 * in the day you are, and the rest of the dots are there so that "where" means
 * something.
 *
 * Every dot names itself on hover rather than in the layout. Eight labels under
 * a focus timer would be a navigation bar, and the whole design of the stage is
 * that one question is on screen at a time.
 *
 * The dots carry no text content, only `aria-label` and a `data-label` the
 * `stage-dot` utility draws as a pseudo-element. That is deliberate twice over:
 * the browser's own `title` tooltip takes about a second to appear, which is
 * far too slow for something you hover to read; and real text in the DOM here
 * would collide with the timer's own words — "Break" is both a stage and what
 * the timer says during one — and turn every text query on the stage ambiguous.
 * A pseudo-element is visible to the eye and invisible to a locator, which is
 * exactly the arrangement this needs.
 */

import { STAGES, type SetupStageId, type StageId } from './stages'

export function StageCarousel({
  current,
  onNavigate,
}: {
  /** Null hides the strip entirely — see `stageFor`. */
  current: StageId | null
  /** Provided only while the opening questions are reachable. */
  onNavigate?: ((id: SetupStageId) => void) | undefined
}) {
  if (current === null) return null

  return (
    <nav aria-label="Stages of the day" className="flex justify-center">
      <ol className="flex items-center gap-1">
        {STAGES.map((stage, index) => {
          const active = stage.id === current
          // Setup dots are buttons that go somewhere; the rest are buttons that
          // do not, kept as buttons so the label and the accessible name have
          // somewhere legitimate to live. The current one goes nowhere either —
          // it is where you already are.
          const go =
            stage.setup && onNavigate && !active
              ? () => onNavigate(stage.id as SetupStageId)
              : null
          const previous = STAGES[index - 1]
          const seam = previous !== undefined && previous.setup !== stage.setup

          return (
            <li key={stage.id} className="flex items-center">
              {seam && <span aria-hidden className="mr-1 h-3 w-px bg-muted/50" />}
              <button
                type="button"
                data-label={stage.name}
                aria-label={stage.name}
                {...(active ? { 'aria-current': 'step' as const } : {})}
                {...(go ? {} : { 'aria-disabled': true, tabIndex: -1 })}
                onClick={go ?? undefined}
                className={`stage-dot group relative flex items-center p-1.5 ${
                  go ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                {/* 7px rather than a round 8: the strip has to be legible
                    without becoming the thing you look at, and a dot the same
                    size as the text around it is a button. */}
                <span
                  className={`h-[7px] rounded-full transition-all ${
                    active
                      ? 'w-5 bg-deep'
                      : go
                        ? 'w-[7px] bg-body/85 group-hover:bg-bright'
                        : 'w-[7px] bg-muted/80'
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
