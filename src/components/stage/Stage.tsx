/**
 * The stage: the one place on screen that changes with the session phase.
 *
 * Every decision Mono asks for now happens here, in the space the timer
 * occupies, rather than in a modal over the top of it. The timeline stays
 * visible throughout, which is the point — the question "do you need a break?"
 * is only answerable if you can see what the rest of the day holds.
 *
 * The only dialog left in Mono is settings, which genuinely is an aside. The
 * calendar's own editors used to be dialogs too, on the grounds that they were
 * asides as well — but adding a commitment is an edit *to* the timeline, and a
 * card centred over a blurred backdrop hid the one thing you needed to see to
 * answer. They open in place on the calendar now.
 */

import { FocusTimer } from '../FocusTimer'
import { BlockCompletePanel, BreakDurationPanel } from './BreakPanels'
import { DaySetupPanel } from './DaySetupPanel'
import { OutsideHoursPanel, ReadyPanel } from './IdlePanel'
import { PurposePanel } from './PurposePanel'
import { ReconcilePanel } from './ReconcilePanel'
import { GhostButton } from '../ui'

import type { SetupStageId } from './stages'
import type { Phase } from '@/domain/machine'
import type {
  ActiveSegment,
  BlockKind,
  Commitment,
  Ms,
  Settings,
  WorkRegion,
} from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  settings: Settings
  /** Whether the day's opening questions have been answered yet. */
  dayShaped: boolean
  /** Which opening question is on screen. Owned by `App`, so the carousel can move it. */
  setupStage: SetupStageId
  onSetupStage: (stage: SetupStageId) => void
  commitments: readonly Commitment[]
  regions: readonly WorkRegion[]
  /** Whether `now` falls inside a work region. */
  withinHours: boolean
  hasRegions: boolean
  nextRegionStart: Ms | null
  nextBlockKind: BlockKind | null
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
  onAddCommitment: (input: Omit<Commitment, 'id'>) => void
  onRemoveCommitment: (id: string) => void
  onSaveRegions: (regions: WorkRegion[]) => void
  onDayShaped: () => void
  onEditHours: () => void
  onStartBlock: (kind: BlockKind) => void
  onSetPurpose: (purpose: string) => void
  onCannotDecide: () => void
  onAbandon: () => void
  onTakeBreak: () => void
  onSkipBreak: (kind: BlockKind) => void
  onConfirmBreak: (minutes: number) => void
  onCancelBreak: () => void
  onEndBreak: () => void
  onResolveAway: (outcome: 'completed' | 'abandoned') => void
}

export function Stage(props: Props) {
  const { now, phase, active, settings } = props

  switch (phase.name) {
    case 'idle':
      // A day that has not been asked its opening questions outranks everything
      // else, including being outside working hours — declaring those hours is
      // the first of the two questions, so refusing to plan until they are set
      // and then not asking would be a closed loop. The panel folds the clock
      // in as context instead.
      if (!props.dayShaped) {
        return (
          <DaySetupPanel
            now={now}
            stage={props.setupStage}
            onStage={props.onSetupStage}
            regions={props.regions}
            withinHours={props.withinHours}
            nextRegionStart={props.nextRegionStart}
            commitments={props.commitments}
            onSaveRegions={props.onSaveRegions}
            onAddCommitment={props.onAddCommitment}
            onRemoveCommitment={props.onRemoveCommitment}
            onDone={props.onDayShaped}
          />
        )
      }
      // After that, being outside working hours outranks the rest: there is no
      // point offering a block in time the user has declared unstructured.
      if (!props.withinHours) {
        return (
          <OutsideHoursPanel
            now={now}
            nextStart={props.nextRegionStart}
            hasRegions={props.hasRegions}
            onEditHours={props.onEditHours}
          />
        )
      }
      return (
        <ReadyPanel
          nextBlockKind={props.nextBlockKind}
          minutes={
            props.nextBlockKind === 'short' ? settings.shortMinutes : settings.deepMinutes
          }
          onStart={props.onStartBlock}
        />
      )

    case 'definingPurpose':
      return (
        <PurposePanel
          blockKind={phase.blockKind}
          afterReflection={phase.afterReflection}
          minutes={
            phase.blockKind === 'short' ? settings.shortMinutes : settings.deepMinutes
          }
          reflectMinutes={settings.reflectMinutes}
          onSubmit={props.onSetPurpose}
          onCannotDecide={props.onCannotDecide}
          onCancel={props.onAbandon}
        />
      )

    case 'focusing':
    case 'reflecting':
      return (
        <div>
          <FocusTimer now={now} active={active} phase={phase} />
          <div className="mt-6">
            <GhostButton type="button" onClick={props.onAbandon}>
              End early
            </GhostButton>
          </div>
        </div>
      )

    case 'blockComplete':
      return (
        <BlockCompletePanel
          nextBlockKind={props.nextBlockKind}
          onTakeBreak={props.onTakeBreak}
          onSkipBreak={props.onSkipBreak}
        />
      )

    case 'choosingBreak':
      return (
        <BreakDurationPanel
          costOf={props.costOf}
          onConfirm={props.onConfirmBreak}
          onCancel={props.onCancelBreak}
        />
      )

    case 'onBreak':
      return (
        <div>
          <FocusTimer now={now} active={active} phase={phase} />
          <div className="mt-6">
            <GhostButton type="button" onClick={props.onEndBreak}>
              Back to work
            </GhostButton>
          </div>
        </div>
      )

    case 'reconciling':
      return (
        <ReconcilePanel
          blockEndedAt={phase.blockEndedAt}
          now={now}
          kind={active?.kind === 'break' ? 'break' : 'block'}
          purpose={active?.kind === 'block' ? active.purpose : null}
          onResolve={props.onResolveAway}
        />
      )
  }
}
