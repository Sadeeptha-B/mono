/**
 * Visual QA sheet for Mono's complete companion environment.
 *
 *   npm run companion   ->  companion-preview.png + companion-preview.svg
 *
 * The companion is no longer only a collection of cat frames. This sheet
 * covers the full 48x24 scene: every room at every earned tier, the important
 * phase poses, focus-tap previews, trail semantics, milestone sparkle and the
 * header crops. That makes it possible to review palette contrast, occlusion
 * and pixel alignment without manufacturing a day in the browser.
 *
 * It remains a plain Node script. Importing the frame text and room metadata is
 * safe, but importing the React renderer would pull in Vite aliases, Motion and
 * a browser DOM. Room and trail coordinates therefore live in a shared pure
 * module which this script paints with literal palette values. `sprite.test.ts`
 * remains the exact test for cat anchors.
 *
 * The sheet is a review artifact, not a fixture: both files are gitignored, and
 * a successful run proves only that the shapes could be drawn. Contrast,
 * occlusion and whether a tier looks like progress are the reasons to open it.
 *
 * Importing a union does not populate it. Adding a trail semantic or a scene
 * tier makes this script compile against the new vocabulary while quietly
 * continuing to draw the old set of cells, so add the cell by hand — an
 * unreviewed shape is exactly what this command exists to prevent.
 */

import { writeFileSync } from 'node:fs'
import sharp from 'sharp'

import {
  BODIES,
  FACES,
  MARKINGS,
  NOTE,
  SPARK,
  SPRITE_H,
  SPRITE_W,
  type FaceName,
} from '../src/components/Companion/frames.ts'
import { ROOM_IDS, ROOMS, type RoomPalette } from '../src/ambient/rooms.ts'
import {
  GROUND_H,
  GROUND_Y,
  MILESTONE_SHAPES,
  ROOM_SCENERY,
  ROOM_SHELL,
  SCENE_H,
  SCENE_W,
  SPRITE_TOP,
  trailShapes,
  type PixelShape,
  type SceneTier,
} from '../src/ambient/scene.ts'
import type { TrailKind } from '../src/domain/dayProgress.ts'

type Grid = readonly string[]
type RoomId = (typeof ROOM_IDS)[number]
type MarkTier = 0 | 1 | 2

const stamp = (base: Grid, layer: Grid, x: number, y: number): string[] => {
  const rows = base.map((row) => [...row])
  layer.forEach((row, dy) => {
    const target = rows[y + dy]
    if (!target) return
    for (let dx = 0; dx < row.length; dx += 1) {
      const ch = row[dx]!
      if (ch !== '.' && x + dx < target.length) target[x + dx] = ch
    }
  })
  return rows.map((row) => row.join(''))
}

const paint = (accent: string): Record<string, string> => ({
  f: '#e6e1d6',
  s: '#a99f8c',
  e: '#14141c',
  h: '#ffffff',
  a: accent,
  n: accent,
  p: '#d96a6a',
  w: '#faf7ef',
})

const TRAVEL = SCENE_W - SPRITE_W

type MoodName =
  | 'idle'
  | 'defining'
  | 'focusing'
  | 'reflecting'
  | 'complete'
  | 'resting'
  | 'away'

type Anchor = { x: number; y: number }
type Mood = {
  body: keyof typeof BODIES
  face: Anchor
  spark: Anchor
  marks: Anchor
  note?: Anchor
  accent: keyof RoomPalette
}

/**
 * The static anchors from `cat.ts`, with semantic accents resolved per room.
 * Timings are intentionally absent: a contact sheet captures key frames, not
 * animation cadence.
 */
const MOODS: Record<MoodName, Mood> = {
  idle: {
    body: 'sit', face: { x: 5, y: 5 }, spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 }, accent: 'muted',
  },
  defining: {
    body: 'lean', face: { x: 5, y: 6 }, spark: { x: 19, y: 0 },
    marks: { x: 4, y: 8 }, accent: 'short',
  },
  focusing: {
    body: 'loaf', face: { x: 5, y: 5 }, spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 }, note: { x: 9, y: 11 }, accent: 'deep',
  },
  reflecting: {
    body: 'curl', face: { x: 5, y: 5 }, spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 }, note: { x: 9, y: 11 }, accent: 'reflect',
  },
  complete: {
    body: 'perk', face: { x: 5, y: 5 }, spark: { x: 19, y: 0 },
    marks: { x: 5, y: 10 }, accent: 'rest',
  },
  resting: {
    body: 'sprawl', face: { x: 5, y: 8 }, spark: { x: 19, y: 2 },
    marks: { x: 3, y: 12 }, accent: 'rest',
  },
  away: {
    body: 'ball', face: { x: 5, y: 8 }, spark: { x: 19, y: 4 },
    marks: { x: 4, y: 9 }, accent: 'muted',
  },
}

