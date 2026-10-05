/**
 * Whether what Mono holds in memory is actually being written down.
 *
 * A store of its own, and it has to be one: this is the only state in Mono that
 * describes *storage*, so writing it into the session store would attempt
 * another save in order to record that a save failed. Not persisted for the
 * same reason — the fact it holds is about this browser right now, and a
 * reload re-establishes it on the first write either way.
 *
 * Two things write, and they fail and recover differently, so each reports
 * under its own name. The session log goes out whole on every save, so one
 * write that lands has caught up on everything the failed ones missed. The
 * backlog is written one record at a time, and a later success means nothing
 * about an earlier failure unless that failed record went out with it — which
 * is what `tasks.ts` arranges before it reports success. Kept apart, a
 * successful session save cannot clear a warning about a task that is still
 * only in memory, which a single flag would do.
 */

import { create } from 'zustand'

import type { Ms } from '@/domain/types'

export type StorageSource = 'session' | 'tasks'

type Failures = Record<StorageSource, Ms | null>

export const useStorageHealth = create<{
  failures: Failures
  /**
   * When a write was first refused and not since caught up, across both
   * sources, or null while everything is saved. What the header reads.
   */
  failedAt: Ms | null
  noteFailure: (at: Ms, source?: StorageSource) => void
  noteSuccess: (source?: StorageSource) => void
}>()((set) => ({
  failures: { session: null, tasks: null },
  failedAt: null,
  // First failure wins: the interesting instant is when saving stopped, not
  // the last time it was tried and still would not go.
  noteFailure: (at, source = 'session') =>
    set((s) =>
      s.failures[source] === null ? withFailures({ ...s.failures, [source]: at }) : s,
    ),
  noteSuccess: (source = 'session') =>
    set((s) =>
      s.failures[source] === null ? s : withFailures({ ...s.failures, [source]: null }),
    ),
}))

function withFailures(failures: Failures) {
  const times = Object.values(failures).filter((t): t is Ms => t !== null)
  return { failures, failedAt: times.length === 0 ? null : Math.min(...times) }
}
