/**
 * Getting Mono's stylesheet into a document that starts with nothing.
 *
 * A picture-in-picture window is a blank document in the same origin, not a
 * copy of the page. Nothing carries over — no Tailwind utilities, none of the
 * `@theme` custom properties, no font. That is not a cosmetic problem: the
 * companion's ears, nose, tail and the ground it walks on are all `var(--color-…)`
 * fills, so without the tokens the cat renders as a cream silhouette with black
 * holes in it.
 *
 * Copying nodes rather than adopting constructed stylesheets, and the reason is
 * the font. `adoptedStyleSheets` needs the rule text, reading rule text off the
 * cross-origin Google Fonts sheet throws `SecurityError`, and so that one would
 * need a `<link>` fallback anyway — at which point the link is the whole
 * mechanism and the other half is complication for nothing.
 *
 * Both node kinds are needed, because the two builds differ: Vite injects CSS as
 * `<style>` elements in dev and emits a hashed `<link>` in production, and the
 * page carries a `<link>` to the font in both.
 */

import { ROOMS } from '@/ambient/rooms'
import { applyRoomTheme } from '@/ambient/theme'
import type { RoomId } from '@/domain/types'

/** The same font fallback as `index.css`, available before that sheet lands. */
const DISPLAY = "'Inter', ui-sans-serif, system-ui, sans-serif"

/**
 * How long to wait for the sheets before showing the window without them.
 *
 * The `error` event covers a sheet that fails; it does not cover one that
 * simply never answers, which is what a captive portal or a stalled connection
 * looks like — and the font is fetched across the network. Waiting on that
 * forever would leave an empty window on the user's desktop with no way to tell
 * it what went wrong. Two seconds is far longer than a cached sheet needs and
 * short enough that nobody is left wondering whether the click worked.
 */
const PATIENCE_MS = 2000

/**
 * Give the window its own copy of every stylesheet the page is using.
 *
 * Resolves once they have all loaded or failed, or once `PATIENCE_MS` is up,
 * whichever comes first. A sheet that will not load is not worth blocking on —
 * the window opening late is a worse failure than the window opening plain — so
 * a failure resolves like a success, a sheet that never answers at all is given
 * up on, and `paint` keeps what is underneath legible in both cases.
 *
 * The caller has to assume this resolving does not mean the sheets arrived. It
 * means it is time to show the window.
 */
export async function copyStylesInto(target: Document, source: Document): Promise<void> {
  const pending: Promise<void>[] = []

  for (const node of source.querySelectorAll('link[rel="stylesheet"], style')) {
    if (node instanceof HTMLLinkElement) {
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      // The IDL property, which is already absolute. Reading the attribute
      // would hand over whatever was written in the HTML and resolve it against
      // the new document — and this app is served from a sub-path on Pages.
      link.href = node.href
      if (node.media) link.media = node.media
      if (node.crossOrigin !== null) link.crossOrigin = node.crossOrigin

      pending.push(
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true })
          link.addEventListener('error', () => resolve(), { once: true })
        }),
      )
      target.head.append(link)
    } else {
      target.head.append(node.cloneNode(true))
    }
  }

  if (pending.length === 0) return

  // The new window's own timer, not the opener's, for exactly the reason the
  // ticker borrows it too. This deadline exists for the case where a sheet has
  // stalled, and the workflow that gets there is a block starting: the window
  // opens and the user goes straight off to the work, leaving the opener hidden
  // and its timers throttled — so the escape hatch would be throttled with them,
  // in the one situation it was written for. A window that is always on top is
  // never hidden and never throttled.
  const timers = target.defaultView ?? window

  let expire: number | undefined
  try {
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        expire = timers.setTimeout(resolve, PATIENCE_MS)
      }),
    ])
  } finally {
    timers.clearTimeout(expire)
  }
}

/**
 * A legible first paint for the otherwise blank PiP document.
 *
 * The sheets take a moment to arrive, and a blank document is white. Half a
 * second of white in an always-on-top window on a dark desktop is the kind of
 * thing you feel rather than see. These inline fallback properties remain
 * authoritative after the stylesheet arrives, so room changes call this
 * function again; the stylesheet owns the semantic tokens and all descendants.
 */
export function paint(target: Document, roomId: RoomId): void {
  const palette = ROOMS[roomId].palette
  applyRoomTheme(target, roomId)
  target.body.style.backgroundColor = palette.ink
  target.body.style.margin = '0'
  // The text colour matters for the same reason as the background, and only in
  // the case `PATIENCE_MS` exists for. A document with no stylesheet draws its
  // text black, and black on ink is not badly styled — it is invisible. These
  // three lines are what makes the window worth showing at all when the sheets
  // are late.
  target.body.style.color = palette.body
  target.body.style.fontFamily = DISPLAY
}
