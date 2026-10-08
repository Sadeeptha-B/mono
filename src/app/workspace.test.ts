import { describe, expect, it } from 'vitest'

import type { Phase } from '@/domain/machine'
import {
  choosingFor,
  columnView,
  initialWorkspace,
  reduce,
  settle,
  stageOf,
  type Facts,
  type Workspace,
} from './workspace'

/**
 * The day's workspace: when each thing `App` holds about where the user is
 * stops being true, and what each press does to it. The screens it drives are
 * the browser suite's; these are the rules.
 */

const idle: Phase = { name: 'idle' }
const purpose: Phase = { name: 'definingPurpose', blockKind: 'deep', deciding: null }
const focusing: Phase = { name: 'focusing' }
const reconciling: Phase = { name: 'reconciling', lastSeenAt: 0, blockEndedAt: 0 }

const facts = (patch: Partial<Facts> = {}): Facts => ({
  generation: 1,
  phase: idle,
  dayShaped: true,
  now: 1_000,
  intentionMinutes: 10,
  inPlay: (pick) => pick,
  ...patch,
})

/** A workspace with something in every field, on a shaped day. */
const busy = (patch: Partial<Workspace> = {}): Workspace => ({
  ...initialWorkspace(1, 'idle'),
  setupStage: 'hours',
  revisiting: true,
  todayTimer: { startedAt: 0, endsAt: 600_000 },
  composer: { kind: 'hours' },
  column: { for: 'today', view: 'day' },
  blockPick: ['a', 'b'],
  hours: [{ start: '09:00', end: '17:00' }],
  ...patch,
})

describe('settling', () => {
  it('changes nothing, and hands back the same workspace, when nothing has moved on', () => {
    const ws = busy({ setupStage: 'today', column: { for: 'today', view: 'day' } })
    expect(settle(ws, facts())).toBe(ws)
  })

  it('lets everything go when the session is replaced', () => {
    const settled = settle(busy(), facts({ generation: 2 }))
    expect(settled).toEqual(initialWorkspace(2, 'idle'))
  })

  it('closes the calendar\'s editor on entering reconciling, and only on entering it', () => {
    const entered = settle(busy({ column: null }), facts({ phase: reconciling }))
    expect(entered.composer).toBeNull()
    // Opened again while reconciling, it stays.
    const reopened = { ...entered, composer: { kind: 'hours' as const } }
    expect(settle(reopened, facts({ phase: reconciling }))).toBe(reopened)
  })

  it('starts a new purpose prompt with nothing ticked', () => {
    const settled = settle(busy({ column: null }), facts({ phase: purpose }))
    expect(settled.blockPick).toEqual([])
  })

  it('forgets the column chosen for a question once it has closed', () => {
    const chosen = busy({ setupStage: 'today', column: { for: 'today', view: 'day' } })
    expect(settle(chosen, facts()).column).toEqual({ for: 'today', view: 'day' })
    // Another question on the stage: today's has closed.
    expect(settle({ ...chosen, setupStage: 'hours' }, facts()).column).toBeNull()
  })

  it('lets go for good of a tick whose task has left', () => {
    const settled = settle(busy({ column: null }), facts({ inPlay: (pick) => pick.slice(1) }))
    expect(settled.blockPick).toEqual(['b'])
  })

  it("starts today's timer the first time today's question is shown on an unshaped day", () => {
    const fresh = { ...initialWorkspace(1, 'idle'), setupStage: 'today' as const }
    const settled = settle(fresh, facts({ dayShaped: false }))
    expect(settled.todayTimer).toEqual({ startedAt: 1_000, endsAt: 1_000 + 10 * 60_000 })
    // Once: settling again changes nothing.
    expect(settle(settled, facts({ dayShaped: false, now: 5_000 }))).toBe(settled)
    // Not on a day already shaped, where it starts only from its own button.
    expect(settle({ ...fresh, revisiting: true }, facts()).todayTimer).toBeNull()
  })
})

describe('the column', () => {
  it('follows the question or the block that can turn it over', () => {
    const ws = initialWorkspace(1, 'idle')
    const today = { ...ws, setupStage: 'today' as const }
    expect(choosingFor(stageOf(today, idle, false), idle)).toBe('today')
    expect(choosingFor(stageOf(ws, purpose, true), purpose)).toBe('block')
    expect(choosingFor(stageOf(ws, focusing, true), focusing)).toBe('focus')
    expect(choosingFor(stageOf(ws, idle, true), idle)).toBeNull()
  })

  it('opens on All Tasks for a question, on the day for a block, and as chosen by hand', () => {
    const ws = initialWorkspace(1, 'idle')
    expect(columnView(ws, null)).toBe('day')
    expect(columnView(ws, 'today')).toBe('tasks')
    expect(columnView(ws, 'block')).toBe('tasks')
    expect(columnView(ws, 'focus')).toBe('day')
    const chosen = reduce(ws, { type: 'showColumn', for: 'focus', view: 'tasks' })
    expect(columnView(chosen, 'focus')).toBe('tasks')
    expect(columnView(chosen, 'block')).toBe('tasks')
  })
})

describe('presses', () => {
  it("going to the hours question closes the calendar's hours editor, and no other", () => {
    const hours = reduce(busy({ revisiting: false }), { type: 'goToSetupStage', stage: 'hours' })
    expect(hours).toMatchObject({ setupStage: 'hours', revisiting: true, composer: null })
    const commitment = { kind: 'commitment' as const, editing: null }
    expect(
      reduce(busy({ composer: commitment }), { type: 'goToSetupStage', stage: 'hours' }).composer,
    ).toBe(commitment)
  })

  it("opening the calendar's hours editor takes the question off the stage, and its draft", () => {
    const shaped = reduce(busy({ composer: null }), {
      type: 'openComposer',
      composer: { kind: 'hours' },
      stage: 'hours',
      dayShaped: true,
    })
    expect(shaped).toMatchObject({ revisiting: false, hours: null, composer: { kind: 'hours' } })

    const unshaped = reduce(busy({ composer: null, revisiting: false }), {
      type: 'openComposer',
      composer: { kind: 'hours' },
      stage: 'hours',
      dayShaped: false,
    })
    expect(unshaped).toMatchObject({ setupStage: 'commitments', hours: null })

    // Any other editor leaves the question and its draft alone.
    const other = reduce(busy({ composer: null }), {
      type: 'openComposer',
      composer: { kind: 'break', editing: null },
      stage: 'hours',
      dayShaped: true,
    })
    expect(other).toMatchObject({ revisiting: true, hours: busy().hours })
  })

  it('finishing the opening questions lets go of the draft, the revisit and the timer', () => {
    expect(reduce(busy(), { type: 'finishSetup' })).toMatchObject({
      hours: null,
      revisiting: false,
      todayTimer: null,
    })
  })

  it('ticks and unticks for the block, and starts the timer and the draft from a press', () => {
    const ws = initialWorkspace(1, 'idle')
    const ticked = reduce(ws, { type: 'tickBlock', taskIds: ['a', 'b'], on: true })
    expect(reduce(ticked, { type: 'tickBlock', taskIds: ['a'], on: false }).blockPick).toEqual(['b'])
    expect(reduce(ws, { type: 'startTodayTimer', at: 0, minutes: 5 }).todayTimer).toEqual({
      startedAt: 0,
      endsAt: 300_000,
    })
    const hours = [{ start: '10:00', end: '12:00' }]
    expect(reduce(ws, { type: 'draftHours', hours }).hours).toBe(hours)
  })
})
