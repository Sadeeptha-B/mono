/**
 * Service worker registration, with one rule: never reload during a block.
 *
 * The default `autoUpdate` behaviour swaps the worker and reloads as soon as a
 * new build is available. In a focus app that would destroy a running session
 * for the sake of a patch release, so we hold the update and apply it the next
 * time the user is idle.
 */

import { registerSW } from 'virtual:pwa-register'

import { useSession } from '@/store/session'

/**
 * The idle check, hoisted so the mini window can ask for it again.
 *
 * Normally the store is the only thing that can make Mono idle, so subscribing
 * to it is enough. Closing the mini window is the exception — it changes
 * whether a reload is acceptable without changing any session state at all —
 * and a pending update would otherwise sit there until the next dispatch.
 */
let recheck: (() => void) | null = null

export const recheckPendingUpdate = (): void => recheck?.()

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return

  let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null

  const flushWhenIdle = () => {
    if (!applyUpdate) return
    const { phase, session } = useSession.getState()
    // Idle means nothing running and no dialog waiting on an answer.
    if (session.active !== null || phase.name !== 'idle') return
    // And no mini window, which is a stronger reason than it looks. The reload
    // destroys that document, and a picture-in-picture window can only be
    // opened from a user gesture — so unlike a block, which the user can simply
    // start again, there is nothing the app could do to put it back. An always-
    // on-top window vanishing on its own is also the single most alarming thing
    // this app could do to a desktop.
    if (window.documentPictureInPicture?.window) return

    const update = applyUpdate
    applyUpdate = null
    void update(true)
  }

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      flushWhenIdle()
    },
  })

  // Re-check on every state change, so a pending update lands the moment the
  // user finishes a block rather than waiting for the next launch.
  useSession.subscribe(flushWhenIdle)
  recheck = flushWhenIdle
}
