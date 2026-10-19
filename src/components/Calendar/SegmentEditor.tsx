/**
 * The three things you can put on the timeline, edited on the timeline.
 *
 * These were dialogs. The argument for that was the same one that keeps
 * settings in a dialog — an aside you dismiss — but it does not survive contact
 * with what they actually are. Adding a commitment is an edit *to* the day
 * drawn beside them, and `Dialog` centres a card over a blurred backdrop, so
 * the one thing you need in order to answer "when?" was the one thing covered
 * up. They expand in place under the calendar header instead, and the hour axis
 * simply gets shorter.
 *
 * Each one mounts when it opens and unmounts when it closes, which is what lets
 * the forms seed from a lazy initialiser. The old dialogs stayed mounted behind
 * an `open` prop, so seeding needed a hook that read the clock through a ref:
 * `now` advances every second, and a seed that depends on it clears the field
 * on every keystroke. Mounting on open removes that problem rather than working
 * around it.
 *
 * Two of them also *change* what is already there: the ✎ on a break or a
 * commitment below opens the same form seeded from it. The same
 * form on purpose — a commitment does not become a different kind of thing once
 * it exists, and the question "when is this, and what does it cost either side"
 * is identical whether it is being answered for the first time or the second.
 * The only difference is where the answer goes, which is the caller's problem.
 *
 * Times are wall clock here, resolved against today's calendar at the edge. The
 * domain only ever sees epoch milliseconds.
 */

import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'

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
import { hoursToSave, TodayHoursFields, useHoursDraft } from '../TodayHours'
import { GhostButton, labelClass, MinutesInput, PrimaryButton, TimeInput } from '../ui'
import { BREAK_MINUTES, parseBoundedMinutes, TAKEN_BREAK_MINUTES } from '../minutes'
import { RoutineLink } from '../RoutineLink'
import type { BreakKind, Clash } from '@/domain/breakRoom'
import { formatClock, nextHalfHour, wallClockOn } from '@/domain/time'
import {
  minutesToMs,
  MINUTE_MS,
  type Commitment,
  type CommitmentPatch,
  type Interval,
  type Ms,
  type PlannedBreak,
  type PlannedBreakPatch,
  type WorkRegion,
} from '@/domain/types'

/** Which of the three forms a composer is. */
export type ComposerKind = 'hours' | 'break' | 'commitment'

/**
 * The composer expanded under the calendar header, if any.
 *
 * Two of the three can also be pointed at something already on the day, which
 * is what `editing` carries: the id of the break or commitment being changed,
 * or `null` for the new one the header buttons open. An id rather than the
 * thing itself, because the plan is re-derived every second and a copy taken
 * when the form opened would be a second, quietly diverging answer to what that
 * commitment is.
 */
export type EntryComposer = { kind: 'break' | 'commitment'; editing: string | null }

export type Composer = { kind: 'hours' } | EntryComposer

/** The composer a header button opens: this form, adding rather than editing. */
export const adding = (kind: ComposerKind): Composer =>
  kind === 'hours' ? { kind } : { kind, editing: null }

/** What this composer is editing, or null while it is adding something new. */
export const editingId = (composer: Composer): string | null =>
  composer.kind === 'hours' ? null : composer.editing

/**
 * The frame every composer shares.
 *
 * A hairline and a heading rather than a floating card: this is part of the
 * calendar, not something laid on top of it, and it should read that way.
 */
function ComposerShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-line bg-surface-raised/40 px-4 py-3">
      <div className="mb-2.5 text-xs font-medium tracking-widest text-muted uppercase">
        {title}
      </div>
      {children}
    </div>
  )
}

/** The row of actions at the foot of a composer. */
const Actions = ({ children }: { children: ReactNode }) => (
  <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
)

// The calendar column is 22rem wide, so the composers run at the small end of
// the button scale. Everywhere else in Mono these are full size.
const composerButton = 'px-3 py-1.5 text-xs'

