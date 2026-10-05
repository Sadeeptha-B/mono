/**
 * Export and import: the one place that speaks for both stores.
 *
 * Mono keeps the day and the backlog apart — different stores, different
 * storage, neither importing the other — and a backup is the one thing that
 * has to be both at once. So it is composed here rather than taught to either
 * store. The session store writes and reads the file, because the file's
 * format and version are the log's; the backlog rides along beside it.
 *
 * Import order matters. The session goes first, because reading it is what
 * throws for a file that is not a Mono export at all, and that has to happen
 * before the backlog is touched. A file with no backlog in it — anything
 * exported before tasks existed — leaves the backlog exactly as it was.
 */

import { useSession } from './session'
import { useTasks } from './tasks'

export function exportBackup(): string {
  const { areas, items } = useTasks.getState()
  return useSession.getState().exportJSON({ areas, items })
}

/** Throws, touching nothing, when the file is not something Mono can read. */
export async function importBackup(json: string): Promise<void> {
  const tasks = useSession.getState().importJSON(json)
  if (tasks) await useTasks.getState().replaceAll(tasks)
}
