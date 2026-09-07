/**
 * The header's quick room and sound menu, on both the day and the guide route.
 *
 * It is a popover rather than a dialog in any behavioural sense. `role="dialog"`
 * names it for assistive technology, but it is deliberately not modal and not
 * focus-trapped: Escape closes it and returns focus to the trigger, a pointer
 * press outside closes it, and that is the whole of its dismissal contract. If
 * it ever grows enough controls to feel like a form, that decision is worth
 * revisiting — for two radio groups, a toggle and a range it would be ceremony.
 *
 * Choosing an option deliberately leaves it open. Room, sound and volume are
 * one decision made through three controls — you pick Tide, hear what it
 * suggests, then bring the level down — and a menu that closed on the first
 * click would make that three trips. It is also why none of this was added to
 * `SettingsPanel`: there is no second copy to keep in step, and the choice gets
 * made where you can immediately see and hear the result.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { RoomControls } from './RoomControls'
import { headerControlClass } from '@/components/ui'
import { ROOMS } from './rooms'
import { useSession } from '@/store/session'

/** Where the panel was last put, so an unchanged recomputation costs nothing. */
type Placement = { top: number; left: number; width: number; maxHeight: number }

export function RoomMenu({ idPrefix }: { idPrefix: string }) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const placed = useRef<Placement | null>(null)
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

  // Header controls wrap on narrow screens, so an anchored absolute panel can
  // begin much lower than its width alone suggests. Place it against the
  // viewport instead: use below when it fits, otherwise use whichever side has
  // more room, and let only the panel scroll on especially short screens.
  useLayoutEffect(() => {
    if (!open) {
      placed.current = null
      setPanelStyle(undefined)
      return
    }

    const place = () => {
      const trigger = button.current?.getBoundingClientRect()
      const menu = panel.current
      if (!trigger || !menu) return

      const edge = 16
      const gap = 8
      const width = Math.min(352, window.innerWidth - edge * 2)

      // Measure at the final width. A fixed auto-width panel near the right
      // edge shrink-wraps too narrowly and reports a misleadingly tall height.
      const widthStyle = `${width}px`
      if (menu.style.width !== widthStyle) menu.style.width = widthStyle

      const belowTop = trigger.bottom + gap
      const spaceBelow = Math.max(0, window.innerHeight - edge - belowTop)
      const spaceAbove = Math.max(0, trigger.top - gap - edge)
      const fullHeight = menu.scrollHeight
      const placeBelow = fullHeight <= spaceBelow || spaceBelow >= spaceAbove
      const availableHeight = placeBelow ? spaceBelow : spaceAbove
      const visibleHeight = Math.min(fullHeight, availableHeight)
      const top = placeBelow ? belowTop : trigger.top - gap - visibleHeight
      const left = Math.min(
        window.innerWidth - width - edge,
        Math.max(edge, trigger.right - width),
      )
      const next: Placement = { top, left, width, maxHeight: availableHeight }

      // Captured panel scrolling reaches this too; do not rerender unchanged
      // controls on every scroll frame.
      const last = placed.current
      if (
        last &&
        (Object.keys(next) as (keyof Placement)[]).every((key) => last[key] === next[key])
      ) {
        return
      }

      placed.current = next
      setPanelStyle({ ...next, visibility: 'visible' })
    }

    place()

    let pendingFrame: number | null = null
    const schedulePlace = () => {
      if (pendingFrame !== null) return
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null
        place()
      })
    }

    // Enabling ambience adds the volume slider, so placement follows content
    // size without coupling this component to each control inside it.
    const observer = new ResizeObserver(schedulePlace)
    if (panel.current) observer.observe(panel.current)

    // Capture, because the surface that scrolls is a column inside the page
    // rather than the page itself, and scroll events do not bubble.
    const listening = { capture: true, passive: true } as const
    window.addEventListener('resize', schedulePlace, listening)
    window.addEventListener('scroll', schedulePlace, listening)
    return () => {
      observer.disconnect()
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame)
      window.removeEventListener('resize', schedulePlace, listening)
      window.removeEventListener('scroll', schedulePlace, listening)
    }
  }, [open])

  return (
    <div ref={wrap}>
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
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Room and ambient sound"
          style={panelStyle ?? { visibility: 'hidden' }}
          className="fixed z-30 overflow-y-auto rounded-xl border border-line bg-surface p-4 text-left shadow-2xl"
        >
          <RoomControls idPrefix={idPrefix} />
        </div>
      )}
    </div>
  )
}
