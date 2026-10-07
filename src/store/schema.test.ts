import { describe, expect, it } from 'vitest'

import { replay, type MonoEvent } from '@/domain/events'
import { migratePersisted, readImport, SCHEMA_VERSION } from './schema'

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
      intentionMinutes: 7,
      defaultRegions: [{ start: '08:30', end: '17:30' }],
      plannerPolicy: 'maximise-focus',
      notificationsEnabled: true,
      soundEnabled: false,
      roomId: 'fern',
      ambience: 'rain',
      ambienceVolume: 0.4,
      popOutOnStart: false,
      popOutOnDecide: false,
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
      recurringId: 'series-added',
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
    taskIds: ['task-a', 'task-b'],
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
  'intention/added': {
    type: 'intention/added',
    at: 18,
    intention: { id: 'intention-added', title: 'Mono auth', done: true },
  },
  'intention/updated': {
    type: 'intention/updated',
    at: 19,
    id: 'intention-updated',
    patch: { title: 'Billing ticket', done: false },
  },
  'intention/removed': { type: 'intention/removed', at: 20, id: 'intention-removed' },
  'intention/taskLinked': {
    type: 'intention/taskLinked',
    at: 21,
    taskId: 'task-a',
    intentionId: 'intention-added',
  },
  'today/taskAdded': { type: 'today/taskAdded', at: 22, taskId: 'task-c' },
  'today/taskRemoved': { type: 'today/taskRemoved', at: 23, taskId: 'task-c' },
  'block/noted': {
    type: 'block/noted',
    at: 24,
    id: 'note-a',
    text: 'Schema done',
  },
  'block/urged': { type: 'block/urged', at: 25 },
  'block/urgeTakenBack': { type: 'block/urgeTakenBack', at: 26 },
  'block/noteEdited': {
    type: 'block/noteEdited',
    at: 27,
    blockId: 'block-started',
    noteId: 'note-a',
    text: 'Schema finished',
  },
  'block/noteRemoved': {
    type: 'block/noteRemoved',
    at: 28,
    blockId: 'block-started',
    noteId: 'note-a',
  },
  'recurring/added': {
    type: 'recurring/added',
    at: 29,
    rule: {
      id: 'series-added',
      title: 'Standup',
      time: '09:00',
      durationMin: 15,
      prepMin: 5,
      recoverMin: 5,
      repeat: { every: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] },
      startsOn: '2026-09-01',
      endsOn: '2026-12-18',
    },
  },
  'recurring/updated': {
    type: 'recurring/updated',
    at: 30,
    id: 'series-added',
    patch: {
      title: 'Swim',
      time: '16:00',
      durationMin: 60,
      prepMin: 30,
      recoverMin: 20,
      repeat: { every: 'month', interval: 2, monthDay: 31 },
      startsOn: '2026-09-02',
      endsOn: null,
    },
  },
  'recurring/removed': { type: 'recurring/removed', at: 31, id: 'series-added' },
} satisfies CompleteEventLog

const EVERY: MonoEvent[] = Object.values(EVERY_EVENT)

/** What v6 added: everything written into a running block. */
const V6: readonly string[] = [
  'block/noted',
  'block/urged',
  'block/urgeTakenBack',
  'block/noteEdited',
  'block/noteRemoved',
]

/** What v7 added: commitments that come round on a schedule. */
const isV7 = (e: MonoEvent): boolean => e.type.startsWith('recurring/')

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

