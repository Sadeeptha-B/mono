/**
 * The service worker: keep browser rules aligned with the block Mono reports.
 *
 * Everything here follows from one property of the contract. Mono sends an
 * absolute `endsAt` and nothing else, so this worker never counts, never polls
 * and never needs the tab that told it to still exist. It arms rules, schedules
 * a repeating alarm from the block's end, and goes back to sleep. Chrome may
 * delay that alarm, so Mono's stop intent is the prompt path and the alarm is a
 * self-clearing backstop. Nothing needed across worker sleeps is held in memory
 * — see `state.ts`.
 *
 * **Fail open, for the current authority.** A block that fails to arm costs one
 * block. Rules that fail to clear cost the user their browser, with no running
 * app left to explain why, and they will uninstall rather than debug it. So
 * every unclear path here — a malformed message, an unknown contract version, a
 * timestamp outside the clamp, a sender we do not recognise, a stored record
 * that no longer validates — ends in *no rules*, never in leaving the previous
 * ones up.
 *
 * The qualifier is load-bearing. Applied to every sender equally, "unclear
 * means stop" lets a second Mono tab that never heard of the running block tear
 * down rules for a block someone is sitting through. Which messages are trusted
 * from whom lives in `authority.ts` as one pure function; this file gathers the
 * facts and does what it says. Note what ignoring a message costs, because it is
 * not nothing: no rule understands `endsAt`, so a rule comes down only when
 * something reconciles against it, and cleanup can be late by an amount nothing
 * here bounds. The only hard bound is that session rules die with the browser.
 *
 * That is also why these are **session** rules rather than dynamic ones.
 * Dynamic rules persist to disk and survive a crash, which sounds like the
 * safer choice and is the opposite: a crash mid-block would leave a stale rule
 * blocking sites indefinitely with nothing running that knows why. Session
 * rules evaporate when the browser closes, and `reconcile` below puts them back
 * deliberately, from a record it has just revalidated against the clock. Losing
 * the state is the safe direction; restoring it is a decision taken once.
 *
 * **Every mutation is serialised.** `arm`, `disarm` and `materialise` each
 * `await` several times, and the events that trigger them — a message, an
 * alarm, a permission change — arrive independently and were originally started
 * with a bare `void`. That interleaves: a start and an immediately following
 * stop could run so that the stop cleared the rules and the *older* start then
 * installed the ones it had already computed, leaving a user blocked with
 * nothing running. `serial` below is the fix, and everything that touches
 * storage, rules or the alarm goes through it.
 *
 * **Expiry is best-effort, and the alarm is not the only path.** Chrome delays
 * alarms an arbitrary amount and will not fire one sooner than thirty seconds
 * from now whatever `when` says. So the alarm is a backstop, not a guarantee:
 * the rules are also reconciled whenever anything asks this worker a question,
 * at worker start, and `readArmed` treats an expired record as no record. In
 * the ordinary case Mono's own `running: false` arrives first and none of this
 * matters. Nothing here promises removal *at* `endsAt`; the exact fact is the
 * timestamp Mono supplied, and the only hard bound on a rule outstaying its
 * welcome is that session rules do not survive the browser closing.
 *
 * **Order the writes by which failure you would rather have.** Desired-state
 * writes atomically set a durable dirty bit before projection begins. Arming
 * then secures the expiry alarm before any rule is installed, so a half-armed
 * block blocks nothing. Disarming removes the rules before clearing its alarm.
 * A successful atomic DNR update is the success condition; clearing retry
 * evidence afterwards is best-effort housekeeping, because residue only causes
 * a harmless extra convergence.
 */

