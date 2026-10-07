/**
 * The event log.
 *
 * Session state is a fold over an append-only list of events rather than a
 * mutable object. Two reasons: replaying is how we recover after a reload, and
 * the log is the raw material for the history the author will actually want —
 * which blocks were completed, which were abandoned, and what each one was for.
 *
 * `reduce` is pure. Nothing here reads the clock; every event carries the `at`
 * it happened.
 *
 * It does read the local calendar, in one place: which day a series of
 * recurring commitments is being asked about is the local day containing an
 * event's `at` (`commitmentsFor`). That is what lets the pin rules below see
 * today's standup without a stored copy of it. The cost is that a log replayed
 * in another time zone could put an occurrence somewhere else; on the device
 * that wrote it, replay is exactly as deterministic as before.
 */

import {
  breakSpan,
  commitmentSpan,
  DEFAULT_SETTINGS,
  minutesToMs,
  overlaps,
  type ActiveSegment,
  type BlockKind,
  type BlockNote,
  type Commitment,
  type CommitmentPatch,
  type CompletedSegment,
  type Intention,
  type IntentionPatch,
  type Interval,
  type Ms,
  type PlannedBreak,
  type PlannedBreakPatch,
  type RecurringCommitment,
  type RecurringPatch,
  type Settings,
  type WorkRegion,
} from './types'
import { occurrenceOn } from './recurrence'

export type MonoEvent =
  | { type: 'settings/changed'; at: Ms; patch: Partial<Settings> }
  | { type: 'commitment/added'; at: Ms; commitment: Commitment }
  | { type: 'commitment/updated'; at: Ms; id: string; patch: CommitmentPatch }
  | { type: 'commitment/removed'; at: Ms; id: string }
  | { type: 'region/set'; at: Ms; regions: WorkRegion[] }
  | { type: 'break/planned'; at: Ms; plannedBreak: PlannedBreak }
  | { type: 'break/updated'; at: Ms; id: string; patch: PlannedBreakPatch }
  | { type: 'break/removed'; at: Ms; id: string }
  | {
      type: 'block/started'
      at: Ms
      id: string
      blockKind: BlockKind
      /** Absolute. The block owns this instant regardless of tick delivery. */
      endsAt: Ms
      purpose: string | null
      /**
       * The backlog tasks this block is for. Absent from every block started
       * before tasks existed, and from a priorities block, which is for working
       * out what the tasks are.
       */
      taskIds?: string[]
    }
  | { type: 'block/purposeSet'; at: Ms; purpose: string }
  /**
   * A line written in the running block, at `at`, which becomes the note's
   * own minute. Ignored with no block running.
   */
  | { type: 'block/noted'; at: Ms; id: string; text: string }
  /** One urge to leave the task, counted in the running block. */
  | { type: 'block/urged'; at: Ms }
  /** The running block's most recent urge, taken back as a mis-tap. */
  | { type: 'block/urgeTakenBack'; at: Ms }
  /**
   * A note's text corrected, in the running block or one already in history.
   * The note keeps its own `at`: a fixed typo is not a later thought.
   */
  | { type: 'block/noteEdited'; at: Ms; blockId: string; noteId: string; text: string }
  /** A note deleted, in the running block or one already in history. */
  | { type: 'block/noteRemoved'; at: Ms; blockId: string; noteId: string }
  | { type: 'block/completed'; at: Ms }
  | { type: 'block/abandoned'; at: Ms }
  | { type: 'break/started'; at: Ms; id: string; endsAt: Ms }
  | { type: 'break/ended'; at: Ms }
  | { type: 'away/recorded'; at: Ms; from: Ms; to: Ms }
  | { type: 'day/reset'; at: Ms }
  | { type: 'day/shaped'; at: Ms }
  | { type: 'intention/added'; at: Ms; intention: Intention }
  | { type: 'intention/updated'; at: Ms; id: string; patch: IntentionPatch }
  | { type: 'intention/removed'; at: Ms; id: string }
  /**
   * Put a task under one of today's intentions, or take it out with `null`.
   * Linking moves: a task belongs to at most one intention a day. Linking a
   * task not yet chosen for today chooses it; unlinking leaves it chosen.
   */
  | { type: 'intention/taskLinked'; at: Ms; taskId: string; intentionId: string | null }
  /** Choose a task for today. Choosing one already chosen changes nothing. */
  | { type: 'today/taskAdded'; at: Ms; taskId: string }
  /** Put a task back out of today, and out of whichever intention held it. */
  | { type: 'today/taskRemoved'; at: Ms; taskId: string }
  /** A series of commitments that comes round on a schedule. See `commitmentsFor`. */
  | { type: 'recurring/added'; at: Ms; rule: RecurringCommitment }
  | { type: 'recurring/updated'; at: Ms; id: string; patch: RecurringPatch }
  | { type: 'recurring/removed'; at: Ms; id: string }

