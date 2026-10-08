/**
 * Reading data Mono did not just write.
 *
 * Two sources land here, and neither can be trusted the way the live event log
 * can: a persisted blob from an older schema, and a JSON file the user picked
 * off disk. Both end up in `replay`, which walks a discriminated union — so
 * anything malformed that gets that far is a crash, or worse a session that
 * looks fine and computes nonsense.
 *
 * This lives outside `session.ts` because it is a different job. The store
 * holds state; this decides what is allowed to become state.
 *
 * The answer is always the same shape: drop what cannot be understood, keep
 * what can, and throw only for a file that is not a Mono export at all. The
 * user is trying to recover their history, and most of it beats an error.
 */

import { reduce, replay, type MonoEvent, type SessionState } from '@/domain/events'
import {
  backlogProblem,
  isVersion,
  ITEM_KINDS,
  ITEM_STATUSES,
  type Area,
  type Item,
} from '@/domain/tasks'
import type { Later } from '@/domain/later'
import { isDayKey, isWallClock } from '@/domain/recurrence'
import { dayKey, isInstant } from '@/domain/time'
import {
  isRoomId,
  type Commitment,
  type CommitmentPatch,
  type Intention,
  type IntentionPatch,
  type Ms,
  type PlannedBreak,
  type PlannedBreakPatch,
  type RecurringCommitment,
  type RecurringPatch,
  type Repeat,
  type Settings,
  type Weekday,
  type WorkRegion,
} from '@/domain/types'

/** What `localStorage` holds, and what an export wraps with its version. */
export type PersistedShape = { events: MonoEvent[]; dayKey: string | null }

/**
 * The backlog, as an export carries it. Tombstones included. Later since v8;
 * a file without it imports as having nothing put down for later (see
 * `BacklogReplacement`).
 */
export type ExportedBacklog = { areas: Area[]; items: Item[]; later?: Later[] }

/**
 * An export: the log, and since v4 the backlog beside it.
 *
 * The backlog is optional because a v3 file has none, and importing one must
 * leave the backlog alone rather than empty it — a file from before tasks
 * existed says nothing about them, which is not the same as saying there are
 * none.
 */
export type ExportedShape = PersistedShape & { version: number; tasks?: ExportedBacklog }

/**
 * The schema the event log and its exports are written in. Every bump needs a
 * branch in `migratePersisted`, or the fall-through at the bottom of it
 * discards the logs of everyone upgrading.
 *
 * v4 changed no existing event. It added the intention events and an optional
 * `taskIds` on `block/started`, and an export gained the backlog. The bump is
 * for the build that cannot read those: a v3 build would import a v4 file,
 * silently drop every task in it, and look as though it had worked. A version
 * it refuses is the honest answer.
 *
 * v5 added the `today/` events: a day is now answered by the tasks chosen for
 * it, and an intention only groups some of them. A v4 build would drop those
 * events and read a v5 day as having chosen nothing, which is the silent loss
 * again, so it is a bump. No existing event changed shape; an intention gained
 * an optional `done`, which reads as not done where it is absent. A v4 log
 * reads as it was written, its linked tasks becoming today's because linking
 * now implies choosing.
 *
 * v6 added what is written into a running block: its logs and urges, and the
 * corrections to a log. A v5 build would drop all of them and read the day as
 * though nothing had been written, so it is a bump for the same reason. No
 * existing event changed; a block from an older log simply has none of either.
 *
 * v7 added the `recurring/` events: commitments that come round on a
 * schedule. A v6 build would drop them and read a day with a standup every
 * morning as a day with nothing fixed, so it is a bump. No existing event
 * changed shape; a commitment gained an optional `recurringId`, absent on
 * everything written before series existed.
 *
 * v8 is the first bump to rename events: a block's log was written as
 * `block/noted`, `block/noteEdited` and `block/noteRemoved` with a `noteId`,
 * and is now `block/logged`, `block/logEdited` and `block/logRemoved` with a
 * `logId`. Older names are read on every path, whatever the version stamped
 * beside them (`renameLegacyLogEvent`), since no newer event can carry them.
 * An export's backlog also gained what was put down for later, which a v7
 * build would drop without a word.
 */
export const SCHEMA_VERSION = 8

/**
 * Read an export. Throws only when the file is not a Mono export, or comes
 * from a version this build cannot understand.
 */
