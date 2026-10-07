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
 * A curated visual environment. Rooms keep colour, sound and scenery coherent.
 *
 * This tuple is both the union and the menu order. The palette, metadata,
 * scenery and persisted-input guard are exhaustive over the derived union, so
 * adding a room fails type-checking until its coordinated pieces exist.
 */
export const ROOM_IDS = ['mono', 'hearth', 'tide', 'fern'] as const

export type RoomId = (typeof ROOM_IDS)[number]

/**
 * Whether a value names a room this build actually has.
 *
 * Used only at an external-data boundary. Live events are type-safe, while an
 * imported JSON file can contain any string.
 */
export const isRoomId = (value: unknown): value is RoomId =>
  (ROOM_IDS as readonly unknown[]).includes(value)

/**
 * `room` follows the selected room's suggestion; the named sounds deliberately
 * remain available as overrides. `off` is the default so an update never starts
 * making noise in a session that used to be silent.
 */
export type AmbienceSelection = 'off' | 'room' | 'brown' | 'pink' | 'rain'

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
   * How long today's question — what are you working on today? — gives you
   * before it stops to ask whether you want longer. A timer on the question
   * rather than a block: it runs while the day is being set up, which is often
   * before working hours begin, and it records nothing. See `TodayPanel`. The
   * name is older than the question it now times, and is kept so a saved
   * setting still reads.
   */
  intentionMinutes: Minutes
  /**
   * The default daily shape. Mono plans inside these and nowhere else, and the
   * end of the last one is the planning horizon. Each day starts seeded from
   * this; editing a day's regions on the timeline overrides it for that day.
   */
  defaultRegions: DefaultRegion[]
  plannerPolicy: PlannerPolicy
  notificationsEnabled: boolean
  soundEnabled: boolean
  roomId: RoomId
  ambience: AmbienceSelection
  /** Linear UI value. The audio engine squares it before applying gain. */
  ambienceVolume: number
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
  /**
   * Open the same window when a question's own timer starts: today's
   * question's, and the purpose prompt's few minutes to decide.
   *
   * Its own setting rather than a second reading of `popOutOnStart`, because
   * the two moments differ. A block starting is the last click before the user
   * leaves; a question's timer starts while they are still answering it in the
   * tab, where a window arriving can take the focus off the field. Deciding is
   * also the stretch most likely to drift, which is the argument for having it
   * on, and the same reason the default is on. Gesture-bound in the same way.
   */
  popOutOnDecide: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  deepMinutes: 45,
  shortMinutes: 20,
  reflectMinutes: 5,
  intentionMinutes: 5,
  defaultRegions: [{ start: '09:00', end: '18:00' }],
  plannerPolicy: 'prefer-deep',
  notificationsEnabled: false,
  soundEnabled: true,
  roomId: 'mono',
  ambience: 'off',
  ambienceVolume: 0.35,
  popOutOnStart: true,
  popOutOnDecide: true,
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
  /**
   * The series this is one day of, when it came from one. Present on an
   * occurrence derived from a `RecurringCommitment`, and kept on the day's own
   * copy once that occurrence has been edited, so the day still knows it is a
   * standup that repeats rather than a one-off that happens to share its name.
   * Absent on everything typed into the day by hand.
   */
  recurringId?: string
}

/**
 * Fields an edit may change; identity belongs to the event's target id, and
 * which series a commitment came from is part of its identity too.
 */
export type CommitmentPatch = Partial<Omit<Commitment, 'id' | 'recurringId'>>

/** A day of the week, in `Date#getDay` order: Sunday is 0. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * How often a series comes round. Deliberately three shapes and no more — see
 * `recurrence.ts` for what each means and why nothing like an RRULE is here.
 *
 * `interval` is "every N": 1 is every day, week or month, 2 is every other.
 * Weeks are counted from the week the series starts in, and a monthly date
 * past the end of a short month falls on that month's last day.
 */
export type Repeat =
  | { every: 'day'; interval: number }
  | { every: 'week'; interval: number; weekdays: Weekday[] }
  | { every: 'month'; interval: number; monthDay: number }

/**
 * A commitment that comes round on a schedule: the standup every weekday, the
 * swim every Tuesday and Thursday.
 *
 * It is the rule, not the days. Nothing about any particular day is stored
 * here, for the reason today's hours are not stored as a copy of the default
 * shape: each day's occurrence is *derived* from the rule, so changing the
 * rule reshapes every day that has not been changed by hand, today included.
 * See `commitmentsFor` in `events.ts`.
 *
 * The time is wall clock ("09:00") rather than an instant, and the dates are
 * local calendar days ("2026-08-20"), for the same reason a `DefaultRegion`
 * is: a standup at nine is at nine on both sides of a DST shift. `endsOn` is
 * the last day it can happen, inclusive; absent means it does not end.
 */
