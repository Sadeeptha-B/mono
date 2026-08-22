/**
 * The planner.
 *
 * `derivePlan` is the single source of truth for what the day looks like. It
 * is pure: given the same inputs it always returns the same timeline, and it
 * never reads the clock or touches storage. Every deviation — a break taken, a
 * commitment added, a block abandoned — is handled by calling it again rather
 * than by mutating a stored schedule. That is what keeps the timer and the
 * timeline from ever disagreeing.
 */


import {
  commitmentEvent,
  commitmentSpan,
  minutesToMs,
  type ActiveSegment,
  type BlockKind,
  type Commitment,
  type CompletedSegment,
  type Interval,
  type Ms,
  type PlannedBreak,
  type Settings,
  type Timeline,
  type TimelineEntry,
  type WorkRegion,
} from './types'

/**
 * Leftover shorter than this is dropped rather than drawn. `now` lands on an
 * arbitrary second, so without this the timeline sprouts sub-minute slivers.
 */
const MIN_MARGIN_MS = 60_000

export type DerivePlanInput = {
  now: Ms
  settings: Settings
  /**
   * Today's work regions — the only time Mono is allowed to plan in. The end
   * of the last one is the horizon, so an empty list means an empty plan
   * rather than a guess about when the day stops.
   */
  regions: readonly WorkRegion[]
  commitments: readonly Commitment[]
  history: readonly CompletedSegment[]
  active: ActiveSegment | null
  overrides: readonly PlannedBreak[]
}

export function derivePlan(input: DerivePlanInput): Timeline {
  const { now, settings, regions, commitments, history, active, overrides } = input

  // Planning starts after whatever is already running. A block in flight is
  // never re-planned; it owns its slot until it completes or is abandoned.
  const planFrom = active ? Math.max(now, active.endsAt) : now

  // The positive space. Overlapping regions are coalesced so a day described
  // as 9-12 and 11-5 behaves as 9-5 rather than double-counting the overlap.
  const workRegions = mergeIntervals(
    regions.map((r) => ({ start: r.startsAt, end: r.endsAt })),
  )

  // The horizon is simply where the work day stops. A commitment scheduled
  // outside every region still appears on the timeline, but it no longer drags
  // the planning horizon out behind it — that was the old dayEndsAt guessing.
  const horizon = workRegions.at(-1)?.end ?? now

  const entries: TimelineEntry[] = []

  for (const segment of history) {
    entries.push({
      kind: 'past',
      segment,
      startsAt: segment.startedAt,
      endsAt: segment.endedAt,
    })
  }

  if (active) {
    entries.push({
      kind: 'active',
      segment: active,
      startsAt: active.startedAt,
      endsAt: active.endsAt,
    })
  }

  // Commitments that are still ahead of us shape the plan; ones already behind
  // us are history's business, not the planner's. "Behind us" means the whole
  // span, so a meeting that has finished but still has twenty minutes of
  // getting back attached to it is not yet in the past.
  const upcomingCommitments = commitments.filter((c) => commitmentSpan(c).end > planFrom)
  for (const commitment of upcomingCommitments) {
    // The commitment is drawn at its own length, and the time it costs either
    // side is drawn as its own thing. Merging them into one long entry would
    // say the user is in the meeting while they are still in the car.
    const event = commitmentEvent(commitment)
    entries.push({
      kind: 'commitment',
      commitment,
      startsAt: event.start,
      endsAt: event.end,
    })

    const span = commitmentSpan(commitment)
    if (span.start < event.start) {
      entries.push({
        kind: 'commitment-margin',
        commitment,
        side: 'before',
        startsAt: span.start,
        endsAt: event.start,
      })
    }
    if (span.end > event.end) {
      entries.push({
        kind: 'commitment-margin',
        commitment,
        side: 'after',
        startsAt: event.end,
        endsAt: span.end,
      })
    }
  }

  const upcomingBreaks = overrides.filter(
    (b) => toBreakInterval(b).end > planFrom,
  )
  for (const plannedBreak of upcomingBreaks) {
    const { start, end } = toBreakInterval(plannedBreak)
    entries.push({
      kind: 'planned-break',
      id: plannedBreak.id,
      startsAt: Math.max(start, planFrom),
      endsAt: end,
    })
  }

  // Anything the user has already committed the time to — meetings and the
  // breaks they pinned — is unavailable. What is left over gets filled.
  const busy = mergeIntervals([
    ...upcomingCommitments.map(commitmentSpan),
    ...upcomingBreaks.map(toBreakInterval),
  ])

  // Free time is what is left of each work region once the parts already spoken
  // for are removed. Each region is filled independently, so an unstructured
  // evening gap simply is not planned and the next region picks up after it.
  for (const region of workRegions) {
    const start = Math.max(region.start, planFrom)
    if (start >= region.end) continue
    for (const segment of subtractIntervals({ start, end: region.end }, busy)) {
      entries.push(...fillSegment(segment, settings))
    }
  }

  entries.sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)

  return { now, horizon, regions: workRegions, entries }
}

