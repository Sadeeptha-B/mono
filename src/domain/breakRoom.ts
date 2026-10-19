/**
 * Where a break can go.
 *
 * A break is one of two things, and each keeps its own company. Ahead of now a
 * pinned break is a *plan*: rest reserved in the day, and it keeps clear of
 * everything else the day holds — commitments, other pins, and anything
 * already on the record. A pin on a commitment's span, getting ready and
 * getting back included, is rest the planner would merge into the meeting and
 * nobody would get; one on another pin is the same rest reserved twice; one on
 * a block already run is rest during work. Behind now a taken break is a
 * *record* of what happened, and keeps clear only of other records — the
 * blocks, breaks and away stretches in history, and whatever is running. A
 * record next to a commitment is two facts about the same hour, and correcting
 * one must never silently rewrite the other, so the two may overlap. Working
 * hours bound neither: rest goes where the user puts it.
 *
 * Those rules are `breakClash`, which the reducer refuses by, the break's form
 * explains by, and the calendar's drag finds room by (`roomFor`), so the three
 * cannot disagree. It says what a span runs into rather than whether, because
 * "that runs into the swim" is the answer a person choosing a time can use.
 * And it is asked about what an edit *newly* runs into (`previous`): a pin a
 * block has since run into, or one an old log left overlapping another, stays
 * editable rather than stuck, since refusing every edit to it helps nobody.
 *
 * The reducer also asks where a pin goes when a commitment *lands on* it
 * (`pinsMovedOff`), and the calendar asks that too, to draw the push while the
 * commitment is still being dragged — which is why the push lives here rather
 * than in either caller. Planning forward, a break and a commitment are
 * exclusive, so a pin a commitment lands on moves down: a meeting arriving on a
 * walk says the walk is later, not that it is off. It goes to the first free
 * place after the commitment, clear of other pins as well, or two pins under
 * one meeting would land on top of each other; and it ignores working hours,
 * since it is a consequence rather than a placement, and a walk after the
 * meeting is truer than one sent to the next stretch or deleted. Two kinds are
 * cleared rather than moved. One that has begun — under way, or over and
 * waiting to be confirmed — cannot be moved down without handing back rest
 * already had or rewriting what the day was; the commitment landing on it says
 * the time went to the commitment instead. And one the day has no room left
 * for before midnight, since the plan is one calendar day and there is nowhere
 * else to put it. The push never touches the record.
 *
 * Pure, like the planner: `at` is a parameter and nothing reads the clock.
 */

import { dayBounds, onSameDay } from './time'
import {
  breakSpan,
  commitmentSpan,
  minutesToMs,
  type ActiveSegment,
  type Commitment,
  type CompletedSegment,
  type Interval,
  type Ms,
  type PlannedBreak,
} from './types'
import { mergeIntervals, overlaps, subtractIntervals } from './intervals'

/** Everything a break has to keep clear of, as the day stands at `at`. */
export type BreakSurroundings = {
  /** The day's commitments, occurrences of a series included (`commitmentsFor`). */
  commitments: readonly Commitment[]
  pins: readonly PlannedBreak[]
  /** Oldest first, as the session keeps it. */
  history: readonly CompletedSegment[]
  active: ActiveSegment | null
  at: Ms
}

/** What a break would run into, said so the person choosing a time can act on it. */
export type Clash =
  | { kind: 'commitment'; commitment: Commitment }
  | { kind: 'pin'; startsAt: Ms }
  | { kind: 'break'; startsAt: Ms; running: boolean }
  | { kind: 'block'; startsAt: Ms; running: boolean }
  | { kind: 'away'; startsAt: Ms }
  /** A record has to have happened: it cannot end after now. */
  | { kind: 'ahead' }
  /** A record stays on the day it was taken. */
  | { kind: 'elsewhere' }

/** A plan, which keeps clear of everything, or a record, which keeps clear of records. */
export type BreakKind = 'pin' | 'record'

type Taken = { span: Interval; clash: Clash }

/**
 * The segments in history that start on the local day of `on`, newest first.
 *
 * Those are the ones the calendar draws (see the planner's day scoping), so
 * they are the ones a break can be seen to run into. History is kept oldest
 * first, so this walks back from the end and stops at the first segment from
 * an earlier day, rather than reading a journal that is kept forever.
 */
