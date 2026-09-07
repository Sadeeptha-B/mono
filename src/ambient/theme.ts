/**
 * Apply a room to a document, including the browser chrome where it exists.
 *
 * There are three callers, and the reason there are three is timing rather than
 * variety. `main.tsx` runs this against the real document before React's first
 * paint, so a Hearth, Tide or Fern session does not flash Mono while the tree
 * mounts. `App` repeats it in a layout effect whenever the setting changes. The
 * mini window's `paint` composes it with the inline fallback a document whose
 * stylesheets have not arrived yet needs.
 *
 * The semantic properties are written on the root so every consumer — ordinary
 * Tailwind utilities, SVG fills and the mini window — reads the same palette.
 * `@theme` in `index.css` still declares Mono's literals because Tailwind needs
 * the token names at build time and the document needs a dark first paint
 * before this module runs. Non-default rooms have no second CSS copy.
 */

import { cssProperty, PALETTE_TOKENS, PALETTES } from './palette'
import { isRoomId, type RoomId } from '@/domain/types'

export function applyRoomTheme(target: Document, roomId: RoomId): void {
  // This runs before React's error UI exists. Treat a corrupted persisted id as
  // Mono here even though normal callers carry the narrower RoomId type.
  const safeRoomId = isRoomId(roomId) ? roomId : 'mono'
  const palette = PALETTES[safeRoomId]
  target.documentElement.dataset.room = safeRoomId
  for (const token of PALETTE_TOKENS) {
    target.documentElement.style.setProperty(cssProperty(token), palette[token])
  }

  const meta = target.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  meta?.setAttribute('content', palette.ink)
}
