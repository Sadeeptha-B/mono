/**
 * Contact sheet for the companion's frames.
 *
 *   npm run companion   →  companion-preview.png
 *
 * Pixel art authored as text is unreadable as text. Every pose in
 * `src/components/Companion/frames.ts` was drawn against this: write the rows,
 * run this, look at the cat, fix the rows. Anything added to the frame set
 * should go through the same loop, so the table at the bottom is the only
 * thing that needs extending.
 *
 * It renders one rectangle per pixel and does its own compositing, which the
 * app does not — `sprite.ts` collapses spans and is covered by its own tests.
 * A dev script that reached into the app's module graph would need the Vite
 * aliases; keeping it standalone means it is one `node` away at any time.
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

type Grid = readonly string[]

const stamp = (base: Grid, layer: Grid, x: number, y: number): string[] => {
  const rows = base.map((r) => [...r])
  layer.forEach((row, dy) => {
    const target = rows[y + dy]
    if (!target) return
    for (let dx = 0; dx < row.length; dx += 1) {
      const ch = row[dx]!
      if (ch !== '.' && x + dx < target.length) target[x + dx] = ch
    }
  })
  return rows.map((r) => r.join(''))
}

const INK = '#08080b'
const LINE = '#24242e'
const MUTED = '#6e6e80'

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

const SCENE_W = 36
const SCENE_H = 20
const SPRITE_TOP = 2
const GROUND_Y = SPRITE_TOP + SPRITE_H
const TRAVEL = SCENE_W - SPRITE_W

/**
 * The mood table, minus the timings, with the CSS custom properties resolved.
 *
 * Copied from `cat.ts` and kept in step by hand: that file imports
 * React-adjacent types, and this stays a plain node script you can run at any
 * moment without a build step. Drift here costs a misleading picture and
 * nothing else — `sprite.test.ts` is what actually holds the anchors to the fur.
 */
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
  accent: string
}

const MOODS: Record<MoodName, Mood> = {
  idle: {
    body: 'sit',
    face: { x: 5, y: 5 },
    spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 },
    accent: MUTED,
  },
  defining: {
    body: 'lean',
    face: { x: 5, y: 6 },
    spark: { x: 19, y: 0 },
    marks: { x: 4, y: 8 },
    accent: '#7fa8d9',
  },
  focusing: {
    body: 'loaf',
    face: { x: 5, y: 5 },
    spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 },
    note: { x: 9, y: 11 },
    accent: '#e8a33d',
  },
  reflecting: {
    body: 'curl',
    face: { x: 5, y: 5 },
    spark: { x: 19, y: 0 },
    marks: { x: 4, y: 10 },
    note: { x: 9, y: 11 },
    accent: '#b088d9',
  },
  complete: {
    body: 'perk',
    face: { x: 5, y: 5 },
    spark: { x: 19, y: 0 },
    marks: { x: 5, y: 10 },
    accent: '#5cae8f',
  },
  resting: {
    body: 'sprawl',
    face: { x: 5, y: 8 },
    spark: { x: 19, y: 2 },
    marks: { x: 3, y: 12 },
    accent: '#5cae8f',
  },
  away: {
    body: 'ball',
    face: { x: 5, y: 8 },
    spark: { x: 19, y: 4 },
    marks: { x: 4, y: 9 },
    accent: MUTED,
  },
}

type Shot = {
  label: string
  mood: MoodName
  face: FaceName
  /** null parks the cat mid-strip, as it is when no block is running. */
  progress: number | null
  lift?: number
  spark?: boolean
  note?: boolean
  tier?: 0 | 1 | 2
}

/**
 * One row per mood, in the order a day meets them, plus the frames worth
 * seeing on their own: part-way through a block, holding a note, being petted,
 * and wearing what a long day earns it.
 */
const SHEET: Shot[] = [
  { label: 'idle', mood: 'idle', face: 'open', progress: null },
  {
    label: 'idle · petted',
    mood: 'idle',
    face: 'happy',
    progress: null,
    lift: 2,
    spark: true,
  },
  { label: 'defining', mood: 'defining', face: 'wide', progress: null },
  {
    label: 'reflecting · holding it',
    mood: 'reflecting',
    face: 'aside',
    progress: 0.4,
    note: true,
  },
  { label: 'focusing · 8%', mood: 'focusing', face: 'squint', progress: 0.08, note: true },
  { label: 'focusing · 78%', mood: 'focusing', face: 'squint', progress: 0.78, note: true },
  { label: 'complete · mid-hop', mood: 'complete', face: 'happy', progress: null, lift: 2 },
  { label: 'resting', mood: 'resting', face: 'blink', progress: null },
  { label: 'away', mood: 'away', face: 'squint', progress: null },
  { label: 'away · petted', mood: 'away', face: 'shut', progress: null },
  { label: 'idle · 3 blocks in', mood: 'idle', face: 'open', progress: null, tier: 1 },
  { label: 'idle · 6 blocks in', mood: 'idle', face: 'open', progress: null, tier: 2 },
  {
    label: 'focusing · 6 blocks in',
    mood: 'focusing',
    face: 'squint',
    progress: 0.5,
    note: true,
    tier: 2,
  },
  { label: 'resting · 6 blocks in', mood: 'resting', face: 'blink', progress: null, tier: 2 },
]

