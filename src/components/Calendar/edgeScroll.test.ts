import { describe, expect, it } from 'vitest'

import { armedAt, EDGE_PX, EDGE_STEP_PX, edgeStep, grownAxis, scrollStep } from './edgeScroll'

const seen = { top: 100, bottom: 700 }

describe('scrolling the day under a drag held at its edge', () => {
  it('scrolls towards an edge the pointer reaches, faster the nearer it is', () => {
    const armed = armedAt(null, 400, seen)
    expect(edgeStep(400, seen, armed)).toBe(0)
    expect(edgeStep(seen.top + EDGE_PX / 2, seen, armed)).toBe(-EDGE_STEP_PX / 2)
    expect(edgeStep(seen.top - 30, seen, armed)).toBe(-EDGE_STEP_PX)
    expect(edgeStep(seen.bottom - 1, seen, armed)).toBeGreaterThan(EDGE_STEP_PX / 2)
    expect(edgeStep(seen.bottom + 30, seen, armed)).toBe(EDGE_STEP_PX)
  })

  it('leaves the edge a drag began beside alone until the pointer has left it', () => {
    // Picked up ten pixels under the top and pulled down: nothing scrolls up.
    const pressed = seen.top + 10
    let armed = armedAt(null, pressed, seen)
    expect(edgeStep(pressed + 4, seen, armed)).toBe(0)

    // Out of the zone and back: now it is a reach for the edge.
    armed = armedAt(armed, seen.top + EDGE_PX + 10, seen)
    expect(edgeStep(pressed, seen, armed)).toBeLessThan(0)
  })

  it('arms the far edge from the start', () => {
    const armed = armedAt(null, seen.top + 10, seen)
    expect(edgeStep(seen.bottom, seen, armed)).toBeGreaterThan(0)
  })
})

describe('scrolling no further than the day', () => {
  it('takes the step asked for while there is room, and only the room left', () => {
    expect(scrollStep(-14, { up: 100, down: 0 })).toBe(-14)
    expect(scrollStep(-14, { up: 5, down: 0 })).toBe(-5)
    expect(scrollStep(14, { up: 0, down: 3 })).toBe(3)
  })

  it('stops at the end of the day, which is where the day grows instead', () => {
    expect(scrollStep(-14, { up: 0, down: 500 })).toBe(0)
    expect(scrollStep(14, { up: 500, down: 0 })).toBe(0)
  })
})

describe('growing the day under a drag held at its end', () => {
  const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m).getTime()
  const day = { start: at(0), end: new Date(2026, 7, 21).getTime() }

  it('adds an hour towards the edge held', () => {
    const axis = { start: at(14), end: at(18) }
    expect(grownAxis(axis, day, false)).toEqual({ start: at(14), end: at(19) })
    expect(grownAxis(axis, day, true)).toEqual({ start: at(13), end: at(18) })
  })

  it('stops at midnight, either side', () => {
    expect(grownAxis({ start: at(14), end: at(23, 30) }, day, false)).toEqual({
      start: at(14),
      end: day.end,
    })
    expect(grownAxis({ start: at(14), end: day.end }, day, false)).toBeNull()
    expect(grownAxis({ start: day.start, end: at(18) }, day, true)).toBeNull()
  })
})
