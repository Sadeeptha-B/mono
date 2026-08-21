/**
 * The stage: the one place on screen that changes with the session phase.
 *
 * Every decision Mono asks for now happens here, in the space the timer
 * occupies, rather than in a modal over the top of it. The timeline stays
 * visible throughout, which is the point — the question "do you need a break?"
 * is only answerable if you can see what the rest of the day holds.
 *
 * Dialogs are reserved for things that genuinely are asides: settings, and
 * editing the timeline from its own header.
 */

import { FocusTimer } from '../FocusTimer'
import { BlockCompletePanel, BreakDurationPanel } from './BreakPanels'
import { FirstCommitmentPanel, OutsideHoursPanel, ReadyPanel } from './IdlePanel'
import { PurposePanel } from './PurposePanel'
import { ReconcilePanel } from './ReconcilePanel'
import { GhostButton } from '../ui'

import type { Phase } from '@/domain/machine'
import type { ActiveSegment, BlockKind, Ms, Settings } from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  settings: Settings
  hasCommitments: boolean
  /** Whether `now` falls inside a work region. */
  withinHours: boolean
  hasRegions: boolean
  nextRegionStart: Ms | null
  nextBlockKind: BlockKind | null
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
  onAddCommitment: (input: { title: string; startsAt: number; durationMin: number }) => void
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
      // Being outside working hours outranks everything else the idle state
      // might say: there is no point offering a block in time the user has
      // declared unstructured.
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
      return props.hasCommitments ? (
        <ReadyPanel
          nextBlockKind={props.nextBlockKind}
          minutes={
            props.nextBlockKind === 'short' ? settings.shortMinutes : settings.deepMinutes
          }
          onStart={props.onStartBlock}
        />
      ) : (
        <FirstCommitmentPanel now={now} onAdd={props.onAddCommitment} />
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
