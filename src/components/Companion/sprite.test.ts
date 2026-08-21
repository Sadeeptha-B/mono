import { describe, expect, it } from 'vitest'

import {
  BODIES,
  FACES,
  MARKINGS,
  NOTE,
  SPARK,
  SPRITE_H,
  SPRITE_W,
  type Grid,
} from './frames'
import { MARK_CROP, markCropTop, markTierFor, MOODS } from './cat'
import { compose, runs } from './sprite'

const bodies = Object.entries(BODIES)
const faces = Object.entries(FACES)
const everything: [string, Grid][] = [
  ...bodies,
  ...faces,
  ['SPARK', SPARK],
  ['NOTE', NOTE],
  ...MARKINGS.map((grid, i): [string, Grid] => [`MARKINGS[${i}]`, grid]),
]

const PALETTE = new Set(['.', 'f', 's', 'a', 'e', 'h', 'n', 'p', 'w'])

/** Every cell of `grid` placed at `at` in `body`, as one string. */
const under = (body: Grid, at: { x: number; y: number }, grid: Grid): string =>
  grid.map((_, dy) => body[at.y + dy]?.slice(at.x, at.x + grid[0]!.length) ?? '').join('')

/**
 * The art is hand-authored text, so the failure mode is a row one character
 * short — a silent hole in the cat that renders as a notch nobody can explain.
 * These are cheap and they catch it at the source. They iterate the records
 * rather than a list, so a new pose is covered the moment it is drawn.
 */
describe('the authored art', () => {
  it.each(bodies)('body %s is exactly one sprite', (_name, body) => {
    expect(body).toHaveLength(SPRITE_H)
    for (const row of body) expect(row).toHaveLength(SPRITE_W)
  })

  it.each(everything)('%s is rectangular', (_name, grid) => {
    const width = grid[0]!.length
    for (const row of grid) expect(row).toHaveLength(width)
  })

  it.each(everything)('%s only uses palette characters', (_name, grid) => {
    for (const row of grid) for (const ch of row) expect(PALETTE).toContain(ch)
  })

  it.each(faces)('face %s is the same size as every other face', (_name, face) => {
    expect(face).toHaveLength(FACES.open.length)
    for (const row of face) expect(row).toHaveLength(FACES.open[0]!.length)
  })
})

/**
 * A mood that stamps its face off the edge of the head loses the eyes without
 * failing anything, so the geometry is checked rather than eyeballed.
 */
describe('every mood', () => {
  const moods = Object.entries(MOODS)

  it.each(moods)('%s lands its face inside the sprite', (_name, mood) => {
    expect(mood.face.x).toBeGreaterThanOrEqual(0)
    expect(mood.face.y).toBeGreaterThanOrEqual(0)
    expect(mood.face.x + FACES.open[0]!.length).toBeLessThanOrEqual(SPRITE_W)
    expect(mood.face.y + FACES.open.length).toBeLessThanOrEqual(SPRITE_H)
  })

  it.each(moods)('%s puts its face on fur, not on air', (_name, mood) => {
    // Eyes floating on the background read as two holes punched through the
    // head, and the pose still looks deliberate — so nothing else would catch
    // a face stamped one row past the chin.
    const body = BODIES[mood.body]
    const eyes = body[mood.face.y]!.slice(mood.face.x, mood.face.x + FACES.open[0]!.length)
    expect(eyes).toBe('f'.repeat(FACES.open[0]!.length))

    // The nose sits three rows down, in the middle of the face grid.
    const nose = body[mood.face.y + 3]!
    expect(nose.slice(mood.face.x + 4, mood.face.x + 6)).toBe('ff')
  })

  it.each(moods)('%s keeps its heart inside the sprite', (_name, mood) => {
    expect(mood.spark.x + SPARK[0]!.length).toBeLessThanOrEqual(SPRITE_W)
    expect(mood.spark.y + SPARK.length).toBeLessThanOrEqual(SPRITE_H)
  })

  /**
   * Anchors are hand-placed per pose, and the failure is quiet: markings that
   * hang off the flank read as dirt on the background, and a note floating
   * beside the cat reads as a bug rather than as something it is holding.
   */
  it.each(moods)('%s anchors its markings on solid flank', (_name, mood) => {
    const patch = under(BODIES[mood.body], mood.marks, MARKINGS[1]!)
    expect(patch).toBe('f'.repeat(MARKINGS[1]!.length * MARKINGS[1]![0]!.length))
  })

  it.each(moods)('%s anchors any note it holds on solid fur', (_name, mood) => {
    if (!mood.note) return
    const patch = under(BODIES[mood.body], mood.note, NOTE)
    expect(patch).toBe('f'.repeat(NOTE.length * NOTE[0]!.length))
  })

  it.each(moods)('%s holds a note only while a block could be running', (_name, mood) => {
    const running = mood.body === 'loaf' || mood.body === 'curl'
    expect(Boolean(mood.note)).toBe(running)
  })

  /**
   * The header shows the head alone, cropped out of whatever pose is current.
   * A fixed crop worked until poses arrived whose head is not at the top of
   * the sprite: the sprawl's eyes sit three rows lower than the sit's, and the
   * header rendered an empty box with a sliver of ear in it. The crop follows
   * the face anchor now, and this is what holds it there.
   */
  it.each(moods)('%s fits its whole face inside the header crop', (_name, mood) => {
    const top = markCropTop(mood)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top + MARK_CROP.h).toBeLessThanOrEqual(SPRITE_H)

    expect(top).toBeLessThanOrEqual(mood.face.y)
    expect(top + MARK_CROP.h).toBeGreaterThanOrEqual(mood.face.y + FACES.open.length)

    expect(MARK_CROP.x).toBeLessThanOrEqual(mood.face.x)
    expect(MARK_CROP.x + MARK_CROP.w).toBeGreaterThanOrEqual(
      mood.face.x + FACES.open[0]!.length,
    )
  })

  it.each(moods)('%s has something to do and something to say back', (_name, mood) => {
    expect(mood.steps.length).toBeGreaterThan(0)
    expect(mood.pet.length).toBeGreaterThan(0)
    for (const step of [...mood.steps, ...mood.pet]) expect(step.ms).toBeGreaterThan(0)
  })
})