import { readBlockingIntent, type BlockingIntent } from '@/contract/blocking'
import { applicableLease, decideIntent, type Publisher } from './authority'
import { MONO_APP_URL, MONO_ORIGINS } from './origins'
import { redirectableHosts } from './permissions'
import { rulesForHosts } from './rules'
import {
  clearPendingEnd,
  clearPendingIfSettled,
  clearRulesDirty,
  detachLeaseFromTab,
  forgetMonoTab,
  markRulesDirty,
  peekPendingEnd,
  readArmed,
  readHosts,
  readLease,
  readMonoTabs,
  readRulesDirty,
  rememberMonoTab,
  setPendingEnd,
  writeArmed,
  writeHosts,
  writeLease,
  type ArmedBlock,
  type PublisherLease,
} from './state'
import type {
  GetStatusReply,
  HelloReply,
  MaterialiseResult,
  SetHostsReply,
  StatusReply,
  ToContentScript,
  ToServiceWorker,
} from './messages'

/** One alarm per block, replaced rather than accumulated. */
const BLOCK_ENDS_ALARM = 'mono.blockEnds'

/**
 * The other alarm, requested while installed rules may be out of step with
 * what is stored.
 *
 * `BLOCK_ENDS_ALARM` cannot cover this. It is scheduled for the end of a block,
 * so it does not fire *during* one — and a rule update can be refused when no
 * block is running at all, which is exactly the case where nothing else would
 * ever notice. It is cleared after the next successful update; a failed clear
 * leaves harmless residue, while the persisted dirty bit is the durable repair
 * path when creating this alarm also fails.
 */
const RULES_RETRY_ALARM = 'mono.rulesRetry'

// The bridge has no storage work to do. Keep the user's host list and purpose
// out of the least-trusted extension context even if that changes later.
try {
  const restricted = chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  void restricted?.catch(() => undefined)
} catch {
  // Worker boot is the stronger boundary. The bridge still never reads storage.
}

// -----------------------------------------------------------------------------
// Serialisation
// -----------------------------------------------------------------------------

/**
 * One queue for every change to storage, rules or the alarm.
 *
 * A promise chain rather than a lock, because there is nothing to contend for
 * beyond ordering: the worker is single-threaded, and the hazard is purely that
 * two multi-`await` sequences interleave. Chaining makes the second start only
 * once the first has finished, so the last event to arrive is the one whose
 * effect survives — which is the behaviour the whole design assumes.
 *
 * The tail swallows rejections so one failure cannot wedge the queue, while the
 * returned promise keeps its own rejection for the caller that asked.
 */
let tail: Promise<unknown> = Promise.resolve()

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work)
  tail = next.catch(() => undefined)
  return next
}

// -----------------------------------------------------------------------------
// Arming
// -----------------------------------------------------------------------------

/** Ask Chrome for prompt retries; the dirty bit remains the durable backstop. */
async function scheduleRulesRetry(): Promise<boolean> {
  try {
    await chrome.alarms.create(RULES_RETRY_ALARM, { periodInMinutes: 1 })
    return true
  } catch {
    // The durable dirty bit is the second repair path. If alarm creation is
    // refused as well, a later worker start still knows convergence is due.
    return false
  }
}

/**
 * Ignore failure only for cleanup after the correctness-changing work is done.
 * Each caller must be able to explain why leaving its particular residue is
 * harmless; this helper is not a general error boundary.
 */
async function bestEffort(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // The caller has already classified this particular residue as harmless.
  }
}

/**
 * Put the installed rules in step with what is stored.
 *
 * Replaces every session rule wholesale on each call rather than diffing. The
 * list is a few dozen entries at most, and a diff would be a second model of
 * what is currently installed — one that can be wrong in a way that leaves a
 * rule behind. Reading the real ids back and removing exactly those cannot be.
 *
 * The permission lookup is what decides redirect against block, per host. It is
 * done here rather than cached because a grant can be revoked from Chrome's own
 * settings at any moment, without this extension being told anything it could
 * have stored.
 *
 * Every event reaches this through `serial`, sometimes through `arm`, `disarm`,
 * or `reconcile`; do not start it independently from an event listener.
 */
