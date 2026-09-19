import { expect, it } from 'vitest'

import { timerFace } from './timerFace'
import type { ActiveSegment } from '@/domain/types'

const block: ActiveSegment = {
  kind: 'block',
  id: 'focus',
  blockKind: 'deep',
  purpose: 'Write',
  startedAt: 0,
  endsAt: 60_000,
}

it('keeps the focused button name stable while its reading ticks', () => {
  const first = timerFace(block, 0, 'elapsed')
  const later = timerFace(block, 10_000, 'elapsed')

  expect(first.reading).toBe('0:00')
  expect(later.reading).toBe('0:10')
  expect(later.buttonLabel).toBe(first.buttonLabel)
  expect(later.buttonLabel).toBe('Timer showing elapsed time. Show time remaining')
})

it('calls time past the end over, not remaining', () => {
  const face = timerFace(block, 75_000, 'remaining')

  expect(face.reading).toBe('0:15')
  expect(face.modeLabel).toBe('Over')
  expect(face.overBy).toBe('0:15')
  expect(face.buttonLabel).toBe('Timer over its end. Show elapsed time')
})

it('names elapsed break time without calling it focus', () => {
  const onBreak: ActiveSegment = { kind: 'break', id: 'rest', startedAt: 0, endsAt: 60_000 }
  expect(timerFace(onBreak, 10_000, 'elapsed').modeLabel).toBe('Break elapsed')
})