export function CommitmentComposer({
  now,
  editing,
  onSubmit,
  onCancel,
}: {
  now: Ms
  /**
   * The commitment being changed, or null for a new one. The caller remounts
   * this on a change of identity, which is what lets the seed below be lazy.
   */
  editing: Commitment | null
  /**
   * The commitment as drafted, and only what the draft changed. A new one is
   * added from the first; an edit sends the second, as a break's form does,
   * so what nobody typed is never written back (`CommitmentEdits`).
   */
  onSubmit: (input: Omit<Commitment, 'id'>, changed: CommitmentPatch) => void
  onCancel: () => void
}) {
  // A new one is a whole draft, defaulted to the next round half hour — the
  // most likely answer. An edit is only what has been typed over the
  // commitment as it is now, which can move while the form is open.
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    emptyDraft(format(nextHalfHour(now), 'HH:mm')),
  )
  const [edits, setEdits] = useState<CommitmentEdits>({})
  const shown = editing ? shownDraft(editing, edits) : draft
  const input = readCommitment(now, shown)
  const changed = editing ? readCommitmentChanges(now, editing, edits) : {}
  const ready = input !== null && changed !== null

  return (
    <ComposerShell title={editing ? 'Edit commitment' : 'Next commitment'}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (input && changed) onSubmit(input, changed)
        }}
      >
        <CommitmentFields
          idPrefix="commitment"
          titleLabel="What"
          draft={shown}
          onDraft={(next) => (editing ? setEdits(editsOf(editing, next)) : setDraft(next))}
        />

        {editing?.recurringId !== undefined && <TodayOnlyNote />}

        <p className="mt-3 text-xs leading-relaxed text-muted">
          {editing ? 'Changing' : 'Adding'} this re-derives the plan. Any break you
          pinned inside it — the time either side included — moves to just after it.
        </p>

        <Actions>
          <GhostButton type="button" onClick={onCancel} className={composerButton}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!ready} className={composerButton}>
            {editing ? 'Save' : 'Add'}
          </PrimaryButton>
        </Actions>
      </form>
    </ComposerShell>
  )
}

/**
 * What an edit to one day of a series changes: that day. Said beside the form,
 * because the form looks exactly like the one for a commitment typed in by
 * hand, and with the way to the series itself, which is the other answer.
 * Shared by the calendar's composer and the opening question.
 */
export function TodayOnlyNote() {
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted">
      Changes here apply to today only. To change every day, edit it on <RoutineLink />.
    </p>
  )
}

/**
 * A break as its form edits it: a pin from the plan, or a break already taken
 * from the record. The same form for both, as for a commitment — "when, and
 * for how long" is the one question either asks — with the store's exact
 * instants, since a taken break is seldom a whole number of minutes.
 */
export type EditedBreak = { id: string; startsAt: Ms; endsAt: Ms; kind: BreakKind }

/** What a break laid over `span` would run into, as `breakClash` says. */
export type BreakClashCheck = (
  span: Interval,
  kind: BreakKind,
  edited: EditedBreak | null,
) => Clash | null

