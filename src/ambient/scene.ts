/**
 * The DOM-free geometry of Mono's rooms and chronological trail.
 *
 * React turns these shapes into themed SVG elements and the Node contact-sheet
 * generator paints the same data with literal palette values. Keeping the
 * coordinates here means visual QA cannot faithfully reproduce a geometry bug
 * merely because somebody copied the same mistake into a second renderer.
 */

import type { TrailEntry } from '@/domain/dayProgress'
import type { RoomId } from '@/domain/types'
import type { RoomPalette } from './rooms'

export const SCENE_W = 48
export const SCENE_H = 24
/** Vertical origin for the authored cat frame, immediately above the floor. */
export const SPRITE_TOP = 5
export const GROUND_Y = 21
export const GROUND_H = 0.9
const TRAIL_MARK_SCALE = 0.6

export type SceneTier = 0 | 1 | 2 | 3
export type SceneToken = keyof RoomPalette

type ShapePaint = {
  opacity?: number
  stroke?: SceneToken
  strokeWidth?: number
}

export type PixelShape =
  | (ShapePaint & {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      fill: SceneToken
    })
  | (ShapePaint & {
      kind: 'path'
      d: string
      fill?: SceneToken
    })

export type RoomShape = PixelShape & {
  tier: SceneTier
  animation?: { opacity: readonly number[]; duration: number }
}

/** The shell shared by all four room identities. */
export const ROOM_SHELL: readonly PixelShape[] = [
  {
    kind: 'rect', x: 0, y: 0, width: SCENE_W, height: GROUND_Y,
    fill: 'raised', opacity: 0.32,
  },
  {
    kind: 'rect', x: 2, y: 2, width: 16, height: 10,
    fill: 'ink', stroke: 'line', strokeWidth: 0.7,
  },
]

export const ROOM_SCENERY: Record<RoomId, readonly RoomShape[]> = {
  mono: [
    { kind: 'rect', tier: 1, x: 39, y: 11, width: 1, height: 9, fill: 'deep', opacity: 0.65 },
    { kind: 'path', tier: 1, d: 'M36 11h7l-1.5-3h-4z', fill: 'deep' },
    { kind: 'rect', tier: 2, x: 5, y: 4, width: 1, height: 1, fill: 'bright' },
    { kind: 'rect', tier: 2, x: 13, y: 6, width: 1, height: 1, fill: 'short' },
    {
      kind: 'path', tier: 3, d: 'M5 4 9 8 13 6',
      stroke: 'muted', strokeWidth: 0.45,
    },
  ],
  ember: [
    // A small hearth ledge stays left; the desk supporting the mug and books
    // occupies the widened side of the room.
    { kind: 'rect', tier: 0, x: 3, y: 14, width: 8, height: 1, fill: 'line' },
    { kind: 'rect', tier: 0, x: 30, y: 14, width: 15, height: 1, fill: 'line' },
    {
      kind: 'rect', tier: 1, x: 6, y: 10, width: 3, height: 4,
      fill: 'deep', opacity: 0.6,
      animation: { opacity: [0.4, 0.75, 0.4], duration: 3 },
    },
    { kind: 'rect', tier: 2, x: 40, y: 11, width: 4, height: 3, fill: 'bright', opacity: 0.65 },
    { kind: 'path', tier: 2, d: 'M41 10V8m2 2V7', stroke: 'muted', strokeWidth: 0.5 },
    { kind: 'rect', tier: 3, x: 31, y: 8, width: 2, height: 6, fill: 'short' },
    { kind: 'rect', tier: 3, x: 34, y: 10, width: 2, height: 4, fill: 'reflect' },
    { kind: 'rect', tier: 3, x: 37, y: 7, width: 2, height: 7, fill: 'rest' },
  ],
  tide: [
    {
      kind: 'path', tier: 1, d: 'M5 3v3m4-2v4m5-5v3',
      stroke: 'short', strokeWidth: 0.6, opacity: 0.6,
      animation: { opacity: [0.35, 0.8, 0.35], duration: 4 },
    },
    { kind: 'rect', tier: 2, x: 30, y: 14, width: 15, height: 1, fill: 'short', opacity: 0.45 },
    { kind: 'rect', tier: 3, x: 33, y: 9, width: 2, height: 2, fill: 'deep' },
    { kind: 'rect', tier: 3, x: 41, y: 7, width: 2, height: 3, fill: 'bright', opacity: 0.7 },
  ],
  moss: [
    { kind: 'rect', tier: 0, x: 30, y: 13, width: 15, height: 2, fill: 'line' },
    { kind: 'rect', tier: 1, x: 37, y: 10, width: 1, height: 4, fill: 'rest' },
    { kind: 'rect', tier: 1, x: 35, y: 13, width: 5, height: 3, fill: 'deep', opacity: 0.65 },
    { kind: 'rect', tier: 2, x: 35, y: 9, width: 3, height: 2, fill: 'rest' },
    { kind: 'rect', tier: 2, x: 38, y: 7, width: 3, height: 2, fill: 'rest' },
    { kind: 'rect', tier: 3, x: 37, y: 5, width: 3, height: 3, fill: 'reflect' },
  ],
}

