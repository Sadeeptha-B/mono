/**
 * The words around a running timer, shared by the stage, pop-out and guide.
 *
 * The button's accessible name describes the mode and the next action without
 * the digits. Its focused name must not change every second as the timer ticks.
 */

import { formatTimer, timerReading, type TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'

export function timerFace(active: ActiveSegment, now: Ms, mode: TimerMode) {
  const overrun = now > active.endsAt
  const modeLabel = mode === 'remaining'
    ? overrun ? 'Over' : 'Remaining'
    : active.kind === 'break'
      ? 'Break elapsed'
      : active.blockKind === 'reflect'
        ? 'Priorities elapsed'
        : 'Focused'
  const toggleLabel = mode === 'remaining' ? 'Show elapsed time' : 'Show time remaining'
  const statusLabel = mode === 'elapsed'
    ? 'Timer showing elapsed time'
    : overrun ? 'Timer over its end' : 'Timer showing time remaining'

  return {
    reading: timerReading(active, now, mode),
    modeLabel,
    toggleLabel,
    buttonLabel: `${statusLabel}. ${toggleLabel}`,
    overrun,
    overBy: overrun ? formatTimer(now - active.endsAt) : null,
  }
}
