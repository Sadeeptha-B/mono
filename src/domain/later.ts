/**
 * Later: a line put down to come back to — an idea, a question, something to
 * look into — that is about no block in particular.
 *
 * It looks like a block's log while it is being typed, and is the opposite of
 * one in every way that matters. A log is about the block it was written in,
 * points back at what happened, and is never acted on; it is part of the day's
 * journal and lives in the event log. A Later points forward, belongs to no
 * block, outlives the day, and is waiting for a decision. So it is kept where
 * the backlog is kept — long-lived records in IndexedDB, edited in place,
 * shaped for sync — rather than in the event log, which would have to fold a
 * growing list on every boot and would reset it at midnight.
 *
 * Nor is it a task, though it usually becomes one. A task has to be filed
 * under an area, and asking where a thought goes is the question it was put
 * down to avoid. It has no done either: it is not finished but dealt with,
 * one of three ways. Carried into the backlog it becomes a task there, and the
 * Later is deleted, the task being what it turned into. Let go, it stays,
 * out of the way, for the same reason a dropped task does: deciding not to is
 * a decision. Deleted, it goes for good. So it is a type of its own, as an
 * `Area` is, rather than a fourth item kind that every list of tasks would
 * have to step around.
 *
 * It keeps where it came from when it was written in a block — the block's
 * id and what that block was for, copied rather than looked up, since the day
 * that block belonged to is long gone by the time a Later is read — but it is
 * never drawn on that block. The calendar shows what the block was; a Later is
 * what it set aside.
 *
 * Pure, like everything in this folder: no clock and no ids. `at` and `id` are
 * passed in by the store, and versions, tombstones and `outranks` are the
 * backlog's (`tasks.ts`).
 */

import type { Ms } from './types'

/** Something put down to come back to. */
export type Later = {
  id: string
  /** One line, which becomes a task's title as it stands when it is filed. */
  title: string
  createdAt: Ms
  /** The record's version, as on an `Item`: an order, not a time to show. */
  updatedAt: Ms
  /** The block it was written in, and what that block was for. */
  from?: LaterSource
  /** When it was let go. Absent while it is waiting. */
  letGoAt?: Ms
  deletedAt?: Ms
}

export type LaterSource = { blockId: string; purpose: string }

/**
 * A task's title is typed into a field of this length, and a Later becomes a
 * task's title unchanged, so it is held to the same.
 */
export const LATER_MAX_LENGTH = 120

export const newLater = (
  input: { id: string; title: string; from?: LaterSource | undefined },
  at: Ms,
): Later => ({
  id: input.id,
  title: input.title.trim(),
  createdAt: at,
  updatedAt: at,
  ...(input.from === undefined ? {} : { from: input.from }),
})

export const letGo = (later: Later, at: Ms): Later => ({ ...later, letGoAt: at, updatedAt: at })

export const restore = (later: Later, at: Ms): Later => {
  const { letGoAt, ...rest } = later
  void letGoAt
  return { ...rest, updatedAt: at }
}

const byCreation = (a: Later, b: Later): number => a.createdAt - b.createdAt

/** What is waiting to be dealt with, oldest first. */
export const waitingLater = (list: readonly Later[]): Later[] =>
  list.filter((l) => l.deletedAt === undefined && l.letGoAt === undefined).sort(byCreation)

/** What was let go and can be brought back, oldest first. */
export const letGoLater = (list: readonly Later[]): Later[] =>
  list.filter((l) => l.deletedAt === undefined && l.letGoAt !== undefined).sort(byCreation)
