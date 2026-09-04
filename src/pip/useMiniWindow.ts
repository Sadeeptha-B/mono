/**
 * The mini window itself: opening it, dressing it, and knowing when it is gone.
 *
 * This owns the window and hands back a container element to render into. It
 * does not own what goes in it — that is `MiniWindow`, mounted through a portal
 * from `App`, so the mini window is part of the one React tree rather than a
 * second root of its own. That matters more than it sounds: a second root would
 * mean a second copy of every subscription, and the side-effecting hooks — the
 * reconciler, the end-of-block alerts — are one careless import away from
 * running twice and dispatching a block's completion twice with it. A portal
 * makes that structurally impossible.
 *
 * Everything happens inside the click handler rather than in an effect. The
 * browser only grants a window to a real user gesture, and doing it here also
 * sidesteps StrictMode's double-invoke, which would otherwise ask for two.
 */

import { useCallback, useRef, useState } from 'react'

import { copyStylesInto, paint } from './styles'
import { alsoTickFrom } from '@/hooks/useNow'
import { recheckPendingUpdate } from '@/pwa/registerServiceWorker'
import { useSession } from '@/store/session'

/**
 * Roughly a phone's notification, and resizable from there.
 *
 * Chromium clamps this to what it thinks is reasonable, and the user can drag
 * it to any size afterwards, so it is an opening position rather than a layout
 * assumption — the content is built to survive being made much smaller.
 */
const SIZE = { width: 400, height: 320 }

/** Whether this browser has the API at all. Chromium does; nothing else yet. */
export const supportsMiniWindow = (): boolean =>
  typeof window !== 'undefined' && window.documentPictureInPicture !== undefined

type Mini = { window: Window; container: HTMLElement }

export type MiniWindowControls = {
  /** Where to portal the contents, or null while there is no window. */
  container: HTMLElement | null
  open: () => void
  close: () => void
}

export function useMiniWindow(): MiniWindowControls {
  const [mini, setMini] = useState<Mini | null>(null)
  // The two things that have to be undone, whichever way the window goes away:
  // the borrowed ticker, and the listener that tells us it went.
  const teardown = useRef<(() => void) | null>(null)
  // A window that has been asked for and has not arrived. See `open`.
  const opening = useRef(false)

  const forget = useCallback(() => {
    teardown.current?.()
    teardown.current = null
    setMini(null)
    // Closing the window can be the thing that makes a held-back update
    // acceptable, and it is not a change the store would announce.
    recheckPendingUpdate()
  }, [])

  const open = useCallback(() => {
    const api = window.documentPictureInPicture
    // Two guards for one rule, because asking twice is not harmless. Requesting
    // a window does *not* fail when one is already open — the algorithm closes
    // the existing window and opens a replacement — so a second request throws
    // away the window the user is looking at and quietly swaps in another.
    //
    // `api.window` covers the window that exists. `opening` covers the one that
    // has been asked for and not yet arrived, which nothing else can see: the
    // property stays null until the request resolves, so without this the gap
    // between asking and being answered accepts a second ask. It is a real gap
    // to fall into now that a block starting opens a window on its own — press
    // `Pop out` and then `Start`, or simply double-click `Pop out`, which stays
    // reading `Pop out` until the first one lands.
    //
    // Overlapping requests are worse than the wasted window suggests. Both
    // continuations would go on to write the same `teardown` ref, so one
    // window's closing would run the other's cleanup and leave a timer ticking
    // against a document nobody can see.
    if (!api || api.window || opening.current) return

    opening.current = true
    void (async () => {
      let pip: Window
      try {
        pip = await api.requestWindow(SIZE)
      } catch {
        // Refused, or dismissed. An ordinary answer to "may I have a window",
        // not a failure worth reporting.
        return
      } finally {
        // Cleared the moment the request settles, not when the setting-up
        // below finishes: by then the window itself exists, so `api.window` is
        // the guard that applies and there is no gap between the two.
        opening.current = false
      }

      // Everything up to the stylesheets happens with no `await` between it and
      // the window arriving, and the order is the point. The user can close this
      // window from its own title bar at any moment, including while its
      // stylesheets are still in flight — and a close nobody heard is the worst
      // state this feature has: the portal keeps rendering into a document that
      // has been thrown away, the header still offers to close a window that is
      // no longer there, and a timer goes on ticking against it. So the listener
      // that tells us it is gone goes on before anything can be waited for.
      let gone = false
      const onGone = () => {
        gone = true
        // Never synchronously: unmounting the portal from inside the `pagehide`
        // dispatch would have React writing to a document that is being taken
        // apart underneath it.
        queueMicrotask(forget)
      }
      pip.addEventListener('pagehide', onGone)

      pip.document.title = 'Mono'
      paint(pip.document, useSession.getState().session.settings.roomId)

      const container = pip.document.createElement('div')
      container.className = 'h-dvh'
      pip.document.body.append(container)

      await copyStylesInto(pip.document, document)

      // Closed while we were dressing it. Nothing has been installed yet and
      // `forget` has already run, so all that is left is to stop being the
      // thing that would install it.
      if (gone || pip.closed) {
        pip.removeEventListener('pagehide', onGone)
        return
      }

      // The window is always on top, so it is never a hidden tab and never has
      // its timers throttled. That is the whole reason the countdown out here
      // stays truthful while the tab it came from is buried.
      const stopTicking = alsoTickFrom(pip)

      teardown.current = () => {
        stopTicking()
        pip.removeEventListener('pagehide', onGone)
      }

      setMini({ window: pip, container })
    })()
  }, [forget])

  const close = useCallback(() => {
    const pip = mini?.window
    // The window goes first, and the bookkeeping second. `forget` asks whether
    // a held-back service worker update can be let through now, and that
    // question is answered by asking the browser whether a mini window is open
    // — so running it while the window is still there answers it wrong, and the
    // update would sit until some later dispatch happened to ask again.
    //
    // Closing first can fire `pagehide` before the listener comes off, which
    // costs nothing: `forget` clears the teardown it just ran, and the state it
    // sets is already the state it wants, so a second pass through it is a
    // no-op with one extra harmless re-check on the end.
    pip?.close()
    forget()
  }, [mini, forget])

  return { container: mini?.container ?? null, open, close }
}
