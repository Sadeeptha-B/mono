/**
 * Mono, the companion.
 *
 * One continuous stroke that changes shape with the app's state. Two ideas:
 *
 *  - The line *is* the progress indicator. During a block it draws itself from
 *    tail to head as the time passes, so the character and the timer are the
 *    same object rather than two things competing for the corner of the screen.
 *  - It reacts, it never interrupts. Motion drops to almost nothing while
 *    focusing, and stops entirely under `prefers-reduced-motion`.
 */

import { motion, useReducedMotion } from 'motion/react'

import { MOODS, moodForPhase, type Mood } from './moods'
import type { Phase } from '@/domain/machine'

type Props = {
  phase: Phase
  /** 0 to 1 through the current block, or null when nothing is running. */
  progress: number | null
  className?: string
}

export function OneLine({ phase, progress, className }: Props) {
  const reduceMotion = useReducedMotion()
  const mood: Mood = moodForPhase(phase)
  const spec = MOODS[mood]

  const isDrawing = progress !== null
  const breathing = !reduceMotion && spec.breath > 0

  return (
    <div className={className}>
      <svg
        viewBox="0 0 124 80"
        fill="none"
        role="img"
        aria-label={`Mono is ${spec.label.toLowerCase()}`}
        className="h-full w-full overflow-visible"
      >
        {/* The full shape, faint: the part of the block still ahead of you. */}
        {isDrawing && (
          <motion.path
            d={spec.d}
            stroke={spec.stroke}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.18}
            animate={{ d: spec.d }}
            transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeInOut' }}
          />
        )}

        <motion.path
          d={spec.d}
          stroke={spec.stroke}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          // pathLength normalises the stroke to 0..1 regardless of geometry,
          // so progress maps straight onto the dash without measuring.
          pathLength={1}
          strokeDasharray={1}
          initial={false}
          animate={{
            d: spec.d,
            strokeDashoffset: isDrawing ? 1 - progress : 0,
            // A breath, not an animation: a percent or two of scale, slowly.
            scaleY: breathing ? [1, 1.02, 1] : 1,
          }}
          transition={{
            d: { duration: reduceMotion ? 0 : 0.8, ease: 'easeInOut' },
            strokeDashoffset: { duration: reduceMotion ? 0 : 0.6, ease: 'linear' },
            scaleY: breathing
              ? { duration: spec.breath, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0 },
          }}
          style={{ transformOrigin: '50% 70%' }}
        />

        {/* The eye. Present in every mood, so it reads as the same creature. */}
        <motion.circle
          r={2.4}
          fill={spec.stroke}
          initial={false}
          animate={{
            cx: mood === 'away' ? 112 : mood === 'complete' ? 110 : 108,
            cy: mood === 'away' ? 61 : mood === 'complete' ? 10 : mood === 'resting' ? 33 : 26,
            // Narrows during focus — a squint, not a blink.
            scaleY: mood === 'focusing' ? 0.55 : 1,
            opacity: mood === 'away' ? 0.5 : 1,
          }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeInOut' }}
        />
      </svg>
    </div>
  )
}
