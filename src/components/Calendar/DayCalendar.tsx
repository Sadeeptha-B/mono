/**
 * The day, on a time axis.
 *
 * Blocks are positioned against real hours rather than stacked in a list, so a
 * 45-minute block looks like 45 minutes and the gaps are visible as gaps. That
 * is the whole point: it puts the work in the context of the day around it.
 *
 * Geometry is driven entirely by elapsed milliseconds — both the hour rows and
 * the block offsets — which keeps it correct across a DST boundary without any
 * special handling. The axis simply labels each elapsed hour with its wall
 * clock time, which is what a calendar should do on such a day anyway.
 *
 * The header's three controls open an editor *inside* this column rather than
 * a dialog over the page. Which one is open is owned by `App`, because the
 * out-of-hours panel on the stage opens the hours editor too — the two are the
 * same affordance reached from different places, and there should only ever be
 * one of it.
 *
 * The blocks reopen those same editors, through a named control on the block
 * rather than a click anywhere on it — see the note beside them. A break you
 * pinned and a commitment you named are the two things on this axis that you
 * wrote, so they are the two that carry one. Everything else here is derived,
 * and the way to change a derived block is to change what it was derived from.
 *
 * The two can also be picked up and dragged along the axis, for the lunch
 * that runs late (`useCalendarDrag`).
 *
 * Who scrolls depends on the width, and every `lg:` below is that one decision.
 * Beside the stage this column is a fixed-height box with the axis scrolling
 * inside it, so the day can be however long it likes without pushing the page
 * around. Stacked under the stage on a phone that arrangement is a trap: a nine
 * hour day inside a box a few hundred pixels tall, scrolled by a gesture the
 * page is also listening for. So below `lg` the column is simply as tall as the
 * day it draws, and the document scrolls.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'

import {
  adding,
  BreakComposer,
  CommitmentComposer,
  editingId,
  HoursComposer,
  type BreakClashCheck,
  type Composer,
  type ComposerKind,
  type EditedBreak,
} from './SegmentEditor'
import { Block } from './CalendarBlock'
import {
  GUTTER_PX,
  HOUR_PX,
  layout,
  placedAt,
  pxFor,
  TOP_PAD_PX,
  yAt,
} from './geometry'
import { scrollsItself } from './edgeScroll'
import { useCalendarDrag } from './useCalendarDrag'
import { breakClash, type BreakSurroundings } from '@/domain/breakRoom'
import { formatClock } from '@/domain/time'
import {
  breakSpan,
  type ActiveSegment,
  type Commitment,
  type CommitmentPatch,
  type CompletedSegment,
  type Interval,
  type Ms,
  type PlannedBreak,
  type PlannedBreakPatch,
  type Timeline,
  type TimelineEntry,
  type WorkRegion,
} from '@/domain/types'

type Props = {
  timeline: Timeline
  now: Ms
  /** Today's hours, for the editor. Not the same list as `timeline.regions`. */
  regions: readonly WorkRegion[]
  /**
   * What an editor can be pointed at, as the store holds it: the day's
   * commitments, its pins, and its record, for the breaks on it.
   *
   * Taken from the store rather than off the timeline entry that was clicked,
   * because the planner draws a pin under a running break only from where that
   * break ends, and a form seeded from that would quietly shorten the break it
   * claimed to be editing.
   */
  commitments: readonly Commitment[]
  breaks: readonly PlannedBreak[]
  history: readonly CompletedSegment[]
  /** What is running, which a break put right on the record keeps clear of. */
  active: ActiveSegment | null
  /** Which editor is expanded under the header, if any. Owned by `App`. */
  composer: Composer | null
  onComposer: (next: Composer | null) => void
  onRemoveBreak: (id: string) => void
  onRemoveCommitment: (id: string) => void
  onAddBreak: (input: Omit<PlannedBreak, 'id'>) => void
  onAddCommitment: (input: Omit<Commitment, 'id'>) => void
  /** A pin, or a break already taken: the log reaches either by its id. */
  onUpdateBreak: (id: string, patch: PlannedBreakPatch) => void
  /** A pin whose time has passed, said to have been taken. */
  onMarkBreakTaken: (id: string) => void
  onUpdateCommitment: (id: string, patch: CommitmentPatch) => void
  onSetRegions: (regions: WorkRegion[]) => void
  /**
   * The switch to All Tasks, while a question that chooses tasks is open
   * (`AllTasksPane`). It stands where the heading does; the heading stays for
   * a screen reader.
   */
  switcher?: ReactNode
}