export type SessionState = {
  settings: Settings
  commitments: Commitment[]
  /** Immutable past, oldest first. */
  history: CompletedSegment[]
  /** The one running block or break, if any. */
  active: ActiveSegment | null
  /** Breaks the user pinned onto the future timeline. */
  overrides: PlannedBreak[]
  /**
   * This day's work regions, once the user has edited them. `null` means the
   * day still follows the recurring default shape in settings — so changing
   * that default immediately reshapes every day not yet customised.
   */
  regionOverrides: WorkRegion[] | null
  /**
   * When the user answered the day's opening questions, or `null` if they have
   * not yet.
   *
   * This is a record of *being asked*, not of what was answered. "No meetings
   * today" and "09:00–18:00 is right" are both real answers, and neither leaves
   * a trace anywhere else in the state — so gating the opening prompt on the
   * commitments list, as it used to be, meant a day with nothing fixed in it
   * could never get past the question.
   */
  shapedAt: Ms | null
  /**
   * The groups today's tasks are gathered into, in the order they were named.
   * Optional: a day is answered by its tasks, and an intention is a name given
   * to some of them. Cleared at midnight.
   */
  intentions: Intention[]
  /**
   * The tasks chosen for today, by task id, each with the intention it is
   * under or `null` for none.
   *
   * One map for both answers, so whether a task is today's and which intention
   * holds it can never disagree: a task under an intention is today's by
   * construction. A map rather than a list on each intention because the rule
   * it keeps is about the task — one intention a day — and a map cannot hold
   * two answers for the same key. Tasks are backlog records and know nothing
   * about days; the day knows about them, which is why this is here rather
   * than a date on the task. A date on a long-lived record would be a stored
   * schedule that someone has to clear.
   */
  today: Record<string, string | null>
  /**
   * The tasks chosen on the last day that chose any, for the next day to
   * offer again. Kept by the fold rather than stored anywhere, and replaced at
   * the next reset after a day that chose something, so a suggestion nobody
   * took expires on its own once another working day has been and gone. A day
   * that chose nothing leaves it alone: a tab left open over a weekend turns
   * over at every midnight, and Saturday's empty day must not throw away
   * Friday's unfinished work before Monday asks. Which of them are still worth
   * offering — open, in play, not chosen again — is the backlog's question,
   * asked where they are shown (`carriedOver`).
   */
  lastDay: string[]
  /**
   * The commitments that come round on a schedule. Rules, not days: what each
   * puts into a day is derived by `commitmentsFor`. Like settings, they are
   * about every day rather than this one, so the midnight reset leaves them be.
   */
  recurring: RecurringCommitment[]
  /**
   * Occurrences of a series that this day has said no to, by occurrence id.
   * Removing today's standup is a decision about today, so it is recorded
   * here and cleared at midnight; tomorrow's comes round as usual.
   */
  skipped: string[]
}

export const initialState: SessionState = {
  settings: DEFAULT_SETTINGS,
  commitments: [],
  history: [],
  active: null,
  overrides: [],
  regionOverrides: null,
  shapedAt: null,
  intentions: [],
  today: {},
  lastDay: [],
  recurring: [],
  skipped: [],
}