describe('the v4 schema', () => {
  const NOW = new Date(2026, 9, 5, 10).getTime()
  const today = '2026-10-05'

  it('reads a v3 log exactly as it was, rather than discarding it on upgrade', () => {
    const v3 = {
      events: EVERY.filter(
        (e) =>
          !e.type.startsWith('intention/') &&
          !e.type.startsWith('today/') &&
          !V6.includes(e.type) &&
          !isV7(e),
      ),
      dayKey: today,
    }
    expect(migratePersisted(v3, 3)).toEqual(v3)
  })

  it('reads a v4 log exactly as it was, rather than discarding it on upgrade', () => {
    const v4 = {
      events: EVERY.filter((e) => !e.type.startsWith('today/') && !V6.includes(e.type) && !isV7(e)),
      dayKey: today,
    }
    expect(migratePersisted(v4, 4)).toEqual(v4)
  })

  it('reads a v5 log exactly as it was, rather than discarding it on upgrade', () => {
    const v5 = { events: EVERY.filter((e) => !V6.includes(e.type) && !isV7(e)), dayKey: today }
    expect(migratePersisted(v5, 5)).toEqual(v5)
  })

  it("drops a block's note or correction it cannot read, and trims what it keeps", () => {
    const events = [
      { type: 'block/noted', at: 1, id: 'n', text: '   ' },
      { type: 'block/noted', at: 2, text: 'no id' },
      { type: 'block/noted', at: 3, id: 'n', text: 7 },
      { type: 'block/noted', at: 4, id: 'n', text: '  kept  ' },
      { type: 'block/noteEdited', at: 5, blockId: 'b', noteId: 'n', text: '' },
      { type: 'block/noteEdited', at: 6, blockId: 'b', text: 'no note' },
      { type: 'block/noteEdited', at: 7, blockId: 'b', noteId: 'n', text: ' fixed ' },
      { type: 'block/noteRemoved', at: 8, noteId: 'n' },
      { type: 'block/noteRemoved', at: 9, blockId: 'b', noteId: 'n' },
    ]
    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([
      { type: 'block/noted', at: 4, id: 'n', text: 'kept' },
      { type: 'block/noteEdited', at: 7, blockId: 'b', noteId: 'n', text: 'fixed' },
      { type: 'block/noteRemoved', at: 9, blockId: 'b', noteId: 'n' },
    ])
  })

  it('reads a v6 log exactly as it was, rather than discarding it on upgrade', () => {
    const v6 = { events: EVERY.filter((e) => !isV7(e)), dayKey: today }
    expect(migratePersisted(v6, 6)).toEqual(v6)
  })

  it('drops an event whose instants no date can hold, rather than failing to load', () => {
    // Finite, and far past the last day a `Date` can represent: replay reads
    // the day from it, and formatting it throws.
    const series = EVERY_EVENT['recurring/added']
    const shaped: MonoEvent = { type: 'day/shaped', at: 4 }
    const events = [
      series,
      { ...EVERY_EVENT['recurring/updated'], at: 1e20 },
      { ...EVERY_EVENT['commitment/added'], commitment: { ...EVERY_EVENT['commitment/added'].commitment, startsAt: 1e20 } },
      { type: 'away/recorded', at: 3, from: -1e20, to: 5 },
      { type: 'block/started', at: 4, id: 'b', blockKind: 'deep', endsAt: 1e17, purpose: null },
      shaped,
    ] as MonoEvent[]

    const { events: kept } = migratePersisted({ events, dayKey: null }, SCHEMA_VERSION)
    expect(kept).toEqual([series, shaped])
    expect(() => replay(kept)).not.toThrow()
  })

  it('drops a series it cannot read whole, rather than guessing at its days', () => {
    const rule = {
      id: 'series',
      title: 'Standup',
      time: '09:00',
      durationMin: 15,
      repeat: { every: 'day', interval: 1 },
      startsOn: '2026-09-01',
    }
    const kept = { type: 'recurring/added', at: 1, rule } as MonoEvent
    const events = [
      kept,
      { type: 'recurring/added', at: 2, rule: { ...rule, id: 'a', time: '9am' } },
      { type: 'recurring/added', at: 3, rule: { ...rule, id: 'b', startsOn: '2026-02-30' } },
      { type: 'recurring/added', at: 4, rule: { ...rule, id: 'c', endsOn: 'soon' } },
      {
        type: 'recurring/added',
        at: 5,
        rule: { ...rule, id: 'd', repeat: { every: 'week', interval: 1, weekdays: [] } },
      },
      {
        type: 'recurring/added',
        at: 6,
        rule: { ...rule, id: 'e', repeat: { every: 'month', interval: 1, monthDay: 32 } },
      },
      { type: 'recurring/added', at: 7, rule: { ...rule, id: 'f', repeat: { every: 'year' } } },
      { type: 'recurring/updated', at: 8, id: 'series', patch: { startsOn: 'tomorrow' } },
    ] as MonoEvent[]

    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([kept])
  })

  it("drops a today event that names no task", () => {
    const events = [
      { type: 'today/taskAdded', at: 1, taskId: 7 },
      { type: 'today/taskRemoved', at: 2 },
      { type: 'today/taskAdded', at: 3, taskId: 't' },
    ]
    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([
      { type: 'today/taskAdded', at: 3, taskId: 't' },
    ])
  })

  it('keeps a block whose task ids are partly unreadable, with the ones it can read', () => {
    const started = { type: 'block/started', at: 1, id: 'b', blockKind: 'deep', endsAt: 2, purpose: 'x' }
    const events = [{ ...started, taskIds: ['a', 7, null, 'b'] }]
    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([
      { ...started, taskIds: ['a', 'b'] },
    ])
  })

  it("leaves an older log's intention links behind, and drops an edit that only moved one", () => {
    const events = [
      {
        type: 'intention/added',
        at: 1,
        intention: { id: 'i', title: 'x', link: { kind: 'epic', id: 'e' } },
      },
      { type: 'intention/updated', at: 2, id: 'i', patch: { title: 'y', link: null } },
      { type: 'intention/updated', at: 3, id: 'i', patch: { link: { kind: 'area', id: 'work' } } },
      { type: 'intention/updated', at: 4, id: 'i', patch: {} },
      { type: 'intention/taskLinked', at: 5, taskId: 't', intentionId: 4 },
    ]
    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([
      { type: 'intention/added', at: 1, intention: { id: 'i', title: 'x' } },
      { type: 'intention/updated', at: 2, id: 'i', patch: { title: 'y' } },
    ])
  })

  it("reads an intention's done mark, and leaves out one it cannot read", () => {
    const events = [
      { type: 'intention/added', at: 1, intention: { id: 'i', title: 'x', done: true } },
      { type: 'intention/added', at: 2, intention: { id: 'j', title: 'y', done: 'yes' } },
      { type: 'intention/updated', at: 3, id: 'i', patch: { done: false } },
      { type: 'intention/updated', at: 4, id: 'j', patch: { title: 7, done: true } },
      { type: 'intention/updated', at: 5, id: 'j', patch: { done: 'yes' } },
    ]
    expect(migratePersisted({ events, dayKey: null }, SCHEMA_VERSION).events).toEqual([
      { type: 'intention/added', at: 1, intention: { id: 'i', title: 'x', done: true } },
      { type: 'intention/added', at: 2, intention: { id: 'j', title: 'y' } },
      { type: 'intention/updated', at: 3, id: 'i', patch: { done: false } },
      { type: 'intention/updated', at: 4, id: 'j', patch: { done: true } },
    ])
  })

  it('leaves the backlog alone for a file that carries none', () => {
    const file = JSON.stringify({ version: 3, dayKey: today, events: [] })
    expect(readImport(file, NOW).tasks).toBeNull()
  })

  it('reads the backlog from a v4 file, dropping only the records it cannot read', () => {
    const area = { id: 'work', name: 'Work', order: 0, createdAt: 1, updatedAt: 1 }
    const task = {
      id: 't',
      kind: 'task',
      title: 'Call Priya',
      parentId: 'work',
      status: 'done',
      order: 0,
      createdAt: 1,
      updatedAt: 2,
      doneAt: 2,
      archivedAt: 3,
    }
    const file = JSON.stringify({
      version: 4,
      dayKey: today,
      events: [],
      tasks: {
        areas: [area, { id: 'broken' }],
        items: [task, { ...task, id: 'bad', status: 'maybe' }],
      },
    })
    expect(readImport(file, NOW).tasks).toEqual({ areas: [area], items: [task] })
  })

  it('refuses a backlog whose readable tasks lost their unreadable parent', () => {
    // The area cannot be read, so it is dropped; its task can, and would be
    // imported belonging to nothing, in no view at all.
    const task = {
      id: 't',
      kind: 'task',
      title: 'Call Priya',
      parentId: 'work',
      status: 'open',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const file = JSON.stringify({
      version: 4,
      dayKey: today,
      events: [],
      tasks: { areas: [{ id: 'work', name: 42 }], items: [task] },
    })
    expect(() => readImport(file, NOW)).toThrow(/do not fit together.*nothing was imported/)
  })

  it('drops a record whose version cannot be advanced', () => {
    // Every edit is stamped one past the version it replaces, and past
    // Number.MAX_SAFE_INTEGER that changes nothing, so the record could never
    // be edited again. Only a damaged or edited file has one.
    const area = { id: 'work', name: 'Work', order: 0, createdAt: 1, updatedAt: 1 }
    const task = {
      id: 't',
      kind: 'task',
      title: 'Call Priya',
      parentId: 'work',
      status: 'open',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const file = JSON.stringify({
      version: 4,
      dayKey: today,
      events: [],
      tasks: {
        areas: [area],
        items: [
          task,
          { ...task, id: 'stuck', updatedAt: 2 ** 53 },
          { ...task, id: 'fraction', updatedAt: 1.5 },
          { ...task, id: 'negative', updatedAt: -1 },
        ],
      },
    })
    expect(readImport(file, NOW).tasks?.items.map((i) => i.id)).toEqual(['t'])
  })

  it('reads back a record at the last version, which an edit can reach', () => {
    const area = { id: 'work', name: 'Work', order: 0, createdAt: 1, updatedAt: Number.MAX_SAFE_INTEGER }
    const file = JSON.stringify({
      version: 4,
      dayKey: today,
      events: [],
      tasks: { areas: [area], items: [] },
    })
    expect(readImport(file, NOW).tasks?.areas).toEqual([area])
  })

  it('refuses a file from a newer version than this one', () => {
    const file = JSON.stringify({ version: SCHEMA_VERSION + 1, events: [] })
    expect(() => readImport(file, NOW)).toThrow(/newer version/)
  })
})
