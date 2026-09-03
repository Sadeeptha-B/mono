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
import { StorageWarning } from '@/components/StorageWarning'
import {
  hoursToSave,
  resolveHours,
  useHoursDraft,
  withIds,
} from '@/components/TodayHours'
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
  const regions = selectRegions(store, now)

  /**
   * Today's hours as the opening question has them, saved or not.
   *
   * This is one level higher than the panel that edits it, and the calendar is
   * the reason. Typing an evening stretch into the question is a statement
   * about the day drawn beside it, and while the draft lived in the panel the
   * calendar heard none of it until `Start the day` — you declared the shape of
   * your day and the day went on showing yesterday's answer, which is the
   * clearest way to look broken that a derived plan has.
   *
   * So the plan is derived from the draft. Nothing is written: `derivePlan` is
   * a pure function of its input, so feeding it hours nobody has saved yet is
   * the ordinary way to ask what they would mean, and the answer costs one
   * derive that was happening every second anyway. The write still happens
   * once, at `finishSetup`, and still goes through `hoursToSave` so an
   * untouched draft never stamps an override.
   *
   * `edited` rather than `draft` decides whether to preview at all. An
   * untouched draft is equal to the day by construction, so previewing it would
   * be a no-op — but it would also mean round-tripping the day's real regions
   * through wall clock on every tick, and losing the seconds off a region
   * boundary is not something to do by accident.
   */
  const { draft: hoursDraft, onDraft: onHoursDraft, edited, reset: resetHours } =
    useHoursDraft(regions)
  const hoursPreview = useMemo(
    () => (edited === null ? undefined : withIds(resolveHours(now, edited))),
    [edited, now],
  )

  const planInput = useMemo(
    () => toPlanInput(store, now, hoursPreview),
    [store, now, hoursPreview],
  )
  const timeline = useMemo(() => derivePlan(planInput), [planInput])

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
    // The calendar's own drafts are cleared by remounting — the composers
    // unmount with the editor, the stage panel is keyed on the generation. This
    // one outlives both, so it is cleared by hand: hours typed at 23:59 are
    // about yesterday, and previewing them onto the new day would be the same
    // bug the calendar composers already had, one level up.
    resetHours()
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

  /**
   * Leaving the opening questions, from either of them.
   *
   * The hours are written here rather than by the panel that asked for them,
   * because `Start the day` finishes from whichever question is on screen and
   * the draft has to survive the switch either way. An untouched draft is left
   * alone rather than written back — see `hoursToSave`. Saving it would stamp
   * an override on every single day, and today's regions are meant to stay
   * *derived* from the recurring shape.
   */
  const finishSetup = () => {
    const next = hoursToSave(now, hoursDraft, regions)
    if (next) store.setRegions(next)
    resetHours()
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
    if (next?.kind === 'hours') {
      if (stage === 'hours') {
        if (dayShaped) setRevisitingSetup(false)
        else setSetupStage(otherSetupStage('hours'))
      }
      // The composer wins the edit, so the question's draft goes — including
      // when the question was not the one on screen. It outlives the panel now
      // and it is what the calendar is previewing, so leaving it would mean the
      // composer saving 4pm and the timeline still drawing the 10pm nobody
      // committed, waiting to be written by the next `Start the day`.
      resetHours()
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
      {/*
        Two layouts, one breakpoint. Wide enough for the two columns and the
        app owns the viewport: `lg:h-dvh` pins it, and each panel scrolls
        inside itself, so the timer stays put while you scroll around the day
        beside it. Narrower and that inverts — the columns stack, so pinning
        the height would mean two short boxes with their own scrollbars inside
        a page that does not move, and a phone would be showing about a third
        of each. Below `lg` nothing is pinned: both panels are as tall as what
        they hold and the document scrolls, which is the one scroll a phone
        does well.
      */}
      <div className="mx-auto flex max-w-6xl flex-col p-4 sm:p-6 lg:h-dvh">
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
            {/* Nothing at all unless the browser has started refusing to save,
                which is the one failure worth a permanent place on screen. */}
            <StorageWarning onOpenSettings={openSettings} />
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

        <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_22rem]">
          <main className="mono-scroll flex flex-col rounded-2xl border border-line bg-surface p-5 sm:p-8 lg:min-h-0 lg:overflow-y-auto">
            {/* The clock and the companion share a line, and on a phone they
                are within a few pixels of not fitting on one. Both give ground
                rather than one of them wrapping under the other. */}
            <div className="flex items-start justify-between gap-3 sm:gap-6">
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
                  re-seeds every draft a panel is holding: the commitment being
                  written, the purpose being typed, the break length chosen. All
                  of it describes one particular session, and none of it has
                  anywhere else to be reset from. (Today's hours is the
                  exception, and the only one: it is held above this key so the
                  calendar can draw it, so it is reset by hand instead.) Safe to
                  remount because neither discontinuity can happen while a
                  segment is running — the rollover returns early, and an import
                  lands idle — so there is no timer here to interrupt. */}
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
                // The day as the calendar is drawing it, draft included, so
                // the question and the timeline beside it cannot disagree
                // about whether any hours have been declared at all.
                regions={planInput.regions}
                hours={hoursDraft}
                onHours={onHoursDraft}
                withinHours={withinHours}
                hasRegions={timeline.regions.length > 0}
                nextRegionStart={upNext}
                nextBlockKind={nextBlockKind}
                // `now`, not `Date.now()`: the cost quoted in the prompt should
                // be the cost against the timeline drawn beside it, and the
                // baseline is that very timeline rather than a second derive.
                costOf={(minutes) => breakCost(planInput, now, minutes, timeline)}
                onAddCommitment={store.addCommitment}
                onUpdateCommitment={store.updateCommitment}
                onRemoveCommitment={store.removeCommitment}
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
