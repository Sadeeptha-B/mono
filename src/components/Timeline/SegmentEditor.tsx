/**
 * Adding commitments and breaks to the timeline.
 *
 * Both take a wall-clock time, because that is how the user thinks ("standup
 * at 5"). It is resolved against today's calendar right here, at the edge —
 * the domain only ever sees epoch milliseconds.
 */

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'

import { Dialog } from '../prompts/Dialog'
import { RegionShapeEditor } from '../RegionShapeEditor'
import { fieldClass, GhostButton, labelClass, MinutesInput, PrimaryButton } from '../ui'
import { BREAK_MINUTES, COMMITMENT_MINUTES, parseBoundedMinutes } from '../minutes'
import { nextHalfHour, wallClockOn } from '@/domain/time'
import type { DefaultRegion, WorkRegion } from '@/domain/types'

/**
 * Seed the form when the dialog opens, and *only* then.
 *
 * `now` advances every second, so including it in the dependency list resets
 * the form once a second — which reads, while you are typing, as the field
 * clearing itself on every keystroke. The current time is still wanted for the
 * default value, so it is read through a ref instead of being depended upon.
 */
function useSeedOnOpen(open: boolean, now: number, seed: (now: number) => void) {
  const nowRef = useRef(now)
  nowRef.current = now

  const seedRef = useRef(seed)
  seedRef.current = seed

  useEffect(() => {
    if (open) seedRef.current(nowRef.current)
  }, [open])
}

export function AddCommitmentDialog({
  open,
  now,
  onAdd,
  onCancel,
}: {
  open: boolean
  now: number
  onAdd: (input: { title: string; startsAt: number; durationMin: number }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [durationText, setDurationText] = useState(String(COMMITMENT_MINUTES.fallback))

  useSeedOnOpen(open, now, (at) => {
    setTitle('')
    // Default to the next round half hour — the most likely answer.
    setTime(format(nextHalfHour(at), 'HH:mm'))
    setDurationText(String(COMMITMENT_MINUTES.fallback))
  })

  const startsAt = wallClockOn(now, time)
  const duration = parseBoundedMinutes(
    durationText,
    COMMITMENT_MINUTES.min,
    COMMITMENT_MINUTES.max,
  )
  const valid = title.trim().length > 0 && startsAt !== null && duration !== null

  return (
    <Dialog
      open={open}
      title="Next commitment"
      description="Something already fixed in your day. Mono plans around it."
      onDismiss={onCancel}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid || startsAt === null || duration === null) return
          onAdd({ title: title.trim(), startsAt, durationMin: duration })
        }}
      >
        <label className={labelClass} htmlFor="commitment-title">
          What
        </label>
        <input
          id="commitment-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Daily standup"
          maxLength={80}
          className={fieldClass}
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="commitment-time">
              At
            </label>
            <input
              id="commitment-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${fieldClass} tnum`}
            />
          </div>
          <MinutesInput
            id="commitment-duration"
            label="For (minutes)"
            text={durationText}
            onText={setDurationText}
            {...COMMITMENT_MINUTES}
          />
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          Adding this re-derives the plan, which clears any breaks you had pinned. Add
          them back wherever they still make sense.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <GhostButton type="button" onClick={onCancel}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!valid}>
            Add
          </PrimaryButton>
        </div>
      </form>
    </Dialog>
  )
}

export function AddBreakDialog({
  open,
  now,
  onAdd,
  onCancel,
}: {
  open: boolean
  now: number
  onAdd: (input: { startsAt: number; durationMin: number }) => void
  onCancel: () => void
}) {
  const [time, setTime] = useState('')
  const [durationText, setDurationText] = useState(String(BREAK_MINUTES.fallback))

  useSeedOnOpen(open, now, (at) => {
    setTime(format(nextHalfHour(at), 'HH:mm'))
    setDurationText(String(BREAK_MINUTES.fallback))
  })

  const startsAt = wallClockOn(now, time)
  const duration = parseBoundedMinutes(durationText, BREAK_MINUTES.min, BREAK_MINUTES.max)
  const valid = startsAt !== null && duration !== null

  return (
    <Dialog
      open={open}
      title="Plan a break"
      description="Pin rest where you know you'll need it. The plan works around it."
      onDismiss={onCancel}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid || startsAt === null || duration === null) return
          onAdd({ startsAt, durationMin: duration })
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="break-time">
              From
            </label>
            <input
              id="break-time"
              type="time"
              autoFocus
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${fieldClass} tnum`}
            />
          </div>
          <MinutesInput
            id="break-duration"
            label="For (minutes)"
            text={durationText}
            onText={setDurationText}
            {...BREAK_MINUTES}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton type="button" onClick={onCancel}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!valid}>
            Add break
          </PrimaryButton>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * Today's working hours.
 *
 * Editing here overrides the recurring default for this day only — the shape
 * in settings is untouched, and tomorrow starts from it again. Times are
 * authored as wall clock and resolved against today at save, so this stays on
 * the right side of the epoch-milliseconds boundary.
 */
export function TodayHoursDialog({
  open,
  now,
  regions,
  usingDefaults,
  onSave,
  onCancel,
}: {
  open: boolean
  now: number
  regions: readonly WorkRegion[]
  /** True while the day still follows the shape from settings. */
  usingDefaults: boolean
  onSave: (regions: { startsAt: number; endsAt: number }[]) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<DefaultRegion[]>([])

  useSeedOnOpen(open, now, () => setDraft(regions.map(toWallClock)))

  const resolved = draft
    .map((r) => ({ startsAt: wallClockOn(now, r.start), endsAt: wallClockOn(now, r.end) }))
    .filter(
      (r): r is { startsAt: number; endsAt: number } =>
        r.startsAt !== null && r.endsAt !== null && r.endsAt > r.startsAt,
    )
  const dropped = draft.length - resolved.length

  return (
    <Dialog
      open={open}
      title="Today's hours"
      description={
        usingDefaults
          ? "This day follows your usual shape. Editing it changes today only."
          : "You've already changed today's hours."
      }
      onDismiss={onCancel}
    >
      <RegionShapeEditor regions={draft} onChange={setDraft} />

      {dropped > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-commit">
          {dropped} stretch{dropped === 1 ? '' : 'es'} will be dropped — a stretch has to
          end after it starts, and cannot run past midnight.
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <GhostButton type="button" onClick={onCancel}>
          Cancel
        </GhostButton>
        <PrimaryButton type="button" onClick={() => onSave(resolved)}>
          Save for today
        </PrimaryButton>
      </div>
    </Dialog>
  )
}

const toWallClock = (region: WorkRegion): DefaultRegion => ({
  start: format(region.startsAt, 'HH:mm'),
  end: format(region.endsAt, 'HH:mm'),
})
