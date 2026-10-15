/**
 * The whole of Mono's routing.
 *
 * There are exactly five views — the day, the tasks, the timeline, the
 * routine, and the guide — so this is a hash check rather than a router. The
 * hash is deliberate: it survives a reload, it can be opened in a second tab,
 * and the header entries are real links, so middle-click and "open in new
 * tab" behave the way people expect of a document.
 *
 * A route change swaps the page `App` renders, and the page it leaves is
 * unmounted with whatever it held. `App` itself stays mounted, and with it
 * the session, its timers and reconciliation, so a block in flight keeps its
 * timer while you read.
 */

import { useSyncExternalStore } from 'react'

export type Route = 'day' | 'guide' | 'tasks' | 'timeline' | 'routine'

export const GUIDE_HASH = '#/guide'
export const TASKS_HASH = '#/tasks'
export const TIMELINE_HASH = '#/timeline'
export const ROUTINE_HASH = '#/routine'
export const DAY_HASH = '#/'

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

const getSnapshot = (): string => window.location.hash

export function useRoute(): Route {
  // The server snapshot is only here to satisfy the signature; there is no SSR.
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '')
  return hash === GUIDE_HASH
    ? 'guide'
    : hash === TASKS_HASH
      ? 'tasks'
      : hash === TIMELINE_HASH
        ? 'timeline'
        : hash === ROUTINE_HASH
          ? 'routine'
          : 'day'
}
