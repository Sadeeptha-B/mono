// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ambienceGainFor } from './audio'
import { applyRoomTheme } from './theme'
import { resolveAmbience, wantsAmbience } from './useAmbience'
import { ACCENT_TOKENS, cssProperty, PALETTE_TOKENS, PALETTES } from './palette'
import { ROOMS } from './rooms'
import { ROOM_IDS, type RoomId } from '@/domain/types'
// Reaching out of `src` on purpose, and the only test that does. The icons are
// generated from this module and then committed, so the checked-in files are a
// copy of its output; nothing but re-running it can say whether they still are.
import { FIELD, svg } from '../../scripts/icon-tile.ts'

describe('ambient settings', () => {
  it('resolves room suggestions without changing direct overrides', () => {
    expect(resolveAmbience('room', 'tide')).toBe('rain')
    expect(resolveAmbience('room', 'hearth')).toBe('pink')
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
      expect(Object.keys(palette)).toHaveLength(PALETTE_TOKENS.length)
      expect(contrast(palette.body, palette.surface), id).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.bright, palette.ink), id).toBeGreaterThanOrEqual(7)
      // Muted text occurs on both panel levels; raised is the tighter pair.
      expect(contrast(palette.muted, palette.surface), id).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.muted, palette.raised), id).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Accents render as normal-size text, often on a 15% tint of themselves.
  // That tinted chip is the binding contrast case.
  it('keeps every accent readable as text, including on a chip of itself', () => {
    for (const id of ROOM_IDS) {
      const palette = ROOMS[id].palette
      for (const accent of ACCENT_TOKENS) {
        const colour = palette[accent]
        for (const behind of [palette.surface, palette.raised]) {
          const where = `${id}.${accent} on ${behind}`
          expect(contrast(colour, behind), where).toBeGreaterThanOrEqual(4.5)
          expect(contrast(colour, tint(colour, behind, 0.15)), where)
            .toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('keeps translucent timeline text and functional control borders readable', () => {
    for (const id of ROOM_IDS) {
      const palette = PALETTES[id]

      // `commitment-margin` is deliberately quieter than the commitment it
      // belongs to, but remains normal-size text: commit/85 on commit/5.
      const marginBackground = tint(palette.commit, palette.surface, 0.05)
      const marginText = tint(palette.commit, marginBackground, 0.85)
      expect(contrast(marginText, marginBackground), `${id}.commitment-margin`)
        .toBeGreaterThanOrEqual(4.5)

      // Interactive boundaries use muted/70. Cards are painted on surface;
      // ink-backed fields paint the translucent border over their own ink and
      // must stay distinguishable from both the field and its surroundings.
      const cardBorder = tint(palette.muted, palette.surface, 0.7)
      expect(contrast(cardBorder, palette.surface), `${id}.card border`)
        .toBeGreaterThanOrEqual(3)
      const fieldBorder = tint(palette.muted, palette.ink, 0.7)
      expect(contrast(fieldBorder, palette.ink), `${id}.field inner border`)
        .toBeGreaterThanOrEqual(3)
      expect(contrast(fieldBorder, palette.surface), `${id}.field outer border`)
        .toBeGreaterThanOrEqual(3)

      // Form placeholders are normal-size text on ink-backed fields.
      const placeholder = tint(palette.muted, palette.ink, 0.9)
      expect(contrast(placeholder, palette.ink), `${id}.placeholder`)
        .toBeGreaterThanOrEqual(4.5)

      // The storage warning lives in an ink header and reaches commit/20 on hover.
      const warningBackground = tint(palette.commit, palette.ink, 0.2)
      expect(contrast(palette.commit, warningBackground), `${id}.storage warning`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it('gives the room menu one distinct palette indicator per room', () => {
    // Token names keep swatches inside their palettes; resolved colours must
    // still remain distinct.
    const swatches = ROOM_IDS.map((id) => ROOMS[id].palette[ROOMS[id].indicator])
    expect(new Set(swatches).size).toBe(ROOM_IDS.length)
    for (const swatch of swatches) expect(swatch).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('keeps Mono\'s required build-time CSS tokens equal to its palette', () => {
    const css = readStylesheet()
    const declarations = cssDeclarations(cssBlock(css, '@theme'))
    for (const token of PALETTE_TOKENS) {
      expect(declarations.get(cssProperty(token)), `mono.${token}`).toBe(PALETTES.mono[token])
    }
  })

  it('applies every room directly and replaces all tokens when switching', () => {
    const target = document.implementation.createHTMLDocument('Mono')
    const meta = target.createElement('meta')
    meta.name = 'theme-color'
    target.head.append(meta)

    for (const id of ROOM_IDS) {
      applyRoomTheme(target, id)
      expect(target.documentElement.dataset.room).toBe(id)
      expect(meta.content).toBe(PALETTES[id].ink)
      for (const token of PALETTE_TOKENS) {
        expect(target.documentElement.style.getPropertyValue(cssProperty(token)), `${id}.${token}`).toBe(
          PALETTES[id][token],
        )
      }
    }
  })

  it('falls back to Mono before React when a persisted room id is damaged', () => {
    const target = document.implementation.createHTMLDocument('Mono')
    applyRoomTheme(target, 'elsewhere' as RoomId)

    expect(target.documentElement.dataset.room).toBe('mono')
    for (const token of PALETTE_TOKENS) {
      expect(target.documentElement.style.getPropertyValue(cssProperty(token)))
        .toBe(PALETTES.mono[token])
    }
  })

  // Icons are generated and committed. The SVG stands for the batch because
  // the same command writes it and all three PNGs from this source.
  it('keeps the committed favicon equal to the art it is generated from', () => {
    const committed = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../public/mono.svg'),
      'utf8',
    )
    // Generator LF and checkout CRLF are equivalent.
    expect(committed.replace(/\r\n/g, '\n')).toBe(`${svg(FIELD, 1)}\n`)
    expect(committed).toContain(PALETTES.mono.ink)
    expect(committed).toContain(PALETTES.mono.deep)
  })
})

const readStylesheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

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

/** What `bg-<accent>/<percent>` actually paints: the accent over the panel. */
const tint = (colour: string, behind: string, alpha: number): string => {
  const mix = [1, 3, 5].map((start) => {
    const of = (hex: string) => Number.parseInt(hex.slice(start, start + 2), 16)
    return Math.round(of(colour) * alpha + of(behind) * (1 - alpha))
  })
  return `#${mix.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

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
