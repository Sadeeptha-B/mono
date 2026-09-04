/**
 * Notifications and the end-of-block chime.
 *
 * Both are gated behind a user gesture, and for the same reason: browsers
 * refuse to grant notification permission or start an AudioContext without
 * one. `unlockOnGesture` is called from the first "start block" click, so the
 * chime is guaranteed to work by the time a block can possibly end.
 *
 * An honest limitation: without a push server, a notification fired from a
 * frozen tab can be delayed or dropped. This is best-effort. The guarantee is
 * the reconcile-on-wake path in `useReconciliation`, not this file.
 */

import { useCallback, useEffect, useRef } from 'react'

import { useSession } from '@/store/session'

let audioContext: AudioContext | null = null

/** Called from a real click, so the browser will honour both requests. */
export async function unlockOnGesture(wantsNotifications: boolean): Promise<void> {
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor) audioContext = new Ctor()
  }
  if (audioContext?.state === 'suspended') await audioContext.resume()

  if (wantsNotifications && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission()
  }
}

/** A short two-tone chime. Synthesised so there is no audio asset to ship. */
export function playChime(): void {
  if (!audioContext || audioContext.state !== 'running') return

  const now = audioContext.currentTime
  for (const [index, frequency] of [660, 880].entries()) {
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()

    osc.type = 'sine'
    osc.frequency.value = frequency

    const start = now + index * 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)

    osc.connect(gain).connect(audioContext.destination)
    osc.start(start)
    osc.stop(start + 0.5)
  }
}

export function notify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  // The mini window is always on top, so a hidden tab no longer means the user
  // cannot see this. A notification saying "block complete" beside a window
  // already saying "block done" is the app talking over itself.
  //
  // The chime is deliberately left alone. It is audible from another
  // application and from another room, which is exactly what a visible window
  // is not, so it is not the duplicate this is.
  if (window.documentPictureInPicture?.window) return
  new Notification(title, { body, tag: 'mono-block', icon: `${import.meta.env.BASE_URL}icons/icon-192.png` })
}

/**
 * Announce a block or break ending, exactly once each.
 *
 * Keyed on the *segment id* rather than the phase name. Keying on the phase
 * silently breaks on the second block of a run: the phase returns to
 * `blockComplete` having never passed through `idle`, so a "have we announced
 * this phase yet" flag is still set and the chime never fires again.
 */
export function useBlockEndAlerts(): void {
  const phase = useSession((s) => s.phase)
  const active = useSession((s) => s.session.active)
  const settings = useSession((s) => s.session.settings)

  const announcedBlock = useRef<string | null>(null)
  const runningBreak = useRef<{ id: string; endsAt: number } | null>(null)

  useEffect(() => {
    if (phase.name === 'blockComplete' && active && announcedBlock.current !== active.id) {
      announcedBlock.current = active.id
      if (settings.soundEnabled) playChime()
      if (settings.notificationsEnabled) {
        notify('Block complete', 'Need a break, or straight into the next one?')
      }
      return
    }

    // A break ending deserves the same nudge — that is the moment the user is
    // most likely to have wandered off.
    if (phase.name === 'onBreak' && active?.kind === 'break') {
      runningBreak.current = { id: active.id, endsAt: active.endsAt }
      return
    }
    if (phase.name !== 'onBreak' && runningBreak.current !== null) {
      const { endsAt } = runningBreak.current
      runningBreak.current = null
      // Only if the break actually ran out. Cutting one short with "Back to
      // work" is the user already being back; chiming at them for it is the
      // app talking over them. The second of slack covers the tick landing
      // fractionally before `endsAt`.
      if (Date.now() < endsAt - 1000) return
      if (settings.soundEnabled) playChime()
      if (settings.notificationsEnabled) notify('Break over', 'Ready for the next block?')
    }
  }, [phase, active, settings.soundEnabled, settings.notificationsEnabled])
}

/** Request permission and unlock audio, memoised for use in click handlers. */
export function useUnlock(): () => Promise<void> {
  const settings = useSession((s) => s.session.settings)
  return useCallback(
    () => unlockOnGesture(settings.notificationsEnabled),
    [settings.notificationsEnabled],
  )
}
