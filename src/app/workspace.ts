/**
 * The day's workspace: what `App` holds about where the user is in it, rather
 * than about the day itself.
 *
 * Which opening question is on the stage and whether it was come back to,
 * today's question's timer, the calendar's open editor, which view the right
 * column shows, what the purpose prompt has ticked, and the hours typed into
 * the opening question. None of it is in the log: each is a moment in this
 * session, not a fact about the day. And most of it sits above both columns
 * for a reason — the stage and the calendar both open the hours editor, All
 * Tasks and the purpose prompt both tick for the block — so it lives with the
 * component above both.
 *
 * What makes it worth a module is when each piece stops being true. A new
 * session, a phase entered, a question closed, a task leaving play: each lets
 * some of it go, and a new feature that holds state here has to know every
 * one. So the rules are here, in order, as one pure function (`settle`) that
 * `App` runs during render — the way React documents adjusting state to what
 * changed, so the stale answer is never painted for a frame — and the
 * transitions a press makes are the other (`reduce`). Both are tested without
 * a screen (`workspace.test.ts`). No clock and no store: `App` hands in what
 * it read.
 */

import type { ChoosingFor, ColumnView } from '@/components/AllTasksPane'
import { emptyBlockPick, tickTasks, type BlockPick } from '@/components/blockPick'
import type { TodayTimer } from '@/components/stage/TodayPanel'
import { FIRST_SETUP_STAGE, stageFor, type SetupStageId, type StageId } from '@/components/stage/stages'
import type { Composer } from '@/components/Timeline/SegmentEditor'
import type { Phase } from '@/domain/machine'
import { minutesToMs, type DefaultRegion, type Ms } from '@/domain/types'

export type Workspace = {
  /** The session's `generation` this workspace belongs to. */
  generation: number
  /** The phase last seen, so entering one is noticed once. */
  phase: Phase['name']
  /** Which opening question the stage is on. */
  setupStage: SetupStageId
  /**
   * The opening questions, re-opened after the day was already shaped. Where
   * the user is looking, so here and not in the log: `day/shaped` records
   * being asked, and coming back to change an answer is not being asked again.
   */
  revisiting: boolean
  /**
   * Today's question's timer, as two instants. Never written to the log — see
   * `TodayPanel` for why it is not a block — and a reload simply starts the
   * question's time again, as it re-asks any other question. `null` until it
   * has run once this session.
   */
  todayTimer: TodayTimer | null
  /** The calendar's open editor. One at a time, and only one of the hours. */
  composer: Composer | null
  /**
   * Which view the right column shows, chosen by hand, and for which question
   * or block. Forgotten when that closes; otherwise the column follows its
   * default (`columnView`).
   */
  column: { for: ChoosingFor; view: ColumnView } | null
  /** What the purpose prompt has ticked for its block (`blockPick.ts`). */
  blockPick: BlockPick
  /**
   * Today's hours as typed into the opening question, or null while untouched
   * and so whatever the day says (`useHoursDraft` explains why). Up here
   * because the calendar previews it as it is typed.
   */
  hours: DefaultRegion[] | null
}

export const initialWorkspace = (generation: number, phase: Phase['name']): Workspace => ({
  generation,
  phase,
  setupStage: FIRST_SETUP_STAGE,
  revisiting: false,
  todayTimer: null,
  composer: null,
  column: null,
  blockPick: emptyBlockPick,
  hours: null,
})

/** What `settle` is told about the moment, read by `App` from the session and the clock. */
export type Facts = {
  generation: number
  phase: Phase
  dayShaped: boolean
  now: Ms
  /** How long today's question's timer runs. */
  intentionMinutes: number
  /** The ticks still naming a task in play and still today's (`pickedInPlay`). */
  inPlay: (pick: BlockPick) => BlockPick
}

/**
 * Whether the stage shows the opening questions: while unanswered, and again
 * whenever the user goes back to them.
 */
export const setupOpen = (ws: Workspace, dayShaped: boolean): boolean => !dayShaped || ws.revisiting

/** The stage the workspace and phase put on screen. */
export const stageOf = (ws: Workspace, phase: Phase, dayShaped: boolean): StageId | null =>
  stageFor(phase, setupOpen(ws, dayShaped), ws.setupStage)

/**
 * The question choosing tasks, if one is open, or the block running: while
 * either is, the column can show All Tasks instead of the day.
 */
export function choosingFor(stage: StageId | null, phase: Phase): ChoosingFor | null {
  if (stage === 'today') return 'today'
  if (phase.name === 'definingPurpose') return 'block'
  if (phase.name === 'focusing') return 'focus'
  return null
}

/**
 * What the column shows. The questions open on All Tasks, where their answers
 * come from; a running block opens on the day, which is drawing it. A choice
 * made by hand lasts until the question closes or the block ends.
 */