async function materialise(): Promise<MaterialiseResult> {
  try {
    // Reads belong inside the same failure boundary as the update. A refused
    // read means the desired projection is unknown, not that it is empty.
    const existing = await chrome.declarativeNetRequest.getSessionRules()
    const removeRuleIds = existing.map((rule) => rule.id)

    const armed = await readArmed(Date.now())
    const hosts = armed !== null ? await readHosts() : []
    const addRules = hosts.length > 0 ? rulesForHosts(hosts, await redirectableHosts(hosts)) : []

    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules })
  } catch {
    // Chrome applies a rule update atomically, so a refusal leaves the *old* set
    // installed in full. Preparation failures are equivalent: no safe desired
    // set was available to install. The dirty bit was stored with the desired
    // state, and this alarm is the prompt retry path.
    return { applied: false, retryScheduled: await scheduleRulesRetry() }
  }

  // Once the atomic DNR update resolves, installed and stored agree. These two
  // writes only remove repair evidence. Either may fail without changing that
  // fact: a leftover alarm or dirty bit merely causes a redundant convergence.
  await bestEffort(clearRulesDirty)
  await bestEffort(() => chrome.alarms.clear(RULES_RETRY_ALARM))
  return { applied: true }
}

async function arm(block: ArmedBlock): Promise<void> {
  await writeArmed(block)

  // The alarm is created *before* the rules exist, and that ordering is the
  // whole point. Scheduling can fail, and a rule installed with no expiry event
  // behind it is a user blocked with nothing left that intends to stop it —
  // repaired only by some unrelated later reconciliation, or by closing the
  // browser. Done in this order, the same failure leaves an armed record and an
  // alarm with no rules installed, which blocks nobody and reconciles itself.
  //
  // A backstop, not a guarantee, and it repeats on purpose.
  //
  // Chrome will not fire an alarm sooner than thirty seconds from now however
  // near `when` is, and may delay it an arbitrary amount beyond that. The path
  // that actually ends a block on time is Mono's own `running: false`; this is
  // what happens when Mono is closed.
  //
  // `periodInMinutes` is the part worth keeping. Reconciling when someone asks
  // covers a granted site, whose interstitial pings this worker as its
  // countdown reaches zero — but a site whose permission was declined gets a
  // plain block and Chrome's own error page, which cannot ask anything. With a
  // single one-shot, a failed reconciliation would leave that rule up until the
  // next unrelated extension event. Repeating schedules another attempt every
  // minute, although Chrome may delay any delivery by an arbitrary amount. It
  // stops on its own: the first firing that finds nothing armed calls `disarm`,
  // which clears it.
  await chrome.alarms.create(BLOCK_ENDS_ALARM, { when: block.endsAt, periodInMinutes: 1 })

  const projected = await materialise()
  if (!projected.applied) throw new Error('rules were not applied')
}

/**
 * Take the rules down, in the order that survives a failure best.
 *
 * `writeArmed(null)` first, because `materialise` reads the stored record to
 * decide what should be installed. Then the rules, which is the operation that
 * actually matters. The alarm is cleared only *after* the rules are gone: if
 * removing them failed, the repeating alarm is what will try again, and
 * clearing it first would throw away the retry. The pending end request and
 * lease go last because both are housekeeping — with nothing armed neither can
 * apply to anything, so failing to tidy them changes no decision. The one
 * exception is an explicit escape from a dead publisher: its request is kept so
 * a fresh Mono page can still record the abandonment after rules come down.
 *
 * Not a free ordering to change: put the lease write second and an ordinary
 * refused storage write stands in front of rule removal, leaving every rule up.
 * Refusing `writeArmed(null)` is the unavoidable exception: the desired state
 * cannot change, so the existing rules and block-end alarm remain. The next
 * alarm delivery after `endsAt` is the recovery path; the dirty retry cannot be,
 * because its bit was part of the same refused write.
 */
