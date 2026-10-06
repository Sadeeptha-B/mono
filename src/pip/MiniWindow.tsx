/**
 * What the always-on-top window contains.
 *
 * A reduction of the stage, not a mirror of the app. The stage answers every
 * question Mono asks with the day drawn next to it, because a decision about
 * the day is unanswerable with the day covered up. This window has no day next
 * to it at all — so it takes the questions that do not need one, and shows the
 * ones that do as far as they have been answered, handing the answering back to
 * the tab. It is on whichever question the stage is on; see `miniViewFor`.
 *
 * The layout is a single column that survives being made much smaller than it
 * opens: the question on the left, the cat tucked into the corner beside it,
 * and the timing along the bottom. The question scrolls separately from the
 * timing and size reset, so a short window can still expose the control that
 * restores it.
 *
 * Rendered through a portal from `App`, so this is the same React tree as the
 * day view — same store subscription, same ticker, one reconciler. See
 * `useMiniWindow` for why that matters.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react'

import { Companion } from '@/components/Companion/Companion'
import {
  MiniAway,
  MiniBreakLength,
  MiniDone,
  MiniNothingFits,
  MiniOutsideHours,
  MiniPickInTab,
  MiniReady,
  MiniSetup,
  MiniTimer,
} from './MiniPanels'
import { miniViewFor, type MiniFacts } from './view'
import { MINI_WINDOW_SIZE, outsideMiniWindowRange } from './size'
import { GhostButton } from '@/components/ui'
import { AmbienceButton } from '@/ambient/AmbienceButton'
import { formatClock, formatDuration } from '@/domain/time'
import { DAY_HASH } from '@/hooks/useRoute'
import type { TimerMode } from '@/domain/time'
import type { Phase } from '@/domain/machine'
import type { DayProgress } from '@/domain/dayProgress'
import type { AmbienceControls } from '@/ambient/useAmbience'
import type {
  ActiveSegment,
  BlockKind,
  Commitment,
  CompletedSegment,
  Intention,
  Ms,
  Settings,
  WorkRegion,
} from '@/domain/types'

type Props = {
  now: Ms
  phase: Phase
  active: ActiveSegment | null
  timerMode: TimerMode
  onToggleTimerMode: () => void
  history: readonly CompletedSegment[]
  settings: Settings
  dayProgress: DayProgress
  ambience: AmbienceControls
  facts: MiniFacts
  /** Blocks and minutes still ahead of you today — the stage's own footer. */
  planned: { blocks: number; minutes: number }
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
  /** What the opening questions have been answered with so far. */
  commitments: readonly Commitment[]
  regions: readonly WorkRegion[]
  intentions: readonly Intention[]
  /** The intentions question's timer, which `App` holds rather than the phase. */
  intentionTimer: { endsAt: Ms } | null
  onStartIntentionTimer: () => void
  onStartDeciding: () => void
  onStartBlock: (kind: BlockKind) => void
  onAbandon: () => void
  onTakeBreak: () => void
  onSkipBreak: (kind: BlockKind) => void
  onConfirmBreak: (minutes: number) => void
  onCancelBreak: () => void
  onEndBreak: () => void
  onResolveAway: (result: 'completed' | 'abandoned') => void
}

