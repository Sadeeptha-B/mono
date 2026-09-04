/**
 * Apply a room to a document, including the browser chrome where it exists.
 *
 * There are three callers, and the reason there are three is timing rather than
 * variety. `main.tsx` runs this against the real document before React's first
 * paint, so an Ember, Tide or Moss session does not flash Mono while the tree
 * mounts. `App` repeats it in a layout effect whenever the setting changes. The
 * mini window's `paint` composes it with the inline fallback a document whose
 * stylesheets have not arrived yet needs.
 *
 * What this deliberately does not do is write colours onto the body. The room
 * is a `data-room` attribute and the stylesheet holds the actual custom
 * properties, because an inline style outranks the sheet for the life of the
 * document rather than only until it loads — the room would then be stuck at
 * whatever was painted first. `paint` is allowed to break that rule because it
 * is dressing a document that may never receive a stylesheet at all, and it
 * takes the trade knowingly.
 */

import { ROOMS } from './rooms'
import type { RoomId } from '@/domain/types'

export function applyRoomTheme(target: Document, roomId: RoomId): void {
  const room = ROOMS[roomId]
  target.documentElement.dataset.room = roomId

  const meta = target.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  meta?.setAttribute('content', room.palette.ink)
}
