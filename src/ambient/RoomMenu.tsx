/** An accessible quick room and sound menu for either application header. */

import { useEffect, useRef, useState } from 'react'

import { RoomControls } from './RoomControls'
import { headerControlClass } from '@/components/ui'
import { ROOMS } from './rooms'
import { useSession } from '@/store/session'

export function RoomMenu({ idPrefix }: { idPrefix: string }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const roomId = useSession((state) => state.session.settings.roomId)
  const panelId = `${idPrefix}-room-menu`

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className={headerControlClass}
      >
        Room <span className="hidden text-muted sm:inline">· {ROOMS[roomId].label}</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Room and ambient sound"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-4 text-left shadow-2xl"
        >
          <RoomControls idPrefix={idPrefix} />
        </div>
      )}
    </div>
  )
}
