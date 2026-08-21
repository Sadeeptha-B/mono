/**
 * The store.
 *
 * This is the only place in the app that reads the clock, generates ids, or
 * touches storage. Everything it calls — `transition`, `reduce`, `derivePlan`
 * — is pure, which is why the domain can be tested without ever mounting a
 * component.
 *
 * Only the event log is persisted. `phase` is deliberately not: it is which
 * dialog is open, and a reload should not resurrect a stale prompt.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { DerivePlanInput } from '@/domain/planner'
import { initialState, reduce, replay, type MonoEvent, type SessionState } from '@/domain/events'
import { initialPhase, transition, type Action, type Phase } from '@/domain/machine'
import { dayKey, regionsForDay } from '@/domain/time'
import type { Commitment, Ms, PlannedBreak, Settings, WorkRegion } from '@/domain/types'

const STORAGE_KEY = 'mono.session'
const SCHEMA_VERSION = 2

/**
 * How long a gap between ticks means we were genuinely gone rather than merely
 * throttled. Background tabs are commonly clamped to one tick per minute, so
 * this sits just above that.
 */
export const AWAY_THRESHOLD_MS = 90_000

type PersistedShape = { events: MonoEvent[]; dayKey: string | null }

type SessionStore = {
  events: MonoEvent[]
  session: SessionState
  phase: Phase
  dayKey: string | null

  dispatch: (action: Action) => void
  append: (...events: MonoEvent[]) => void

  addCommitment: (input: Omit<Commitment, 'id'>) => void
  removeCommitment: (id: string) => void
  planBreak: (input: Omit<PlannedBreak, 'id'>) => void
  removeBreak: (id: string) => void
  setRegions: (regions: WorkRegion[]) => void
  updateSettings: (patch: Partial<Settings>) => void

  /** Roll the day over if the calendar day changed. Safe to call every tick. */
  checkDayRollover: (now: Ms) => void
  exportJSON: () => string
  importJSON: (json: string) => void
}

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Recover the phase from a rebuilt session after a reload or an import.
 *
 * Only ever returns a *running* phase. If the segment has in fact already
 * finished, `useReconciliation` notices on the first tick and takes over —
 * this function's job is to not lose the block, not to decide its fate.
 */
export function phaseForActive(session: SessionState): Phase {
  const { active } = session
  if (!active) return initialPhase
  if (active.kind === 'break') return { name: 'onBreak' }
  return active.blockKind === 'reflect' ? { name: 'reflecting' } : { name: 'focusing' }
}

export const useSession = create<SessionStore>()(
  persist(
    (set, get) => ({
      events: [],
      session: initialState,
      phase: initialPhase,
      dayKey: null,

      append: (...events) =>
        set((state) => ({
          events: [...state.events, ...events],
          session: events.reduce(reduce, state.session),
        })),

      dispatch: (action) => {
        const { phase, session } = get()
        const result = transition(phase, session, action, { newId })
        set({
          phase: result.phase,
          events: [...get().events, ...result.events],
          session: result.events.reduce(reduce, session),
        })
      },

      addCommitment: (input) =>
        get().append({
          type: 'commitment/added',
          at: Date.now(),
          commitment: { ...input, id: newId() },
        }),

      removeCommitment: (id) =>
        get().append({ type: 'commitment/removed', at: Date.now(), id }),

      planBreak: (input) =>
        get().append({
          type: 'break/planned',
          at: Date.now(),
          plannedBreak: { ...input, id: newId() },
        }),

      removeBreak: (id) => get().append({ type: 'break/removed', at: Date.now(), id }),

      setRegions: (regions) =>
        get().append({ type: 'region/set', at: Date.now(), regions }),

      updateSettings: (patch) =>
        get().append({ type: 'settings/changed', at: Date.now(), patch }),

      checkDayRollover: (now) => {
        const today = dayKey(now)
        const { dayKey: storedDay, session } = get()

        if (storedDay === null) {
          set({ dayKey: today })
          return
        }
        if (storedDay === today) return

        // Midnight arrived. Never cut a block short for it — the reset waits
        // until nothing is running.
        if (session.active) return

        get().append({ type: 'day/reset', at: now })
        set({ dayKey: today, phase: initialPhase })
      },

      exportJSON: () =>
        JSON.stringify(
          { version: SCHEMA_VERSION, events: get().events } satisfies {
            version: number
            events: MonoEvent[]
          },
          null,
          2,
        ),

      importJSON: (json) => {
        const parsed: unknown = JSON.parse(json)
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !Array.isArray((parsed as { events?: unknown }).events)
        ) {
          throw new Error('Not a Mono export: expected an "events" array.')
        }
        const events = (parsed as { events: MonoEvent[] }).events
        const session = replay(events)
        set({ events, session, phase: phaseForActive(session), dayKey: null })
      },
    }),
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      // The log is the truth; everything else is rebuilt from it on load.
      partialize: (state): PersistedShape => ({
        events: state.events,
        dayKey: state.dayKey,
      }),
      migrate: (persisted, from): PersistedShape => {
        if (from === SCHEMA_VERSION) return persisted as PersistedShape

        // v1 -> v2: a single `dayEndsAt` became a list of work regions. The
        // faithful translation is one region running from the default start to
        // whatever end time the user had chosen.
        if (from === 1 && isPersisted(persisted)) {
          return { events: persisted.events.map(migrateDayEndsAt), dayKey: null }
        }

        // Anything older or unreadable is discarded rather than crashing on boot.
        return { events: [], dayKey: null }
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.session = replay(state.events)
        // Phase is not persisted — it is which dialog is open, and a stale
        // prompt should not survive a reload. But a *running* segment must,
        // so the phase is rebuilt from the log rather than reset to idle,
        // which would otherwise offer "start a block" during one.
        state.phase = phaseForActive(state.session)
      },
    },
  ),
)

/**
 * Today's work regions: the day's own shape once edited, otherwise the
 * recurring default resolved onto today's calendar.
 */
export function selectRegions(state: SessionStore, now: Ms): WorkRegion[] {
  const { regionOverrides, settings } = state.session
  return regionOverrides ?? regionsForDay(now, settings.defaultRegions)
}

/**
 * Everything the planner needs, gathered from the store. The timeline itself
 * is derived in the view from this plus `now`, so it is always consistent with
 * the timer rather than a stored schedule that can drift away from it.
 */
export function toPlanInput(state: SessionStore, now: Ms): DerivePlanInput {
  const { session } = state
  return {
    now,
    settings: session.settings,
    regions: selectRegions(state, now),
    commitments: session.commitments,
    history: session.history,
    active: session.active,
    overrides: session.overrides,
  }
}

const isPersisted = (v: unknown): v is PersistedShape =>
  typeof v === 'object' && v !== null && Array.isArray((v as PersistedShape).events)

/** Rewrite a v1 `dayEndsAt` settings patch into a v2 `defaultRegions` one. */
function migrateDayEndsAt(event: MonoEvent): MonoEvent {
  if (event.type !== 'settings/changed') return event

  const { dayEndsAt, ...rest } = event.patch as Partial<Settings> & { dayEndsAt?: string }
  if (typeof dayEndsAt !== 'string') return event

  return {
    ...event,
    patch: { ...rest, defaultRegions: [{ start: '09:00', end: dayEndsAt }] },
  }
}
