/**
 * Who is entitled to say that blocking should stop.
 *
 * This is the whole of the worker's judgement, pulled out as one pure function
 * so it can be read and tested without a browser. `background.ts` gathers the
 * facts — what is armed, who holds the lease on it, what just arrived and which
 * document it arrived from — and does what this returns. Nothing here touches
 * `chrome.*`, the clock, or storage.
 *
 * **The rule.** Fail open *for the current authority*; ignore an ambiguous
 * message from an unrelated publisher.
 *
 * The unqualified version — "anything unclear means stop" — is what this
 * replaces, and it is worth knowing why it was not safe. Two Mono tabs hold two
 * independent stores with nothing synchronising them: Mono tolerates a failed
 * `localStorage` write and carries on from memory, and two tabs overwrite the
 * same key. So a second tab that has never heard of the running block can say
 * "nothing is running", and under the unqualified rule that tore down a block
 * someone was sitting through.
 *
 * Three kinds of message, three different amounts of trust:
 *
 * - A **named stop** is *self-scoping*. Not self-authenticating: a segment id is
 *   not a secret and proves nothing about who sent it. What it does is bound the
 *   blast radius — a message naming a block can only ever tear down that block,
 *   so it is harmless from a publisher talking about something else, and no
 *   sender check is needed.
 * - A **running intent** carries `startedAt`, so two of them can be ordered. A
 *   block that began later replaces one that began earlier; the reverse is a
 *   stale tab and is ignored. A repeat of the block already armed is the
 *   re-arming path, and has to agree with it about when that block began and
 *   ends — a "repeat" that disagrees is not the same block being republished.
 *   A matching repeat earns the lease for whichever document sent it, including
 *   a second tab that rehydrated the same shared log. "Last exact proof" is the
 *   rule; the extension cannot distinguish a replacement publisher from a
 *   reload without making tab identity authoritative again.
 * - An **anonymous stop**, and anything that could not be read at all, is
 *   honoured only from the publisher holding the lease on the armed block — or
 *   when nobody holds one.
 *
 * **What ignoring actually costs, stated honestly.** It is tempting to say the
 * worst case is unblocking a moment late, and that is not true. No browser rule
 * understands `endsAt`: rules come down when something reconciles against it,
 * and the alarm that usually does is one Chrome may delay by an arbitrary
 * amount. So ignoring a stop trades a wrong *early* unblock — which is the
 * failure that makes people uninstall a blocker, because their browser is
 * quietly not doing the thing they asked — for a cleanup that may be late by an
 * amount nothing here can bound. That is the right trade, but it is a trade.
 * The one real bound is at the far end: these are session rules, so nothing
 * survives the browser closing.
 *
 * **Why the publisher is a document and not a tab.** `sender.tab.id` is stable
 * across a reload, which is exactly wrong for this. The failure being fixed
 * includes "the tab running the block failed to write, reloaded, and came back
 * knowing nothing" — with a tab id that page is still the owner and still
 * disarms. `sender.documentId` is a fresh UUID per document, so a reloaded page
 * has to earn its authority again by publishing something it can be trusted on.
 * Chrome has supplied it since 106 and the manifest floor is 120. The tab id
 * still travels in the lease, for delivery and focus, and is never consulted
 * here.
 *
 * **Why the lease names a segment.** Arming a block and recording its publisher
 * are two writes and the second can fail. A bare document id would leave the
 * previous block's owner in place, holding authority over a block it has never
 * heard of. A lease that names its segment does not apply to any other block, so
 * a half-finished handover reads as *no owner* — the fail-open direction.
 */

import type { BlockingIntent } from '@/contract/blocking'
import type { ArmedBlock, PublisherLease } from './state'

/**
 * A document, as Chrome identifies it to the worker, or nothing.
 *
 * `null` covers both "this message came from somewhere with no document id" and
 * "nobody holds the claim". They are treated as the same absence on purpose:
 * neither can be matched against the other, so neither can claim ownership.
 */
export type PublisherId = string | null

/** Who sent a message, as far as Chrome will say. */
export type Publisher = {
  documentId: PublisherId
  /** For reaching the page again later. Never consulted for authority. */
  tabId: number | null
}

/** Why a message was not acted on. Carried for tests and for logging, not for control flow. */
export type IgnoreReason =
  /** A stop that names a block other than the one armed. */
  | 'names-another-block'
  /** A running block that began no later than the one already armed. */
  | 'not-newer'
  /** The armed segment again, but disagreeing about when it began or ends. */
  | 'contradicts-armed'
  /** An unqualified stop from a document that holds no claim on this block. */
  | 'not-the-publisher'