export function reduce(state: SessionState, event: MonoEvent): SessionState {
  switch (event.type) {
    case 'settings/changed':
      return { ...state, settings: { ...state.settings, ...event.patch } }

    case 'commitment/added':
      return {
        ...state,
        commitments: [...state.commitments, event.commitment],
        // Only the pins this commitment would swallow. See `pinsClearOf`.
        overrides: pinsClearOf(
          state.overrides,
          commitmentSpan(event.commitment),
          event.at,
        ),
      }

    // Editing a commitment moves the same walls that adding one does — a
    // meeting pushed an hour later takes the runway with it — so the pins go
    // for exactly the reason they go above, and only the same ones. Measured
    // against where the meeting *ends up*, which is the shape the day now has.
    // The slot it vacated needs no thought, because nothing was ever allowed to
    // pin a break inside it — see `clashesWithCommitment`.
    //
    // An edit to today's occurrence of a series gives the day its own copy,
    // under the occurrence's id and with the edit applied. From then on the
    // day follows the copy rather than the rule — moving today's standup is
    // not moving every standup — as an edited day's hours stop following the
    // default shape. The same id, so the entry on the calendar moves rather
    // than being replaced by a different one.
    case 'commitment/updated': {
      const existing = state.commitments.find((c) => c.id === event.id)
      if (existing) {
        const updated = { ...existing, ...event.patch }
        return {
          ...state,
          commitments: state.commitments.map((c) => (c.id === event.id ? updated : c)),
          overrides: pinsClearOf(state.overrides, commitmentSpan(updated), event.at),
        }
      }

      const occurrence = occurrencesFor(state, event.at).find((c) => c.id === event.id)
      // An id that is not there changes nothing, so it clears nothing either.
      if (!occurrence) return state
      const updated = { ...occurrence, ...event.patch }
      // An edit that leaves it saying what it said is not an edit, and must
      // not cost the day its link to the series: a form opened and closed
      // with Done sends the whole draft back, and detaching on that would
      // leave today at five after the series moved to four. Compared as the
      // day sees it, so a margin sent as zero matches one that was never set.
      if (sameCommitment(occurrence, updated)) return state
      return {
        ...state,
        commitments: [...state.commitments, updated],
        overrides: pinsClearOf(state.overrides, commitmentSpan(updated), event.at),
      }
    }

    // Removing one day of a series skips that day, whether the day had its own
    // copy or was still following the rule: without the skip, taking the copy
    // away would simply let the rule's occurrence back in.
    case 'commitment/removed': {
      const target =
        state.commitments.find((c) => c.id === event.id) ??
        occurrencesFor(state, event.at).find((c) => c.id === event.id)
      return {
        ...state,
        commitments: state.commitments.filter((c) => c.id !== event.id),
        ...(target?.recurringId !== undefined && !state.skipped.includes(event.id)
          ? { skipped: [...state.skipped, event.id] }
          : {}),
      }
    }

    case 'region/set':
      // The whole day's shape is replaced at once rather than patched
      // region-by-region: editing one edge often has to split or merge its
      // neighbours, and a single authoritative list keeps that trivial.
      return {
        ...state,
        regionOverrides: [...event.regions]
          .filter((r) => r.endsAt > r.startsAt)
          .sort((a, b) => a.startsAt - b.startsAt),
      }

    // A pin laid across something already fixed is not recorded at all. See
    // `clashesWithCommitment` for why that is a refusal rather than a cleanup.
    case 'break/planned':
      if (clashesWithCommitment(event.plannedBreak, commitmentsFor(state, event.at))) {
        return state
      }
      return {
        ...state,
        overrides: [...state.overrides, event.plannedBreak].sort(
          (a, b) => a.startsAt - b.startsAt,
        ),
      }

    // A patch rather than a remove followed by an add, for the same reason
    // `commitment/updated` is one: the break keeps its id, so the timeline
    // entry drawn from it keeps its React key and the plan re-derives around a
    // break that moved rather than around a different break. Re-sorted because
    // `break/planned` maintains that order and moving one across its neighbour
    // is the ordinary edit.
    case 'break/updated': {
      const existing = state.overrides.find((b) => b.id === event.id)
      // An id that is not there changes nothing, exactly as for a commitment.
      if (!existing) return state

      // Dragging a pin onto a meeting is refused for the reason pinning one
      // there is. The move does not happen and the break stays where it was,
      // which is the smaller lie of the two available: deleting a break because
      // the user tried to put it somewhere it cannot go would be a surprise,
      // and the composer has already said no before this can be reached.
      const updated = { ...existing, ...event.patch }
      if (clashesWithCommitment(updated, commitmentsFor(state, event.at))) return state

      return {
        ...state,
        overrides: state.overrides
          .map((b) => (b.id === event.id ? updated : b))
          .sort((a, b) => a.startsAt - b.startsAt),
      }
    }

    case 'break/removed':
      return { ...state, overrides: state.overrides.filter((b) => b.id !== event.id) }

    case 'block/started':
      return {
        ...state,
        // Starting anything closes whatever was open. In practice the machine
        // never allows two at once, but a replayed log should not be able to
        // strand a segment.
        history: closeActive(state, event.at),
        active: {
          kind: 'block',
          id: event.id,
          blockKind: event.blockKind,
          purpose: event.purpose,
          startedAt: event.at,
          endsAt: event.endsAt,
          taskIds: event.taskIds ?? [],
          notes: [],
          urges: [],
        },
        // A task a block was for is part of today, whether or not it was
        // chosen this morning: the block is the day doing it. Here rather than
        // in the prompt, so a replayed log draws the same today the screen did.
        today: chooseAll(state.today, event.taskIds ?? []),
      }

    case 'block/purposeSet':
      if (state.active?.kind !== 'block') return state
      return { ...state, active: { ...state.active, purpose: event.purpose } }

    // Notes and urges belong to the block they were written in, so they ride
    // on the segment and go into history with it — the calendar, and anything
    // that later reads the day back, then has one record of the block rather
    // than a block and a list beside it to keep in step. With nothing running
    // there is no block for them to be about, and they are dropped.
    case 'block/noted': {
      if (state.active?.kind !== 'block') return state
      // A replayed or duplicated event, not a second note with the same words.
      if (state.active.notes.some((n) => n.id === event.id)) return state
      const note: BlockNote = { id: event.id, at: event.at, text: event.text }
      return {
        ...state,
        active: { ...state.active, notes: [...state.active.notes, note] },
      }
    }

    case 'block/urged':
      if (state.active?.kind !== 'block') return state
      return {
        ...state,
        active: { ...state.active, urges: [...state.active.urges, event.at] },
      }

    case 'block/urgeTakenBack':
      if (state.active?.kind !== 'block' || state.active.urges.length === 0) return state
      return {
        ...state,
        active: { ...state.active, urges: state.active.urges.slice(0, -1) },
      }

    // Corrections reach a block in history as well as the running one: a
    // mistype is often only seen on the calendar afterwards. Blank text is
    // refused rather than stored, since deleting is its own event and a note
    // of nothing is not a note.
    case 'block/noteEdited': {
      const text = event.text.trim()
      if (text === '') return state
      return withNotes(state, event.blockId, (notes) =>
        notes.some((n) => n.id === event.noteId)
          ? notes.map((n) => (n.id === event.noteId ? { ...n, text } : n))
          : notes,
      )
    }

    case 'block/noteRemoved':
      return withNotes(state, event.blockId, (notes) =>
        notes.some((n) => n.id === event.noteId)
          ? notes.filter((n) => n.id !== event.noteId)
          : notes,
      )

    case 'block/completed':
      if (state.active?.kind !== 'block') return state
      return {
        ...state,
        history: [...state.history, completeBlock(state.active, event.at, 'completed')],
        active: null,
      }

    case 'block/abandoned':
      if (state.active?.kind !== 'block') return state
      return {
        ...state,
        history: [...state.history, completeBlock(state.active, event.at, 'abandoned')],
        active: null,
      }

    case 'break/started':
      return {
        ...state,
        history: closeActive(state, event.at),
        active: { kind: 'break', id: event.id, startedAt: event.at, endsAt: event.endsAt },
      }

    case 'break/ended': {
      if (state.active?.kind !== 'break') return state
      const { id, startedAt, endsAt } = state.active
      return {
        ...state,
        history: [
          ...state.history,
          { kind: 'break', id, startedAt, endedAt: event.at, plannedEndsAt: endsAt },
        ],
        // The pin this break was fulfilling is spent, so the plan does not
        // schedule the same rest twice. Only the spent ones: this used to share
        // the blunt filter above, which deleted every pin still to come — take
        // an ad-hoc break at two and the walk you had pinned for four vanished,
        // silently, having nothing to do with the rest you just had.
        overrides: pinsStillAhead(state.overrides, event.at),
        active: null,
      }
    }

    case 'away/recorded':
      return {
        ...state,
        history: [
          ...state.history,
          {
            kind: 'away',
            id: `away-${event.from}`,
            startedAt: event.from,
            endedAt: event.to,
          },
        ],
      }

    case 'day/reset':
      return {
        ...state,
        // History survives forever — it is the journal. The *plan* is what resets.
        // Measured across the whole span: a commitment is not finished with the
        // day while the time it costs afterwards is still running.
        commitments: state.commitments.filter((c) => commitmentSpan(c).end > event.at),
        overrides: [],
        // Back to the recurring default shape. Yesterday's one-off evening
        // stretch should not silently become part of every day.
        regionOverrides: null,
        // And the new day gets asked its opening questions again. Yesterday's
        // answers were about yesterday.
        shapedAt: null,
        // Today's tasks and their intentions are among those answers. The
        // tasks stay in the backlog; only today's choice of them goes, and is
        // kept aside for the new day to offer again.
        intentions: [],
        today: {},
        lastDay: Object.keys(state.today).length > 0 ? Object.keys(state.today) : state.lastDay,
        // Skipping yesterday's standup was about yesterday. The series are
        // about every day, and stay; the new day's occurrences are derived
        // from them, so there is nothing to write for it here.
        skipped: [],
      }

    case 'day/shaped':
      return { ...state, shapedAt: event.at }

    case 'intention/added':
      // An id already present is a replayed or duplicated event, not a second
      // intention with the same name — the first one stands.
      if (state.intentions.some((i) => i.id === event.intention.id)) return state
      return { ...state, intentions: [...state.intentions, event.intention] }

    case 'intention/updated': {
      const existing = state.intentions.find((i) => i.id === event.id)
      if (!existing) return state
      const updated = applyIntentionPatch(existing, event.patch)
      return {
        ...state,
        intentions: state.intentions.map((i) => (i.id === event.id ? updated : i)),
      }
    }

    case 'intention/removed':
      return {
        ...state,
        intentions: state.intentions.filter((i) => i.id !== event.id),
        // Its tasks stay today's and go back to belonging to no intention,
        // rather than pointing at one that no longer exists. Removing a name
        // is not deciding against the work it named.
        today: Object.fromEntries(
          Object.entries(state.today).map(([taskId, id]) => [
            taskId,
            id === event.id ? null : id,
          ]),
        ),
      }

    case 'intention/taskLinked':
      // Taking a task out of its intention leaves it today's, and taking one
      // out that was never today's does not make it so.
      if (event.intentionId === null && !Object.hasOwn(state.today, event.taskId)) return state
      // Linking to an intention that is not there is refused rather than
      // recorded, so the map can only ever point at something real.
      if (
        event.intentionId !== null &&
        !state.intentions.some((i) => i.id === event.intentionId)
      ) {
        return state
      }
      return { ...state, today: { ...state.today, [event.taskId]: event.intentionId } }

    case 'today/taskAdded':
      return { ...state, today: chooseAll(state.today, [event.taskId]) }

    case 'today/taskRemoved': {
      if (!Object.hasOwn(state.today, event.taskId)) return state
      const { [event.taskId]: removed, ...rest } = state.today
      void removed
      return { ...state, today: rest }
    }

    // A new series reaches today at once if today is one of its days, so it
    // clears the pins it lands on exactly as a commitment typed in would.
    case 'recurring/added':
      // A replayed or duplicated event, not a second series.
      if (state.recurring.some((r) => r.id === event.rule.id)) return state
      return clearPinsUnder(
        { ...state, recurring: [...state.recurring, event.rule] },
        event.rule.id,
        event.at,
      )

    // Changing a series reshapes every day still following it, today
    // included — unless today's has already begun. See `keepBegun`.
    case 'recurring/updated': {
      const existing = state.recurring.find((r) => r.id === event.id)
      if (!existing) return state
      const updated = applyRecurringPatch(existing, event.patch)
      const kept = keepBegun(state, event.id, event.at)
      return clearPinsUnder(
        { ...kept, recurring: kept.recurring.map((r) => (r.id === event.id ? updated : r)) },
        event.id,
        event.at,
      )
    }

    case 'recurring/removed': {
      if (!state.recurring.some((r) => r.id === event.id)) return state
      const kept = keepBegun(state, event.id, event.at)
      return { ...kept, recurring: kept.recurring.filter((r) => r.id !== event.id) }
    }

    default: {
      // The `never` keeps the switch exhaustive at compile time, but the log
      // can also arrive from an imported file, where an unrecognised event is
      // data we do not understand rather than a type error. Skip it — the
      // alternative here used to be returning the event *as* the state.
      const unhandled: never = event
      void unhandled
      return state
    }
  }
}

