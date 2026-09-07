/**
 * What the extension remembers, and where.
 *
 * The service worker is killed after thirty seconds idle, so nothing lives in a
 * global. Every read here goes to `chrome.storage`, and the split between its
 * two areas is a deliberate design decision rather than a convenience:
 *
 * - **`local`** holds the armed block, the blocklist, and whether those desired
 *   values may still need projecting into DNR. All three have to survive the
 *   browser being closed and reopened. That is what lets a block that is
 *   genuinely still running be re-armed on `onStartup`, and an interrupted
 *   update be retried on a later worker start.
 * - **`session`** holds the tabs Mono is open in, any pending request, and the
 *   lease on the armed block, because all three are facts about this run of the
 *   browser and a stale one is worse than none. The lease especially: a claim
 *   surviving a restart would be held by a document that no longer exists, and
 *   nothing could ever displace it. Chrome clears this area on rather more than
 *   a restart — an extension reload, an update, and a disable/enable all count
 *   — which is why nothing may depend on a lease being there.
 *
 * The armed record carries `endsAt` and nothing derived from it. Anything that
 * needs to know how long is left subtracts, every time; there is no countdown
 * stored anywhere in this extension, for the same reason there is none in the
 * app.
 *
 * **Storage is treated as data from outside.** `readArmed` runs what it finds
 * through `readBlockingIntent`, `readHosts` normalises and deduplicates every
 * string before it can become a rule, and `readMonoTabs` admits only unique,
 * non-negative integer ids. A corrupt record, a record written by a future
 * version, or a malformed host must not bypass the checks applied to incoming
 * data. A fail-open design cannot have a back door that fails closed.
 */

import { readBlockingIntent, type BlockingIntent } from '@/contract/blocking'
import type { Ms } from '@/domain/types'
import { normaliseHosts } from './hosts'

/**
 * A block Mono has told us is running.
 *
 * Literally the running arm of `BlockingIntent`, rather than a shape of its
 * own. That is what lets the stored record and the incoming message share one
 * validator: the thing being persisted *is* the thing that was received.
 */
export type ArmedBlock = Extract<BlockingIntent, { running: true }>

/**
 * The claim on the armed block: who armed it, and which block they armed.
 *
 * **The segment is the load-bearing half.** Arming a block and recording its
 * publisher are two writes, and if the second fails the first still happened —
 * so a bare document id would leave the *previous* block's owner in place,
 * holding authority over a block it has never heard of.
 *
 * Naming the segment makes that impossible to express. A lease is only a claim
 * on the block it names; against any other armed block it reads as no claim at
 * all, which is the fail-open direction. Nothing has to be cleaned up in the
 * right order, because a stale lease is inert rather than wrong.
 *
 * `tabId` is for delivery and focus only and is never consulted for authority —
 * Chrome reuses a tab id across the reload that replaces the document, which is
 * exactly the case the document id exists to catch.
 */
export type PublisherLease = {
  segmentId: string
  documentId: string
  tabId: number | null
}

type LocalShape = {
  armed?: unknown
  hosts?: unknown
  /** Desired state changed and may not yet be reflected in session rules. */
  rulesDirty?: unknown
}

type SessionShape = {
  monoTabs?: unknown
  /**
   * The segment someone asked to end early, if that ask has not yet been
   * answered. A segment id rather than a flag — see `takePending` for why the
   * difference matters.
   */
  pendingEndFor?: string
  /**
   * The claim on the armed block — see `PublisherLease` for why it names the
   * segment, and `authority.ts` for what the claim buys.
   */
  lease?: unknown
}

/**
 * The armed block, if there genuinely is one.
 *
 * Returns `null` for absent, malformed, expired, or implausibly far in the
 * future. Every one of those is "nothing is running", which is the direction
 * this extension is required to fail in.
 */
export async function readArmed(now: Ms): Promise<ArmedBlock | null> {
  const { armed } = (await chrome.storage.local.get('armed')) as LocalShape
  const intent = readBlockingIntent(armed, now)
  return intent !== null && intent.running ? intent : null
}

export async function writeArmed(armed: ArmedBlock | null): Promise<void> {
  // One storage call is the transaction boundary: if it resolves, both the
  // desired state and the evidence that it needs projecting are durable.
  await chrome.storage.local.set({ armed, rulesDirty: true } satisfies LocalShape)
}

export async function readHosts(): Promise<string[]> {
  const { hosts } = (await chrome.storage.local.get('hosts')) as LocalShape
  return Array.isArray(hosts)
    ? normaliseHosts(hosts.filter((host): host is string => typeof host === 'string'))
    : []
}

export async function writeHosts(hosts: string[]): Promise<void> {
  await chrome.storage.local.set({
    hosts: normaliseHosts(hosts),
    rulesDirty: true,
  } satisfies LocalShape)
}

/** Whether a completed desired-state write still needs projecting into DNR. */
export async function readRulesDirty(): Promise<boolean> {
  const { rulesDirty } = (await chrome.storage.local.get('rulesDirty')) as LocalShape
  return rulesDirty === true
}

/** Record an external desired-state change, such as a host permission event. */
export async function markRulesDirty(): Promise<void> {
  await chrome.storage.local.set({ rulesDirty: true } satisfies LocalShape)
}

/**
 * Record a successful projection.
 *
 * A refusal is harmless: leaving the bit set causes one redundant future
 * reconciliation, while clearing it before DNR succeeds could lose a repair.
 */
