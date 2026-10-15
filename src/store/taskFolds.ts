/**
 * All Tasks' saved view preferences, separate from the day's event log and
 * backlog exports. Only explicit choices are stored: new epics and outcomes
 * start folded, even when they arrive after the browser has first opened.
 * A refused or damaged localStorage entry loses only this preference; folding
 * must still work in memory and never interrupt choosing a task.
 */

import { create } from 'zustand'

const KEY = 'mono.task-folds'

function readFolds(): Readonly<Record<string, boolean>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, folded]) => typeof folded === 'boolean'))
  } catch {
    return {}
  }
}

export const useTaskFolds = create<{
  choices: Readonly<Record<string, boolean>>
  setFolded: (id: string, folded: boolean) => void
}>()((set) => ({
  choices: readFolds(),
  setFolded: (id, folded) => set(({ choices }) => {
    const next = { ...choices, [id]: folded }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // A view preference is expendable; the choice still holds for this tab.
    }
    return { choices: next }
  }),
}))
