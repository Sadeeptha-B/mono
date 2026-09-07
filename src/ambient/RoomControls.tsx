/**
 * The room and sound controls in the header's quick menu.
 *
 * Each application header receives a prefix so the day and guide routes keep
 * unique radio groups and range ids during a route handover.
 */

import { useEffect, useRef, useState } from 'react'

import { previewAmbience, setLiveAmbienceVolume, unlockAudio } from './audio'
import { ambienceLabel, ROOMS, type AmbienceKind } from './rooms'
import { labelClass } from '@/components/ui'
import { useSession } from '@/store/session'
import { ROOM_IDS, type AmbienceSelection, type Settings } from '@/domain/types'

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
  const soundOn = settings.ambience !== 'off'
  const soundToggleTitle = soundOn ? 'Turn ambient sound off' : 'Turn ambient sound on'

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

  const chooseAmbience = (choice: AmbienceSelection) => {
    const resolved: AmbienceKind | null =
      choice === 'off'
        ? null
        : choice === 'room'
          ? ROOMS[settings.roomId].suggestedAmbience
          : choice
    set('ambience', choice)
    if (
      active?.kind === 'block' &&
      (phase.name === 'focusing' || phase.name === 'reflecting')
    ) {
      void unlockAudio()
    } else {
      void previewAmbience(resolved, volume)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex min-h-8 items-center justify-between gap-3">
          <span
            id={`${idPrefix}-focus-room-label`}
            className="text-xs font-medium tracking-wide text-muted uppercase"
          >
            Focus room
          </span>
          <button
            type="button"
            aria-label="Ambient sound"
            aria-pressed={soundOn}
            title={soundToggleTitle}
            onClick={() => chooseAmbience(soundOn ? 'off' : 'room')}
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-muted/70 transition',
              soundOn
                ? 'bg-deep/10 text-deep hover:bg-deep/20'
                : 'text-muted hover:bg-surface-raised hover:text-body',
            ].join(' ')}
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" />
              {soundOn ? (
                <path d="M13.5 7a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" />
              ) : (
                <path d="m14 8 3 4m0-4-3 4" />
              )}
            </svg>
          </button>
        </div>

        <fieldset aria-labelledby={`${idPrefix}-focus-room-label`}>
          <div className="grid grid-cols-2 gap-2">
            {ROOM_IDS.map((id) => {
              const room = ROOMS[id]
              const checked = settings.roomId === id
              return (
                <label
                  key={id}
                  className={[
                    'cursor-pointer rounded-lg border px-3 py-2.5 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-deep',
                    checked
                      ? 'border-deep bg-deep/10'
                      : 'border-muted/70 hover:bg-surface-raised',
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
                      style={{ backgroundColor: room.palette[room.indicator] }}
                    />
                    {room.label}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </div>

      <fieldset>
        <legend className={labelClass}>Ambient sound</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['room', 'brown', 'pink', 'rain'] as const).map((choice) => {
            const resolved: AmbienceKind =
              choice === 'room' ? ROOMS[settings.roomId].suggestedAmbience : choice
            const label =
              choice === 'room'
                ? `Room sound — ${ambienceLabel(resolved)}`
                : ambienceLabel(choice)
            const checked = settings.ambience === choice
            return (
              <label
                key={choice}
                className={[
                  'cursor-pointer rounded-lg border px-3 py-2 text-xs transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-deep',
                  checked
                    ? 'border-deep bg-deep/10 text-bright'
                    : 'border-muted/70 text-body hover:bg-surface-raised',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-ambient-sound`}
                  checked={checked}
                  onChange={() => chooseAmbience(choice)}
                  className="sr-only"
                />
                {label}
              </label>
            )
          })}
        </div>

        {/* With `off` moved out to the speaker there is no checked radio while
            ambience is silent, and four untouched options read as a question
            nobody has answered rather than a setting that has a value. Naming
            the state costs a line and says where its switch went. */}
        {!soundOn && (
          <p className="mt-2 text-xs text-muted">
            Off — choose a sound, or use the speaker above.
          </p>
        )}

        {soundOn && (
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
