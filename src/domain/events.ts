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
 */

import {
  breakSpan,
  commitmentSpan,
  DEFAULT_SETTINGS,
  minutesToMs,
  overlaps,
  type ActiveSegment,
  type BlockKind,
  type Commitment,
  type CompletedSegment,
  type Interval,
  type Ms,
  type PlannedBreak,
  type Settings,
  type WorkRegion,
} from './types'

export type MonoEvent =
  | { type: 'settings/changed'; at: Ms; patch: Partial<Settings> }
  | { type: 'commitment/added'; at: Ms; commitment: Commitment }
  | { type: 'commitment/updated'; at: Ms; id: string; patch: Partial<Commitment> }
  | { type: 'commitment/removed'; at: Ms; id: string }
  | { type: 'region/set'; at: Ms; regions: WorkRegion[] }
  | { type: 'break/planned'; at: Ms; plannedBreak: PlannedBreak }
  | { type: 'break/updated'; at: Ms; id: string; patch: Partial<PlannedBreak> }
  | { type: 'break/removed'; at: Ms; id: string }
  | {
      type: 'block/started'
      at: Ms
      id: string
      blockKind: BlockKind
      /** Absolute. The block owns this instant regardless of tick delivery. */
      endsAt: Ms
      purpose: string | null
    }
  | { type: 'block/purposeSet'; at: Ms; purpose: string }
  | { type: 'block/completed'; at: Ms }
  | { type: 'block/abandoned'; at: Ms }
  | { type: 'break/started'; at: Ms; id: string; endsAt: Ms }
  | { type: 'break/ended'; at: Ms }
  | { type: 'away/recorded'; at: Ms; from: Ms; to: Ms }
  | { type: 'day/reset'; at: Ms }
  | { type: 'day/shaped'; at: Ms }

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
}

export const initialState: SessionState = {
  settings: DEFAULT_SETTINGS,
  commitments: [],
  history: [],
  active: null,
  overrides: [],
  regionOverrides: null,
  shapedAt: null,
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
    case 'commitment/updated': {
      const existing = state.commitments.find((c) => c.id === event.id)
      // An id that is not there changes nothing, so it clears nothing either.
      if (!existing) return state

      const updated = { ...existing, ...event.patch }
      return {
        ...state,
        commitments: state.commitments.map((c) => (c.id === event.id ? updated : c)),
        overrides: pinsClearOf(state.overrides, commitmentSpan(updated), event.at),
      }
    }

    case 'commitment/removed':
      return {
        ...state,
        commitments: state.commitments.filter((c) => c.id !== event.id),
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
      if (clashesWithCommitment(event.plannedBreak, state.commitments)) return state
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
      if (clashesWithCommitment(updated, state.commitments)) return state

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
        },
      }

    case 'block/purposeSet':
      if (state.active?.kind !== 'block') return state
      return { ...state, active: { ...state.active, purpose: event.purpose } }

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
      }

    case 'day/shaped':
      return { ...state, shapedAt: event.at }

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
  outcome: 'completed' | 'abandoned',
): CompletedSegment {
  return {
    kind: 'block',
    id: active.id,
    blockKind: active.blockKind,
    purpose: active.purpose,
    startedAt: active.startedAt,
    endedAt,
    plannedEndsAt: active.endsAt,
    outcome,
  }
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
