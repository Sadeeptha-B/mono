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
 * are looking at — so the commitment draft lives here, in a component that
 * stays mounted across the switch, rather than in the panels themselves.
 * Nothing typed is lost by changing your mind about which question to answer
 * first.
 *
 * The hours draft used to live here too, and now lives in `App`, one level up.
 * Not for the switch — this component survives that — but because the calendar
 * beside it draws the plan those hours produce, and a draft nobody outside this
 * panel can see is a day being described to an app that cannot hear it. The
 * timeline re-derives from the draft as it is typed; see the note on
 * `hoursPreview` in `App`.
 *
 * Finishing appends `day/shaped`. That is a record of having been asked, not of
 * what was said: starting the day with nothing fixed and the usual hours is a
 * complete answer, and before there was somewhere to put it a day with no
 * meetings could never get past the question at all.
 *
 * The same panel comes back when the questions are re-opened from the strip
 * later in the day, which is what `revisiting` is for. Only the way out
 * differs: the day has already been shaped, so there is nothing to record and
 * nothing to gate — a day whose hours you have just deleted is a decision, not
 * an unfinished answer, and the calendar's own hours editor has always allowed
 * it.
 */

import { useState } from 'react'
import { format } from 'date-fns'

import { EditGlyph, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import {
  CommitmentFields,
  draftFromCommitment,
  emptyDraft,
  readCommitment,
  readCommitmentEdit,
  type CommitmentDraft,
} from '../CommitmentFields'
import { resolveHours, TodayHoursFields } from '../TodayHours'
import { otherSetupStage, type SetupStageId } from './stages'
import { formatClock, formatDuration, nextHalfHour } from '@/domain/time'
import {
  commitmentSpan,
  minutesToMs,
  type Commitment,
  type DefaultRegion,
  type Ms,
  type WorkRegion,
} from '@/domain/types'

export function DaySetupPanel({
  now,
  stage,
  onStage,
  revisiting,
  regions,
  hours,
  onHours,
  withinHours,
  nextRegionStart,
  commitments,
  onAddCommitment,
  onUpdateCommitment,
  onRemoveCommitment,
  onDone,
}: {
  now: Ms
  stage: SetupStageId
  onStage: (stage: SetupStageId) => void
  /** Re-opened after the day was already shaped, rather than the first ask. */
  revisiting: boolean
  /** The day as it currently reads, draft included — what the calendar draws. */
  regions: readonly WorkRegion[]
  /** Today's hours as wall clock, owned by `App` so the calendar can follow. */
  hours: DefaultRegion[]
  onHours: (draft: DefaultRegion[]) => void
  /** Whether `now` falls inside one of them. */
  withinHours: boolean
  nextRegionStart: Ms | null
  commitments: readonly Commitment[]
  onAddCommitment: (input: Omit<Commitment, 'id'>) => void
  onUpdateCommitment: (id: string, patch: Partial<Commitment>) => void
  onRemoveCommitment: (id: string) => void
  onDone: () => void
}) {
  // The commitment draft has nothing in the store to follow, so it is seeded
  // once from a lazy initialiser. `now` ticks every second, and a seed that
  // depends on it reads — while you are typing — as the field clearing itself
  // on every keystroke.
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    emptyDraft(format(nextHalfHour(now), 'HH:mm')),
  )
  // The one below being changed, if the form is pointed at one at all. An id
  // rather than a copy, for the same reason the calendar's composer holds one:
  // the list re-renders from the store every second, and a snapshot taken when
  // the ✎ was clicked would be a second, quietly diverging answer.
  const [editing, setEditing] = useState<string | null>(null)

  const clearForm = () => {
    setEditing(null)
    // Cleared rather than kept: the commonest thing after adding one is adding
    // another, and the second is never the first again.
    setDraft(emptyDraft(format(nextHalfHour(now), 'HH:mm')))
  }

  const startEditing = (commitment: Commitment) => {
    setEditing(commitment.id)
    setDraft(draftFromCommitment(commitment))
  }

  // The commitment the form is pointed at can leave underneath it — removed on
  // the row below, removed from the calendar, or dropped by the midnight
  // filter. Asked of the state rather than of each gesture that produces it,
  // the same rule `DayCalendar` keeps for its own composers, and adjusted
  // during render rather than in an effect so the form never paints a Save
  // aimed at nothing.
  if (editing !== null && !commitments.some((c) => c.id === editing)) clearForm()

  // In the order the day happens, whatever order they were named in. The list
  // is a reading of the day rather than a list of what you typed, and a 9am
  // standup added after a 4pm swim belongs above it — the same order the
  // calendar draws them in, and the same one the planner works through.
  const inOrder = [...commitments].sort((a, b) => a.startsAt - b.startsAt)

  // Not the same read: an edit is merged onto what is already there, so it has
  // to say a margin is zero rather than leave it out. See `readCommitmentEdit`.
  const ready = editing ? readCommitmentEdit(now, draft) : readCommitment(now, draft)
  // Mono plans inside working hours and nowhere else, so a day with none of
  // them is a day it can do nothing with. The button says no; the line under it
  // has to say why, and where to fix it.
  const noHours = resolveHours(now, hours).length === 0
  const eyebrow = revisiting ? 'Changing today' : 'To begin'

  return (
    <div className="max-w-md">
      {stage === 'commitments' ? (
        <>
          <StagePrompt
            eyebrow={eyebrow}
            title="What's already fixed today?"
            detail="Anything you can't move. These come first because they decide how much of the day is yours to spend."
          />

          {/* Named, because the stage strip below is a list too, and "the
              commitments" has to be reachable as one thing. */}
          {inOrder.length > 0 && (
            <ul aria-label="Fixed today" className="mb-4 flex flex-col gap-1.5">
              {inOrder.map((commitment) => (
                <CommitmentRow
                  key={commitment.id}
                  commitment={commitment}
                  editing={commitment.id === editing}
                  onEdit={() => startEditing(commitment)}
                  onRemove={() => onRemoveCommitment(commitment.id)}
                />
              ))}
            </ul>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!ready) return
              if (editing) onUpdateCommitment(editing, ready)
              else onAddCommitment(ready)
              clearForm()
            }}
          >
            <CommitmentFields
              idPrefix="first-commitment"
              // Named for what the form is doing, because with the list above
              // it the fields are the only thing saying which of the two it is.
              titleLabel={editing ? 'This commitment' : 'Next commitment'}
              showTitleLabel={false}
              draft={draft}
              onDraft={setDraft}
              large
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <GhostButton type="submit" disabled={!ready}>
                {editing ? 'Save commitment' : 'Add commitment'}
              </GhostButton>
              {editing && (
                <GhostButton type="button" onClick={clearForm}>
                  Cancel
                </GhostButton>
              )}
            </div>
          </form>
        </>
      ) : (
        <>
          <StagePrompt
            eyebrow={eyebrow}
            title="Are these your hours today?"
            detail={hoursDetail(now, regions.length > 0, withinHours, nextRegionStart)}
          />
          <TodayHoursFields draft={hours} onDraft={onHours} now={now} />
        </>
      )}

      {/* Outside the form above, so that Enter in a field adds a commitment
          rather than ending the setup. */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <PrimaryButton type="button" onClick={onDone} disabled={!revisiting && noHours}>
          {revisiting ? 'Back to the day' : 'Start the day'}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => onStage(otherSetupStage(stage))}>
          {stage === 'commitments' ? "Today's hours" : "What's already fixed"}
        </GhostButton>
        <p className="w-full text-xs leading-relaxed text-muted">
          {noHours
            ? revisiting
              ? "With no stretches left under Today's hours there is nowhere for Mono to plan. Go back and the rest of the day stays empty."
              : "Mono plans inside your working hours and nowhere else, so it needs at least one stretch. Add one under Today's hours."
            : revisiting
              ? 'Anything you change here re-derives the plan. Nothing running is disturbed.'
              : commitments.length === 0
                ? 'Nothing fixed today? Start the day and Mono will plan the whole of it.'
                : 'Add as many as you like. Mono plans the runway between them.'}
        </p>
      </div>
    </div>
  )
}

