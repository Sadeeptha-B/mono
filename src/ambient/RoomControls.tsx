/**
 * The room and sound controls in the header's quick menu.
 *
 * Each application header receives a prefix so the day and guide routes keep
 * unique radio groups and range ids during a route handover.
 */

import { useEffect, useRef, useState } from 'react'

import { previewAmbience, setLiveAmbienceVolume, unlockAudio } from './audio'
import { ambienceLabel, ROOM_IDS, ROOMS, type AmbienceKind } from './rooms'
import { labelClass } from '@/components/ui'
import { useSession } from '@/store/session'
import type { Settings } from '@/domain/types'

export function RoomControls({ idPrefix }: { idPrefix: string }) {
  const settings = useSession((state) => state.session.settings)
  const phase = useSession((state) => state.phase)
  const active = useSession((state) => state.session.active)
  const updateSettings = useSession((state) => state.updateSettings)
  const [volume, setVolume] = useState(settings.ambienceVolume)
  const volumeRef = useRef(settings.ambienceVolume)
  const committedVolume = useRef(settings.ambienceVolume)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>)

  // A range emits an input event for every pixel it crosses. Settings are an
  // append-only journal, so sending those events through `updateSettings`
  // would preserve an entire drag forever. The thumb and percentage stay live
  // locally; pointer release (or blur for keyboard and assistive input) writes
  // the one value the user actually left behind.
  useEffect(() => {
    committedVolume.current = settings.ambienceVolume
    volumeRef.current = settings.ambienceVolume
    setVolume(settings.ambienceVolume)
  }, [settings.ambienceVolume])

  // Closing the popover by an outside pointer press removes the focused range
  // before the browser can blur it. Commit from teardown as the final boundary
  // so keyboard changes cannot remain only in the audio engine.
  useEffect(
    () => () => {
      const next = volumeRef.current
      if (next === committedVolume.current) return
      committedVolume.current = next
      updateSettings({ ambienceVolume: next })
    },
    [updateSettings],
  )

  const commitVolume = (next: number) => {
    if (next === committedVolume.current) return
    committedVolume.current = next
    set('ambienceVolume', next)
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className={labelClass}>Focus room</legend>
        <div className="grid grid-cols-2 gap-2">
          {ROOM_IDS.map((id) => {
            const room = ROOMS[id]
            const checked = settings.roomId === id
            return (
              <label
                key={id}
                className={[
                  'cursor-pointer rounded-lg border px-3 py-2.5 transition',
                  checked
                    ? 'border-deep bg-deep/10'
                    : 'border-line hover:bg-surface-raised',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-focus-room`}
                  checked={checked}
                  onChange={() => set('roomId', id)}
                  className="sr-only"
                />
                <span
                  className={`flex items-center gap-2 text-sm ${checked ? 'text-bright' : 'text-body'}`}
                >
                  <span
                    aria-hidden="true"
                    data-room-swatch={id}
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-bright/20"
                    style={{ backgroundColor: room.indicator }}
                  />
                  {room.label}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Ambient sound</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['off', 'room', 'brown', 'pink', 'rain'] as const).map((choice) => {
            const resolved: AmbienceKind | null =
              choice === 'off'
                ? null
                : choice === 'room'
                  ? ROOMS[settings.roomId].suggestedAmbience
                  : choice
            const label =
              choice === 'off'
                ? 'Off'
                : choice === 'room'
                  ? `Room sound — ${ambienceLabel(resolved!)}`
                  : ambienceLabel(choice)
            const checked = settings.ambience === choice
            return (
              <label
                key={choice}
                className={[
                  'cursor-pointer rounded-lg border px-3 py-2 text-xs transition',
                  checked
                    ? 'border-deep bg-deep/10 text-bright'
                    : 'border-line text-body hover:bg-surface-raised',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-ambient-sound`}
                  checked={checked}
                  onChange={() => {
                    set('ambience', choice)
                    if (
                      active?.kind === 'block' &&
                      (phase.name === 'focusing' || phase.name === 'reflecting')
                    ) {
                      void unlockAudio()
                    } else {
                      void previewAmbience(resolved, volume)
                    }
                  }}
                  className="sr-only"
                />
                {label}
              </label>
            )
          })}
        </div>

        {settings.ambience !== 'off' && (
          <div className="mt-3 text-xs text-muted">
            <div className="flex items-baseline justify-between gap-2">
              <label id={`${idPrefix}-ambience-volume-label`} htmlFor={`${idPrefix}-ambience-volume`}>
                Volume
              </label>
              <span className="tnum text-body">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <input
              id={`${idPrefix}-ambience-volume`}
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => {
                const next = Number(event.target.value) / 100
                volumeRef.current = next
                setVolume(next)
                setLiveAmbienceVolume(next)
              }}
              onPointerUp={(event) => commitVolume(Number(event.currentTarget.value) / 100)}
              onPointerCancel={(event) => commitVolume(Number(event.currentTarget.value) / 100)}
              onBlur={(event) => commitVolume(Number(event.currentTarget.value) / 100)}
              aria-labelledby={`${idPrefix}-ambience-volume-label`}
              className="mt-1 block w-full accent-[var(--color-deep)]"
            />
          </div>
        )}
      </fieldset>
    </div>
  )
}