/**
 * Lay blocks into one uninterrupted stretch of free time.
 *
 * We enumerate every `(deep, short)` combination that fits rather than filling
 * greedily, because the two sensible ranking policies disagree and the choice
 * belongs to the user. The search is at most `available / deepMinutes`
 * candidates — single digits in practice.
 *
 * The disagreement is real: a 60-minute stretch holds one deep block with 15
 * dead minutes, or three short blocks with none. `prefer-deep` (the default)
 * takes the former, because an app built for deep work should not quietly
 * shred a free hour into short blocks to win five minutes on a scoreboard.
 */
function fillSegment(segment: Interval, settings: Settings): TimelineEntry[] {
  const available = segment.end - segment.start
  const deepMs = minutesToMs(settings.deepMinutes)
  const shortMs = minutesToMs(settings.shortMinutes)

  const best = bestFill(available, deepMs, shortMs, settings.plannerPolicy)

  const entries: TimelineEntry[] = []
  let cursor = segment.start

  // Deep blocks lead: you arrive at a free stretch fresh, so spend that on the
  // longest block the stretch can hold.
  const kinds: BlockKind[] = [
    ...Array<BlockKind>(best.deepCount).fill('deep'),
    ...Array<BlockKind>(best.shortCount).fill('short'),
  ]

  for (const blockKind of kinds) {
    const duration = blockKind === 'deep' ? deepMs : shortMs
    entries.push({
      kind: 'planned-block',
      // Deterministic so re-deriving is idempotent and React keys stay stable.
      id: `planned-${blockKind}-${cursor}`,
      blockKind,
      startsAt: cursor,
      endsAt: cursor + duration,
    })
    cursor += duration
  }

  // Whatever will not fit is dead time. Rounded down, never up — the app
  // should not pretend a 50-minute gap holds more than one block.
  if (segment.end - cursor >= MIN_MARGIN_MS) {
    entries.push({ kind: 'margin', startsAt: cursor, endsAt: segment.end })
  }

  return entries
}

type Fill = { deepCount: number; shortCount: number; focusMs: Ms }

/**
 * How one free stretch gets filled. Not greedy: it enumerates every
 * `(deepCount, shortCount)` pair that fits and ranks them by policy.
 *
 * | stretch | `prefer-deep` (default) | `maximise-focus`  |
 * |---------|-------------------------|-------------------|
 * | 50 min  | 1 deep, 5 dead          | 1 deep, 5 dead    |
 * | 60 min  | 1 deep, **15 dead**     | 3 short, 0 dead   |
 * | 120 min | 2 deep + 1 short, 10    | **6 short**, 0    |
 *
 * `prefer-deep` is the default and should stay that way. `maximise-focus`
 * reliably wins on raw minutes, but it does so by almost never scheduling a
 * deep block at all — 20 divides more finely than 45, so a two-hour afternoon
 * becomes six short blocks. That is the opposite of what this app is for, and
 * it contradicts the original brief ("large if time is sufficient"). It was
 * built the other way round first and changed deliberately.
 *
 * The search space is `available / deepMinutes`, which is single digits, and
 * the zero-duration guards below mean nonsensical settings cannot hang it.
 */
