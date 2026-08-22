/**
 * The three things you can add to the timeline, edited on the timeline.
 *
 * These were dialogs. The argument for that was the same one that keeps
 * settings in a dialog — an aside you dismiss — but it does not survive contact
 * with what they actually are. Adding a commitment is an edit *to* the day
 * drawn beside them, and `Dialog` centres a card over a blurred backdrop, so
 * the one thing you need in order to answer "when?" was the one thing covered
 * up. They expand in place under the calendar header instead, and the hour axis
 * simply gets shorter.
 *
 * Each one mounts when it opens and unmounts when it closes, which is what lets
 * the forms seed from a lazy initialiser. The old dialogs stayed mounted behind
 * an `open` prop, so seeding needed a hook that read the clock through a ref:
 * `now` advances every second, and a seed that depends on it clears the field
 * on every keystroke. Mounting on open removes that problem rather than working
 * around it.
 *
 * Times are wall clock here, resolved against today's calendar at the edge. The
 * domain only ever sees epoch milliseconds.
 */

import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'

import {
  CommitmentFields,
  emptyDraft,
  readCommitment,
  type CommitmentDraft,
} from '../CommitmentFields'
import { hoursToSave, TodayHoursFields, useHoursDraft } from '../TodayHours'
import { fieldClass, GhostButton, labelClass, MinutesInput, PrimaryButton } from '../ui'
import { BREAK_MINUTES, parseBoundedMinutes } from '../minutes'
import { nextHalfHour, wallClockOn } from '@/domain/time'
import type { Ms, WorkRegion } from '@/domain/types'

/** Which composer is open, if any. */
export type ComposerKind = 'hours' | 'break' | 'commitment'

/**
 * The frame every composer shares.
 *
 * A hairline and a heading rather than a floating card: this is part of the
 * calendar, not something laid on top of it, and it should read that way.
 */
function ComposerShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-line bg-surface-raised/40 px-4 py-3">
      <div className="mb-2.5 text-xs font-medium tracking-widest text-muted uppercase">
        {title}
      </div>
      {children}
    </div>
  )
}

/** The row of actions at the foot of a composer. */
const Actions = ({ children }: { children: ReactNode }) => (
  <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
)

// The calendar column is 22rem wide, so the composers run at the small end of
// the button scale. Everywhere else in Mono these are full size.
const composerButton = 'px-3 py-1.5 text-xs'

export function CommitmentComposer({
  now,
  onAdd,
  onCancel,
}: {
  now: Ms
  onAdd: (input: { title: string; startsAt: Ms; durationMin: number }) => void
  onCancel: () => void
}) {
  // Default to the next round half hour — the most likely answer.
  const [draft, setDraft] = useState<CommitmentDraft>(() =>
    emptyDraft(format(nextHalfHour(now), 'HH:mm')),
  )
  const ready = readCommitment(now, draft)

  return (
    <ComposerShell title="Next commitment">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onAdd(ready)
        }}
      >
        <CommitmentFields
          idPrefix="commitment"
          titleLabel="What"
          draft={draft}
          onDraft={setDraft}
        />

        <p className="mt-3 text-xs leading-relaxed text-muted">
          Adding this re-derives the plan, which clears any breaks you had pinned. Add
          them back wherever they still make sense.
        </p>

        <Actions>
          <GhostButton type="button" onClick={onCancel} className={composerButton}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!ready} className={composerButton}>
            Add
          </PrimaryButton>
        </Actions>
      </form>
    </ComposerShell>
  )
}

export function BreakComposer({
  now,
  onAdd,
  onCancel,
}: {
  now: Ms
  onAdd: (input: { startsAt: Ms; durationMin: number }) => void
  onCancel: () => void
}) {
  const [time, setTime] = useState(() => format(nextHalfHour(now), 'HH:mm'))
  const [durationText, setDurationText] = useState(String(BREAK_MINUTES.fallback))

  const startsAt = wallClockOn(now, time)
  const durationMin = parseBoundedMinutes(
    durationText,
    BREAK_MINUTES.min,
    BREAK_MINUTES.max,
  )
  const valid = startsAt !== null && durationMin !== null

  return (
    <ComposerShell title="Plan a break">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (startsAt === null || durationMin === null) return
          onAdd({ startsAt, durationMin })
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

        <Actions>
          <GhostButton type="button" onClick={onCancel} className={composerButton}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!valid} className={composerButton}>
            Add break
          </PrimaryButton>
        </Actions>
      </form>
    </ComposerShell>
  )
}

/**
 * Today's working hours.
 *
 * Editing here overrides the recurring default for this day only — the shape in
 * settings is untouched, and tomorrow starts from it again. *Editing* is the
 * operative word: saving a draft nobody touched hands back `null` rather than
 * an identical list, because writing it would detach today from the recurring
 * shape without changing a single minute of it.
 */
export function HoursComposer({
  now,
  regions,
  usingDefaults,
  onSave,
  onCancel,
}: {
  now: Ms
  regions: readonly WorkRegion[]
  /** True while the day still follows the shape from settings. */
  usingDefaults: boolean
  /** Called with `null` when the draft matches the day's current shape. */
  onSave: (regions: WorkRegion[] | null) => void
  onCancel: () => void
}) {
  const { draft, onDraft } = useHoursDraft(regions)

  return (
    <ComposerShell title="Today's hours">
      <p className="-mt-1 mb-3 text-xs leading-relaxed text-muted">
        {usingDefaults
          ? 'This day follows your usual shape. Editing it changes today only.'
          : "You've already changed today's hours."}
      </p>

      <TodayHoursFields draft={draft} onDraft={onDraft} now={now} hideLegend />

      <Actions>
        <GhostButton type="button" onClick={onCancel} className={composerButton}>
          Cancel
        </GhostButton>
        <PrimaryButton
          type="button"
          onClick={() => onSave(hoursToSave(now, draft, regions))}
          className={composerButton}
        >
          Save for today
        </PrimaryButton>
      </Actions>
    </ComposerShell>
  )
}
