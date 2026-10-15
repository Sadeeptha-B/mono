import { describe, expect, it } from 'vitest'

import { lengthOf, nextAfter, withStart } from './stretch'

describe('stretch helpers', () => {
  it('measures a stretch that runs forwards, and nothing else', () => {
    expect(lengthOf({ start: '09:00', end: '18:00' })).toBe(540)
    expect(lengthOf({ start: '18:00', end: '09:00' })).toBeNull()
    expect(lengthOf({ start: '09:00', end: '09:00' })).toBeNull()
    expect(lengthOf({ start: '', end: '18:00' })).toBeNull()
  })

  it('moves the end with a new start, either way, keeping the length', () => {
    expect(withStart({ start: '09:00', end: '18:00' }, '10:30', 540)).toEqual({
      start: '10:30',
      end: '19:30',
    })
    expect(withStart({ start: '09:00', end: '18:00' }, '07:15', 540)).toEqual({
      start: '07:15',
      end: '16:15',
    })
  })

  it('stops the end at 23:59 rather than wrapping into tomorrow', () => {
    expect(withStart({ start: '09:00', end: '18:00' }, '20:00', 540)).toEqual({
      start: '20:00',
      end: '23:59',
    })
    expect(withStart({ start: '09:00', end: '18:00' }, '23:59', 540)).toEqual({
      start: '23:59',
      end: '23:59',
    })
  })

  it('leaves the end alone with no length to keep or no time to keep it from', () => {
    expect(withStart({ start: '18:00', end: '09:00' }, '10:00', null)).toEqual({
      start: '10:00',
      end: '09:00',
    })
    // A cleared field: the end is still what the user wrote.
    expect(withStart({ start: '09:00', end: '18:00' }, '', 540)).toEqual({
      start: '',
      end: '18:00',
    })
  })

  it('starts another stretch where the last one ended', () => {
    expect(nextAfter('18:00')).toEqual({ start: '18:00', end: '20:00' })
    expect(nextAfter('23:30')).toEqual({ start: '22:00', end: '23:59' })
  })
})