export function readImport(
  json: string,
  now: Ms,
): {
  events: MonoEvent[]
  session: SessionState
  dayKey: string
  /** Null when the file carries no backlog, which means "leave it as it is". */
  tasks: ExportedBacklog | null
} {
  const parsed: unknown = JSON.parse(json)
  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    throw new Error('Not a Mono export: expected an "events" array.')
  }

  // An export carries the schema it was written under, and the import used to
  // ignore it: a v1 file replayed straight would quietly reinstate `dayEndsAt`
  // settings that mean nothing any more, leaving the day with no working hours
  // and no explanation.
  const version = typeof parsed.version === 'number' ? parsed.version : SCHEMA_VERSION
  if (version > SCHEMA_VERSION) {
    throw new Error('That file was exported by a newer version of Mono.')
  }

  const stampedDayKey = typeof parsed.dayKey === 'string' ? parsed.dayKey : null

  const raw = parsed.events.filter(isEventShaped)
  // Only a v1 file has `dayEndsAt` to rewrite. Every later version is read as
  // it is: no later bump changed an existing event's shape, and v8's renames
  // are read by `sanitiseImportedEvent` under either name.
  const migrated = version < 2 ? raw.map(migrateDayEndsAt) : raw
  const events = migrated.map(sanitiseImportedEvent).filter(isPresent)

  return {
    ...normaliseImportedEvents(events, stampedDayKey, now),
    tasks: 'tasks' in parsed ? sanitiseBacklog(parsed.tasks) : null,
  }
}

/** An export, read and checked, not yet applied to anything. */
export type ImportedFile = ReturnType<typeof readImport>

/**
 * Bring a persisted blob up to the current schema.
 *
 * Note the day marker on the v1 branch: such a blob is very likely yesterday's
 * or older, and handing back `null` tells `checkDayRollover` this was a first
 * run — skipping the reset, and letting an old day's commitments and hours
 * through into this one.
 */
export function migratePersisted(persisted: unknown, from: number): PersistedShape {
  // Every bump since v3 only added things, or renamed events that
  // `sanitiseImportedEvent` reads under either name, so any of those logs is
  // read exactly as a current one. This branch is the whole migration, and
  // without it the fall-through below would throw every existing log away on
  // upgrade.
  if (
    (from === SCHEMA_VERSION ||
      from === 7 ||
      from === 6 ||
      from === 5 ||
      from === 4 ||
      from === 3) &&
    isPersisted(persisted)
  ) {
    return {
      events: persisted.events
        .filter(isEventShaped)
        .map(sanitiseImportedEvent)
        .filter(isPresent),
      dayKey: typeof persisted.dayKey === 'string' ? persisted.dayKey : null,
    }
  }

  // v1 -> v2: a single `dayEndsAt` became a list of work regions. The faithful
  // translation is one region running from the default start to whatever end
  // time the user had chosen.
  if (from === 1 && isPersisted(persisted)) {
    const events = persisted.events
      .filter(isEventShaped)
      .map(migrateDayEndsAt)
      .map(sanitiseImportedEvent)
      .filter(isPresent)
    return { events, dayKey: persisted.dayKey ?? inferDayKey(events) }
  }

  // v2 contained the pre-release `ember` and `moss` room ids. There is no
  // shipped data to migrate, so start developer browsers clean rather than
  // carrying compatibility aliases into the room model.
  if (from === 2) return { events: [], dayKey: null }

  // Anything older or unreadable is discarded rather than crashing on boot.
  return { events: [], dayKey: null }
}

function isPersisted(v: unknown): v is PersistedShape {
  return isRecord(v) && Array.isArray(v.events)
}

/**
 * Put an imported log into the right day.
 *
 * A file exported yesterday carries yesterday's commitments, pinned breaks and
 * one-off hours. Importing it used to drop the day marker on the floor, and
 * `checkDayRollover` reads a null marker as "first run" — so none of that was
 * cleared, and yesterday's shape silently became today's. The fix is to run
 * the same `day/reset` the app runs at midnight, under the same rule: never
 * across a running segment.
 */
export function normaliseImportedEvents(
  events: MonoEvent[],
  importedDayKey: string | null,
  now: Ms,
): { events: MonoEvent[]; session: SessionState; dayKey: string } {
  let nextEvents = events
  let session = replay(nextEvents)

  const today = dayKey(now)
  const storedDayKey = importedDayKey ?? inferDayKey(nextEvents)

  if (storedDayKey !== null && storedDayKey !== today && !session.active) {
    const reset: MonoEvent = { type: 'day/reset', at: now }
    nextEvents = [...nextEvents, reset]
    session = reduce(session, reset)
    return { events: nextEvents, session, dayKey: today }
  }

  return { events: nextEvents, session, dayKey: storedDayKey ?? today }
}

