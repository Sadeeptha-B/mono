import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ambienceGainFor } from './audio'
import { resolveAmbience, wantsAmbience } from './useAmbience'
import { ROOM_IDS, ROOMS } from './rooms'

describe('ambient settings', () => {
  it('resolves room suggestions without changing direct overrides', () => {
    expect(resolveAmbience('room', 'tide')).toBe('rain')
    expect(resolveAmbience('room', 'ember')).toBe('pink')
    expect(resolveAmbience('brown', 'tide')).toBe('brown')
    expect(resolveAmbience('off', 'mono')).toBeNull()
  })

  it('only wants ambience during a running focus or priorities block', () => {
    const active = { kind: 'block', id: 'b', blockKind: 'deep', purpose: null, startedAt: 0, endsAt: 1 } as const
    expect(wantsAmbience({ name: 'focusing' }, active)).toBe(true)
    expect(wantsAmbience({ name: 'reflecting' }, active)).toBe(true)
    expect(wantsAmbience({ name: 'blockComplete' }, active)).toBe(false)
    expect(wantsAmbience({ name: 'idle' }, null)).toBe(false)
  })

  it('uses a bounded squared gain curve', () => {
    expect(ambienceGainFor(0)).toBe(0)
    expect(ambienceGainFor(0.5)).toBeCloseTo(0.0875)
    expect(ambienceGainFor(2)).toBe(0.35)
  })

  it('gives every room a complete, readable body palette', () => {
    for (const id of ROOM_IDS) {
      const palette = ROOMS[id].palette
      expect(Object.keys(palette)).toHaveLength(12)
      expect(contrast(palette.body, palette.surface), id).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.bright, palette.ink), id).toBeGreaterThanOrEqual(7)
    }
  })

  it('gives the room menu one distinct palette indicator per room', () => {
    const indicators = ROOM_IDS.map((id) => ROOMS[id].indicator)
    expect(new Set(indicators).size).toBe(ROOM_IDS.length)
    for (const id of ROOM_IDS) {
      expect(ROOMS[id].indicator).toMatch(/^#[0-9a-f]{6}$/i)
      expect(Object.values(ROOMS[id].palette)).toContain(ROOMS[id].indicator)
    }
  })

  it('keeps every runtime CSS palette equal to the room metadata', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
      'utf8',
    )
    for (const id of ROOM_IDS) {
      const declarations = cssDeclarations(
        cssBlock(css, id === 'mono' ? '@theme' : `[data-room='${id}']`),
      )
      for (const [key, value] of Object.entries(ROOMS[id].palette)) {
        const token = key === 'raised' ? 'surface-raised' : key
        expect(declarations.get(`--color-${token}`), `${id}.${key}`).toBe(value)
      }
    }
  })

  it('does not mistake a selector named in a comment for its rule', () => {
    const selector = "[data-room='tide']"
    const css = `/* ${selector} { --color-ink: #ffffff; } */\n${selector} { --color-ink: #061014; }`
    expect(cssDeclarations(cssBlock(css, selector)).get('--color-ink')).toBe('#061014')
  })
})

const cssBlock = (css: string, selector: string): string => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = source.indexOf(selector)
  const open = source.indexOf('{', start)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  expect(open, selector).toBeGreaterThan(start)

  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }

  throw new Error(`Unclosed CSS block for ${selector}`)
}

const cssDeclarations = (block: string): Map<string, string> =>
  new Map(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1]!, match[2]!.toLowerCase()]),
  )

const luminance = (hex: string): number => {
  const values = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const [r, g, b] = values.map((value) =>
    value! <= 0.04045 ? value! / 12.92 : ((value! + 0.055) / 1.055) ** 2.4,
  )
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722
}

const contrast = (one: string, two: string): number => {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}
