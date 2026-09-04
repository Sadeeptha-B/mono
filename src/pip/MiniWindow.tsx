/**
 * What the always-on-top window contains.
 *
 * A reduction of the stage, not a mirror of the app. The stage answers every
 * question Mono asks with the day drawn next to it, because a decision about
 * the day is unanswerable with the day covered up. This window has no day next
 * to it at all — so it takes the questions that do not need one, and hands the
 * one that does back to the tab.
 *
 * The layout is a single column that survives being made much smaller than it
 * opens: the question on the left, the cat tucked into the corner beside it,
 * and the timing along the bottom. It scrolls rather than clipping, because the
 * window is the user's to resize and a control they cannot reach is worse than
 * a scrollbar.
 *
 * Rendered through a portal from `App`, so this is the same React tree as the
 * day view — same store subscription, same ticker, one reconciler. See
 * `useMiniWindow` for why that matters.
 */

import { Companion } from '@/components/Companion/Companion'
import {
  MiniAway,
  MiniBreakLength,
  MiniDone,
  MiniNothingFits,
  MiniOutsideHours,
  MiniPurpose,
  MiniReady,
  MiniTimer,
  MiniUnshaped,
} from './MiniPanels'
import { miniViewFor, type MiniFacts } from './view'
import { GhostButton } from '@/components/ui'
import { AmbienceButton } from '@/ambient/AmbienceButton'
import { formatClock, formatDuration } from '@/domain/time'
import type { Phase } from '@/domain/machine'
import type { DayProgress } from '@/domain/dayProgress'
import type { AmbienceControls } from '@/ambient/useAmbience'
import type {
  ActiveSegment,
  BlockKind,
  CompletedSegment,
  Ms,
  Settings,
} from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  history: readonly CompletedSegment[]
  settings: Settings
  dayProgress: DayProgress
  ambience: AmbienceControls
  facts: MiniFacts
  /** Blocks and minutes still ahead of you today — the stage's own footer. */
  planned: { blocks: number; minutes: number }
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
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

export function MiniWindow(props: Props) {
  const { now, phase, active } = props
  const view = miniViewFor(phase, props.facts)

  return (
    <div className="mono-scroll flex h-dvh flex-col gap-2 overflow-y-auto bg-ink px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{body(props, view)}</div>
        {/* The same creature the stage has, knowing the same things about the
            day — including the markings it has earned today. Two cats that
            disagreed about how the morning went would be two cats. */}
        <Companion
          now={now}
          phase={phase}
          active={active}
          history={props.history}
          roomId={props.settings.roomId}
          dayProgress={props.dayProgress}
          className="h-16 w-28"
        />
      </div>

      {/* The timing, which is the other half of what an indicator is for.
          `mt-auto` pins it to the bottom of a tall window and lets it sit
          directly under the content in a short one. */}
      <div className="mt-auto border-t border-line pt-2 text-[11px] text-muted">
        {active
          ? `Ends ${formatClock(active.endsAt)} · ${blocksAhead(props.planned.blocks)}`
          : `${blocksAhead(props.planned.blocks)} · ${formatDuration(props.planned.minutes * 60_000)} of focus`}
      </div>
    </div>
  )
}

const blocksAhead = (blocks: number): string =>
  `${blocks} block${blocks === 1 ? '' : 's'} ahead`

function body(props: Props, view: ReturnType<typeof miniViewFor>) {
  const { now, active, settings } = props

  switch (view.kind) {
    case 'unshaped':
      // `window` here is the opener — the portal's children are the opener's
      // code, whichever document they draw into. Chromium may ignore a focus
      // request for a tab it did not open, which is why this is a nudge rather
      // than the only way back; the window's own title bar carries a
      // back-to-tab button that always works.
      return <MiniUnshaped onOpenTab={() => window.focus()} />

    case 'outsideHours':
      return (
        <MiniOutsideHours
          now={now}
          nextStart={view.nextStart}
          progress={props.dayProgress}
        />
      )

    case 'nothingFits':
      return <MiniNothingFits />

    case 'ready':
      return (
        <MiniReady
          blockKind={view.blockKind}
          minutes={view.blockKind === 'short' ? settings.shortMinutes : settings.deepMinutes}
          onStart={props.onStartBlock}
        />
      )

    case 'purpose':
      return (
        <MiniPurpose
          blockKind={view.blockKind}
          minutes={
            view.blockKind === 'short' ? settings.shortMinutes : settings.deepMinutes
          }
          onSubmit={props.onSetPurpose}
          onCannotDecide={props.onCannotDecide}
          onCancel={props.onAbandon}
        />
      )

    case 'running':
      return (
        <div>
          <MiniTimer now={now} active={active} />
          <div className="mt-3 flex flex-wrap gap-2">
            {view.segment === 'break' ? (
              <GhostButton type="button" onClick={props.onEndBreak}>
                Back to work
              </GhostButton>
            ) : (
              <GhostButton type="button" onClick={props.onAbandon}>
                End early
              </GhostButton>
            )}
            {view.segment === 'block' && <AmbienceButton ambience={props.ambience} />}
          </div>
        </div>
      )

    case 'done':
      return (
        <MiniDone
          nextBlockKind={view.nextBlockKind}
          onTakeBreak={props.onTakeBreak}
          onSkipBreak={props.onSkipBreak}
        />
      )

    case 'breakLength':
      return (
        <MiniBreakLength
          costOf={props.costOf}
          onConfirm={props.onConfirmBreak}
          onCancel={props.onCancelBreak}
        />
      )

    case 'away':
      return (
        <MiniAway
          blockEndedAt={view.blockEndedAt}
          now={now}
          kind={active?.kind === 'break' ? 'break' : 'block'}
          onResolve={props.onResolveAway}
        />
      )
  }
}
