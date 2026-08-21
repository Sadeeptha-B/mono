import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initialState } from '@/domain/events'
import { DEFAULT_SETTINGS } from '@/domain/types'
import { initialPhase } from '@/domain/machine'
import { dayKey } from '@/domain/time'

type SessionModule = typeof import('./session')

const TODAY = new Date(2026, 7, 21, 10, 0, 0)
const YESTERDAY = new Date(2026, 7, 20, 10, 0, 0)

function installStorageMock(): Storage {
  let data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear() {
      data = new Map<string, string>()
    },
    getItem(key) {
      return data.get(key) ?? null
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key) {
      data.delete(key)
    },
    setItem(key, value) {
      data.set(key, value)
    },
  }

  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  })

  return storage
}

function at(base: Date, hour: number, minute = 0): number {
  const d = new Date(base)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

let useSession: SessionModule['useSession']
let selectRegions: SessionModule['selectRegions']

describe('session import', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    installStorageMock().clear()
    ;({ useSession, selectRegions } = await import('./session'))
    useSession.setState({ events: [], session: initialState, phase: initialPhase, dayKey: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    installStorageMock().clear()
    useSession.setState({ events: [], session: initialState, phase: initialPhase, dayKey: null })
  })

  it('resets stale per-day state when importing an old idle session', () => {
    useSession.getState().importJSON(
      JSON.stringify({
        version: 2,
        events: [
          {
            type: 'region/set',
            at: at(YESTERDAY, 9),
            regions: [{ id: 'yesterday', startsAt: at(YESTERDAY, 9), endsAt: at(YESTERDAY, 18) }],
          },
          {
            type: 'commitment/added',
            at: at(YESTERDAY, 9, 5),
            commitment: {
              id: 'commitment-1',
              title: 'Standup',
              startsAt: at(YESTERDAY, 17),
              durationMin: 15,
            },
          },
          {
            type: 'break/planned',
            at: at(YESTERDAY, 9, 10),
            plannedBreak: {
              id: 'break-1',
              startsAt: at(YESTERDAY, 15),
              durationMin: 15,
            },
          },
        ],
      }),
    )

    const state = useSession.getState()
    expect(state.dayKey).toBe(dayKey(TODAY.getTime()))
    expect(state.session.regionOverrides).toBeNull()
    expect(state.session.commitments).toEqual([])
    expect(state.session.overrides).toEqual([])
    expect(state.events.at(-1)).toMatchObject({ type: 'day/reset', at: TODAY.getTime() })
  })

  it('keeps the rest of a file that carries an event this build cannot read', () => {
    // A log is allowed to contain event types this build has never heard of —
    // another build wrote it, or someone edited the file. The sanitiser used to
    // fall out of its switch and return `undefined` for those, which survived
    // the filter and crashed `replay` on `event.type`.
    expect(() =>
      useSession.getState().importJSON(
        JSON.stringify({
          version: 2,
          dayKey: dayKey(TODAY.getTime()),
          events: [
            { type: 'block/somethingNewer', at: at(TODAY, 10), payload: 1 },
            { type: 'settings/changed', at: at(TODAY, 10, 1), patch: { shortMinutes: 25 } },
          ],
        }),
      ),
    ).not.toThrow()

    const state = useSession.getState()
    expect(state.session.settings.shortMinutes).toBe(25)
    expect(state.events.map((event) => event.type)).toEqual(['settings/changed'])
  })

  it('drops malformed imported payloads before replay', () => {
    expect(() =>
      useSession.getState().importJSON(
        JSON.stringify({
          version: 2,
          dayKey: dayKey(TODAY.getTime()),
          events: [
            {
              type: 'settings/changed',
              at: at(TODAY, 10),
              patch: { defaultRegions: null },
            },
            {
              type: 'settings/changed',
              at: at(TODAY, 10, 1),
              patch: { shortMinutes: 25 },
            },
          ],
        }),
      ),
    ).not.toThrow()

    const state = useSession.getState()
    expect(state.session.settings.defaultRegions).toEqual(DEFAULT_SETTINGS.defaultRegions)
    expect(state.session.settings.shortMinutes).toBe(25)
    expect(selectRegions(state, TODAY.getTime())).toHaveLength(1)
  })
})

/**
 * Rehydration runs *synchronously* while the module is still evaluating, which
 * is what made the v1 branch a wipe rather than a migration: it called a helper
 * declared below the store, hit its temporal dead zone, and zustand swallowed
 * the ReferenceError. These tests boot the module against seeded storage, which
 * is the only way to reach that path.
 */
describe('session rehydration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  const seed = (blob: unknown): void => {
    installStorageMock().setItem('mono.session', JSON.stringify(blob))
  }

  it('migrates a v1 log rather than discarding it', async () => {
    seed({
      version: 1,
      state: {
        dayKey: null,
        events: [
          {
            type: 'settings/changed',
            at: at(YESTERDAY, 9),
            patch: { dayEndsAt: '20:00' },
          },
        ],
      },
    })

    const { useSession: store } = await import('./session')
    const state = store.getState()

    expect(state.events).toHaveLength(1)
    expect(state.session.settings.defaultRegions).toEqual([{ start: '09:00', end: '20:00' }])
    // And it knows which day that log belonged to, so the midnight reset still
    // has something to compare against on the first tick.
    expect(state.dayKey).toBe(dayKey(YESTERDAY.getTime()))
  })

  it('rebuilds a running block from a current log', async () => {
    seed({
      version: 2,
      state: {
        dayKey: dayKey(TODAY.getTime()),
        events: [
          {
            type: 'block/started',
            at: at(TODAY, 9, 30),
            id: 'block-1',
            blockKind: 'deep',
            endsAt: at(TODAY, 10, 15),
            purpose: 'Write the planner tests',
          },
        ],
      },
    })

    const { useSession: store } = await import('./session')
    const state = store.getState()

    expect(state.phase).toEqual({ name: 'focusing' })
    expect(state.session.active?.id).toBe('block-1')
  })
})
