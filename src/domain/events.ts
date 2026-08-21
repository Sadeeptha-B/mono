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
}

export const initialState: SessionState = {
  settings: DEFAULT_SETTINGS,
  commitments: [],
  history: [],
  active: null,
  overrides: [],
  regionOverrides: null,
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
        // A break that ends drops any pinned break it was fulfilling, so the
        // plan does not schedule the same rest twice.
        overrides: onlyBreakInProgress(state.overrides, event.at),
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
        commitments: state.commitments.filter(
          (c) => c.startsAt + minutesToMs(c.durationMin) > event.at,
        ),
        overrides: [],
        // Back to the recurring default shape. Yesterday's one-off evening
        // stretch should not silently become part of every day.
        regionOverrides: null,
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
 * Only the pinned break that is actually under way survives.
 *
 * Two things go: the ones that have not started, which is the point of calling
 * this, and the ones that finished long ago, which nothing reads but which
 * otherwise pile up in state until midnight clears them.
 */
const onlyBreakInProgress = (breaks: PlannedBreak[], at: Ms): PlannedBreak[] =>
  breaks.filter((b) => b.startsAt <= at && b.startsAt + minutesToMs(b.durationMin) > at)

function completeBlock(
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
