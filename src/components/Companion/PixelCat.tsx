/**
 * Mono, the companion — a pixel cat on a strip of ground.
 *
 * It replaces the one-line character, and the reasoning behind the swap is
 * that the line could only ever be a *gesture*. Every expression had to be
 * derived from a neck point and a tilt angle, so making it cheerful meant
 * doing trigonometry, and the safest thing to do with it was keep it minimal.
 * That was the wrong instinct for this app: the whole problem Mono solves is
 * that the user leaves to find something more interesting. A companion worth
 * glancing at is a feature, not a distraction — provided it is only lively at
 * the seams of a block and dull in the middle of one, which is the rule the
 * mood loops and the pet reactions in `cat.ts` both keep.
 *
 * Four ideas, three of them carried over unchanged from the line:
 *
 *  - The companion *is* the progress indicator. It walks the ground from left
 *    to right across a block, so you can read roughly how far in you are from
 *    where the cat is standing, without reading a number.
 *  - It reacts, it never interrupts. Nothing moves at all under
 *    `prefers-reduced-motion`; the cat simply stands at its post.
 *  - One creature, two mounts. The header shows the same animal cropped to its
 *    head, rather than a second mark that has to be kept in step with this one.
 *  - It can be petted. The eyes follow the pointer across it and a click gets
 *    a hop and a heart — except during a block, where the same click gets one
 *    blink. Being boring while you work is the feature.
 */

import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import {
  MARK_CROP,
  markCropTop,
  MOODS,
  moodForPhase,
  paletteFor,
  type MoodName,
  type Step,
} from './cat'
import { compose, runs } from './sprite'
import { BODIES, FACES, MARKINGS, NOTE, SPARK, SPRITE_H, SPRITE_W, type Grid } from './frames'
import type { Phase } from '@/domain/machine'

type Props = {
  phase: Phase
  /** 0 to 1 through the current block, or null when nothing is running. */
  progress: number | null
  className?: string
  /**
   * Crop to the head. The full scene is 24 pixels of cat in a 36-pixel strip;
   * at the 28px the header gives it that is under two screen pixels per sprite
   * pixel, which is mush. The head alone gets three, which is legible.
   */
  variant?: 'full' | 'mark'
  /** Let it be petted, and let its eyes follow the pointer. */
  interactive?: boolean
  /**
   * How striped it is, from `markTierFor`. Zero for the mark in the header —
   * the crop is above the flank, so it would be paying for nothing.
   */
  tier?: 0 | 1 | 2
  /**
   * The purpose of the running block, if there is one. The cat sits with it as
   * a card, and it goes into the accessible label — which is where the words
   * themselves live, since a card six pixels wide cannot carry them.
   */
  note?: string | null
  /**
   * Hide it from assistive tech. Two cats are on screen at once and they are
   * always in the same mood, so announcing both just says everything twice.
   * The header one is the decorative copy.
   */
  decorative?: boolean
}

/** The strip the cat lives on, in sprite pixels. */
const SCENE_W = 36
const SCENE_H = 20
/** Top of the sprite, leaving two pixels of headroom for the hop. */
const SPRITE_TOP = 2
const GROUND_Y = SPRITE_TOP + SPRITE_H
const GROUND_H = 0.9
/** How far the cat can walk: the slack either side of it. */
const TRAVEL = SCENE_W - SPRITE_W

/**
 * How far off the cat's own centre the pointer has to be before the eyes
 * bother. Without a dead zone the gaze flickers between two frames whenever
 * the pointer sits near the middle, which reads as a twitch.
 */
const GAZE_DEADZONE = 0.05

