/**
 * The service worker, run.
 *
 * `authority.test.ts` covers the judgement; this covers what the worker does
 * with it — storage, session rules, the alarm, the serial queue, and the two
 * paths that reach back into a tab. That split is the point. The decision is
 * pure and can be tabulated; everything here is asynchronous, ordered, and
 * stateful, and none of it was exercised by anything before this file existed.
 *
 * **How a test waits.** Nothing in the worker is awaited by its caller — a
 * message handler starts work with a bare `void serial(...)` and returns. So the
 * queue is drained by sending a *second* message that does reply: every handler
 * enters the same chain, so a reply proves the earlier work finished. `settle`
 * below uses `hello` for this rather than `getStatus`, because `getStatus`
 * reconciles before answering and would quietly do the very tidying up some of
 * these tests are checking the worker did on its own.
 *
 * **What is deliberately not faked.** The clock. `vi.setSystemTime` moves it, so
 * expiry is tested by actually being past `endsAt` rather than by stubbing
 * `readArmed`. The four-hour clamp and the "already passed" check are the real
 * ones from the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BLOCKING_CHANNEL, type BlockingIntent } from '@/contract/blocking'
import { installFakeChrome, FAKE_EXTENSION_ID, type FakeChrome } from './chrome.fake'
import { originPatternFor } from './permissions'
import { rulesForHosts } from './rules'
import type { GetStatusReply, SetHostsReply, StatusReply } from './messages'
import type { PublisherLease } from './state'

const NOW = new Date(2026, 7, 20, 14, 0, 0).getTime()
const BLOCK_MS = 45 * 60_000

const MONO_ORIGIN = 'http://localhost:5173'
const ALARM = 'mono.blockEnds'
const RETRY_ALARM = 'mono.rulesRetry'

/** A Mono page, as Chrome describes it to the worker. */
const monoPage = (documentId: string, tabId = 1) => ({
  origin: MONO_ORIGIN,
  documentId,
  tab: { id: tabId },
})

/** The popup or the interstitial, which are trusted for different things. */
const ourPage = () => ({
  id: FAKE_EXTENSION_ID,
  origin: `chrome-extension://${FAKE_EXTENSION_ID}`,
})

const running = (segmentId: string, startedAt = NOW, endsAt = startedAt + BLOCK_MS) =>
  ({
    channel: BLOCKING_CHANNEL,
    v: 1,
    running: true,
    segmentId,
    endsAt,
    startedAt,
    blockKind: 'deep',
    purpose: 'Rewrite the planner docs',
  }) satisfies BlockingIntent

const stopped = (stoppedSegmentId: string | null) =>
  ({ channel: BLOCKING_CHANNEL, v: 1, running: false, stoppedSegmentId }) satisfies BlockingIntent

type Boot = {
  local?: Record<string, unknown>
  session?: Record<string, unknown>
  granted?: string[]
  tabs?: number[]
  rules?: chrome.declarativeNetRequest.Rule[]
  alarms?: Record<string, chrome.alarms.AlarmCreateInfo>
}

/**
 * A fresh worker with a fresh queue.
 *
 * `resetModules` matters more than it looks: `serial`'s tail is module state, so
 * without it every test would queue behind the one before and an ordering test
 * would be measuring the wrong chain.
 */
async function boot(options: Boot = {}): Promise<FakeChrome> {
  vi.resetModules()
  const fake = installFakeChrome({
    local: { hosts: ['reddit.com'], ...options.local },
    ...(options.session && { session: options.session }),
    granted: options.granted ?? [],
    tabs: options.tabs ?? [1],
    rules: options.rules ?? [],
    alarms: options.alarms ?? {},
  })
  await import('./background')
  return fake
}

/** Drain the worker's queue without reconciling anything on the way past. */
const settle = (fake: FakeChrome): Promise<unknown> =>
  fake.dispatch({ kind: 'hello' }, monoPage('settle-doc', 1))

const send = async (fake: FakeChrome, intent: unknown, sender: unknown): Promise<void> => {
  await fake.dispatch({ kind: 'intent', intent }, sender)
  await settle(fake)
}

const armedIn = (fake: FakeChrome): { segmentId?: string; endsAt?: number } | null =>
  (fake.local.armed as { segmentId?: string; endsAt?: number } | null) ?? null

const leaseIn = (fake: FakeChrome): PublisherLease | null =>
  (fake.session.lease as PublisherLease | null) ?? null

