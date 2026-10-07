/**
 * How often a series comes round, as a form: the pattern, every how many,
 * which weekdays or which date, and from when until when.
 *
 * It sits under `CommitmentFields` on the recurring page, which asks what the
 * commitment is; this asks when it happens. Like that fieldset it holds no
 * state of its own beyond what the parent hands it, and reading it is a
 * separate pure step (`readRepeat`, `readSeries`), so the page can say whether
 * Save would work without anything being written.
 *
 * Four patterns where the model has three shapes (`Repeat`). "Every weekday"
 * is a weekly series on Monday to Friday, but it is the commonest thing
 * anyone says about a standup, so it is offered by name rather than as seven
 * buttons to get right. Choosing Weekly afterwards shows the five days it
 * meant, already pressed, rather than starting again from one.
 *
 * The next few dates are shown under the form as it is filled in. A rule is
 * easy to write wrong in a way that reads right — every other week, anchored
 * to the wrong week — and the dates are the one check that does not need the
 * rule explained.
 */

import { format } from 'date-fns'

import { DateInput, fieldClass, labelClass } from './ui'
import {
  describeRepeat,
  formatOccurrenceDay,
  isDayKey,
  upcoming,
  WEEK_ORDER,
  WORKWEEK,
} from '@/domain/recurrence'
import { dayKey } from '@/domain/time'
import type { Ms, RecurringCommitment, Repeat, Weekday } from '@/domain/types'
import { readCommitmentShape, type CommitmentDraft } from './CommitmentFields'

export type RepeatPattern = 'day' | 'weekday' | 'week' | 'month'

export type RepeatDraft = {
  pattern: RepeatPattern
  intervalText: string
  weekdays: Weekday[]
  monthDayText: string
  /** `yyyy-MM-dd`, as a date field gives it. */
  startsOn: string
  /** The same, or empty for a series that does not end. */
  endsOn: string
}

/** How far "every N" may go for each unit: a year of days, weeks or months. */
const INTERVAL_MAX = { day: 365, week: 52, month: 12 } as const

const UNIT = { day: 'days', week: 'weeks', month: 'months' } as const

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/**
 * A new series' timing, defaulted from the day it is being written on: every
 * weekday, from today. The weekday and date fields start on today's, so
 * switching to Weekly or Monthly offers the reading someone most likely means.
 */
export const emptyRepeat = (now: Ms): RepeatDraft => {
  const today = new Date(now)
  return {
    pattern: 'weekday',
    intervalText: '1',
    weekdays: [...WORKWEEK],
    monthDayText: String(today.getDate()),
    startsOn: dayKey(now),
    endsOn: '',
  }
}

/** A series' timing as the form shows it, for editing. */
export const draftFromSeries = (rule: RecurringCommitment): RepeatDraft => {
  const { repeat } = rule
  const weekdayLike =
    repeat.every === 'week' &&
    repeat.interval === 1 &&
    repeat.weekdays.length === WORKWEEK.length &&
    WORKWEEK.every((d) => repeat.weekdays.includes(d))
  const startsOnDate = new Date(`${rule.startsOn}T12:00:00`)
  return {
    pattern: weekdayLike ? 'weekday' : repeat.every,
    intervalText: String(repeat.interval),
    weekdays: repeat.every === 'week' ? [...repeat.weekdays] : [...WORKWEEK],
    monthDayText: String(repeat.every === 'month' ? repeat.monthDay : startsOnDate.getDate()),
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? '',
  }
}

/** Whether two drafts say the same thing; see `draftsMatch` for why it matters. */
export const repeatsMatch = (a: RepeatDraft, b: RepeatDraft): boolean =>
  a.pattern === b.pattern &&
  a.intervalText === b.intervalText &&
  a.monthDayText === b.monthDayText &&
  a.startsOn === b.startsOn &&
  a.endsOn === b.endsOn &&
  a.weekdays.length === b.weekdays.length &&
  a.weekdays.every((d) => b.weekdays.includes(d))

