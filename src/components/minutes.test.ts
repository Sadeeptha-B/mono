import { describe, expect, it } from 'vitest'

import { coerceBoundedMinutes, parseBoundedMinutes } from './minutes'

describe('minutes helpers', () => {
  it('rejects values outside the accepted range', () => {
    expect(parseBoundedMinutes('0', 5, 480)).toBeNull()
    expect(parseBoundedMinutes('999', 5, 480)).toBeNull()
    expect(parseBoundedMinutes('30', 5, 480)).toBe(30)
  })

  it('coerces empty and out-of-range values back into bounds', () => {
    expect(coerceBoundedMinutes('', 30, 5, 480)).toBe('30')
    expect(coerceBoundedMinutes('0', 30, 5, 480)).toBe('5')
    expect(coerceBoundedMinutes('999', 30, 5, 480)).toBe('480')
  })
})