function recordedOn(history: readonly CompletedSegment[], on: Ms): CompletedSegment[] {
  const { start } = dayBounds(on)
  const found: CompletedSegment[] = []
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const segment = history[i]!
    if (segment.startedAt < start) break
    if (onSameDay(segment.startedAt, on)) found.push(segment)
  }
  return found
}

const recordClash = (segment: CompletedSegment): Clash =>
  segment.kind === 'away'
    ? { kind: 'away', startsAt: segment.startedAt }
    : segment.kind === 'break'
      ? { kind: 'break', startsAt: segment.startedAt, running: false }
      : { kind: 'block', startsAt: segment.startedAt, running: false }

/** Everything on the record a break near `on` must keep clear of, `except` itself. */
function records(day: BreakSurroundings, on: Ms, except: string | null): Taken[] {
  return recordedOn(day.history, on)
    .filter((s) => s.id !== except)
    .map((s) => ({ span: { start: s.startedAt, end: s.endedAt }, clash: recordClash(s) }))
}

/**
 * What a pin must keep clear of: every commitment, every other pin, and the
 * record. Not the running segment — a pin across the end of the block under
 * way is rest planned for after it, which the planner draws from where the
 * block ends, as it always has.
 */
function takenFromPlan(day: BreakSurroundings, on: Ms, except: string | null): Taken[] {
  return [
    ...day.commitments.map((commitment) => ({
      span: commitmentSpan(commitment),
      clash: { kind: 'commitment', commitment } as const,
    })),
    ...day.pins
      .filter((p) => p.id !== except)
      .map((p) => ({ span: breakSpan(p), clash: { kind: 'pin', startsAt: p.startsAt } as const })),
    ...records(day, on, except),
  ]
}

/**
 * What a record must keep clear of: the rest of the record, and whatever is
 * running, which is the record being written. A block whose timer has run out
 * but is not banked yet still holds its time until now.
 */
function takenFromRecord(day: BreakSurroundings, on: Ms, except: string | null): Taken[] {
  const running: Taken[] =
    day.active === null
      ? []
      : [
          {
            span: { start: day.active.startedAt, end: Math.max(day.active.endsAt, day.at) },
            clash:
              day.active.kind === 'break'
                ? { kind: 'break', startsAt: day.active.startedAt, running: true }
                : { kind: 'block', startsAt: day.active.startedAt, running: true },
          },
        ]
  return [...records(day, on, except), ...running]
}

/**
 * What a break of `kind` laid over `span` would newly run into, or null when
 * it is clear.
 *
 * `except` is the break itself, when it is already on the day. `previous` is
 * where it was before the edit, if it was anywhere: anything it already
 * overlapped there is not a reason to refuse moving it (see the note at the
 * top). A record also has to be over by `at` and stay on the day it was taken
 * — `previous`'s day, or `span`'s own for a pin being confirmed.
 */
export function breakClash(
  span: Interval,
  kind: BreakKind,
  day: BreakSurroundings,
  { except = null, previous = null }: { except?: string | null; previous?: Interval | null } = {},
): Clash | null {
  if (kind === 'record') {
    if (span.end > day.at) return { kind: 'ahead' }
    if (!onSameDay(span.start, (previous ?? span).start)) return { kind: 'elsewhere' }
  }
  const taken =
    kind === 'pin' ? takenFromPlan(day, span.start, except) : takenFromRecord(day, span.start, except)
  const hit = taken.find(
    (t) => overlaps(t.span, span) && !(previous !== null && overlaps(t.span, previous)),
  )
  return hit?.clash ?? null
}

/**
 * Where on `within` a break of `kind` may be put down: what is left of it once
 * everything `breakClash` keeps it from is taken out, and, for a record, only
 * the part already behind `at`. Worked out once when a break is picked up,
 * since nothing it is made of moves while the pointer does.
 */
export function roomFor(
  kind: BreakKind,
  day: BreakSurroundings,
  within: Interval,
  except: string | null,
): Interval[] {
  const taken =
    kind === 'pin'
      ? takenFromPlan(day, within.start, except)
      : takenFromRecord(day, within.start, except)
  const reach = kind === 'pin' ? within : { start: within.start, end: Math.min(within.end, day.at) }
  return freeTime([reach], taken.map((t) => t.span), reach.start)
}

/**
 * The rest taken on the local day of `on`: every break on the record, and the
 * one running, to the end it is set for.
 */
