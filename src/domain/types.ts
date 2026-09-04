/**
 * Core domain vocabulary for Mono.
 *
 * Two rules hold everywhere in this folder:
 *  - Time is epoch milliseconds (`Ms`). Wall-clock strings only ever appear in
 *    settings the user typed ("18:00") and are resolved against a local
 *    calendar day at the edge, in `time.ts`.
 *  - Nothing here reads the clock. `now` is always passed in, so every
 *    function stays pure and testable.
 */

// -----------------------------------------------------------------------------
// Time and planner vocabulary
// -----------------------------------------------------------------------------

/** Epoch milliseconds. */
export type Ms = number

/** Minutes, as authored by the user in settings. */
export type Minutes = number

export type BlockKind = 'deep' | 'short' | 'reflect'

/**
 * How the planner chooses between packing more total focus time into a free
 * segment versus favouring longer, deeper blocks. See `planner.ts`.
 *
 * `prefer-deep` is the default. `maximise-focus` reliably wins on raw minutes,
 * but with 45/20 defaults it does so by never scheduling a deep block at all —
 * a two-hour stretch becomes six short blocks. That is the opposite of what
 * this app is for, so filling time is the opt-in, not the default.
 */
export type PlannerPolicy = 'prefer-deep' | 'maximise-focus'

/**
 * A recurring stretch of the day the user is willing to work in, as local wall
 * clock ("09:00"). Stored as strings rather than minutes-from-midnight so they
 * resolve through the local calendar and stay correct across a DST shift.
 *
 * `end` must be after `start`: a region never wraps past midnight, because the
 * plan is scoped to a calendar day.
 */
export type DefaultRegion = { start: string; end: string }

/** A work region resolved onto a specific day. */
export type WorkRegion = { id: string; startsAt: Ms; endsAt: Ms }

// -----------------------------------------------------------------------------
// User settings
// -----------------------------------------------------------------------------

export type Settings = {
  deepMinutes: Minutes
  shortMinutes: Minutes
  reflectMinutes: Minutes
  /**
   * The default daily shape. Mono plans inside these and nowhere else, and the
   * end of the last one is the planning horizon. Each day starts seeded from
   * this; editing a day's regions on the timeline overrides it for that day.
   */
  defaultRegions: DefaultRegion[]
  plannerPolicy: PlannerPolicy
  notificationsEnabled: boolean
  soundEnabled: boolean
  /**
   * Open the always-on-top window by itself when a block begins running.
   *
   * On by default, which is the one place Mono opens something you did not
   * click. The argument for it is the app's own: a focus block is time you
   * spend somewhere else, and a timer that is ambiently present is what makes
   * that time feel like a block rather than an unmarked stretch of afternoon.
   *
   * It can only ever fire from the click that starts the block — a window
   * cannot be requested without a user gesture — so this is a preference about
   * a moment that already exists, not a licence to appear at any time. Browsers
   * without the API ignore it entirely.
   */
  popOutOnStart: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  deepMinutes: 45,
  shortMinutes: 20,
  reflectMinutes: 5,
  defaultRegions: [{ start: '09:00', end: '18:00' }],
  plannerPolicy: 'prefer-deep',
  notificationsEnabled: false,
  soundEnabled: true,
  popOutOnStart: true,
}

// -----------------------------------------------------------------------------
// Fixed items in the day
// -----------------------------------------------------------------------------

/**
 * Something already fixed in the day.
 *
 * `startsAt` and `durationMin` describe the thing itself — the hour in the
 * pool, the half hour on the call. `prepMin` and `recoverMin` describe what it
 * costs either side of that: getting changed and travelling there, then
 * travelling back and being fit for anything afterwards. A 4pm swim is an hour
 * long and eats two, and a planner that only knew about the hour would offer a
 * focus block at 3:40 that the user was never going to be at their desk for.
 *
 * Both are optional because logs written before they existed do not have them.
 * Read them through `commitmentSpan` rather than directly, so the `?? 0` lives
 * in one place.
 */
export type Commitment = {
  id: string
  title: string
  startsAt: Ms
  durationMin: Minutes
  /** Getting ready and getting there, before `startsAt`. */
  prepMin?: Minutes
  /** Getting back and settling, after it ends. */
  recoverMin?: Minutes
}

/**
 * A break the user pinned onto the timeline. Breaks are never planned
 * automatically — the derived plan shows maximum available focus, and the user
 * spends it deliberately.
 */
