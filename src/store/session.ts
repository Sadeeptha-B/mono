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
import {
  migratePersisted,
  readImport,
  SCHEMA_VERSION,
  type ExportedShape,
  type PersistedShape,
} from './schema'
import type { Commitment, Ms, PlannedBreak, Settings, WorkRegion } from '@/domain/types'

const STORAGE_KEY = 'mono.session'

/**
 * How long a gap between ticks means we were genuinely gone rather than merely
 * throttled. Background tabs are commonly clamped to one tick per minute, so
 * this sits just above that.
 */
export const AWAY_THRESHOLD_MS = 90_000

type SessionStore = {
  events: MonoEvent[]
  session: SessionState
  phase: Phase
  dayKey: string | null
  /**
   * Bumped whenever the session is *replaced* rather than appended to: the
   * midnight reset, and an import.
   *
   * This exists for the UI, and specifically for the drafts it holds — a
   * half-typed set of working hours, the commitment being written, the purpose
   * being named. Every one of those describes a particular day's session, and
   * when that session is swapped out underneath them they are not stale data,
   * they are answers to a question nobody is asking any more.
   *
   * It is a counter rather than a flag anything can read a meaning into, and it
   * is set at the two places that cause the discontinuity rather than inferred
   * from a symptom of it. Three separate bugs came from inferring: `dayKey`
   * does not move when an import lands on the same day, `shapedAt` does not
   * move when the day was never answered, and between them they missed a
   * different case each time. There is no third signal to find, because this
   * one is the fact itself.
   *
   * Not persisted. A reload remounts everything, so the drafts are fresh anyway.
   */
  generation: number

  dispatch: (action: Action) => void
  append: (...events: MonoEvent[]) => void

  addCommitment: (input: Omit<Commitment, 'id'>) => void
  /**
   * Change one already on the day, keeping its id.
   *
   * A patch rather than a replacement so the caller does not have to carry the
   * id back around, and an edit rather than a remove-then-add so the plan
   * re-derives around the same commitment moved rather than a different one in
   * a new place. Note the trap in `readCommitmentEdit`: a patch is merged, so
   * clearing a margin means sending a zero, not omitting the field.
   */
  updateCommitment: (id: string, patch: Partial<Commitment>) => void
  removeCommitment: (id: string) => void
  planBreak: (input: Omit<PlannedBreak, 'id'>) => void
  updateBreak: (id: string, patch: Partial<PlannedBreak>) => void
  removeBreak: (id: string) => void
  setRegions: (regions: WorkRegion[]) => void
  updateSettings: (patch: Partial<Settings>) => void
  /** The user answered the day's opening questions. Records only that. */
  shapeDay: () => void

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
      generation: 0,

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

      updateCommitment: (id, patch) =>
        get().append({ type: 'commitment/updated', at: Date.now(), id, patch }),

      removeCommitment: (id) =>
        get().append({ type: 'commitment/removed', at: Date.now(), id }),

      planBreak: (input) =>
        get().append({
          type: 'break/planned',
          at: Date.now(),
          plannedBreak: { ...input, id: newId() },
        }),

      updateBreak: (id, patch) =>
        get().append({ type: 'break/updated', at: Date.now(), id, patch }),

      removeBreak: (id) => get().append({ type: 'break/removed', at: Date.now(), id }),

      setRegions: (regions) =>
        get().append({ type: 'region/set', at: Date.now(), regions }),

      updateSettings: (patch) =>
        get().append({ type: 'settings/changed', at: Date.now(), patch }),

      shapeDay: () => get().append({ type: 'day/shaped', at: Date.now() }),

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
        // A discontinuity, not an append: yesterday's answers are gone and
        // anything the UI was holding about them goes with them.
        set({ dayKey: today, phase: initialPhase, generation: get().generation + 1 })
      },

      exportJSON: () =>
        JSON.stringify(
          {
            version: SCHEMA_VERSION,
            dayKey: get().dayKey,
            events: get().events,
          } satisfies ExportedShape,
          null,
          2,
        ),

      importJSON: (json) => {
        const { events, session, dayKey: day } = readImport(json, Date.now())
        // Same rule as a reload: only a *running* segment resurrects a phase.
        // After an out-of-date import there is none — the day reset inside
        // `readImport` only runs when nothing is active — so this lands idle.
        // The whole session was replaced, so this is a discontinuity even when
        // the imported file turns out to be for the same day — which is
        // precisely the case that has no other tell.
        set({
          events,
          session,
          dayKey: day,
          phase: phaseForActive(session),
          generation: get().generation + 1,
        })
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
      // Hoisted out of this file entirely. It used to call a `const` declared
      // below the store, and persist rehydrates *synchronously* while the
      // module is still evaluating — so the helper sat in its temporal dead
      // zone, zustand swallowed the ReferenceError, and a v1 log was silently
      // wiped rather than migrated.
      migrate: (persisted, from): PersistedShape => migratePersisted(persisted, from),
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
 *
 * `regions` can be overridden with hours that have not been saved yet, which is
 * the one input the user edits while watching the plan it produces. Nothing is
 * written for it — the whole future is a pure function of these arguments, so
 * answering "what would this day look like?" is a call rather than a commit,
 * and the answer is discarded by not asking again. See `hoursPreview` in `App`.
 */
export function toPlanInput(
  state: SessionStore,
  now: Ms,
  regions: readonly WorkRegion[] = selectRegions(state, now),
): DerivePlanInput {
  const { session } = state
  return {
    now,
    settings: session.settings,
    regions,
    commitments: session.commitments,
    history: session.history,
    active: session.active,
    overrides: session.overrides,
  }
}
