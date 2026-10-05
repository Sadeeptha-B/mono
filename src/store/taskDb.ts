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
 * Hand-rolled rather than a library because this is the whole of it: two
 * object stores, read everything, write some things, replace everything. The
 * factory is a parameter so tests can hand in a fresh in-memory IndexedDB per
 * case rather than sharing one global.
 */

import type { Area, Item } from '@/domain/tasks'

const DB_NAME = 'mono'
/** Bumped only when the object stores themselves change, with an upgrade step. */
const DB_VERSION = 1

export type BacklogContents = { areas: Area[]; items: Item[] }

export type TaskDb = {
  readAll: () => Promise<BacklogContents>
  /** Write these records in one transaction: all of them land, or none do. */
  write: (changes: Partial<BacklogContents>) => Promise<void>
  /** Clear both stores and write these instead. Used by import. */
  replaceAll: (contents: BacklogContents) => Promise<void>
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
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open the task store.'))
    // Another tab holding an older version open would block an upgrade forever.
    // There is only one version today; this is here so the first bump cannot
    // hang a tab without saying why.
    request.onblocked = () => reject(new Error('The task store is open in an older tab.'))
    request.onsuccess = () => resolve(wrap(request.result))
  })
}

function wrap(db: IDBDatabase): TaskDb {
  // A newer tab wants to upgrade the stores. Step aside rather than block it;
  // this tab's next write will fail loudly, which the storage warning reports.
  db.onversionchange = () => db.close()

  return {
    readAll: () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(['areas', 'items'], 'readonly')
        const areas = tx.objectStore('areas').getAll()
        const items = tx.objectStore('items').getAll()
        tx.oncomplete = () =>
          resolve({ areas: areas.result as Area[], items: items.result as Item[] })
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('Reading the task store was aborted.'))
      }),

    write: (changes) =>
      transact(db, (tx) => {
        for (const area of changes.areas ?? []) tx.objectStore('areas').put(area)
        for (const item of changes.items ?? []) tx.objectStore('items').put(item)
      }),

    replaceAll: (contents) =>
      transact(db, (tx) => {
        const areas = tx.objectStore('areas')
        const items = tx.objectStore('items')
        areas.clear()
        items.clear()
        for (const area of contents.areas) areas.put(area)
        for (const item of contents.items) items.put(item)
      }),

    close: () => db.close(),
  }
}

/**
 * Run a read-write transaction and settle when it commits.
 *
 * On `complete`, not on each request's `success`: a put that succeeded inside a
 * transaction that later aborted was never written, and reporting it as saved
 * would be the exact lie the storage warning exists to prevent.
 */
function transact(db: IDBDatabase, body: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(['areas', 'items'], 'readwrite')
    } catch (error) {
      // A closed connection throws synchronously rather than failing the request.
      reject(error)
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Writing the task store was aborted.'))
    try {
      body(tx)
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}
