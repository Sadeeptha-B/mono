/**
 * The header's quick room and sound menu, on both the day and the guide route.
 *
 * It is a popover rather than a dialog in any behavioural sense. `role="dialog"`
 * names it for assistive technology, but it is deliberately not modal and not
 * focus-trapped: Escape closes it and returns focus to the trigger, a pointer
 * press outside closes it, and that is the whole of its dismissal contract. If
 * it ever grows enough controls to feel like a form, that decision is worth
 * revisiting — for three radio groups and a range it would be ceremony.
 *
 * Choosing an option deliberately leaves it open. Room, sound and volume are
 * one decision made through three controls — you pick Tide, hear what it
 * suggests, then bring the level down — and a menu that closed on the first
 * click would make that three trips. It is also why none of this was added to
 * `SettingsPanel`: there is no second copy to keep in step, and the choice gets
 * made where you can immediately see and hear the result.
 */

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
