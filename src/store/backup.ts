/**
 * Export and import: the one place that speaks for both stores.
 *
 * Mono keeps the day and the backlog apart — different stores, different
 * storage, neither importing the other — and a backup is the one thing that
 * has to be both at once. So it is composed here rather than taught to either
 * store. The session store writes the file, and `readImport` reads it, because
 * the file's format and version are the log's; the backlog rides along beside
 * it.
 *
 * Import order matters. The file is read first, because reading it is what
 * throws for a file that is not a Mono export at all, and that has to happen
 * before anything is touched. The backlog goes next, because writing it is the
 * step that can fail afterwards — the disk can refuse it — and the task store
 * changes nothing when it does. The day goes last, replaced only once the
 * backlog has landed, so a refused import leaves both exactly as they were.
 * A file with no backlog in it — anything exported before tasks existed —
 * leaves the backlog alone.
 *
 * Every import and export takes its turn, one after another. An import has to
 * wait for the disk between its two halves, and without turns a second import
 * that needed no such wait — a file from before tasks existed — could replace
 * the day first, only to have the earlier file's day land over it. An export
 * waits its turn too, so it records what the imports before it produced, and
 * it waits for the backlog to have been read at all: the task store starts
 * empty, and an export taken before it has loaded would write that down as an
 * empty backlog, which importing the file would then make true.
 */

import { readImport } from './schema'
import { useSession } from './session'
import { useTasks, whenHydrated } from './tasks'

/** The last import or export asked for. Never rejects. */
let turns: Promise<unknown> = Promise.resolve()

/** Run `work` once every import and export asked for before it has finished. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = turns.then(work)
  turns = run.catch(() => undefined)
  return run
}

export function exportBackup(): Promise<string> {
  return inTurn(async () => {
    await whenHydrated()
    const { areas, items, later } = useTasks.getState()
    return useSession.getState().exportJSON({ areas, items, later })
  })
}

/**
 * Throws, touching nothing, when the file is not something Mono can read, or
 * when the browser will not save the backlog it carries.
 */
export function importBackup(json: string): Promise<void> {
  return inTurn(async () => {
    // Read in its turn rather than when asked for, so the day it is judged
    // against is the one it will actually land in.
    const file = readImport(json, Date.now())
    if (file.tasks) {
      try {
        await useTasks.getState().replaceAll(file.tasks)
      } catch {
        throw new Error('Could not save the tasks in that file, so nothing was imported.')
      }
    }
    useSession.getState().applyImport(file)
  })
}