type Shot = {
  label: string
  mood: MoodName
  face: FaceName
  room?: RoomId
  sceneTier?: SceneTier
  markTier?: MarkTier
  /** null parks the cat mid-room, as it is when no block is running. */
  progress: number | null
  lift?: number
  spark?: boolean
  milestone?: boolean
  note?: boolean
  trail?: readonly TrailKind[]
}

const ROOM_SHEET: Shot[] = ([0, 1, 2, 3] as const).flatMap((sceneTier) =>
  ROOM_IDS.map((room) => ({
    label: `${ROOMS[room].label} - tier ${sceneTier}`,
    mood: 'idle' as const,
    face: 'open' as const,
    room,
    sceneTier,
    markTier: sceneTier === 3 ? 2 : sceneTier === 2 ? 1 : 0,
    progress: null,
  })),
)

const STATE_SHEET: Shot[] = [
  { label: 'idle', mood: 'idle', face: 'open', progress: null },
  {
    label: 'idle - petted', mood: 'idle', face: 'happy', progress: null,
    lift: 2, spark: true,
  },
  { label: 'defining purpose', mood: 'defining', face: 'wide', progress: null },
  {
    label: 'reflecting - holding note', mood: 'reflecting', face: 'aside',
    progress: 0.4, note: true,
  },
  {
    label: 'focusing - 8%', mood: 'focusing', face: 'squint',
    progress: 0.08, note: true,
  },
  {
    label: 'focusing - 78%', mood: 'focusing', face: 'squint',
    progress: 0.78, note: true,
  },
  {
    label: 'complete - milestone', mood: 'complete', face: 'happy',
    sceneTier: 3, markTier: 2, progress: null, lift: 2, milestone: true,
  },
  {
    label: 'resting - evolved', mood: 'resting', face: 'blink',
    sceneTier: 3, markTier: 2, progress: null,
  },
  {
    label: 'away - honest gap', mood: 'away', face: 'squint',
    sceneTier: 3, markTier: 2, progress: null, trail: ['deep', 'break', 'gap'],
  },
  { label: 'away - tapped', mood: 'away', face: 'shut', progress: null },
  {
    label: 'Tide focus - note', mood: 'focusing', face: 'squint', room: 'tide',
    sceneTier: 2, markTier: 1, progress: 0.5, note: true,
  },
  {
    label: 'Moss rest - complete', mood: 'resting', face: 'blink', room: 'moss',
    sceneTier: 3, markTier: 2, progress: null,
  },
]

/** The three consecutive focus taps, exactly as `PixelCat` previews them. */
const INTERACTION_SHEET: Shot[] = [
  {
    label: 'focus tap 1 - room tier 1', mood: 'focusing', face: 'happy',
    room: 'ember', sceneTier: 1, markTier: 0, progress: 0.5, note: true,
  },
  {
    label: 'focus tap 2 - room + mark', mood: 'focusing', face: 'happy',
    room: 'ember', sceneTier: 2, markTier: 1, progress: 0.5, note: true,
  },
  {
    label: 'focus tap 3 - full preview', mood: 'focusing', face: 'happy',
    room: 'ember', sceneTier: 3, markTier: 2, progress: 0.5, note: true,
  },
  {
    label: 'earned state - full trail', mood: 'idle', face: 'open', room: 'ember',
    sceneTier: 3, markTier: 2, progress: null,
    trail: ['deep', 'short', 'reflect', 'break', 'gap', 'deep'],
  },
  {
    label: 'trail - deep + short', mood: 'idle', face: 'open',
    sceneTier: 1, progress: null, trail: ['deep', 'short'],
  },
  {
    label: 'trail - lantern + rest', mood: 'idle', face: 'open',
    sceneTier: 1, progress: null, trail: ['reflect', 'break'],
  },
  {
    label: 'trail - gaps stay unlit', mood: 'idle', face: 'open',
    sceneTier: 2, markTier: 1, progress: null,
    trail: ['deep', 'gap', 'short', 'gap'],
  },
  {
    label: 'trail - earlier entries folded', mood: 'idle', face: 'open',
    sceneTier: 3, markTier: 2, progress: null,
    trail: ['aggregate', 'deep', 'short', 'break', 'deep'],
  },
  {
    label: 'trail - 32 entry cap', mood: 'idle', face: 'open',
    sceneTier: 3, markTier: 2, progress: null,
    trail: Array.from(
      { length: 32 },
      (_, index): TrailKind => ['deep', 'short', 'reflect', 'break', 'gap'][index % 5]!,
    ),
  },
]