async function disarm(
  { preservePendingEnd = false }: { preservePendingEnd?: boolean } = {},
): Promise<void> {
  await writeArmed(null)
  const projected = await materialise()
  if (!projected.applied) throw new Error('rules were not removed')

  // All three are inert once no record or rule remains. Refusing any cleanup may
  // cause a redundant future action, but must not reinterpret DNR success.
  await bestEffort(() => chrome.alarms.clear(BLOCK_ENDS_ALARM))
  if (!preservePendingEnd) await bestEffort(clearPendingEnd)
  await bestEffort(() => writeLease(null))
}

/**
 * Judge one message and do what the judgement says.
 *
 * `incoming` is `null` when the message could not be read as an intent at all,
 * and must not be collapsed into an idle intent on the way in. `decideIntent`
 * needs the difference between "nothing is running" and "I could not tell", and
 * needs the sender either way: flattening the two is what let a stale tab
 * republishing an expired block — refused by validation, exactly as intended —
 * disarm a block another tab was running.
 *
 * Never call this directly — go through `serial`.
 */
async function applyIntent(incoming: BlockingIntent | null, sender: Publisher): Promise<void> {
  const armed = await readArmed(Date.now())
  // Running intents and named stops are decided without a lease. Avoid asking
  // fallible session storage for a fact those branches cannot use, especially
  // before a self-scoped stop gets the chance to remove DNR rules.
  const needsLease =
    armed !== null &&
    (incoming === null || (!incoming.running && incoming.stoppedSegmentId === null))
  // An unreadable session lease is the same usable evidence as no lease. It
  // must not give unavailable routing metadata permission to keep rules up.
  const lease = needsLease ? await readLease().catch(() => null) : null
  const decision = decideIntent({
    armed,
    lease,
    incoming,
    sender,
  })

  if (decision.verdict === 'ignore') return

  if (decision.verdict === 'disarm') {
    await disarm()
    return
  }

  // Two writes, and stopping between them is safe because the lease names its
  // segment: the stored lease still names the *previous* block, so it applies to
  // nothing and the next unqualified stop is honoured from anyone. Fail open. A
  // bare document id would fail the other way, leaving the old owner in
  // authority over a block it has never heard of.
  await arm(decision.block)
  try {
    await writeLease(decision.lease)
  } finally {
    // Only an acted-on intent is evidence about a pending request, and settling
    // one is housekeeping. A session read must not stand in front of arming,
    // disarming, or recording the new authority.
    if (incoming !== null) await bestEffort(() => clearPendingIfSettled(incoming))
  }
}

/**
 * Bring rules back in line with a record that has just been revalidated.
 *
 * Runs on install, on browser startup, and before answering any question. A
 * record that no longer validates — expired, corrupt, or written by a version
 * that meant something else by it — is cleared rather than resurrected, because
 * `readArmed` has already declined to return it and rules with nothing behind
 * them are exactly the failure this design refuses.
 *
 * There is deliberately no equivalent of the app's "you were away" question.
 * The app has to ask because banking a block nobody sat through would poison a
 * history that is the whole point of it. Nothing here is a fact about the day —
 * this extension keeps no history and writes nothing back — so an expired block
 * needs no adjudication, only clearing up after.
 *
 * This deliberately rewrites the desired record, expiry alarm and complete DNR
 * projection even when they are already aligned. Every caller is cold — the
 * start-up audit, `onInstalled`, `onStartup`, either alarm, an extension page
 * asking for status, and a refused end-early request — so prefer that simple
 * convergence here, but do not put it on a hot polling path. Note that a
 * permission change is *not* one of them: it goes through `materialise` alone,
 * because a grant changes which rule a host gets and nothing about the arm.
 */
async function reconcile(): Promise<void> {
  const armed = await readArmed(Date.now())

  if (armed === null) {
    await disarm()
    return
  }

  await arm(armed)
}

// -----------------------------------------------------------------------------
// Reaching the app
// -----------------------------------------------------------------------------