/** Refuse only the write that records the lease, not every session write. */
const failLeaseWrite = (fake: FakeChrome): void =>
  fake.failNext('session.set', (items) => typeof items === 'object' && items !== null && 'lease' in items)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('arming', () => {
  it('installs rules, stores the block, and schedules the repeating alarm', async () => {
    const fake = await boot()

    await send(fake, running('seg-a'), monoPage('doc-a'))

    expect(armedIn(fake)?.segmentId).toBe('seg-a')
    expect(fake.rules()).toHaveLength(1)
    expect(fake.rules()[0]?.condition.requestDomains).toEqual(['reddit.com'])
    expect(fake.alarms.get(ALARM)).toEqual({ when: NOW + BLOCK_MS, periodInMinutes: 1 })
  })

  it('records the publishing document, and the block it published, as the lease', async () => {
    const fake = await boot()

    await send(fake, running('seg-a'), monoPage('doc-a', 7))

    // The segment is in there because a lease that cannot name its block would
    // survive a failed handover and speak for the next one. The tab is in there
    // for delivery, and is never consulted for authority.
    expect(leaseIn(fake)).toEqual({ segmentId: 'seg-a', documentId: 'doc-a', tabId: 7 })
  })

  /**
   * A granted host gets the reminder page; an ungranted one gets a plain block
   * and Chrome's own error page. The lookup happens in the worker on every
   * materialise, because a grant can be revoked from Chrome's settings without
   * the extension being told anything it could have cached.
   */
  it('redirects only the hosts it holds permission for', async () => {
    const fake = await boot({
      local: { hosts: ['reddit.com', 'news.ycombinator.com'] },
      granted: [originPatternFor('reddit.com')],
    })

    await send(fake, running('seg-a'), monoPage('doc-a'))

    expect(fake.rules().map((rule) => rule.action.type)).toEqual(['redirect', 'block'])
  })

  /**
   * The escape route. Blocking ends by asking Mono to abandon the block, so a
   * rule that matches Mono blocks the way out of itself — and the entry that
   * does it need not name Mono at all, because `requestDomains` covers
   * subdomains. The carve-out is in every rule for exactly that reason.
   */
  it('never installs a rule that could match Mono, even for a parent domain', async () => {
    const fake = await boot({ local: { hosts: ['github.io'] } })

    await send(fake, running('seg-a'), monoPage('doc-a'))

    expect(fake.rules()[0]?.condition.requestDomains).toEqual(['github.io'])
    expect(fake.rules()[0]?.condition.excludedRequestDomains).toContain('sadeeptha-b.github.io')
  })

  it('arms nothing for a page that is not Mono', async () => {
    const fake = await boot()

    await send(fake, running('seg-a'), { origin: 'https://evil.example', documentId: 'doc-x' })

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })
})

describe('stopping', () => {
  it('tears the rules down on a stop naming the armed block', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    await send(fake, stopped('seg-a'), monoPage('doc-a'))

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
    expect(leaseIn(fake)).toBeNull()
  })

  it('does not read the lease before a self-scoped stop tears rules down', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.failNext('session.get', (key) => key === 'lease')

    await send(fake, stopped('seg-a'), monoPage('doc-b', 2))

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('does not read pending-end housekeeping before tearing rules down', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.session.pendingEndFor = 'seg-a'
    fake.failNext('session.get', (key) => key === 'pendingEndFor')

    await fake.dispatch({ kind: 'intent', intent: stopped('seg-a') }, monoPage('doc-a'))
    // Drain through status rather than hello: hello legitimately reads the
    // pending request and would consume the injected failure after disarm.
    await fake.dispatch({ kind: 'getStatus' }, ourPage())

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  it('ignores a stop naming a block that has already been replaced', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    await send(fake, running('seg-b', NOW + 1000), monoPage('doc-a'))

    // The stale tab's own reconciler, announcing the end of a block that is over.
    await send(fake, stopped('seg-a'), monoPage('doc-c', 2))

    expect(armedIn(fake)?.segmentId).toBe('seg-b')
    expect(fake.rules()).toHaveLength(1)
  })
})

/**
 * The failure the publisher claim exists for. Every one of these disarmed a
 * genuinely running block before it, and none of them needs anything unusual —
 * a second tab is an ordinary thing to have open, and Mono deliberately keeps
 * running when `localStorage` refuses a write.
 */
describe('a second tab cannot unblock the first', () => {
  it('ignores an anonymous stop from a document that armed nothing', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    // A fresh tab whose store rehydrated an empty day, because the running tab's
    // write failed or a stale tab had overwritten the log.
    await send(fake, stopped(null), monoPage('doc-b', 2))

    expect(armedIn(fake)?.segmentId).toBe('seg-a')
    expect(fake.rules()).toHaveLength(1)
    expect(leaseIn(fake)?.documentId).toBe('doc-a')
  })

  it('ignores an expired running intent from another document', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    // Validation refuses a block that has already ended, and the refusal used to
    // become an unconditional stop. It is now only as strong as its sender.
    await send(fake, running('seg-old', NOW - BLOCK_MS, NOW - 1), monoPage('doc-c', 2))

    expect(armedIn(fake)?.segmentId).toBe('seg-a')
    expect(fake.rules()).toHaveLength(1)
  })

  it('ignores a message it cannot read at all from another document', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    await send(fake, { channel: BLOCKING_CHANNEL, v: 99, nonsense: true }, monoPage('doc-b', 2))

    expect(armedIn(fake)?.segmentId).toBe('seg-a')
  })

  it('ignores a block that began before the one armed', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-b', NOW + 1000), monoPage('doc-a', 1))

    await send(fake, running('seg-a', NOW), monoPage('doc-c', 2))

    expect(armedIn(fake)?.segmentId).toBe('seg-b')
  })

  /** The other half: the claim must not become a lock the real publisher cannot open. */
  it('still honours an anonymous stop from the document that armed it', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    await send(fake, stopped(null), monoPage('doc-a'))

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('fails open when the lease needed to judge an anonymous stop is unreadable', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.failNext('session.get', (key) => key === 'lease')

    await send(fake, stopped(null), monoPage('doc-a'))

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('hands the claim to a newer block, and the old publisher loses its say', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    await send(fake, running('seg-b', NOW + 1000), monoPage('doc-b', 2))
    expect(leaseIn(fake)).toEqual({ segmentId: 'seg-b', documentId: 'doc-b', tabId: 2 })

    await send(fake, stopped(null), monoPage('doc-a', 1))
    expect(armedIn(fake)?.segmentId).toBe('seg-b')
  })

  /**
   * Republishing the armed segment is the re-arming path, so it is accepted —
   * but a segment's start and end come off Mono's log and never change. A
   * "repeat" that disagrees is something claiming an armed block's name for
   * different times, and the only thing that could buy is a longer block.
   */
  it('ignores the armed segment republished with a longer end', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    const stretched = { ...running('seg-a'), endsAt: NOW + 3 * 60 * 60_000 }
    await send(fake, stretched, monoPage('doc-b', 2))

    expect(armedIn(fake)?.endsAt).toBe(NOW + BLOCK_MS)
    expect(fake.alarms.get(ALARM)?.when).toBe(NOW + BLOCK_MS)
  })
})

