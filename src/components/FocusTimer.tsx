/**
 * The current-state timer.
 *
 * Remaining time is always `endsAt - now`, never an accumulated counter, so a
 * missed or throttled tick makes this briefly stale but never wrong.
 */

import { formatTimer } from '@/domain/time'
import type { ActiveSegment } from '@/domain/types'
import type { Phase } from '@/domain/machine'

type Props = {
  now: number
  active: ActiveSegment | null
  phase: Phase
}

const KIND_LABEL: Record<string, string> = {
  deep: 'Deep block',
  short: 'Short block',
  reflect: 'Working out priorities',
}

export function FocusTimer({ now, active, phase }: Props) {
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

  const remaining = active.endsAt - now
  const overrun = remaining < 0
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
        {overrun && (
          <span className="text-xs text-commit">over by {formatTimer(-remaining)}</span>
        )}
      </div>

      <div
        className={`tnum mt-1 text-5xl font-light sm:text-6xl ${overrun ? 'text-commit' : 'text-bright'}`}
        // No live region. Even a polite one queues an announcement per change,
        // and this changes every second — a screen reader would read out all
        // 45 minutes of a block. The phase panels announce the moments that
        // matter; the digits are here to be read, not narrated.
      >
        {formatTimer(Math.abs(remaining))}
      </div>

      {active.kind === 'block' && active.purpose && (
        <p className="mt-3 max-w-sm text-lg leading-snug text-body">{active.purpose}</p>
      )}
    </div>
  )
}