/**
 * Which tab currently holds the armed block, if it is one we still know about.
 *
 * Delivery only. Authority is a document and this is a tab, deliberately — the
 * tab survives the reload that replaces the document, which makes it the wrong
 * thing to trust and the right thing to aim at.
 */
async function ownerTabId(): Promise<number | null> {
  const armed = await readArmed(Date.now())
  return applicableLease(armed, await readLease())?.tabId ?? null
}

/** Every known Mono tab, with one moved to the front if it is still there. */
async function orderedTabs(preferred: number | null): Promise<number[]> {
  const tabs = await readMonoTabs()
  if (preferred === null || !tabs.includes(preferred)) return tabs
  return [preferred, ...tabs.filter((tabId) => tabId !== preferred)]
}

/**
 * Honour an explicit, correctly scoped escape when coordination with Mono can
 * no longer be made reliable.
 *
 * Rules come down immediately. If the pending request was persisted, leave it
 * for a fresh page so Mono can still record the abandonment after rehydrating
 * its own canonical session. Without that record, do not open a page that can
 * republish the still-running segment and undo the escape.
 */
async function failOpenEndRequest({ pendingRecorded }: { pendingRecorded: boolean }): Promise<void> {
  try {
    await disarm({ preservePendingEnd: pendingRecorded })
  } finally {
    if (pendingRecorded) await bestEffort(() => chrome.tabs.create({ url: MONO_APP_URL }))
  }
}

/**
 * Ask Mono to end the running block, from the interstitial's one button.
 *
 * Deliberately not a private unblock. This worker could simply drop its rules
 * and let the user through, and that would be a lie the app never finds out
 * about: the block would keep running, the timer would keep counting, and the
 * day would record a completed block nobody sat through. So it routes to the
 * app and lets the app abandon it, which lands in history as cut short — the
 * same thing End early does, because it is the same thing.
 *
 * Two things here were originally wrong in the same way — they treated delivery
 * as agreement.
 *
 * The request is now **recorded against the segment id** and survives until an
 * intent says that segment has stopped. `tabs.sendMessage` resolving proves a
 * content script received a message and nothing else: not that the page had
 * finished loading its own listener, not that the store accepted the action,
 * and not that the tab reached was the one the user is actually working in.
 *
 * While the publisher document is reachable, the request is sent to it first
 * and then to every other known Mono tab. A different page is never promoted to
 * fallback publisher: it may hold a stale in-memory session and reject the
 * right segment. If the real publisher is gone, rules come down immediately. A
 * fresh tab is opened to rehydrate canonical app storage only when the pending
 * request survived that teardown; without that durable request, opening a page
 * that still remembers the running block would simply re-arm it.
 */
