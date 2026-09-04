import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
