/**
 * The backlog's storage: IndexedDB, wrapped just far enough to be promises.
 *
 * Not `localStorage`, which is where the session log lives, for three reasons
 * that all come from the backlog being a different kind of data. The log is
 * written whole on every save, and a few kilobytes a day make that cheap; a
 * backlog of a year's tasks rewritten on every tick of a checkbox would not be.
 * `localStorage` is also capped at around five megabytes and synchronous, so a
 * large write blocks the very thread the timer renders on. IndexedDB writes one
 * record at a time, asynchronously, with room to spare.
 *
 * The session log stays where it is. Its synchronous rehydration is load-bearing
 * — the extension publisher relies on the session existing before React's
 * first render, see the trap in `docs/decisions.md` — and moving it as well
 * would have turned a feature into a persistence rewrite. Only the backlog
 * pays for being asynchronous, and the task UI waits for it.
 *
 * Several tabs share this database, and each holds its own copy of the backlog
 * in memory. These rules keep those copies from writing over each other, and
 * each is enforced *inside* a single transaction, because a check made in one
 * transaction and acted on in the next is a check another tab can slip between:
 *
 * - **A write never replaces a newer record, nor a different one at the same
 *   version — and a delete is final.** A tombstone is put over any live copy,
 *   and a live copy is never put over a tombstone, whatever their versions
 *   (`outranks` in `domain/tasks.ts`, the same rule memory uses). Otherwise a
 *   record is put only if its `updatedAt` is newer than the copy on disk, or
 *   equal with identical contents (a retry). Anything else is skipped and the
 *   disk's copy handed back as `stale`, so the writer can adopt it rather than
 *   go on believing its own. Equal versions are not a theory: two tabs editing
 *   a record whose version is ahead of the clock both stamp it one past that
 *   version. The first to commit keeps it, which is what lets every tab treat
 *   a broadcast at a given version as what the disk holds.
 * - **Nothing leaves a deleted subtree.** A delete writes only the record
 *   deleted, and what sits beneath it is gone by ancestry (`isGone`). A tab
 *   that has not yet heard of the delete still shows that subtree, and could
 *   move a task out of it into a live parent, bringing it back. So a move — a
 *   live copy with a new parent — is put only if the disk's copy is not
 *   already beneath a tombstone, walking up its parents inside the same
 *   transaction; otherwise the disk's copy comes back as `stale`, with the
 *   tombstone that stopped it, so the writer learns of the delete as well. A
 *   move that commits before the delete is under a live parent when the delete
 *   lands, and survives.
 * - **Every record in a write is judged against the disk as it was when the
 *   write began.** All of a write's reads happen first and its puts only once
 *   every read has answered. Interleaved, one record's check could see
 *   another's put from the same write: a move refused because the same write
 *   moved its epic into a deleted area afterwards, or allowed because the same
 *   write re-deleted an epic that was already deleted. Each edit is then
 *   judged by what came before it, never by what its own writer did next.
 * - **A filing lands whole or not at all.** Something put down for later is
 *   made a task by two records — the new task, and the Later's tombstone — and
 *   each judged on its own let one land without the other: two tabs filing
 *   the same line each wrote a task, and a line filed into an area another tab
 *   had just deleted was used up making a task nobody could see. So a filing
 *   is judged as one, against the disk as the write began: it is refused when
 *   the disk's Later has moved past the copy it was filed from — deleted, let
 *   go or reworded elsewhere — or when the place it is filed into is gone
 *   (`goneOnDisk`, over the disk as this write will leave it, since a place
 *   can arrive or move in the same write), and then neither record is
 *   written. The disk's copies
 *   come back as `stale`, and the Later's waiting copy is written instead when
 *   the disk has none or an older one, so a line never lost on the way to
 *   being filed is not lost by the refusal either. A filing whose task is
 *   already on disk has landed before, and writes nothing rather than being
 *   refused by its own tombstone.
 * - **A replacement invalidates everything written against what it replaced.**
 *   An import clears every store and bumps a *generation* kept in `meta`. Every
 *   write states the generation it was made against, and one made against an
 *   older generation writes nothing and comes back `superseded`.
 * - **Seeding happens at most once, and answers with a whole snapshot.** The
 *   emptiness check, the seed write and the read of what is there afterwards
 *   are one transaction, so two tabs opening an empty database at the same
 *   moment end up with one set of areas, and a tab that finds another tab's
 *   import there instead gets its items and generation too, not only its
 *   areas.
 *
 * Hand-rolled rather than a library because this is the whole of it. The
 * factory is a parameter so tests can hand in a fresh in-memory IndexedDB per
 * case rather than sharing one global.
 */

import type { Later } from '@/domain/later'
import { isLive, outranks, type Area, type Item } from '@/domain/tasks'

