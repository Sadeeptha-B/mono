/**
 * Commitments that come round on a schedule, as a page.
 *
 * A page for the tasks page's reason: setting up a standup every weekday is
 * something done once and then left, away from the timer, and the stage is
 * for one question about today at a time. `App` swaps the view without
 * unmounting anything, so a block keeps running while you are here.
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

import { HeaderMark } from '../HeaderMark'
import { HeaderStatus } from '../HeaderStatus'
import { StorageWarning } from '../StorageWarning'
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
  headerControlClass,
  IconButton,
  PageLinks,
  PrimaryButton,
} from '../ui'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { RoomMenu } from '@/ambient/RoomMenu'
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

export function RecurringPage({
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
      {/* The tasks page's header, for the guide's reasons: pinned on a wide
          screen, sticky on a narrow one, and carrying the timer either way. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ink px-4 py-3 sm:px-6 lg:static">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <HeaderMark phase={phase} home={false} />

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <StorageWarning onOpenSettings={onOpenSettings} />
            <HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />
            <RoomMenu idPrefix="recurring-header" />
            <PopOutButton mini={mini} />
            <PageLinks current="recurring" />
            <button type="button" onClick={onOpenSettings} className={headerControlClass}>
              Settings
            </button>
          </div>
        </div>
      </header>

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-3xl font-light text-bright sm:text-4xl">Recurring</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Commitments that come round on a schedule. Each one is put into every day it
            falls on, so you never type the standup in again. Moving or skipping one day of
            it happens on that day and leaves the series here alone.
          </p>

          <section aria-label="Series" className="mt-8 border-t border-line pt-6">
            {inOrder.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing repeats yet. A standup every weekday, a swim on Tuesdays and
                Thursdays, a review on the first of the month.
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
                      Every day still following it changes, today included unless today's
                      has already begun. A day you changed by hand keeps its own.
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
        </main>
      </div>
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
                  ? 'Not again'
                  : 'Not in the next two years'
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
            Stop it for good? Anything of it already begun today stays.
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
