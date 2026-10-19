/**
 * Picking up a commitment or a break and dragging it along the calendar's
 * axis: a pin, which is the plan, or a break already taken, which is the
 * record put right.
 *
 * The commonest edit to any of them is "lunch is half an hour late today", and
 * the answer to that is a place on the axis, not a number in a form. Unlike a
 * click on the block, a drag cannot happen by accident in a way that goes
 * unseen: the block moves under the pointer with the time it would land at
 * beside it, nothing is written until it is let go, and Escape puts it back.
 * Letting go sends the same `startsAt` patch the form does, so everything the
 * reducer does for `Save` it does here. Where each kind may land is
 * `landing.ts`.
 *
 * That includes what a commitment does to the pins it lands on
 * (`pinsMovedOff`). The drag asks the same function the reducer does while the
 * commitment is still in the air, and draws the pins where it would put them,
 * or faded where it would clear them. A commitment's time either side travels
 * with it, since its margins are blocks of their own; that, and the pins it
 * pushes, is why the drag is held here for the whole axis rather than by the
 * block being dragged.
 *
 * The pointer is read as a time: the time under it, less where on the block it
 * was picked up, is the start being asked for. It is read against the axis as
 * it is drawn now, never as a distance from where the press began, because the
 * axis can change under a pointer standing still — scrolled by the wheel or by
 * the edge, or grown. Whatever moves is drawn at the stretch it would take
 * (`Drag.at`), worked out from the store, never offset from where its block is
 * drawn now: the planner draws a pin under a running break from that break's
 * end, and shifting that box drew it somewhere it would not land.
 *
 * Held against an edge of what scrolls the day — the column beside the stage,
 * or the page when the column is stacked under it — the day scrolls under the
 * pointer (`edgeScroll.ts`), so a time out of sight is reached without letting
 * go, and no further than the day's own ends, even where the page goes on
 * into the stage. Once there is no more of it to scroll, the axis itself
 * grows, an hour at a time up to midnight, so a lunch can be carried into an
 * evening the day had not drawn yet (`onReach`, which `layout` widens the
 * axis by until the drag ends). It also reaches as far as a pin the
 * commitment in the air would push past the last hour drawn, so the pin is
 * drawn whole where it would go. `DayCalendar` keeps the drawing still while
 * the axis grows above it, by scrolling as much as the top grew.
 *
 * What cannot be picked up: the one whose form is open on the calendar, which
 * is the way it is being changed just then — a break's form, seeded once,
 * would reopen where a drag put it and lose what was typed; what is running,
 * which is the stage's; and anything touched, rather than pointed at with a
 * mouse. A commitment open in the stage's form can be dragged: that form
 * holds only what is typed into it (`CommitmentEdits`), so it shows the move
 * and never saves the old time back. On a phone the calendar is
 * part of a page that scrolls under a finger, and the forms stay the way to
 * move either there and from the keyboard.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import { armedAt, dayScroller, edgeStep, grownAxis, scrollStep, type Armed } from './edgeScroll'
import { msFor, TOP_PAD_PX } from './geometry'
import { breakLanding, hull, movedStart, pushedPins, pushedReach } from './landing'
import { roomFor, type BreakKind, type BreakSurroundings } from '@/domain/breakRoom'
import { dayBounds } from '@/domain/time'
import {
  breakSpan,
  commitmentEvent,
  commitmentMargins,
  type Commitment,
  type CommitmentPatch,
  type Interval,
  type Ms,
  type PlannedBreakPatch,
  type TimelineEntry,
} from '@/domain/types'

/**
 * How far a press has to travel before it is a drag. Less than one
 * five-minute step on the axis, so the first step is never lost.
 */
const DRAG_THRESHOLD_PX = 4

/** How long a drag held at the end of the day waits between growing it an hour. */
const GROW_EVERY_MS = 400