export function MiniWindow(props: Props) {
  const { now, phase, active } = props
  const view = miniViewFor(phase, props.facts)
  const root = useRef<HTMLDivElement>(null)
  const [showResetSize, setShowResetSize] = useState(false)

  useEffect(() => {
    // The portal runs in the opener's React tree, but its element belongs to
    // the PiP document. Listen to that window, not the tab left behind.
    const pip = root.current?.ownerDocument.defaultView
    if (!pip) return

    const checkSize = () => {
      setShowResetSize(outsideMiniWindowRange(pip.innerWidth, pip.innerHeight))
    }
    checkSize()
    pip.addEventListener('resize', checkSize)
    return () => pip.removeEventListener('resize', checkSize)
  }, [])

  const resetSize = (event: MouseEvent<HTMLButtonElement>) => {
    const pip = event.currentTarget.ownerDocument.defaultView
    if (!pip) return
    // Document PiP only permits programmatic resizing from a gesture inside
    // its own window. resizeBy uses outer dimensions but the delta between the
    // current and desired viewport is the same, regardless of title-bar size.
    try {
      pip.resizeBy(
        MINI_WINDOW_SIZE.width - pip.innerWidth,
        MINI_WINDOW_SIZE.height - pip.innerHeight,
      )
    } catch {
      // A browser may decline the resize; the content remains scrollable and
      // the control stays available for another attempt.
    }
  }

  // The outer border stays at the window edge while the content scrollbar
  // moves inside it; putting the border on the scroller would pull it inward.
  return (
    <div
      ref={root}
      className="flex h-dvh flex-col border border-muted/75 bg-ink"
    >
      <div className="mono-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-2">
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
      </div>

      {/* The timing is the other half of what an indicator is for. Keep it and
          Reset size outside the scrollport so both remain visible when the
          window is made short. */}
      <div className="shrink-0 px-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-[11px] text-muted">
          <span>
            {active
              ? `Ends ${formatClock(active.endsAt)} · ${blocksAhead(props.planned.blocks)}`
              : `${blocksAhead(props.planned.blocks)} · ${formatDuration(props.planned.minutes * 60_000)} of focus`}
          </span>
          {showResetSize && (
            <button
              type="button"
              onClick={resetSize}
              className="shrink-0 rounded-sm text-body underline-offset-2 hover:text-bright hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright"
            >
              Reset size
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Bring the tab forward on the day, where every question this window hands back
 * is answered.
 *
 * Focusing alone was not enough. The tab may be on the tasks page or the guide,
 * and a block started from this window opens its purpose prompt on the stage,
 * which neither page shows — so the click arrived at a page with nothing to
 * answer. The route is a hash, so changing it swaps the view without unmounting
 * anything, exactly as the header's own links do.
 */
function openDayInTab(): void {
  if (window.location.hash !== DAY_HASH) window.location.hash = DAY_HASH
  window.focus()
}

const blocksAhead = (blocks: number): string =>
  `${blocks} block${blocks === 1 ? '' : 's'} ahead`

function body(props: Props, view: ReturnType<typeof miniViewFor>) {
  const { now, active, settings } = props

  switch (view.kind) {
    case 'setup':
      // `window` here is the opener — the portal's children are the opener's
      // code, whichever document they draw into. Chromium may ignore a focus
      // request for a tab it did not open, which is why this is a nudge rather
      // than the only way back; the window's own title bar carries a
      // back-to-tab button that always works.
      return (
        <MiniSetup
          stage={view.stage}
          revisiting={view.revisiting}
          now={now}
          commitments={props.commitments}
          regions={props.regions}
          intentions={props.intentions}
          timer={props.intentionTimer}
          timerMinutes={settings.intentionMinutes}
          onStartTimer={props.onStartIntentionTimer}
          onOpenTab={openDayInTab}
        />
      )

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
      // Picking a block's tasks happens in the tab, which has the backlog and
      // today's intentions to pick from. Not starting at all is still
      // answerable here, and so is taking a few minutes to decide.
      return (
        <MiniPickInTab
          now={now}
          blockKind={view.blockKind}
          minutes={
            view.blockKind === 'short' ? settings.shortMinutes : settings.deepMinutes
          }
          deciding={view.deciding}
          decidingMinutes={settings.reflectMinutes}
          onStartDeciding={props.onStartDeciding}
          onOpenTab={openDayInTab}
          onCancel={props.onAbandon}
        />
      )

    case 'running':
      return (
        <div>
          <MiniTimer
            now={now}
            active={active}
            timerMode={props.timerMode}
            onToggleTimerMode={props.onToggleTimerMode}
          />
          {/* No task list here while the block runs. The purpose above already
              says what the block is for in one line, the opening size is tuned
              to hold exactly the timer, that line and the controls, and a list
              always on top is a list of reasons to look at it. The tasks come
              back at the end of the block, where ticking them is the point. */}
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
          taskIds={active?.kind === 'block' ? active.taskIds : []}
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
