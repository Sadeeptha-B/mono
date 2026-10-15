/**
 * The timeline, as a page: the third of the places a day moves between.
 *
 * It is where epics will be laid out over time. Until then it holds Later
 * (`LaterSection`), which left the tasks page so that page could be the board
 * alone: what is put down for later is a decision still to be made about
 * where something goes and when, which is this page's question rather than
 * the board's.
 *
 * Built as the tasks page is, for the same reasons: a page you go to and stay
 * a while, swapped in by `App` while its own hooks stay mounted, so a block
 * keeps running while you are here and the header says what the timer would
 * be saying. Its add field's drafts are the page's (`AddFields`), above Later's
 * key, so a line typed while an import lands is still there once it has; the
 * rest of Later — a rename half typed, a line being filed — is keyed by the
 * backlog's replacements (`replaced`), since it names records by id, and an
 * import may bring the same id back saying something else.
 */

import { useMemo } from 'react'

import { APP_WIDTH, AppBar } from '../AppHeader'
import { HeaderStatus } from '../HeaderStatus'
import { AddFields, useAddFieldsValue } from '../Tasks/addFields'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import { letGoLater, waitingLater } from '@/domain/later'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'
import { LaterSection } from './LaterSection'

export function TimelinePage({
  now,
  active,
  timerMode,
  onOpenSettings,
  mini,
}: {
  now: Ms
  active: ActiveSegment | null
  timerMode: TimerMode
  onOpenSettings: () => void
  mini: MiniWindowControls
}) {
  const phase = useSession((s) => s.phase)
  const hydrated = useTasks((s) => s.hydrated)
  const replaced = useTasks((s) => s.replaced)
  const addFields = useAddFieldsValue()

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The bar every view shares (`AppBar`): pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <AppBar
        current="timeline"
        phase={phase}
        mini={mini}
        onOpenSettings={onOpenSettings}
        status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
      />

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <main className={`mx-auto ${APP_WIDTH} px-4 py-8 sm:px-6 sm:py-10`}>
          <h1 className="text-3xl font-light text-bright sm:text-4xl">Timeline</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            What you put down for later waits here until you decide what it is: a task
            filed where it belongs, a line rewritten, or something to let go.
          </p>

          {!hydrated ? (
            <p className="mt-8 text-sm text-muted">Loading…</p>
          ) : (
            <AddFields.Provider value={addFields}>
              <WaitingLater key={replaced} />
            </AddFields.Provider>
          )}
        </main>
      </div>
    </div>
  )
}

/** Later, read per backlog snapshot rather than per tick of the header's timer. */
function WaitingLater() {
  const later = useTasks((s) => s.later)
  const waiting = useMemo(() => waitingLater(later), [later])
  const letGo = useMemo(() => letGoLater(later), [later])
  return <LaterSection waiting={waiting} letGo={letGo} />
}
