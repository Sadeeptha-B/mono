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
 * The board folds areas too, and an epic's own column of tasks under a key of
 * its own (`epicTasksFold`). An epic keeps no fold of its own: its caret folds
 * every column in its row, one choice written per column in one write
 * (`setManyFolded`), and folding every epic in an area does the same for all
 * of theirs, so each column still remembers its own afterwards. Entries under
 * a bare epic's id, from when an epic folded its whole row, are read by
 * nothing and left alone.
 *
 * A refused or damaged localStorage entry loses only this preference; folding
 * must still work in memory and never interrupt choosing or tidying a task.
 */

import { create } from 'zustand'

type ViewFolds = {
  choices: Readonly<Record<string, boolean>>
  setFolded: (id: string, folded: boolean) => void
  setManyFolded: (ids: readonly string[], folded: boolean) => void
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

function writeFolds(key: string, choices: Readonly<Record<string, boolean>>) {
  try {
    localStorage.setItem(key, JSON.stringify(choices))
  } catch {
    // A view preference is expendable; the choice still holds for this tab.
  }
}

const createViewFolds = (key: string) =>
  create<ViewFolds>()((set) => ({
    choices: readFolds(key),
    setFolded: (id, folded) => set(({ choices }) => {
      const next = { ...choices, [id]: folded }
      writeFolds(key, next)
      return { choices: next }
    }),
    setManyFolded: (ids, folded) => set(({ choices }) => {
      const next = { ...choices, ...Object.fromEntries(ids.map((id) => [id, folded])) }
      writeFolds(key, next)
      return { choices: next }
    }),
  }))

/** All Tasks' folds (`components/allTasks/folds.ts`). */
export const useTaskFolds = createViewFolds('mono.task-folds')

/** The tasks page's board folds: areas, outcomes and epics' own tasks folded by hand. */
export const useBoardFolds = createViewFolds('mono.board-folds')

/**
 * The board's key for an epic's own column of tasks, beside its outcomes, apart
 * from the epic's id. Mono's ids are UUIDs, which never contain `/`; an edited
 * import that clashed would cost no more than a fold.
 */
export const epicTasksFold = (epicId: string): string => `${epicId}/tasks`