/**
 * Every sequence here is several awaits long and any of them can be refused. The
 * ordering of those writes is a decision about which half-finished state is left
 * behind, and a decision like that is only tested by stopping the sequence
 * halfway — mutation testing does not reach it, because the code is correct and
 * it is the order that would be wrong.
 */
describe('when a write is refused halfway through', () => {
  /**
   * Arming a block and recording its publisher are two writes. Storing a bare
   * document id made the second failure dangerous: the previous block's owner
   * stayed in place, holding authority over a block it had never heard of, and
   * the tab that genuinely published the new one was locked out of it. A lease
   * that names its segment cannot express that — it applies to the block it
   * names or to nothing.
   */
  it('leaves authority with nobody, not with the previous publisher', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    failLeaseWrite(fake)
    await send(fake, running('seg-b', NOW + 1000), monoPage('doc-b', 2))

    // The block changed hands; the record of who holds it did not.
    expect(armedIn(fake)?.segmentId).toBe('seg-b')
    expect(leaseIn(fake)?.segmentId).toBe('seg-a')

    // doc-b published this block. A bare document id would have left doc-a
    // recorded as the publisher and refused doc-b its own block.
    await send(fake, stopped(null), monoPage('doc-b', 2))
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  /**
   * Blocked with nothing left that intends to stop it is the failure worth
   * ordering against, so the alarm is secured before any rule is installed.
   */
  it('installs no rules when the expiry alarm cannot be scheduled', async () => {
    const fake = await boot()

    fake.failNext('alarms.create')
    await send(fake, running('seg-a'), monoPage('doc-a'))

    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
  })

  it('still removes the rules when tidying the lease away afterwards fails', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    failLeaseWrite(fake)
    await send(fake, stopped('seg-a'), monoPage('doc-a'))

    // The lease is housekeeping and goes last, so a refusal there cannot stand
    // in front of the one operation that matters. It used to go second.
    expect(fake.rules()).toHaveLength(0)
    expect(armedIn(fake)).toBeNull()
  })

  it('records the lease when DNR succeeds but retry-alarm cleanup fails', async () => {
    const fake = await boot()
    fake.alarms.set(RETRY_ALARM, { periodInMinutes: 1 })
    fake.failNext('alarms.clear', (name) => name === RETRY_ALARM)

    await send(fake, running('seg-a'), monoPage('doc-a'))

    expect(fake.rules()).toHaveLength(1)
    expect(leaseIn(fake)?.documentId).toBe('doc-a')
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)
  })

  it('finishes disarm housekeeping when retry-alarm cleanup fails', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.alarms.set(RETRY_ALARM, { periodInMinutes: 1 })
    fake.failNext('alarms.clear', (name) => name === RETRY_ALARM)

    await send(fake, stopped('seg-a'), monoPage('doc-a'))

    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
    expect(leaseIn(fake)).toBeNull()
  })

  it('keeps the repeating alarm when the rules could not be removed, and retries', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    fake.failNext('rules.update')
    await send(fake, stopped('seg-a'), monoPage('doc-a'))

    // Clearing the alarm first would have thrown away the only thing left that
    // was going to try again.
    expect(fake.rules()).toHaveLength(1)
    expect(fake.alarms.has(ALARM)).toBe(true)

    fake.fireAlarm(ALARM)
    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
  })

  it('keeps the rules and block-end alarm when clearing the armed record is refused', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.failNext(
      'local.set',
      (items) => typeof items === 'object' && items !== null && 'armed' in items,
    )

    await send(fake, stopped('seg-a'), monoPage('doc-a'))

    expect(armedIn(fake)?.segmentId).toBe('seg-a')
    expect(fake.rules()).toHaveLength(1)
    expect(fake.alarms.has(ALARM)).toBe(true)

    vi.setSystemTime(NOW + BLOCK_MS + 60_000)
    fake.fireAlarm(ALARM)
    await settle(fake)

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
  })
})

