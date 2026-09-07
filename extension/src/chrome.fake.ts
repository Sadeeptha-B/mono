/**
 * Enough of `chrome.*` to run the service worker in a test.
 *
 * Not a mocking library and deliberately not a general one — it implements the
 * eight surfaces `background.ts` actually touches, with real behaviour rather
 * than recorded calls. Storage is an object that remembers what was set, session
 * rules are a list that `updateSessionRules` removes from and adds to, and an
 * alarm is an entry that exists until something clears it. That matters, because
 * the bugs this exists to catch are about *state* — rules left installed, a
 * claim left behind, an alarm that never stops — and a spy that only records
 * calls cannot tell you what the worker's storage ended up holding.
 *
 * The one liberty taken is `dispatch`, which returns a promise that settles when
 * the listener replies. Chrome's own `sendMessage` behaves this way; the worker
 * does not know the difference, and it gives a test somewhere to await. That is
 * also how the serial queue is drained: every message handler enters the same
 * chain, so a reply to a later message proves the earlier work finished.
 *
 * **It can be made to fail**, which is the other half of its job. Every sequence
 * in the worker is several `await`s long and each one can be refused — a storage
 * quota, an alarm that will not schedule — so the ordering of those writes is a
 * design decision about which half-finished state you would rather be left in.
 * A test that cannot stop a sequence halfway cannot check that decision, and
 * mutation testing does not reach it either: the code is correct, and it is the
 * *order* that is wrong. `failNext` is how those cases are reachable.
 *
 * Named `.fake.ts` rather than `.test.ts` so vitest treats it as a module and
 * not as a suite. It is imported by tests only, and never by anything that
 * ships — `src/contract/boundary.test.ts` walks the four real entry points.
 */

/** The listener signature `chrome.runtime.onMessage` hands the worker. */
type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (reply?: unknown) => void,
) => boolean | undefined

type Store = Record<string, unknown>

/**
 * Whether one granted pattern covers a pattern Mono is asking about.
 *
 * Chrome reasons about the URLs represented by match patterns rather than
 * comparing their strings: `*://*.reddit.com/*` also satisfies a check for
 * `*://*.old.reddit.com/*`. The fake only needs the wildcard-host form emitted
 * by `originPatternFor`; exact matching remains the safe fallback for anything
 * else.
 */
function grantedPatternCovers(grantedPattern: string, requestedPattern: string): boolean {
  if (grantedPattern === requestedPattern || grantedPattern === '<all_urls>') return true
  if (grantedPattern === '*://*/*') return true

  const pattern = /^\*:\/\/\*\.([^/]+)\/\*$/
  const grantedHost = pattern.exec(grantedPattern)?.[1]
  const requestedHost = pattern.exec(requestedPattern)?.[1]
  if (grantedHost === undefined || requestedHost === undefined) return false

  return requestedHost === grantedHost || requestedHost.endsWith(`.${grantedHost}`)
}

/**
 * The operations a test can refuse.
 *
 * Only the ones whose failure changes what the user is left with: what is
 * stored, what is installed, what can be read back, and what will eventually
 * clean up. Chrome rejects failed reads rather than turning them into empty
 * results, so preparation failures have to be reachable here too.
 */
export type FailableOperation =
  | 'local.get'
  | 'local.set'
  | 'session.get'
  | 'session.set'
  | 'storage.access'
  | 'alarms.create'
  | 'alarms.clear'
  | 'rules.get'
  | 'rules.update'
  | 'windows.update'

