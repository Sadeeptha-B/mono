/**
 * The routine: what every day starts from, as a page. Two things live here,
 * the usual working hours and the commitments that come round on a schedule,
 * because they are the same kind of thing — a recurring default that each day
 * derives its own answer from, and that the day can change for itself without
 * touching. The hours used to be in Settings, beside block lengths and sound,
 * which are preferences about how Mono behaves rather than facts about your
 * week; the series arrived with a page of their own, and together they are
 * the one place to say what an ordinary day looks like.
 *
 * A page for the tasks page's reason: this is set up once and then left, away
 * from the timer, and the stage is for one question about today at a time.
 * `App` swaps the view while its own hooks stay mounted, so a block keeps
 * running while you are here. It is a tool in the header rather than a place
 * (see `AppHeader`), and is also linked from Settings and from the day's
 * questions about hours and commitments, where wanting it happens
 * (`RoutineLink`).
 *
 * The usual hours write through as they are typed, as they did in Settings:
 * there is one copy of them and nothing to save, and today's hours, while
 * nobody has changed them, follow along (`useHoursDraft`).
 *
 * Each series is a rule (`RecurringCommitment`), and the day it falls on
 * derives its occurrence from it (`commitmentsFor`). So this page is the only
 * place a series is written, and the day is where one day of it is changed:
 * moving or skipping today's standup there leaves the series here alone, and
 * changing the series here moves every day still following it, today
 * included unless today's has already begun. The day's forms say so and link
 * back here; this page says it once, under its title.
 *
 * The form is the day's commitment fieldset (`CommitmentFields`) with the
 * timing fieldset (`RepeatFields`) under it, in one fold: a series is a
 * commitment with a schedule, not a different kind of thing. The editor holds
 * the id of the series it is changing, never a copy, and closes when that
 * series goes — the calendar's composer keeps the same rule. Drafts are seeded
 * by the gesture that opens the form, never by an effect, since `now` ticks.
 *
 * Deleting a series asks first. It is the one action here that cannot be
 * taken back, and the question says what it will not touch: anything of it
 * already begun today stays on today.
 */

import { useState } from 'react'

import { APP_WIDTH, AppBar } from '../AppHeader'
import { CornerCard } from '../CornerCard'
import { RegionShapeEditor } from '../RegionShapeEditor'
import { HeaderStatus } from '../HeaderStatus'
import {
  CommitmentFields,
  draftsMatch,
  emptyDraft,
  type CommitmentDraft,
} from '../CommitmentFields'
import {
  draftFromSeries,
  emptyRepeat,
  readSeries,
  repeatsMatch,
  RepeatFields,
  type RepeatDraft,
} from '../RepeatFields'
import { DeleteIcon, RepeatIcon } from '../icons'
import {
  AddFold,
  EditGlyph,
  GhostButton,
  IconButton,
  PrimaryButton,
} from '../ui'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { useSession } from '@/store/session'
import { describeRepeat, formatOccurrenceDay, upcoming } from '@/domain/recurrence'
import { dayKey, formatClock, formatDuration, wallClockOn, type TimerMode } from '@/domain/time'
import { minutesToMs, type ActiveSegment, type Ms, type RecurringCommitment } from '@/domain/types'

/** The commitment half of a series, as the shared fieldset holds it. */
const commitmentDraftOf = (rule: RecurringCommitment): CommitmentDraft => ({
  title: rule.title,
  time: rule.time,
  durationText: String(rule.durationMin),
  prepText: String(rule.prepMin ?? 0),
  recoverText: String(rule.recoverMin ?? 0),
})