export const replay = (events: readonly MonoEvent[]): SessionState =>
  events.reduce(reduce, initialState)

/**
 * The day's commitments: the ones written into it, and the occurrences of
 * every series that comes round on the local day containing `at`.
 *
 * Derived, never seeded, for the reason today's hours are (`regionsForDay`):
 * a copy of the standup written into each day at midnight would be a stored
 * schedule, and changing the series would then leave every copy already
 * written telling the old story. Here there is one answer, recomputed on each
 * call, so changing the series reshapes every day that has not been changed
 * by hand.
 *
 * A day changes its occurrence in two ways, both by id. Editing one gives the
 * day its own copy in `commitments`, which this then prefers to the rule's;
 * removing one puts its id in `skipped`. Both are decisions about one day and
 * go at midnight with the rest of it.
 *
 * Hands back `commitments` itself when no series has anything to add, so a
 * day with no series costs nothing and reads exactly as it did before they
 * existed.
 */
export function commitmentsFor(state: SessionState, at: Ms): Commitment[] {
  const derived = occurrencesFor(state, at)
  return derived.length === 0 ? state.commitments : [...state.commitments, ...derived]
}

/** The occurrences `commitmentsFor` adds: the day's, less those it has overruled. */
function occurrencesFor(state: SessionState, at: Ms): Commitment[] {
  if (state.recurring.length === 0) return []
  const own = new Set(state.commitments.map((c) => c.id))
  const found: Commitment[] = []
  for (const rule of state.recurring) {
    const occurrence = occurrenceOn(rule, at)
    if (occurrence === null || own.has(occurrence.id) || state.skipped.includes(occurrence.id)) {
      continue
    }
    found.push(occurrence)
  }
  return found
}