describe('compose', () => {
  it('paints a layer over the base', () => {
    expect(compose(['....', '....'], { grid: ['ab'], x: 1, y: 1 })).toEqual(['....', '.ab.'])
  })

  it('leaves what is under a transparent pixel', () => {
    expect(compose(['ffff'], { grid: ['e.e'], x: 1, y: 0 })).toEqual(['fefe'])
  })

  it('never grows the base', () => {
    const out = compose(['..'], { grid: ['xxxx'], x: 1, y: 0 }, { grid: ['y'], x: 0, y: 9 })
    expect(out).toEqual(['.x'])
  })

  it('applies layers in order', () => {
    const out = compose(['..'], { grid: ['ab'], x: 0, y: 0 }, { grid: ['c'], x: 0, y: 0 })
    expect(out).toEqual(['cb'])
  })
})

describe('runs', () => {
  it('collapses a row into spans of one colour', () => {
    expect(runs(['.ffee.'])).toEqual([
      { x: 1, y: 0, w: 2, ch: 'f' },
      { x: 3, y: 0, w: 2, ch: 'e' },
    ])
  })

  it('describes every painted pixel exactly once', () => {
    for (const [, body] of bodies) {
      const painted = body.flatMap((row) => [...row]).filter((ch) => ch !== '.').length
      expect(runs(body).reduce((n, span) => n + span.w, 0)).toBe(painted)
    }
  })

  it('round-trips back to the grid it came from', () => {
    for (const [, body] of bodies) {
      const blank = Array.from({ length: SPRITE_H }, () => '.'.repeat(SPRITE_W))
      const rebuilt = compose(
        blank,
        ...runs(body).map((span) => ({
          grid: [span.ch.repeat(span.w)],
          x: span.x,
          y: span.y,
        })),
      )
      expect(rebuilt).toEqual([...body])
    }
  })
})

describe('markTierFor', () => {
  it('starts plain and only ever adds', () => {
    const tiers = [0, 1, 2, 3, 4, 5, 6, 7, 20].map(markTierFor)
    expect(tiers).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2])
    // Never goes backwards as the day banks more.
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i]!).toBeGreaterThanOrEqual(tiers[i - 1]!)
    }
  })

  it('never asks for a marking that does not exist', () => {
    for (const blocks of [0, 3, 6, 100]) {
      const tier = markTierFor(blocks)
      if (tier > 0) expect(MARKINGS[tier - 1]).toBeDefined()
    }
  })
})
