/**
 * The companion's moods.
 *
 * Mono is one continuous stroke — that is the conceit — but a stroke on its
 * own reads as a gesture rather than a creature. So the line draws a body with
 * a head on the end of it, and the face is *derived from that head* rather
 * than placed beside it: a mood says where the neck ends and how far the head
 * is tilted, and the head's curve, the eye and the brow are all computed from
 * those two values. They cannot come apart. They used to: the eye was authored
 * in absolute coordinates per mood, and in `focusing` — the mood you look at
 * most — it floated a clear fourteen units above the head it belonged to.
 *
 * That split is also what makes the moods expressive. The body carries posture
 * and the face carries feeling, which is the right way round: a brow angle
 * says more in two degrees than a spine says in twenty.
 *
 * Every path is still `M` followed by four cubics, in that order, so Motion
 * can interpolate `d` directly between any two moods with no morph library. A
 * new mood has to match that structure — the body supplies three cubics and
 * the head is always the fourth.
 *
 * Everything is drawn in a 124x80 box: tail on the ground at the left, back
 * rising to the right, head at the end of it.
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

type Point = { x: number; y: number }

type MoodSpec = {
  /** `M` plus three cubics — tail, back, shoulder — ending exactly at `neck`. */
  body: string
  /** Where the body stops and the head begins. */
  neck: Point
  /** Head rotation about the neck, in degrees. Negative lifts the muzzle. */
  tilt: number
  /** CSS custom property name for the stroke colour. */
  stroke: string
  /** Seconds for one breath cycle. Zero means hold still. */
  breath: number
  /** The eye's vertical radius: 2.5 is wide open, 0.5 is all but shut. */
  eye: number
  /** Brow angle in degrees. Positive raises the outer end, negative lowers it. */
  brow: number
  /** How far the brow rides above the eye. */
  browLift: number
  /** Seconds between blinks. Zero never blinks. */
  blink: number
  label: string
}

/**
 * The head, in the neck's own frame: the muzzle points along +x, up is -y.
 *
 * One shape for every mood, moved and turned rather than redrawn. That is what
 * keeps the creature recognisably the same animal from state to state — and it
 * means the eye offset below is correct for all seven by construction.
 */
const HEAD = {
  /** Up the back of the skull. */
  crownBack: { x: -4, y: -32 },
  /** Over the crown and down the face. */
  crownFront: { x: 40, y: -28 },
  /** The jaw, where the stroke ends. */
  muzzle: { x: 25, y: -1 },
  /**
   * Low in the skull rather than centred. Two thirds of the head is above the
   * eye, which is the proportion that reads as young — and it leaves the room
   * the brow needs. Sitting it any higher put the brow on the crown, where it
   * merged with the stroke and vanished.
   */
  eye: { x: 16, y: -9 },
}

/** Half-width of the brow stroke, and how far it bows upward at its middle. */
const BROW_SPAN = 4.4
const BROW_BOW = 1.7