const DB_NAME = 'mono'
/**
 * Bumped only when the object stores themselves change, with an upgrade step.
 * v2 added `meta`, for the generation. A v1 database upgrades in place: its
 * two stores are kept as they are and its generation reads as 0. v3 added
 * `later`, for what is put down to come back to (`domain/later.ts`); an older
 * database upgrades the same way, with nothing in it.
 */
const DB_VERSION = 3

const STORES = ['areas', 'items', 'later', 'meta'] as const
const GENERATION_KEY = 'generation'

export type BacklogContents = { areas: Area[]; items: Item[]; later: Later[] }

/**
 * Something put down for later, made a task: the task, the Later's tombstone,
 * and the copy of the Later that was waiting, which is what stays if the
 * filing is refused. Written whole or not at all; see the header.
 */
export type Filing = { task: Item; later: Later; waiting: Later }

/** Records to write, and filings to judge whole. */
export type Changes = Partial<BacklogContents> & { filings?: readonly Filing[] }

/**
 * A whole backlog to replace this one with. Later may be left out, and then
 * there is none: a file from before it existed is taken as having nothing put
 * down for later rather than leaving what is here beside a backlog it was
 * never part of.
 */
export type BacklogReplacement = Omit<BacklogContents, 'later'> & { later?: Later[] }

/** What a write did. */
export type WriteResult =
  /**
   * Everything the disk accepted landed. `stale` is the disk's own copies for
   * the writer to adopt: of what it refused, and the tombstone that refused a
   * move out of a deleted subtree.
   */
  | {
      kind: 'written'
      stale: BacklogContents
      /** The Laters whose filings were refused, by id. Neither record was written. */
      refused: string[]
    }
  /** The backlog was replaced since this tab last read it. Nothing was written. */
  | { kind: 'superseded' }

export type TaskDb = {
  readAll: () => Promise<BacklogContents & { generation: number }>
  /** Write these records against `generation`, in one transaction. */
  write: (changes: Changes, generation: number) => Promise<WriteResult>
  /** Clear every store, write these instead, and return the new generation. */
  replaceAll: (contents: BacklogReplacement) => Promise<number>
  /**
   * Write these areas only if there are none at all, and return everything that
   * is there afterwards, read in the same transaction.
   */
  seedIfEmpty: (areas: Area[]) => Promise<BacklogContents & { generation: number }>
  close: () => void
}

export function openTaskDb(factory: IDBFactory = globalThis.indexedDB): Promise<TaskDb> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }

    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('areas')) db.createObjectStore('areas', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('later')) db.createObjectStore('later', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open the task store.'))
    // Not a failure. An older tab still holds the previous version open; it is
    // told to step aside (`onversionchange` below) and this request completes
    // once it has. Rejecting here used to leave the newer tab working in memory
    // for good over what is only a moment's wait.
    request.onblocked = () => undefined
    request.onsuccess = () => resolve(wrap(request.result))
  })
}