export function bestFill(
  available: Ms,
  deepMs: Ms,
  shortMs: Ms,
  policy: Settings['plannerPolicy'],
): Fill {
  const empty: Fill = { deepCount: 0, shortCount: 0, focusMs: 0 }
  if (available <= 0) return empty

  // Nonsensical settings must not hang the planner or divide by zero.
  const canDeep = deepMs > 0
  const canShort = shortMs > 0
  if (!canDeep && !canShort) return empty

  const maxDeep = canDeep ? Math.floor(available / deepMs) : 0

  let best = empty
  for (let deepCount = 0; deepCount <= maxDeep; deepCount++) {
    const remaining = available - deepCount * deepMs
    const shortCount = canShort ? Math.floor(remaining / shortMs) : 0
    const candidate: Fill = {
      deepCount,
      shortCount,
      focusMs: deepCount * deepMs + shortCount * shortMs,
    }
    if (isBetterFill(candidate, best, policy)) best = candidate
  }

  return best
}

function isBetterFill(a: Fill, b: Fill, policy: Settings['plannerPolicy']): boolean {
  if (policy === 'prefer-deep') {
    // Longest blocks win; total focus time only breaks ties.
    if (a.deepCount !== b.deepCount) return a.deepCount > b.deepCount
    return a.focusMs > b.focusMs
  }
  // maximise-focus: waste as little of the stretch as possible, and when two
  // packings waste the same amount, take the one with deeper blocks.
  if (a.focusMs !== b.focusMs) return a.focusMs > b.focusMs
  return a.deepCount > b.deepCount
}

const toBreakInterval = (b: PlannedBreak): Interval => ({
  start: b.startsAt,
  end: b.startsAt + minutesToMs(b.durationMin),
})

/** Sort, then coalesce anything that touches or overlaps. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)

  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

/** `span` minus every interval in `busy`. Assumes `busy` is already merged. */
export function subtractIntervals(span: Interval, busy: readonly Interval[]): Interval[] {
  const free: Interval[] = []
  let cursor = span.start

  for (const interval of busy) {
    if (interval.end <= cursor) continue
    if (interval.start >= span.end) break
    if (interval.start > cursor) {
      free.push({ start: cursor, end: Math.min(interval.start, span.end) })
    }
    cursor = Math.max(cursor, interval.end)
    if (cursor >= span.end) break
  }

  if (cursor < span.end) free.push({ start: cursor, end: span.end })
  return free.filter((i) => i.end > i.start)
}

/**
 * What taking a break right now would cost, in blocks and focus minutes.
 *
 * The plan never schedules breaks, so the timeline always shows the maximum
 * focus available. That makes a break a visible trade, and the prompt should
 * say so before the user commits to a duration.
 */
export function breakCost(
  input: DerivePlanInput,
  breakStartsAt: Ms,
  durationMin: number,
  /**
   * The plan as it already stands. The caller usually has it — it is what is
   * on screen behind the prompt — and passing it saves deriving the same day
   * twice for every duration the user hovers over.
   */
  baseline: Timeline = derivePlan(input),
): { blocksLost: number; focusMinutesLost: number } {
  const withoutBreak = countPlannedFocus(baseline)
  const withBreak = countPlannedFocus(
    derivePlan({
      ...input,
      overrides: [
        ...input.overrides,
        { id: '__preview__', startsAt: breakStartsAt, durationMin },
      ],
    }),
  )

  return {
    blocksLost: Math.max(0, withoutBreak.blocks - withBreak.blocks),
    focusMinutesLost: Math.max(0, withoutBreak.minutes - withBreak.minutes),
  }
}

export function countPlannedFocus(timeline: Timeline): {
  blocks: number
  minutes: number
} {
  let blocks = 0
  let ms = 0
  for (const entry of timeline.entries) {
    if (entry.kind === 'planned-block') {
      blocks++
      ms += entry.endsAt - entry.startsAt
    }
  }
  return { blocks, minutes: Math.round(ms / 60_000) }
}
