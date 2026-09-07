/**
 * The wire vocabulary Mono shares with the browser extension.
 *
 * This is the *whole* contract. The extension is handed one absolute timestamp
 * and nothing else, which is Mono's second invariant carried across a process
 * boundary: the extension never counts down, never polls, never asks for a
 * heartbeat, and never needs the tab it heard from to still be alive. Close the
 * tab, sleep the machine, let Chrome kill the service worker — the instant
 * blocking is *meant* to stop is still exactly right, because it was never a
 * duration.
 *
 * Be precise about what that does and does not promise, because the temptation
 * is to read it as a safety bound and it is not one. No browser rule understands
 * `endsAt`; a rule comes down only when something reconciles against it, and the
 * alarm that usually does the reconciling is one Chrome may delay by an
 * arbitrary amount. So a missed stop message costs an unblock that is late by an
 * amount nothing here can bound. What *is* bounded is the far end: the extension
 * installs session rules, which the browser discards when it closes, so nobody
 * is blocked across a restart by a message that went astray.
 *
 * What is deliberately *not* here is anything resembling a plan. The extension
 * must never derive one. `derivePlan` is a pure function of the whole day and
 * two processes computing it are two schedules that can disagree, which is the
 * exact failure the first invariant exists to prevent. The app decides; the
 * extension is handed the conclusion with an expiry stamped on it.
 *
 * **Versioning, and which half is older.** The web app is a push to GitHub
 * Pages and the extension sits behind a store review, so the extension is
 * always the older of the two and the app must never assume otherwise. Within a
 * major `v` the app may *add* fields and may never change or remove one. A `v`
 * the reader has not heard of is never interpreted as an intent. The worker may
 * still fail open for the document that already holds authority; see
 * `readBlockingIntent` and `decideIntent`.
 *
 * **Why this is pure.** It has no DOM, no React, no clock and no `chrome.*`: it
 * is the only module imported by both the app and the extension, and
 * `src/contract/boundary.test.ts` holds that shut. `Ms` and `BlockKind` come
 * from `@/domain/types` as types only, so nothing at runtime crosses with them.
 */

import type { BlockKind, Ms } from '@/domain/types'

/** Exhaustive at compile time so a new block kind must make a wire decision. */
const BLOCK_KINDS = {
  deep: true,
  short: true,
  reflect: true,
} satisfies Record<BlockKind, true>

const isBlockKind = (value: unknown): value is BlockKind =>
  typeof value === 'string' && Object.hasOwn(BLOCK_KINDS, value)

/**
 * Stamped on every message in both directions.
 *
 * Messages travel by `window.postMessage`, which is a shared bus — the page
 * receives its own posts, and anything else running in the document would too.
 * Mono ships no third-party code and posts with its own origin as the target,
 * so in practice this only separates our traffic from the browser's own; it is
 * the version field beside it that does the real work.
 */
export const BLOCKING_CHANNEL = 'mono.blocking'

export const BLOCKING_CONTRACT_VERSION = 1

/**
 * The longest block anything is allowed to arm, as a clamp rather than a
 * policy.
 *
 * Mono's own blocks are minutes long and this is hours, so it constrains
 * nothing a user can actually do. It exists because the service worker trusts a
 * number that arrived from a web page: a compromised or simply broken page
 * sending `endsAt: Infinity` would otherwise block someone's browser until they
 * worked out which extension was doing it. Bounded nonsense is recoverable and
 * unbounded nonsense is not.
 */
export const MAX_BLOCK_MS = 4 * 60 * 60 * 1000

/**
 * How far into the future a block is allowed to claim it began.
 *
 * Ideally none at all: `startedAt` is stamped by the same machine that later
 * validates it, so it is always in the past by the time anyone reads it. The
 * allowance exists for the one case where that is not true — a clock corrected
 * backwards between the block starting and the message being read, which a
 * resume from sleep or an NTP step can do. Without it, a correction of a few
 * hundred milliseconds would refuse a block that is genuinely running.
 *
 * Small on purpose, because this field decides authority: whatever slack is
 * given here is slack in which a broken page could claim a start time no real
 * block has yet reached and outrank every honest one. A minute buys the clock
 * everything it needs and buys that almost nothing.
 */
export const MAX_CLOCK_SKEW_MS = 60_000

/**
 * What the app tells the extension. There is no third state: either a block is
 * running and it ends at a known instant, or nothing is.
 */