export type IntentDecision =
  /** Install rules for this block, and record `lease` as the claim on it. */
  | { verdict: 'arm'; block: ArmedBlock; lease: PublisherLease | null }
  /** Tear the rules down. The claim goes with them. */
  | { verdict: 'disarm' }
  /** Do nothing at all — not even settle a pending request. */
  | { verdict: 'ignore'; because: IgnoreReason }

export type IntentDecisionInput = {
  /** What is armed, already revalidated against the clock by `readArmed`. */
  armed: ArmedBlock | null
  /** The stored claim, which may name a block that is no longer the armed one. */
  lease: PublisherLease | null
  /** The validated intent, or `null` when the message could not be read at all. */
  incoming: BlockingIntent | null
  /** Who sent it. */
  sender: Publisher
}

/**
 * The document that holds a claim on *this* block, if any does.
 *
 * A lease naming some other segment is not evidence about the armed one, and is
 * treated as no claim rather than as a claim to be cleaned up. That is the whole
 * safety property: it makes a stale lease inert instead of wrong, so no sequence
 * of partial writes can leave one block's owner speaking for another's.
 *
 * Exported because the worker needs the other half of it — the tab to bring
 * forward when the blocked page asks Mono to end the block. Same rule, one
 * definition: a lease either applies to what is armed or it is nobody.
 */
export const applicableLease = (
  armed: ArmedBlock | null,
  lease: PublisherLease | null,
): PublisherLease | null =>
  armed !== null && lease !== null && lease.segmentId === armed.segmentId ? lease : null

const leaseFor = (block: ArmedBlock, sender: Publisher): PublisherLease | null =>
  sender.documentId === null
    ? null
    : { segmentId: block.segmentId, documentId: sender.documentId, tabId: sender.tabId }

export function decideIntent({
  armed,
  lease,
  incoming,
  sender,
}: IntentDecisionInput): IntentDecision {
  if (incoming !== null && incoming.running) {
    // Nothing to weigh it against.
    if (armed === null) return { verdict: 'arm', block: incoming, lease: leaseFor(incoming, sender) }

    if (armed.segmentId === incoming.segmentId) {
      // The same block again — a republish after a reload, worker restart, or
      // another tab rehydrating the same shared log. The last document to prove
      // the exact block becomes its publisher. A segment's start and end never
      // change, so a repeat that disagrees about either is not this block being
      // republished: it is something claiming its name for different times, and
      // the only thing that could buy is a longer one.
      if (incoming.startedAt !== armed.startedAt || incoming.endsAt !== armed.endsAt) {
        return { verdict: 'ignore', because: 'contradicts-armed' }
      }
      return { verdict: 'arm', block: incoming, lease: leaseFor(incoming, sender) }
    }

    // A different block. Strictly later wins, so a tie changes nothing: two
    // blocks claiming the same millisecond is not evidence for either, and
    // keeping what is already armed is the answer that needs no arbitration.
    if (incoming.startedAt > armed.startedAt) {
      return { verdict: 'arm', block: incoming, lease: leaseFor(incoming, sender) }
    }

    return { verdict: 'ignore', because: 'not-newer' }
  }

  if (incoming !== null && incoming.stoppedSegmentId !== null) {
    // Self-scoping, so no publisher check: it can only end the block it names,
    // whoever sent it. If that is not the armed one, this is a page talking
    // about history.
    if (armed !== null && armed.segmentId !== incoming.stoppedSegmentId) {
      return { verdict: 'ignore', because: 'names-another-block' }
    }
    return { verdict: 'disarm' }
  }

  // Everything left is unqualified: an anonymous stop, or a message this worker
  // could not read — which includes a stale tab republishing a block whose
  // `endsAt` has passed, since that fails validation and arrives here as `null`.

  // Nothing is armed, so there is nothing to protect and this costs nothing. Say
  // disarm rather than ignore so a stray rule left by anything else still goes.
  if (armed === null) return { verdict: 'disarm' }

  const owner: PublisherId = applicableLease(armed, lease)?.documentId ?? null

  // Nobody holds a claim on this block. Either nothing recorded one — Chrome
  // clears session storage on a browser restart, an extension reload, an update
  // and a disable/enable, and any of those can leave a locally stored block
  // armed with no living publisher behind it — or a handover did not finish. In
  // both cases the page in front of us is the best evidence anyone has, so fail
  // open to it rather than defend a block on the strength of a record alone.
  if (owner === null) return { verdict: 'disarm' }

  if (sender.documentId !== null && sender.documentId === owner) return { verdict: 'disarm' }

  return { verdict: 'ignore', because: 'not-the-publisher' }
}
