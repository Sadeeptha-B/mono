/**
 * The three questions a day opens with.
 *
 * What is already fixed, then what hours you are working, then what you are
 * working on. That order matters: commitments are the part of the day you do
 * not control, so they decide how much of it is left to declare. Asking for
 * hours first means asking again the moment the user remembers the school run.
 * And today's tasks come last because they are only honest once the other two
 * have said how much of the day there is.
 *
 * No question gates another. The carousel under the stage moves between them
 * in any order, and `Start the day` finishes from whichever one you are looking
 * at — so the commitment draft and today's drafts live here, in a component that
 * stays mounted across the switch, rather than in the panels themselves.
 * Nothing typed is lost by changing your mind about which question to answer
 * first.
 *
 * Under each question are `Back` and `Next` as quiet words (`StepNav`), and
 * across a rule under them the button that finishes, at the far end, with
 * its note beside it. Each step
 * used to be a button named after the question it led to, so the hours
 * question offered `Start the day`, `Commitments` and `Today` side by side:
 * three buttons to read and weigh before the obvious move, which is the next
 * question. Now the way through is two fixed words, where they lead is said
 * when pointed at and by the strip, and finishing is the one button. A row of
 * steps of their own, between the question and the finish, was tried and gave
 * the commitments question three levels of buttons under its `Done`.
 *
 * Starting the day does need one task chosen for it, though, which is the
 * asymmetry between this question and the first. A day with nothing fixed in
 * it is ordinary, and "nothing" had to become a complete answer there or a day
 * without meetings could never begin. A day with nothing meant by it is not
 * ordinary, and there is always something to write — so the empty answer here
 * is the one thing worth stopping for. A task, not an intention: an intention
 * is an optional name for some of the tasks, and a day can be answered without
 * one. Only on the first ask: once the day is shaped, coming back is changing
 * your mind, and the way out stays open.
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
 * The first question is a list with a form under it, and the form folds away
 * behind its `Add commitment` heading (`AddFold`), as every add field on the
 * stage and the tasks page does. Once the day has anything fixed in it, the
 * answer to "what's already fixed?" is the list — four fields under it are the
 * *next* answer, asked before the first one has been read. So arriving at the
 * question shows what is there and offers to add another, and a day with
 * nothing fixed yet skips straight to the form, with no caret or × to fold it,
 * because a lone heading over an empty space is a question with the answer
 * hidden behind it. Enter keeps a commitment and leaves the form open for the
 * next; `Done` keeps it and folds; the caret and × fold it without keeping
 * anything. The hours question's `+ Add a stretch` is not one of these: a
 * stretch is a row of the answer itself, not a new thing being written down.
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

import { AddFold, EditGlyph, GhostButton, PrimaryButton, revealOnHover, StagePrompt } from '../ui'
import {
  CommitmentFields,
  editsOf,
  emptyDraft,
  readCommitment,
  readCommitmentChanges,
  shownDraft,
  type CommitmentDraft,
  type CommitmentEdits,
} from '../CommitmentFields'
import { resolveHours, TodayHoursFields } from '../TodayHours'
import { MoveIcon, RepeatIcon } from '../icons'
import { TodayOnlyNote } from '../Calendar/SegmentEditor'
import { RoutineLink } from '../RoutineLink'
import { TodayPanel, type TodayTimer } from './TodayPanel'
import { useIntentionRename } from '../TodayList'
import { useTodayBacklog } from '../useTodayBacklog'
import {
  nextSetupStage,
  previousSetupStage,
  setupStageName,
  type SetupStageId,
} from './stages'
import { formatClock, formatDuration, nextHalfHour } from '@/domain/time'
import {
  commitmentSpan,
  minutesToMs,
  type Commitment,
  type CommitmentPatch,
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
  planned,
  todayTimer,
  intentionMinutes,
  onStartTodayTimer,
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
  /** What the plan can still hold, quoted by today's question. */
  planned: { blocks: number; minutes: number }
  todayTimer: TodayTimer | null
  intentionMinutes: number
  onStartTodayTimer: () => void
  onDone: () => void
}) {
  // A new commitment's draft has nothing in the store to follow, so it is
  // seeded once from a lazy initialiser. `now` ticks every second, and a seed
  // that depends on it reads — while you are typing — as the field clearing
  // itself on every keystroke.
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    emptyDraft(format(nextHalfHour(now), 'HH:mm')),
  )
  // The one below being changed, if the form is pointed at one at all. An id
  // rather than a copy, for the same reason the calendar's composer holds one:
  // the list re-renders from the store every second, and a snapshot taken when
  // the ✎ was clicked would be a second, quietly diverging answer. What is
  // typed into it is held apart, as only the fields typed into
  // (`CommitmentEdits`), so the calendar can drag it or edit it meanwhile and
  // this form neither shows nor saves the old time back.
  const [editing, setEditing] = useState<string | null>(null)
  const [edits, setEdits] = useState<CommitmentEdits>({})
  // Whether the user asked for the form, which is not the same question as
  // whether it is on screen — see `formOpen`. Derived rather than seeded, for
  // the reason `CommitmentFields` folds its margins that way: a form that is
  // pointed at something, or that is the only answer available, has to be
  // visible however this flag happens to be sitting.
  const [expanded, setExpanded] = useState(false)
  // Which question was on screen last render, for the arrival rule below.
  const [seenStage, setSeenStage] = useState(stage)
  // Here rather than in today's panel for the commitment draft's reason: that
  // panel unmounts when you look at another question, and this does not.
  // The new intention's title while its field is open, and a rename.
  const [newIntention, setNewIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  // Whether the day has anything chosen, for the one gate the questions keep.
  const chosen = useTodayBacklog().chosen.length

  const clearForm = () => {
    setEditing(null)
    setEdits({})
    // Cleared rather than kept: the commonest thing after adding one is adding
    // another, and the second is never the first again.
    setDraft(emptyDraft(format(nextHalfHour(now), 'HH:mm')))
  }

  const startEditing = (commitment: Commitment) => {
    setEditing(commitment.id)
    setEdits({})
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
      if (editing !== null && Object.keys(edits).length === 0) clearForm()
    }
  }

  // The commitment the form is pointed at can leave underneath it — removed on
  // the row below, removed from the calendar, or dropped by the midnight
  // filter. Asked of the state rather than of each gesture that produces it,
  // the same rule `DayCalendar` keeps for its own composers, and adjusted
  // during render rather than in an effect so the form never paints a Save
  // aimed at nothing.
  const subject = editing === null ? null : (commitments.find((c) => c.id === editing) ?? null)
  if (editing !== null && subject === null) clearForm()

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
  // Folding is offered only where it would fold something: with nothing in the
  // list the form is the whole question.
  const canFold = inOrder.length > 0 || editing !== null


  // What the form shows, and what keeping it writes: a new commitment whole,
  // or only the fields of an edit that were typed into.
  const shown = subject ? shownDraft(subject, edits) : draft
  const added = subject ? null : readCommitment(now, draft)
  const changes = subject ? readCommitmentChanges(now, subject, edits) : null
  const ready = added !== null || changes !== null
  // Editing one day of a series changes that day only, and the form says so.
  const subjectRecurs = subject?.recurringId !== undefined
  // Mono plans inside working hours and nowhere else, so a day with none of
  // them is a day it can do nothing with. The button says no; the line under it
  // has to say why, and where to fix it.
  const noHours = resolveHours(now, hours).length === 0
  // Counted only once the backlog has loaded and only for tasks still drawn:
  // a task chosen and then deleted is not something the day is for.
  const noTasks = chosen === 0
  const eyebrow = revisiting ? 'Changing today' : 'To begin'

  /** Fold without keeping anything: the caret, the ×, Escape. */
  const fold = () => {
    clearForm()
    setExpanded(false)
  }

  /** Keep what the form says. Enter stays open for the next; `Done` folds. */
  const save = (then: 'next' | 'done') => {
    if (subject) {
      if (changes === null) return
      // Nothing typed is nothing written, as on the calendar's form.
      if (Object.keys(changes).length > 0) onUpdateCommitment(subject.id, changes)
    } else {
      if (added === null) return
      onAddCommitment(added)
    }
    clearForm()
    if (then === 'done') {
      setExpanded(false)
      return
    }
    // Left open, cleared, whichever it was: the commonest thing after writing
    // one of these down is writing another, and folding the form away under
    // the hand that just used it would charge a click for the second.
    setExpanded(true)
  }
  const previous = previousSetupStage(stage)
  const next = nextSetupStage(stage)
  const note = footnote({ stage, revisiting, noHours, noTasks, commitments: commitments.length })

  return (
    <div className="max-w-md">
      {stage === 'commitments' ? (
        <>
          <StagePrompt
            eyebrow={eyebrow}
            title="What are your commitments for today?"
            detail="Anything you can't move. These come first because they decide how much of the day is yours to spend."
          />
          {/* Where the ones that come round every day are kept, so they need
              not be answered here again. Quiet, and under the question rather
              than in it: most mornings it is not what is being asked. */}
          <p className="-mt-2 mb-4 text-xs text-muted">
            Set recurring commitments on <RoutineLink />.
          </p>

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

          <AddFold
            title={editing ? 'Edit commitment' : 'Add commitment'}
            open={formOpen}
            onOpen={openForm}
            onCancel={fold}
            cancelLabel={editing ? 'Cancel editing' : 'Cancel new commitment'}
            canFold={canFold}
            className="text-sm text-body"
          >
            {/* Enter is caught here rather than left to the browser:
              with several fields and no submit button it would do
              nothing, and `Done` means something else. */}
            <form
              onSubmit={(e) => e.preventDefault()}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && canFold) {
                  e.preventDefault()
                  fold()
                }
                if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
                e.preventDefault()
                save('next')
              }}
            >
              <CommitmentFields
                idPrefix="first-commitment"
                // Named for what the form is doing, because with the list above
                // it the fields are the only thing saying which of the two it is.
                titleLabel={editing ? 'This commitment' : 'Next commitment'}
                showTitleLabel={false}
                draft={shown}
                onDraft={(next) => (subject ? setEdits(editsOf(subject, next)) : setDraft(next))}
                large
              />
              {subjectRecurs && <TodayOnlyNote />}
              {/* With nothing written it only folds — which is nothing
                to do while the form is the whole question. With
                something written that does not read yet, it waits
                rather than throw the writing away. */}
              <div className="mt-4">
                <GhostButton
                  type="button"
                  disabled={!ready && (!canFold || shown.title.trim() !== '')}
                  onClick={() => (ready ? save('done') : fold())}
                >
                  Done
                </GhostButton>
              </div>
            </form>
          </AddFold>
        </>
      ) : stage === 'hours' ? (
        <>
          <StagePrompt
            eyebrow={eyebrow}
            title="Are these your hours today?"
            detail={hoursDetail(now, regions.length > 0, withinHours, nextRegionStart)}
          />
          <TodayHoursFields draft={hours} onDraft={onHours} />
          {/* The other half of this answer: what every day starts from. */}
          <p className="mt-3 text-xs text-muted">
            Every day starts from your usual hours, kept on <RoutineLink />.
          </p>
        </>
      ) : (
        <TodayPanel
          now={now}
          eyebrow={eyebrow}
          timer={todayTimer}
          minutes={intentionMinutes}
          onStartTimer={onStartTodayTimer}
          planned={planned}
          newIntention={newIntention}
          onNewIntention={setNewIntention}
          renaming={renaming}
          onRenaming={setRenaming}
        />
      )}

      {/* Outside the forms above, so that Enter in a field adds a commitment
          or a task rather than moving on or ending the setup. */}
      <StepNav previous={previous} next={next} onStage={onStage} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
        {note !== '' && (
          <p className="min-w-0 flex-1 basis-48 text-xs leading-relaxed text-muted">{note}</p>
        )}
        {/* At the far end, past the note on why it will not go yet. */}
        <PrimaryButton
          type="button"
          onClick={onDone}
          disabled={!revisiting && (noHours || noTasks)}
          className="ml-auto"
        >
          {revisiting ? 'Focus' : 'Start the day'}
        </PrimaryButton>
      </div>
    </div>
  )
}