export type BlockingIntent =
  | {
      channel: typeof BLOCKING_CHANNEL
      v: 1
      running: false
      /**
       * Which block the publisher believes has just stopped, if it knows.
       *
       * Idle used to be anonymous, and anonymity is authority it has not
       * earned: two Mono tabs hold two independent stores with no synchronising
       * between them, so a tab still holding a finished block can decide it has
       * ended and say "nothing is running" — long after another tab started
       * something else. An unqualified idle tears down rules for a block that
       * is genuinely running.
       *
       * Naming the segment lets a listener tell "the block you are watching has
       * ended" from "a block you stopped watching has ended". `null` means the
       * publisher was not tracking one at all, normally because it has just
       * loaded — a page that has published nothing has nothing it can name.
       *
       * A named stop is *self-scoping*: it can only ever tear down the block it
       * names, so it is harmless from a publisher talking about something else
       * and any of them may send one. That is a bound on what the message can
       * do, not proof of who sent it — a segment id is not a secret. An
       * anonymous stop has no such bound, so the listener decides what it is
       * worth: `decideIntent` in `extension/src/authority.ts` honours one only
       * from the publisher that armed the block, or when nobody holds a claim.
       */
      stoppedSegmentId: string | null
    }
  | {
      channel: typeof BLOCKING_CHANNEL
      v: 1
      running: true
      /** The active segment's id, so a listener can tell one block from the next. */
      segmentId: string
      /** Absolute. The whole design rests on this not being a duration. */
      endsAt: Ms
      /**
       * When this block began — an ordering token, and the only reason it is on
       * the wire.
       *
       * Nothing counts with it and nothing displays it. It exists because two
       * Mono tabs hold two independent stores with nothing synchronising them,
       * so "a block is running" can arrive from two publishers describing two
       * different blocks, in either order. A listener already holding one of
       * them has to know whether the other is news or history, and neither of
       * the other fields can say: ids are opaque, and a block abandoned early
       * leaves an `endsAt` further in the future than the one that replaced it.
       * The instant the block started is the only field that orders them.
       *
       * Required, on the same reasoning as `endBlockEarly`'s `segmentId`. No
       * version of the extension has ever shipped, so there is nothing older to
       * be lenient towards, and a running intent that cannot be ordered against
       * the one already armed is precisely what this field exists to refuse.
       */
      startedAt: Ms
      blockKind: BlockKind
      /** What the user said the block was for, shown on the blocked page. */
      purpose: string | null
    }

/**
 * What the extension asks of the app. Two requests, both of which the app is
 * free to ignore.
 *
 * `republish` is how a tab that was already open when the extension woke up
 * gets back in step: the content script asks, and the publisher answers with
 * whatever is true now. `endBlockEarly` is the blocked page's one button, and
 * it is deliberately not a private unblock — it asks the app to abandon the
 * block through the same path the timer's own End early uses, so the day's
 * journal records what actually happened.
 */