describe('expiry', () => {
  /**
   * Chrome may delay an alarm by an arbitrary amount, so this is not a test that
   * it fires on time — nothing can promise that. It is a test that the firing,
   * whenever it lands, both clears the rules and stops the repetition.
   */
  it('clears the rules and the repeating alarm once the block has expired', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()).toHaveLength(1)

    vi.setSystemTime(NOW + BLOCK_MS + 60_000)
    fake.fireAlarm(ALARM)
    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
    expect(armedIn(fake)).toBeNull()
  })

  it('clears an end request for a block that has provably expired', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.session.pendingEndFor = 'seg-a'

    vi.setSystemTime(NOW + BLOCK_MS + 60_000)
    fake.fireAlarm(ALARM)
    await settle(fake)

    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  it('leaves a block that is still running alone when the alarm fires early', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    vi.setSystemTime(NOW + 60_000)
    fake.fireAlarm(ALARM)
    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    expect(fake.alarms.has(ALARM)).toBe(true)
    // Reconciling re-arms from a stored record, which is nobody speaking. It
    // must not touch the claim: rewriting it here would either erase the owner
    // or invent one every time the alarm ticked.
    expect(leaseIn(fake)?.documentId).toBe('doc-a')
  })

  it('ignores an alarm that is not its own', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    vi.setSystemTime(NOW + BLOCK_MS + 60_000)
    fake.fireAlarm('something.else')
    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
  })
})

/**
 * The one thing that runs without being asked. Session rules survive worker
 * suspension, so re-materialising on every wake would be work for nothing. The
 * audit remains read-only when healthy, but neither an alarm nor a rule may be
 * used as evidence that the other survived a disable, reload, or interruption.
 */