/** Which day a log belongs to, for a file or a blob that does not say. */
export const inferDayKey = (events: readonly MonoEvent[]): string | null => {
  const latestAt = events.reduce<number | null>(
    (latest, event) => (latest === null || event.at > latest ? event.at : latest),
    null,
  )
  return latestAt === null ? null : dayKey(latestAt)
}

/**
 * The shape every event has, whatever its type. Enough to hand to `reduce`,
 * which ignores types it does not recognise — an imported file is data from
 * outside, so it is filtered rather than trusted.
 *
 * `at` has to be an instant a date can hold, not merely a number. Replay reads
 * the local day from it — the history's days, and since recurring commitments
 * the day a series is asked about — and `1e20` is a finite number that no
 * `Date` can format, so one such event threw out of rehydration and left the
 * app on an empty session. Every other instant in an event, and in an
 * exported backlog, is held to the same rule (`sanitiseInstant`).
 */
const isEventShaped = (v: unknown): v is MonoEvent =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as MonoEvent).type === 'string' &&
  isInstant((v as MonoEvent).at)

const isPresent = <T,>(value: T | null): value is T => value !== null

const LEGACY_LOG_EVENTS: Readonly<Record<string, MonoEvent['type']>> = {
  'block/noted': 'block/logged',
  'block/noteEdited': 'block/logEdited',
  'block/noteRemoved': 'block/logRemoved',
}

/**
 * A block's log under the names it was written with before v8, read as the
 * event it now is. Not gated on a version: a hand-edited file or a blob from a
 * tab still running an older build can stamp anything, and no current event
 * can carry these names, so rewriting them is never wrong. Without it they
 * would fall through `sanitiseImportedEvent` as unknown types, and a day's
 * logs would vanish on the upgrade.
 */
function renameLegacyLogEvent(event: MonoEvent): MonoEvent {
  const { type, noteId, ...rest } = event as unknown as Record<string, unknown>
  const renamed = LEGACY_LOG_EVENTS[type as string]
  if (renamed === undefined) return event
  return {
    ...rest,
    type: renamed,
    ...(noteId === undefined ? {} : { logId: noteId }),
  } as unknown as MonoEvent
}