export type BlockingRequest =
  | { channel: typeof BLOCKING_CHANNEL; v: 1; request: 'republish' }
  | {
      channel: typeof BLOCKING_CHANNEL
      v: 1
      request: 'endBlockEarly'
      /**
       * Which block the user was actually looking at when they asked.
       *
       * Required, and deliberately not nullable. It was briefly optional, on
       * the reasoning that an older extension might not send it — but no
       * version of this extension has ever shipped, so there is nothing older
       * to be compatible with, and "end whatever is running" is precisely the
       * behaviour this field exists to remove. A request that cannot say what
       * it is about is refused.
       *
       * Named rather than assumed because the request can outlive its moment:
       * the interstitial's button, a tab that had to be opened first, and a
       * page restored from history all deliver late, and by then the block they
       * were arguing with may have ended and another begun. Abandoning that one
       * would be the extension throwing away a block the user had just started.
       */
      segmentId: string
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isOurs = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && value.channel === BLOCKING_CHANNEL && value.v === BLOCKING_CONTRACT_VERSION

/**
 * Read an intent that arrived from outside, or return `null`.
 *
 * Same instinct as `sanitiseImportedEvent` in `src/store/schema.ts`, and for
 * the same reason: this is data from another process, so it is filtered rather
 * than trusted. The difference is what a failure costs. There, dropping an
 * event loses a fact about the day; here, accepting a bad one blocks someone's
 * browser. So every path out of this function that is not a complete, sane,
 * currently-true intent returns `null`.
 *
 * `null` is a refusal to read, not an instruction. It used to be both — the
 * worker turned every rejection into an unconditional stop — and that was the
 * bug: an expired block republished by a tab nobody was watching was refused
 * here, exactly as intended, and the refusal then tore down a block another tab
 * was running. What a rejection should do depends on who sent it, which is a
 * question this file has no way to answer. It reports that it could not read the
 * message and leaves the judgement to `decideIntent`.
 *
 * The time checks are the load-bearing ones, and there are two kinds. `endsAt`
 * decides how long anything can be armed: already past means a stale message
 * that overtook a newer one, and beyond `MAX_BLOCK_MS` is not a block Mono can
 * produce. `startedAt` decides *authority*, because a later start outranks an
 * earlier one — so it is held to the same standard rather than merely being
 * required to exist. A block cannot claim to have started in the future, cannot
 * end at the moment it began, and cannot span more than the clamp allows.
 */
export function readBlockingIntent(value: unknown, now: Ms): BlockingIntent | null {
  if (!isOurs(value)) return null

  if (value.running === false) {
    // Read leniently. An unreadable or absent id means "I cannot say which",
    // which is the same wire value as not tracking one. The worker chooses how
    // much authority an anonymous stop has; the parser only preserves the fact
    // that no segment could be named.
    const stoppedSegmentId =
      typeof value.stoppedSegmentId === 'string' && value.stoppedSegmentId !== ''
        ? value.stoppedSegmentId
        : null
    return { channel: BLOCKING_CHANNEL, v: 1, running: false, stoppedSegmentId }
  }
  if (value.running !== true) return null

  const { segmentId, endsAt, startedAt, blockKind, purpose } = value

  if (typeof segmentId !== 'string' || segmentId === '') return null
  if (typeof endsAt !== 'number' || !Number.isFinite(endsAt)) return null
  if (endsAt <= now || endsAt > now + MAX_BLOCK_MS) return null
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
  // Three bounds, and they are here because this field decides which of two
  // publishers is believed. A start in the future would outrank every block that
  // has actually happened, and hold that rank until the clock caught up. A start
  // at or after the end is not a block anyone can sit through. And a span beyond
  // the clamp is the same nonsense `endsAt` is already held to, measured from
  // the other side — without it, "bounded" would be true of the end instant and
  // false of the token that orders it.
  if (startedAt > now + MAX_CLOCK_SKEW_MS) return null
  if (startedAt >= endsAt) return null
  if (endsAt - startedAt > MAX_BLOCK_MS) return null
  if (!isBlockKind(blockKind)) return null
  if (purpose !== null && typeof purpose !== 'string') return null

  return {
    channel: BLOCKING_CHANNEL,
    v: 1,
    running: true,
    segmentId,
    endsAt,
    startedAt,
    blockKind,
    purpose,
  }
}

/**
 * The mirror of `readBlockingIntent`, for the app reading the extension.
 *
 * `endBlockEarly` without a usable `segmentId` is refused outright rather than
 * softened into "whatever is running". The soft reading existed for an older
 * extension that might not send the field; no version has ever shipped, so
 * there is no such extension, and keeping the fallback would have left the one
 * hole the field was added to close.
 */
export function readBlockingRequest(value: unknown): BlockingRequest | null {
  if (!isOurs(value)) return null

  if (value.request === 'republish') {
    return { channel: BLOCKING_CHANNEL, v: 1, request: 'republish' }
  }

  if (value.request === 'endBlockEarly') {
    if (typeof value.segmentId !== 'string' || value.segmentId === '') return null
    return {
      channel: BLOCKING_CHANNEL,
      v: 1,
      request: 'endBlockEarly',
      segmentId: value.segmentId,
    }
  }

  return null
}

/**
 * The idle intent: a publisher saying it has nothing running and cannot name
 * what stopped.
 *
 * It used to be the sink every validation failure folded into, and deliberately
 * is not any more — a message that could not be read is not the same claim as a
 * page reporting itself idle, and flattening the two threw away the sender the
 * decision needs. `readBlockingIntent` returns `null` for the unreadable case
 * and this constant is left to mean only what it says.
 *
 * `stoppedSegmentId` is `null` because a page that has published nothing has
 * nothing it can name. Whether that should stop an existing block depends on who
 * sent it, not on this constant.
 */
export const NOT_RUNNING = {
  channel: BLOCKING_CHANNEL,
  v: 1,
  running: false,
  stoppedSegmentId: null,
} satisfies BlockingIntent