describe('worker start', () => {
  it('restricts local storage to trusted extension contexts', async () => {
    const fake = await boot()
    await settle(fake)

    expect(fake.localAccessLevel()).toBe('TRUSTED_CONTEXTS')
  })

  it('continues when applying the storage access boundary is refused', async () => {
    vi.resetModules()
    const fake = installFakeChrome({ local: { hosts: ['reddit.com'] } })
    fake.failNext('storage.access')
    await import('./background')
    await settle(fake)

    expect(fake.localAccessLevel()).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it.each(['missing', 'throws'] as const)(
    'continues when applying the storage access boundary is %s',
    async (storageAccess) => {
      vi.resetModules()
      const fake = installFakeChrome({ storageAccess })

      await import('./background')
      await settle(fake)

      expect(fake.localAccessLevel()).toBeNull()
      expect(fake.rules()).toHaveLength(0)
    },
  )

  it('restores an expiry alarm that went missing while something is armed', async () => {
    const fake = await boot({ local: { armed: running('seg-a'), hosts: ['reddit.com'] } })

    await settle(fake)

    expect(fake.alarms.get(ALARM)).toEqual({ when: NOW + BLOCK_MS, periodInMinutes: 1 })
    expect(fake.rules()).toHaveLength(1)
  })

  it('repairs an armed block whose alarm exists but whose rules are still dirty', async () => {
    const fake = await boot({
      local: { armed: running('seg-a'), hosts: ['reddit.com'], rulesDirty: true },
      alarms: { [ALARM]: { when: NOW + BLOCK_MS, periodInMinutes: 1 } },
    })

    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    expect(fake.local.rulesDirty).toBe(false)
  })

  it('restores rules when an armed block and its alarm survive without them', async () => {
    const fake = await boot({
      local: { armed: running('seg-a'), hosts: ['reddit.com'], rulesDirty: false },
      alarms: { [ALARM]: { when: NOW + BLOCK_MS, periodInMinutes: 1 } },
    })

    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    expect(fake.rules()[0]?.condition.requestDomains).toEqual(['reddit.com'])
  })

  it('does nothing at all when nothing is armed and nothing is installed', async () => {
    const fake = await boot()

    await settle(fake)

    expect(fake.alarms.has(ALARM)).toBe(false)
    expect(fake.rules()).toHaveLength(0)
  })

  /**
   * Session rules outlive worker suspension, so a worker starts into whatever
   * the browser is already enforcing. If the armed record has gone and the rules
   * have not — a removal that was refused, a sequence that stopped halfway — then
   * sites are blocked with nothing behind them, which is the failure this whole
   * design refuses. Until the audit looked, an absent record read as "in order"
   * rather than as "so why is anything installed?".
   */
  it('removes rules left behind with no armed record', async () => {
    const fake = await boot({ rules: rulesForHosts(['reddit.com'], []) })

    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
  })

  it('clears an alarm left behind with no armed record', async () => {
    const fake = await boot({ alarms: { [ALARM]: { when: NOW + BLOCK_MS, periodInMinutes: 1 } } })

    await settle(fake)

    expect(fake.alarms.has(ALARM)).toBe(false)
  })

  it('removes rules left behind by a block that expired while the worker slept', async () => {
    const fake = await boot({
      local: { armed: running('seg-a', NOW - BLOCK_MS, NOW - 1), hosts: ['reddit.com'] },
      rules: rulesForHosts(['reddit.com'], []),
    })

    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
    expect(armedIn(fake)).toBeNull()
  })

  it('does not arm an expired stored block', async () => {
    const fake = await boot({
      local: { armed: running('seg-a', NOW - BLOCK_MS, NOW - 1), hosts: ['reddit.com'] },
    })

    await settle(fake)

    expect(fake.alarms.has(ALARM)).toBe(false)
    expect(fake.rules()).toHaveLength(0)
  })
})

describe('browser restart', () => {
  it('re-installs rules from a stored block that is still running', async () => {
    const fake = await boot({ local: { armed: running('seg-a'), hosts: ['reddit.com'] } })

    fake.fireStartup()
    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    // Session storage went with the browser, so nobody holds the claim. The
    // block is armed on the strength of a record, not of a publisher.
    expect(leaseIn(fake)).toBeNull()
  })

  /**
   * Chrome clears session storage on rather more than a restart — an extension
   * reload, an update, and a disable/enable all do it. Each leaves a locally
   * stored block armed with no living publisher behind it, and each therefore
   * puts the extension in the same fail-open state, where the first page to
   * speak is believed. Documented and tested rather than assumed.
   */
  it('lands in the same no-lease state after an extension reload', async () => {
    const fake = await boot({ local: { armed: running('seg-a'), hosts: ['reddit.com'] } })

    fake.fireInstalled()
    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    expect(leaseIn(fake)).toBeNull()

    await send(fake, stopped(null), monoPage('doc-fresh'))
    expect(armedIn(fake)).toBeNull()
  })

  it('clears a stored block that expired while the browser was closed', async () => {
    const fake = await boot({
      local: { armed: running('seg-a', NOW - BLOCK_MS, NOW - 1), hosts: ['reddit.com'] },
    })

    fake.fireStartup()
    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
    expect(armedIn(fake)).toBeNull()
  })

  /**
   * With no claim held, the first page to load is the best evidence there is.
   * Refusing it here would be the fail-open rule inverted: rules kept up on the
   * strength of a record nothing alive agrees with.
   */
  it('lets the first page to load disarm a restored block it knows nothing about', async () => {
    const fake = await boot({ local: { armed: running('seg-a'), hosts: ['reddit.com'] } })
    fake.fireStartup()
    await settle(fake)

    await send(fake, stopped(null), monoPage('doc-fresh'))

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })
})

/**
 * The hazard `serial` exists for: a start and a stop that arrive together, where
 * the stop clears the rules and the older start then installs the ones it had
 * already computed — leaving someone blocked with nothing running.
 */
describe('ordering', () => {
  it('applies a start and an immediate stop in the order they arrived', async () => {
    const fake = await boot()

    // Both dispatched before either is awaited, which is how Chrome delivers them.
    void fake.dispatch({ kind: 'intent', intent: running('seg-a') }, monoPage('doc-a'))
    void fake.dispatch({ kind: 'intent', intent: stopped('seg-a') }, monoPage('doc-a'))
    await settle(fake)

    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(ALARM)).toBe(false)
  })

  it('leaves the last of several starts armed', async () => {
    const fake = await boot()

    void fake.dispatch({ kind: 'intent', intent: running('seg-a', NOW) }, monoPage('doc-a'))
    void fake.dispatch({ kind: 'intent', intent: running('seg-b', NOW + 1000) }, monoPage('doc-a'))
    void fake.dispatch({ kind: 'intent', intent: running('seg-c', NOW + 2000) }, monoPage('doc-a'))
    await settle(fake)

    expect(armedIn(fake)?.segmentId).toBe('seg-c')
    expect(fake.rules()).toHaveLength(1)
  })
})

describe('a Mono page announcing itself', () => {
  it('still replies with a pending request when remembering the tab is refused', async () => {
    const fake = await boot({ session: { pendingEndFor: 'seg-a' } })
    fake.failNext(
      'session.set',
      (items) => typeof items === 'object' && items !== null && 'monoTabs' in items,
    )

    const reply = (await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))) as {
      endBlockEarlyFor: string | null
    }

    expect(reply.endBlockEarlyFor).toBe('seg-a')
  })

  it('always replies when reading the pending request is refused', async () => {
    const fake = await boot({ session: { monoTabs: [1], pendingEndFor: 'seg-a' } })
    fake.failNext('session.get', (key) => key === 'pendingEndFor')

    const reply = (await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))) as {
      endBlockEarlyFor: string | null
    }

    expect(reply.endBlockEarlyFor).toBeNull()
  })
})

