/**
 * The two questions a day opens with.
 *
 * What is already fixed, then what hours you are working. That order matters:
 * commitments are the part of the day you do not control, so they decide how
 * much of it is left to declare. Asking for hours first means asking again the
 * moment the user remembers the school run.
 *
 * Neither question gates the other. The carousel under the stage moves between
 * them in either direction, and `Start the day` finishes from whichever one you
 * are looking at — so the drafts live here, in a component that stays mounted
 * across the switch, rather than in the panels themselves. Nothing typed is
 * lost by changing your mind about which question to answer first.
 *
 * Finishing appends `day/shaped`. That is a record of having been asked, not of
 * what was said: starting the day with nothing fixed and the usual hours is a
 * complete answer, and before there was somewhere to put it a day with no
 * meetings could never get past the question at all.
 */

import { useState } from 'react'
import { format } from 'date-fns'

import { GhostButton, PrimaryButton, StagePrompt } from '../ui'
import {
  CommitmentFields,
  emptyDraft,
  readCommitment,
  type CommitmentDraft,
} from '../CommitmentFields'
import { hoursToSave, resolveHours, TodayHoursFields, useHoursDraft } from '../TodayHours'
import { otherSetupStage, type SetupStageId } from './stages'
import { formatClock, formatDuration, nextHalfHour } from '@/domain/time'
import {
  commitmentSpan,
  minutesToMs,
  type Commitment,
  type Ms,
  type WorkRegion,
} from '@/domain/types'

export function DaySetupPanel({
  now,
  stage,
  onStage,
  regions,
  withinHours,
  nextRegionStart,
  commitments,
  onAddCommitment,
  onRemoveCommitment,
  onSaveRegions,
  onDone,
}: {
  now: Ms
  stage: SetupStageId
  onStage: (stage: SetupStageId) => void
  regions: readonly WorkRegion[]
  /** Whether `now` falls inside one of them. */
  withinHours: boolean
  nextRegionStart: Ms | null
  commitments: readonly Commitment[]
  onAddCommitment: (input: Omit<Commitment, 'id'>) => void
  onRemoveCommitment: (id: string) => void
  onSaveRegions: (regions: WorkRegion[]) => void
  onDone: () => void
}) {
  // The hours draft follows the day until it is typed into — see `useHoursDraft`.
  const { draft: hours, onDraft: setHours } = useHoursDraft(regions)

  // The commitment draft has nothing in the store to follow, so it is seeded
  // once from a lazy initialiser. `now` ticks every second, and a seed that
  // depends on it reads — while you are typing — as the field clearing itself
  // on every keystroke.
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    emptyDraft(format(nextHalfHour(now), 'HH:mm')),
  )

  const finish = () => {
    // An untouched draft is left alone rather than written back — see
    // `hoursToSave`. Saving it would stamp an override on every single day, and
    // today's regions are meant to stay *derived* from the recurring shape.
    const next = hoursToSave(now, hours, regions)
    if (next) onSaveRegions(next)
    onDone()
  }

  const ready = readCommitment(now, draft)
  // Mono plans inside working hours and nowhere else, so a day with none of
  // them is a day it can do nothing with. The button says no; the line under it
  // has to say why, and where to fix it.
  const noHours = resolveHours(now, hours).length === 0

  return (
    <div className="max-w-md">
      {stage === 'commitments' ? (
        <>
          <StagePrompt
            eyebrow="To begin"
            title="What's already fixed today?"
            detail="Anything you can't move. These come first because they decide how much of the day is yours to spend."
          />

          {commitments.length > 0 && (
            <ul className="mb-4 flex flex-col gap-1.5">
              {commitments.map((commitment) => (
                <CommitmentRow
                  key={commitment.id}
                  commitment={commitment}
                  onRemove={() => onRemoveCommitment(commitment.id)}
                />
              ))}
            </ul>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!ready) return
              onAddCommitment(ready)
              // Cleared rather than kept: the commonest thing after adding one
              // is adding another, and the second is never the first again.
              setDraft(emptyDraft(format(nextHalfHour(now), 'HH:mm')))
            }}
          >
            <CommitmentFields
              idPrefix="first-commitment"
              titleLabel="Next commitment"
              showTitleLabel={false}
              draft={draft}
              onDraft={setDraft}
              large
            />
            <div className="mt-4">
              <GhostButton type="submit" disabled={!ready}>
                Add commitment
              </GhostButton>
            </div>
          </form>
        </>
      ) : (
        <>
          <StagePrompt
            eyebrow="To begin"
            title="Are these your hours today?"
            detail={hoursDetail(now, regions.length > 0, withinHours, nextRegionStart)}
          />
          <TodayHoursFields draft={hours} onDraft={setHours} now={now} />
        </>
      )}

      {/* Outside the form above, so that Enter in a field adds a commitment
          rather than ending the setup. */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <PrimaryButton type="button" onClick={finish} disabled={noHours}>
          Start the day
        </PrimaryButton>
        <GhostButton type="button" onClick={() => onStage(otherSetupStage(stage))}>
          {stage === 'commitments' ? "Today's hours" : "What's already fixed"}
        </GhostButton>
        <p className="w-full text-xs leading-relaxed text-muted">
          {noHours
            ? "Mono plans inside your working hours and nowhere else, so it needs at least one stretch. Add one under Today's hours."
            : commitments.length === 0
              ? 'Nothing fixed today? Start the day and Mono will plan the whole of it.'
              : 'Add as many as you like. Mono plans the runway between them.'}
        </p>
      </div>
    </div>
  )
}

/** One commitment already named, with what it really costs the day. */
function CommitmentRow({
  commitment,
  onRemove,
}: {
  commitment: Commitment
  onRemove: () => void
}) {
  const span = commitmentSpan(commitment)
  const event = minutesToMs(commitment.durationMin)
  const around = span.end - span.start - event

  return (
    <li className="flex items-baseline gap-3 rounded-lg border border-line px-3 py-2">
      <span className="tnum shrink-0 text-xs text-commit">
        {formatClock(commitment.startsAt)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-bright">{commitment.title}</span>
      <span className="tnum shrink-0 text-xs text-muted">
        {formatDuration(event)}
        {around > 0 && ` + ${formatDuration(around)} around`}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${commitment.title}`}
        className="shrink-0 text-muted transition hover:text-commit"
      >
        ×
      </button>
    </li>
  )
}

/**
 * What to say above the hours, given where the clock is.
 *
 * Opening Mono before the day starts is the commonest time to be looking at
 * this, and "outside working hours" would be a strange thing to be told by the
 * form that decides where those hours are. So the time is context here rather
 * than a refusal.
 */
function hoursDetail(
  now: Ms,
  hasRegions: boolean,
  withinHours: boolean,
  nextRegionStart: Ms | null,
): string {
  if (!hasRegions) {
    return "You haven't set any working hours yet. Mono plans inside these and nowhere else."
  }
  if (withinHours) return 'Mono plans inside these and nowhere else.'
  if (nextRegionStart !== null) {
    return `It's ${formatClock(now)} — your day starts at ${formatClock(
      nextRegionStart,
    )}. Adjust if that's not right today.`
  }
  return `It's ${formatClock(now)}, past everything below. Adjust if you are working later than usual.`
}