function sanitiseImportedEvent(input: MonoEvent): MonoEvent | null {
  const event = renameLegacyLogEvent(input)
  const raw = event as Record<string, unknown>
  switch (event.type) {
    case 'settings/changed': {
      const patch = sanitiseSettingsPatch(raw.patch)
      return patch === null ? null : { type: event.type, at: event.at, patch }
    }

    case 'commitment/added': {
      const commitment = sanitiseCommitment(raw.commitment)
      return commitment === null ? null : { type: event.type, at: event.at, commitment }
    }

    case 'commitment/updated': {
      const id = sanitiseString(raw.id)
      const patch = sanitiseCommitmentPatch(raw.patch)
      return id === null || patch === null ? null : { type: event.type, at: event.at, id, patch }
    }

    case 'commitment/removed': {
      const id = sanitiseString(raw.id)
      return id === null ? null : { type: event.type, at: event.at, id }
    }

    case 'region/set': {
      const regions = sanitiseRegions(raw.regions)
      return regions === null ? null : { type: event.type, at: event.at, regions }
    }

    case 'break/planned': {
      const plannedBreak = sanitisePlannedBreak(raw.plannedBreak)
      return plannedBreak === null ? null : { type: event.type, at: event.at, plannedBreak }
    }

    case 'break/updated': {
      const id = sanitiseString(raw.id)
      const patch = sanitiseBreakPatch(raw.patch)
      return id === null || patch === null ? null : { type: event.type, at: event.at, id, patch }
    }

    case 'break/removed': {
      const id = sanitiseString(raw.id)
      return id === null ? null : { type: event.type, at: event.at, id }
    }

    case 'block/started': {
      const id = sanitiseString(raw.id)
      const blockKind = sanitiseBlockKind(raw.blockKind)
      const endsAt = sanitiseInstant(raw.endsAt)
      const purpose = sanitiseNullableString(raw.purpose)
      if (id === null || blockKind === null || endsAt === null || purpose === undefined) {
        return null
      }
      // Lenient where the rest of this file is strict, and on purpose: dropping
      // a `block/started` because one task id was unreadable would lose the
      // block itself and strand the `block/completed` after it. A block whose
      // tasks cannot be read is still a block that happened.
      const taskIds = Array.isArray(raw.taskIds)
        ? raw.taskIds.filter((t): t is string => typeof t === 'string')
        : undefined
      return {
        type: event.type,
        at: event.at,
        id,
        blockKind,
        endsAt,
        purpose,
        ...(taskIds === undefined ? {} : { taskIds }),
      }
    }

    case 'block/purposeSet': {
      const purpose = sanitiseString(raw.purpose)
      return purpose === null ? null : { type: event.type, at: event.at, purpose }
    }

    case 'block/logged': {
      const id = sanitiseString(raw.id)
      const text = sanitiseText(raw.text)
      return id === null || text === null ? null : { type: event.type, at: event.at, id, text }
    }

    case 'block/logEdited': {
      const blockId = sanitiseString(raw.blockId)
      const logId = sanitiseString(raw.logId)
      const text = sanitiseText(raw.text)
      return blockId === null || logId === null || text === null
        ? null
        : { type: event.type, at: event.at, blockId, logId, text }
    }

    case 'block/logRemoved': {
      const blockId = sanitiseString(raw.blockId)
      const logId = sanitiseString(raw.logId)
      return blockId === null || logId === null
        ? null
        : { type: event.type, at: event.at, blockId, logId }
    }

    case 'block/urged':
    case 'block/urgeTakenBack':
    case 'block/completed':
    case 'block/abandoned':
    case 'break/ended':
    case 'day/reset':
    case 'day/shaped':
      return { type: event.type, at: event.at }

    case 'break/started': {
      const id = sanitiseString(raw.id)
      const endsAt = sanitiseInstant(raw.endsAt)
      return id === null || endsAt === null ? null : { type: event.type, at: event.at, id, endsAt }
    }

    case 'away/recorded': {
      const from = sanitiseInstant(raw.from)
      const to = sanitiseInstant(raw.to)
      return from === null || to === null ? null : { type: event.type, at: event.at, from, to }
    }

    case 'intention/added': {
      const intention = sanitiseIntention(raw.intention)
      return intention === null ? null : { type: event.type, at: event.at, intention }
    }

    case 'intention/updated': {
      const id = sanitiseString(raw.id)
      const patch = sanitiseIntentionPatch(raw.patch)
      return id === null || patch === null ? null : { type: event.type, at: event.at, id, patch }
    }

    case 'intention/removed': {
      const id = sanitiseString(raw.id)
      return id === null ? null : { type: event.type, at: event.at, id }
    }

    case 'intention/taskLinked': {
      const taskId = sanitiseString(raw.taskId)
      const intentionId = sanitiseNullableString(raw.intentionId)
      return taskId === null || intentionId === undefined
        ? null
        : { type: event.type, at: event.at, taskId, intentionId }
    }

    case 'today/taskAdded':
    case 'today/taskRemoved': {
      const taskId = sanitiseString(raw.taskId)
      return taskId === null ? null : { type: event.type, at: event.at, taskId }
    }

    case 'recurring/added': {
      const rule = sanitiseRecurring(raw.rule)
      return rule === null ? null : { type: event.type, at: event.at, rule }
    }

    case 'recurring/updated': {
      const id = sanitiseString(raw.id)
      const patch = sanitiseRecurringPatch(raw.patch)
      return id === null || patch === null ? null : { type: event.type, at: event.at, id, patch }
    }

    case 'recurring/removed': {
      const id = sanitiseString(raw.id)
      return id === null ? null : { type: event.type, at: event.at, id }
    }
  }

  // Unreachable for the types above: the `never` is what makes adding an event
  // type without sanitising it a compile error. Reachable at runtime for a
  // `type` this build has never heard of, which a file from outside is free to
  // contain — another build's event, or a hand edit. Falling out of the switch
  // instead returned `undefined`, which passed the `isPresent` filter below and
  // crashed `replay` reading `.type` off it.
  const unknown: never = event
  void unknown
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const sanitiseNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** An instant a `Date` can represent, so formatting it as a day cannot throw. */
const sanitiseInstant = (value: unknown): number | null => (isInstant(value) ? value : null)

const sanitisePositiveMinutes = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}

/**
 * A duration either side of a commitment: optional, and legitimately zero.
 *
 * Three answers rather than two, so a caller can tell "not there" from "there
 * and wrong". `undefined` means absent, which is the normal state of every
 * commitment written before this field existed; `null` means present and
 * unusable.
 */
const sanitiseMarginMinutes = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

const sanitiseString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

/** Words someone wrote: trimmed, and refused when nothing is left. */
const sanitiseText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const sanitiseNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined

const sanitiseBlockKind = (value: unknown): 'deep' | 'short' | 'reflect' | null =>
  value === 'deep' || value === 'short' || value === 'reflect' ? value : null

function sanitiseSettingsPatch(value: unknown): Partial<Settings> | null {
  if (!isRecord(value)) return null

  // Settings are independent preferences. Preserve every readable field in an
  // imported or recovered patch instead of losing it because one sibling is bad.
  const patch: Partial<Settings> = {}

  if ('deepMinutes' in value) {
    const deepMinutes = sanitisePositiveMinutes(value.deepMinutes)
    if (deepMinutes !== null) patch.deepMinutes = deepMinutes
  }
  if ('shortMinutes' in value) {
    const shortMinutes = sanitisePositiveMinutes(value.shortMinutes)
    if (shortMinutes !== null) patch.shortMinutes = shortMinutes
  }
  if ('reflectMinutes' in value) {
    const reflectMinutes = sanitisePositiveMinutes(value.reflectMinutes)
    if (reflectMinutes !== null) patch.reflectMinutes = reflectMinutes
  }
  if ('intentionMinutes' in value) {
    const intentionMinutes = sanitisePositiveMinutes(value.intentionMinutes)
    if (intentionMinutes !== null) patch.intentionMinutes = intentionMinutes
  }
  if ('defaultRegions' in value) {
    const defaultRegions = sanitiseDefaultRegions(value.defaultRegions)
    if (defaultRegions !== null) patch.defaultRegions = defaultRegions
  }
  if ('plannerPolicy' in value) {
    if (value.plannerPolicy === 'prefer-deep' || value.plannerPolicy === 'maximise-focus') {
      patch.plannerPolicy = value.plannerPolicy
    }
  }
  if ('notificationsEnabled' in value) {
    if (typeof value.notificationsEnabled === 'boolean') {
      patch.notificationsEnabled = value.notificationsEnabled
    }
  }
  if ('soundEnabled' in value) {
    if (typeof value.soundEnabled === 'boolean') patch.soundEnabled = value.soundEnabled
  }
  if ('roomId' in value) {
    if (isRoomId(value.roomId)) patch.roomId = value.roomId
  }
  if ('ambience' in value) {
    if (['off', 'room', 'brown', 'pink', 'rain'].includes(String(value.ambience))) {
      patch.ambience = value.ambience as Settings['ambience']
    }
  }
  if ('ambienceVolume' in value) {
    if (
      typeof value.ambienceVolume === 'number' &&
      Number.isFinite(value.ambienceVolume) &&
      value.ambienceVolume >= 0 &&
      value.ambienceVolume <= 1
    ) {
      patch.ambienceVolume = value.ambienceVolume
    }
  }
  // Absent from every log written before the mini window existed, which needs
  // no migration: a patch that was never appended cannot be replayed, so those
  // days simply fold to the default.
  if ('popOutOnStart' in value) {
    if (typeof value.popOutOnStart === 'boolean') patch.popOutOnStart = value.popOutOnStart
  }
  if ('popOutOnDecide' in value) {
    if (typeof value.popOutOnDecide === 'boolean') patch.popOutOnDecide = value.popOutOnDecide
  }

  return Object.keys(patch).length === 0 ? null : patch
}

function sanitiseCommitment(value: unknown): Commitment | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseString(value.title)
  const startsAt = sanitiseInstant(value.startsAt)
  const durationMin = sanitisePositiveMinutes(value.durationMin)
  if (id === null || title === null || startsAt === null || durationMin === null) {
    return null
  }

  // Absent is the ordinary case: every commitment written before these existed
  // has neither. Present but unreadable drops the commitment, like any other
  // malformed field — it would otherwise silently plan over the school run.
  const prepMin = sanitiseMarginMinutes(value.prepMin)
  const recoverMin = sanitiseMarginMinutes(value.recoverMin)
  if (prepMin === null || recoverMin === null) return null
  // Which series it came from only labels it, so an unreadable one costs the
  // label rather than the commitment.
  const recurringId = sanitiseString(value.recurringId)

  return {
    id,
    title,
    startsAt,
    durationMin,
    ...(prepMin === undefined ? {} : { prepMin }),
    ...(recoverMin === undefined ? {} : { recoverMin }),
    ...(recurringId === null ? {} : { recurringId }),
  }
}

/**
 * A series as the log holds one. Strict, like a commitment: a series whose
 * time, length or days cannot be read would put a meeting somewhere nobody
 * said, every day it matched, so it is dropped whole. An end date that cannot
 * be read is dropped with it rather than read as "never ends", which would be
 * the louder of the two mistakes.
 */