async function requestEndBlockEarly(segmentId: string): Promise<void> {
  const armed = await readArmed(Date.now())

  // Nothing is running, or what is running is not what the page was showing.
  //
  // The second case is the one that matters and it is not hypothetical: an
  // interstitial is an ordinary page and can sit in a background tab across the
  // end of the block that produced it and the start of the next one. Resolving
  // "which block" here rather than trusting the page would end the block the
  // user had only just started. So the request is refused, the rules are
  // reconciled — the ones that produced that page are stale either way — and
  // the user is taken to the app, because asking to stop and being sent nowhere
  // is its own kind of broken.
  if (armed === null || armed.segmentId !== segmentId) {
    // Repair is useful but navigation is the user-visible result of refusing
    // this request. A DNR refusal already leaves a dirty marker and retry alarm;
    // it must not consume the click before the user is taken somewhere useful.
    try {
      await reconcile()
    } catch {
      // Navigation below is the fallback; projection repair remains scheduled.
    }
    await openOrFocusMono()
    return
  }

  let pendingRecorded = true
  try {
    await setPendingEnd(armed.segmentId)
  } catch {
    // Delivery can still let a live publisher record the abandonment, but it is
    // no longer durable. It therefore becomes an immediate fail-open after that
    // best-effort delivery rather than a promise the worker can lose.
    pendingRecorded = false
  }

  const message: ToContentScript = { kind: 'endBlockEarly', segmentId: armed.segmentId }

  // Route through the publisher first. Other tabs are retries only while that
  // publisher is alive; they are not substitutes for its in-memory session.
  let owner: PublisherLease | null
  let tabs: number[]
  try {
    owner = applicableLease(armed, await readLease())
    tabs = await readMonoTabs()
  } catch {
    // Session storage is routing metadata, not permission to keep blocking.
    await failOpenEndRequest({ pendingRecorded })
    return
  }

  // No living address for the document that armed this block. An already-open
  // tab can hold a stale in-memory session and reject the request, so do not
  // mistake delivery there for progress. A durable request may be handed to a
  // fresh page after it rehydrates; DNR comes down either way as the explicit
  // escape's fail-open guarantee.
  if (owner === null || owner.tabId === null || !tabs.includes(owner.tabId)) {
    await failOpenEndRequest({ pendingRecorded })
    return
  }

  const publisherTabId = owner.tabId

  try {
    // A tab id survives reload. Address the document holding the claim so a
    // replacement document cannot make delivery look successful.
    await chrome.tabs.sendMessage(publisherTabId, message, { documentId: owner.documentId })
  } catch {
    await bestEffort(() => forgetMonoTab(publisherTabId))
    await failOpenEndRequest({ pendingRecorded })
    return
  }

  for (const tabId of tabs) {
    if (tabId === publisherTabId) continue
    try {
      await chrome.tabs.sendMessage(tabId, message)
    } catch {
      // The tab is gone, or has navigated away from Mono. Not worth reporting:
      // a stale id is the ordinary running cost of not asking for `tabs`.
      await bestEffort(() => forgetMonoTab(tabId))
    }
  }

  // Without a durable request, delivery is only a best effort. Tear down now so
  // a transient session write cannot turn the user's escape into a dead button.
  if (!pendingRecorded) {
    try {
      await disarm()
    } finally {
      await bestEffort(() => focusTab(publisherTabId))
    }
    return
  }

  try {
    await focusTab(publisherTabId)
  } catch {
    // Document-targeted delivery already reached the publisher. Focusing is a
    // usability step, not new evidence about delivery: `tabs.update` can
    // succeed and `windows.update` still fail. Preserve the request and fail
    // open, but do not forget a known-live publisher or open a duplicate tab.
    await disarm({ preservePendingEnd: true })
  }
}

async function openOrFocusMono(): Promise<void> {
  let tabs: number[]
  try {
    tabs = await orderedTabs(await ownerTabId())
  } catch {
    // A routing read cannot remove the final fallback.
    await chrome.tabs.create({ url: MONO_APP_URL })
    return
  }

  for (const tabId of tabs) {
    try {
      await focusTab(tabId)
      return
    } catch {
      await bestEffort(() => forgetMonoTab(tabId))
    }
  }
  await chrome.tabs.create({ url: MONO_APP_URL })
}

async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true })
  if (tab?.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true })
  }
}

// -----------------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------------

const isMonoPage = (sender: chrome.runtime.MessageSender): boolean =>
  sender.origin !== undefined && MONO_ORIGINS.includes(sender.origin)

/**
 * One of our own pages — the popup or the interstitial.
 *
 * Checked by extension origin rather than by the absence of a tab. The
 * interstitial *replaces a navigation*, so it lives in a tab like any page, and
 * an earlier `sender.tab === undefined` test silently refused every message it
 * sent: its countdown never started and its button did nothing.
 */
const isOurOwnPage = (sender: chrome.runtime.MessageSender): boolean =>
  sender.id === chrome.runtime.id && sender.origin === `chrome-extension://${chrome.runtime.id}`

/**
 * One listener for four senders, which is why the sender check is per message
 * kind rather than once at the top.
 *
 * A web page can arm blocking and do nothing else. The interstitial and the
 * popup can ask the app to stop and can edit the list, and can arm nothing.
 * That separation is not theoretical: `intent` is the message that takes a
 * timestamp from outside this extension and turns it into rules, and it is the
 * one worth being strict about.
 */