describe('the blocked page asking Mono to end a block', () => {
  it('normalises stored tab ids before remembering another Mono tab', async () => {
    const fake = await boot({ session: { monoTabs: [1, 1, 2.5, -1, '2', null] } })

    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))

    expect(fake.session.monoTabs).toEqual([1, 2])
  })

  it('records the request and tells every known Mono tab', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.session.pendingEndFor).toBe('seg-a')
    // Every tab, not the first to answer: with two open, the first may be a
    // background one whose store is in a different state.
    expect(fake.tabMessages.map((sent) => sent.tabId)).toEqual([1, 2])
    expect(fake.tabMessages[0]?.documentId).toBe('doc-a')
    expect(fake.tabMessages[1]?.documentId).toBeUndefined()
  })

  it('fails open after best-effort delivery when the pending write is refused', async () => {
    const fake = await boot({ tabs: [1] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    fake.failNext(
      'session.set',
      (items) => typeof items === 'object' && items !== null && 'pendingEndFor' in items,
    )

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.tabMessages.map((sent) => sent.tabId)).toEqual([1])
    expect(fake.focused).toEqual([1])
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  it('does not open a page that can re-arm after the pending write is refused', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-b', 2))
    fake.fireTabRemoved(2)
    await settle(fake)
    fake.failNext(
      'session.set',
      (items) => typeof items === 'object' && items !== null && 'pendingEndFor' in items,
    )

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.openedUrls).toHaveLength(0)
    expect(fake.session.pendingEndFor).toBeUndefined()
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  /**
   * Broadcasting to every tab is right; focusing whichever id happens to sit
   * first in an insertion-ordered list is not. The tab to bring forward is the
   * one that armed this block — that is where the user was working, and its
   * store is the one about to record the block as cut short.
   */
  it('brings the tab that armed the block forward, not the first one it knows', async () => {
    const fake = await boot({ tabs: [1, 2] })

    // Tab 1 announces itself first, so it leads the list...
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))
    // ...but tab 2 is the one that actually started the block.
    await send(fake, running('seg-a'), monoPage('doc-b', 2))
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.tabMessages.map((sent) => sent.tabId)).toEqual([2, 1])
    expect(fake.focused).toEqual([2])
  })

  it('fails open through a fresh page when publisher delivery rejects', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))
    await send(fake, running('seg-a'), monoPage('doc-b', 2))
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))

    fake.killTab(2)
    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    // The surviving tab may hold an idle in-memory session, so delivery there
    // is not progress. The explicit escape removes DNR and opens a clean page.
    expect(fake.tabMessages).toHaveLength(0)
    expect(fake.focused).toHaveLength(0)
    expect(fake.openedUrls).toHaveLength(1)
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
    expect(fake.session.pendingEndFor).toBe('seg-a')

    const hello = (await fake.dispatch({ kind: 'hello' }, monoPage('doc-c', 9000))) as {
      endBlockEarlyFor: string | null
    }
    expect(hello.endBlockEarlyFor).toBe('seg-a')

    // If canonical app storage cannot rehydrate the block, the fresh page's
    // idle publication still settles the preserved request after fail-open.
    await send(fake, stopped(null), monoPage('doc-c', 9000))
    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  it('does not mistake a replacement document in the publisher tab for the publisher', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 2))

    // Reload replaces Chrome's document id without replacing its tab id.
    fake.setTabDocument(2, 'doc-b')
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))
    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.tabMessages).toHaveLength(0)
    expect(fake.openedUrls).toHaveLength(1)
    expect(fake.session.pendingEndFor).toBe('seg-a')
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('marks a removed publisher undeliverable without stopping its block', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))
    await send(fake, running('seg-a'), monoPage('doc-b', 2))

    fake.fireTabRemoved(2)
    await settle(fake)

    expect(leaseIn(fake)).toEqual({ segmentId: 'seg-a', documentId: 'doc-b', tabId: null })
    expect(armedIn(fake)?.segmentId).toBe('seg-a')
    expect(fake.rules()).toHaveLength(1)

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.tabMessages).toHaveLength(0)
    expect(fake.openedUrls).toHaveLength(1)
    expect(fake.rules()).toHaveLength(0)
  })

  /**
   * An interstitial is an ordinary page and can sit in a background tab across
   * the end of the block that produced it and the start of the next one.
   * Resolving "which block" at receive time would end the one just started.
   */
  it('refuses a request naming a block that is no longer armed', async () => {
    const fake = await boot()
    await send(fake, running('seg-b', NOW + 1000), monoPage('doc-a', 1))

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.session.pendingEndFor).toBeUndefined()
    expect(fake.tabMessages).toHaveLength(0)
    // Sent to the app anyway: asking to stop and being sent nowhere is its own
    // kind of broken.
    expect(fake.focused).toContain(1)
  })

  it('still opens Mono when stale-rule reconciliation is refused', async () => {
    const fake = await boot()
    await send(fake, running('seg-b'), monoPage('doc-a', 1))
    fake.failNext('rules.update')

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.focused).toContain(1)
    expect(fake.openedUrls).toHaveLength(0)
    expect(armedIn(fake)?.segmentId).toBe('seg-b')
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)
  })

  it('does not open a duplicate after delivery when only window focus fails', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    fake.failNext('windows.update')

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    expect(fake.tabMessages.map((sent) => sent.tabId)).toEqual([1])
    expect(fake.focused).toEqual([1])
    expect(fake.openedUrls).toHaveLength(0)
    expect(fake.session.monoTabs).toEqual([1])
    expect(fake.session.pendingEndFor).toBe('seg-a')
    expect(armedIn(fake)).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('keeps trying known tabs when forgetting a dead one is refused', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    await fake.dispatch({ kind: 'hello' }, monoPage('doc-b', 2))
    fake.killTab(1)
    fake.failNext(
      'session.set',
      (items) => typeof items === 'object' && items !== null && 'monoTabs' in items,
    )

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'older-segment' }, ourPage())
    await settle(fake)

    expect(fake.focused).toContain(2)
    expect(fake.openedUrls).toHaveLength(0)
  })

  it('opens a fresh page when reading known routing state is refused', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    fake.failNext('session.get', (key) => key === 'lease')

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'older-segment' }, ourPage())
    await settle(fake)

    expect(fake.openedUrls).toHaveLength(1)
  })

  it('refuses a request from a page that is not one of ours', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a', 1))

    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, monoPage('doc-a', 1))
    await settle(fake)

    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  /**
   * Delivery is not acknowledgement. The request survives until an intent shows
   * the segment it names has actually stopped, so a bridge that could not reach
   * a listening page yet gets another chance on the next hello.
   */
  it('keeps the request until an intent proves the block stopped', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    // A republish of the same block settles nothing.
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    expect(fake.session.pendingEndFor).toBe('seg-a')

    const reply = (await fake.dispatch({ kind: 'hello' }, monoPage('doc-a', 1))) as {
      endBlockEarlyFor: string | null
    }
    expect(reply.endBlockEarlyFor).toBe('seg-a')

    await send(fake, stopped('seg-a'), monoPage('doc-a', 1))
    expect(fake.session.pendingEndFor).toBeUndefined()
  })

  /**
   * An ignored message is not evidence. A stale tab's stop must not settle a
   * request the user made against the block that is genuinely running.
   */
  it('does not let an ignored message settle the request', async () => {
    const fake = await boot({ tabs: [1, 2] })
    await send(fake, running('seg-a'), monoPage('doc-a', 1))
    await fake.dispatch({ kind: 'endBlockEarly', segmentId: 'seg-a' }, ourPage())
    await settle(fake)

    await send(fake, stopped(null), monoPage('doc-b', 2))

    expect(fake.session.pendingEndFor).toBe('seg-a')
  })
})

