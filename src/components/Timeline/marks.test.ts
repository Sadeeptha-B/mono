import { describe, expect, it } from 'vitest'

import { drawnWithin, markOffsets, offsetAt, placeCard, stackRuns } from './marks'

const MINUTE = 60_000
/** A 45-minute block drawn 72 pixels tall, as the calendar draws one. */
const START = 0
const END = 45 * MINUTE
const HEIGHT = 72

describe('where a block draws its marks', () => {
  it('puts each at the minute it happened', () => {
    expect(markOffsets([0, 15 * MINUTE, 45 * MINUTE], START, END, HEIGHT, 8)).toEqual([0, 24, 72])
  })

  it('keeps marks from outside the span inside the block', () => {
    // A note written in the moment after the block ended, or a clock that
    // stepped back, still belongs to this block and is drawn at its edge.
    expect(markOffsets([-MINUTE, 50 * MINUTE], START, END, HEIGHT, 8)).toEqual([0, 72])
  })

  it('pushes marks that would touch apart, so each can be pointed at', () => {
    expect(markOffsets([10 * MINUTE, 10 * MINUTE, 11 * MINUTE], START, END, HEIGHT, 8)).toEqual([
      16, 24, 32,
    ])
  })

  it('pushes back up from the bottom rather than past it', () => {
    expect(markOffsets([44 * MINUTE, 45 * MINUTE], START, END, HEIGHT, 8)).toEqual([64, 72])
  })

  it('lets them overlap in a block too short to hold them apart', () => {
    const offsets = markOffsets([0, 0, 0, 0], START, 5 * MINUTE, 8, 8)
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(8)
    }
  })

  it('draws nothing for nothing, and survives a span of no length', () => {
    expect(markOffsets([], START, END, HEIGHT, 8)).toEqual([])
    expect(markOffsets([5], 5, 5, HEIGHT, 8)).toEqual([0])
  })
})

describe('which marks a block drawn only in part carries', () => {
  // 23:45 to 00:30, with midnight at 15 minutes in.
  const whole = { start: START, end: END }
  const midnight = 15 * MINUTE

  it('keeps each side of midnight to its own day', () => {
    const today = { start: midnight, end: END }
    const yesterday = { start: START, end: midnight }
    expect(drawnWithin(10 * MINUTE, whole, today)).toBe(false)
    expect(drawnWithin(midnight, whole, today)).toBe(true)
    expect(drawnWithin(25 * MINUTE, whole, today)).toBe(true)
    expect(drawnWithin(10 * MINUTE, whole, yesterday)).toBe(true)
    expect(drawnWithin(midnight, whole, yesterday)).toBe(false)
  })

  it('drops nothing past an end that was not cut', () => {
    expect(drawnWithin(-MINUTE, whole, whole)).toBe(true)
    expect(drawnWithin(50 * MINUTE, whole, whole)).toBe(true)
    expect(drawnWithin(50 * MINUTE, whole, { start: midnight, end: END })).toBe(true)
  })
})