export type PlannedBreak = {
  id: string
  startsAt: Ms
  durationMin: Minutes
}

// -----------------------------------------------------------------------------
// Session history and active work
// -----------------------------------------------------------------------------

/** A block or break that has finished. History is append-only and immutable. */
export type CompletedSegment =
  | {
      kind: 'block'
      id: string
      blockKind: BlockKind
      purpose: string | null
      startedAt: Ms
      /** When it actually ended, which is not always `plannedEndsAt`. */
      endedAt: Ms
      plannedEndsAt: Ms
      outcome: 'completed' | 'abandoned'
    }
  | {
      kind: 'break'
      id: string
      startedAt: Ms
      endedAt: Ms
      plannedEndsAt: Ms
    }
  | {
      /** Time that passed while the app was asleep or the user was away. */
      kind: 'away'
      id: string
      startedAt: Ms
      endedAt: Ms
    }

/** The single running block or break. At most one exists at a time. */
export type ActiveSegment =
  | {
      kind: 'block'
      id: string
      blockKind: BlockKind
      purpose: string | null
      startedAt: Ms
      endsAt: Ms
    }
  | {
      kind: 'break'
      id: string
      startedAt: Ms
      endsAt: Ms
    }

// -----------------------------------------------------------------------------
// Derived timeline
// -----------------------------------------------------------------------------

/**
 * An entry in the derived timeline. Past entries come from history, `active`
 * is the running one, and everything after it is recomputed from scratch on
 * every derive — see `planner.ts`.
 */
export type TimelineEntry =
  | { kind: 'past'; segment: CompletedSegment; startsAt: Ms; endsAt: Ms }
  | { kind: 'active'; segment: ActiveSegment; startsAt: Ms; endsAt: Ms }
  | {
      kind: 'planned-block'
      id: string
      blockKind: BlockKind
      startsAt: Ms
      endsAt: Ms
    }
  | { kind: 'planned-break'; id: string; startsAt: Ms; endsAt: Ms }
  | { kind: 'commitment'; commitment: Commitment; startsAt: Ms; endsAt: Ms }
  /**
   * The getting-ready or getting-back time around a commitment. Its own entry
   * rather than a longer commitment, so the calendar can draw the difference
   * between the hour you are swimming and the half hour you are in the car.
   */
  | {
      kind: 'commitment-margin'
      commitment: Commitment
      side: 'before' | 'after'
      startsAt: Ms
      endsAt: Ms
    }
  /** Un-fillable remainder. Always shorter than the shortest block. */
  | { kind: 'margin'; startsAt: Ms; endsAt: Ms }

export type Timeline = {
  /** The instant this plan was derived for. */
  now: Ms
  /**
   * End of the last work region. Nothing is ever planned past this, and with
   * no regions at all it equals `now` — an empty day rather than a guess.
   */
  horizon: Ms
  /** Today's work regions, merged and sorted. The positive space of the plan. */
  regions: Interval[]
  entries: TimelineEntry[]
}

/** A half-open interval `[start, end)`. */
export type Interval = { start: Ms; end: Ms }

// -----------------------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------------------

export const MINUTE_MS = 60_000

export const minutesToMs = (m: Minutes): Ms => m * MINUTE_MS

/** The commitment itself, without the time it costs either side. */
export const commitmentEvent = (c: Commitment): Interval => ({
  start: c.startsAt,
  end: c.startsAt + minutesToMs(c.durationMin),
})

/**
 * Everything the commitment takes out of the day, getting there and back
 * included. This is the interval the planner must not schedule into, and the
 * one that decides whether a commitment is still ahead of us.
 */
export const commitmentSpan = (c: Commitment): Interval => ({
  start: c.startsAt - minutesToMs(c.prepMin ?? 0),
  end: c.startsAt + minutesToMs(c.durationMin + (c.recoverMin ?? 0)),
})

/** The stretch of the day a pinned break reserves. */
export const breakSpan = (b: PlannedBreak): Interval => ({
  start: b.startsAt,
  end: b.startsAt + minutesToMs(b.durationMin),
})

/**
 * Do these two stretches want any of the same minutes?
 *
 * Half-open, like `Interval` says: a thing ending at ten and a thing starting
 * at ten are clear of each other, not touching. That is what makes a break
 * pinned to the minute a meeting ends legal, and it should be — the whole
 * reason to care about an overlap is time that cannot be spent twice.
 */
export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start < b.end && b.start < a.end