export function BreakComposer({
  now,
  editing,
  clash: clashOf,
  onSubmit,
  onCancel,
}: {
  now: Ms
  /** The break being changed, or null for a new pin. */
  editing: EditedBreak | null
  /**
   * What a time would run into, so this form can say no before the reducer
   * has to.
   *
   * A break laid where it may not go is refused there — see `breakClash` —
   * and a refusal the user cannot see is a form that closes having silently
   * done nothing. The rule belongs in the reducer, where an imported log meets
   * it too; the *explanation* belongs here, where the person choosing a time
   * is. Asked of the same function, so the two cannot disagree.
   */
  clash: BreakClashCheck
  /**
   * The break as drafted, and only what the draft changed. A new pin is added
   * from the first; an edit sends the second, so a form opened and saved
   * untouched writes nothing, and never rounds a break taken at 2:00:37 to
   * 2:00 for having been looked at.
   */
  onSubmit: (input: Omit<PlannedBreak, 'id'>, changed: PlannedBreakPatch) => void
  onCancel: () => void
}) {
  const taken = editing?.kind === 'record'
  const bounds = taken ? TAKEN_BREAK_MINUTES : BREAK_MINUTES
  const seededMinutes = editing
    ? Math.max(bounds.min, Math.round((editing.endsAt - editing.startsAt) / MINUTE_MS))
    : BREAK_MINUTES.fallback
  const [seededTime] = useState(() =>
    format(editing ? editing.startsAt : nextHalfHour(now), 'HH:mm'),
  )
  const [time, setTime] = useState(seededTime)
  const [durationText, setDurationText] = useState(String(seededMinutes))

  const timeChanged = editing === null || time !== seededTime
  const lengthChanged = editing === null || durationText !== String(seededMinutes)
  const startsAt = timeChanged ? wallClockOn(now, time) : editing.startsAt
  const durationMin = parseBoundedMinutes(durationText, bounds.min, bounds.max)
  const span: Interval | null =
    startsAt === null || durationMin === null
      ? null
      : {
          start: startsAt,
          end:
            lengthChanged || editing === null
              ? startsAt + minutesToMs(durationMin)
              : startsAt + (editing.endsAt - editing.startsAt),
        }

  // What this break would be laid across, if anything. The thing rather than
  // a boolean, because "that clashes with something" is a worse answer than
  // "that runs into the swim" when the thing to do next is pick another time.
  const clash = span === null ? null : clashOf(span, editing?.kind ?? 'pin', editing)
  const valid = startsAt !== null && durationMin !== null && clash === null

  return (
    <ComposerShell title={taken ? 'Edit break taken' : editing ? 'Edit break' : 'Plan a break'}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (startsAt === null || durationMin === null || clash !== null) return
          onSubmit(
            { startsAt, durationMin },
            {
              ...(timeChanged ? { startsAt } : {}),
              ...(lengthChanged ? { durationMin } : {}),
            },
          )
        }}
      >
        {/* Match the shared commitment pair: the native time control gets a
            complete row on phones and only shares one on wider screens. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className={labelClass} htmlFor="break-time">
              From
            </label>
            <TimeInput
              id="break-time"
              autoFocus
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <MinutesInput
            id="break-duration"
            label="For (minutes)"
            text={durationText}
            onText={setDurationText}
            {...bounds}
          />
        </div>

        {clash && (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            <ClashReason clash={clash} />
          </p>
        )}

        <Actions>
          <GhostButton type="button" onClick={onCancel} className={composerButton}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!valid} className={composerButton}>
            {editing ? 'Save break' : 'Add break'}
          </PrimaryButton>
        </Actions>
      </form>
    </ComposerShell>
  )
}

/** Why a break cannot go there, in the words of the thing in its way. */
function ClashReason({ clash }: { clash: Clash }) {
  switch (clash.kind) {
    case 'commitment':
      return (
        <>
          That runs into <span className="text-bright">{clash.commitment.title}</span>, counting
          the time either side of it.
        </>
      )
    case 'pin':
      return <>That runs into the break planned for {formatClock(clash.startsAt)}.</>
    case 'break':
      return clash.running ? (
        <>That runs into the break you are on.</>
      ) : (
        <>That runs into the break taken at {formatClock(clash.startsAt)}.</>
      )
    case 'block':
      return clash.running ? (
        <>That runs into the block under way.</>
      ) : (
        <>That runs into the block at {formatClock(clash.startsAt)}.</>
      )
    case 'away':
      return <>That runs into time you were away, from {formatClock(clash.startsAt)}.</>
    case 'ahead':
      return <>A break you took has to have ended by now.</>
    case 'elsewhere':
      return <>A break you took stays on the day you took it.</>
  }
}

/**
 * Today's working hours.
 *
 * Editing here overrides the recurring default for this day only — the shape in
 * settings is untouched, and tomorrow starts from it again. *Editing* is the
 * operative word: saving a draft nobody touched hands back `null` rather than
 * an identical list, because writing it would detach today from the recurring
 * shape without changing a single minute of it.
 */
export function HoursComposer({
  now,
  regions,
  onSave,
  onCancel,
}: {
  now: Ms
  regions: readonly WorkRegion[]
  /** Called with `null` when the draft matches the day's current shape. */
  onSave: (regions: WorkRegion[] | null) => void
  onCancel: () => void
}) {
  const { draft, onDraft } = useHoursDraft(regions)

  return (
    <ComposerShell title="Hours">
      <p className="-mt-1 mb-3 text-xs leading-relaxed text-muted">
        Changes here apply to today only. Set your usual hours on <RoutineLink />.
      </p>

      <TodayHoursFields draft={draft} onDraft={onDraft} hideLegend />

      <Actions>
        <GhostButton type="button" onClick={onCancel} className={composerButton}>
          Cancel
        </GhostButton>
        <PrimaryButton
          type="button"
          onClick={() => onSave(hoursToSave(now, draft, regions))}
          className={composerButton}
        >
          Save for today
        </PrimaryButton>
      </Actions>
    </ComposerShell>
  )
}
