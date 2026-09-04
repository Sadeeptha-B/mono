/**
 * The control that opens the mini window, in both headers.
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
import { headerControlClass } from '@/components/ui'

export function PopOutButton({ mini }: { mini: MiniWindowControls }) {
  if (!supportsMiniWindow()) return null

  const open = mini.container !== null

  return (
    <button
      type="button"
      onClick={open ? mini.close : mini.open}
      title={
        open
          ? 'Close the always-on-top window'
          : 'Keep the timer on top of every other window'
      }
      className={headerControlClass}
    >
      {open ? 'Close pop-out' : 'Pop out'}
    </button>
  )
}
