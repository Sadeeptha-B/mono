/**
 * The header's quick room and sound menu, on every view.
 *
 * It is a popover rather than a dialog in any behavioural sense, with the
 * header's dismissal contract (`useHeaderPopover`): Escape, a pointer press
 * outside, or the focus moving elsewhere puts it away. If it ever grows enough controls to feel like a form,
 * that decision is worth revisiting — for two radio groups, a toggle and a
 * range a modal would be ceremony.
 *
 * Choosing an option deliberately leaves it open. Room, sound and volume are
 * one decision made through three controls — you pick Tide, hear what it
 * suggests, then bring the level down — and a menu that closed on the first
 * click would make that three trips. It is also why none of this was added to
 * `SettingsPanel`: there is no second copy to keep in step, and the choice gets
 * made where you can immediately see and hear the result.
 */

import { RoomControls } from './RoomControls'
import { headerIconClass } from '@/components/ui'
import { useHeaderPopover } from '@/components/headerPopover'
import { ROOMS } from './rooms'
import { useSession } from '@/store/session'

export function RoomMenu({ idPrefix }: { idPrefix: string }) {
  const { open, setOpen, wrap, button, panel, panelStyle } = useHeaderPopover(352)
  const roomId = useSession((state) => state.session.settings.roomId)
  const room = ROOMS[roomId]
  const panelId = `${idPrefix}-room-menu`

  return (
    <div ref={wrap}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        // The trigger is the room's own swatch, the same dot the menu shows
        // beside each choice, so the header says which room you are in by
        // colour and the name is a hover or a screen reader away.
        aria-label={`Room · ${room.label}`}
        title={`Room and sound · ${room.label}`}
        className={`${headerIconClass} ${open ? 'bg-surface-raised' : ''}`}
      >
        <span
          aria-hidden="true"
          className="size-3 rounded-full border border-bright/30"
          style={{ backgroundColor: room.palette[room.indicator] }}
        />
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Room and ambient sound"
          style={panelStyle}
          className="fixed z-30 overflow-y-auto rounded-xl border border-line bg-surface p-4 text-left shadow-2xl"
        >
          <RoomControls idPrefix={idPrefix} />
        </div>
      )}
    </div>
  )
}