export type FakeChromeOptions = {
  /** Seeded `chrome.storage.local`, for the browser-restart cases. */
  local?: Store
  /** Seeded `chrome.storage.session`. Empty after a real restart, which is the point. */
  session?: Store
  /** Host match patterns the extension has been granted. */
  granted?: readonly string[]
  /** Tabs that exist, so `sendMessage` to anything else fails as it would. */
  tabs?: readonly number[]
  /** Model an incomplete or synchronously broken `setAccessLevel` implementation. */
  storageAccess?: 'available' | 'missing' | 'throws'
  /**
   * Session rules already installed when this worker starts.
   *
   * Session rules outlive worker suspension, so a worker very often starts into
   * a browser that is already enforcing something. Seeding them is how the
   * orphan cases are reachable: rules with no armed record behind them.
   */
  rules?: readonly chrome.declarativeNetRequest.Rule[]
  /** Alarms already scheduled when this worker starts. */
  alarms?: Readonly<Record<string, chrome.alarms.AlarmCreateInfo>>
}

export type FakeChrome = {
  local: Store
  session: Store
  /** The session rules currently installed, in the order they were added. */
  rules: () => chrome.declarativeNetRequest.Rule[]
  alarms: Map<string, chrome.alarms.AlarmCreateInfo>
  /** The most recent access boundary requested for local storage. */
  localAccessLevel: () => chrome.storage.AccessLevel | null
  /** Every `tabs.sendMessage` that reached a live tab. */
  tabMessages: { tabId: number; message: unknown; documentId?: string }[]
  /** Every `tabs.create`, which is how the worker opens Mono. */
  openedUrls: string[]
  /** Every tab `focusTab` brought forward. */
  focused: number[]
  /** Deliver a message to the worker and wait for whatever it replies. */
  dispatch: (message: unknown, sender: unknown) => Promise<unknown>
  fireAlarm: (name: string) => void
  fireStartup: () => void
  fireInstalled: () => void
  /**
   * Chrome fires one of these, never both. Keeping them apart matters: a fake
   * that fired both ran the worker's handler twice, so a refused rule update was
   * immediately retried by the second call and a real failure looked self-healing.
   */
  firePermissionAdded: () => void
  firePermissionRemoved: () => void
  fireTabRemoved: (tabId: number) => void
  /** Take a tab away without telling the worker, as a closed tab does. */
  killTab: (tabId: number) => void
  /** Replace the document in a live tab without replacing its stable tab id. */
  setTabDocument: (tabId: number, documentId: string) => void
  /** Grant or revoke host access, as Chrome's own settings can at any moment. */
  grant: (pattern: string) => void
  revoke: (pattern: string) => void
  /**
   * Refuse the next matching call, once.
   *
   * `match` narrows it to the write you meant — several unrelated things write
   * to session storage, so a bare `session.set` would usually be spent on the
   * wrong one. Queued failures that are never matched are simply never used.
   */
  failNext: (operation: FailableOperation, match?: (argument: unknown) => boolean) => void
}

export const FAKE_EXTENSION_ID = 'mono-blocker-test-id'

/**
 * Build the fake and install it as the global the worker will find.
 *
 * Must be called *before* importing `background.ts`: that module registers its
 * listeners as it evaluates, so the global has to be there already. Pair it with
 * `vi.resetModules()` so each test gets its own worker, with its own empty
 * serial queue.
 */