/** Whether two commitments take the same time out of the day under the same name. */
function sameCommitment(a: Commitment, b: Commitment): boolean {
  return (
    a.title === b.title &&
    a.startsAt === b.startsAt &&
    a.durationMin === b.durationMin &&
    (a.prepMin ?? 0) === (b.prepMin ?? 0) &&
    (a.recoverMin ?? 0) === (b.recoverMin ?? 0)
  )
}

/**
 * The state with today's occurrence of a series kept as it is, if it has
 * already begun.
 *
 * Changing or ending a series is a decision about the days to come. Applied
 * to today's standup after you have stood up, it would move a meeting that
 * already happened — or, ending the series, take it off a calendar that is
 * meant to say what the day was. So before the rule changes, an occurrence
 * whose span has started (getting ready included) becomes the day's own
 * copy, exactly as an edit makes one. One still ahead today is left to follow
 * the rule, which is what the change was for.
 */
function keepBegun(state: SessionState, ruleId: string, at: Ms): SessionState {
  const occurrence = occurrencesFor(state, at).find((c) => c.recurringId === ruleId)
  if (!occurrence || commitmentSpan(occurrence).start > at) return state
  return { ...state, commitments: [...state.commitments, occurrence] }
}

/** The pins today's occurrence of a series lands on, cleared as `commitment/added` clears them. */
function clearPinsUnder(state: SessionState, ruleId: string, at: Ms): SessionState {
  const occurrence = occurrencesFor(state, at).find((c) => c.recurringId === ruleId)
  if (!occurrence) return state
  return { ...state, overrides: pinsClearOf(state.overrides, commitmentSpan(occurrence), at) }
}