describe('notes too many for their block', () => {
  // A 20-minute block, as the calendar draws one less its corners: room for
  // three marks at the gap a pointer needs.
  const SHORT = 20 * MINUTE
  const ROOM = 26
  const GAP = 10

  it('keeps one mark per note while they fit', () => {
    const runs = stackRuns([0, 5 * MINUTE, 10 * MINUTE], START, SHORT, ROOM, GAP)
    expect(runs).toEqual([
      { first: 0, last: 0 },
      { first: 1, last: 1 },
      { first: 2, last: 2 },
    ])
  })

  it('joins the nearest neighbours first, until the rest fit', () => {
    const minutes = [0, 1, 10, 11, 19].map((m) => m * MINUTE)
    expect(stackRuns(minutes, START, SHORT, ROOM, GAP)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 3 },
      { first: 4, last: 4 },
    ])
  })

  it('joins the earlier pair when neighbours are equally near', () => {
    // A pixel a minute, so the distances are exactly equal.
    const minutes = [0, 1, 2, 3].map((m) => m * MINUTE)
    expect(stackRuns(minutes, START, SHORT, 20, GAP)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 2 },
      { first: 3, last: 3 },
    ])
  })

  it('draws every run at its first note, apart, within the block', () => {
    const minutes = [0, 0, 0, 1, 1, 2, 2, 2].map((m) => m * MINUTE)
    const runs = stackRuns(minutes, START, SHORT, ROOM, GAP)
    expect(runs.length).toBeLessThanOrEqual(3)
    expect(runs.flatMap((r) => [r.first, r.last])).toEqual(
      [...runs.flatMap((r) => [r.first, r.last])].sort((a, b) => a - b),
    )
    expect(runs[0]!.first).toBe(0)
    expect(runs.at(-1)!.last).toBe(minutes.length - 1)
    const offsets = markOffsets(runs.map((r) => minutes[r.first]!), START, SHORT, ROOM, GAP)
    for (const [i, offset] of offsets.entries()) {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(ROOM)
      if (i > 0) expect(offset - offsets[i - 1]!).toBeGreaterThanOrEqual(GAP)
    }
  })

  it('puts everything on one mark in a block with no room at all', () => {
    expect(stackRuns([0, MINUTE], START, SHORT, 0, GAP)).toEqual([{ first: 0, last: 1 }])
    expect(stackRuns([], START, SHORT, 0, GAP)).toEqual([])
  })
})

describe('where an urge is drawn', () => {
  it("is its own minute, pushed nowhere, and the block's edge when outside it", () => {
    expect(offsetAt(15 * MINUTE, START, END, HEIGHT)).toBe(24)
    expect(offsetAt(-MINUTE, START, END, HEIGHT)).toBe(0)
    expect(offsetAt(50 * MINUTE, START, END, HEIGHT)).toBe(HEIGHT)
  })
})

describe("where a mark's card opens", () => {
  const SIZE = { width: 224, height: 288 }
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  })

  describe('beside a mark on the edge of a block', () => {
    const column = box(0, 0, 400, 800)

    it('opens over the block, downward, at full size where there is room', () => {
      expect(placeCard(box(280, 100, 300, 114), column, true, SIZE)).toEqual({
        left: 60,
        width: 224,
        opens: 'down',
        edge: 100,
        maxHeight: 288,
      })
    })

    it('opens the other way in a lane with no room to its left', () => {
      const place = placeCard(box(150, 100, 170, 114), column, true, SIZE)
      expect(place).toMatchObject({ left: 166, width: 224 })
    })

    it('narrows to the larger side when neither holds it whole', () => {
      const place = placeCard(box(150, 100, 170, 114), box(0, 0, 300, 800), true, SIZE)
      expect(place).toMatchObject({ left: 4, width: 150 })
    })

    it('opens upward near the bottom of what is visible', () => {
      const place = placeCard(box(280, 700, 300, 714), column, true, SIZE)
      expect(place).toMatchObject({ opens: 'up', edge: 714, maxHeight: 288 })
    })
  })

  describe('from a mark on a strip', () => {
    const window = box(0, 0, 320, 160)

    it('opens above, slides along to stay in view, and still lies over its mark', () => {
      const place = placeCard(box(140, 100, 160, 114), window, false, SIZE)
      expect(place).toEqual({ left: 92, width: 224, opens: 'up', edge: 102, maxHeight: 98 })
      expect(place.left).toBeLessThanOrEqual(140)
      expect(place.left + place.width).toBeGreaterThanOrEqual(160)
    })

    it('opens below once the strip has been scrolled near the top', () => {
      const place = placeCard(box(140, 10, 160, 24), window, false, SIZE)
      expect(place).toMatchObject({ opens: 'down', edge: 22, maxHeight: 134 })
    })
  })
})