export type RecurringCommitment = {
  id: string
  title: string
  time: string
  durationMin: Minutes
  prepMin?: Minutes
  recoverMin?: Minutes
  repeat: Repeat
  startsOn: string
  endsOn?: string
}

/**
 * Fields an edit may change. Merged like every other patch, so clearing an
 * end date or a margin is said rather than left out — see `readRecurringEdit`.
 * `endsOn: null` is that saying for the one field that can be absent.
 */
export type RecurringPatch = Partial<Omit<RecurringCommitment, 'id' | 'endsOn'>> & {
  endsOn?: string | null
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

/** Fields an edit may change; identity belongs to the event's target id. */
export type PlannedBreakPatch = Partial<Omit<PlannedBreak, 'id'>>

// -----------------------------------------------------------------------------
// Intentions
// -----------------------------------------------------------------------------

/**
 * A name for some of today's tasks: "handle the billing ticket", "the login
 * pages".
 *
 * Optional, and given after the tasks rather than before them. The day is
 * answered by choosing its tasks; an intention gathers some of them under one
 * name, and can be narrower than an outcome or broader than an epic — whatever
 * the day needs that the backlog's own places do not already say. Written
 * first, with nothing scoped yet, it came out as the name of an epic the
 * backlog already had. An intention belongs to one day, which is why it lives
 * in the event log with the rest of the day's decisions and is cleared at
 * midnight, while the tasks it gathers live on in the backlog.
 *
 * What it is about is its tasks, carried into it by `intention/taskLinked`
 * and shown under the places they live in. It once also pointed at one area,
 * epic or outcome; that was a second answer to where its tasks live, which
 * went stale whenever a task was moved or linked from elsewhere, and the log
 * reader leaves it behind in older logs.
 *
 * `done` is the user's word that the day has had what it wanted from this
 * intention. It is said by hand and never derived from the tasks: an intention
 * can be met with tasks still open under it, or have every task ticked and
 * still not be met. Saying so writes nothing to those tasks, as finishing an
 * epic writes nothing inside it. Absent in logs written before it existed,
 * which reads as not done.
 */
export type Intention = {
  id: string
  title: string
  done?: boolean
}

/**
 * Fields an edit may change. A patch is merged, and with
 * `exactOptionalPropertyTypes` an absent field can only mean "leave it" — so
 * reopening an intention sends `done: false` rather than leaving `done` out.
 */
export type IntentionPatch = { title?: string; done?: boolean }

// -----------------------------------------------------------------------------
// Session history and active work
// -----------------------------------------------------------------------------

/**
 * A line written while a block ran: how it is going, what got in the way, what
 * just worked. The interface calls it a log; the code calls it a note, because
 * "the log" already means the event log this lives in, and a reader meeting
 * `logs` beside `events` would reasonably think they were the same thing.
 *
 * `at` is the minute it was written and stays that minute when the text is
 * corrected — the calendar draws it there, and a fixed typo did not happen
 * later than the thought it fixed. The id is what lets an edit or a delete name
 * one note among several written in the same minute.
 */
export type BlockNote = { id: string; at: Ms; text: string }

/**
 * A block or break that has finished. History is append-only, with one
 * exception that is itself an event: a block's notes can be corrected after it
 * ends (`block/noteEdited`, `block/noteRemoved`). The history is still a fold
 * over the log; the correction is simply part of what is folded.
 */
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
      result: 'completed' | 'abandoned'
      /** The tasks it was for. Empty for a priorities block, and for old logs. */
      taskIds: string[]
      /** What was written during it, oldest first. Empty for old logs. */
      notes: BlockNote[]
      /**
       * Each moment the user counted wanting to leave the task, oldest first.
       * Instants rather than a number so the calendar can put each where it
       * happened; the count is the length, folded from events like everything
       * else, never a counter incremented in place.
       */
      urges: Ms[]
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
      /** The tasks it is for. Empty only for a priorities block. */
      taskIds: string[]
      /** Written so far, oldest first. See `CompletedSegment`. */
      notes: BlockNote[]
      /** Counted so far, oldest first. See `CompletedSegment`. */
      urges: Ms[]
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
