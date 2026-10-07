/**
 * What the timer would be saying, for a page that is not the day.
 *
 * The guide, the tasks page and the routine page all take the stage off the
 * screen, and all are pages you stay on for a while. None should quietly cost
 * you the block you are in, or a question Mono is waiting on, so each header
 * carries this strip (`AppHeader`'s `status`), and it links back to the timer.
 * One component, because two copies of what the timer "would be saying" would
 * be two answers to the same question.
 */

import type { ReactNode } from 'react'

import { timerFace } from './timerFace'
import { DAY_HASH } from '@/hooks/useRoute'
import type { Phase } from '@/domain/machine'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'

/**
 * What the timer would be saying, in the header.
 *
 * A running block is the usual case, but Mono also *asks* things, and a
 * question the user cannot see is a question they will not answer — the guide
 * would quietly cost them the decision it was explaining. So a phase that is
 * waiting on an answer says so here, and outranks the timer: when a block
 * has just ended, "Block done" is the truth and a timer counting past zero is
 * merely a number.
 */
const WAITING: Partial<Record<Phase['name'], string>> = {
  definingPurpose: 'Name the block',
  blockComplete: 'Block done',
  choosingBreak: 'How long a break?',
  reconciling: 'You were away',
}

export function HeaderStatus({
  active,
  now,
  phase,
  timerMode,
}: {
  active: ActiveSegment | null
  now: Ms
  phase: Phase
  timerMode: TimerMode
}) {
  const waiting = WAITING[phase.name]

  if (waiting !== undefined) {
    return (
      <Strip tone="text-bright" title="Back to the timer">
        <span className="tracking-widest uppercase">{waiting}</span>
        <span className="text-muted">answer on the timer</span>
      </Strip>
    )
  }

  if (!active) return null

  const face = timerFace(active, now, timerMode)
  const kind = active.kind === 'break' ? 'break' : active.blockKind

  return (
    <Strip tone={TONE[kind]} title="Back to the timer">
      <span className="tracking-widest uppercase">{RUNNING_LABEL[kind]}</span>
      <span className="tnum text-bright">
        {face.overrun && timerMode === 'remaining' && '+'}{face.reading}
      </span>
      <span className="text-muted">{face.modeLabel.toLowerCase()}</span>
    </Strip>
  )
}

const TONE = {
  deep: 'text-deep',
  short: 'text-short',
  reflect: 'text-reflect',
  break: 'text-rest',
} as const

const RUNNING_LABEL = {
  deep: 'Focusing',
  short: 'Focusing',
  reflect: 'Priorities',
  break: 'Break',
} as const

const Strip = ({
  tone,
  title,
  children,
}: {
  tone: string
  title: string
  children: ReactNode
}) => (
  <a
    href={DAY_HASH}
    title={title}
    className={`flex items-center gap-2 rounded-lg border border-muted/70 px-3 py-1.5 text-xs transition hover:bg-surface-raised ${tone}`}
  >
    {children}
  </a>
)