/**
 * Merge an edit into a series. `endsOn: null` is how a patch says "no end any
 * more": with `exactOptionalPropertyTypes` an absent field can only mean
 * "leave it", the trap `readCommitmentEdit` steps around for margins.
 */
function applyRecurringPatch(
  rule: RecurringCommitment,
  patch: RecurringPatch,
): RecurringCommitment {
  const { endsOn, ...rest } = patch
  const merged: RecurringCommitment = { ...rule, ...rest }
  if (endsOn === undefined) return merged
  if (endsOn !== null) return { ...merged, endsOn }
  const { endsOn: dropped, ...open } = merged
  void dropped
  return open
}

/**
 * The pins a commitment occupying `span` can still be honoured alongside.
 *
 * A pin overlapping the span cannot survive in any useful sense: the planner
 * merges the two into one busy interval, so it would be drawn as part of the
 * meeting and rest nobody gets. That is the whole of the reason to delete one,
 * and it says nothing about the pin at four o'clock when the meeting is at
 * nine.
 *
 * This used to clear *every* pin still to come, on the argument that a new
 * commitment reshapes the runway and every pin on it was an answer to a
 * question that had changed. True of the pins in its way and not of the rest —
 * and where the day's shape has changed under a pin that can still be kept,
 * moving it is the user's call to make, not ours to make for them by deletion.
 *
 * `end > at` is the same tidying every one of these filters does: pins already
 * spent are read by nothing and would otherwise sit in state until midnight.
 */
