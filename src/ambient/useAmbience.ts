/** React ownership for ambient playback and the tab-local mute shared by both windows. */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { ROOMS, type AmbienceKind } from './rooms'
import {
  audioSnapshot,
  setAmbienceIntent,
  subscribeAudio,
  unlockAudio,
} from './audio'
import type { ActiveSegment, AmbienceSelection, RoomId } from '@/domain/types'
import type { Phase } from '@/domain/machine'

export function resolveAmbience(selection: AmbienceSelection, roomId: RoomId): AmbienceKind | null {
  if (selection === 'off') return null
  return selection === 'room' ? ROOMS[roomId].suggestedAmbience : selection
}

export const wantsAmbience = (phase: Phase, active: ActiveSegment | null): boolean =>
  active?.kind === 'block' && (phase.name === 'focusing' || phase.name === 'reflecting')

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