/**
 * One commitment already named, with what it really costs the day.
 *
 * Both controls are always visible, unlike the pair on a calendar block. Those
 * hide until the pointer arrives because the axis is a picture of the day and
 * ✎ glyphs all over it would be noise; this is a list inside a form, where
 * anything you can do to a row should be on the row.
 *
 * The cost sits under the title rather than beside it. On one line the two
 * compete for the same pixels and the title is the one that loses — a phone
 * showed `4:00 PM  S…  1h 00m + 50m around`, which names the wrong half of the
 * row. Stacked, the title has the width to itself at every size.
 */
function CommitmentRow({
  commitment,
  editing,
  onEdit,
  onRemove,
}: {
  commitment: Commitment
  /** True while the form below is pointed at this one. */
  editing: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const span = commitmentSpan(commitment)
  const event = minutesToMs(commitment.durationMin)
  const around = span.end - span.start - event

  return (
    <li
      className={`flex items-baseline gap-3 rounded-lg border px-3 py-2 ${
        editing ? 'border-bright/60' : 'border-line'
      }`}
    >
      <span className="tnum shrink-0 text-xs text-commit">
        {formatClock(commitment.startsAt)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-bright">{commitment.title}</div>
        <div className="tnum text-xs text-muted">
          {formatDuration(event)}
          {around > 0 && ` + ${formatDuration(around)} around`}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${commitment.title}`}
        className="shrink-0 text-muted transition hover:text-bright"
      >
        <EditGlyph />
      </button>
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
