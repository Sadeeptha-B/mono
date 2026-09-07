/**
 * The extension's own internal message vocabulary.
 *
 * Distinct from `src/contract/blocking.ts`, which is the contract with the web
 * app and is the one both halves must agree on across a store review. These
 * messages travel only between parts of the extension — content script, service
 * worker, interstitial, popup — and all four ship together in one build, so
 * they need no version field and no compatibility promise.
 *
 * Keeping the two apart is the point. It is what stops a convenience added for
 * the popup from quietly becoming something the app has to keep sending.
 */

import type { BlockingIntent } from '@/contract/blocking'
import type { ArmedBlock } from './state'

/** Content script to service worker. */
export type FromPage =
  /** Mono said what it is doing. The payload is validated, never trusted. */
  | { kind: 'intent'; intent: BlockingIntent }
  /** A Mono tab has loaded and wants to be findable. */
  | { kind: 'hello' }

/**
 * Interstitial and popup to service worker.
 *
 * `endBlockEarly` names the segment the page was *showing* when it was clicked,
 * which is not the same as whichever segment is armed by the time the message
 * arrives. An interstitial is an ordinary page: it can sit in a background tab
 * across the end of the block that produced it and the start of the next one.
 * Letting the worker resolve "which block" at receive time is how a stale page
 * comes to end a block the user had only just started.
 */
export type FromExtensionPage =
  | { kind: 'endBlockEarly'; segmentId: string }
  | { kind: 'setHosts'; hosts: string[] }
  | { kind: 'getStatus' }

export type ToServiceWorker = FromPage | FromExtensionPage

/**
 * The reply to `hello`.
 *
 * Carries the *segment* waiting to be ended rather than a bare flag, so the
 * bridge can hand the app something specific and the worker can tell a stale
 * request from a live one.
 */
export type HelloReply = { endBlockEarlyFor: string | null }

/**
 * The result of changing the canonical host list.
 *
 * Persistence and rule projection are deliberately separate facts. A caller
 * may keep a stored change whose DNR update is still pending, but must roll its
 * UI back when the storage write itself was refused.
 */
export type SetHostsReply =
  | { stored: false }
  | { stored: true; applied: false; retryScheduled: boolean }
  | { stored: true; applied: true }

/** Internal result reused by host edits and the other projection callers. */
export type MaterialiseResult =
  | { applied: false; retryScheduled: boolean }
  | { applied: true }

/**
 * The available payload within a `getStatus` reply.
 *
 * `redirectable` is the subset of `hosts` this extension holds host permission
 * for. The popup needs it to say which sites will show the reminder and which
 * will only be blocked, which is the one piece of state a user cannot otherwise
 * discover — a granted and an ungranted host look identical in a list.
 */
export type StatusReply = {
  armed: ArmedBlock | null
  hosts: string[]
  redirectable: string[]
  /** The desired list is readable, but its DNR projection still needs repair. */
  rulesPending: boolean
}

/** A status read can fail without saying anything about the stored state. */
export type GetStatusReply =
  | { available: false }
  | ({ available: true } & StatusReply)

/** Service worker to content script. */
export type ToContentScript = { kind: 'endBlockEarly'; segmentId: string }
