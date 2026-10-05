/**
 * The three questions a day opens with.
 *
 * What is already fixed, then what hours you are working, then what the day is
 * for. That order matters: commitments are the part of the day you do not
 * control, so they decide how much of it is left to declare. Asking for hours
 * first means asking again the moment the user remembers the school run. And
 * intentions come last because they are only honest once the other two have
 * said how much of the day there is.
 *
 * No question gates another. The carousel under the stage moves between them
 * in any order, and `Start the day` finishes from whichever one you are looking
 * at — so the commitment and intention drafts live here, in a component that
 * stays mounted across the switch, rather than in the panels themselves.
 * Nothing typed is lost by changing your mind about which question to answer
 * first.
 *
 * Starting the day does need one intention, though, which is the asymmetry
 * between this question and the first. A day with nothing fixed in it is
 * ordinary, and "nothing" had to become a complete answer there or a day
 * without meetings could never begin. A day with nothing meant by it is not
 * ordinary, and there is always something to write — so the empty answer here
 * is the one thing worth stopping for. Only on the first ask: once the day is
 * shaped, coming back is changing your mind, and the way out stays open.
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
 * The first question is a list with a form under it, and the form folds away.
 * Once the day has anything fixed in it, the answer to "what's already fixed?"
 * is the list — four fields under it are the *next* answer, asked before the
 * first one has been read. So arriving at the question shows what is there and
 * offers to add another, and a day with nothing fixed yet skips straight to the
 * form, because a lone button over an empty space is a question with the answer
 * hidden behind it.
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
  draftsMatch,
  emptyDraft,
  readCommitment,
  readCommitmentEdit,
  type CommitmentDraft,
} from '../CommitmentFields'
import { resolveHours, TodayHoursFields } from '../TodayHours'
import {
  emptyIntentionDraft,
  IntentionsPanel,
  type IntentionDraft,
  type IntentionTimer,
} from './IntentionsPanel'
import {
  nextSetupStage,
  previousSetupStage,
  setupStageName,
  type SetupStageId,
} from './stages'
import type { Area } from '@/domain/tasks'
import { formatClock, formatDuration, nextHalfHour } from '@/domain/time'
import {
  commitmentSpan,
  minutesToMs,
  type Commitment,
  type CommitmentPatch,
  type DefaultRegion,
  type Intention,
  type IntentionPatch,
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
  intentions,
  areas,
  planned,
  intentionTimer,
  intentionMinutes,
  onStartIntentionTimer,
  onAddIntention,
  onUpdateIntention,
  onRemoveIntention,
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
  onUpdateCommitment: (id: string, patch: CommitmentPatch) => void
  onRemoveCommitment: (id: string) => void
  intentions: readonly Intention[]
  /** Areas an intention can point at. */
  areas: readonly Area[]
  /** What the plan can still hold, quoted by the intentions question. */
  planned: { blocks: number; minutes: number }
  intentionTimer: IntentionTimer | null
  intentionMinutes: number
  onStartIntentionTimer: () => void
  onAddIntention: (input: Omit<Intention, 'id'>) => void
  onUpdateIntention: (id: string, patch: IntentionPatch) => void
  onRemoveIntention: (id: string) => void
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
  // Whether the user asked for the form, which is not the same question as
  // whether it is on screen — see `formOpen`. Derived rather than seeded, for
  // the reason `CommitmentFields` folds its margins that way: a form that is
  // pointed at something, or that is the only answer available, has to be
  // visible however this flag happens to be sitting.
  const [expanded, setExpanded] = useState(false)
  // Which question was on screen last render, for the arrival rule below.
  const [seenStage, setSeenStage] = useState(stage)
  // Here rather than in the intentions panel for the commitment draft's reason:
  // that panel unmounts when you look at another question, and this does not.
  const [intentionDraft, setIntentionDraft] = useState<IntentionDraft>(emptyIntentionDraft)
  // An edit whose intention was removed — here, or by the midnight reset —
  // points at nothing. Adjusted during render, as the commitment form is.
  if (
    intentionDraft.editing !== null &&
    !intentions.some((i) => i.id === intentionDraft.editing)
  ) {
    setIntentionDraft(emptyIntentionDraft)
  }

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

  /**
   * Open the form to add another.
   *
   * Re-seeded on the way open rather than only at mount. The panel can sit here
   * for hours — it is the stage between blocks — and "the next round half hour"
   * is a good default at the moment you ask for the form and a puzzle two hours
   * later.
   *
   * Only over a draft with nothing named in it, though. The fold now closes on
   * arrival at this question, which means it can close over something
   * half-written, and a default time is not worth overwriting a commitment
   * somebody had begun to describe.
   */
  const openForm = () => {
    setExpanded(true)
    if (draft.title.trim() === '') setDraft(emptyDraft(format(nextHalfHour(now), 'HH:mm')))
  }

  // Coming back to the question asks it again, and the answer to it is the
  // list. Adjusted during render rather than in an effect, so the form never
  // paints open for a frame on the way in.
  //
  // An edit is folded away too, but only one nobody has touched: opening the ✎
  // and wandering off to the other question leaves a form that is showing
  // rather than work in progress, and it should not be waiting when you come
  // back. A *changed* edit stays, because this panel's oldest rule is that
  // nothing typed is lost by changing your mind about which question to answer
  // first, and the row it belongs to says which one it is.
  if (seenStage !== stage) {
    setSeenStage(stage)
    if (stage === 'commitments') {
      setExpanded(false)
      const subject = editing === null ? null : commitments.find((c) => c.id === editing)
      if (subject && draftsMatch(draft, draftFromCommitment(subject))) clearForm()
    }
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

  // Asked for, pointed at something, or the only thing there is to say. The
  // last of those is why this is derived: removing the last commitment while
  // the form is folded away has to leave the question answerable, and it does
  // so without anything having to notice the removal.
  const formOpen = expanded || editing !== null || inOrder.length === 0

  // Not the same read: an edit is merged onto what is already there, so it has
  // to say a margin is zero rather than leave it out. See `readCommitmentEdit`.
  const ready = editing ? readCommitmentEdit(now, draft) : readCommitment(now, draft)
  // Mono plans inside working hours and nowhere else, so a day with none of
  // them is a day it can do nothing with. The button says no; the line under it
  // has to say why, and where to fix it.
  const noHours = resolveHours(now, hours).length === 0
  const noIntentions = intentions.length === 0
  const eyebrow = revisiting ? 'Changing today' : 'To begin'
  const previous = previousSetupStage(stage)
  const next = nextSetupStage(stage)

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

          {formOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!ready) return
                if (editing) onUpdateCommitment(editing, ready)
                else onAddCommitment(ready)
                clearForm()
                // Left open, cleared, whichever it was: the commonest thing
                // after writing one of these down is writing another, and
                // folding the form away under the hand that just used it would
                // charge a click for the second.
                setExpanded(true)
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
                {/* No way out of a form that is the whole question: with
                    nothing in the list there is nothing to fold back to. */}
                {inOrder.length > 0 && (
                  <GhostButton
                    type="button"
                    onClick={() => {
                      clearForm()
                      setExpanded(false)
                    }}
                  >
                    Cancel
                  </GhostButton>
                )}
              </div>
            </form>
          ) : (
            <GhostButton type="button" onClick={openForm}>
              + Another commitment
            </GhostButton>
          )}
        </>
      ) : stage === 'hours' ? (
        <>
          <StagePrompt
            eyebrow={eyebrow}
            title="Are these your hours today?"
            detail={hoursDetail(now, regions.length > 0, withinHours, nextRegionStart)}
          />
          <TodayHoursFields draft={hours} onDraft={onHours} now={now} />
        </>
      ) : (
        <IntentionsPanel
          now={now}
          eyebrow={eyebrow}
          timer={intentionTimer}
          minutes={intentionMinutes}
          onStartTimer={onStartIntentionTimer}
          planned={planned}
          intentions={intentions}
          areas={areas}
          draft={intentionDraft}
          onDraft={setIntentionDraft}
          onAdd={onAddIntention}
          onUpdate={onUpdateIntention}
          onRemove={onRemoveIntention}
        />
      )}

      {/* Outside the forms above, so that Enter in a field adds a commitment
          or an intention rather than ending the setup. */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <PrimaryButton
          type="button"
          onClick={onDone}
          disabled={!revisiting && (noHours || noIntentions)}
        >
          {revisiting ? 'Back to the day' : 'Start the day'}
        </PrimaryButton>
        {/* Named after the question they lead to, like its dot in the strip. */}
        {previous && (
          <GhostButton type="button" onClick={() => onStage(previous)}>
            {setupStageName(previous)}
          </GhostButton>
        )}
        {next && (
          <GhostButton type="button" onClick={() => onStage(next)}>
            {setupStageName(next)}
          </GhostButton>
        )}
        <p className="w-full text-xs leading-relaxed text-muted">
          {footnote({ stage, revisiting, noHours, noIntentions, commitments: commitments.length })}
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
        editing ? 'border-bright/60' : 'border-muted/70'
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
 * The line under `Start the day`: why it will not go, or what it will do.
 *
 * A missing answer outranks everything, hours before intentions, because the
 * button is disabled and this line is the only place that says why. After
 * that it speaks to the question on screen.
 */
function footnote({
  stage,
  revisiting,
  noHours,
  noIntentions,
  commitments,
}: {
  stage: SetupStageId
  revisiting: boolean
  noHours: boolean
  noIntentions: boolean
  commitments: number
}): string {
  if (noHours) {
    return revisiting
      ? "With no stretches left under Today's hours there is nowhere for Mono to plan. Go back and the rest of the day stays empty."
      : "Mono plans inside your working hours and nowhere else, so it needs at least one stretch. Add one under Today's hours."
  }
  if (revisiting) return 'Anything you change here re-derives the plan. Nothing running is disturbed.'
  if (noIntentions) {
    return stage === 'intentions'
      ? 'Name at least one thing today is for, and the day can start.'
      : "Before the day starts, name at least one thing it is for under Today's intentions."
  }
  if (stage === 'intentions') return 'A handful is plenty. You can change them between blocks.'
  return commitments === 0
    ? 'Nothing fixed today? Start the day and Mono will plan the whole of it.'
    : 'Add as many as you like. Mono plans the runway between them.'
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
