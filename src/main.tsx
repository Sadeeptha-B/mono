import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { domAnimation, LazyMotion } from 'motion/react'

import { App } from './app/App'
import { applyRoomTheme } from './ambient/theme'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { useSession } from './store/session'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// Persist rehydrates synchronously, so the chosen room is available before
// React paints and an Ember morning never flashes Mono black first.
applyRoomTheme(document, useSession.getState().session.settings.roomId)

/**
 * One animation boundary, for the whole app, rendered exactly once.
 *
 * `LazyMotion` is what decides which capabilities the `m` components in
 * `PixelCat` actually have. `domAnimation` covers animation and exit plus the
 * hover, tap, focus and in-view gestures; what it leaves out is drag and
 * layout projection, which is most of what importing `motion` directly would
 * have cost about 120 KB to include. `domMax` is the same set with those two
 * added, and is the only reason to widen this.
 *
 * It is up here rather than around the cat because of what it does while it
 * renders. Given a feature set directly it merges that set into Motion's
 * *global* definitions on every single render, allocating as it goes — and
 * Mono's ticker re-renders every cat on screen once a second, of which there
 * can be several. Rendered here it is a child of nothing that re-renders, so
 * that registration happens once for the life of the tab and the cats simply
 * read the context.
 *
 * The mini window is covered by this too. It is a portal rather than a second
 * React root, so it is inside this tree even though it is in another document.
 */
createRoot(root).render(
  <StrictMode>
    <LazyMotion features={domAnimation}>
      <App />
    </LazyMotion>
  </StrictMode>,
)

registerServiceWorker()
