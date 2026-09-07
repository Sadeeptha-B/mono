/**
 * React's share of ambient playback: what sound the day wants, and the mute.
 *
 * The audio graph itself lives in `audio.ts` and is a module singleton; this
 * hook only declares intent at it. That split is what lets the tab and the mini
 * window both show a speaker without either of them owning a second
 * AudioContext — the hook is mounted once, in `App`, above both surfaces, and
 * both are handed the same controls.
 *
 * Intent is derived, never stored. A sound is wanted when a *block* is running
 * and the phase is focusing or reflecting, which is why breaks, prompts and the
 * idle stage fall quiet without anything having to remember to stop them. The
 * phase is the authority here; what happens to be on screen is not.
 *
 * The mute is the one piece of state, and it is deliberately session-only. It
 * survives consecutive blocks while the tab lives, is shared by both surfaces,
 * and resets on reload. It is never appended to the event log: the log is the
 * day's journal, and "I turned the noise off for a while" is not part of what
 * the day was.
 *
 * It also governs less than its name suggests. It silences the derived ambience
 * of a running block. It does not silence the six-second preview you get from
 * choosing a sound in the Room menu — choosing a sound *is* the request to hear
 * it, and the mute is not even reachable while idle — and it does not touch the
 * completion chime, which rides its own bus in `audio.ts`.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { ROOMS, type AmbienceKind } from './rooms'
import {
  audioSnapshot,
  setAmbienceIntent,
  subscribeAudio,
  unlockAudio,
} from './audio'
import type { ActiveSegment, AmbienceSelection, RoomId } from '@/domain/types'
import { isBlockRunning, type Phase } from '@/domain/machine'

export function resolveAmbience(selection: AmbienceSelection, roomId: RoomId): AmbienceKind | null {
  if (selection === 'off') return null
  return selection === 'room' ? ROOMS[roomId].suggestedAmbience : selection
}

/**
 * Sound is wanted exactly while a block is running, which is a fact about the
 * session rather than about audio — so it is `isBlockRunning` that owns it, and
 * this name survives only because it is what the rest of this module and its
 * tests call the question. The extension that blocks websites asks the same
 * one; see the docblock on `isBlockRunning` for why the two must agree.
 */
export const wantsAmbience = (phase: Phase, active: ActiveSegment | null): boolean =>
  isBlockRunning(phase, active)

export type AmbienceControls = {
  available: boolean
  paused: boolean
  toggle: () => void
}

export function useAmbience({
  selection,
  roomId,
  volume,
  phase,
  active,
}: {
  selection: AmbienceSelection
  roomId: RoomId
  volume: number
  phase: Phase
  active: ActiveSegment | null
}): AmbienceControls {
  const [muted, setMuted] = useState(false)
  const audioState = useSyncExternalStore(subscribeAudio, audioSnapshot, () => 'locked')
  const kind = resolveAmbience(selection, roomId)
  const wanted = wantsAmbience(phase, active)

  useEffect(() => {
    setAmbienceIntent(wanted ? kind : null, volume, muted)
  }, [wanted, kind, volume, muted])

  const paused = muted || audioState !== 'running'
  const toggle = useCallback(() => {
    if (paused) {
      setMuted(false)
      void unlockAudio()
    } else {
      setMuted(true)
    }
  }, [paused])

  return { available: kind !== null && wanted, paused, toggle }
}