const SCALE = 6
const PAD = 14
const PAGE_PAD = 20
const CELL_W = SCENE_W * SCALE + PAD * 2
const CELL_H = SCENE_H * SCALE + PAD + 23
const COLS = 4
const PAGE_W = CELL_W * COLS

const parts: string[] = []

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const attrs = (values: Record<string, string | number | undefined>): string =>
  Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ')

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  extra: Record<string, string | number | undefined> = {},
) => parts.push(`<rect ${attrs({ x, y, width, height, fill, ...extra })}/>`)

const path = (d: string, extra: Record<string, string | number | undefined>) =>
  parts.push(`<path ${attrs({ d, ...extra })}/>`)

const label = (
  x: number,
  y: number,
  text: string,
  fill = ROOMS.mono.palette.muted,
  size = 12,
  weight?: number,
) =>
  parts.push(
    `<text ${attrs({ x, y, fill, 'font-family': 'monospace', 'font-size': size, 'font-weight': weight })}>${escapeXml(text)}</text>`,
  )

const beginScene = (x: number, y: number) =>
  parts.push(`<g transform="translate(${x} ${y}) scale(${SCALE})">`)
const endScene = () => parts.push('</g>')

const drawShape = (shape: PixelShape, palette: RoomPalette) => {
  const extra = {
    ...(shape.stroke ? { stroke: palette[shape.stroke] } : {}),
    ...(shape.strokeWidth !== undefined ? { 'stroke-width': shape.strokeWidth } : {}),
    ...(shape.opacity !== undefined ? { opacity: shape.opacity } : {}),
  }
  if (shape.kind === 'rect') {
    rect(shape.x, shape.y, shape.width, shape.height, palette[shape.fill], extra)
  } else {
    path(shape.d, {
      fill: shape.fill ? palette[shape.fill] : 'none',
      ...extra,
    })
  }
}

const drawRoom = (roomId: RoomId, tier: SceneTier, milestone: boolean) => {
  const palette = ROOMS[roomId].palette
  rect(0, 0, SCENE_W, SCENE_H, palette.ink)
  ROOM_SHELL.forEach((shape) => drawShape(shape, palette))
  ROOM_SCENERY[roomId]
    .filter((shape) => shape.tier <= tier)
    .forEach((shape) => drawShape(shape, palette))
  if (milestone) MILESTONE_SHAPES.forEach((shape) => drawShape(shape, palette))
}

const drawTrail = (entries: readonly TrailKind[], palette: RoomPalette) => {
  trailShapes(entries.map((kind) => ({ kind }))).forEach((shape) => drawShape(shape, palette))
}

const drawPixels = (
  grid: Grid,
  dx: number,
  dy: number,
  colours: Record<string, string>,
) => {
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') rect(x + dx, y + dy, 1, 1, colours[ch]!)
    }),
  )
}

const drawShot = (shot: Shot, index: number, top: number) => {
  const roomId = shot.room ?? 'mono'
  const palette = ROOMS[roomId].palette
  const mood = MOODS[shot.mood]
  const ox = (index % COLS) * CELL_W + PAD
  const oy = top + Math.floor(index / COLS) * CELL_H + PAD
  const walked = shot.progress === null ? TRAVEL / 2 : shot.progress * TRAVEL
  const accent = palette[mood.accent]
  const colours = paint(accent)
  const lift = shot.lift ?? 0

  beginScene(ox, oy)
  drawRoom(roomId, shot.sceneTier ?? 0, shot.milestone ?? false)
  rect(0, GROUND_Y, SCENE_W, GROUND_H, palette.line)
  if (shot.progress !== null) rect(0, GROUND_Y, walked + SPRITE_W / 2, GROUND_H, accent)
  drawTrail(shot.trail ?? [], palette)

  let frame: Grid = BODIES[mood.body]
  const markings = MARKINGS[(shot.markTier ?? 0) - 1]
  if (markings) frame = stamp(frame, markings, mood.marks.x, mood.marks.y)
  if (shot.note && mood.note) frame = stamp(frame, NOTE, mood.note.x, mood.note.y)
  frame = stamp(frame, FACES[shot.face], mood.face.x, mood.face.y)

  drawPixels(frame, walked, SPRITE_TOP - lift, colours)
  if (shot.spark) {
    drawPixels(SPARK, mood.spark.x + walked, mood.spark.y + SPRITE_TOP - lift, colours)
  }
  endScene()
  label(ox, oy + SCENE_H * SCALE + 16, shot.label, palette.body)
}