/**
 * `Back` and `Next` between the questions, under each question and above the
 * rule that sets the finish apart: Back at the left, Next at the right, so the
 * hand learns where they are and the eye need not read them. Words rather than buttons, as End early is a word,
 * so the one button under a question is the one that finishes. Where they lead is in their names and
 * on hover, as the strip's dots say theirs, rather than written on them.
 *
 * At either end the one that cannot move stays, said and drawn as unable,
 * rather than going: the press that brought the panel to the last question
 * would otherwise leave the focus on nothing, and the other button would jump
 * across the row. The same rule as a row's arrows at the end of its list.
 */
function StepNav({
  previous,
  next,
  onStage,
}: {
  previous: SetupStageId | null
  next: SetupStageId | null
  onStage: (stage: SetupStageId) => void
}) {
  const step = (to: SetupStageId | null, way: 'back' | 'next') => {
    const word = way === 'back' ? 'Back' : 'Next'
    // Begins with the word it shows, so a name said and a name seen agree.
    const name =
      to === null
        ? word
        : way === 'back'
          ? `Back to ${setupStageName(to)}`
          : `Next: ${setupStageName(to)}`
    return (
      <button
        type="button"
        onClick={to === null ? undefined : () => onStage(to)}
        aria-label={name}
        aria-disabled={to === null || undefined}
        {...(to === null ? {} : { title: setupStageName(to) })}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-bright ${
          to === null ? 'cursor-default text-muted/40' : 'text-body hover:text-bright'
        }`}
      >
        {way === 'back' && <MoveIcon towards="left" />}
        {word}
        {way === 'next' && <MoveIcon towards="right" />}
      </button>
    )
  }
  return (
    <div role="group" aria-label="Between the questions" className="mt-4 -mx-2 flex items-center justify-between gap-2">
      {step(previous, 'back')}
      {step(next, 'next')}
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
  const recurs = commitment.recurringId !== undefined
  const around = span.end - span.start - event

  return (
    <li
      className={`group/row flex items-baseline gap-3 rounded-lg border px-3 py-2 ${
        editing ? 'border-bright/60' : 'border-muted/70'
      }`}
    >
      <span className="tnum shrink-0 text-xs text-commit">
        {formatClock(commitment.startsAt)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm text-bright">
          {recurs && (
            <span title="Recurring" className="text-commit">
              <RepeatIcon />
              <span className="sr-only">Recurring: </span>
            </span>
          )}
          <span className="truncate">{commitment.title}</span>
        </div>
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
      {/* One day of a series is skipped rather than removed: tomorrow's comes
          round as usual, and the series is changed on its own page. Shown on
          hover or with focus in the row, as a task's × is in today's list. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={recurs ? `Skip ${commitment.title} today` : `Remove ${commitment.title}`}
        className={`shrink-0 text-muted transition hover:text-commit ${revealOnHover}`}
      >
        ×
      </button>
    </li>
  )
}

/**
 * The line under `Start the day`: why it will not go, or what it will do.
 *
 * A missing answer outranks everything, hours before tasks, because the
 * button is disabled and this line is the only place that says why. After
 * that it speaks to the question on screen.
 */
function footnote({
  stage,
  revisiting,
  noHours,
  noTasks,
  commitments,
}: {
  stage: SetupStageId
  revisiting: boolean
  noHours: boolean
  noTasks: boolean
  commitments: number
}): string {
  if (noHours) {
    return revisiting
      ? 'No working hours are left, so the rest of the day stays empty. Add a stretch under Hours to plan it.'
      : 'Add at least one stretch under Hours. Mono plans only within your working hours.'
  }
  // Today's tasks are not plan input, so only the other two questions say
  // that coming back re-derives it.
  if (stage === 'today') {
    if (noTasks && !revisiting) return 'Choose at least one task to start the day.'
    return ''
  }
  if (revisiting) return 'Changes here update the plan straight away.'
  if (noTasks) return 'Choose at least one task under Today to start the day.'
  return commitments === 0
    ? 'No commitments today? Start the day and Mono will plan all of it.'
    : 'Add as many as you need. Mono plans the time around them.'
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
    return 'Set your working hours. Mono plans only within them.'
  }
  if (withinHours) return 'Mono plans only within these hours.'
  if (nextRegionStart !== null) {
    return `It's ${formatClock(now)}, and your day starts at ${formatClock(
      nextRegionStart,
    )}. Change it if today is different.`
  }
  return `It's ${formatClock(now)}, past everything below. Add time if you're working late today.`
}