const pinsClearOf = (
  breaks: PlannedBreak[],
  span: Interval,
  at: Ms,
): PlannedBreak[] =>
  breaks.filter((b) => {
    const pin = breakSpan(b)
    return pin.end > at && !overlaps(pin, span)
  })

/**
 * Would this pin want minutes the day has already promised to a commitment?
 *
 * The other half of `pinsClearOf`, and what turns a pair of filters into a rule
 * that can be stated: **no pinned break ever overlaps a commitment.** That one
 * clears the pins a commitment lands on top of, which settles the case where
 * the meeting arrives second. This settles the case where the pin does. Pinning
 * a break across a meeting, or dragging an existing pin onto one, used to be
 * allowed — and produced precisely the state `pinsClearOf` exists to delete:
 * two intervals the planner merges into one, drawn as rest inside a meeting and
 * had by nobody. The invariant was being enforced from one side only.
 *
 * The event is refused rather than stored and tidied afterwards, because there
 * is nothing to tidy it to. `BreakComposer` says no first, naming the
 * commitment, so in the app this is the belt to that pair of braces. It is not
 * redundant: a log also arrives from an import, and from a version of Mono that
 * had no such rule, and a replay has to land somewhere honest whichever order
 * the events come in. It does, both ways round — pin first and the commitment
 * clears it, commitment first and the pin is refused.
 *
 * Every commitment counts, the ones behind us included. A pin overlapping a
 * finished meeting is drawn by nothing either way, so excluding them would buy
 * no behaviour and cost the rule its one-sentence form.
 */
const clashesWithCommitment = (
  pin: PlannedBreak,
  commitments: readonly Commitment[],
): boolean => commitments.some((c) => overlaps(breakSpan(pin), commitmentSpan(c)))

