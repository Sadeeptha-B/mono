/**
 * The shell.
 *
 * Everything on screen is a view of one derived timeline. The stage shows the
 * current phase, the calendar shows all of it against the clock, and the
 * companion shows the mood — so none of them can disagree with the others.
 *
 * Two pieces of UI state live up here rather than where they are used. The
 * calendar's open editor, because the stage opens the hours one too and there
 * must only ever be one of it; and the settings panel, because it is the one
 * thing reachable from both routes.
 *
 * Both of those, and which opening question is on screen, describe *this*
 * session and this moment in it. So each one is adjusted during render against
 * something that says the moment has moved on — the session `generation`, and
 * the phase — rather than in an effect that would paint the stale answer for a
 * frame first.
 */

import { useMemo, useState } from 'react'

import { Clock } from '@/components/Clock'
import { SettingsPanel } from '@/components/SettingsPanel'
import { GuidePage } from '@/components/Guide/GuidePage'
import { Companion } from '@/components/Companion/Companion'
import { PixelCat } from '@/components/Companion/PixelCat'
import { Stage } from '@/components/stage/Stage'
import { StageCarousel } from '@/components/stage/StageCarousel'
import {
  FIRST_SETUP_STAGE,
  otherSetupStage,
  setupReachable,
  stageFor,
  type SetupStageId,
} from '@/components/stage/stages'
import { DayCalendar } from '@/components/Timeline/DayCalendar'
import { headerControlClass } from '@/components/ui'
import type { Composer } from '@/components/Timeline/SegmentEditor'

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
  const [composer, setComposer] = useState<Composer | null>(null)
  const [setupStage, setSetupStage] = useState<SetupStageId>(FIRST_SETUP_STAGE)
  // The opening questions, re-opened after the day was already shaped. It is
  // where the user is looking rather than anything about the day, so it lives
  // here and not in the log — `day/shaped` records being asked, and coming back
  // to change an answer is not being asked again.
  const [revisitingSetup, setRevisitingSetup] = useState(false)
  const [seenGeneration, setSeenGeneration] = useState(() => store.generation)

  const { phase, session } = store
  const [seenPhase, setSeenPhase] = useState(phase.name)
  const planInput = useMemo(() => toPlanInput(store, now), [store, now])
  const timeline = useMemo(() => derivePlan(planInput), [planInput])
  const regions = selectRegions(store, now)

  const nextBlock = timeline.entries.find((e) => e.kind === 'planned-block')
  const nextBlockKind: BlockKind | null =
    nextBlock?.kind === 'planned-block' ? nextBlock.blockKind : null

  const planned = countPlannedFocus(timeline)
  const withinHours = isWithinRegions(now, timeline.regions)
  const upNext = nextRegionStart(now, timeline.regions)
  const dayShaped = session.shapedAt !== null

  // The session was replaced under us — midnight came round with the tab open,
  // or a file was imported. The store resets its own state; this is the rest of
  // it, which lives out here: which of the opening questions is on screen, and
  // which calendar editor is expanded.
  //
  // Adjusted during render as React documents rather than in an effect, so the
  // new session never paints the old one's state for a frame first.
  if (seenGeneration !== store.generation) {
    setSeenGeneration(store.generation)
    setSetupStage(FIRST_SETUP_STAGE)
    setRevisitingSetup(false)
    setComposer(null)
  }

  // Waking up across a block boundary is an interruption rather than a stage:
  // `stageFor` returns null for it and the strip hides itself entirely, because
  // nothing that happened while we were away is recorded until the question is
  // answered. The calendar's editors were the one part of the UI that did not
  // follow, and a composer still expanded beside that prompt is somewhere else
  // for the answering click to land.
  //
  // On the transition into the phase rather than on the phase itself. Closing
  // it whenever the phase *is* reconciling would shut a composer the user
  // deliberately opened during one, half a frame after they pressed the button,
  // and the header toggles would look broken.
  if (seenPhase !== phase.name) {
    setSeenPhase(phase.name)
    if (phase.name === 'reconciling') setComposer(null)
  }

  // The stage shows the opening questions while they are unanswered, and again
  // whenever the user goes back to them.
  const setupOpen = !dayShaped || revisitingSetup
  const stage = stageFor(phase, setupOpen, setupStage)
  /**
   * Move the stage to one of the opening questions.
   *
   * The same gesture before the day is shaped and after it: the strip is the
   * navigation either way, and after it this is also what re-opens the panel.
   * The questions do not stop being answerable just because they were answered
   * once — what is fixed today and which hours are yours both keep changing.
   */
  const goToSetupStage = (next: SetupStageId) => {
    setSetupStage(next)
    setRevisitingSetup(true)
    if (next === 'hours' && composer?.kind === 'hours') setComposer(null)
  }

  /** Leaving the opening questions, from either of them. */
  const finishSetup = () => {
    if (!dayShaped) store.shapeDay()
    setRevisitingSetup(false)
  }

  const startBlock = (kind: BlockKind): void => {
    // The one gesture that unlocks audio and asks for notification permission.
    // Deliberately not awaited: the permission prompt is a browser-modal the
    // user might sit on for a while, and the app should not appear frozen
    // behind it. The unlock still runs inside the gesture, which is all the
    // browser requires of it.
    void unlock()
    store.dispatch({ type: 'startBlock', at: Date.now(), blockKind: kind })
  }

  // Settings is the last dialog in Mono, and the only thing both routes offer.
  // Opening it closes whatever the calendar had expanded: they both edit
  // working hours, and two editors of the same thing on screen at once is a
  // question about which one wins that nobody should have to ask.
  const openSettings = () => {
    setComposer(null)
    setSettingsOpen(true)
  }

  /**
   * The same rule, applied to the other pair that edits today's hours.
   *
   * The stage's opening question and the calendar's `Hours` composer ask
   * exactly the same thing, and each holds its own draft of the answer. Both
   * open at once is a race with a user in it: type in one, type in the other,
   * and whichever you save second silently overwrites the first. So opening
   * the composer takes the question off the stage — back to the day if it was
   * re-opened, to the other question if the day has not been shaped yet and
   * the panel cannot close. `goToSetupStage` closes the composer for the same
   * reason in the other direction.
   */
  const openComposer = (next: Composer | null) => {
    if (next?.kind === 'hours' && stage === 'hours') {
      if (dayShaped) setRevisitingSetup(false)
      else setSetupStage(otherSetupStage('hours'))
    }
    setComposer(next)
  }
  const settings = (
    <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  )

  // A view swap rather than a mount swap: every hook above stays live, so a
  // block in flight keeps ticking, chiming and reconciling while the guide is
  // open. Nothing about the session depends on this component's subtree.
  if (route === 'guide') {
    return (
      <>
        <GuidePage now={now} active={session.active} onOpenSettings={openSettings} />
        {settings}
      </>
    )
  }

  return (
    <div className="min-h-dvh bg-ink">
      <div className="mx-auto flex h-dvh max-w-6xl flex-col p-4 sm:p-6">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PixelCat
              phase={phase}
              progress={null}
              variant="mark"
              className="h-7 w-11"
              decorative
            />
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
            <button type="button" onClick={openSettings} className={headerControlClass}>
              Settings
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1fr_22rem]">
          <main className="mono-scroll flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <div className="flex items-start justify-between gap-6">
              <Clock now={now} />
              <Companion
                now={now}
                phase={phase}
                active={session.active}
                history={session.history}
              />
            </div>

            {/* The stage: every prompt Mono makes happens here, in place. */}
            {/* The stage is centred in whatever room is left, with the stage
                strip under it. Kept tight on purpose: the setup panel is the
                tallest thing Mono ever shows, and its Start control has to
                stay above the fold on a laptop in landscape. */}
            <div className="flex flex-1 flex-col justify-center gap-4 py-4">
              {/* Keyed by the session's generation so a rollover or an import
                  re-seeds every draft a panel is holding: the setup panel's
                  hours and commitment forms, the purpose being typed, the break
                  length chosen. All of it describes one particular session, and
                  none of it has anywhere else to be reset from. Safe to remount
                  because neither discontinuity can happen while a segment is
                  running — the rollover returns early, and an import lands
                  idle — so there is no timer here to interrupt. */}
              <Stage
                key={store.generation}
                now={now}
                phase={phase}
                active={session.active}
                settings={session.settings}
                setupOpen={setupOpen}
                revisitingSetup={setupOpen && dayShaped}
                setupStage={setupStage}
                onSetupStage={goToSetupStage}
                commitments={session.commitments}
                regions={regions}
                withinHours={withinHours}
                hasRegions={timeline.regions.length > 0}
                nextRegionStart={upNext}
                nextBlockKind={nextBlockKind}
                // `now`, not `Date.now()`: the cost quoted in the prompt should
                // be the cost against the timeline drawn beside it, and the
                // baseline is that very timeline rather than a second derive.
                costOf={(minutes) => breakCost(planInput, now, minutes, timeline)}
                onAddCommitment={store.addCommitment}
                onRemoveCommitment={store.removeCommitment}
                onSaveRegions={store.setRegions}
                onDayShaped={finishSetup}
                onEditHours={() => openComposer({ kind: 'hours' })}
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

              {/* Where in the day you are. A control whenever nothing is
                  running — the two opening questions can be answered in either
                  order, and reached again between blocks, because the shape of
                  a day keeps changing — and an indicator the rest of the time.
                  It never offers a way past "One thing": naming the block is
                  not skippable. */}
              <StageCarousel
                current={stage}
                {...(setupReachable(phase) ? { onNavigate: goToSetupStage } : {})}
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
            regions={regions}
            usingDefaultRegions={session.regionOverrides === null}
            composer={composer}
            onComposer={openComposer}
            commitments={session.commitments}
            breaks={session.overrides}
            onAddBreak={store.planBreak}
            onAddCommitment={store.addCommitment}
            onUpdateBreak={store.updateBreak}
            onUpdateCommitment={store.updateCommitment}
            onSetRegions={store.setRegions}
            onRemoveBreak={store.removeBreak}
            onRemoveCommitment={store.removeCommitment}
          />
        </div>
      </div>

      {settings}
    </div>
  )
}
