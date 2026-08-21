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

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return

  let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null

  const flushWhenIdle = () => {
    if (!applyUpdate) return
    const { phase, session } = useSession.getState()
    // Idle means nothing running and no dialog waiting on an answer.
    if (session.active !== null || phase.name !== 'idle') return

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
}