chrome.runtime.onMessage.addListener((raw, sender, sendResponse): boolean => {
  const message = raw as ToServiceWorker | undefined

  if (message?.kind === 'intent' && isMonoPage(sender)) {
    // Validated against the clock here rather than at the sender, because the
    // sender is the thing being checked. A message that does not read as an
    // intent is still a reason to stop — anything else keeps rules up on the
    // strength of something we could not understand — but only from the page
    // that armed what is running, so the failure is passed along as `null`
    // rather than flattened into an idle intent.
    //
    // `documentId` is Chrome's, not the page's, so it cannot be forged from
    // script. A document rather than a tab because a tab id survives the reload
    // that is half of the failure this guards against.
    const intent = readBlockingIntent(message.intent, Date.now())
    const publisher: Publisher = {
      documentId: sender.documentId ?? null,
      tabId: sender.tab?.id ?? null,
    }
    void serial(() => applyIntent(intent, publisher))
    return false
  }

  if (message?.kind === 'hello' && isMonoPage(sender)) {
    const tabId = sender.tab?.id
    void serial(async () => {
      if (tabId !== undefined) await bestEffort(() => rememberMonoTab(tabId))
      // A peek, not a take. The request has to outlive this reply — the bridge
      // may not be able to deliver it yet, and destroying the only record of it
      // here is exactly how it used to be lost.
      const endBlockEarlyFor = await peekPendingEnd().catch(() => null)
      const reply: HelloReply = { endBlockEarlyFor }
      sendResponse(reply)
    })
    return true
  }

  if (message?.kind === 'endBlockEarly' && isOurOwnPage(sender)) {
    const { segmentId } = message
    if (typeof segmentId !== 'string' || segmentId === '') return false
    void serial(() => requestEndBlockEarly(segmentId))
    return false
  }

  if (message?.kind === 'setHosts' && isOurOwnPage(sender)) {
    void serial(async () => {
      if (!Array.isArray(message.hosts) || !message.hosts.every((host) => typeof host === 'string')) {
        const reply: SetHostsReply = { stored: false }
        sendResponse(reply)
        return
      }

      try {
        await writeHosts(message.hosts)
      } catch {
        const reply: SetHostsReply = { stored: false }
        sendResponse(reply)
        return
      }

      // Back in step immediately, so editing the list during a block takes
      // effect on the next navigation rather than the next block. Persistence
      // and projection are reported separately because only the former decides
      // whether the popup may commit its row.
      const projected = await materialise()
      const reply: SetHostsReply = projected.applied
        ? { stored: true, applied: true }
        : { stored: true, applied: false, retryScheduled: projected.retryScheduled }
      sendResponse(reply)
    })
    return true
  }

  if (message?.kind === 'getStatus' && isOurOwnPage(sender)) {
    void serial(async () => {
      try {
        // Reconcile before answering. The alarm may not have fired yet — Chrome
        // is free to delay it — so this is the moment a page asking about state
        // also becomes the moment stale rules come down.
        let rulesPending = false
        try {
          await reconcile()
        } catch {
          // Status is still useful when projection is pending. The desired
          // state below is canonical; its dirty bit and retry alarm retain the
          // repair, while the popup can keep showing the list honestly.
          rulesPending = true
        }

        const hosts = await readHosts()
        const status: StatusReply = {
          armed: await readArmed(Date.now()),
          hosts,
          redirectable: await redirectableHosts(hosts),
          rulesPending,
        }
        const reply: GetStatusReply = { available: true, ...status }
        sendResponse(reply)
      } catch {
        const reply: GetStatusReply = { available: false }
        sendResponse(reply)
      }
    })
    return true
  }

  return false
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BLOCK_ENDS_ALARM && alarm.name !== RULES_RETRY_ALARM) return
  // Both mean the same thing: what is installed may no longer be what should be.
  void serial(reconcile)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    // The registry and lease are independent session writes; either cleanup
    // must still be attempted if the other one is refused.
    await bestEffort(() => forgetMonoTab(tabId))
    await bestEffort(() => detachLeaseFromTab(tabId))
  })
})