function sanitiseRecurring(value: unknown): RecurringCommitment | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseText(value.title)
  const time = sanitiseWallClock(value.time)
  const durationMin = sanitisePositiveMinutes(value.durationMin)
  const repeat = sanitiseRepeat(value.repeat)
  const startsOn = sanitiseDayKey(value.startsOn)
  if (
    id === null ||
    title === null ||
    time === null ||
    durationMin === null ||
    repeat === null ||
    startsOn === null
  ) {
    return null
  }
  const prepMin = sanitiseMarginMinutes(value.prepMin)
  const recoverMin = sanitiseMarginMinutes(value.recoverMin)
  const endsOn = value.endsOn === undefined ? undefined : sanitiseDayKey(value.endsOn)
  if (prepMin === null || recoverMin === null || endsOn === null) return null

  return {
    id,
    title,
    time,
    durationMin,
    ...(prepMin === undefined ? {} : { prepMin }),
    ...(recoverMin === undefined ? {} : { recoverMin }),
    repeat,
    startsOn,
    ...(endsOn === undefined ? {} : { endsOn }),
  }
}

/** An edit to a series. As with a commitment's, one bad field drops the edit. */
function sanitiseRecurringPatch(value: unknown): RecurringPatch | null {
  if (!isRecord(value)) return null

  const patch: RecurringPatch = {}
  if ('title' in value) {
    const title = sanitiseText(value.title)
    if (title === null) return null
    patch.title = title
  }
  if ('time' in value) {
    const time = sanitiseWallClock(value.time)
    if (time === null) return null
    patch.time = time
  }
  if ('durationMin' in value) {
    const durationMin = sanitisePositiveMinutes(value.durationMin)
    if (durationMin === null) return null
    patch.durationMin = durationMin
  }
  if ('prepMin' in value) {
    const prepMin = sanitiseMarginMinutes(value.prepMin)
    if (prepMin === null || prepMin === undefined) return null
    patch.prepMin = prepMin
  }
  if ('recoverMin' in value) {
    const recoverMin = sanitiseMarginMinutes(value.recoverMin)
    if (recoverMin === null || recoverMin === undefined) return null
    patch.recoverMin = recoverMin
  }
  if ('repeat' in value) {
    const repeat = sanitiseRepeat(value.repeat)
    if (repeat === null) return null
    patch.repeat = repeat
  }
  if ('startsOn' in value) {
    const startsOn = sanitiseDayKey(value.startsOn)
    if (startsOn === null) return null
    patch.startsOn = startsOn
  }
  if ('endsOn' in value) {
    // `null` is a real answer here: the series no longer ends.
    const endsOn = value.endsOn === null ? null : sanitiseDayKey(value.endsOn)
    if (endsOn === null && value.endsOn !== null) return null
    patch.endsOn = endsOn
  }

  return Object.keys(patch).length === 0 ? null : patch
}

function sanitiseRepeat(value: unknown): Repeat | null {
  if (!isRecord(value)) return null
  const interval = sanitisePositiveMinutes(value.interval)
  if (interval === null) return null

  switch (value.every) {
    case 'day':
      return { every: 'day', interval }
    case 'week': {
      if (!Array.isArray(value.weekdays)) return null
      const weekdays = [
        ...new Set(
          value.weekdays.filter(
            (d): d is Weekday => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
          ),
        ),
      ]
      // A weekly series on no day at all never happens, which is not a series.
      return weekdays.length === 0 ? null : { every: 'week', interval, weekdays }
    }
    case 'month': {
      const monthDay = value.monthDay
      if (typeof monthDay !== 'number' || !Number.isInteger(monthDay)) return null
      if (monthDay < 1 || monthDay > 31) return null
      return { every: 'month', interval, monthDay }
    }
    default:
      return null
  }
}

const sanitiseDayKey = (value: unknown): string | null =>
  typeof value === 'string' && isDayKey(value) ? value : null

const sanitiseWallClock = (value: unknown): string | null =>
  typeof value === 'string' && isWallClock(value) ? value : null

