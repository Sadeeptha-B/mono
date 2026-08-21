/**
 * The resting state, and the first thing a new day asks for.
 *
 * The requirements open with "prompt the user to note his next commitment and
 * at what time", so when the day has no shape yet that prompt *is* the stage —
 * asked in place, not behind a button in the timeline header. Once there is a
 * commitment this collapses to the start control, and further commitments are
 * added from the timeline.
 */

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'

import { fieldClass, GhostButton, labelClass, PrimaryButton, StagePrompt } from '../ui'
import { formatClock, formatDuration, nextHalfHour, wallClockOn } from '@/domain/time'
import type { BlockKind, Ms } from '@/domain/types'

export function FirstCommitmentPanel({
  now,
  onAdd,
}: {
  now: Ms
  onAdd: (input: { title: string; startsAt: number; durationMin: number }) => void
}) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState(() => format(nextHalfHour(now), 'HH:mm'))
  const [duration, setDuration] = useState(30)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  // Resolved against today's calendar here, at the edge. `now` is read on every
  // render for this, but never written back into state — which is what would
  // reset the form on each tick while typing.
  const startsAt = wallClockOn(now, time)
  const valid = title.trim().length > 0 && startsAt !== null && duration > 0

  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || startsAt === null) return
        onAdd({ title: title.trim(), startsAt, durationMin: duration })
      }}
    >
      <StagePrompt
        eyebrow="To begin"
        title="What's next in your day?"
        detail="Name your next commitment and Mono will fill the runway up to it."
      />

      <input
        ref={input}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Daily standup"
        aria-label="Next commitment"
        maxLength={80}
        className={`${fieldClass} py-3 text-lg`}
      />

      <div className="mt-3 grid max-w-xs grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="first-commitment-time">
            At
          </label>
          <input
            id="first-commitment-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={`${fieldClass} tnum`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="first-commitment-duration">
            For (minutes)
          </label>
          <input
            id="first-commitment-duration"
            type="number"
            min={5}
            max={480}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className={`${fieldClass} tnum`}
          />
        </div>
      </div>

      <div className="mt-4">
        <PrimaryButton type="submit" disabled={!valid}>
          Plan around it
        </PrimaryButton>
      </div>
    </form>
  )
}

export function ReadyPanel({
  nextBlockKind,
  minutes,
  onStart,
}: {
  nextBlockKind: BlockKind | null
  minutes: number
  onStart: (kind: BlockKind) => void
}) {
  if (!nextBlockKind) {
    return (
      <div className="max-w-md">
        <StagePrompt
          eyebrow="Nothing running"
          title="No more blocks fit"
          detail="There isn't enough time before your next commitment to start another block."
        />
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Nothing running"
        title={`Ready for ${minutes} minutes`}
        detail={`Your next ${nextBlockKind === 'deep' ? 'deep' : 'short'} block is up.`}
      />
      <PrimaryButton type="button" onClick={() => onStart(nextBlockKind)}>
        Start {nextBlockKind === 'deep' ? 'deep' : 'short'} block
      </PrimaryButton>
    </div>
  )
}

/**
 * The current moment falls outside every work region.
 *
 * This is the honest answer to "why is nothing planned": you said this time
 * was not for working. The calendar beside it still shows what is coming, and
 * the escape hatch changes the declared shape rather than quietly ignoring it —
 * so working now means saying so.
 */
export function OutsideHoursPanel({
  now,
  nextStart,
  hasRegions,
  onEditHours,
}: {
  now: Ms
  /** When the next region opens, or null if the day is done. */
  nextStart: Ms | null
  hasRegions: boolean
  onEditHours: () => void
}) {
  const detail = !hasRegions
    ? "You haven't set any working hours for today."
    : nextStart === null
      ? "That's the end of your working hours. The plan picks up tomorrow."
      : `Nothing scheduled until ${formatClock(nextStart)}.`

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Outside working hours"
        title={
          nextStart === null ? 'Day done' : `Back in ${formatDuration(nextStart - now)}`
        }
        detail={detail}
      />
      <GhostButton type="button" onClick={onEditHours}>
        {hasRegions ? "Change today's hours" : 'Set working hours'}
      </GhostButton>
    </div>
  )
}
