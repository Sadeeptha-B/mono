/**
 * Telling the browser extension what the session is doing.
 *
 * Mono posts a `BlockingIntent` at its own window whenever a block starts or
 * stops. Something may be listening — a content script belonging to the site
 * blocker — and equally may not be. Nothing here is gated on that, nothing here
 * feature-detects, and the app behaves identically either way. That is the
 * whole reason this is four dozen lines rather than an integration: the app
 * publishes a fact about itself and does not care who reads it.
 *
 * **Why a subscription and not an effect.** This is the same shape as
 * `registerServiceWorker`, and for the same two reasons. It is not React's
 * business — no component renders because of it — and the mini window is a
 * *portal* into one React tree rather than a second root, so a subscription
 * here fires exactly once however many surfaces are open. An effect in a
 * component would have been one careless remount away from publishing twice.
 *
 * The contrast worth knowing is the other block-start side effect, `popOutForBlock`
 * in `App`, which is deliberately inline in the click handler because a browser
 * only grants a window to a real user gesture. Nothing of the sort applies
 * here: a `postMessage` needs no activation, so the honest place for it is
 * wherever the session actually changes.
 *
 * **Why the message is safe to post.** `postMessage` targets `location.origin`,
 * so it never leaves the page, and what it carries — a timestamp, a block kind,
 * and the purpose the user typed — reaches only code already running in Mono's
 * own document. Mono ships no third-party script for it to reach. If that ever
 * stops being true, this is one of the places to revisit.
 */

import {
  BLOCKING_CHANNEL,
  NOT_RUNNING,
  readBlockingRequest,
  type BlockingIntent,
} from '@/contract/blocking'
import { isBlockRunning } from '@/domain/machine'
import { useSession } from '@/store/session'

/**
 * The last thing published, so the once-a-second ticker does not send the same
 * intent forty-five times a minute.
 *
 * Keyed on the fields a listener would act on rather than on object identity:
 * the store publishes a fresh `active` object on every append, and comparing
 * references would defeat the whole point. `endsAt` is in the key because it is
 * the only field that could change without the segment doing so — `startedAt`
 * is fixed for the life of a segment, which is the whole reason it can be used
 * to order two of them, so it would add nothing here.
 */
let lastKey: string | null = null

/**
 * The last block this tab published as running, which is what it is entitled to
 * say has stopped.
 *
 * Module-level rather than read from the store, because by the time a block has
 * ended the store no longer holds it — `active` is already null, and the whole
 * point is to name the thing that just went away. It survives a route change
 * and the mini window opening, and resets on reload. A reload can therefore
 * publish an anonymous idle snapshot, which is deliberately weaker than a named
 * stop: the extension honours one only from the page that armed what it is
 * currently blocking, or when nothing holds that claim.
 */
let lastRunningSegmentId: string | null = null

const keyOf = (intent: BlockingIntent): string =>
  intent.running
    ? `run:${intent.segmentId}:${intent.endsAt}`
    : `idle:${intent.stoppedSegmentId ?? 'none'}`

function intentNow(): BlockingIntent {
  const { phase, session } = useSession.getState()
  const { active } = session

  if (!isBlockRunning(phase, active) || active === null || active.kind !== 'block') {
    return {
      ...NOT_RUNNING,
      stoppedSegmentId: lastRunningSegmentId,
    }
  }

  lastRunningSegmentId = active.id

  return {
    channel: BLOCKING_CHANNEL,
    v: 1,
    running: true,
    segmentId: active.id,
    endsAt: active.endsAt,
    // Straight off the segment rather than `Date.now()`. This is the instant the
    // block began, which is a fact the store already holds and which stays the
    // same however many times the same block is republished — a token generated
    // here would make every republish look like a newer block than the last.
    startedAt: active.startedAt,
    blockKind: active.blockKind,
    purpose: active.purpose,
  }
}

/** Post whatever is true now, unless it is what we said last time. */
function publish(force = false): void {
  const intent = intentNow()
  const key = keyOf(intent)
  if (!force && key === lastKey) return

  lastKey = key
  window.postMessage(intent, window.location.origin)
}

/**
 * Start publishing, and start listening for the two things the extension can
 * ask back.
 *
 * Called once from `main.tsx`, beside `registerServiceWorker`. Unlike that one
 * it runs in development too — the extension's content script matches the dev
 * server as well as the deployed origin, so the feature has to be workable
 * without a production build.
 *
 * The first publish after load is an authority decision. The current
 * `localStorage` adapter rehydrates synchronously before this function can run,
 * so a mid-block reload first publishes the restored running block. If storage
 * ever becomes asynchronous, this call must wait for hydration; an initial
 * anonymous idle intent can fail open a worker whose session lease was cleared.
 */
export function publishBlockingIntent(): void {
  window.addEventListener('message', (event) => {
    // Only our own document talks on this channel. A content script relays into
    // the page as the page, so a genuine request is indistinguishable from one
    // Mono sent itself — which is fine, because neither request does anything a
    // page cannot already do to itself.
    if (event.source !== window || event.origin !== window.location.origin) return

    const request = readBlockingRequest(event.data)
    if (!request) return

    if (request.request === 'republish') {
      // Forced: a listener that has just woken up needs the current state even
      // though nothing about the session has changed since we last spoke.
      publish(true)
      return
    }

    // `endBlockEarly` from the blocked page. It goes through the same action as
    // the timer's own End early rather than quietly unblocking, so the day's
    // journal records an abandoned block instead of a gap nobody explains. The
    // store refuses it in every phase but a running one, and the `running:
    // false` that follows disarms the extension.
    //
    // The segment check is the one guard worth having, and it is unconditional:
    // a request that does not name the block now running is not for this block.
    // Such a request can arrive long after it was made — a tab that had to be
    // opened, a page restored from history, an interstitial left open across
    // the end of the block it was arguing with — and abandoning whatever is
    // running *now* would throw away a block the user had only just started, on
    // the strength of a click they made against a different one.
    const { session } = useSession.getState()
    if (session.active?.id !== request.segmentId) return

    useSession.getState().dispatch({ type: 'abandonBlock', at: Date.now() })
  })

  useSession.subscribe(() => publish())

  // Say where we stand before anything has changed, so a reload in the middle
  // of a block re-arms a service worker that has since been killed and knows
  // nothing about it.
  publish(true)
}
