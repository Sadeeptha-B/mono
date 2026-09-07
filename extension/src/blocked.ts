/**
 * The interstitial that a blocked navigation lands on.
 *
 * The one screen in this extension a user actually reads, and the reason the
 * rules redirect rather than block: Chrome's own error page is a dead end that
 * says nothing, while this can repeat the sentence they typed when they started
 * the block. That sentence is the only argument the extension has any business
 * making, and it is a much better one than a closed door.
 *
 * The countdown is `endsAt - Date.now()`, recomputed once a second, exactly as
 * in the app. Nothing is accumulated and nothing is stored: this page can be
 * left open for an hour, restored by the browser after a crash, or opened on a
 * machine that has just woken from sleep, and it is still either right or
 * visibly finished. There is no state here that can rot.
 */

import { formatTimer } from '@/domain/time'

// The stylesheets come in through the entry rather than a <link> in the HTML,
// so each page ships one CSS file named after itself. Linked from the markup,
// Vite hoists the shared half into a chunk named after whatever JavaScript it
// happens to sit beside — which built correctly and read as nonsense.
import './shared.css'
import './blocked.css'
import type { GetStatusReply } from './messages'

const purpose = document.getElementById('purpose')
const remaining = document.getElementById('remaining')
const back = document.getElementById('back')
const end = document.getElementById('end')

/** Cleared when the block ends, so a finished page stops counting. */
let ticking: ReturnType<typeof setInterval> | null = null

/**
 * The block this page is arguing with, captured once at load.
 *
 * Held rather than looked up again when the button is pressed, and that is the
 * whole point. This page is ordinary: it can sit in a background tab across the
 * end of the block that produced it and the start of the next one. Asking "what
 * is running now?" at click time would end *that* block — the one the user had
 * just started, which they were not looking at and did not ask about.
 */
let shownSegmentId: string | null = null

function render(endsAt: number): void {
  if (!remaining) return

  const left = endsAt - Date.now()

  if (left <= 0) {
    remaining.textContent = 'That block has ended. This page is out of date.'
    if (ticking !== null) {
      clearInterval(ticking)
      ticking = null
    }
    // Asking is also how the rules come down. Chrome will not fire an alarm
    // sooner than thirty seconds from now and may delay it further, so the
    // worker cannot promise to have tidied up by this instant — but every
    // question it is asked makes it reconcile, and this page reaching zero is
    // the one moment somebody is definitely watching.
    void chrome.runtime.sendMessage({ kind: 'getStatus' }).catch(() => undefined)
    return
  }

  remaining.textContent = `${formatTimer(left)} left`
}

void (async () => {
  let status: GetStatusReply | undefined
  try {
    status = (await chrome.runtime.sendMessage({ kind: 'getStatus' })) as
      | GetStatusReply
      | undefined
  } catch {
    // Handled with the same explicit unavailable state as a worker-side read
    // failure. A blank interstitial is not an acceptable failure surface.
  }

  if (status?.available !== true) {
    if (remaining) remaining.textContent = 'Mono could not read the current block. Please go back.'
    if (end instanceof HTMLButtonElement) end.hidden = true
    return
  }

  const armed = status.armed

  // No armed block means the rules are being torn down as this page loads —
  // a race, not an error. Say the honest thing rather than an empty countdown.
  if (armed === null) {
    if (remaining) remaining.textContent = 'Nothing is running. You can carry on.'
    // There is no block to end, so the button would either do nothing or do
    // something to a block this page never showed. Take it away.
    if (end instanceof HTMLButtonElement) end.hidden = true
    return
  }

  shownSegmentId = armed.segmentId

  if (purpose && armed.purpose !== null && armed.purpose !== '') {
    purpose.textContent = armed.purpose
  }

  // The interval is assigned before the first render rather than after, so that
  // a render finding the block already over has something to clear. The other
  // way round it cleared nothing, and the interval it did not yet own went on
  // to ask the worker for a status it had just asked for.
  ticking = setInterval(() => render(armed.endsAt), 1000)
  render(armed.endsAt)
})()

/**
 * Back rather than forward. The blocked navigation replaced whatever was on
 * screen, so the useful thing is to undo that, and only fall back to closing
 * the tab when this page is the whole of its history.
 */
back?.addEventListener('click', () => {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  window.close()
})

end?.addEventListener('click', () => {
  // Nothing was ever shown, so there is nothing this page can speak for.
  if (shownSegmentId === null) return

  // Caught the same way the bridge catches it: an extension reload orphans this
  // page rather than closing it, so `chrome.runtime` can be gone by the time
  // the button is pressed and the call throws before there is a promise to
  // reject. Nothing useful is left to do about it — the latched button below is
  // already the honest state, because this page never claims the block ended.
  try {
    void chrome.runtime
      .sendMessage({ kind: 'endBlockEarly', segmentId: shownSegmentId })
      .catch(() => undefined)
  } catch {
    // No worker to ask. The block goes on until something else reconciles it.
  }

  // Deliberately no optimistic "unblocked!" state. The app decides whether the
  // block ends, not this page, and claiming otherwise before it has happened is
  // the one thing an interstitial must not do.
  if (end instanceof HTMLButtonElement) {
    end.disabled = true
    end.textContent = 'Asking Mono…'
  }
})