/**
 * What survives taking a break: every pin with time left in it.
 *
 * A break taken against a pin runs to its end, which spends it, so it goes —
 * and so does anything else already behind us, which nothing reads but which
 * would otherwise pile up until midnight. Cut a break short and what is left of
 * that reservation stays, which is what it did before and is the honest answer:
 * the time was set aside, and stopping early does not un-set it. A walk pinned
 * for four o'clock is untouched by a break taken at three.
 *
 * Deliberately a *superset* of what `onlyBreakInProgress` kept: a pin still
 * running when the break ended survives here exactly as it did before, so
 * taking fifteen minutes inside a two-hour reservation leaves the rest of the
 * reservation standing. The only pins whose fate changed are the ones still to
 * come, which is the whole of the fix. Read `at` as the moment the break ended,
 * not as now — after a long sleep, `resolveAway` ends the break at its planned
 * end, so a pin that has since gone stale is left for the midnight reset to
 * clear rather than being caught here. The planner does not draw it either way.
 */
const pinsStillAhead = (breaks: PlannedBreak[], at: Ms): PlannedBreak[] =>
  breaks.filter((b) => b.startsAt + minutesToMs(b.durationMin) > at)

/**
 * The history entry a running block turns into.
 *
 * Exported because the log is not the only thing that needs to know the shape:
 * between the timer reaching zero and the user answering "break or keep
 * going?", a block has finished but has deliberately not been recorded yet
 * (see `machine.ts`), and anything reading the day back has to be able to
 * account for it without inventing its own idea of what a completed block is.
 */
export function completeBlock(
  active: Extract<ActiveSegment, { kind: 'block' }>,
  endedAt: Ms,
  result: 'completed' | 'abandoned',
): CompletedSegment {
  return {
    kind: 'block',
    id: active.id,
    blockKind: active.blockKind,
    purpose: active.purpose,
    startedAt: active.startedAt,
    endedAt,
    plannedEndsAt: active.endsAt,
    result,
    taskIds: active.taskIds,
    notes: active.notes,
    urges: active.urges,
  }
}

/**
 * The state with one block's notes rewritten, wherever that block is: running,
 * or already in history. Hands back the same state when the block is not there
 * or `update` changed nothing, so a correction aimed at nothing is no change at
 * all rather than a fresh object for every subscriber to re-render on.
 */
function withNotes(
  state: SessionState,
  blockId: string,
  update: (notes: BlockNote[]) => BlockNote[],
): SessionState {
  if (state.active?.kind === 'block' && state.active.id === blockId) {
    const notes = update(state.active.notes)
    return notes === state.active.notes ? state : { ...state, active: { ...state.active, notes } }
  }

  const index = state.history.findIndex((s) => s.kind === 'block' && s.id === blockId)
  const segment = state.history[index]
  if (segment?.kind !== 'block') return state
  const notes = update(segment.notes)
  if (notes === segment.notes) return state
  const history = [...state.history]
  history[index] = { ...segment, notes }
  return { ...state, history }
}

/**
 * Today with these tasks chosen. One already chosen keeps its intention, and
 * nothing changes at all when every one of them was there, so a block on
 * today's own tasks hands back the same map.
 */
function chooseAll(
  today: Readonly<Record<string, string | null>>,
  taskIds: readonly string[],
): Record<string, string | null> {
  const fresh = taskIds.filter((id) => !Object.hasOwn(today, id))
  if (fresh.length === 0) return today
  return { ...today, ...Object.fromEntries(fresh.map((id) => [id, null])) }
}

/** Merge an edit into an intention. */
function applyIntentionPatch(intention: Intention, patch: IntentionPatch): Intention {
  return { ...intention, ...patch }
}

/** Close an open segment so a malformed log cannot strand one. */
function closeActive(state: SessionState, at: Ms): CompletedSegment[] {
  if (!state.active) return state.history
  if (state.active.kind === 'block') {
    return [...state.history, completeBlock(state.active, at, 'abandoned')]
  }
  return [
    ...state.history,
    {
      kind: 'break',
      id: state.active.id,
      startedAt: state.active.startedAt,
      endedAt: at,
      plannedEndsAt: state.active.endsAt,
    },
  ]
}