const drawSection = (
  title: string,
  description: string,
  shots: readonly Shot[],
  top: number,
) => {
  label(PAGE_PAD, top + 16, title, ROOMS.mono.palette.bright, 15, 700)
  label(PAGE_PAD, top + 34, description, ROOMS.mono.palette.muted, 11)
  const gridTop = top + 44
  shots.forEach((shot, index) => drawShot(shot, index, gridTop))
  return gridTop + Math.ceil(shots.length / COLS) * CELL_H + 14
}

label(PAGE_PAD, 28, 'MONO COMPANION - VISUAL QA', ROOMS.mono.palette.bright, 18, 700)
label(
  PAGE_PAD,
  48,
  'Rooms, earned growth, interaction previews, trail marks and header crops',
  ROOMS.mono.palette.muted,
  11,
)

let cursor = 66
cursor = drawSection(
  'ROOM EVOLUTION',
  'Columns are rooms; rows are tiers 0, 1, 2 and 3. Cat markings preview the corresponding long-day state.',
  ROOM_SHEET,
  cursor,
)
cursor = drawSection(
  'PHASE AND POSE COVERAGE',
  'Key frames from the day, including notes, progress, milestone sparkle, rest and away states.',
  STATE_SHEET,
  cursor,
)
cursor = drawSection(
  'FOCUS TAPS AND TRAIL LANGUAGE',
  'The three temporary tap previews, followed by earned and compressed trail examples.',
  INTERACTION_SHEET,
  cursor,
)

/** The header crop follows the face anchor, exactly as `markCropTop` does. */
const MARK_CROP = { x: 2, w: 16, h: 10 }
const HEAD_ABOVE_EYES = 6
const markCropTop = (mood: Mood): number =>
  Math.max(0, Math.min(mood.face.y - HEAD_ABOVE_EYES, SPRITE_H - MARK_CROP.h))

const faceFor = (name: MoodName): FaceName =>
  STATE_SHEET.find((shot) => shot.mood === name)?.face ?? 'open'

const drawMark = (
  name: MoodName,
  ox: number,
  oy: number,
  scale: number,
  roomId: RoomId = 'mono',
) => {
  const mood = MOODS[name]
  const palette = ROOMS[roomId].palette
  const frame = stamp(BODIES[mood.body], FACES[faceFor(name)], mood.face.x, mood.face.y)
  const colours = paint(palette[mood.accent])
  const top = markCropTop(mood)

  for (let y = top; y < top + MARK_CROP.h; y += 1) {
    const row = frame[y]
    if (!row) continue
    for (let x = MARK_CROP.x; x < MARK_CROP.x + MARK_CROP.w; x += 1) {
      const ch = row[x]
      if (!ch || ch === '.') continue
      rect(ox + (x - MARK_CROP.x) * scale, oy + (y - top) * scale, scale, scale, colours[ch]!)
    }
  }
}

label(PAGE_PAD, cursor + 16, 'HEADER CROPS', ROOMS.mono.palette.bright, 15, 700)
label(
  PAGE_PAD,
  cursor + 34,
  'Every pose at header scale, plus one large crop for checking face and ear alignment.',
  ROOMS.mono.palette.muted,
  11,
)

const MARK_TOP = cursor + 50
const MARK_SCALE = 4
const moodNames = Object.keys(MOODS) as MoodName[]
moodNames.forEach((name, index) => {
  const ox = PAGE_PAD + index * (MARK_CROP.w * MARK_SCALE + 16)
  drawMark(name, ox, MARK_TOP, MARK_SCALE)
  label(ox, MARK_TOP + MARK_CROP.h * MARK_SCALE + 15, name)
})

const BIG_X = PAGE_W - MARK_CROP.w * 9 - PAGE_PAD
drawMark('idle', BIG_X, MARK_TOP - 4, 9)
label(BIG_X, MARK_TOP + MARK_CROP.h * 9 + 12, 'header crop @9x')

const height = MARK_TOP + MARK_CROP.h * 9 + 34
const pagePalette = ROOMS.mono.palette
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${height}" viewBox="0 0 ${PAGE_W} ${height}"><rect width="100%" height="100%" fill="${pagePalette.ink}"/>${parts.join('')}</svg>`

writeFileSync('companion-preview.svg', svg)
await sharp(Buffer.from(svg)).png().toFile('companion-preview.png')
console.log(
  `wrote companion-preview.png (${SCENE_W}x${SCENE_H} scenes, ${ROOM_SHEET.length + STATE_SHEET.length + INTERACTION_SHEET.length} full-scene checks, ${moodNames.length} header crops)`,
)