export function RoutinePage({
  now,
  active,
  timerMode,
  onOpenSettings,
  mini,
}: {
  now: Ms
  active: ActiveSegment | null
  timerMode: TimerMode
  onOpenSettings: () => void
  mini: MiniWindowControls
}) {
  const phase = useSession((s) => s.phase)
  const defaultRegions = useSession((s) => s.session.settings.defaultRegions)
  const updateSettings = useSession((s) => s.updateSettings)
  const recurring = useSession((s) => s.session.recurring)
  const addRecurring = useSession((s) => s.addRecurring)
  const updateRecurring = useSession((s) => s.updateRecurring)
  const removeRecurring = useSession((s) => s.removeRecurring)

  const [open, setOpen] = useState(false)
  // The series being changed, by id, or null for a new one.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<CommitmentDraft>(() => emptyDraft('09:00'))
  const [timing, setTiming] = useState<RepeatDraft>(() => emptyRepeat(now))

  const subject = editing === null ? null : (recurring.find((r) => r.id === editing) ?? null)
  // The series the form is pointed at can go underneath it — deleted below —
  // and a Save aimed at nothing is not offered. During render, so the form
  // never paints for a frame without its subject. An import is not caught
  // here, because it can bring back a series under the same id with other
  // contents: `App` remounts this page on the session's generation instead.
  if (editing !== null && subject === null) {
    setEditing(null)
    setOpen(false)
  }

  const ready = readSeries(draft, timing)

  const startNew = () => {
    setEditing(null)
    setDraft(emptyDraft('09:00'))
    setTiming(emptyRepeat(now))
    setOpen(true)
  }

  const startEditing = (rule: RecurringCommitment) => {
    setEditing(rule.id)
    setDraft(commitmentDraftOf(rule))
    setTiming(draftFromSeries(rule))
    setOpen(true)
  }

  const close = () => {
    setEditing(null)
    setOpen(false)
  }

  const save = () => {
    if (!ready) return
    if (subject) {
      // Merged onto the series, so a cleared margin or end is said rather
      // than left out — absent would keep the old one.
      const unchanged =
        draftsMatch(draft, commitmentDraftOf(subject)) &&
        repeatsMatch(timing, draftFromSeries(subject))
      if (!unchanged) {
        updateRecurring(subject.id, {
          ...ready,
          prepMin: ready.prepMin ?? 0,
          recoverMin: ready.recoverMin ?? 0,
          endsOn: ready.endsOn ?? null,
        })
      }
    } else {
      addRecurring(ready)
    }
    close()
  }

  // In the order they happen in a day, which is how a morning reads them.
  const inOrder = [...recurring].sort(
    (a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title),
  )

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The bar every view shares (`AppBar`): pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <AppBar
        current="routine"
        phase={phase}
        mini={mini}
        onOpenSettings={onOpenSettings}
        status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
      />

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* Every view's width, so the page starts where the others do; what is
            on it keeps the narrower measure a form of a few fields wants. Room
            at the foot for the corner's button (`CornerCard`). */}
        <main className={`mx-auto ${APP_WIDTH} px-4 pt-8 pb-32 sm:px-6 sm:pt-10`}>
          <div className="max-w-3xl">
            <h1 className="text-3xl font-light text-bright sm:text-4xl">Routine</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              Your usual working hours and the commitments that repeat. Each new day starts
              from these. Changes you make on Today apply to that day only.
            </p>

            <section aria-labelledby="routine-hours" className="mt-8 border-t border-line pt-6">
              <h2 id="routine-hours" className="text-lg font-light text-bright">
                Working hours
              </h2>
              <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-muted">
                Mono plans focus blocks only within these hours.
              </p>
              <div className="max-w-md">
                <RegionShapeEditor
                  regions={defaultRegions}
                  onChange={(regions) => updateSettings({ defaultRegions: regions })}
                  hideLegend
                />
              </div>
            </section>

            <section aria-labelledby="routine-series" className="mt-10 border-t border-line pt-6">
              <h2 id="routine-series" className="text-lg font-light text-bright">
                Recurring commitments
              </h2>
              <p className="mt-1 mb-4 max-w-2xl text-sm leading-relaxed text-muted">
                Each one is added to every day it falls on.
              </p>
              {inOrder.length === 0 ? (
                <p className="text-sm text-muted">
                  None yet. Add one for a weekday standup, a class on Tuesdays and Thursdays,
                  or a review on the first of the month.
                </p>
              ) : (
                <ul aria-label="Recurring commitments" className="flex flex-col gap-2">
                  {inOrder.map((rule) => (
                    <SeriesCard
                      key={rule.id}
                      rule={rule}
                      now={now}
                      editing={rule.id === editing}
                      onEdit={() => startEditing(rule)}
                      onDelete={() => removeRecurring(rule.id)}
                    />
                  ))}
                </ul>
              )}

              <div className="mt-6">
                <AddFold
                  title={subject ? `Edit ${subject.title}` : 'Add a recurring commitment'}
                  open={open}
                  onOpen={startNew}
                  onCancel={close}
                  cancelLabel={subject ? 'Cancel editing' : 'Cancel new recurring commitment'}
                  className="text-sm text-body"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      save()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        close()
                      }
                    }}
                  >
                    <CommitmentFields
                      idPrefix="recurring"
                      titleLabel="What"
                      draft={draft}
                      onDraft={setDraft}
                    />
                    <RepeatFields
                      idPrefix="recurring"
                      now={now}
                      draft={timing}
                      onDraft={setTiming}
                      preview={ready}
                    />
                    {subject && (
                      <p className="mt-3 text-xs leading-relaxed text-muted">
                        Saving changes every day it falls on, including today unless it has
                        already started. Days you changed on Today keep your changes.
                      </p>
                    )}
                    <div className="mt-4 flex gap-2">
                      <PrimaryButton type="submit" disabled={!ready}>
                        {subject ? 'Save' : 'Add'}
                      </PrimaryButton>
                      <GhostButton type="button" onClick={close}>
                        Cancel
                      </GhostButton>
                    </div>
                  </form>
                </AddFold>
              </div>
            </section>
          </div>
        </main>
      </div>
      <CornerCard />
    </div>
  )
}