const SCALE = 9
const PAD = 14
const CELL_W = SCENE_W * SCALE + PAD * 2
const CELL_H = SCENE_H * SCALE + PAD + 22
const COLS = 2
const ROWS = Math.ceil(SHEET.length / COLS)
const MARK_TOP = CELL_H * ROWS + 12

const parts: string[] = []
const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`)
const label = (x: number, y: number, text: string) =>
  parts.push(
    `<text x="${x}" y="${y}" fill="${MUTED}" font-family="monospace" font-size="12">${text}</text>`,
  )

SHEET.forEach((shot, i) => {
  const mood = MOODS[shot.mood]
  const ox = (i % COLS) * CELL_W + PAD
  const oy = Math.floor(i / COLS) * CELL_H + PAD
  const walked = shot.progress === null ? TRAVEL / 2 : shot.progress * TRAVEL
  const colours = paint(mood.accent)
  const lift = shot.lift ?? 0

  rect(ox, oy + GROUND_Y * SCALE, SCENE_W * SCALE, 0.9 * SCALE, LINE)
  if (shot.progress !== null) {
    rect(ox, oy + GROUND_Y * SCALE, (walked + SPRITE_W / 2) * SCALE, 0.9 * SCALE, mood.accent)
  }

  const draw = (grid: Grid, dx: number, dy: number) =>
    grid.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return
        const px = x + dx + walked
        const py = y + dy + SPRITE_TOP - lift
        rect(ox + px * SCALE, oy + py * SCALE, SCALE, SCALE, colours[ch]!)
      }),
    )

  // Same order as the renderer: body, then the day's markings, then whatever
  // it is holding, then the face last so nothing lands over the eyes.
  let frame: Grid = BODIES[mood.body]
  const markings = MARKINGS[(shot.tier ?? 0) - 1]
  if (markings) frame = stamp(frame, markings, mood.marks.x, mood.marks.y)
  if (shot.note && mood.note) frame = stamp(frame, NOTE, mood.note.x, mood.note.y)
  frame = stamp(frame, FACES[shot.face], mood.face.x, mood.face.y)

  draw(frame, 0, 0)
  if (shot.spark) draw(SPARK, mood.spark.x, mood.spark.y)

  label(ox, oy + SCENE_H * SCALE + 15, shot.label)
})

/**
 * The header crop, once per pose.
 *
 * The header shows the head alone, and the top of that crop follows the pose's
 * face anchor rather than sitting at row zero — a sprawled cat's eyes are
 * three rows lower than a sitting one's, and a fixed crop gave the header an
 * empty box with a sliver of ear in it. This row is how you check that a new
 * pose crops to a face. Same derivation as `markCropTop` in `cat.ts`, copied
 * here for the same reason the mood table is.
 */
const MARK_CROP = { x: 2, w: 16, h: 10 }
const HEAD_ABOVE_EYES = 6
const markCropTop = (mood: Mood): number =>
  Math.max(0, Math.min(mood.face.y - HEAD_ABOVE_EYES, SPRITE_H - MARK_CROP.h))

/** Whatever face that mood wears in the sheet above, so the two agree. */
const faceFor = (name: MoodName): FaceName =>
  SHEET.find((shot) => shot.mood === name)?.face ?? 'open'

const drawMark = (name: MoodName, ox: number, oy: number, scale: number) => {
  const mood = MOODS[name]
  const frame = stamp(BODIES[mood.body], FACES[faceFor(name)], mood.face.x, mood.face.y)
  const colours = paint(mood.accent)
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

const MARK_SCALE = 4
const moodNames = Object.keys(MOODS) as MoodName[]

moodNames.forEach((name, i) => {
  const ox = PAD + i * (MARK_CROP.w * MARK_SCALE + 14)
  drawMark(name, ox, MARK_TOP, MARK_SCALE)
  label(ox, MARK_TOP + MARK_CROP.h * MARK_SCALE + 14, name)
})

// And one at a size you can actually inspect.
const BIG_TOP = MARK_TOP + 74
drawMark('idle', PAD, BIG_TOP, 10)
label(PAD, BIG_TOP + MARK_CROP.h * 10 + 16, 'header crop @10x')

const width = CELL_W * COLS
const height = BIG_TOP + MARK_CROP.h * 10 + 30
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${INK}"/>${parts.join('')}</svg>`

writeFileSync('companion-preview.svg', svg)
await sharp(Buffer.from(svg)).png().toFile('companion-preview.png')
console.log(`wrote companion-preview.png (${SPRITE_W}x${SPRITE_H} sprites, ${SHEET.length} frames)`)
