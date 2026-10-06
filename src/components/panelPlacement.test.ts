import { describe, expect, it } from 'vitest'

import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, placeAcross, type Across, type Span } from './panelPlacement'

/** Where the panel's two edges can reach, in viewport pixels, for a placement. */
function reach(anchor: Span, across: Across): Span {
  const right = across.side === 'left' ? anchor.left + across.maxWidth : anchor.right - across.offset
  const left = across.side === 'left' ? anchor.left : right - across.maxWidth
  return { left, right }
}

describe('placing a panel across', () => {
  const desktop: Span = { left: 16, right: 1264 }

  it('hangs from the button when there is room to the right', () => {
    const anchor = { left: 300, right: 420 }
    expect(placeAcross(anchor, desktop)).toEqual({
      side: 'left',
      offset: 0,
      minWidth: PANEL_MIN_WIDTH,
      maxWidth: PANEL_MAX_WIDTH,
    })
  })

  it('narrows to the room to the right before it gives up the button', () => {
    const anchor = { left: 900, right: 1000 }
    const across = placeAcross(anchor, { left: 16, right: 1200 })
    expect(across).toMatchObject({ side: 'left', maxWidth: 300 })
  })

  // The review's case: a 375-pixel phone, the button starting at 189.
  it('lines up with the right of the room when a usable panel will not fit', () => {
    const phone: Span = { left: 16, right: 359 }
    const anchor = { left: 189, right: 300 }
    const across = placeAcross(anchor, phone)
    expect(across).toEqual({
      side: 'right',
      offset: 300 - 359,
      minWidth: PANEL_MIN_WIDTH,
      maxWidth: 359 - 16,
    })
    const edges = reach(anchor, across)
    expect(edges.right).toBe(phone.right)
    expect(edges.left).toBeGreaterThanOrEqual(phone.left)
  })

  it.each([
    [{ left: 20, right: 60 }],
    [{ left: 150, right: 260 }],
    [{ left: 290, right: 350 }],
  ])('never reaches past either edge of a narrow room, from %o', (anchor) => {
    const room: Span = { left: 16, right: 304 }
    const across = placeAcross(anchor, room)
    const edges = reach(anchor, across)
    expect(edges.left).toBeGreaterThanOrEqual(room.left)
    expect(edges.right).toBeLessThanOrEqual(room.right)
    expect(across.minWidth).toBeLessThanOrEqual(across.maxWidth)
  })

  it('shrinks its minimum rather than overflow a room narrower than it', () => {
    const across = placeAcross({ left: 40, right: 80 }, { left: 16, right: 216 })
    expect(across.minWidth).toBe(200)
    expect(across.maxWidth).toBe(200)
  })
})