/** What is being dragged, and where it would land. */
export type Moving = {
  kind: 'commitment' | 'break'
  id: string
  startsAt: Ms
  /**
   * One day of a series: moving it moves today's only, as its form says, and
   * the time it carries says so too.
   */
  todayOnly: boolean
}

/** What dragging means for one block on the axis. */
export type Drag = {
  /** Picks up what the block draws, or null when it cannot be moved. */
  onGrab: ((event: ReactPointerEvent) => void) | null
  /** It is the one in the air. */
  lifted: boolean
  /** The stretch to draw it over while something is in the air, or null to draw it where it is. */
  at: Interval | null
  /** A pin the commitment being dragged would clear. */
  leaving: boolean
}

const STILL: Drag = { onGrab: null, lifted: false, at: null, leaving: false }

/**
 * Something picked up: where it was, where a start asked for puts it, how to
 * put it there, and what of the day the axis has to reach to show it landing
 * there — the pins a commitment would push — or null for nothing beyond it.
 */
type Held = Moving & {
  land: (wanted: Ms) => Ms | null
  put: (startsAt: Ms) => void
  reach: (startsAt: Ms) => Interval | null
}

export function useCalendarDrag({
  scroller,
  content,
  axis,
  surroundings,
  editing,
  onReach,
  onUpdateCommitment,
  onUpdateBreak,
}: {
  /** The column, which scrolls the day itself beside the stage and not under it. */
  scroller: RefObject<HTMLElement | null>
  /** The axis itself, which the pointer is read against. */
  content: RefObject<HTMLElement | null>
  /** The stretch of the day the calendar draws now. */
  axis: Interval
  /**
   * The day as the store holds it, for the reason `DayCalendar` takes it from
   * there, and what a break keeps clear of (`breakClash`).
   */
  surroundings: BreakSurroundings
  /** What the open form is editing, which stays put. */
  editing: string | null
  /**
   * What the axis has to reach while something is in the air — as far as a
   * drag held at the end of the day has grown it, and over any pin the
   * landing would push — for `layout` to widen the day by, or null when
   * nothing needs it or the drag is over.
   */
  onReach: (reach: Interval | null) => void
  onUpdateCommitment: (id: string, patch: CommitmentPatch) => void
  onUpdateBreak: (id: string, patch: PlannedBreakPatch) => void
}) {
  const { commitments, pins, history, at: now } = surroundings
  const [moving, setMoving] = useState<Moving | null>(null)
  // The axis as last drawn, read by the handlers of a drag under way, which
  // outlive the render that started it.
  const drawn = useRef(axis)
  // A drag under way reads its landing again whenever the axis is drawn
  // differently, not only when something scrolls: grown an hour, the axis
  // moves everything on it, and where the pointer stands is a new time. Left
  // to the scroll that keeps the drawing still (`DayCalendar`), it waited on
  // a scroll that need not come, and a release then saved where the block had
  // been an hour before. Read after that scroll, which runs first, so the
  // pointer is measured against the axis where it now is.
  const refollow = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const moved = drawn.current.start !== axis.start || drawn.current.end !== axis.end
    drawn.current = axis
    if (moved) refollow.current?.()
  })
  // Ends a drag under way without writing anything, for a column unmounted
  // mid-drag; null while nothing is being dragged.
  const dropDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => dropDrag.current?.(), [])

  /**
   * Pick something up. Listened for on the window rather than captured by the
   * block, since the block moves under the pointer and a drag let go outside
   * the column still has to end.
   *
   * `land` says where a start asked for would put it down, or null when
   * nowhere would hold it; it then stays where it last could, rather than
   * jumping back. The state changes only when the landing does, which is once a
   * step rather than once a pixel. Escape is heard first, before any field with
   * the focus, so it ends the drag and nothing else; and the window losing the
   * focus ends it as well, since the release that would have ended it may then
   * never arrive here.
   */
  const grab = (event: ReactPointerEvent, held: Held) => {
    const axisEl = content.current
    if (!axisEl || dropDrag.current) return
    const timeAt = (clientY: number) =>
      drawn.current.start + msFor(clientY - axisEl.getBoundingClientRect().top - TOP_PAD_PX)
    const grip = timeAt(event.clientY) - held.startsAt
    let pointerY = event.clientY
    let lifted = false
    let landing: Ms | null = null
    let frame = 0
    let armed: Armed | null = null
    let grown: Interval | null = null
    let shows: Interval | null = null
    let grewAt = -Infinity

    // What the axis is widened to: as far as the edge has grown it, and as
    // far as the landing needs to show what it moves.
    const reach = () =>
      onReach(grown === null ? shows : shows === null ? grown : hull(grown, shows))

    const follow = () => {
      const wanted = timeAt(pointerY) - grip
      if (!lifted && Math.abs(wanted - held.startsAt) < msFor(DRAG_THRESHOLD_PX)) return
      lifted = true
      const next = held.land(wanted)
      if (next === null || next === landing) return
      landing = next
      setMoving({ kind: held.kind, id: held.id, startsAt: next, todayOnly: held.todayOnly })
      const needs = held.reach(next)
      if (needs !== null || shows !== null) {
        shows = needs
        reach()
      }
    }

    // Built on what was last asked for as well as what is drawn, so two
    // growths before a render are two hours, not one twice.
    const grow = (earlier: boolean): boolean => {
      const next = grownAxis(grown ?? drawn.current, dayBounds(drawn.current.start), earlier)
      if (next === null) return false
      grown = next
      reach()
      return true
    }

    // One scroll a frame for as long as the pointer stays near an armed edge;
    // the scroll it makes is heard by `scrolled`, which moves the landing on.
    // At the end of what scrolls, the axis grows instead, and a frame without
    // either is the last.
    const edge = () => {
      frame = 0
      const day = dayScroller(scroller.current, axisEl)
      armed = armedAt(armed, pointerY, day.seen)
      const step = edgeStep(pointerY, day.seen, armed)
      if (step === 0) return
      const by = scrollStep(step, day.room)
      if (by !== 0) {
        if (day.column) day.column.scrollTop += by
        else window.scrollBy(0, by)
      } else {
        const stamp = performance.now()
        if (stamp - grewAt >= GROW_EVERY_MS) {
          if (!grow(step < 0)) return
          grewAt = stamp
        }
      }
      frame = requestAnimationFrame(edge)
    }
    const move = (e: PointerEvent) => {
      pointerY = e.clientY
      armed = armedAt(armed, pointerY, dayScroller(scroller.current, axisEl).seen)
      follow()
      if (lifted && frame === 0) edge()
    }
    const scrolled = () => follow()
    const finish = (keep: boolean) => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('contextmenu', cancel, true)
      dropDrag.current = null
      refollow.current = null
      setMoving(null)
      onReach(null)
      if (keep && landing !== null && landing !== held.startsAt) held.put(landing)
    }
    const release = () => finish(true)
    const cancel = () => finish(false)
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }

    armed = armedAt(null, pointerY, dayScroller(scroller.current, axisEl).seen)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape, true)
    // Captured, because a scroll does not bubble and the column's is its own.
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('blur', cancel)
    // A menu opened mid-drag, by a second button or the keyboard, can keep
    // the release from ever reaching the window.
    window.addEventListener('contextmenu', cancel, true)
    dropDrag.current = cancel
    // Only once lifted: a press not yet a drag stays a press, whatever the
    // axis does under it.
    refollow.current = () => {
      if (lifted) follow()
    }
  }

  const grabCommitment = (event: ReactPointerEvent, commitment: Commitment) =>
    grab(event, {
      kind: 'commitment',
      id: commitment.id,
      startsAt: commitment.startsAt,
      todayOnly: commitment.recurringId !== undefined,
      land: (wanted) => movedStart(commitment, wanted, drawn.current),
      put: (startsAt) => onUpdateCommitment(commitment.id, { startsAt }),
      reach: (startsAt) =>
        pushedReach(pushedPins(commitment, startsAt, commitments, pins, now), pins),
    })

  /**
   * A pin anywhere on the axis it may share with nothing — a pin dropped
   * behind now arrives as one whose time has passed, asking to be confirmed —
   * or a break taken anywhere behind now that the rest of the record leaves
   * free (`roomFor`). Either keeps its exact length. The room is worked out
   * again for each start asked for, since the axis it is found on can grow.
   */
  const grabBreak = (event: ReactPointerEvent, kind: BreakKind, id: string, span: Interval) =>
    grab(event, {
      kind: 'break',
      id,
      startsAt: span.start,
      todayOnly: false,
      land: (wanted) =>
        breakLanding(
          span.start,
          wanted,
          span.end - span.start,
          roomFor(kind, surroundings, drawn.current, id),
        ),
      put: (startsAt) => onUpdateBreak(id, { startsAt }),
      reach: () => null,
    })

  /**
   * While a commitment is dragged, where each pin would be once it lands: the
   * reducer's own function, asked early. A pin missing from the answer is one
   * it would clear.
   */
  const dragged =
    moving?.kind === 'commitment' ? commitments.find((c) => c.id === moving.id) : undefined
  const pushed =
    moving && dragged ? pushedPins(dragged, moving.startsAt, commitments, pins, now) : null

  /** What dragging means for the block drawing `entry`. */
  const dragOf = (entry: TimelineEntry): Drag => {
    if (entry.kind === 'commitment' || entry.kind === 'commitment-margin') {
      const own = commitments.find((c) => c.id === entry.commitment.id)
      if (!own) return STILL
      const to = moving?.kind === 'commitment' && moving.id === own.id ? moving.startsAt : null
      return {
        onGrab: own.id === editing ? null : (event) => grabCommitment(event, own),
        lifted: to !== null,
        at: to === null ? null : stretchOf(entry, { ...own, startsAt: to }),
        leaving: false,
      }
    }

    if (entry.kind === 'planned-break') {
      const pin = pins.find((b) => b.id === entry.id)
      if (!pin) return STILL
      const lifted = moving?.kind === 'break' && moving.id === pin.id
      const to = lifted ? moving.startsAt : pushed?.get(pin.id)
      return {
        onGrab:
          pin.id === editing ? null : (event) => grabBreak(event, 'pin', pin.id, breakSpan(pin)),
        lifted,
        at:
          to !== undefined && (lifted || to !== pin.startsAt)
            ? breakSpan({ ...pin, startsAt: to })
            : null,
        leaving: pushed !== null && !pushed.has(pin.id),
      }
    }

    // A break already taken. The push never reaches it: a commitment moved
    // onto the record leaves the two side by side, as two facts about one
    // hour. What is running is not this — it is the stage's until it ends.
    if (entry.kind === 'past' && entry.segment.kind === 'break') {
      const taken = history.find((s) => s.kind === 'break' && s.id === entry.segment.id)
      if (!taken) return STILL
      const span = { start: taken.startedAt, end: taken.endedAt }
      const to = moving?.kind === 'break' && moving.id === taken.id ? moving.startsAt : null
      return {
        onGrab: taken.id === editing ? null : (event) => grabBreak(event, 'record', taken.id, span),
        lifted: to !== null,
        at: to === null ? null : { start: to, end: to + span.end - span.start },
        leaving: false,
      }
    }

    return STILL
  }

  return { moving, dragOf }
}

/**
 * The part of a commitment, moved, that one of its blocks draws: the split the
 * planner draws it with (`commitmentMargins`), so the two cannot disagree. A
 * margin the commitment has is never null; the fallback is for the type.
 */
function stretchOf(
  entry: Extract<TimelineEntry, { kind: 'commitment' | 'commitment-margin' }>,
  moved: Commitment,
): Interval {
  const event = commitmentEvent(moved)
  if (entry.kind === 'commitment') return event
  const { before, after } = commitmentMargins(moved)
  return (entry.side === 'before' ? before : after) ?? event
}
