/**
 * Which places All Tasks folds down to their rows. Areas start open, with
 * epics and outcomes folded beneath them, so a first visit reads as a map of
 * the backlog rather than every task in it. Explicit choices are saved by id
 * (`taskFolds.ts`) across questions, blocks and reloads. A place hidden by a
 * search, or archived and restored, keeps the view chosen for it.
 *
 * Defaults are derived from the whole tree, not seeded at mount: the backlog
 * hydrates asynchronously, and places added later need the same defaults.
 * Search looks through folds without saving that temporary expanded view;
 * writing into a place explicitly opens it.
 */

import { useCallback, useMemo } from 'react'

import type { TaskTreeNode } from '@/domain/tasks'
import { useTaskFolds } from '@/store/taskFolds'

export function useFolds(tree: readonly TaskTreeNode[]) {
  const choices = useTaskFolds((s) => s.choices)
  const setFolded = useTaskFolds((s) => s.setFolded)
  const folded = useMemo(() => {
    const result = new Set<string>()
    const visit = (nodes: readonly TaskTreeNode[]) => {
      for (const node of nodes) {
        const chosen = Object.hasOwn(choices, node.id) ? choices[node.id] : undefined
        if (chosen ?? node.kind !== 'area') result.add(node.id)
        visit(node.children)
      }
    }
    visit(tree)
    return result
  }, [tree, choices])
  const toggle = useCallback((id: string) => setFolded(id, !folded.has(id)), [folded, setFolded])
  const unfold = useCallback((id: string) => setFolded(id, false), [setFolded])
  return { folded, toggle, unfold }
}