export const MOODS: Record<Mood, MoodSpec> = {
  // Sitting up, weight settled, tail loose. Waiting to be given a job.
  idle: {
    body: 'M 12 56 C 6 68, 20 72, 34 67 C 47 62, 54 56, 64 50 C 71 45, 78 42, 84 38',
    neck: { x: 84, y: 38 },
    tilt: 0,
    stroke: 'var(--color-muted)',
    breath: 5,
    eye: 2.4,
    brow: 0,
    browLift: 6.8,
    blink: 6,
    label: 'Waiting',
  },

  // Up on the front legs, leaning in, brow raised: the moment before the work
  // is named. This is the only mood that looks like it is about to speak.
  defining: {
    body: 'M 12 58 C 6 70, 20 73, 34 68 C 47 63, 55 57, 65 50 C 73 44, 80 38, 86 32',
    neck: { x: 86, y: 32 },
    tilt: -8,
    stroke: 'var(--color-bright)',
    breath: 3,
    eye: 2.8,
    brow: 14,
    browLift: 7.4,
    blink: 5,
    label: 'Listening',
  },

  // Low, long and level, brow down, eye narrowed to a slot. Almost no motion —
  // this is the state the whole app exists to protect.
  focusing: {
    body: 'M 12 60 C 7 70, 20 73, 34 70 C 47 67, 55 63, 65 59 C 72 56, 79 51, 84 46',
    neck: { x: 84, y: 46 },
    tilt: 4,
    stroke: 'var(--color-deep)',
    breath: 9,
    eye: 1.1,
    brow: -15,
    browLift: 5.4,
    blink: 13,
    label: 'Focusing',
  },

  // Curled in on itself with the muzzle lifted, turning something over.
  reflecting: {
    body: 'M 14 58 C 8 69, 21 72, 35 67 C 46 63, 52 57, 60 51 C 68 45, 76 41, 82 36',
    neck: { x: 82, y: 36 },
    tilt: -14,
    stroke: 'var(--color-reflect)',
    breath: 6,
    eye: 2.1,
    brow: 17,
    browLift: 7,
    blink: 7,
    label: 'Thinking',
  },

  // Sprawled along the ground, head tipped back, eyes heavy and slow.
  resting: {
    body: 'M 8 64 C 4 73, 18 76, 32 73 C 46 70, 55 68, 66 64 C 76 60, 81 58, 86 54',
    neck: { x: 86, y: 54 },
    tilt: -6,
    stroke: 'var(--color-rest)',
    breath: 4,
    eye: 1.4,
    brow: -3,
    browLift: 5.6,
    blink: 3.5,
    label: 'Resting',
  },

  // Chest up, chin high, brow arched. Held only for a moment.
  complete: {
    body: 'M 12 58 C 6 70, 20 72, 34 67 C 47 62, 56 54, 66 46 C 75 39, 82 35, 88 32',
    neck: { x: 88, y: 32 },
    tilt: -10,
    stroke: 'var(--color-rest)',
    breath: 2,
    eye: 2.7,
    brow: 19,
    browLift: 7.8,
    blink: 3,
    label: 'Done',
  },

  // Flat out with the head hanging. No blink: nobody was home.
  away: {
    body: 'M 8 66 C 4 74, 18 77, 32 74 C 46 71, 56 70, 67 69 C 77 68, 82 64, 86 60',
    neck: { x: 86, y: 60 },
    tilt: 12,
    stroke: 'var(--color-muted)',
    breath: 0,
    eye: 0.6,
    brow: -7,
    browLift: 4.8,
    blink: 0,
    label: 'Lost the thread',
  },
}

const rotate = (p: Point, degrees: number): Point => {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** A point in the head's frame, placed into the drawing. */
function place(spec: MoodSpec, local: Point): Point {
  const turned = rotate(local, spec.tilt)
  return { x: spec.neck.x + turned.x, y: spec.neck.y + turned.y }
}

const round = (n: number): string => (Math.round(n * 100) / 100).toString()
const pair = (p: Point): string => `${round(p.x)} ${round(p.y)}`

/**
 * The whole stroke: the mood's body, then the head turned onto the end of it.
 * Four cubics for every mood, so any two interpolate.
 */
export function pathFor(spec: MoodSpec): string {
  const back = place(spec, HEAD.crownBack)
  const front = place(spec, HEAD.crownFront)
  const muzzle = place(spec, HEAD.muzzle)
  return `${spec.body} C ${pair(back)}, ${pair(front)}, ${pair(muzzle)}`
}

/** Where the eye sits inside the head arch. */
export const eyeFor = (spec: MoodSpec): Point => place(spec, HEAD.eye)

/**
 * The brow: a short bowed stroke above the eye, turned by its own angle and
 * then carried along by the head's tilt. Always `M` plus one quadratic, so
 * brows interpolate between moods the same way bodies do.
 */
export function browFor(spec: MoodSpec): string {
  const centre = { x: HEAD.eye.x, y: HEAD.eye.y - spec.browLift }
  const arc = [
    { x: -BROW_SPAN, y: 0 },
    { x: 0, y: -BROW_BOW },
    { x: BROW_SPAN, y: 0 },
  ].map((p) => {
    const turned = rotate(p, spec.brow)
    return place(spec, { x: centre.x + turned.x, y: centre.y + turned.y })
  })

  const [start, control, end] = arc
  return `M ${pair(start!)} Q ${pair(control!)} ${pair(end!)}`
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