function wrap(db: IDBDatabase): TaskDb {
  // A newer tab wants to upgrade the stores. Step aside rather than block it;
  // this tab's next write will fail loudly, which the storage warning reports.
  db.onversionchange = () => db.close()

  return {
    readAll: () =>
      run(db, 'readonly', (tx, done) => {
        const areas = tx.objectStore('areas').getAll()
        const items = tx.objectStore('items').getAll()
        const later = tx.objectStore('later').getAll()
        const generation = tx.objectStore('meta').get(GENERATION_KEY)
        tx.addEventListener('complete', () =>
          done({
            areas: areas.result as Area[],
            items: items.result as Item[],
            later: later.result as Later[],
            generation: readGeneration(generation.result),
          }),
        )
      }),

    write: (changes, generation) =>
      run(db, 'readwrite', (tx, done) => {
        const stale: BacklogContents = { areas: [], items: [], later: [] }
        const refused: string[] = []
        let superseded = false

        // Everything is chained off the generation read, so the check and the
        // puts it guards are the same transaction.
        tx.objectStore('meta').get(GENERATION_KEY).onsuccess = (event) => {
          if (readGeneration((event.target as IDBRequest).result) !== generation) {
            superseded = true
            return
          }
          // The reads first, the puts once every read has answered; see the
          // header on why a write is judged against the disk as it began.
          const puts: (() => void)[] = []
          const blockers = new Map<string, Area | Item>()
          const filings = changes.filings ?? []
          const writing = new Set(
            [
              ...(changes.areas ?? []),
              ...(changes.items ?? []),
              ...(changes.later ?? []),
              ...filings.flatMap((f) => [f.task, f.later]),
            ].map((r) => r.id),
          )
          // Two rounds. Plain records first, each against the disk as the
          // write began; filings once every one of those has been answered,
          // against the disk as this write will leave it (`accepted`), since
          // the place a line is filed into may be arriving or moving in the
          // same write. The puts only once both rounds are done.
          const accepted = new Map<string, Area | Item>()
          let plainOwed = 0
          let filingsOwed = 0
          const finish = () => {
            for (const put of puts) put()
            // A blocker this write also sends is answered by its own judgement.
            for (const blocker of blockers.values()) {
              if (writing.has(blocker.id)) continue
              if ('kind' in blocker) stale.items.push(blocker)
              else stale.areas.push(blocker)
            }
          }
          const plainAnswered = () => {
            plainOwed -= 1
            if (plainOwed === 0) judgeFilings()
          }
          const filingAnswered = () => {
            filingsOwed -= 1
            if (filingsOwed === 0) finish()
          }
          const judge = <T extends Area | Item | Later>(
            store: IDBObjectStore,
            records: readonly T[],
            kept: T[],
            track: boolean,
          ) => {
            for (const record of records) {
              plainOwed += 1
              store.get(record.id).onsuccess = (event) => {
                const existing = (event.target as IDBRequest<T | undefined>).result
                if (existing !== undefined && beats(existing, record)) {
                  kept.push(existing)
                  return plainAnswered()
                }
                const accept = () => {
                  puts.push(() => store.put(record))
                  if (track) accepted.set(record.id, record as Area | Item)
                  plainAnswered()
                }
                if (existing === undefined || !movesOut(existing, record)) return accept()
                goneOnDisk(tx, (existing as Item).parentId, NOTHING_ACCEPTED, (blocker) => {
                  if (blocker === null) return accept()
                  kept.push(existing)
                  blockers.set(blocker.id, blocker)
                  plainAnswered()
                })
              }
            }
          }

          // Three reads each — the Later, the task, and the place it is filed
          // into — and one decision for both records. See the header.
          const items = tx.objectStore('items')
          const later = tx.objectStore('later')
          const judgeFilings = () => {
            if (filings.length === 0) return finish()
            filingsOwed = filings.length
            for (const filing of filings) {
              later.get(filing.later.id).onsuccess = (event) => {
                const onDisk = (event.target as IDBRequest<Later | undefined>).result
                items.get(filing.task.id).onsuccess = (read) => {
                  const landed = (read.target as IDBRequest<Item | undefined>).result !== undefined
                  goneOnDisk(tx, filing.task.parentId, accepted, (blocker) => {
                    // Landed before: there is nothing to write, and its own
                    // tombstone must not refuse it.
                    if (landed) return filingAnswered()
                    // Filed from a copy the disk has moved past — deleted, let
                    // go, or reworded in another tab — it would make a task of
                    // what the line no longer says.
                    const moved = onDisk !== undefined && beats(onDisk, filing.waiting)
                    if (!moved && blocker === null) {
                      puts.push(() => {
                        items.put(filing.task)
                        later.put(filing.later)
                      })
                      return filingAnswered()
                    }
                    refused.push(filing.later.id)
                    if (blocker !== null) blockers.set(blocker.id, blocker)
                    if (moved) stale.later.push(onDisk)
                    else puts.push(() => later.put(filing.waiting))
                    filingAnswered()
                  })
                }
              }
            }
          }

          judge(tx.objectStore('areas'), changes.areas ?? [], stale.areas, true)
          judge(tx.objectStore('items'), changes.items ?? [], stale.items, true)
          judge(tx.objectStore('later'), changes.later ?? [], stale.later, false)
          if (plainOwed === 0) judgeFilings()
        }
        tx.addEventListener('complete', () =>
          done(superseded ? { kind: 'superseded' } : { kind: 'written', stale, refused }),
        )
      }),

    replaceAll: (contents) =>
      run(db, 'readwrite', (tx, done) => {
        const meta = tx.objectStore('meta')
        let next = 0
        meta.get(GENERATION_KEY).onsuccess = (event) => {
          next = readGeneration((event.target as IDBRequest).result) + 1
          const areas = tx.objectStore('areas')
          const items = tx.objectStore('items')
          const later = tx.objectStore('later')
          areas.clear()
          items.clear()
          later.clear()
          for (const area of contents.areas) areas.put(area)
          for (const item of contents.items) items.put(item)
          for (const record of contents.later ?? []) later.put(record)
          meta.put({ key: GENERATION_KEY, value: next })
        }
        tx.addEventListener('complete', () => done(next))
      }),

    seedIfEmpty: (seeds) =>
      run(db, 'readwrite', (tx, done) => {
        const areas = tx.objectStore('areas')
        const after: BacklogContents & { generation: number } = {
          areas: [],
          items: [],
          later: [],
          generation: 0,
        }
        areas.count().onsuccess = (event) => {
          if ((event.target as IDBRequest<number>).result === 0) {
            for (const seed of seeds) areas.put(seed)
          }
          // Read after the decision, in the same transaction: one consistent
          // backlog, whoever's it turns out to be.
          areas.getAll().onsuccess = (read) => {
            after.areas = (read.target as IDBRequest<Area[]>).result
          }
          tx.objectStore('items').getAll().onsuccess = (read) => {
            after.items = (read.target as IDBRequest<Item[]>).result
          }
          tx.objectStore('later').getAll().onsuccess = (read) => {
            after.later = (read.target as IDBRequest<Later[]>).result
          }
          tx.objectStore('meta').get(GENERATION_KEY).onsuccess = (read) => {
            after.generation = readGeneration((read.target as IDBRequest).result)
          }
        }
        tx.addEventListener('complete', () => done(after))
      }),

    close: () => db.close(),
  }
}

