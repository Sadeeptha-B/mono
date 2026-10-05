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
 * - **A replacement invalidates everything written against what it replaced.**
 *   An import clears both stores and bumps a *generation* kept in `meta`. Every
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

import { isLive, outranks, type Area, type Item } from '@/domain/tasks'

const DB_NAME = 'mono'
/**
 * Bumped only when the object stores themselves change, with an upgrade step.
 * v2 added `meta`, for the generation. A v1 database upgrades in place: its
 * two stores are kept as they are and its generation reads as 0.
 */
const DB_VERSION = 2

const STORES = ['areas', 'items', 'meta'] as const
const GENERATION_KEY = 'generation'

export type BacklogContents = { areas: Area[]; items: Item[] }

/** What a write did. */
export type WriteResult =
  /**
   * Everything the disk accepted landed. `stale` is the disk's own copies for
   * the writer to adopt: of what it refused, and the tombstone that refused a
   * move out of a deleted subtree.
   */
  | { kind: 'written'; stale: BacklogContents }
  /** The backlog was replaced since this tab last read it. Nothing was written. */
  | { kind: 'superseded' }

export type TaskDb = {
  readAll: () => Promise<BacklogContents & { generation: number }>
  /** Write these records against `generation`, in one transaction. */
  write: (changes: Partial<BacklogContents>, generation: number) => Promise<WriteResult>
  /** Clear both stores, write these instead, and return the new generation. */
  replaceAll: (contents: BacklogContents) => Promise<number>
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
        const generation = tx.objectStore('meta').get(GENERATION_KEY)
        tx.addEventListener('complete', () =>
          done({
            areas: areas.result as Area[],
            items: items.result as Item[],
            generation: readGeneration(generation.result),
          }),
        )
      }),

    write: (changes, generation) =>
      run(db, 'readwrite', (tx, done) => {
        const stale: BacklogContents = { areas: [], items: [] }
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
          const writing = new Set([...(changes.areas ?? []), ...(changes.items ?? [])].map((r) => r.id))
          let waiting = 0
          const answered = () => {
            waiting -= 1
            if (waiting > 0) return
            for (const put of puts) put()
            // A blocker this write also sends is answered by its own judgement.
            for (const blocker of blockers.values()) {
              if (writing.has(blocker.id)) continue
              if ('kind' in blocker) stale.items.push(blocker)
              else stale.areas.push(blocker)
            }
          }
          const judge = <T extends Area | Item>(store: IDBObjectStore, records: readonly T[], kept: T[]) => {
            for (const record of records) {
              waiting += 1
              store.get(record.id).onsuccess = (event) => {
                const existing = (event.target as IDBRequest<T | undefined>).result
                if (existing !== undefined && beats(existing, record)) {
                  kept.push(existing)
                  return answered()
                }
                const accept = () => {
                  puts.push(() => store.put(record))
                  answered()
                }
                if (existing === undefined || !movesOut(existing, record)) return accept()
                goneOnDisk(tx, (existing as Item).parentId, (blocker) => {
                  if (blocker === null) return accept()
                  kept.push(existing)
                  blockers.set(blocker.id, blocker)
                  answered()
                })
              }
            }
          }
          judge(tx.objectStore('areas'), changes.areas ?? [], stale.areas)
          judge(tx.objectStore('items'), changes.items ?? [], stale.items)
        }
        tx.addEventListener('complete', () =>
          done(superseded ? { kind: 'superseded' } : { kind: 'written', stale }),
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
          areas.clear()
          items.clear()
          for (const area of contents.areas) areas.put(area)
          for (const item of contents.items) items.put(item)
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
  return !sameFields(existing, record)
}

/** Whether writing `record` over `existing` moves a live item to a new parent. */
const movesOut = (existing: Area | Item, record: Area | Item): boolean =>
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
 */
function goneOnDisk(
  tx: IDBTransaction,
  startId: string,
  answer: (blocker: Area | Item | null) => void,
): void {
  const seen = new Set<string>()
  const step = (id: string) => {
    if (seen.has(id)) return answer(null)
    seen.add(id)
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

/** Whether two flat records hold the same fields with the same values. */
function sameFields(a: object, b: object): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((k) => left[k] === right[k])
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
