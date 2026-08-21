/**
 * One ticker for the whole app.
 *
 * The tick exists only to trigger a re-render. It is never accumulated into a
 * remaining-time counter — every countdown in the UI is computed as
 * `endsAt - Date.now()`, so a throttled, delayed or entirely skipped tick
 * cannot make the clock wrong. It can only make it briefly stale.
 */

import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let intervalId: ReturnType<typeof setInterval> | null = null
let currentNow = Date.now()

function tick() {
  currentNow = Date.now()
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)

  if (intervalId === null) {
    intervalId = setInterval(tick, 1000)
  }

  // A tab returning to the foreground has almost certainly missed ticks, so
  // refresh immediately rather than showing a stale face for up to a second.
  const onWake = () => tick()
  document.addEventListener('visibilitychange', onWake)
  window.addEventListener('focus', onWake)

  return () => {
    listeners.delete(listener)
    document.removeEventListener('visibilitychange', onWake)
    window.removeEventListener('focus', onWake)

    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}

const getSnapshot = () => currentNow

/** Current time, refreshed about once a second. */
export const useNow = (): number => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
