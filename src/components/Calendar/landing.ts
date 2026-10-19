/**
 * Where a commitment or a break dragged on the calendar lands.
 *
 * The calendar turns the pointer into the start it is asking for — the time
 * under the pointer, less where on the block it was picked up — and this turns
 * that into a start the day can hold. All of them share three rules.
 *
 * They snap to five minutes on the clock rather than moving by five-minute
 * steps from wherever they were. A start is a time someone will read back —
 * "lunch at 12:35" — and a 12:03 lunch dragged half an hour should land on
 * 12:35 or 12:30, never on 12:33. Rounding the instant itself is rounding the
 * wall clock, since every zone's offset from UTC is a whole number of five
 * minutes.
 *
 * Within half a step of where it was picked up, it is where it was picked up.
 * Snapping to the clock would otherwise move a 12:03 lunch to 12:05 for being
 * lifted and put back — and a break taken at 2:00:37 to 2:00.
 *
 * And they stay on the axis they were dragged along. The calendar draws one day
 * and only the hours of it that hold something (`layout`), growing it an hour
 * at a time while a drag is held at its edge, so anything dropped past either
 * end would land somewhere the drag could not show. A commitment is kept whole
 * on it, the time either side included, since a lunch whose travel was let go
 * of past the last hour drawn is not one the user saw land.
 *
 * A commitment goes anywhere on the axis, the past included: the calendar is
 * also the record of how the day went, and a meeting that ran at two rather
 * than the planned three is put right after the fact. A break goes only where
 * `roomFor` leaves it room — a pin clear of everything on the day, a break
 * taken clear of the rest of the record and behind now — and where the
 * pointer is over something in its way, it goes to the nearest side of it
 * instead, so it can be dragged straight across.
 */

import { nearestRoom, pinsMovedOff } from '@/domain/breakRoom'
import {
  breakSpan,
  commitmentSpan,
  type Commitment,
  type Interval,
  type Ms,
  type PlannedBreak,
} from '@/domain/types'

/** One step of a drag: five minutes on the clock. */
export const SNAP_MS = 5 * 60_000

const snapped = (at: Ms): Ms => Math.round(at / SNAP_MS) * SNAP_MS

/** Whether a start asked for is near enough to where it was to leave it there. */
const stayed = (startsAt: Ms, wanted: Ms): boolean => Math.abs(wanted - startsAt) < SNAP_MS / 2

/** The start a commitment dragged towards `wanted` lands on. */
export function movedStart(commitment: Commitment, wanted: Ms, axis: Interval): Ms {
  const { startsAt } = commitment
  if (stayed(startsAt, wanted)) return startsAt
  const span = commitmentSpan(commitment)
  // Kept whole on the axis — but never pushed further off it than it already
  // is, for a span the axis cannot hold, which midnight can clip.
  const earliest = Math.min(axis.start + (startsAt - span.start), startsAt)
  const latest = Math.max(axis.end - (span.end - startsAt), startsAt)
  return Math.max(earliest, Math.min(snapped(wanted), latest))
}

/**
 * The start a break dragged towards `wanted` lands on, in `room` (`roomFor`),
 * or null when nowhere there holds it.
 */
export const breakLanding = (
  startsAt: Ms,
  wanted: Ms,
  length: Ms,
  room: readonly Interval[],
): Ms | null => (stayed(startsAt, wanted) ? startsAt : nearestRoom(snapped(wanted), length, room))

/**
 * Where each pin would be once `commitment`, dragged to start at `startsAt`,
 * lands: the reducer's own push (`pinsMovedOff`), asked while it is still in
 * the air. A pin missing from the answer is one it would clear.
 */
export function pushedPins(
  commitment: Commitment,
  startsAt: Ms,
  commitments: readonly Commitment[],
  pins: readonly PlannedBreak[],
  at: Ms,
): Map<string, Ms> {
  const there = { ...commitment, startsAt }
  const others = commitments.filter((c) => c.id !== commitment.id)
  return new Map(pinsMovedOff(pins, there, others, at).map((pin) => [pin.id, pin.startsAt]))
}

/**
 * The stretch the pins moved in `pushed` (`pushedPins`) would be drawn over,
 * or null when none moves: what the axis has to reach while the commitment is
 * in the air. A pin pushed past the last hour drawn was otherwise drawn as a
 * sliver against the edge of the day, hiding where the drop would send it
 * until the drop had sent it there.
 */
export function pushedReach(
  pushed: ReadonlyMap<string, Ms>,
  pins: readonly PlannedBreak[],
): Interval | null {
  let reach: Interval | null = null
  for (const pin of pins) {
    const to = pushed.get(pin.id)
    if (to === undefined || to === pin.startsAt) continue
    const span = breakSpan({ ...pin, startsAt: to })
    reach = reach === null ? span : hull(reach, span)
  }
  return reach
}

/** The least stretch covering both. */
export const hull = (a: Interval, b: Interval): Interval => ({
  start: Math.min(a.start, b.start),
  end: Math.max(a.end, b.end),
})