export const MILESTONE_SHAPES: readonly PixelShape[] = [
  { kind: 'rect', x: 27, y: 2, width: 1, height: 1, fill: 'bright' },
  { kind: 'rect', x: 31, y: 4, width: 1, height: 1, fill: 'deep' },
  { kind: 'rect', x: 35, y: 2, width: 1, height: 1, fill: 'short' },
]

/**
 * Lay out the domain-capped trail once for the product renderer and visual QA.
 *
 * The vocabulary, which is otherwise only legible in the contact sheet:
 *
 *   deep       a large warm stone
 *   short      a small cool pebble
 *   reflect    a lantern on a post
 *   break      a low tuft, drawn in the rest colour
 *   gap        an unlit dash — an abandoned block or a span spent away
 *   aggregate  one muted mark standing for everything before the last 31
 *
 * Entries arrive capped at 32 from `dayProgressFor`, which is why the pitch
 * below can be a fixed maximum rather than a scale fitted to the input.
 */
export function trailShapes(entries: readonly TrailEntry[]): PixelShape[] {
  if (entries.length === 0) return []
  // New marks extend one chronological trail from the left. Distributing a
  // sparse day across the entire room made two blocks look like unrelated
  // decorations; 1.5px is also the natural pitch at the 32-entry cap, so the
  // trail grows without changing density under earlier entries.
  const step = Math.min(1.5, SCENE_W / entries.length)

  return entries.flatMap((entry, index): PixelShape[] => {
    const x = index * step + step / 2
    switch (entry.kind) {
      case 'deep':
        return [{ kind: 'rect', x: x - TRAIL_MARK_SCALE, y: GROUND_Y + 0.7, width: 2 * TRAIL_MARK_SCALE, height: 1.1, fill: 'deep' }]
      case 'short':
        return [{ kind: 'rect', x: x - 0.5 * TRAIL_MARK_SCALE, y: GROUND_Y + 1, width: TRAIL_MARK_SCALE, height: 0.8, fill: 'short' }]
      case 'reflect':
        return [
          { kind: 'rect', x: x - 0.4 * TRAIL_MARK_SCALE, y: GROUND_Y + 0.2, width: 0.8 * TRAIL_MARK_SCALE, height: 1.6, fill: 'reflect' },
          { kind: 'rect', x: x - 0.8 * TRAIL_MARK_SCALE, y: GROUND_Y, width: 1.6 * TRAIL_MARK_SCALE, height: 0.5, fill: 'reflect' },
        ]
      case 'break':
        return [{
          kind: 'path', d: `M${x - TRAIL_MARK_SCALE} ${GROUND_Y + 1.8}l${TRAIL_MARK_SCALE}-1.2 ${TRAIL_MARK_SCALE} 1.2`,
          stroke: 'rest', strokeWidth: 0.5,
        }]
      case 'gap':
        return [{ kind: 'rect', x: x - 0.7 * TRAIL_MARK_SCALE, y: GROUND_Y + 1.4, width: 1.4 * TRAIL_MARK_SCALE, height: 0.3, fill: 'line' }]
      case 'aggregate':
        return [{ kind: 'rect', x: x - TRAIL_MARK_SCALE, y: GROUND_Y + 0.8, width: 2 * TRAIL_MARK_SCALE, height: 0.8, fill: 'muted' }]
    }
  })
}