function sanitiseCommitmentPatch(value: unknown): CommitmentPatch | null {
  if (!isRecord(value)) return null

  const patch: CommitmentPatch = {}
  if ('title' in value) {
    const title = sanitiseString(value.title)
    if (title === null) return null
    patch.title = title
  }
  if ('startsAt' in value) {
    const startsAt = sanitiseInstant(value.startsAt)
    if (startsAt === null) return null
    patch.startsAt = startsAt
  }
  if ('durationMin' in value) {
    const durationMin = sanitisePositiveMinutes(value.durationMin)
    if (durationMin === null) return null
    patch.durationMin = durationMin
  }
  if ('prepMin' in value) {
    const prepMin = sanitiseMarginMinutes(value.prepMin)
    if (prepMin === null || prepMin === undefined) return null
    patch.prepMin = prepMin
  }
  if ('recoverMin' in value) {
    const recoverMin = sanitiseMarginMinutes(value.recoverMin)
    if (recoverMin === null || recoverMin === undefined) return null
    patch.recoverMin = recoverMin
  }

  return Object.keys(patch).length === 0 ? null : patch
}

function sanitiseBreakPatch(value: unknown): PlannedBreakPatch | null {
  if (!isRecord(value)) return null

  const patch: PlannedBreakPatch = {}
  if ('startsAt' in value) {
    const startsAt = sanitiseInstant(value.startsAt)
    if (startsAt === null) return null
    patch.startsAt = startsAt
  }
  if ('durationMin' in value) {
    const durationMin = sanitisePositiveMinutes(value.durationMin)
    if (durationMin === null) return null
    patch.durationMin = durationMin
  }

  return Object.keys(patch).length === 0 ? null : patch
}

function sanitisePlannedBreak(value: unknown): PlannedBreak | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const startsAt = sanitiseInstant(value.startsAt)
  const durationMin = sanitisePositiveMinutes(value.durationMin)
  return id === null || startsAt === null || durationMin === null
    ? null
    : { id, startsAt, durationMin }
}

function sanitiseRegions(value: unknown): WorkRegion[] | null {
  if (!Array.isArray(value)) return null

  const regions: WorkRegion[] = []
  for (const region of value) {
    if (!isRecord(region)) return null
    const id = sanitiseString(region.id)
    const startsAt = sanitiseInstant(region.startsAt)
    const endsAt = sanitiseInstant(region.endsAt)
    if (id === null || startsAt === null || endsAt === null) return null
    regions.push({ id, startsAt, endsAt })
  }
  return regions
}

function sanitiseDefaultRegions(value: unknown): Settings['defaultRegions'] | null {
  if (!Array.isArray(value)) return null

  const regions: Settings['defaultRegions'] = []
  for (const region of value) {
    if (!isRecord(region)) return null
    const start = sanitiseString(region.start)
    const end = sanitiseString(region.end)
    if (start === null || end === null) return null
    regions.push({ start, end })
  }
  return regions
}

/**
 * An intention as the log now holds one: an id, a title, and whether it has
 * been marked done. Older logs gave some a link to one area, epic or outcome;
 * it is left behind rather than read, since what an intention is about is now
 * its tasks (see `Intention`). A `done` that is not a boolean is left out,
 * which reads as not done, rather than costing the intention.
 */
function sanitiseIntention(value: unknown): Intention | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseString(value.title)
  if (id === null || title === null) return null
  return typeof value.done === 'boolean' ? { id, title, done: value.done } : { id, title }
}

/**
 * An edit: a rename, marking it done or reopening it, or both. Each field is
 * read on its own, so an unreadable one is dropped and the rest kept; an edit
 * left with nothing it can change — one that only moved an old link — edits
 * nothing.
 */
function sanitiseIntentionPatch(value: unknown): IntentionPatch | null {
  if (!isRecord(value)) return null
  const patch: IntentionPatch = {}
  if ('title' in value) {
    const title = sanitiseString(value.title)
    if (title !== null) patch.title = title
  }
  if (typeof value.done === 'boolean') patch.done = value.done
  return Object.keys(patch).length === 0 ? null : patch
}

/**
 * The backlog from an export, keeping every record that can be read.
 *
 * A file whose `tasks` is not even shaped like a backlog is treated as having
 * none, so the import leaves the current backlog alone rather than replacing it
 * with nothing.
 */
function sanitiseBacklog(value: unknown): ExportedBacklog | null {
  if (!isRecord(value) || !Array.isArray(value.areas) || !Array.isArray(value.items)) {
    return null
  }
  const backlog: ExportedBacklog = {
    areas: value.areas.map(sanitiseArea).filter(isPresent),
    items: value.items.map(sanitiseItem).filter(isPresent),
    // Nothing else refers to a Later, so one that cannot be read is dropped
    // on its own, and a list that is not one reads as none.
    ...(Array.isArray(value.later)
      ? { later: value.later.map(sanitiseLater).filter(isPresent) }
      : {}),
  }
  // Checked after the unreadable records are dropped, not before: a dropped
  // area or epic is exactly what would leave its children belonging to
  // nothing, and an import replaces the whole backlog with what is left.
  const problem = backlogProblem(backlog)
  if (problem !== null) {
    throw new Error(`The tasks in that file do not fit together — ${problem} — so nothing was imported.`)
  }
  return backlog
}

