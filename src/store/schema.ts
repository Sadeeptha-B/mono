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
import { dayKey } from '@/domain/time'
import type { Commitment, Ms, PlannedBreak, Settings, WorkRegion } from '@/domain/types'

/** What `localStorage` holds, and what an export wraps with its version. */
export type PersistedShape = { events: MonoEvent[]; dayKey: string | null }
export type ExportedShape = PersistedShape & { version: number }

/**
 * The schema the event log is written in. Bumped only when old logs need
 * rewriting, and every bump needs a branch in `migratePersisted`.
 */
export const SCHEMA_VERSION = 2

/**
 * Read an export. Throws only when the file is not a Mono export, or comes
 * from a version this build cannot understand.
 */
export function readImport(
  json: string,
  now: Ms,
): { events: MonoEvent[]; session: SessionState; dayKey: string } {
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
  const migrated = version < SCHEMA_VERSION ? raw.map(migrateDayEndsAt) : raw
  const events = migrated.map(sanitiseImportedEvent).filter(isPresent)

  return normaliseImportedEvents(events, stampedDayKey, now)
}

/**
 * Bring a persisted blob up to the current schema.
 *
 * Note the day marker on the v1 branch: such a blob is very likely yesterday's
 * or older, and handing back `null` tells `checkDayRollover` this was a first
 * run — skipping the reset, and letting an old day's commitments and hours
 * through into this one.
 */
export function migratePersisted(persisted: unknown, from: number): PersistedShape {
  if (from === SCHEMA_VERSION && isPersisted(persisted)) return persisted

  // v1 -> v2: a single `dayEndsAt` became a list of work regions. The faithful
  // translation is one region running from the default start to whatever end
  // time the user had chosen.
  if (from === 1 && isPersisted(persisted)) {
    const events = persisted.events.filter(isEventShaped).map(migrateDayEndsAt)
    return { events, dayKey: persisted.dayKey ?? inferDayKey(events) }
  }

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
 */
const isEventShaped = (v: unknown): v is MonoEvent =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as MonoEvent).type === 'string' &&
  typeof (v as MonoEvent).at === 'number'

const isPresent = <T,>(value: T | null): value is T => value !== null

function sanitiseImportedEvent(event: MonoEvent): MonoEvent | null {
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

    case 'break/removed': {
      const id = sanitiseString(raw.id)
      return id === null ? null : { type: event.type, at: event.at, id }
    }

    case 'block/started': {
      const id = sanitiseString(raw.id)
      const blockKind = sanitiseBlockKind(raw.blockKind)
      const endsAt = sanitiseNumber(raw.endsAt)
      const purpose = sanitiseNullableString(raw.purpose)
      return id === null || blockKind === null || endsAt === null || purpose === undefined
        ? null
        : { type: event.type, at: event.at, id, blockKind, endsAt, purpose }
    }

    case 'block/purposeSet': {
      const purpose = sanitiseString(raw.purpose)
      return purpose === null ? null : { type: event.type, at: event.at, purpose }
    }

    case 'block/completed':
    case 'block/abandoned':
    case 'break/ended':
    case 'day/reset':
      return { type: event.type, at: event.at }

    case 'break/started': {
      const id = sanitiseString(raw.id)
      const endsAt = sanitiseNumber(raw.endsAt)
      return id === null || endsAt === null ? null : { type: event.type, at: event.at, id, endsAt }
    }

    case 'away/recorded': {
      const from = sanitiseNumber(raw.from)
      const to = sanitiseNumber(raw.to)
      return from === null || to === null ? null : { type: event.type, at: event.at, from, to }
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

const sanitisePositiveMinutes = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}

const sanitiseString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const sanitiseNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined

const sanitiseBlockKind = (value: unknown): 'deep' | 'short' | 'reflect' | null =>
  value === 'deep' || value === 'short' || value === 'reflect' ? value : null

function sanitiseSettingsPatch(value: unknown): Partial<Settings> | null {
  if (!isRecord(value)) return null

  const patch: Partial<Settings> = {}

  if ('deepMinutes' in value) {
    const deepMinutes = sanitisePositiveMinutes(value.deepMinutes)
    if (deepMinutes === null) return null
    patch.deepMinutes = deepMinutes
  }
  if ('shortMinutes' in value) {
    const shortMinutes = sanitisePositiveMinutes(value.shortMinutes)
    if (shortMinutes === null) return null
    patch.shortMinutes = shortMinutes
  }
  if ('reflectMinutes' in value) {
    const reflectMinutes = sanitisePositiveMinutes(value.reflectMinutes)
    if (reflectMinutes === null) return null
    patch.reflectMinutes = reflectMinutes
  }
  if ('defaultRegions' in value) {
    const defaultRegions = sanitiseDefaultRegions(value.defaultRegions)
    if (defaultRegions === null) return null
    patch.defaultRegions = defaultRegions
  }
  if ('plannerPolicy' in value) {
    if (value.plannerPolicy !== 'prefer-deep' && value.plannerPolicy !== 'maximise-focus') {
      return null
    }
    patch.plannerPolicy = value.plannerPolicy
  }
  if ('notificationsEnabled' in value) {
    if (typeof value.notificationsEnabled !== 'boolean') return null
    patch.notificationsEnabled = value.notificationsEnabled
  }
  if ('soundEnabled' in value) {
    if (typeof value.soundEnabled !== 'boolean') return null
    patch.soundEnabled = value.soundEnabled
  }

  return patch
}

function sanitiseCommitment(value: unknown): Commitment | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const title = sanitiseString(value.title)
  const startsAt = sanitiseNumber(value.startsAt)
  const durationMin = sanitisePositiveMinutes(value.durationMin)
  return id === null || title === null || startsAt === null || durationMin === null
    ? null
    : { id, title, startsAt, durationMin }
}

function sanitiseCommitmentPatch(value: unknown): Partial<Commitment> | null {
  if (!isRecord(value)) return null

  const patch: Partial<Commitment> = {}
  if ('title' in value) {
    const title = sanitiseString(value.title)
    if (title === null) return null
    patch.title = title
  }
  if ('startsAt' in value) {
    const startsAt = sanitiseNumber(value.startsAt)
    if (startsAt === null) return null
    patch.startsAt = startsAt
  }
  if ('durationMin' in value) {
    const durationMin = sanitisePositiveMinutes(value.durationMin)
    if (durationMin === null) return null
    patch.durationMin = durationMin
  }

  return patch
}

function sanitisePlannedBreak(value: unknown): PlannedBreak | null {
  if (!isRecord(value)) return null
  const id = sanitiseString(value.id)
  const startsAt = sanitiseNumber(value.startsAt)
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
    const startsAt = sanitiseNumber(region.startsAt)
    const endsAt = sanitiseNumber(region.endsAt)
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
