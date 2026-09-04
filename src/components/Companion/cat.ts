/**
 * What the cat is doing, and when.
 *
 * A mood is a posture plus a loop of steps, each one a face held for a number
 * of milliseconds with an optional lift off the ground. That is enough to
 * express everything the creature does: a blink is two steps, a hop is four,
 * and standing perfectly still is one.
 *
 * Every mood also carries a `pet` — the one-shot it plays when you click it.
 * The rule that shapes both lists is that the companion is allowed to be
 * lively at the *seams* of a block, and is deliberately dull in the middle of
 * one. So `focusing` holds a single frame for thirteen seconds. An explicit
 * tap gets a short smile while the room previews its growth, but never a hop,
 * heart, prompt or lasting reward. Whatever the character grows into later,
 * that is the rule it has to keep: this app exists to protect the middle of
 * the block, and a companion that begs for attention during one is the problem
 * wearing a costume.
 */

import { SPRITE_H, type BodyName, type FaceName } from './frames'
import type { Phase } from '@/domain/machine'
import type { ActiveSegment, Ms } from '@/domain/types'

export type MoodName =
  | 'idle'
  | 'defining'
  | 'focusing'
  | 'reflecting'
  | 'complete'
  | 'resting'
  | 'away'

/** One held frame: a face, how far off the ground, and for how long. */
export type Step = {
  face: FaceName
  /** Pixels off the ground. Ignored under `prefers-reduced-motion`. */
  lift?: number
  /** Show the heart above the cat's head for this step. */
  spark?: boolean
  ms: number
}

type MoodSpec = {
  body: BodyName
  /** Where the face grid is stamped onto this body. */
  face: { x: number; y: number }
  /** Where the heart goes: the empty air above this particular cat. */
  spark: { x: number; y: number }
  /** Where earned markings go: a patch of solid flank on this particular cat. */
  marks: { x: number; y: number }
  /**
   * Where the note goes, for the poses that can be holding one. Absent means
   * this pose never holds the purpose — nothing is running, or nobody is home.
   */
  note?: { x: number; y: number }
  /** Looped forever. A single step means the cat holds still. */
  steps: readonly Step[]
  /** Played once when the cat is clicked, then back to `steps`. */
  pet: readonly Step[]
  /** Whether the eyes follow the pointer. Off for the two absent moods. */
  gazes: boolean
  /** CSS custom property for the mood's colour: ears, nose, tail, ground. */
  accent: string
  /** Read out to assistive tech as "Mono is …". */
  label: string
}

/** Two hops, a heart, and a settle. The reply to being petted. */
const DELIGHTED: readonly Step[] = [
  { face: 'happy', lift: 2, spark: true, ms: 170 },
  { face: 'happy', lift: 0, spark: true, ms: 190 },
  { face: 'happy', lift: 1, spark: true, ms: 150 },
  { face: 'happy', lift: 0, spark: true, ms: 460 },
]

/**
 * One slow blink, no heart, no hop.
 *
 * What the cat does when you pet it during a block, and when you pet it while
 * it has no idea where you went. Both cases want an acknowledgement rather
 * than a reward — enough that the click was not ignored, not enough to be
 * worth doing twice.
 */
const BARELY: readonly Step[] = [{ face: 'shut', ms: 280 }]

/** A quiet acknowledgement for the explicitly requested focus-room preview. */
const FOCUS_PREVIEW: readonly Step[] = [
  { face: 'happy', ms: 420 },
  { face: 'squint', ms: 220 },
]

const SIT_SPARK = { x: 19, y: 0 }