export function restTaken(
  history: readonly CompletedSegment[],
  active: ActiveSegment | null,
  on: Ms,
): Interval[] {
  const taken = recordedOn(history, on)
    .filter((s) => s.kind === 'break')
    .map((s) => ({ start: s.startedAt, end: s.endedAt }))
  return active?.kind === 'break'
    ? [...taken, { start: active.startedAt, end: active.endsAt }]
    : taken
}

/**
 * What of a pin is still the plan once the rest taken over it is out: from
 * the end of the last break that overlaps it to its own end, or null when no
 * part of it is left.
 *
 * A break taken across a pin is the rest it planned, had and drawn where it
 * was had, so the pin is not drawn under it as well — the same rest twice.
 * What is left after it is still reserved: a break cut short inside a longer
 * pin leaves the rest of the reservation standing, which is why the planner
 * draws that part and the pin can be confirmed for it. What came before the
 * rest is not drawn: that reservation was answered by the rest that followed
 * it. This is the drawing's half of `break/ended`, which takes a pin off the
 * plan once a break runs through its end; while the break is still running,
 * or after one ended early, the pin is still there and this is what keeps the
 * two from being drawn on top of each other.
 */
export function pinLeft(pin: PlannedBreak, rests: readonly Interval[]): Interval | null {
  const span = breakSpan(pin)
  let start = span.start
  for (const rest of [...rests].sort((a, b) => a.start - b.start)) {
    if (overlaps(rest, { start, end: span.end })) start = Math.max(start, rest.end)
  }
  return start < span.end ? { start, end: span.end } : null
}

/** The parts of `within` from `from` on, less everything in `busy`, in order. */
export function freeTime(
  within: readonly Interval[],
  busy: readonly Interval[],
  from: Ms,
): Interval[] {
  const taken = mergeIntervals(busy)
  return mergeIntervals(within.map((r) => ({ start: Math.max(r.start, from), end: r.end })))
    .flatMap((r) => subtractIntervals(r, taken))
}

/**
 * Where in `free` a stretch of `length` sits nearest to starting at `wanted`,
 * or null when no free stretch is long enough to hold it.
 */
export function nearestRoom(wanted: Ms, length: Ms, free: readonly Interval[]): Ms | null {
  let best: Ms | null = null
  for (const f of free) {
    if (f.end - f.start < length) continue
    const start = Math.min(Math.max(wanted, f.start), f.end - length)
    if (best === null || Math.abs(start - wanted) < Math.abs(best - wanted)) best = start
  }
  return best
}

/** The first place in `free`, at or after `from`, that holds `length`. */
export function firstRoom(from: Ms, length: Ms, free: readonly Interval[]): Ms | null {
  for (const f of free) {
    const start = Math.max(f.start, from)
    if (f.end - start >= length) return start
  }
  return null
}

/**
 * The pins once `commitment` is where it now is, at `at`: any it lands on that
 * have not begun moved down to the first free time after it in the local day
 * containing `at`, in their order, each keeping its length; any it lands on
 * that have begun, or that the day has no room left for, cleared. See the note
 * at the top for why each.
 *
 * `others` is the rest of the day's commitments as they will be, so a pin is
 * never pushed onto the next meeting along: it goes past that one too. Pins it
 * does not land on stay exactly where they are, the ones already over
 * included, and a moved pin is kept off them as well.
 */
export function pinsMovedOff(
  pins: readonly PlannedBreak[],
  commitment: Commitment,
  others: readonly Commitment[],
  at: Ms,
): PlannedBreak[] {
  const span = commitmentSpan(commitment)
  const landedOn = pins.filter((p) => overlaps(breakSpan(p), span))
  if (landedOn.length === 0) return [...pins]

  const staying = pins.filter((p) => !landedOn.includes(p))
  const busy = [span, ...others.map(commitmentSpan), ...staying.map(breakSpan)]
  const day = dayBounds(at)
  const moved: PlannedBreak[] = []
  for (const pin of [...landedOn].sort((a, b) => a.startsAt - b.startsAt)) {
    if (pin.startsAt < at) continue
    const startsAt = firstRoom(
      Math.max(span.end, at),
      minutesToMs(pin.durationMin),
      freeTime([day], busy, at),
    )
    if (startsAt === null) continue
    const next = { ...pin, startsAt }
    moved.push(next)
    busy.push(breakSpan(next))
  }
  return [...staying, ...moved].sort((a, b) => a.startsAt - b.startsAt)
}