/**
 * The list and the browser's rules are two writes and cannot be made one, so the
 * worker can end up having saved a list it could not install. Chrome applies a
 * rule update atomically, which means a refusal leaves the *whole* old set in
 * place — and that is the wrong direction for a removal: a site taken off the
 * list goes on being blocked, from a row that is no longer on screen.
 */
describe('editing the blocklist when the rules will not update', () => {
  it('does not claim an addition was stored when local storage refuses it', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    fake.failNext(
      'local.set',
      (items) => typeof items === 'object' && items !== null && 'hosts' in items,
    )
    const answered = (await fake.dispatch(
      { kind: 'setHosts', hosts: ['reddit.com', 'x.com'] },
      ourPage(),
    )) as SetHostsReply

    expect(answered).toEqual({ stored: false })
    expect(fake.local.hosts).toEqual(['reddit.com'])
    expect(fake.rules()).toHaveLength(1)
    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)
  })

  it('does not claim a deletion was stored when local storage refuses it', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    fake.failNext(
      'local.set',
      (items) => typeof items === 'object' && items !== null && 'hosts' in items,
    )
    const answered = (await fake.dispatch({ kind: 'setHosts', hosts: [] }, ourPage())) as SetHostsReply

    expect(answered).toEqual({ stored: false })
    expect(fake.local.hosts).toEqual(['reddit.com'])
    expect(fake.rules()).toHaveLength(1)
    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)
  })

  it('answers the popup rather than leaving it waiting, and says it did not take', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    fake.failNext('rules.update')
    const answered = await fake.dispatch({ kind: 'setHosts', hosts: [] }, ourPage())

    expect(answered).toEqual({ stored: true, applied: false, retryScheduled: true })
    // Storage agrees the site is gone; the browser is still enforcing it.
    expect(fake.local.hosts).toEqual([])
    expect(fake.rules()).toHaveLength(1)
  })

  it('schedules a retry, because nothing else would notice', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    fake.failNext('rules.update')
    await fake.dispatch({ kind: 'setHosts', hosts: [] }, ourPage())

    // The expiry alarm fires at the end of the block, not during it, so it is
    // no use here — and a list can be edited with no block running at all.
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)

    fake.fireAlarm(RETRY_ALARM)
    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)
  })

  it('reports the same when several hosts change at once', async () => {
    const fake = await boot({ local: { hosts: ['reddit.com', 'x.com'] } })
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()).toHaveLength(2)

    fake.failNext('rules.update')
    const answered = await fake.dispatch(
      { kind: 'setHosts', hosts: ['news.ycombinator.com'] },
      ourPage(),
    )

    expect(answered).toEqual({ stored: true, applied: false, retryScheduled: true })
    expect(fake.rules().map((rule) => rule.condition.requestDomains)).toEqual([
      ['reddit.com'],
      ['x.com'],
    ])
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)
  })

  it('retries a permission change that could not be materialised', async () => {
    const fake = await boot({ granted: [originPatternFor('reddit.com')] })
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()[0]?.action.type).toBe('redirect')

    fake.revoke(originPatternFor('reddit.com'))
    fake.failNext('rules.update')
    fake.firePermissionRemoved()
    await settle(fake)

    // A redirect rule for a host with no permission installs and matches
    // nothing, so this is the silent-failure case the retry has to reach.
    expect(fake.rules()[0]?.action.type).toBe('redirect')
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)

    fake.fireAlarm(RETRY_ALARM)
    await settle(fake)

    expect(fake.rules()[0]?.action.type).toBe('block')
    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)
  })

  it('leaves no retry behind when the update succeeds', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    await fake.dispatch({ kind: 'setHosts', hosts: ['x.com'] }, ourPage())

    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)
  })

  it('reports success when only retry-alarm cleanup fails', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.alarms.set(RETRY_ALARM, { periodInMinutes: 1 })
    fake.failNext('alarms.clear', (name) => name === RETRY_ALARM)

    const answered = (await fake.dispatch(
      { kind: 'setHosts', hosts: ['x.com'] },
      ourPage(),
    )) as SetHostsReply

    expect(answered).toEqual({ stored: true, applied: true })
    expect(fake.rules()[0]?.condition.requestDomains).toEqual(['x.com'])
    expect(fake.local.rulesDirty).toBe(false)
    expect(fake.alarms.has(RETRY_ALARM)).toBe(true)
  })

  it('keeps durable repair evidence when DNR and retry-alarm creation both fail', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.failNext('rules.update')
    fake.failNext('alarms.create', (name) => name === RETRY_ALARM)

    const answered = (await fake.dispatch(
      { kind: 'setHosts', hosts: ['x.com'] },
      ourPage(),
    )) as SetHostsReply

    expect(answered).toEqual({ stored: true, applied: false, retryScheduled: false })
    expect(fake.local.rulesDirty).toBe(true)
    expect(fake.alarms.has(RETRY_ALARM)).toBe(false)

    const restarted = await boot({
      local: { ...fake.local },
      rules: fake.rules(),
      alarms: Object.fromEntries(fake.alarms),
    })
    await settle(restarted)

    expect(restarted.rules()[0]?.condition.requestDomains).toEqual(['x.com'])
    expect(restarted.local.rulesDirty).toBe(false)
  })

  it('treats a failed desired-state read as a pending projection', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    fake.failNext('local.get', (keys) => keys === 'armed')

    const answered = (await fake.dispatch(
      { kind: 'setHosts', hosts: ['x.com'] },
      ourPage(),
    )) as SetHostsReply

    expect(answered).toEqual({ stored: true, applied: false, retryScheduled: true })
    expect(fake.local.rulesDirty).toBe(true)
    expect(fake.rules()[0]?.condition.requestDomains).toEqual(['reddit.com'])
  })
})