/**
 * One series: when it happens, what it costs, and the next few days it will
 * be on. The dates are what make a rule checkable at a glance, as in the form.
 */
function SeriesCard({
  rule,
  now,
  editing,
  onEdit,
  onDelete,
}: {
  rule: RecurringCommitment
  now: Ms
  /** True while the form is pointed at this one. */
  editing: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [asking, setAsking] = useState(false)
  const at = wallClockOn(now, rule.time)
  const around = minutesToMs((rule.prepMin ?? 0) + (rule.recoverMin ?? 0))
  const { next, ended } = upcoming(rule, now, 3)
  // Its last day already behind today, rather than merely no more to come.
  const past = rule.endsOn !== undefined && rule.endsOn < dayKey(now)

  return (
    <li
      className={`group/row rounded-lg border px-3 py-2.5 ${
        editing ? 'border-bright/60' : 'border-muted/70'
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span className="tnum w-16 shrink-0 text-xs text-commit">
          {at === null ? rule.time : formatClock(at)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm text-bright">
            <RepeatIcon className="text-commit" />
            <span className="min-w-0 break-words">{rule.title}</span>
          </div>
          <div className="tnum text-xs text-muted">
            {describeRepeat(rule.repeat)} · {formatDuration(minutesToMs(rule.durationMin))}
            {around > 0 && ` + ${formatDuration(around)} around`}
          </div>
          <div className="text-xs text-muted">
            {past
              ? `Ended ${formatOccurrenceDay(new Date(`${rule.endsOn}T12:00:00`).getTime(), now)}`
              : next.length === 0
                ? ended
                  ? 'No more dates'
                  : 'No dates in the next two years'
                : `Next: ${next.map((c) => formatOccurrenceDay(c.startsAt, now)).join(', ')}`}
          </div>
        </div>
        <IconButton label={`Edit ${rule.title}`} hint="Edit" onClick={onEdit}>
          <EditGlyph />
        </IconButton>
        {!asking && (
          <IconButton
            danger
            label={`Delete ${rule.title}`}
            hint="Delete"
            onClick={() => setAsking(true)}
          >
            <DeleteIcon />
          </IconButton>
        )}
      </div>
      {asking && (
        <div
          role="group"
          aria-label={`Confirm deleting ${rule.title}`}
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2"
        >
          <span className="text-xs text-commit">
            Delete this commitment from every day? If today's has started, it stays.
          </span>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${rule.title} for good`}
            className="text-xs text-commit underline underline-offset-4 hover:text-bright"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="text-xs text-muted underline underline-offset-4 hover:text-bright"
          >
            Keep
          </button>
        </div>
      )}
    </li>
  )
}
