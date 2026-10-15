/**
 * Saved view preferences for the backlog's two drawings, separate from the
 * day's event log and backlog exports: which places All Tasks folds, and which
 * the tasks page's board folds. Only explicit choices are stored, by id, so a
 * place that arrives later — from another tab, or after the first visit —
 * takes its view's default rather than a guess written for it.
 *
 * One store each, under its own key, because the two defaults differ and a
 * choice made in one is not a choice about the other. All Tasks starts epics
 * and outcomes folded, since it is for choosing from; the board starts epics
 * open and outcomes folded, so an area reads as its epics and their outcomes
 * and a column's tasks are shown once asked for. Folding a branch while
 * picking a block's tasks would otherwise fold the board too, with nothing on
 * the page to say why.
 *
 * A refused or damaged localStorage entry loses only this preference; folding
 * must still work in memory and never interrupt choosing or tidying a task.
 */

import { create } from 'zustand'

type ViewFolds = {
  choices: Readonly<Record<string, boolean>>
  setFolded: (id: string, folded: boolean) => void
}

function readFolds(key: string): Readonly<Record<string, boolean>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, folded]) => typeof folded === 'boolean'))
  } catch {
    return {}
  }
}

const createViewFolds = (key: string) =>
  create<ViewFolds>()((set) => ({
    choices: readFolds(key),
    setFolded: (id, folded) => set(({ choices }) => {
      const next = { ...choices, [id]: folded }
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // A view preference is expendable; the choice still holds for this tab.
      }
      return { choices: next }
    }),
  }))

/** All Tasks' folds (`components/allTasks/folds.ts`). */
export const useTaskFolds = createViewFolds('mono.task-folds')

/** The tasks page's board folds: epics and outcomes folded by hand. */
export const useBoardFolds = createViewFolds('mono.board-folds')
