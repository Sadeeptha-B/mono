/**
 * The session state machine.
 *
 * `transition` is pure: it takes the current phase, the current session state
 * and an action, and returns the next phase plus the events to append. It
 * never reads the clock (`at` rides on every action) and never generates an id
 * itself (`deps.newId` is injected), so every path here is directly testable.
 *
 * Phase is deliberately *not* in the event log. It is where the user is in the
 * conversation — which dialog is open — and it should not survive a reload in
 * a way that could resurrect a stale prompt. What survives is the log.
 */

import type { MonoEvent, SessionState } from './events'
import { minutesToMs, type BlockKind, type Ms } from './types'

export type Phase =
  | { name: 'idle' }
  /** The purpose prompt. `afterReflection` softens the copy on the second ask. */
  | { name: 'definingPurpose'; blockKind: BlockKind; afterReflection: boolean }
  | { name: 'reflecting' }
  | { name: 'focusing' }
  /** The timer reached zero and we are asking about a break. */
  | { name: 'blockComplete' }
  | { name: 'choosingBreak' }
  | { name: 'onBreak' }
  /**
   * The app was asleep or backgrounded across a block boundary. We refuse to
   * guess what happened, so the user resolves it.
   */
  | { name: 'reconciling'; lastSeenAt: Ms; blockEndedAt: Ms }

export const initialPhase: Phase = { name: 'idle' }

export type Action =
  | { type: 'startBlock'; at: Ms; blockKind: BlockKind }
  | { type: 'setPurpose'; at: Ms; purpose: string }
  | { type: 'cannotDecide'; at: Ms }
  | { type: 'timerElapsed'; at: Ms }
  | { type: 'abandonBlock'; at: Ms }
  | { type: 'takeBreak'; at: Ms }
  | { type: 'skipBreak'; at: Ms; nextBlockKind: BlockKind }
  | { type: 'confirmBreak'; at: Ms; durationMin: number }
  | { type: 'endBreak'; at: Ms }
  | { type: 'cancelBreakChoice'; at: Ms }
  | { type: 'awayDetected'; at: Ms; lastSeenAt: Ms }
  | { type: 'resolveAway'; at: Ms; outcome: 'completed' | 'abandoned' }

export type Deps = { newId: () => string }

export type TransitionResult = { phase: Phase; events: MonoEvent[] }

const stay = (phase: Phase): TransitionResult => ({ phase, events: [] })

export function transition(
  phase: Phase,
  session: SessionState,
  action: Action,
  deps: Deps,
): TransitionResult {
  // Waking up across a block boundary outranks whatever dialog was open. It is
  // the one thing we must never silently paper over.
  if (action.type === 'awayDetected') {
    if (!session.active) return stay(phase)
    return {
      phase: {
        name: 'reconciling',
        lastSeenAt: action.lastSeenAt,
        blockEndedAt: session.active.endsAt,
      },
      events: [],
    }
  }

  switch (phase.name) {
    case 'idle':
      if (action.type === 'startBlock') {
        return stay({
          name: 'definingPurpose',
          blockKind: action.blockKind,
          afterReflection: false,
        })
      }
      return stay(phase)

    case 'definingPurpose': {
      if (action.type === 'setPurpose') {
        // The block starts now, not when the prompt opened, so the timer is
        // honest about the time the user spent deciding.
        return {
          phase: { name: 'focusing' },
          events: [
            {
              type: 'block/started',
              at: action.at,
              id: deps.newId(),
              blockKind: phase.blockKind,
              endsAt: action.at + blockDuration(session, phase.blockKind),
              purpose: action.purpose.trim(),
            },
          ],
        }
      }

      if (action.type === 'cannotDecide') {
        // Not being able to name a purpose is itself a signal. Five minutes to
        // work out what the day is for, recorded like any other block.
        return {
          phase: { name: 'reflecting' },
          events: [
            {
              type: 'block/started',
              at: action.at,
              id: deps.newId(),
              blockKind: 'reflect',
              endsAt: action.at + blockDuration(session, 'reflect'),
              purpose: null,
            },
          ],
        }
      }

      if (action.type === 'abandonBlock') return stay({ name: 'idle' })
      return stay(phase)
    }

    case 'reflecting': {
      if (action.type === 'timerElapsed' || action.type === 'abandonBlock') {
        const completed = action.type === 'timerElapsed'
        return {
          // Straight back to the question, now with the priorities worked out.
          phase: {
            name: 'definingPurpose',
            blockKind: AFTER_REFLECTION_KIND,
            afterReflection: true,
          },
          events: [
            { type: completed ? 'block/completed' : 'block/abandoned', at: action.at },
          ],
        }
      }
      return stay(phase)
    }

    case 'focusing': {
      if (action.type === 'timerElapsed') {
        return { phase: { name: 'blockComplete' }, events: [] }
      }
      if (action.type === 'abandonBlock') {
        return {
          phase: { name: 'idle' },
          events: [{ type: 'block/abandoned', at: action.at }],
        }
      }
      return stay(phase)
    }

    case 'blockComplete': {
      if (action.type === 'takeBreak') {
        return {
          phase: { name: 'choosingBreak' },
          events: [{ type: 'block/completed', at: action.at }],
        }
      }
      if (action.type === 'skipBreak') {
        // Straight into the next block, which means straight to the purpose
        // prompt — no block ever runs without one.
        return {
          phase: {
            name: 'definingPurpose',
            blockKind: action.nextBlockKind,
            afterReflection: false,
          },
          events: [{ type: 'block/completed', at: action.at }],
        }
      }
      return stay(phase)
    }

    case 'choosingBreak': {
      if (action.type === 'confirmBreak') {
        return {
          phase: { name: 'onBreak' },
          events: [
            {
              type: 'break/started',
              at: action.at,
              id: deps.newId(),
              endsAt: action.at + minutesToMs(action.durationMin),
            },
          ],
        }
      }
      if (action.type === 'cancelBreakChoice') return stay({ name: 'idle' })
      return stay(phase)
    }

    case 'onBreak': {
      if (action.type === 'timerElapsed' || action.type === 'endBreak') {
        return {
          phase: { name: 'idle' },
          events: [{ type: 'break/ended', at: action.at }],
        }
      }
      return stay(phase)
    }

    case 'reconciling': {
      if (action.type === 'resolveAway') {
        const events: MonoEvent[] = []
        const active = session.active

        if (active?.kind === 'break') {
          events.push({ type: 'break/ended', at: active.endsAt })
        } else if (active) {
          events.push({
            type: action.outcome === 'completed' ? 'block/completed' : 'block/abandoned',
            // Credit the block at its planned end, not now — the user was not
            // still working during the hours the laptop was shut.
            at: active.endsAt,
          })
        }

        // The unaccounted stretch is recorded rather than quietly absorbed, so
        // the day's history adds up.
        if (active && action.at > active.endsAt) {
          events.push({ type: 'away/recorded', at: action.at, from: active.endsAt, to: action.at })
        }

        return { phase: { name: 'idle' }, events }
      }
      return stay(phase)
    }

    default: {
      const exhaustive: never = phase
      return stay(exhaustive)
    }
  }
}

function blockDuration(session: SessionState, kind: BlockKind): Ms {
  const { deepMinutes, shortMinutes, reflectMinutes } = session.settings
  const minutes =
    kind === 'deep' ? deepMinutes : kind === 'short' ? shortMinutes : reflectMinutes
  return minutesToMs(minutes)
}

/**
 * After reflection we default to a deep block: the user has just spent five
 * minutes working out what matters, which is exactly when depth pays.
 */
const AFTER_REFLECTION_KIND: BlockKind = 'deep'
