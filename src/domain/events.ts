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
  commitmentSpan,
  DEFAULT_SETTINGS,
  minutesToMs,
  type ActiveSegment,
  type BlockKind,
  type Commitment,
  type CompletedSegment,
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
        // A new commitment reshapes the runway, so every break the user pinned
        // is cleared and re-derived from scratch. Deliberately blunt: the UI
        // says so, and re-adding a break is one click.
        overrides: onlyBreakInProgress(state.overrides, event.at),
      }

    // Editing a commitment moves the same walls of the day that adding one
    // does — a meeting pushed an hour later takes the runway with it — so the
    // pinned breaks go for exactly the reason they go above.
    case 'commitment/updated':
      return {
        ...state,
        commitments: state.commitments.map((c) =>
          c.id === event.id ? { ...c, ...event.patch } : c,
        ),
        overrides: onlyBreakInProgress(state.overrides, event.at),
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

    case 'break/planned':
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
    case 'break/updated':
      return {
        ...state,
        overrides: state.overrides
          .map((b) => (b.id === event.id ? { ...b, ...event.patch } : b))
          .sort((a, b) => a.startsAt - b.startsAt),
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
 * Only the pinned break that is actually under way survives.
 *
 * Two things go: the ones that have not started, which is the point of calling
 * this, and the ones that finished long ago, which nothing reads but which
 * otherwise pile up in state until midnight clears them.
 *
 * Deliberately blunt, and only for the commitment events, where the whole
 * runway moves and every pin on it is an answer to a question that has changed.
 * The composer says so before you add one. Taking a break is not that — see
 * `pinsStillAhead`.
 */
const onlyBreakInProgress = (breaks: PlannedBreak[], at: Ms): PlannedBreak[] =>
  breaks.filter((b) => b.startsAt <= at && b.startsAt + minutesToMs(b.durationMin) > at)

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
