/**
 * Where every colour in the app comes from.
 *
 * The rooms used to be twelve hand-picked hex values each, and they drifted
 * into each other exactly as you would expect: tuning one room at a time, by
 * eye, in sRGB. Two of them ended up sixteen degrees apart at a chroma of
 * about 0.01, which is two greys and not two rooms. So the palettes are built
 * here instead, from one ramp and a few numbers per room. Runtime theming,
 * room metadata, PWA metadata and generated art all read the result directly.
 *
 * The construction, in one paragraph. The seven surface and text tokens come
 * off a single lightness ramp and a single chroma curve, rotated to the room's
 * own hue and scaled by its chroma multiplier. Chroma peaks at `line` — the
 * token that draws the room's edges — and falls almost to nothing at `bright`,
 * so surfaces carry the hue while text stays neutral enough to read. The five
 * accents are the opposite: their hue *is* their meaning, so they are shared
 * outright, and a room that wants a different one replaces it rather than
 * shading it.
 *
 * Everything is specified in OKLCH and converted here, because that is the
 * whole reason this file exists. Equal steps in OKLCH lightness look like equal
 * steps, and a fixed chroma looks about as colourful at one hue as at another —
 * neither of which is true of the hex values it emits. A palette that looks
 * arithmetic in these numbers looks even on screen.
 *
 * Three consequences worth knowing before changing a number:
 *
 *  - **Every room sits on the same ramp. A room is a hue, not a brightness.**
 *    Hearth and Fern used to be raised off it, by 0.045 and 0.065, so that a
 *    warm room would stop looking like mud and a green one like black with a
 *    hint of something. It worked and it cost them their calm, because nothing
 *    rises alone: lighter walls need a lighter `muted` to sit on them and
 *    lighter accents to sit on that, so the whole room came up together and read
 *    as louder than Mono and Tide rather than warmer or cooler than them. Flat
 *    on the ramp they are quiet again, and every contrast test gained margin
 *    rather than losing it, because darker walls can only help text.
 *  - **Chroma is the dial the lift was standing in for, and it is nearly free.**
 *    Moving a room's chroma barely moves any token's luminance — the four rooms
 *    sit within two percent of each other on every structural ratio, edges
 *    against walls and panels against panels alike — so it sets how loudly a
 *    room says its hue without touching how bright it is. A room here is meant
 *    to imply its subject rather than announce it, and how much chroma that
 *    takes depends on the hue, in the opposite direction to the obvious guess.
 *    Blue is the one colour that reads as *just dark*: Tide holds a full 1.0 and
 *    is still a room you would call black before you called it blue. A brown or
 *    a green announces itself at far less, so Hearth and Fern sit at 0.7 to be
 *    as understated as Tide already is. Equal restraint takes unequal numbers.
 *    Mono takes half, because it is the one room that should disappear
 *    altogether. Hearth kept the hue it always had and only ever needed this
 *    dial; Fern was the one room that genuinely wanted a different one, moving
 *    from a leaf green at 155 to a cool pine at 165 that stays green at ink's
 *    lightness where a spring green does not.
 *  - **An accent override replaces the shared accent outright**, hue, lightness
 *    and chroma together. The five accents are otherwise identical in every
 *    room, which is the point of them: their hue is their meaning, and the same
 *    instrument should sound the same in all four rooms.
 *
 * The sRGB values are gamut-clipped by reducing chroma at a fixed lightness and
 * hue, which is what keeps a colour the display cannot show from quietly
 * arriving as a different one.
 */

// A relative, type-only import on purpose: `vite.config.ts` and the icon
// generator both read this module, and neither runs with the app's `@/`
// alias available.
import type { RoomId } from '../domain/types.ts'

/** The tokens a room draws its walls, panels and edges from. */
const SURFACES = [
  ['ink', 0.15, 0.018],
  ['surface', 0.198, 0.024],
  ['raised', 0.24, 0.028],
  ['line', 0.328, 0.038],
] as const satisfies readonly (readonly [string, number, number])[]

/** Secondary, primary and emphatic text, in that order. */
const TEXT = [
  ['muted', 0.63, 0.032],
  ['body', 0.784, 0.028],
  ['bright', 0.962, 0.01],
] as const satisfies readonly (readonly [string, number, number])[]

/**
 * The semantic accents: a deep block, a short block, reflection, rest and a
 * commitment. Hue is the meaning here, so a room inherits these unless it has
 * a reason not to, and adjusts lightness rather than identity when it does.
 *
 * The lightnesses are a floor as much as a look: an accent is text far more
 * often than it is decoration, usually on a chip tinted with itself, so each
 * has to clear AA against its own room. `commit` is the darkest of them and
 * therefore the one that sets the floor.
 */
const ACCENTS = [
  ['deep', 76, 0.8, 0.126],
  ['short', 242, 0.722, 0.098],
  ['reflect', 302, 0.702, 0.104],
  ['rest', 162, 0.722, 0.098],
  ['commit', 24, 0.7, 0.118],
] as const satisfies readonly (readonly [string, number, number, number])[]

type SurfaceName = (typeof SURFACES)[number][0]
type TextName = (typeof TEXT)[number][0]
export type AccentName = (typeof ACCENTS)[number][0]
export type PaletteToken = SurfaceName | TextName | AccentName
export type RoomPalette = Record<PaletteToken, string>

