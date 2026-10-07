/**
 * The control that opens the mini window, in every header.
 *
 * Renders nothing at all where the browser has no Document Picture-in-Picture,
 * which today means everything that is not Chromium. That is a deliberate
 * difference from how Mono handles the browser refusing to save: a refused
 * write costs you a day you cannot get back, so it is said out loud, while a
 * window this browser was never going to open costs nothing and a permanently
 * disabled button explaining itself would be the app apologising for the user's
 * choice of browser. The guide mentions the requirement once, where someone
 * looking for the feature would go.
 */

import { supportsMiniWindow, type MiniWindowControls } from './useMiniWindow'
import { PopOutIcon } from '@/components/icons'
import { headerIconClass } from '@/components/ui'

export function PopOutButton({ mini }: { mini: MiniWindowControls }) {
  if (!supportsMiniWindow()) return null

  const open = mini.container !== null

  return (
    <button
      type="button"
      onClick={open ? mini.close : mini.open}
      // Named for what a click does, which changes once the window is out;
      // drawn lit while it is, so the icon also says that it is.
      aria-label={open ? 'Close pop-out' : 'Pop out'}
      title={
        open
          ? 'Close the always-on-top window'
          : 'Pop out: keep the timer on top of every other window'
      }
      className={`${headerIconClass} ${open ? 'bg-surface-raised text-bright' : ''}`}
    >
      <PopOutIcon className="size-4" />
    </button>
  )
}
