import { describe, expect, it } from 'vitest'

import type { MonoEvent } from '@/domain/events'
import { migratePersisted, SCHEMA_VERSION } from './schema'

/**
 * Require every field recursively, including fields optional inside event
 * patches. This fixture then fails to compile when an existing event gains a
 * field, while the mapped keys do the same when a new event type is added.
 */
type DeepRequired<T> = T extends (infer Item)[]
  ? DeepRequired<Item>[]
  : T extends object
    ? { [Key in keyof T]-?: DeepRequired<T[Key]> }
    : T

type CompleteEventLog = {
  [Type in MonoEvent['type']]: DeepRequired<Extract<MonoEvent, { type: Type }>>
}

const EVERY_EVENT = {
  'settings/changed': {
    type: 'settings/changed',
    at: 1,
    patch: {
      deepMinutes: 45,
      shortMinutes: 20,
      reflectMinutes: 5,
      defaultRegions: [{ start: '08:30', end: '17:30' }],
      plannerPolicy: 'maximise-focus',
      notificationsEnabled: true,
      soundEnabled: false,
      roomId: 'fern',
      ambience: 'rain',
      ambienceVolume: 0.4,
      popOutOnStart: false,
    },
  },
  'commitment/added': {
    type: 'commitment/added',
    at: 2,
    commitment: {
      id: 'commitment-added',
      title: 'Standup',
      startsAt: 20,
      durationMin: 30,
      prepMin: 5,
      recoverMin: 10,
    },
  },
  'commitment/updated': {
    type: 'commitment/updated',
    at: 3,
    id: 'commitment-updated',
    patch: {
      title: 'Review',
      startsAt: 30,
      durationMin: 45,
      prepMin: 10,
      recoverMin: 15,
    },
  },
  'commitment/removed': {
    type: 'commitment/removed',
    at: 4,
    id: 'commitment-removed',
  },
  'region/set': {
    type: 'region/set',
    at: 5,
    regions: [{ id: 'morning', startsAt: 40, endsAt: 50 }],
  },
  'break/planned': {
    type: 'break/planned',
    at: 6,
    plannedBreak: { id: 'break-planned', startsAt: 60, durationMin: 15 },
  },
  'break/updated': {
    type: 'break/updated',
    at: 7,
    id: 'break-updated',
    patch: { startsAt: 70, durationMin: 20 },
  },
  'break/removed': {
    type: 'break/removed',
    at: 8,
    id: 'break-removed',
  },
  'block/started': {
    type: 'block/started',
    at: 9,
    id: 'block-started',
    blockKind: 'reflect',
    endsAt: 90,
    purpose: 'Plan the day',
  },
  'block/purposeSet': {
    type: 'block/purposeSet',
    at: 10,
    purpose: 'Write the review',
  },
  'block/completed': { type: 'block/completed', at: 11 },
  'block/abandoned': { type: 'block/abandoned', at: 12 },
  'break/started': {
    type: 'break/started',
    at: 13,
    id: 'break-started',
    endsAt: 130,
  },
  'break/ended': { type: 'break/ended', at: 14 },
  'away/recorded': { type: 'away/recorded', at: 15, from: 140, to: 150 },
  'day/reset': { type: 'day/reset', at: 16 },
  'day/shaped': { type: 'day/shaped', at: 17 },
} satisfies CompleteEventLog

const EVERY: MonoEvent[] = Object.values(EVERY_EVENT)

describe('persisted schema', () => {
  it('returns a well-formed current log unchanged', () => {
    const persisted = { events: EVERY, dayKey: '2026-09-07' }

    expect(migratePersisted(persisted, SCHEMA_VERSION)).toEqual(persisted)
  })

  it('does not materialise optional fields that were absent', () => {
    const events: MonoEvent[] = [
      { type: 'settings/changed', at: 1, patch: { shortMinutes: 25 } },
      {
        type: 'commitment/added',
        at: 2,
        commitment: {
          id: 'commitment-minimal',
          title: 'Standup',
          startsAt: 20,
          durationMin: 30,
        },
      },
      {
        type: 'commitment/updated',
        at: 3,
        id: 'commitment-minimal',
        patch: { title: 'Review' },
      },
      {
        type: 'break/updated',
        at: 4,
        id: 'break-minimal',
        patch: { startsAt: 40 },
      },
      {
        type: 'block/started',
        at: 5,
        id: 'block-minimal',
        blockKind: 'deep',
        endsAt: 50,
        purpose: null,
      },
    ]

    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual(events)
  })

  it('prunes patch events that carry no readable change', () => {
    const shaped: MonoEvent = { type: 'day/shaped', at: 4 }
    const events: MonoEvent[] = [
      { type: 'settings/changed', at: 1, patch: {} },
      { type: 'commitment/updated', at: 2, id: 'commitment', patch: {} },
      { type: 'break/updated', at: 3, id: 'break', patch: {} },
      shaped,
    ]

    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([shaped])
  })
})