/**
 * Whether the disk's copy of a record wins over the one being written, so the
 * write is refused and the disk's copy handed back.
 *
 * `outranks` — the rule memory uses too — decides: a delete is final, and
 * otherwise newer wins. It leaves one case to the disk. At an equal version
 * the copy already committed wins unless the two are identical, which is this
 * tab retrying its own write and harmless to re-write. Letting a different
 * equal-version copy overwrite, as this used to, made the disk's answer depend
 * on commit order while each tab adopted broadcasts in arrival order, and the
 * two orders can disagree.
 */
function beats<T extends { updatedAt: number; deletedAt?: number }>(existing: T, record: T): boolean {
  if (outranks(existing, record)) return true
  if (outranks(record, existing)) return false
  return !sameValue(existing, record)
}

/** Whether writing `record` over `existing` moves a live item to a new parent. */
const movesOut = (existing: Area | Item | Later, record: Area | Item | Later): boolean =>
  'parentId' in existing &&
  'parentId' in record &&
  isLive(existing) &&
  isLive(record) &&
  existing.parentId !== record.parentId

/**
 * The first deleted record above `startId` on disk, or null when there is
 * none, walking up parents with one read each inside `tx`. Run before any of
 * the write's puts, so it sees the disk as the write found it. A missing parent
 * is not a deleted one, and a cycle is not either — the same answers `isGone`
 * gives.
 *
 * `accepted` is laid over the disk: copies this write has already been judged
 * to put, walked in place of the disk's. A filing passes the write's, because
 * what it needs to know is where the task will sit once the write lands — in
 * an epic arriving in the same write, or one the same write moves. A move
 * passes none: it is judged by where the record is now, and never by what the
 * same write does next.
 */
/** What a move walks over: the disk alone. See `goneOnDisk`. */
const NOTHING_ACCEPTED: ReadonlyMap<string, Area | Item> = new Map()

function goneOnDisk(
  tx: IDBTransaction,
  startId: string,
  accepted: ReadonlyMap<string, Area | Item>,
  answer: (blocker: Area | Item | null) => void,
): void {
  const seen = new Set<string>()
  const step = (id: string): void => {
    if (seen.has(id)) return answer(null)
    seen.add(id)
    const own = accepted.get(id)
    if (own) {
      if (!isLive(own)) return answer(own)
      return 'parentId' in own ? step(own.parentId) : answer(null)
    }
    tx.objectStore('areas').get(id).onsuccess = (event) => {
      const area = (event.target as IDBRequest<Area | undefined>).result
      if (area) return answer(isLive(area) ? null : area)
      tx.objectStore('items').get(id).onsuccess = (read) => {
        const item = (read.target as IDBRequest<Item | undefined>).result
        if (!item) return answer(null)
        if (!isLive(item)) return answer(item)
        step(item.parentId)
      }
    }
  }
  step(startId)
}

/**
 * Whether two records hold the same values, compared as data rather than by
 * reference. A record read back from IndexedDB is a structured clone, so a
 * nested value — where a Later came from — is a new object with the same
 * contents every time it is read, and comparing it by reference made every
 * saved copy of such a Later differ from itself.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((k) => Object.hasOwn(right, k) && sameValue(left[k], right[k]))
  )
}

const readGeneration = (record: unknown): number =>
  typeof record === 'object' &&
  record !== null &&
  typeof (record as { value?: unknown }).value === 'number'
    ? (record as { value: number }).value
    : 0

/**
 * Run a transaction over every store and settle when it commits.
 *
 * On `complete`, not on each request's `success`: a put that succeeded inside a
 * transaction that later aborted was never written, and reporting it as saved
 * would be the exact lie the storage warning exists to prevent. `body` calls
 * `done` from its own `complete` listener with whatever it gathered, which is
 * registered before this one's error handlers can fire.
 */
function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction([...STORES], mode)
    } catch (error) {
      // A closed connection throws synchronously rather than failing the request.
      reject(error)
      return
    }
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('The task store transaction was aborted.'))
    try {
      body(tx, resolve)
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}