describe('the popup', () => {
  it('answers explicitly when canonical status cannot be read', async () => {
    const fake = await boot()
    fake.failNext('local.get', (keys) => keys === 'hosts')

    const reply = (await fake.dispatch({ kind: 'getStatus' }, ourPage())) as GetStatusReply

    expect(reply).toEqual({ available: false })
  })

  it('re-materialises rules when the blocklist changes mid-block', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()).toHaveLength(1)

    await fake.dispatch({ kind: 'setHosts', hosts: ['reddit.com', 'x.com'] }, ourPage())

    expect(fake.rules()).toHaveLength(2)
    expect(fake.local.hosts).toEqual(['reddit.com', 'x.com'])
  })

  it('reconciles before answering, so asking is itself a cleanup path', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))

    vi.setSystemTime(NOW + BLOCK_MS + 1)
    const reply = (await fake.dispatch({ kind: 'getStatus' }, ourPage())) as StatusReply

    expect(reply.armed).toBeNull()
    expect(fake.rules()).toHaveLength(0)
  })

  it('reports which hosts will show the reminder', async () => {
    const fake = await boot({
      local: { hosts: ['reddit.com', 'x.com'] },
      granted: [originPatternFor('x.com')],
    })

    const reply = (await fake.dispatch({ kind: 'getStatus' }, ourPage())) as StatusReply

    expect(reply.hosts).toEqual(['reddit.com', 'x.com'])
    expect(reply.redirectable).toEqual(['x.com'])
  })

  it('treats a parent host grant as permission for its listed child', async () => {
    const parentPattern = originPatternFor('reddit.com')
    const fake = await boot({
      local: { hosts: ['reddit.com', 'old.reddit.com'] },
      granted: [parentPattern],
    })

    const before = (await fake.dispatch({ kind: 'getStatus' }, ourPage())) as StatusReply
    expect(before.redirectable).toEqual(['reddit.com', 'old.reddit.com'])

    fake.revoke(parentPattern)
    const after = (await fake.dispatch({ kind: 'getStatus' }, ourPage())) as StatusReply
    expect(after.redirectable).toEqual([])
  })
})

describe('permission changes', () => {
  /**
   * Chrome offers no way to learn about a revocation other than being told.
   * Without this, a grant taken away from Chrome's own settings would leave a
   * redirect rule installed that quietly stops matching — the silent failure
   * that host access is asked for one site at a time to avoid.
   */
  it('demotes a host to a plain block when its grant is revoked', async () => {
    const fake = await boot({ granted: [originPatternFor('reddit.com')] })
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()[0]?.action.type).toBe('redirect')

    fake.revoke(originPatternFor('reddit.com'))
    fake.firePermissionRemoved()
    await settle(fake)

    expect(fake.rules()).toHaveLength(1)
    expect(fake.rules()[0]?.action.type).toBe('block')
  })

  it('promotes a host to the reminder page when a grant arrives mid-block', async () => {
    const fake = await boot()
    await send(fake, running('seg-a'), monoPage('doc-a'))
    expect(fake.rules()[0]?.action.type).toBe('block')

    fake.grant(originPatternFor('reddit.com'))
    fake.firePermissionAdded()
    await settle(fake)

    expect(fake.rules()[0]?.action.type).toBe('redirect')
  })

  it('installs nothing on a permission change while no block is running', async () => {
    const fake = await boot({ granted: [originPatternFor('reddit.com')] })

    fake.firePermissionAdded()
    await settle(fake)

    expect(fake.rules()).toHaveLength(0)
  })
})