/** Accent names for consumers that apply the same rule to every accent. */
export const ACCENT_TOKENS = Object.freeze(ACCENTS.map(([name]) => name))

/** Every token once, grouped as surfaces, then text, then accents. */
export const PALETTE_TOKENS = [
  ...SURFACES.map(([name]) => name),
  ...TEXT.map(([name]) => name),
  ...ACCENT_TOKENS,
] as const satisfies readonly PaletteToken[]

type AccentOverride = readonly [hue: number, lightness: number, chroma: number]

type RoomSpec = {
  /** The hue every surface token is rotated to. */
  hue: number
  /** How much of the shared chroma curve this room's surfaces take. */
  chroma: number
  /** Mono splits its temperature: cool shadows, faintly warm greys. */
  textHue?: number
  textChroma?: number
  /** Mono's accents are the only colour in the room, so they run stronger. */
  accentChroma?: number
  accents?: Partial<Record<AccentName, AccentOverride>>
}

/**
 * One entry per room. These numbers decide what the app looks like; only Mono's
 * build-time `@theme` declaration mirrors their generated hex values.
 */
export const ROOM_SPECS: Record<RoomId, RoomSpec> = {
  mono: { hue: 278, chroma: 0.5, textHue: 70, textChroma: 0.3, accentChroma: 1.08 },
  // The hue is the one this room always had; what it could not carry was that
  // hue at strength on walls this dark, which is what the lift was hiding. The
  // room should suggest lamplit wood rather than be brown, so it takes less of
  // its hue than Tide takes of blue and reads warm rather than wooden.
  hearth: { hue: 68, chroma: 0.7 },
  tide: { hue: 228, chroma: 1, accents: { deep: [76, 0.815, 0.126] } },
  // Pine shade rather than leaf, and the one room that genuinely wanted a
  // different hue. Past 160 is the cool half of the green, and it survives ink's
  // lightness where a spring green does not. It takes the same restrained share
  // of its hue as Hearth: a green suggested rather than a green stated.
  fern: { hue: 165, chroma: 0.7 },
}

/** sRGB's transfer function. Left of the knee it is linear, including below zero. */
const encode = (channel: number): number =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055

/** OKLCH to gamma-encoded sRGB, which may land outside the display's range. */
const toRgb = (lightness: number, chroma: number, hue: number): [number, number, number] => {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** A hair of tolerance, so a colour sitting exactly on the boundary is inside it. */
const EPSILON = 0.0005

const displayable = (rgb: readonly [number, number, number]): boolean =>
  rgb.every((channel) => channel >= -EPSILON && channel <= 1 + EPSILON)

const hex = (rgb: readonly [number, number, number]): string =>
  `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/**
 * The requested colour, or the most colourful version of it the display can
 * actually show.
 *
 * Chroma is the only thing given up. Clipping the channels instead would move
 * both the lightness and the hue, which is how a palette that was even in
 * OKLCH arrives on screen uneven — the bright end of a ramp drifting toward
 * whichever primary ran out first.
 */
const clipped = (lightness: number, chroma: number, hue: number): string => {
  const wanted = toRgb(lightness, chroma, hue)
  if (displayable(wanted)) return hex(wanted)

  let reachable = 0
  let tooMuch = chroma
  for (let step = 0; step < 40; step += 1) {
    const middle = (reachable + tooMuch) / 2
    if (displayable(toRgb(lightness, middle, hue))) reachable = middle
    else tooMuch = middle
  }
  return hex(toRgb(lightness, reachable, hue))
}

const buildPalette = (spec: RoomSpec): RoomPalette => {
  const textHue = spec.textHue ?? spec.hue
  const textChroma = spec.textChroma ?? spec.chroma
  const tokens: Partial<RoomPalette> = {}

  for (const [name, lightness, chroma] of SURFACES) {
    tokens[name] = clipped(lightness, chroma * spec.chroma, spec.hue)
  }
  for (const [name, lightness, chroma] of TEXT) {
    tokens[name] = clipped(lightness, chroma * textChroma, textHue)
  }
  for (const [name, hue, lightness, chroma] of ACCENTS) {
    const [h, l, c] = spec.accents?.[name] ?? [hue, lightness, chroma]
    tokens[name] = clipped(l, c * (spec.accentChroma ?? 1), h)
  }

  if (!isCompletePalette(tokens)) {
    throw new Error('Palette construction did not produce every semantic token.')
  }
  return tokens
}

const isCompletePalette = (tokens: Partial<RoomPalette>): tokens is RoomPalette =>
  PALETTE_TOKENS.every((token) => typeof tokens[token] === 'string')

/** Every room's semantic tokens, built once at module load. */
export const PALETTES: Record<RoomId, RoomPalette> = Object.fromEntries(
  Object.entries(ROOM_SPECS).map(([id, spec]) => [id, buildPalette(spec)]),
) as Record<RoomId, RoomPalette>

/**
 * The custom property a token is written to.
 *
 * Only `raised` differs: `--color-surface-raised` reads as a variant of
 * `--color-surface` in a stylesheet, while `raised` reads better beside
 * `surface` in TypeScript. The runtime theme writer and the CSS parity test both
 * ask here rather than carrying their own copy of the one exception.
 */
export const cssProperty = (token: PaletteToken): string =>
  `--color-${token === 'raised' ? 'surface-raised' : token}`
