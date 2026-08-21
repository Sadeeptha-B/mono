/**
 * The shell.
 *
 * Everything on screen is a view of one derived timeline. The stage shows the
 * current phase, the calendar shows all of it against the clock, and the
 * companion shows the mood — so none of them can disagree with the others.
 */

import { useMemo, useState } from 'react'

import { Clock } from '@/components/Clock'
import { SettingsPanel } from '@/components/SettingsPanel'
import { GuidePage } from '@/components/Guide/GuidePage'
import { OneLine } from '@/components/Companion/OneLine'
import { Stage } from '@/components/stage/Stage'
import { DayCalendar } from '@/components/Timeline/DayCalendar'
import {
  AddBreakDialog,
  AddCommitmentDialog,
  TodayHoursDialog,
} from '@/components/Timeline/SegmentEditor'

import { useNow } from '@/hooks/useNow'
import { useRoute, GUIDE_HASH } from '@/hooks/useRoute'
import { useReconciliation } from '@/hooks/useReconciliation'
import { useBlockEndAlerts, useUnlock } from '@/hooks/useNotifications'
import { breakCost, countPlannedFocus, derivePlan } from '@/domain/planner'
import { formatDuration, isWithinRegions, nextRegionStart } from '@/domain/time'
import { useSession, toPlanInput, selectRegions } from '@/store/session'
import type { BlockKind } from '@/domain/types'

export function App() {
  const now = useNow()
  useReconciliation()
  useBlockEndAlerts()
  const route = useRoute()

  const store = useSession()
  const unlock = useUnlock()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addingBreak, setAddingBreak] = useState(false)
  const [addingCommitment, setAddingCommitment] = useState(false)
  const [editingHours, setEditingHours] = useState(false)

  const { phase, session } = store
  const planInput = useMemo(() => toPlanInput(store, now), [store, now])
  const timeline = useMemo(() => derivePlan(planInput), [planInput])

  const nextBlock = timeline.entries.find((e) => e.kind === 'planned-block')
  const nextBlockKind: BlockKind | null =
    nextBlock?.kind === 'planned-block' ? nextBlock.blockKind : null

  const planned = countPlannedFocus(timeline)
  const withinHours = isWithinRegions(now, timeline.regions)
  const upNext = nextRegionStart(now, timeline.regions)
  const progress = session.active
    ? clamp01(
        (now - session.active.startedAt) /
          Math.max(1, session.active.endsAt - session.active.startedAt),
      )
    : null

  const startBlock = (kind: BlockKind): void => {
    // The one gesture that unlocks audio and asks for notification permission.
    // Deliberately not awaited: the permission prompt is a browser-modal the
    // user might sit on for a while, and the app should not appear frozen
    // behind it. The unlock still runs inside the gesture, which is all the
    // browser requires of it.
    void unlock()
    store.dispatch({ type: 'startBlock', at: Date.now(), blockKind: kind })
  }

  // A view swap rather than a mount swap: every hook above stays live, so a
  // block in flight keeps ticking, chiming and reconciling while the guide is
  // open. Nothing about the session depends on this component's subtree.
  if (route === 'guide') return <GuidePage now={now} active={session.active} />

  return (
    <div className="min-h-dvh bg-ink">
      <div className="mx-auto flex h-dvh max-w-6xl flex-col p-4 sm:p-6">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <OneLine phase={phase} progress={null} className="h-7 w-11" decorative />
            <span className="text-sm font-medium tracking-widest text-body uppercase">
              Mono
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* A real link, so the guide can be opened in its own tab and
                survives a reload like the document it is. */}
            <a href={GUIDE_HASH} className={headerControlClass}>
              Guide
            </a>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={headerControlClass}
            >
              Settings
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1fr_22rem]">
          <main className="mono-scroll flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <div className="flex items-start justify-between gap-6">
              <Clock now={now} />
              <OneLine
                phase={phase}
                progress={progress}
                className="h-20 w-32 shrink-0 sm:h-24 sm:w-40"
              />
            </div>

            {/* The stage: every prompt Mono makes happens here, in place. */}
            <div className="flex flex-1 items-center py-8">
              <Stage
                now={now}
                phase={phase}
                active={session.active}
                settings={session.settings}
                hasCommitments={session.commitments.length > 0}
                withinHours={withinHours}
                hasRegions={timeline.regions.length > 0}
                nextRegionStart={upNext}
                nextBlockKind={nextBlockKind}
                // `now`, not `Date.now()`: the cost quoted in the prompt should
                // be the cost against the timeline drawn beside it, and the
                // baseline is that very timeline rather than a second derive.
                costOf={(minutes) => breakCost(planInput, now, minutes, timeline)}
                onAddCommitment={store.addCommitment}
                onEditHours={() => setEditingHours(true)}
                onStartBlock={startBlock}
                onSetPurpose={(purpose) =>
                  store.dispatch({ type: 'setPurpose', at: Date.now(), purpose })
                }
                onCannotDecide={() =>
                  store.dispatch({ type: 'cannotDecide', at: Date.now() })
                }
                onAbandon={() => store.dispatch({ type: 'abandonBlock', at: Date.now() })}
                onTakeBreak={() => store.dispatch({ type: 'takeBreak', at: Date.now() })}
                onSkipBreak={(kind) =>
                  store.dispatch({ type: 'skipBreak', at: Date.now(), nextBlockKind: kind })
                }
                onConfirmBreak={(durationMin) =>
                  store.dispatch({ type: 'confirmBreak', at: Date.now(), durationMin })
                }
                onCancelBreak={() =>
                  store.dispatch({ type: 'cancelBreakChoice', at: Date.now() })
                }
                onEndBreak={() => store.dispatch({ type: 'endBreak', at: Date.now() })}
                onResolveAway={(outcome) =>
                  store.dispatch({ type: 'resolveAway', at: Date.now(), outcome })
                }
              />
            </div>

            <div className="border-t border-line pt-4 text-xs text-muted">
              {planned.blocks} block{planned.blocks === 1 ? '' : 's'} ahead ·{' '}
              {formatDuration(planned.minutes * 60_000)} of focus
              {!withinHours && timeline.regions.length > 0 && ' · outside working hours'}
            </div>
          </main>

          <DayCalendar
            timeline={timeline}
            now={now}
            onAddBreak={() => setAddingBreak(true)}
            onAddCommitment={() => setAddingCommitment(true)}
            onAddRegion={() => setEditingHours(true)}
            onRemoveBreak={store.removeBreak}
            onRemoveCommitment={store.removeCommitment}
          />
        </div>
      </div>

      <AddCommitmentDialog
        open={addingCommitment}
        now={now}
        onAdd={(input) => {
          store.addCommitment(input)
          setAddingCommitment(false)
        }}
        onCancel={() => setAddingCommitment(false)}
      />

      <AddBreakDialog
        open={addingBreak}
        now={now}
        onAdd={(input) => {
          store.planBreak(input)
          setAddingBreak(false)
        }}
        onCancel={() => setAddingBreak(false)}
      />

      <TodayHoursDialog
        open={editingHours}
        now={now}
        regions={selectRegions(store, now)}
        usingDefaults={session.regionOverrides === null}
        onSave={(regions) => {
          store.setRegions(regions.map((r, i) => ({ ...r, id: `today-${i}-${r.startsAt}` })))
          setEditingHours(false)
        }}
        onCancel={() => setEditingHours(false)}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

const headerControlClass =
  'rounded-lg border border-line px-3 py-1.5 text-xs text-body transition hover:bg-surface-raised hover:text-bright'
