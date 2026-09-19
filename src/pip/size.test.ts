import { describe, expect, it } from 'vitest'

import { MINI_WINDOW_RANGE, MINI_WINDOW_SIZE, outsideMiniWindowRange } from './size'

describe('mini window size', () => {
  it('resets to a size that is inside the preferred range', () => {
    expect(outsideMiniWindowRange(MINI_WINDOW_SIZE.width, MINI_WINDOW_SIZE.height)).toBe(false)
  })

  it('includes each boundary and offers reset immediately beyond it', () => {
    const { minWidth, minHeight, maxWidth, maxHeight } = MINI_WINDOW_RANGE
    const { width, height } = MINI_WINDOW_SIZE

    expect(outsideMiniWindowRange(minWidth, height)).toBe(false)
    expect(outsideMiniWindowRange(minWidth - 1, height)).toBe(true)
    expect(outsideMiniWindowRange(maxWidth, height)).toBe(false)
    expect(outsideMiniWindowRange(maxWidth + 1, height)).toBe(true)

    expect(outsideMiniWindowRange(width, minHeight)).toBe(false)
    expect(outsideMiniWindowRange(width, minHeight - 1)).toBe(true)
    expect(outsideMiniWindowRange(width, maxHeight)).toBe(false)
    expect(outsideMiniWindowRange(width, maxHeight + 1)).toBe(true)
  })
})