export async function clearRulesDirty(): Promise<void> {
  await chrome.storage.local.set({ rulesDirty: false } satisfies LocalShape)
}

export async function readMonoTabs(): Promise<number[]> {
  const { monoTabs } = (await chrome.storage.session.get('monoTabs')) as SessionShape
  if (!Array.isArray(monoTabs)) return []

  return [
    ...new Set(
      monoTabs.filter(
        (tabId): tabId is number =>
          typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0,
      ),
    ),
  ]
}

/**
 * Remember a tab Mono is open in.
 *
 * This is how the extension reaches the app without asking for the `tabs`
 * permission, which would hand it the URL of every tab the user has open in
 * exchange for being able to find one. The content script announces itself, we
 * keep the id, and a stale id costs one failed `sendMessage` that we already
 * handle. A focus timer has no business holding a list of everywhere you go.
 */
export async function rememberMonoTab(tabId: number): Promise<void> {
  const tabs = await readMonoTabs()
  if (tabs.includes(tabId)) return
  await chrome.storage.session.set({ monoTabs: [...tabs, tabId] } satisfies SessionShape)
}

export async function forgetMonoTab(tabId: number): Promise<void> {
  const tabs = await readMonoTabs()
  if (!tabs.includes(tabId)) return
  await chrome.storage.session.set({
    monoTabs: tabs.filter((id) => id !== tabId),
  } satisfies SessionShape)
}

/**
 * Which segment, if any, is waiting to be ended early.
 *
 * A *peek*, not a take, and that is the whole point. The previous version
 * consumed a boolean the moment a content script said hello, which lost the
 * request in a race it could not win: the bridge runs at `document_start` and
 * Mono does not register its listener until its main module evaluates, so the
 * message was posted into a page with nothing listening and the only record of
 * it had already been destroyed.
 *
 * Now the request survives until the block it names actually stops — see
 * `clearPendingIfSettled`. Every hello, and every page that becomes ready, is
 * another chance to deliver it, and delivering twice is harmless because
 * abandoning an already-abandoned block does nothing.
 */
export async function peekPendingEnd(): Promise<string | null> {
  const { pendingEndFor } = (await chrome.storage.session.get('pendingEndFor')) as SessionShape
  return typeof pendingEndFor === 'string' ? pendingEndFor : null
}

export async function setPendingEnd(segmentId: string): Promise<void> {
  await chrome.storage.session.set({ pendingEndFor: segmentId } satisfies SessionShape)
}

export async function clearPendingEnd(): Promise<void> {
  await chrome.storage.session.remove('pendingEndFor')
}

/**
 * The claim on the armed block, if one was ever recorded and still parses.
 *
 * Read defensively for the same reason everything else here is: this came back
 * from storage, and anything that is not a well-formed lease is nobody. Whether
 * a well-formed lease actually *applies* is a separate question, decided by
 * `decideIntent` against the block that is armed — a lease naming some other
 * segment is not this block's owner, however intact it looks.
 */
export async function readLease(): Promise<PublisherLease | null> {
  const { lease } = (await chrome.storage.session.get('lease')) as SessionShape
  if (typeof lease !== 'object' || lease === null) return null

  const { segmentId, documentId, tabId } = lease as Record<string, unknown>
  if (typeof segmentId !== 'string' || segmentId === '') return null
  if (typeof documentId !== 'string' || documentId === '') return null

  const deliveryTabId =
    typeof tabId === 'number' && Number.isInteger(tabId) && tabId >= 0 ? tabId : null
  return { segmentId, documentId, tabId: deliveryTabId }
}

/**
 * Record, or give up, the claim on the armed block.
 *
 * Deliberately not written by `arm`. `reconcile` re-arms from a stored record on
 * an alarm and on startup, and neither of those is a publisher saying anything
 * — a lease written there would be either erased or invented every time the
 * alarm ticked. It changes only where a message is judged, which is
 * `applyIntent`. `disarm` clears it as housekeeping rather than for correctness:
 * with nothing armed, no lease can match anything anyway.
 */
export async function writeLease(lease: PublisherLease | null): Promise<void> {
  await chrome.storage.session.set({ lease } satisfies SessionShape)
}

/**
 * Forget only the delivery address of a publisher whose tab has closed.
 *
 * The document claim remains on purpose. Closing Mono must not stop a block,
 * and turning the lease into "nobody" would let an unrelated idle tab do that.
 * A later explicit end request can see the missing address and fail open. If
 * its named request was persisted, a fresh page can then rehydrate the
 * canonical session and record the abandonment.
 */
export async function detachLeaseFromTab(tabId: number): Promise<void> {
  const lease = await readLease()
  if (lease?.tabId !== tabId) return
  await writeLease({ ...lease, tabId: null })
}

/**
 * Drop the pending request once the segment it names is demonstrably over.
 *
 * This is the acknowledgement the old code did not wait for. `tabs.sendMessage`
 * resolving means a content script received the message — nothing more. It does
 * not mean the page was listening, that the store accepted the action, or that
 * the right tab was reached when several are open. The only honest confirmation
 * is Mono saying, in its own next intent, that this segment is no longer
 * running.
 */
export async function clearPendingIfSettled(intent: BlockingIntent): Promise<void> {
  const pending = await peekPendingEnd()
  if (pending === null) return
  if (intent.running && intent.segmentId === pending) return
  await clearPendingEnd()
}
