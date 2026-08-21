/**
 * Mono, the companion.
 *
 * One continuous stroke that changes shape with the app's state. Three ideas:
 *
 *  - The line *is* the progress indicator. During a block it draws itself from
 *    tail to muzzle as the time passes, so the character and the timer are the
 *    same object rather than two things competing for the corner of the screen.
 *  - The body carries posture, the face carries feeling. Both come out of the
 *    same two numbers per mood — see `moods.ts` — so the eye and brow are
 *    always on the head, at any tilt, in any state.
 *  - It reacts, it never interrupts. Motion drops to almost nothing while
 *    focusing, and stops entirely under `prefers-reduced-motion`.
 */

import { motion, useReducedMotion } from 'motion/react'

import { browFor, eyeFor, MOODS, moodForPhase, pathFor, type Mood } from './moods'
import type { Phase } from '@/domain/machine'

type Props = {
  phase: Phase
  /** 0 to 1 through the current block, or null when nothing is running. */
  progress: number | null
  className?: string
  /**
   * Hide it from assistive tech. Two Monos are on screen at once — the mark
   * beside the wordmark and the creature on the stage — and they are always in
   * the same mood, so announcing both just says everything twice. The mark is
   * the decorative one.
   */
  decorative?: boolean
}

/** How long the eye takes to shut and open again, as a share of one cycle. */
const BLINK_SHARE = 0.06

export function OneLine({ phase, progress, className, decorative = false }: Props) {
  const reduceMotion = useReducedMotion()
  const mood: Mood = moodForPhase(phase)
  const spec = MOODS[mood]

  const d = pathFor(spec)
  const brow = browFor(spec)
  const eye = eyeFor(spec)

  const isDrawing = progress !== null
  const breathing = !reduceMotion && spec.breath > 0
  // A blink is the cheapest sign of life there is, but it is still motion in
  // the corner of a focus app: rare while focusing, absent when we were away.
  const blinking = !reduceMotion && spec.blink > 0

  const settle = { duration: reduceMotion ? 0 : 0.8, ease: 'easeInOut' } as const

  return (
    <div className={className}>
      <svg
        viewBox="0 0 124 80"
        fill="none"
        className="h-full w-full overflow-visible"
        {...(decorative
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': `Mono is ${spec.label.toLowerCase()}` })}
      >
        {/*
          The whole creature breathes as one. Breathing the body alone would
          leave the face behind by a fraction of a unit each cycle, which is
          small enough to look like a rendering fault rather than a breath.
        */}
        <motion.g
          initial={false}
          animate={{ scaleY: breathing ? [1, 1.02, 1] : 1 }}
          transition={
            breathing
              ? { duration: spec.breath, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0 }
          }
          style={{ transformOrigin: '50% 70%' }}
        >
          {/* The full shape, faint: the part of the block still ahead of you. */}
          {isDrawing && (
            <motion.path
              d={d}
              stroke={spec.stroke}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.18}
              animate={{ d }}
              transition={settle}
            />
          )}

          <motion.path
            d={d}
            stroke={spec.stroke}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            // pathLength normalises the stroke to 0..1 regardless of geometry,
            // so progress maps straight onto the dash without measuring.
            pathLength={1}
            strokeDasharray={1}
            initial={false}
            animate={{ d, strokeDashoffset: isDrawing ? 1 - progress : 0 }}
            transition={{
              d: settle,
              strokeDashoffset: { duration: reduceMotion ? 0 : 0.6, ease: 'linear' },
            }}
          />

          {/*
            Brow and eye. Both are animated as plain SVG attributes rather than
            transforms: the geometry already knows where the head is, and a
            transform would only give it a second opinion.
          */}
          <motion.path
            d={brow}
            stroke={spec.stroke}
            strokeWidth={1.9}
            strokeLinecap="round"
            initial={false}
            animate={{ d: brow, opacity: mood === 'away' ? 0.55 : 1 }}
            transition={settle}
          />

          <motion.ellipse
            fill={spec.stroke}
            rx={2.5}
            initial={false}
            animate={{
              cx: eye.x,
              cy: eye.y,
              // The blink rides on the mood's own aperture, so a squint blinks
              // as a squint rather than snapping open to do it.
              ry: blinking ? [spec.eye, spec.eye, 0.3, spec.eye] : spec.eye,
              opacity: mood === 'away' ? 0.5 : 1,
            }}
            transition={{
              cx: settle,
              cy: settle,
              opacity: settle,
              ry: blinking
                ? {
                    duration: spec.blink,
                    times: [0, 1 - BLINK_SHARE, 1 - BLINK_SHARE / 2, 1],
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
                : settle,
            }}
          />
        </motion.g>
      </svg>
    </div>
  )
}
