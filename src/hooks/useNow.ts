/**
 * One ticker for the whole app.
 *
 * The tick exists only to trigger a re-render. It is never accumulated into a
 * remaining-time counter — every countdown in the UI is computed as
 * `endsAt - Date.now()`, so a throttled, delayed or entirely skipped tick
 * cannot make the clock wrong. It can only make it briefly stale.
 *
 * That guarantee is what lets the tick come from more than one place. A hidden
 * tab has its timers throttled to about one a minute, which is fine for a page
 * nobody is looking at and useless for the mini window, whose entire job is to
 * be looked at while the tab is hidden. So an always-on-top window lends its own
 * timer to the ticker for as long as it is open — see `alsoTickFrom`. The
 * displayed time is `endsAt - now` either way; the extra source only decides how
 * often that subtraction is redone.
 */

import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let intervalId: ReturnType<typeof setInterval> | null = null
let currentNow = Date.now()

/**
 * Advance to the current second, if it has moved.
 *
 * Idempotent within a second, which is what makes extra tick sources free:
 * two intervals a few hundred milliseconds out of phase, plus a wake listener
 * firing on top of them, still cost exactly one re-render per second. Nothing
 * here reads below a second — `formatTimer` is minutes and seconds — so the
 * skipped update would have painted the identical screen.
 */
function tick() {
  const next = Date.now()
  if (Math.floor(next / 1000) === Math.floor(currentNow / 1000)) return
  currentNow = next
  for (const listener of listeners) listener()
}

/** A window's own interval, plus the two events that mean it just came back. */
function tickFrom(win: Window): () => void {
  const id = win.setInterval(tick, 1000)
  const onWake = () => tick()
  win.document.addEventListener('visibilitychange', onWake)
  win.addEventListener('focus', onWake)

  return () => {
    // Cleaning up after a window that has already gone is the ordinary case
    // here, not the exceptional one — a mini window is usually ended by the
    // user closing it, and Mono's own close deliberately closes before it tidies
    // up. A closed window has taken its timers and listeners with it either way,
    // so there is nothing here to undo.
    //
    // Precautionary rather than demonstrated: a closed window need not still
    // have a `document` to take a listener off, and reaching for one that is not
    // there would throw in the middle of a teardown and abandon the rest of it.
    // The e2e stub stands a mini window up with an iframe, and a detached iframe
    // keeps its document, so it cannot reproduce this — which is exactly why the
    // guard is worth the two lines rather than worth arguing about.
    if (win.closed) return

    win.clearInterval(id)
    win.document.removeEventListener('visibilitychange', onWake)
    win.removeEventListener('focus', onWake)
  }
}

/**
 * Add a second window as a tick source, until the returned disposer is called.
 *
 * The opener's own interval is left running rather than swapped out. It costs
 * nothing given the guard in `tick`, and it means the day view keeps ticking
 * from its own timer whatever happens to the borrowed one — including a mini
 * window that is closed by the browser rather than by us.
 */
export function alsoTickFrom(win: Window): () => void {
  const stop = tickFrom(win)
  // The new window is visible by definition, so it has almost certainly opened
  // into a moment the throttled opener has not noticed yet.
  tick()
  return stop
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
