/**
 * The companion's moods.
 *
 * Every mood is one continuous stroke — Mono is a single line, which is the
 * whole conceit — and crucially every path uses the *same command structure*
 * (M, C, C, C, C). That lets the renderer interpolate between them directly,
 * with no morph library and no asset pipeline.
 *
 * The line is drawn in a 120x80 box. Think of it as a creature seen side-on:
 * a tail at the left, a body, and a head at the right that leans, slumps or
 * compresses depending on what the app is doing.
 */

import type { Phase } from '@/domain/machine'

export type Mood =
  | 'idle'
  | 'defining'
  | 'focusing'
  | 'reflecting'
  | 'resting'
  | 'complete'
  | 'away'

type MoodSpec = {
  d: string
  /** CSS custom property name for the stroke colour. */
  stroke: string
  /** Seconds for one breath cycle. Zero means hold still. */
  breath: number
  label: string
}

export const MOODS: Record<Mood, MoodSpec> = {
  // At rest: a loose, open curve. Looking around, waiting to be given a job.
  idle: {
    d: 'M 8 58 C 26 60, 34 46, 48 44 C 62 42, 70 48, 82 44 C 94 40, 98 28, 102 22 C 106 16, 110 18, 112 24',
    stroke: 'var(--color-muted)',
    breath: 5,
    label: 'Waiting',
  },

  // Leaning in, head raised: the moment before the work is named.
  defining: {
    d: 'M 8 60 C 26 62, 34 48, 48 44 C 62 40, 72 44, 84 38 C 96 32, 100 20, 104 14 C 108 8, 113 11, 115 17',
    stroke: 'var(--color-bright)',
    breath: 3,
    label: 'Listening',
  },

  // Compressed and level. Almost no motion — this is the point of the app.
  focusing: {
    d: 'M 8 54 C 26 55, 36 50, 50 49 C 64 48, 72 50, 84 48 C 96 46, 100 42, 104 40 C 108 38, 112 39, 114 42',
    stroke: 'var(--color-deep)',
    breath: 9,
    label: 'Focusing',
  },

  // A slow inward curl, turning something over.
  reflecting: {
    d: 'M 8 56 C 26 58, 32 44, 46 40 C 60 36, 74 42, 84 36 C 94 30, 92 20, 100 18 C 108 16, 112 22, 110 28',
    stroke: 'var(--color-reflect)',
    breath: 6,
    label: 'Thinking',
  },

  // Loose and sprawling, head tipped back.
  resting: {
    d: 'M 8 64 C 26 66, 36 62, 50 60 C 64 58, 74 62, 86 56 C 98 50, 104 40, 108 32 C 112 24, 116 26, 117 33',
    stroke: 'var(--color-rest)',
    breath: 4,
    label: 'Resting',
  },

  // A brief upward flourish. Held only for a moment.
  complete: {
    d: 'M 8 58 C 26 60, 34 44, 48 40 C 62 36, 70 40, 82 32 C 94 24, 98 12, 102 8 C 106 4, 112 7, 114 14',
    stroke: 'var(--color-rest)',
    breath: 2,
    label: 'Done',
  },

  // Slumped: we lost track of what happened.
  away: {
    d: 'M 8 66 C 26 68, 36 66, 50 65 C 64 64, 74 66, 86 65 C 98 64, 102 62, 106 60 C 110 58, 114 60, 115 64',
    stroke: 'var(--color-muted)',
    breath: 0,
    label: 'Lost the thread',
  },
}

export function moodForPhase(phase: Phase): Mood {
  switch (phase.name) {
    case 'idle':
      return 'idle'
    case 'definingPurpose':
      return 'defining'
    case 'focusing':
      return 'focusing'
    case 'reflecting':
      return 'reflecting'
    case 'blockComplete':
      return 'complete'
    case 'choosingBreak':
    case 'onBreak':
      return 'resting'
    case 'reconciling':
      return 'away'
  }
}
