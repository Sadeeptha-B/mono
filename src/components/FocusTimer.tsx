/**
 * The current-state timer.
 *
 * The two faces read absolute segment timestamps, never an accumulated counter,
 * so a missed or throttled tick makes either briefly stale but never wrong.
 */

import { timerFace } from './timerFace'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment } from '@/domain/types'
import type { Phase } from '@/domain/machine'

type Props = {
  now: number
  active: ActiveSegment | null
  phase: Phase
  timerMode: TimerMode
  onToggleTimerMode: () => void
}

const KIND_LABEL: Record<string, string> = {
  deep: 'Deep block',
  short: 'Short block',
  reflect: 'Working out priorities',
}

export function FocusTimer({ now, active, phase, timerMode, onToggleTimerMode }: Props) {
  if (!active) {
    return (
      <div className="text-muted">
        <div className="tnum text-5xl font-light text-line">--:--</div>
        <div className="mt-2 text-sm">
          {phase.name === 'definingPurpose' ? 'Name the block to begin' : 'Nothing running'}
        </div>
      </div>
    )
  }

  const face = timerFace(active, now, timerMode)
  const label =
    active.kind === 'break' ? 'Break' : (KIND_LABEL[active.blockKind] ?? 'Block')

  const tone =
    active.kind === 'break'
      ? 'text-rest'
      : active.blockKind === 'reflect'
        ? 'text-reflect'
        : active.blockKind === 'deep'
          ? 'text-deep'
          : 'text-short'

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className={`text-xs font-medium tracking-widest uppercase ${tone}`}>
          {label}
        </span>
        {face.overrun && (
          <span className="text-xs text-commit">over by {face.overBy}</span>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleTimerMode}
        aria-label={face.buttonLabel}
        className={`tnum mt-1 cursor-pointer rounded-sm text-left text-5xl font-light hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright sm:text-6xl ${face.overrun ? 'text-commit' : 'text-bright'}`}
        // The focused button has a stable name; a ticking accessible name could
        // be announced every second. The non-interactive sibling below exposes
        // the current reading on demand without making it a live region.
      >
        {face.reading}
      </button>
      <span className="sr-only">{face.reading}</span>
      <div className="mt-0.5 text-xs text-muted">{face.modeLabel}</div>

      {active.kind === 'block' && active.purpose && (
        <p className="mt-3 max-w-sm text-lg leading-snug text-body">{active.purpose}</p>
      )}
    </div>
  )
}
