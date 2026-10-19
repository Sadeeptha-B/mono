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
 * It does read the local calendar, and always the same way: the local day
 * containing an event's `at`. That is the day a series of recurring
 * commitments is asked about (`commitmentsFor`), which is what lets the pin
 * rules below see today's standup without a stored copy of it, and the day a
 * pin a commitment lands on may be moved within (`pinsOff`). The cost is that
 * a log replayed in another time zone could put an occurrence or a moved pin
 * somewhere else; on the device that wrote it, replay is exactly as
 * deterministic as before.
 */

import {
  breakSpan,
  commitmentSpan,
  DEFAULT_SETTINGS,
  minutesToMs,
  type ActiveSegment,
  type BlockKind,
  type BlockLog,
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
import { overlaps } from './intervals'
import {
  breakClash,
  pinLeft,
  pinsMovedOff,
  restTaken,
  type BreakSurroundings,
} from './breakRoom'
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
  /** A pinned break whose time has passed, said to have been taken. */
  | { type: 'break/confirmed'; at: Ms; id: string }
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
   * A line written in the running block, at `at`, which becomes the log's
   * own minute. Ignored with no block running.
   */
  | { type: 'block/logged'; at: Ms; id: string; text: string }
  /** One urge to leave the task, counted in the running block. */
  | { type: 'block/urged'; at: Ms }
  /** The running block's most recent urge, taken back as a mis-tap. */
  | { type: 'block/urgeTakenBack'; at: Ms }
  /**
   * A task taken on by the running block, from All Tasks, and so chosen for
   * today as well; or one let go by it. The block keeps at least one: a
   * removal that would leave it with none is ignored.
   */
  | { type: 'block/taskAdded'; at: Ms; taskId: string }
  | { type: 'block/taskRemoved'; at: Ms; taskId: string }
  /**
   * A log's text corrected, in the running block or one already in history.
   * The log keeps its own `at`: a fixed typo is not a later thought.
   */
  | { type: 'block/logEdited'; at: Ms; blockId: string; logId: string; text: string }
  /** A log deleted, in the running block or one already in history. */
  | { type: 'block/logRemoved'; at: Ms; blockId: string; logId: string }
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
  /**
   * The record, oldest first. Blocks and away stretches stand as they were
   * written; a break taken can be put right afterwards (`withTakenBreak`).
   */
  history: CompletedSegment[]
  /** The one running block or break, if any. */
  active: ActiveSegment | null
  /**
   * Breaks the user pinned: the plan, and, once their time has passed, the
   * ones waiting to be said taken or not (`break/confirmed`).
   */
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

    // Only the pins this commitment lands on move, and they move down past it.
    // See `pinsOff`.
    case 'commitment/added': {
      const next = { ...state, commitments: [...state.commitments, event.commitment] }
      return { ...next, overrides: pinsOff(next, event.commitment, event.at) }
    }

    // Editing a commitment moves the same walls that adding one does — a
    // meeting pushed an hour later takes the runway with it — so the pins move
    // for exactly the reason they move above, and only the same ones. Measured
    // against where the meeting *ends up*, which is the shape the day now has.
    // The slot it vacated needs no thought, because nothing was ever allowed to
    // pin a break inside it — see `breakClash`.
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
        const next = {
          ...state,
          commitments: state.commitments.map((c) => (c.id === event.id ? updated : c)),
        }
        return { ...next, overrides: pinsOff(next, updated, event.at) }
      }

      const occurrence = occurrencesFor(state, event.at).find((c) => c.id === event.id)
      // An id that is not there changes nothing, so it clears nothing either.
      if (!occurrence) return state
      const updated = { ...occurrence, ...event.patch }
      // An edit that leaves it saying what it said is not an edit, and must
      // not cost the day its link to the series: the forms of older builds
      // sent the whole draft back on Done, those logs still replay, and
      // detaching on that would leave today at five after the series moved
      // to four. Compared as the
      // day sees it, so a margin sent as zero matches one that was never set.
      if (sameCommitment(occurrence, updated)) return state
      const next = { ...state, commitments: [...state.commitments, updated] }
      return { ...next, overrides: pinsOff(next, updated, event.at) }
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

    // A pin laid across something already there is not recorded at all: a
    // commitment, another pin, or what is already on the record (see
    // `breakRoom` for why each). Refused rather than stored and tidied
    // afterwards, because there is nothing to tidy it to. `BreakComposer` says
    // no first, naming what it runs into, so in the app this is the belt to
    // that pair of braces. It is not redundant: a log also arrives from an
    // import, and from a version of Mono that had no such rule, and a replay
    // has to land somewhere honest whichever order the events come in. It
    // does, both ways round — pin first and a commitment moves it (`pinsOff`),
    // commitment first and the pin is refused. A second event with the same
    // pin runs into the first and is refused with it.
    case 'break/planned':
      if (breakClash(breakSpan(event.plannedBreak), 'pin', surroundings(state, event.at))) {
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
    //
    // And like `commitment/updated` it reaches two homes by one id. A pin is
    // edited where it is; a break already taken is edited on the record
    // (`withTakenBreak`), because a taken break is a fact about the day the
    // user can put right, like a meeting that ran at another time. The ids
    // never collide — both come from `newId`, and a confirmed pin leaves the
    // pins as it joins the record — and no log written before breaks could be
    // corrected names a taken break here, so old logs replay as they did.
    case 'break/updated': {
      const pin = state.overrides.find((b) => b.id === event.id)
      if (!pin) {
        return withTakenBreak(state, event.id, event.at, (taken) => patchedBreak(taken, event.patch))
      }

      // Moving a pin onto something it may not share a minute with is refused
      // for the reason pinning one there is. The move does not happen and the
      // break stays where it was, which is the smaller lie of the two available:
      // deleting a break because the user tried to put it somewhere it cannot
      // go would be a surprise, and the composer has already said no before this
      // can be reached. Only what the move *newly* runs into counts, so a pin a
      // block has since run into can still be moved off it.
      const updated = { ...pin, ...event.patch }
      if (
        breakClash(breakSpan(updated), 'pin', surroundings(state, event.at), {
          except: pin.id,
          previous: breakSpan(pin),
        })
      ) {
        return state
      }

      return {
        ...state,
        overrides: state.overrides
          .map((b) => (b.id === event.id ? updated : b))
          .sort((a, b) => a.startsAt - b.startsAt),
      }
    }

    // A pin, or a break already taken: the same two homes as above.
    case 'break/removed':
      return state.overrides.some((b) => b.id === event.id)
        ? { ...state, overrides: state.overrides.filter((b) => b.id !== event.id) }
        : withTakenBreak(state, event.id, event.at, () => null)

    // A pin whose time has passed, said to have been taken: it leaves the plan
    // and joins the record, at the time it was planned for, so it counts as
    // rest the day had — or the part of it left after a break cut short over
    // it, which is the part the calendar draws and asks about (`pinLeft`).
    // Refused while it is still ahead, or where the record already says
    // something else happened then — a block run through it, say.
    case 'break/confirmed': {
      const pin = state.overrides.find((b) => b.id === event.id)
      if (!pin) return state
      const span = pinLeft(pin, restTaken(state.history, state.active, pin.startsAt))
      if (span === null) return state
      if (breakClash(span, 'record', surroundings(state, event.at))) return state
      return {
        ...state,
        overrides: state.overrides.filter((b) => b.id !== pin.id),
        history: inOrder(state.history, {
          kind: 'break',
          id: pin.id,
          startedAt: span.start,
          endedAt: span.end,
          plannedEndsAt: span.end,
        }),
      }
    }

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
          logs: [],
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

    // Logs and urges belong to the block they were written in, so they ride
    // on the segment and go into history with it — the calendar, and anything
    // that later reads the day back, then has one record of the block rather
    // than a block and a list beside it to keep in step. With nothing running
    // there is no block for them to be about, and they are dropped.
    case 'block/logged': {
      if (state.active?.kind !== 'block') return state
      // A replayed or duplicated event, not a second log with the same words.
      if (state.active.logs.some((n) => n.id === event.id)) return state
      const log: BlockLog = { id: event.id, at: event.at, text: event.text }
      return {
        ...state,
        active: { ...state.active, logs: [...state.active.logs, log] },
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

    // What a running block is for can grow or shrink while it runs, as work
    // turns out bigger or smaller than it was named; the purpose stays the
    // sentence it was started with. A task taken on is today's, as one a
    // block starts with is. Like logs, these ride on the segment, and with
    // nothing running they are dropped.
    case 'block/taskAdded':
      if (state.active?.kind !== 'block' || state.active.taskIds.includes(event.taskId)) {
        return state
      }
      return {
        ...state,
        active: { ...state.active, taskIds: [...state.active.taskIds, event.taskId] },
        today: chooseAll(state.today, [event.taskId]),
      }

    case 'block/taskRemoved': {
      if (state.active?.kind !== 'block') return state
      const taskIds = state.active.taskIds.filter((id) => id !== event.taskId)
      // Every block is for at least one task; and one it never had is no news.
      if (taskIds.length === 0 || taskIds.length === state.active.taskIds.length) return state
      return { ...state, active: { ...state.active, taskIds } }
    }

    // Corrections reach a block in history as well as the running one: a
    // mistype is often only seen on the calendar afterwards. Blank text is
    // refused rather than stored, since deleting is its own event and a log
    // of nothing is not a log.
    case 'block/logEdited': {
      const text = event.text.trim()
      if (text === '') return state
      return withLogs(state, event.blockId, (logs) =>
        logs.some((n) => n.id === event.logId)
          ? logs.map((n) => (n.id === event.logId ? { ...n, text } : n))
          : logs,
      )
    }

    case 'block/logRemoved':
      return withLogs(state, event.blockId, (logs) =>
        logs.some((n) => n.id === event.logId)
          ? logs.filter((n) => n.id !== event.logId)
          : logs,
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
        // The pin this break was fulfilling is spent, so the day does not hold
        // the same rest twice. Only that one: this used to delete every pin
        // still to come, and then every pin behind us too — take an ad-hoc
        // break at two and the walk you had pinned for four vanished, and so
        // did the record of the one you skipped at eleven.
        overrides: pinsNotSpentBy(state.overrides, { start: startedAt, end: event.at }),
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
    // moves the pins it lands on exactly as a commitment typed in would.
    case 'recurring/added':
      // A replayed or duplicated event, not a second series.
      if (state.recurring.some((r) => r.id === event.rule.id)) return state
      return movePinsUnder(
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
      return movePinsUnder(
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

/** The pins today's occurrence of a series lands on, moved as `commitment/added` moves them. */
function movePinsUnder(state: SessionState, ruleId: string, at: Ms): SessionState {
  const occurrence = occurrencesFor(state, at).find((c) => c.recurringId === ruleId)
  if (!occurrence) return state
  return { ...state, overrides: pinsOff(state, occurrence, at) }
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
 * The pins once `commitment` is where `state` now has it, at `at`: those it
 * lands on moved down past it, or cleared where they cannot be (`pinsMovedOff`,
 * which holds the reasons), and the rest untouched. A pin overlapping a
 * commitment cannot stay where it is, because the planner merges the two into
 * one busy interval — rest drawn as part of the meeting and had by nobody.
 */
const pinsOff = (state: SessionState, commitment: Commitment, at: Ms): PlannedBreak[] =>
  pinsMovedOff(
    state.overrides,
    commitment,
    commitmentsFor(state, at).filter((c) => c.id !== commitment.id),
    at,
  )

/** Everything a break has to keep clear of, as `state` has the day at `at`. */
const surroundings = (state: SessionState, at: Ms): BreakSurroundings => ({
  commitments: commitmentsFor(state, at),
  pins: state.overrides,
  history: state.history,
  active: state.active,
  at,
})

/** A taken break in history, as `withTakenBreak` works on it. */
type TakenBreak = Extract<CompletedSegment, { kind: 'break' }>

/**
 * A taken break with a break's patch applied.
 *
 * The patch is the pin's shape — a start and a length in minutes — because the
 * form and the drag are the same for both. A new start moves the whole break,
 * its planned end with it, keeping the exact length it ran: a taken break is
 * seldom a whole number of minutes, and a drag that rounded it would be
 * rewriting how long the rest was, not when. A length, when one is given, is
 * counted from the start.
 */
function patchedBreak(taken: TakenBreak, patch: PlannedBreakPatch): TakenBreak {
  const startedAt = patch.startsAt ?? taken.startedAt
  const shift = startedAt - taken.startedAt
  return {
    ...taken,
    startedAt,
    endedAt:
      patch.durationMin === undefined
        ? taken.endedAt + shift
        : startedAt + minutesToMs(patch.durationMin),
    plannedEndsAt: taken.plannedEndsAt + shift,
  }
}

/**
 * A correction to a break already taken: `change` returns it as it should now
 * be, or null to take it off the record.
 *
 * The record keeps clear of the rest of the record (`breakClash`), so a break
 * cannot be moved onto a block, an away stretch, another break, whatever is
 * running, or into the future; only what the change *newly* runs into counts.
 * An id that names no taken break, or a change that changes nothing, leaves
 * the session as it was. History stays oldest first (`inOrder`), because what
 * is read from it in order — the companion's trail, the streak, the remark
 * after a rest — reads it as the order the day happened in.
 */
function withTakenBreak(
  state: SessionState,
  id: string,
  at: Ms,
  change: (taken: TakenBreak) => TakenBreak | null,
): SessionState {
  const index = state.history.findIndex((s) => s.kind === 'break' && s.id === id)
  const taken = state.history[index]
  if (taken?.kind !== 'break') return state
  const without = state.history.filter((_, i) => i !== index)

  const next = change(taken)
  if (next === null) return { ...state, history: without }
  if (
    next.startedAt === taken.startedAt &&
    next.endedAt === taken.endedAt &&
    next.plannedEndsAt === taken.plannedEndsAt
  ) {
    return state
  }

  const span = { start: next.startedAt, end: next.endedAt }
  if (span.end <= span.start) return state
  const clash = breakClash(span, 'record', surroundings(state, at), {
    except: id,
    previous: { start: taken.startedAt, end: taken.endedAt },
  })
  return clash ? state : { ...state, history: inOrder(without, next) }
}

/**
 * History with `segment` put where its start says it belongs. Found from the
 * end, since a correction is nearly always to today and the journal is kept
 * forever.
 */
function inOrder(
  history: readonly CompletedSegment[],
  segment: CompletedSegment,
): CompletedSegment[] {
  let i = history.length
  while (i > 0 && history[i - 1]!.startedAt > segment.startedAt) i -= 1
  return [...history.slice(0, i), segment, ...history.slice(i)]
}

/**
 * What survives taking a break over `taken`: every pin but those it spent.
 *
 * A pin is spent by a break that overlaps it and runs at least to its end —
 * the rest it reserved was had, and the break is drawn where it was, so
 * keeping the pin would draw that rest twice. Cut a break short inside a
 * longer reservation and what is left of the reservation stays, which is the
 * honest answer: the time was set aside, and stopping early does not un-set
 * it. The planner draws only that part, after the break (`pinLeft`), so the
 * rest that was had is not drawn twice. A walk pinned for four o'clock is
 * untouched by a break taken at three, and so is one pinned for eleven and
 * skipped: it stays on the day, asking whether it was taken, until midnight.
 *
 * Read `taken.end` as the moment the break ended, not as now — after a long
 * sleep, `resolveAway` ends the break at its planned end.
 */
const pinsNotSpentBy = (breaks: PlannedBreak[], taken: Interval): PlannedBreak[] =>
  breaks.filter((b) => {
    const pin = breakSpan(b)
    return pin.end > taken.end || !overlaps(pin, taken)
  })

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
    logs: active.logs,
    urges: active.urges,
  }
}

/**
 * The state with one block's logs rewritten, wherever that block is: running,
 * or already in history. Hands back the same state when the block is not there
 * or `update` changed nothing, so a correction aimed at nothing is no change at
 * all rather than a fresh object for every subscriber to re-render on.
 */
function withLogs(
  state: SessionState,
  blockId: string,
  update: (logs: BlockLog[]) => BlockLog[],
): SessionState {
  if (state.active?.kind === 'block' && state.active.id === blockId) {
    const logs = update(state.active.logs)
    return logs === state.active.logs ? state : { ...state, active: { ...state.active, logs } }
  }

  const index = state.history.findIndex((s) => s.kind === 'block' && s.id === blockId)
  const segment = state.history[index]
  if (segment?.kind !== 'block') return state
  const logs = update(segment.logs)
  if (logs === segment.logs) return state
  const history = [...state.history]
  history[index] = { ...segment, logs }
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