export function columnView(ws: Workspace, choosing: ChoosingFor | null): ColumnView {
  if (choosing === null) return 'day'
  if (ws.column?.for === choosing) return ws.column.view
  return choosing === 'focus' ? 'day' : 'tasks'
}

/**
 * The workspace as the moment leaves it: every rule that lets some of it go,
 * in the order they apply. The same object back when nothing changes, so
 * `App` sets state only when there is something to set.
 */
export function settle(ws: Workspace, facts: Facts): Workspace {
  let next = ws

  // The session was replaced under us — midnight came round with the tab
  // open, or a file was imported. Everything here was about the old one:
  // hours typed at 23:59 are about yesterday, and previewing them onto the
  // new day would be a stale draft one level above the calendar's own.
  if (next.generation !== facts.generation) {
    next = initialWorkspace(facts.generation, next.phase)
  }

  if (next.phase !== facts.phase.name) {
    next = {
      ...next,
      phase: facts.phase.name,
      // Waking across a block boundary is an interruption rather than a stage,
      // and an editor still open beside its prompt is somewhere else for the
      // answering click to land. On entering the phase, not while in it: one
      // opened deliberately during it stays.
      ...(facts.phase.name === 'reconciling' ? { composer: null } : {}),
      // A new purpose prompt starts with nothing ticked.
      ...(facts.phase.name === 'definingPurpose' ? { blockPick: emptyBlockPick } : {}),
    }
  }

  // A column chosen for a question that has closed, or a block that has ended.
  const choosing = choosingFor(stageOf(next, facts.phase, facts.dayShaped), facts.phase)
  if (next.column !== null && next.column.for !== choosing) next = { ...next, column: null }

  // A tick whose task has left is let go for good, so the task coming back
  // does not bring the tick back with it — see `blockPick.ts`.
  const inPlay = facts.inPlay(next.blockPick)
  if (inPlay.length !== next.blockPick.length) next = { ...next, blockPick: inPlay }

  // The first sight of today's question on a day not yet shaped starts its
  // timer, so the face never paints a frame with no time on it. Written once.
  if (
    setupOpen(next, facts.dayShaped) &&
    !facts.dayShaped &&
    next.setupStage === 'today' &&
    next.todayTimer === null
  ) {
    next = { ...next, todayTimer: timerFrom(facts.now, facts.intentionMinutes) }
  }

  return next
}

/** What a press does to the workspace. */
export type WorkspaceEvent =
  /** Move the stage to one of the opening questions, which also re-opens them. */
  | { type: 'goToSetupStage'; stage: SetupStageId }
  /** Leave the opening questions, the day started or its answers changed. */
  | { type: 'finishSetup' }
  /** Open an editor under the calendar, or close it. */
  | { type: 'openComposer'; composer: Composer | null; stage: StageId | null; dayShaped: boolean }
  | { type: 'showColumn'; for: ChoosingFor; view: ColumnView }
  | { type: 'tickBlock'; taskIds: readonly string[]; on: boolean }
  | { type: 'startTodayTimer'; at: Ms; minutes: number }
  | { type: 'draftHours'; hours: DefaultRegion[] }

export function reduce(ws: Workspace, event: WorkspaceEvent): Workspace {
  switch (event.type) {
    case 'goToSetupStage':
      return {
        ...ws,
        setupStage: event.stage,
        revisiting: true,
        // Two drafts of today's hours is a race with a person in it: the
        // question coming back closes the calendar's editor of the same thing.
        composer: event.stage === 'hours' && ws.composer?.kind === 'hours' ? null : ws.composer,
      }

    case 'finishSetup':
      // The hours were written, or left alone if untouched (`hoursToSave`). The
      // timer was about getting the day started, and it has: coming back to
      // today's tasks later gets a fresh round only if asked for.
      return { ...ws, hours: null, revisiting: false, todayTimer: null }

    case 'openComposer': {
      if (event.composer?.kind !== 'hours') return { ...ws, composer: event.composer }
      // The same rule from the other side: the calendar's hours editor takes
      // the question off the stage — back to the day if it was re-opened, to
      // the other question if the day is not shaped and the panel cannot
      // close — and the question's draft goes with it, since it is what the
      // calendar is previewing.
      const offStage =
        event.stage === 'hours'
          ? event.dayShaped
            ? { revisiting: false }
            : { setupStage: 'commitments' as const }
          : {}
      return { ...ws, ...offStage, hours: null, composer: event.composer }
    }

    case 'showColumn':
      return { ...ws, column: { for: event.for, view: event.view } }

    case 'tickBlock':
      return { ...ws, blockPick: tickTasks(ws.blockPick, event.taskIds, event.on) }

    case 'startTodayTimer':
      return { ...ws, todayTimer: timerFrom(event.at, event.minutes) }

    case 'draftHours':
      return { ...ws, hours: event.hours }
  }
}

const timerFrom = (at: Ms, minutes: number): TodayTimer => ({
  startedAt: at,
  endsAt: at + minutesToMs(minutes),
})