export const MOODS: Record<MoodName, MoodSpec> = {
  // Sitting up, watching. Blinks at uneven intervals, because an even one
  // reads as a pulse rather than a creature.
  idle: {
    body: 'sit',
    face: { x: 5, y: 5 },
    spark: SIT_SPARK,
    marks: { x: 4, y: 10 },
    steps: [
      { face: 'open', ms: 3800 },
      { face: 'blink', ms: 130 },
      { face: 'open', ms: 2100 },
      { face: 'blink', ms: 120 },
      { face: 'open', ms: 5200 },
      { face: 'blink', ms: 140 },
    ],
    pet: DELIGHTED,
    gazes: true,
    accent: 'var(--color-muted)',
    label: 'waiting',
  },

  // Leaning in with its eyes wide, waiting to hear what the block is for. The
  // quickest blink in the set: this is the one mood that is impatient.
  defining: {
    body: 'lean',
    face: { x: 5, y: 6 },
    spark: SIT_SPARK,
    marks: { x: 4, y: 8 },
    steps: [
      { face: 'wide', ms: 2600 },
      { face: 'blink', ms: 110 },
      { face: 'wide', ms: 1700 },
      { face: 'blink', ms: 100 },
    ],
    pet: DELIGHTED,
    gazes: true,
    // Not `--color-bright`: white ears on cream fur are invisible, and a white
    // nose reads as a hole in the face.
    accent: 'var(--color-short)',
    label: 'listening',
  },

  // Loafed, eyes down to a slot, one slow blink every thirteen seconds and
  // nothing else. The block is the user's; the cat stays out of it.
  focusing: {
    body: 'loaf',
    face: { x: 5, y: 5 },
    spark: SIT_SPARK,
    marks: { x: 4, y: 10 },
    note: { x: 9, y: 11 },
    steps: [
      { face: 'squint', ms: 13_000 },
      { face: 'shut', ms: 150 },
    ],
    pet: FOCUS_PREVIEW,
    gazes: false,
    accent: 'var(--color-deep)',
    label: 'focusing',
  },

  // One ear folded, eyes off to the side. Looking at anything except you is
  // the point — you are the one who could not name a purpose, and the cat is
  // working on it too.
  reflecting: {
    body: 'curl',
    face: { x: 5, y: 5 },
    spark: SIT_SPARK,
    marks: { x: 4, y: 10 },
    note: { x: 9, y: 11 },
    steps: [
      { face: 'aside', ms: 3400 },
      { face: 'blink', ms: 120 },
      { face: 'aside', ms: 2800 },
      { face: 'open', ms: 700 },
      { face: 'aside', ms: 4100 },
    ],
    pet: DELIGHTED,
    gazes: true,
    accent: 'var(--color-reflect)',
    label: 'thinking',
  },

  // Two hops and a settle. The only mood that leaves the ground on its own,
  // and it is only held between a block ending and the next question.
  complete: {
    body: 'perk',
    face: { x: 5, y: 5 },
    spark: SIT_SPARK,
    marks: { x: 5, y: 10 },
    steps: [
      { face: 'happy', lift: 0, ms: 220 },
      { face: 'happy', lift: 2, ms: 260 },
      { face: 'happy', lift: 0, ms: 240 },
      { face: 'happy', lift: 1, ms: 200 },
      { face: 'happy', lift: 0, ms: 1600 },
    ],
    pet: DELIGHTED,
    gazes: true,
    accent: 'var(--color-rest)',
    label: 'pleased',
  },

  // Flat out, lids heavy, opening one eye now and then to check you are still
  // there. Long holds throughout — a break the cat looks busy through is not
  // much of an advertisement for taking one.
  resting: {
    body: 'sprawl',
    face: { x: 5, y: 8 },
    spark: { x: 19, y: 2 },
    marks: { x: 3, y: 12 },
    steps: [
      { face: 'blink', ms: 4200 },
      { face: 'open', ms: 1500 },
      { face: 'blink', ms: 5600 },
      { face: 'squint', ms: 2300 },
    ],
    pet: DELIGHTED,
    gazes: true,
    accent: 'var(--color-rest)',
    label: 'resting',
  },

  // Asleep, and staying asleep: one frame, no blink, ears folded flat enough
  // that the colour goes out of them. Mono does not know what happened while
  // it was away and the cat is not pretending otherwise.
  away: {
    body: 'ball',
    face: { x: 5, y: 8 },
    spark: { x: 19, y: 4 },
    marks: { x: 4, y: 9 },
    steps: [{ face: 'squint', ms: 60_000 }],
    pet: BARELY,
    gazes: false,
    accent: 'var(--color-muted)',
    label: 'asleep',
  },
}