/**
 * A grant given or taken away changes which hosts may be redirected, and Chrome
 * offers no way to learn that other than being told. Without these, revoking a
 * permission from Chrome's own settings would leave a redirect rule installed
 * that quietly stops matching, and granting one mid-block would not take effect
 * until the next block began.
 */
async function reconcilePermissionChange(): Promise<void> {
  let marked = false
  try {
    await markRulesDirty()
    marked = true
  } catch {
    // The permission has already changed outside storage. Still attempt the
    // projection, then make one more effort to leave durable repair evidence.
  }

  const projected = await materialise()
  if (!projected.applied && !marked) await bestEffort(markRulesDirty)
}

chrome.permissions.onAdded.addListener(() => {
  void serial(reconcilePermissionChange)
})

chrome.permissions.onRemoved.addListener(() => {
  void serial(reconcilePermissionChange)
})

chrome.runtime.onInstalled.addListener(() => {
  void serial(reconcile)
})

chrome.runtime.onStartup.addListener(() => {
  void serial(reconcile)
})

/**
 * At worker start: did an earlier mutation finish, and is its expiry covered?
 *
 * The one thing here that runs without being asked, and deliberately not the
 * resume call this file otherwise refuses. Session rules survive worker
 * suspension, so re-materialising on every wake is work for nothing and that
 * prohibition stands. This is an interrupted-write and orphan audit. It does
 * not compare every installed rule on every wake: Chrome already preserves
 * session rules across worker suspension, and desired-state writes leave
 * `rulesDirty` behind until an atomic update succeeds.
 *
 * Two ways they come apart, and both need answering:
 *
 * - **Armed with hosts, but no rule installed; or nothing scheduled to end
 *   it.** Session rules and alarms are different platform state and neither is
 *   evidence that the other survived. An alarm's survival across suspension is
 *   not something an extension may assume — Chrome's own guidance is to check
 *   the alarms you depend on at worker start — and while Mono is closed the
 *   alarm is the only thing that reconciles, so a missing one has no other
 *   repair path. `arm` rather than a bare `alarms.create`, because if the alarm
 *   went missing the rules are worth re-checking too, and it is idempotent.
 * - **Nothing armed, but rules or an alarm still there.** Orphans: the residue
 *   of a sequence that stopped halfway, a removal that was refused, or a record
 *   cleared by something that could not finish tidying up. Rules with nothing
 *   behind them are precisely the failure this design refuses, and until this
 *   audit existed nothing looked for them — the armed record being absent was
 *   read as "in order" rather than as "so why is anything installed?".
 *
 * The ordinary healthy case remains read-only.
 */
void serial(async () => {
  const dirty = await readRulesDirty()

  // A desired-state write completed but its projection may not have. This is
  // checked before the cheap armed/alarm agreement path, which otherwise could
  // mistake an interrupted arm with no rules for a healthy running block.
  if (dirty) {
    await reconcile()
    return
  }

  const armed = await readArmed(Date.now())
  const alarm = await chrome.alarms.get(BLOCK_ENDS_ALARM)

  if (armed !== null) {
    const rules = await chrome.declarativeNetRequest.getSessionRules()
    // No rules is the healthy projection of an empty blocklist, so consult the
    // desired list before treating absence as evidence of a lifecycle eraser.
    const rulesMissing = rules.length === 0 && (await readHosts()).length > 0
    if (alarm === undefined || rulesMissing) await arm(armed)
    return
  }

  const rules = await chrome.declarativeNetRequest.getSessionRules()
  if (rules.length === 0 && alarm === undefined) return

  await disarm()
})