function sanitiseArea(value: unknown): Area | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const name = sanitiseString(value.name)
  const order = sanitiseNumber(value.order)
  const createdAt = sanitiseInstant(value.createdAt)
  const updatedAt = sanitiseVersion(value.updatedAt)
  const archivedAt = sanitiseOptionalInstant(value.archivedAt)
  const deletedAt = sanitiseOptionalInstant(value.deletedAt)
  if (
    id === null ||
    name === null ||
    order === null ||
    createdAt === null ||
    updatedAt === null ||
    archivedAt === null ||
    deletedAt === null
  ) {
    return null
  }
  return {
    id,
    name,
    order,
    createdAt,
    updatedAt,
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

function sanitiseItem(value: unknown): Item | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseString(value.title)
  const parentId = sanitiseString(value.parentId)
  const order = sanitiseNumber(value.order)
  const createdAt = sanitiseInstant(value.createdAt)
  const updatedAt = sanitiseVersion(value.updatedAt)
  const doneAt = sanitiseOptionalInstant(value.doneAt)
  const archivedAt = sanitiseOptionalInstant(value.archivedAt)
  const deletedAt = sanitiseOptionalInstant(value.deletedAt)
  const kind = ITEM_KINDS.find((k) => k === value.kind) ?? null
  const status = ITEM_STATUSES.find((s) => s === value.status) ?? null
  if (
    id === null ||
    title === null ||
    parentId === null ||
    order === null ||
    createdAt === null ||
    updatedAt === null ||
    doneAt === null ||
    archivedAt === null ||
    deletedAt === null ||
    kind === null ||
    status === null
  ) {
    return null
  }
  return {
    id,
    kind,
    title,
    parentId,
    status,
    order,
    createdAt,
    updatedAt,
    ...(doneAt === undefined ? {} : { doneAt }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

/**
 * Something put down for later. Where it came from is a nicety, so one that
 * cannot be read is left off rather than costing the record.
 */
function sanitiseLater(value: unknown): Later | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseText(value.title)
  const createdAt = sanitiseInstant(value.createdAt)
  const updatedAt = sanitiseVersion(value.updatedAt)
  const letGoAt = sanitiseOptionalInstant(value.letGoAt)
  const deletedAt = sanitiseOptionalInstant(value.deletedAt)
  if (
    id === null ||
    title === null ||
    createdAt === null ||
    updatedAt === null ||
    letGoAt === null ||
    deletedAt === null
  ) {
    return null
  }
  const source = isRecord(value.from) ? value.from : null
  const blockId = source && sanitiseString(source.blockId)
  const purpose = source && sanitiseString(source.purpose)
  return {
    id,
    title,
    createdAt,
    updatedAt,
    ...(blockId && purpose !== null ? { from: { blockId, purpose } } : {}),
    ...(letGoAt === undefined ? {} : { letGoAt }),
    ...(deletedAt === undefined ? {} : { deletedAt }),
  }
}

const sanitiseOptionalInstant = (value: unknown): number | null | undefined =>
  value === undefined ? undefined : sanitiseInstant(value)

/**
 * A record's version (`isVersion`): a whole number of milliseconds within the
 * range where each one and the next are exact. Past it, adding one changes
 * nothing, and two edits would carry the same version. Mono stamps versions
 * from the clock and `nextVersion` never leaves the range, so an export always
 * passes; only a damaged or edited file has one outside it, and the record is
 * dropped, like any other this cannot read.
 */
const sanitiseVersion = (value: unknown): number | null =>
  typeof value === 'number' && isVersion(value) ? value : null

/** Rewrite a v1 `dayEndsAt` settings patch into a v2 `defaultRegions` one. */
function migrateDayEndsAt(event: MonoEvent): MonoEvent {
  if (event.type !== 'settings/changed') return event

  const patch = (event as MonoEvent & { patch?: unknown }).patch
  if (!isRecord(patch)) return { ...event, patch: {} }

  const { dayEndsAt, ...rest } = patch as Record<string, unknown> & { dayEndsAt?: string }
  if (typeof dayEndsAt !== 'string') return event

  return {
    ...event,
    patch: { ...rest, defaultRegions: [{ start: '09:00', end: dayEndsAt }] } as Partial<Settings>,
  }
}