const readWhole = (raw: string, min: number, max: number): number | null => {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/**
 * The timing as the store will take it, or null while it is not one yet: no
 * weekday pressed, a date that is not a date, or an end before the start.
 */
export function readRepeat(
  draft: RepeatDraft,
): { repeat: Repeat; startsOn: string; endsOn: string | null } | null {
  if (!isDayKey(draft.startsOn)) return null
  const endsOn = draft.endsOn === '' ? null : draft.endsOn
  if (endsOn !== null && (!isDayKey(endsOn) || endsOn < draft.startsOn)) return null

  const repeat = repeatOf(draft)
  return repeat === null ? null : { repeat, startsOn: draft.startsOn, endsOn }
}

function repeatOf(draft: RepeatDraft): Repeat | null {
  if (draft.pattern === 'weekday') return { every: 'week', interval: 1, weekdays: [...WORKWEEK] }

  const interval = readWhole(draft.intervalText, 1, INTERVAL_MAX[draft.pattern])
  if (interval === null) return null
  switch (draft.pattern) {
    case 'day':
      return { every: 'day', interval }
    case 'week': {
      const weekdays = WEEK_ORDER.filter((d) => draft.weekdays.includes(d))
      return weekdays.length === 0 ? null : { every: 'week', interval, weekdays }
    }
    case 'month': {
      const monthDay = readWhole(draft.monthDayText, 1, 31)
      return monthDay === null ? null : { every: 'month', interval, monthDay }
    }
  }
}

/**
 * The whole series, from the commitment's fieldset and this one, or null while
 * either is not readable yet. Zero margins and an absent end are left out, so
 * a new series carries only what it says — as `readCommitment` does.
 */
export function readSeries(
  commitment: CommitmentDraft,
  timing: RepeatDraft,
): Omit<RecurringCommitment, 'id'> | null {
  const shape = readCommitmentShape(commitment)
  const when = readRepeat(timing)
  if (shape === null || when === null) return null
  const { prepMin, recoverMin, ...rest } = shape
  return {
    ...rest,
    ...(prepMin === 0 ? {} : { prepMin }),
    ...(recoverMin === 0 ? {} : { recoverMin }),
    repeat: when.repeat,
    startsOn: when.startsOn,
    ...(when.endsOn === null ? {} : { endsOn: when.endsOn }),
  }
}

export function RepeatFields({
  idPrefix,
  now,
  draft,
  onDraft,
  preview,
}: {
  idPrefix: string
  now: Ms
  draft: RepeatDraft
  onDraft: (draft: RepeatDraft) => void
  /** The series as it would be saved, for the dates it would come round on. */
  preview: Omit<RecurringCommitment, 'id'> | null
}) {
  const patch = (part: Partial<RepeatDraft>) => onDraft({ ...draft, ...part })
  const toggleDay = (day: Weekday) =>
    patch({
      weekdays: draft.weekdays.includes(day)
        ? draft.weekdays.filter((d) => d !== day)
        : [...draft.weekdays, day],
    })
  const ahead = preview === null ? null : upcoming({ ...preview, id: 'preview' }, now, 4)
  const next = ahead?.next ?? []

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="grid max-w-sm grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={labelClass} htmlFor={`${idPrefix}-pattern`}>
            Repeats
          </label>
          <select
            id={`${idPrefix}-pattern`}
            value={draft.pattern}
            onChange={(e) => patch({ pattern: e.target.value as RepeatPattern })}
            className={fieldClass}
          >
            <option value="weekday">Every weekday</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
        {draft.pattern !== 'weekday' && (
          <div className="min-w-0">
            <label className={labelClass} htmlFor={`${idPrefix}-interval`}>
              Every ({UNIT[draft.pattern]})
            </label>
            <input
              id={`${idPrefix}-interval`}
              type="number"
              inputMode="numeric"
              min={1}
              max={INTERVAL_MAX[draft.pattern]}
              value={draft.intervalText}
              onChange={(e) => patch({ intervalText: e.target.value })}
              className={`${fieldClass} tnum`}
            />
          </div>
        )}
      </div>

      {draft.pattern === 'week' && (
        <div>
          <span className={labelClass} id={`${idPrefix}-weekdays`}>
            On
          </span>
          <div
            role="group"
            aria-labelledby={`${idPrefix}-weekdays`}
            className="flex flex-wrap gap-1.5"
          >
            {WEEK_ORDER.map((day) => {
              const on = draft.weekdays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  onClick={() => toggleDay(day)}
                  className={`w-11 rounded-lg border py-1.5 text-xs transition ${
                    on
                      ? 'border-bright/70 bg-surface-raised text-bright'
                      : 'border-muted/70 text-muted hover:text-bright'
                  }`}
                >
                  {WEEKDAY_NAMES[day].slice(0, 3)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {draft.pattern === 'month' && (
        <div className="max-w-[10rem]">
          <label className={labelClass} htmlFor={`${idPrefix}-month-day`}>
            On day
          </label>
          <input
            id={`${idPrefix}-month-day`}
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={draft.monthDayText}
            onChange={(e) => patch({ monthDayText: e.target.value })}
            className={`${fieldClass} tnum`}
          />
        </div>
      )}

      <div className="grid max-w-sm grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={labelClass} htmlFor={`${idPrefix}-starts`}>
            Starts
          </label>
          <DateInput
            id={`${idPrefix}-starts`}
            value={draft.startsOn}
            onChange={(e) => patch({ startsOn: e.target.value })}
          />
        </div>
        <div className="min-w-0">
          <label className={labelClass} htmlFor={`${idPrefix}-ends`}>
            Ends (optional)
          </label>
          <DateInput
            id={`${idPrefix}-ends`}
            value={draft.endsOn}
            {...(isDayKey(draft.startsOn) ? { min: draft.startsOn } : {})}
            onChange={(e) => patch({ endsOn: e.target.value })}
          />
        </div>
      </div>

      {/* Announced as it changes, so the dates a rule means are heard as well
          as seen while it is being written. */}
      <p aria-live="polite" className="text-xs leading-relaxed text-muted">
        {preview === null
          ? 'Fill in what it is and when, and the next dates show here.'
          : next.length === 0
            ? ahead?.ended
              ? `${describeRepeat(preview.repeat)} — but not again: it has ended.`
              : `${describeRepeat(preview.repeat)} — but not in the next two years.`
            : `${describeRepeat(preview.repeat)}. Next: ${next
                .map((c) => `${formatOccurrenceDay(c.startsAt, now)}${dayKey(c.startsAt) === dayKey(now) ? ' (today)' : ''}`)
                .join(', ')}, at ${format(next[0]!.startsAt, 'h:mm a')}.`}
      </p>
    </div>
  )
}