/** Every phase, and the pose it wears. */
export function moodForPhase(phase: Phase): MoodName {
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
    // Choosing how long a break should be is already the break, as far as the
    // cat is concerned. It lies down while you decide.
    case 'choosingBreak':
    case 'onBreak':
      return 'resting'
    case 'reconciling':
      return 'away'
  }
}

/**
 * How far through a block we are, as the cat walks it.
 *
 * Only a block. A break has its own timer wherever it is being shown, and a cat
 * that is supposed to be resting should not be pacing.
 *
 * Here rather than in the component that draws it, because there are two of
 * those now — the stage's companion and the mini window's — and two copies of a
 * progress formula is exactly the thing that drifts apart. `Math.max(1, …)`
 * covers a zero-length segment rather than dividing by nothing.
 */
export function walkProgress(active: ActiveSegment | null, now: Ms): number | null {
  if (active?.kind !== 'block') return null
  const through = (now - active.startedAt) / Math.max(1, active.endsAt - active.startedAt)
  return Math.min(1, Math.max(0, through))
}

/**
 * The head, in sprite coordinates: what the header shows instead of the whole
 * animal, since at 28px the full scene is under two screen pixels per sprite
 * pixel and comes out as mush.
 *
 * Horizontally fixed — every body is widest at the head and occupies the same
 * columns. Vertically it follows the pose's own face anchor, because the head
 * is not always at the top of the sprite: a sprawled cat's eyes are three rows
 * lower than a sitting one's, and a fixed crop gave the header an empty box
 * with a sliver of ear in it during a break and after being away. Deriving it
 * from the face means a new pose cannot forget to place an eighth anchor.
 */
export const MARK_CROP = { x: 2, w: 16, h: 10 }

/** Rows of skull and ear above the eyes. The same in every pose. */
const HEAD_ABOVE_EYES = 6

export const markCropTop = (mood: { face: { y: number } }): number =>
  Math.max(0, Math.min(mood.face.y - HEAD_ABOVE_EYES, SPRITE_H - MARK_CROP.h))

/**
 * How striped the cat is, given what the day has banked.
 *
 * Thresholds rather than a smooth ramp, because a marking that creeps in a
 * pixel at a time is not something anyone notices earning. Three blocks is a
 * morning that went well and six is most of a day, so both are worth a change
 * you can see. Nothing here ever takes a marking away — the reset is midnight,
 * not a mistake, and a cat that visibly downgrades when you abandon a block
 * would be a punishment dressed as a pet.
 */
export function markTierFor(blocksToday: number): 0 | 1 | 2 {
  if (blocksToday >= 6) return 2
  if (blocksToday >= 3) return 1
  return 0
}

/**
 * Fur is the same in every mood; only the accent moves.
 *
 * Tinting the whole animal by phase was the obvious thing and it looked like
 * seven different cats. Keeping the fur fixed and letting the ears, nose, tail
 * and ground carry the colour says the same thing about state while leaving
 * one recognisable creature on the screen.
 */
const FUR = '#e6e1d6'
const FUR_SHADE = '#a99f8c'
const EYE = '#14141c'
const GLINT = '#ffffff'

export const paletteFor = (accent: string): Record<string, string> => ({
  f: FUR,
  s: FUR_SHADE,
  e: EYE,
  h: GLINT,
  a: accent,
  n: accent,
  // The two colours that do not follow the mood. A heart is a heart whatever
  // the cat is doing, and `--color-commit` is the only red the app owns; paper
  // is paper.
  p: 'var(--color-commit)',
  w: '#faf7ef',
})
