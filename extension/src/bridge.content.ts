/**
 * The bridge: the only thing that runs inside Mono itself.
 *
 * It relays in both directions and decides nothing. Mono posts a
 * `BlockingIntent` at its own window; this passes it to the service worker,
 * which validates it. The worker occasionally asks for something back; this
 * posts that into the page, where the app decides whether to act on it. No
 * blocking logic lives here, no state is kept here, and nothing here is
 * privileged — a content script is the least trustworthy part of an extension
 * and is treated that way on the other side.
 *
 * **Why a content script rather than `externally_connectable`.** That would
 * work, and it would mean the web app hardcoding an extension id and pinning
 * that id with a manifest key through development. The app would then contain a
 * fact about Chrome. This way it contains none: `publish.ts` posts a message at
 * its own window and has no idea whether anything is listening, which is why
 * the app behaves identically with the extension installed and without it.
 *
 * **Why this file is built on its own.** Content scripts declared in a manifest
 * are executed as classic scripts, so an `import` in the file that ships is a
 * runtime error — it needs `format: 'iife'` and `inlineDynamicImports`, and it
 * has to be written into the same directory without erasing the first build.
 *
 * **Why delivery waits.** This runs at `document_start`, which is *before* Mono
 * has evaluated its own modules and therefore before anything in the page is
 * listening. A request posted then lands in an empty room. So an inbound
 * request is held until the page has proved it is listening, and the proof is
 * the page's own first intent: `publishBlockingIntent` registers its listener
 * and then immediately publishes, so an intent arriving here means a listener
 * exists there. Before that fix the request was posted at `document_start` and
 * the worker had already thrown away its only record of it.
 *
 * The origin check on every inbound message is not ceremony. `window.message`
 * is a shared bus that anything in the document — or any frame that has a
 * handle to this window — can post on, and this script is the one piece of the
 * extension a web page can talk to at all.
 */

import { BLOCKING_CHANNEL, BLOCKING_CONTRACT_VERSION } from '@/contract/blocking'
import type { BlockingRequest } from '@/contract/blocking'
import type { FromPage, HelloReply, ToContentScript } from './messages'

/**
 * Whether the page has shown it is listening, and what is waiting if it has not.
 *
 * At most one request can be outstanding: they are all the same request, and a
 * second one for the same block would ask twice for a thing that has already
 * been asked once.
 */
let pageReady = false
let queued: string | null = null

function post(request: BlockingRequest): void {
  window.postMessage(request, window.location.origin)
}

const askRepublish = (): void =>
  post({ channel: BLOCKING_CHANNEL, v: BLOCKING_CONTRACT_VERSION, request: 'republish' })

function askEndBlockEarly(segmentId: string): void {
  if (!pageReady) {
    queued = segmentId
    return
  }
  post({
    channel: BLOCKING_CHANNEL,
    v: BLOCKING_CONTRACT_VERSION,
    request: 'endBlockEarly',
    segmentId,
  })
}

/**
 * The page has spoken, so its listener is up.
 *
 * Deliberately not cleared again. A page that has published once has a listener
 * for the life of the document, and Mono is a single-page app — there is no
 * navigation that would take it down without also taking this script down.
 */
function notePageReady(): void {
  if (pageReady) return
  pageReady = true

  if (queued !== null) {
    const segmentId = queued
    queued = null
    askEndBlockEarly(segmentId)
  }
}

// Page to worker. The shape is checked properly on the other side; all this
// needs to establish is that the message came from this document rather than
// from an embedded frame or another window holding a reference to it.
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin) return

  const data = event.data
  if (typeof data !== 'object' || data === null) return
  const record = data as Record<string, unknown>
  if (record.channel !== BLOCKING_CHANNEL) return
  // A request is the extension talking to the page; relaying it back to the
  // worker would be an echo. Only intents travel outward.
  if ('request' in record) return

  notePageReady()

  const message: FromPage = { kind: 'intent', intent: record as never }
  // The worker may be asleep; sending wakes it. A rejection here means the
  // extension is being reloaded or uninstalled, which is not this script's
  // problem to solve — blocking lapses, which is the safe direction.
  try {
    void chrome.runtime.sendMessage(message).catch(() => undefined)
  } catch {
    // An extension reload can synchronously invalidate this old content-script
    // context before Chrome has a promise to reject. Blocking lapses safely.
  }
})

// Worker to page. The only thing it ever asks for is the block being ended, and
// the app is free to ignore it — by then the block may already be over, or may
// be a different one, which is why the segment is named.
chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as ToContentScript | undefined
  if (message?.kind !== 'endBlockEarly') return
  askEndBlockEarly(message.segmentId)
})

/**
 * Announce this tab, and collect anything that was waiting for it.
 *
 * Two things happen on load, and they are separate. `hello` makes the tab
 * findable so the interstitial can reach the app without the extension holding
 * the `tabs` permission, and it returns any request still outstanding — which
 * the worker keeps until the block it names actually stops, rather than
 * discarding the moment it is read. The `republish` that follows is the
 * re-arming path: a worker that was killed, or a browser that has just started,
 * knows nothing about a block that is genuinely still running, and the app is
 * the only thing that can tell it.
 */
void (async () => {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind: 'hello' } satisfies FromPage)) as
      | HelloReply
      | undefined

    const pending = reply?.endBlockEarlyFor ?? null
    if (pending !== null) askEndBlockEarly(pending)
  } catch {
    // No worker to talk to. Nothing here is worth surfacing to the page.
  }

  askRepublish()
})()