export function installFakeChrome(options: FakeChromeOptions = {}): FakeChrome {
  const local: Store = { ...options.local }
  const session: Store = { ...options.session }
  const granted = new Set(options.granted ?? [])
  const liveTabs = new Set(options.tabs ?? [])
  const tabDocuments = new Map<number, string>()

  let rules: chrome.declarativeNetRequest.Rule[] = [...(options.rules ?? [])]
  const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>(
    Object.entries(options.alarms ?? {}),
  )

  const tabMessages: { tabId: number; message: unknown; documentId?: string }[] = []
  const openedUrls: string[] = []
  const focused: number[] = []
  let localAccessLevel: chrome.storage.AccessLevel | null = null

  const failures: { operation: FailableOperation; match?: (argument: unknown) => boolean }[] = []

  const refuses = (operation: FailableOperation, argument: unknown): boolean => {
    const index = failures.findIndex(
      (failure) =>
        failure.operation === operation &&
        (failure.match === undefined || failure.match(argument)),
    )
    if (index === -1) return false
    failures.splice(index, 1)
    return true
  }

  const messageListeners: MessageListener[] = []
  const alarmListeners: ((alarm: chrome.alarms.Alarm) => void)[] = []
  const startupListeners: (() => void)[] = []
  const installedListeners: (() => void)[] = []
  const permissionAddedListeners: (() => void)[] = []
  const permissionRemovedListeners: (() => void)[] = []
  const tabRemovedListeners: ((tabId: number) => void)[] = []

  const area = (
    store: Store,
    getOperation: FailableOperation,
    setOperation: FailableOperation,
  ) => ({
    get: (keys: string | string[]) => {
      if (refuses(getOperation, keys)) {
        return Promise.reject(new Error(`${getOperation} refused`))
      }
      const names = typeof keys === 'string' ? [keys] : keys
      const out: Store = {}
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(store, name)) out[name] = store[name]
      }
      return Promise.resolve(out)
    },
    set: (items: Store) => {
      if (refuses(setOperation, items)) {
        return Promise.reject(new Error(`${setOperation} refused`))
      }
      Object.assign(store, items)
      return Promise.resolve()
    },
    remove: (key: string) => {
      delete store[key]
      return Promise.resolve()
    },
  })

  const localArea = {
    ...area(local, 'local.get', 'local.set'),
  } as ReturnType<typeof area> & {
    setAccessLevel?: (options: { accessLevel: chrome.storage.AccessLevel }) => Promise<void>
  }

  if (options.storageAccess !== 'missing') {
    localArea.setAccessLevel = ({ accessLevel }: { accessLevel: chrome.storage.AccessLevel }) => {
      if (options.storageAccess === 'throws') throw new Error('storage.access threw')
      if (refuses('storage.access', accessLevel)) {
        return Promise.reject(new Error('storage.access refused'))
      }
      localAccessLevel = accessLevel
      return Promise.resolve()
    }
  }

  const fake = {
    runtime: {
      id: FAKE_EXTENSION_ID,
      onMessage: {
        addListener: (listener: MessageListener) => messageListeners.push(listener),
      },
      onStartup: { addListener: (listener: () => void) => startupListeners.push(listener) },
      onInstalled: { addListener: (listener: () => void) => installedListeners.push(listener) },
    },
    storage: {
      local: localArea,
      session: area(session, 'session.get', 'session.set'),
    },
    declarativeNetRequest: {
      getSessionRules: () =>
        refuses('rules.get', undefined)
          ? Promise.reject(new Error('rules.get refused'))
          : Promise.resolve(rules),
      updateSessionRules: (update: {
        removeRuleIds?: number[]
        addRules?: chrome.declarativeNetRequest.Rule[]
      }) => {
        if (refuses('rules.update', update)) return Promise.reject(new Error('rules.update refused'))
        const removed = new Set(update.removeRuleIds ?? [])
        rules = [...rules.filter((rule) => !removed.has(rule.id)), ...(update.addRules ?? [])]
        return Promise.resolve()
      },
    },
    alarms: {
      create: (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        if (refuses('alarms.create', name)) return Promise.reject(new Error('alarms.create refused'))
        alarms.set(name, info)
        return Promise.resolve()
      },
      // The worker checks this at start-up, because an alarm's survival across
      // worker suspension is not something an extension may assume.
      get: (name: string) => Promise.resolve(alarms.get(name)),
      clear: (name: string) =>
        refuses('alarms.clear', name)
          ? Promise.reject(new Error('alarms.clear refused'))
          : Promise.resolve(alarms.delete(name)),
      onAlarm: {
        addListener: (listener: (alarm: chrome.alarms.Alarm) => void) =>
          alarmListeners.push(listener),
      },
    },
    permissions: {
      // All-or-nothing, exactly as Chrome's is — the reason `redirectableHosts`
      // asks one host at a time rather than in a single call. A broader granted
      // match pattern satisfies checks for the subdomains it covers.
      contains: ({ origins }: { origins: string[] }) =>
        Promise.resolve(
          origins.every((origin) =>
            [...granted].some((grantedOrigin) => grantedPatternCovers(grantedOrigin, origin)),
          ),
        ),
      onAdded: { addListener: (listener: () => void) => permissionAddedListeners.push(listener) },
      onRemoved: {
        addListener: (listener: () => void) => permissionRemovedListeners.push(listener),
      },
    },
    tabs: {
      sendMessage: (tabId: number, message: unknown, options?: { documentId?: string }) => {
        if (!liveTabs.has(tabId)) return Promise.reject(new Error('no such tab'))
        if (
          options?.documentId !== undefined &&
          tabDocuments.get(tabId) !== options.documentId
        ) {
          return Promise.reject(new Error('no such document'))
        }
        tabMessages.push({
          tabId,
          message,
          ...(options?.documentId !== undefined && { documentId: options.documentId }),
        })
        return Promise.resolve()
      },
      create: ({ url }: { url: string }) => {
        openedUrls.push(url)
        liveTabs.add(9000)
        return Promise.resolve({ id: 9000 })
      },
      update: (tabId: number) => {
        if (!liveTabs.has(tabId)) return Promise.reject(new Error('no such tab'))
        focused.push(tabId)
        return Promise.resolve({ id: tabId, windowId: 1 })
      },
      onRemoved: {
        addListener: (listener: (tabId: number) => void) => tabRemovedListeners.push(listener),
      },
    },
    windows: {
      update: (windowId: number) =>
        refuses('windows.update', windowId)
          ? Promise.reject(new Error('windows.update refused'))
          : Promise.resolve({}),
    },
  }

  // One cast, here, rather than a partial `typeof chrome` threaded through every
  // field above. The surfaces are checked by the worker compiling against the
  // real types; what this file owes is behaviour.
  ;(globalThis as unknown as { chrome: unknown }).chrome = fake

  const fire = (listeners: (() => void)[]): void => {
    for (const listener of listeners) listener()
  }

  return {
    local,
    session,
    rules: () => rules,
    alarms,
    localAccessLevel: () => localAccessLevel,
    tabMessages,
    openedUrls,
    focused,

    dispatch: (message, sender) => {
      const sent = message as { kind?: unknown }
      const source = sender as { documentId?: unknown; tab?: { id?: unknown } }
      const tabId = source.tab?.id
      const documentId = source.documentId
      if (
        sent.kind === 'intent' &&
        typeof tabId === 'number' &&
        typeof documentId === 'string'
      ) {
        tabDocuments.set(tabId, documentId)
      }

      return new Promise((resolve) => {
        let pending = false
        for (const listener of messageListeners) {
          if (listener(message, sender, resolve) === true) pending = true
        }
        // Nothing claimed the message, or it was handled synchronously. Either
        // way there is no reply coming and the caller should not wait for one.
        if (!pending) resolve(undefined)
      })
    },

    fireAlarm: (name) => {
      for (const listener of alarmListeners) {
        listener({ name, scheduledTime: Date.now() } as chrome.alarms.Alarm)
      }
    },
    fireStartup: () => fire(startupListeners),
    fireInstalled: () => fire(installedListeners),
    firePermissionAdded: () => fire(permissionAddedListeners),
    firePermissionRemoved: () => fire(permissionRemovedListeners),
    fireTabRemoved: (tabId) => {
      liveTabs.delete(tabId)
      tabDocuments.delete(tabId)
      for (const listener of tabRemovedListeners) listener(tabId)
    },
    killTab: (tabId) => {
      liveTabs.delete(tabId)
      tabDocuments.delete(tabId)
    },
    setTabDocument: (tabId, documentId) => void tabDocuments.set(tabId, documentId),
    grant: (pattern) => void granted.add(pattern),
    revoke: (pattern) => void granted.delete(pattern),
    failNext: (operation, match) => void failures.push({ operation, ...(match && { match }) }),
  }
}
