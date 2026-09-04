/** Apply a room to a document, including browser chrome where it is available. */

import { ROOMS } from './rooms'
import type { RoomId } from '@/domain/types'

export function applyRoomTheme(target: Document, roomId: RoomId): void {
  const room = ROOMS[roomId]
  target.documentElement.dataset.room = roomId

  const meta = target.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  meta?.setAttribute('content', room.palette.ink)
}