export function DayCalendar({
  timeline,
  now,
  regions,
  commitments,
  breaks,
  history,
  active,
  composer,
  onComposer,
  onRemoveBreak,
  onRemoveCommitment,
  onAddBreak,
  onAddCommitment,
  onUpdateBreak,
  onMarkBreakTaken,
  onUpdateCommitment,
  onSetRegions,
  switcher,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // How far a drag held at the end of the day has grown it (`useCalendarDrag`).
  const [reach, setReach] = useState<Interval | null>(null)
  const { rangeStart, rangeEnd, hours, placed } = useMemo(
    () => layout(timeline, now, reach),
    [timeline, now, reach],
  )

  /**
   * The drawing kept still when the top of the axis moves.
   *
   * The axis starts at the first hour anything is drawn in, so it moves: a
   * drag held at its top grows it an hour earlier, a block moved off the
   * morning lets it start later, and the hour the day opened in passes. Each
   * shifts everything drawn below by an hour's height, which under a pointer
   * standing still is the day jumping, and under a drag is the landing jumping
   * with it. So the scroll takes up exactly what the top gained or lost.
   * When the page is what scrolls, only once the calendar is scrolled into,
   * or while a drag holds the axis grown (`reach`) or has just let it go:
   * above the calendar, at the stage, nothing under the pointer moved, but a
   * drag's pointer is on the day, however far down the page the day starts.
   * The landing is read again after this has scrolled (`useCalendarDrag`).
   * The browser's own scroll anchoring is off on the axis (`overflow-anchor`),
   * or the two would both make the correction.
   */
  const anchoredAt = useRef<{ start: Ms; held: boolean } | null>(null)
  useLayoutEffect(() => {
    const before = anchoredAt.current
    const held = reach !== null
    anchoredAt.current = { start: rangeStart, held }
    if (before === null || before.start === rangeStart) return
    const shift = pxFor(before.start - rangeStart)
    const column = scroller.current
    if (scrollsItself(column)) column.scrollTop += shift
    else if (held || before.held || (content.current?.getBoundingClientRect().top ?? 0) < 0) {
      window.scrollBy(0, shift)
    }
  }, [rangeStart, reach])

  // Bring the current hour into view once, the first time the column is laid
  // out. Doing this on every tick would yank the view back while the user is
  // scrolling around their day. Not on mount: mounted behind All Tasks (`App`)
  // the column has no size, and nothing to scroll, until it is shown.
  //
  // A no-op when the column is not its own scroller, which is exactly right on
  // a narrow screen: the page opens at the top, where the stage is, and the day
  // is what you scroll down to. Nothing to branch on — an element that does not
  // overflow ignores `scrollTop`.
  const broughtIntoView = useRef(false)
  useEffect(() => {
    const el = scroller.current
    if (broughtIntoView.current || !el || el.clientHeight === 0) return
    broughtIntoView.current = true
    const offset = pxFor(now - rangeStart)
    el.scrollTop = Math.max(0, offset - el.clientHeight / 3)
  })

  const nowOffset = yAt(now, rangeStart)
  const nowVisible = now >= rangeStart && now <= rangeEnd

  const editing = composer === null ? null : editingId(composer)
  const editingBreak = editedBreak(
    breaks,
    history,
    composer?.kind === 'break' ? composer.editing : null,
  )
  const editingCommitment = byId(
    commitments,
    composer?.kind === 'commitment' ? composer.editing : null,
  )

  /**
   * An editor left pointing at something that is no longer there.
   *
   * Three ways to arrive at it, and they used to be handled by one. The × below
   * is the obvious one — you clicked into a break to decide about it, and
   * deciding it should not be there at all is one of the answers — and it closed
   * itself. The other two never pass through this component: a pin spent by a
   * break ending, and a pin a commitment lands on and cannot move. Those
   * left the form open, where it quietly became an *add*. Both halves of it read
   * the lookups above rather than the id in `composer`, so the same fields
   * holding the same values would have written a second entry, with the header
   * toggle still reading unpressed.
   *
   * So it is asked once, about the state, rather than three times about the
   * gestures that produce it — which is why the × no longer closes anything
   * itself. Removing an entry fails the lookup like any other cause, and one
   * rule that cannot be forgotten at a fourth call site is worth more than a
   * close that happens a fraction earlier.
   *
   * It has to be an effect: the composer belongs to `App`, and a child may not
   * set a parent's state while rendering. `useLayoutEffect` rather than
   * `useEffect` so it runs before the browser paints — the composers are keyed
   * on what they are editing, so the frame a passive effect would let through is
   * that form remounted empty as an *add*, which is the exact thing being
   * prevented here.
   */
  const orphaned =
    composer !== null &&
    composer.kind !== 'hours' &&
    composer.editing !== null &&
    (composer.kind === 'break' ? editingBreak : editingCommitment) === null

  useLayoutEffect(() => {
    if (orphaned) onComposer(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphaned])

  // Everything a break keeps clear of, for the form to explain by, the drag
  // to find room by and a passed pin's ✓ to be offered by — the reducer's own
  // rule (`breakClash`), asked early.
  const surroundings: BreakSurroundings = { commitments, pins: breaks, history, active, at: now }
  const clashOf: BreakClashCheck = (span, kind, edited) =>
    breakClash(span, kind, surroundings, {
      except: edited?.id ?? null,
      previous: edited === null ? null : { start: edited.startsAt, end: edited.endsAt },
    })

  /**
   * The ✓ on a pin whose time has passed, or null while there is nothing to
   * confirm. Asked of the part drawn, which is the part it confirms: after a
   * break ended early over it, what was left (`pinLeft`). Not offered where
   * the record already says something else happened then — a block run
   * straight through it — since that is a pin to move clear first, or to take
   * off with its ×.
   */
  const markTaken = (entry: TimelineEntry): (() => void) | null => {
    if (entry.kind !== 'planned-break' || !entry.unconfirmed) return null
    const drawn = { start: entry.startsAt, end: entry.endsAt }
    if (clashOf(drawn, 'record', null) !== null) return null
    return () => onMarkBreakTaken(entry.id)
  }

  const { moving, dragOf } = useCalendarDrag({
    scroller,
    content,
    axis: { start: rangeStart, end: rangeEnd },
    surroundings,
    editing,
    onReach: setReach,
    onUpdateCommitment,
    onUpdateBreak,
  })

  return (
    // This aside is a direct grid item. Its automatic min-content width lets a
    // native time control widen the entire page before the framed input gets a
    // chance to contain it; `min-w-0` makes the grid track the actual boundary.
    // Do not put one-axis overflow on this panel: `overflow-x: hidden` makes the
    // other axis compute to `auto`, turning the whole calendar into a scroller
    // on phones where the document deliberately owns vertical scrolling.
    <aside className="min-w-0 flex flex-col rounded-2xl border border-line bg-surface lg:h-full lg:min-h-0">
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-line px-4 py-3">
        <h2
          className={
            switcher ? 'sr-only' : 'text-xs font-medium tracking-widest text-muted uppercase'
          }
        >
          Today
        </h2>
        {switcher}
        {/* Toggles, not launchers: the panel they open is right below them and
            stays part of this column, so the pressed state is the whole of the
            feedback. `flex-wrap` because three of these already fill a 22rem
            column at text-xs. */}
        {/* To the right on the heading's line; under the column's switch, a
            line of their own, centred: they act on the day, not on the view. */}
        <div
          className={`flex flex-wrap gap-1 ${switcher ? 'w-full justify-center' : 'ml-auto justify-end'}`}
        >
          <HeaderToggle kind="hours" composer={composer} onComposer={onComposer}>
            Hours
          </HeaderToggle>
          <HeaderToggle kind="break" composer={composer} onComposer={onComposer}>
            Break
          </HeaderToggle>
          <HeaderToggle kind="commitment" composer={composer} onComposer={onComposer}>
            Commitment
          </HeaderToggle>
        </div>
      </header>

      {/*
        The editors live here rather than in a dialog over the page. Everything
        they ask about — when is this, what does it displace — is drawn directly
        below, and the axis scrolls, so the cost of opening one is a shorter
        view of the day rather than no view of it.
      */}
      {composer?.kind === 'hours' && (
        <HoursComposer
          now={now}
          regions={regions}
          onSave={(next) => {
            // `null` means the draft matched what the day already says. Saving
            // it anyway would override the day with its own current shape and
            // stop it following the recurring default.
            if (next) onSetRegions(next)
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}
      {/*
        Keyed by what is being edited, so clicking a second break while the
        first one is open is a new form rather than the same one still holding
        the first answer. The composers seed their drafts once, on mount — see
        the note at the top of `SegmentEditor` — which is exactly what makes
        them safe against a clock that ticks every second and exactly what makes
        this key necessary.
      */}
      {/*
        Both halves read the same lookup rather than the id in `composer`, so
        the form and what saving it does cannot disagree: an id pointing at
        something no longer on the day is simply a new one.
      */}
      {/*
        A break's form is keyed by where it is as well. A commitment landing on
        it moves it out from under the form, and a draft of where it was is
        one that puts it back on top of the commitment; so it opens again on
        where the break went.
      */}
      {composer?.kind === 'break' && (
        <BreakComposer
          key={editingBreak ? `${editingBreak.id}@${editingBreak.startsAt}` : 'new'}
          now={now}
          editing={editingBreak}
          clash={clashOf}
          onSubmit={(input, changed) => {
            if (editingBreak === null) onAddBreak(input)
            else if (Object.keys(changed).length > 0) onUpdateBreak(editingBreak.id, changed)
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}
      {composer?.kind === 'commitment' && (
        <CommitmentComposer
          key={editingCommitment?.id ?? 'new'}
          now={now}
          editing={editingCommitment}
          onSubmit={(input, changed) => {
            if (editingCommitment === null) onAddCommitment(input)
            else if (Object.keys(changed).length > 0) {
              onUpdateCommitment(editingCommitment.id, changed)
            }
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}

      <div ref={scroller} className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div
          ref={content}
          className="relative [overflow-anchor:none]"
          style={{ height: hours.length * HOUR_PX + TOP_PAD_PX * 2, paddingLeft: GUTTER_PX }}
        >
          {/* The axis: one row per hour, labelled on the left. */}
          {hours.map((hour, index) => (
            <div
              key={hour}
              className="absolute right-0 left-0 border-t border-line/70"
              style={{ top: TOP_PAD_PX + index * HOUR_PX, height: HOUR_PX }}
            >
              <span className="tnum absolute -top-2 left-2 bg-surface pr-1 text-[11px] text-muted">
                {format(hour, 'h a')}
              </span>
              {/* Half-hour tick, to make 20 and 45 minute blocks readable. */}
              <div
                className="absolute right-0 left-0 border-t border-dashed border-line/35"
                style={{ top: HOUR_PX / 2 }}
              />
            </div>
          ))}

          {/*
            Work regions are the canvas the plan is painted on: everything
            outside them is time Mono is not allowed to touch. Drawing them as
            lit bands rather than drawing the gaps as hatching keeps the empty
            parts of the day genuinely empty-looking.
          */}
          {timeline.regions.map((region) => (
            <RegionBand
              key={region.start}
              region={region}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
            />
          ))}

          {placed.map((item) => {
            const drag = dragOf(item.entry)
            const shown = drag.at ? placedAt(item, drag.at, rangeStart, rangeEnd) : item
            return (
              <Block
                key={item.key}
                // In the air it is the column's width, not its lane's: the
                // blocks it shared a lane with are not where it is going.
                item={drag.lifted ? { ...shown, lane: 0, lanes: 1 } : shown}
                now={now}
                editing={editing}
                onEdit={onComposer}
                onRemoveBreak={onRemoveBreak}
                onRemoveCommitment={onRemoveCommitment}
                onMarkTaken={markTaken(item.entry)}
                drag={drag}
              />
            )
          })}

          {/* Where the dragged block would land, in the gutter level with its
              top, where the hours are read. */}
          {moving && (
            <div
              aria-hidden
              className={`tnum pointer-events-none absolute left-0 z-30 rounded-md border bg-surface-raised px-1 text-[11px] whitespace-nowrap ${
                moving.kind === 'commitment'
                  ? 'border-commit/40 text-commit'
                  : 'border-rest/40 text-rest'
              }`}
              style={{ top: yAt(moving.startsAt, rangeStart) - 8 }}
            >
              {formatClock(moving.startsAt)}
              {moving.todayOnly && ' · today only'}
            </div>
          )}

          {nowVisible && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-20"
              style={{ top: nowOffset }}
              aria-hidden
            >
              <div className="relative border-t border-bright/70">
                <span className="absolute -top-1.5 -left-1 h-2.5 w-2.5 rounded-full bg-bright/80" />
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-line px-4 py-2.5 text-xs text-muted">
        {timeline.regions.length === 0
          ? 'No working hours set for today'
          : `Working until ${formatClock(timeline.horizon)}`}
      </footer>
    </aside>
  )
}

/**
 * One of the header controls.
 *
 * Clicking the open one closes it, which is the behaviour a toggle promises and
 * also the only way out that does not involve moving the pointer somewhere
 * else. `aria-expanded` is what tells a screen reader this reveals something
 * rather than navigating away.
 *
 * Pressed only while the form below is adding. The same form opened by clicking
 * a break on the axis is about that break, and this button still means "a new
 * one" — showing it lit would be claiming the editor belongs to it.
 */
function HeaderToggle({
  kind,
  composer,
  onComposer,
  children,
}: {
  kind: ComposerKind
  composer: Composer | null
  onComposer: (next: Composer | null) => void
  children: ReactNode
}) {
  const open = composer !== null && composer.kind === kind && editingId(composer) === null

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onComposer(open ? null : adding(kind))}
      className={`rounded-md px-2 py-1 text-xs transition hover:bg-surface-raised hover:text-bright ${
        open ? 'bg-surface-raised text-bright' : 'text-body'
      }`}
    >
      {children}
    </button>
  )
}

/** The one in the list with this id, if it is still there. */
const byId = <T extends { id: string }>(items: readonly T[], id: string | null): T | null =>
  id === null ? null : (items.find((item) => item.id === id) ?? null)

/**
 * The break with this id as its form edits it: a pin, or else a break on the
 * record, or null when neither is still there. The same lookup `break/updated`
 * makes, in the same order, so the form edits what saving it changes.
 */
function editedBreak(
  pins: readonly PlannedBreak[],
  history: readonly CompletedSegment[],
  id: string | null,
): EditedBreak | null {
  if (id === null) return null
  const pin = pins.find((p) => p.id === id)
  if (pin) return { id, startsAt: pin.startsAt, endsAt: breakSpan(pin).end, kind: 'pin' }
  const taken = history.find((s) => s.kind === 'break' && s.id === id)
  return taken ? { id, startsAt: taken.startedAt, endsAt: taken.endedAt, kind: 'record' } : null
}

/**
 * A work region, clipped to the hours actually on the axis.
 *
 * The axis no longer reaches back to cover an empty morning — see `layout` —
 * so a nine-to-six band on a day opened at two is drawn from two. Clipped
 * rather than skipped: the afternoon of that region is still the canvas the
 * plan is painted on, and it is the half you can see.
 */
function RegionBand({
  region,
  rangeStart,
  rangeEnd,
}: {
  region: Interval
  rangeStart: Ms
  rangeEnd: Ms
}) {
  const start = Math.max(region.start, rangeStart)
  const end = Math.min(region.end, rangeEnd)
  if (end <= start) return null

  const top = yAt(start, rangeStart)
  const height = pxFor(end - start)

  return (
    <div
      aria-hidden
      className="absolute right-0 rounded-lg border border-line/60 bg-surface-raised/45"
      style={{ top, height, left: GUTTER_PX - 4 }}
    />
  )
}