export function PixelCat({
  phase,
  progress,
  className,
  variant = 'full',
  interactive = false,
  tier = 0,
  note = null,
  decorative = false,
}: Props) {
  const reduceMotion = useReducedMotion()
  const name: MoodName = moodForPhase(phase)
  const mood = MOODS[name]
  const animate = !reduceMotion

  const [gaze, setGaze] = useState(0)
  const [petting, setPetting] = useState<{ steps: readonly Step[]; nonce: number } | null>(
    null,
  )

  // A reaction belongs to the mood that was petted. If the block ends
  // underneath one, the hop it was half-way through is answering a question
  // nobody is asking any more.
  useEffect(() => {
    setPetting(null)
  }, [name])

  useEffect(() => {
    if (!petting) return
    const total = petting.steps.reduce((ms, step) => ms + step.ms, 0)
    const id = setTimeout(() => setPetting(null), total)
    return () => clearTimeout(id)
  }, [petting])

  const steps = petting?.steps ?? mood.steps
  const step = useStep(steps, petting ? `pet-${petting.nonce}` : name, animate)

  const palette = useMemo(() => paletteFor(mood.accent), [mood.accent])
  const look = mood.gazes && !reduceMotion ? gaze : 0

  // Body, then what the day has added to it, then what it is holding, then the
  // face last so nothing can end up drawn over the eyes.
  const frame = useMemo(() => {
    const layers = []
    const markings = MARKINGS[tier - 1]
    if (markings) layers.push({ grid: markings, x: mood.marks.x, y: mood.marks.y })
    if (note && mood.note) layers.push({ grid: NOTE, ...mood.note })
    layers.push({ grid: FACES[step.face], x: mood.face.x + look, y: mood.face.y })
    return compose(BODIES[mood.body], ...layers)
  }, [mood, step.face, look, tier, note])

  // The cat stands where it has got to in the block, and in the middle of the
  // strip when there is no block to be part-way through.
  const walked = progress === null ? TRAVEL / 2 : progress * TRAVEL
  const lift = reduceMotion ? 0 : (step.lift ?? 0)

  const pet = () => setPetting((was) => ({ steps: mood.pet, nonce: (was?.nonce ?? 0) + 1 }))

  // The card the cat is holding has no words on it, so this is where they go.
  const doing =
    note && mood.note ? `Mono is ${mood.label} on "${note}"` : `Mono is ${mood.label}`

  const track = (event: PointerEvent<HTMLElement>) => {
    if (!mood.gazes || reduceMotion) return
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const pointer = (event.clientX - box.left) / box.width
    const centre = (walked + SPRITE_W / 2) / SCENE_W
    const next =
      pointer < centre - GAZE_DEADZONE ? -1 : pointer > centre + GAZE_DEADZONE ? 1 : 0
    setGaze((was) => (was === next ? was : next))
  }

  const art = (
    <svg
      viewBox={
        variant === 'mark'
          ? `${MARK_CROP.x} ${markCropTop(mood)} ${MARK_CROP.w} ${MARK_CROP.h}`
          : `0 0 ${SCENE_W} ${SCENE_H}`
      }
      // Sprite pixels are meant to be squares with hard edges. Without this
      // the browser antialiases every rectangle and the cat goes soft.
      shapeRendering="crispEdges"
      className="h-full w-full"
      {...(decorative || interactive
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': doing })}
    >
      {variant === 'full' && (
        <Ground walked={walked} accent={mood.accent} lit={progress !== null} />
      )}

      <motion.g
        initial={false}
        animate={{
          x: variant === 'mark' ? 0 : walked,
          y: (variant === 'mark' ? 0 : SPRITE_TOP) - lift,
        }}
        transition={{
          // The walk is slow and even; the hop is not a walk.
          x: { duration: reduceMotion ? 0 : 0.9, ease: 'linear' },
          y: { duration: reduceMotion ? 0 : 0.12, ease: 'easeOut' },
        }}
      >
        <Pixels frame={frame} palette={palette} />
        {step.spark && (
          <g transform={`translate(${mood.spark.x},${mood.spark.y})`}>
            <Pixels frame={SPARK} palette={palette} />
          </g>
        )}
      </motion.g>
    </svg>
  )

  if (!interactive) return <div className={className}>{art}</div>

  // A real button, because petting the cat is a thing you can do and hanging
  // it off a div would put it out of reach of a keyboard. The label carries
  // the mood so the announcement is still "what is Mono doing", plus the one
  // thing you can do about it.
  return (
    <button
      type="button"
      onClick={pet}
      onPointerMove={track}
      onPointerLeave={() => setGaze(0)}
      aria-label={`Pet Mono. ${doing}`}
      className={`${className ?? ''} cursor-pointer rounded-lg`}
    >
      {art}
    </button>
  )
}

/**
 * The ground, and how much of it is behind you.
 *
 * The lit part runs to the cat's feet rather than to the edge of the block, so
 * the trail and the creature are the same fact stated twice — there is nothing
 * for them to disagree about.
 */
function Ground({ walked, accent, lit }: { walked: number; accent: string; lit: boolean }) {
  return (
    <>
      <rect x={0} y={GROUND_Y} width={SCENE_W} height={GROUND_H} fill="var(--color-line)" />
      {lit && (
        <motion.rect
          x={0}
          y={GROUND_Y}
          height={GROUND_H}
          fill={accent}
          initial={false}
          animate={{ width: walked + SPRITE_W / 2 }}
          transition={{ duration: 0.9, ease: 'linear' }}
        />
      )}
    </>
  )
}

/**
 * The frame, as horizontal spans.
 *
 * Memoised on the frame itself rather than on the props that produced it: the
 * whole app re-renders every second off the shared ticker, and the cat's
 * appearance changes a couple of times a minute.
 */
const Pixels = ({ frame, palette }: { frame: Grid; palette: Record<string, string> }) => {
  const spans = useMemo(() => runs(frame), [frame])
  return (
    <>
      {spans.map((span) => (
        <rect
          key={`${span.y}-${span.x}`}
          x={span.x}
          y={span.y}
          width={span.w}
          height={1}
          fill={palette[span.ch]}
        />
      ))}
    </>
  )
}

/**
 * Walk a list of steps, one at a time, looping.
 *
 * A timeout per step rather than one interval, so a 130ms blink and a 13s hold
 * can sit in the same list. `resetKey` restarts the walk: a mood change or a
 * fresh click on the cat has to begin at the first frame, and clicking twice
 * in a row hands over the same array both times, so the steps alone cannot
 * tell us anything happened. With motion off, or a list of one, no timer is
 * ever scheduled.
 */
function useStep<T extends { ms: number }>(
  steps: readonly T[],
  resetKey: string,
  animate: boolean,
): T {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setTick(0)
  }, [resetKey])

  const index = tick % steps.length

  useEffect(() => {
    if (!animate || steps.length < 2) return
    const id = setTimeout(() => setTick((n) => n + 1), steps[index]!.ms)
    return () => clearTimeout(id)
  }, [steps, index, animate])

  return steps[animate ? index : 0]!
}
