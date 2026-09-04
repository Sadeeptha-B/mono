/**
 * Mono's four coordinated focus rooms.
 *
 * This is the single non-CSS source for room identity: settings labels, the
 * browser chrome, picture-in-picture's first paint, suggested sound and scene
 * selection all read it. The CSS declarations mirror these palettes because
 * Tailwind utilities need real custom properties in a stylesheet.
 *
 * Adding a room touches five files, and the order matters less than the fact
 * that missing one of them fails quietly rather than loudly:
 *
 *  1. `domain/types.ts` — widen the `RoomId` union.
 *  2. Here — the label, description, swatch, full palette and suggested sound.
 *  3. `store/schema.ts` — the id list in `sanitiseSettingsPatch`. This is the
 *     one that bites: an unlisted room makes an imported settings event look
 *     malformed, so the whole patch is dropped and the user silently lands back
 *     on Mono with no error anywhere.
 *  4. `index.css` — all twelve tokens under the new `data-room` selector. A
 *     test parses this file and requires it to equal the palette above.
 *  5. `ambient/scene.ts` — the room's own scenery at tiers 1, 2 and 3.
 *
 * Then run `npm run companion` and look at it. Palette contrast, occlusion and
 * whether an earned tier reads as *earned* are not things a test can see.
 *
 * Do not tint the cat to make a room feel more distinct. Its fur, shade, eyes
 * and paper are fixed across every room; only the semantic accent follows. A
 * room is the surfaces, the accent and the scenery — a recoloured animal would
 * read as four cats rather than one cat in four rooms.
 */

import type { RoomId } from '@/domain/types'

export type AmbienceKind = 'brown' | 'pink' | 'rain'

export type RoomPalette = {
  ink: string
  surface: string
  raised: string
  line: string
  muted: string
  body: string
  bright: string
  deep: string
  short: string
  reflect: string
  rest: string
  commit: string
}

export type Room = {
  id: RoomId
  label: string
  detail: string
  /** A distinct quick-menu swatch; drawn from this room's own palette. */
  indicator: string
  suggestedAmbience: AmbienceKind
  palette: RoomPalette
}

export const ROOMS: Record<RoomId, Room> = {
  mono: {
    id: 'mono',
    label: 'Mono',
    detail: 'Near-black, quiet and familiar.',
    indicator: '#a8a8bb',
    suggestedAmbience: 'brown',
    palette: {
      ink: '#08080b', surface: '#101016', raised: '#17171f', line: '#24242e',
      muted: '#6e6e80', body: '#a8a8bb', bright: '#f0f0f5', deep: '#e8a33d',
      short: '#7fa8d9', reflect: '#b088d9', rest: '#5cae8f', commit: '#d96a6a',
    },
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    detail: 'Warm charcoal and lamplight.',
    indicator: '#ed9b3b',
    suggestedAmbience: 'pink',
    palette: {
      ink: '#0d0908', surface: '#15100e', raised: '#1e1613', line: '#34251f',
      muted: '#8b7062', body: '#bfa797', bright: '#fff2e8', deep: '#ed9b3b',
      short: '#7f9fc2', reflect: '#b884c6', rest: '#70a87c', commit: '#d86f5f',
    },
  },
  tide: {
    id: 'tide',
    label: 'Tide',
    detail: 'Blue-black, cool and rain-lit.',
    indicator: '#61b6d4',
    suggestedAmbience: 'rain',
    palette: {
      ink: '#061014', surface: '#0b171c', raised: '#102229', line: '#1d3942',
      muted: '#67838c', body: '#a4bdc4', bright: '#eaf7f8', deep: '#f0b65a',
      short: '#61b6d4', reflect: '#aa8ddd', rest: '#63bd99', commit: '#df7878',
    },
  },
  moss: {
    id: 'moss',
    label: 'Moss',
    detail: 'Deep green with a softer edge.',
    indicator: '#6eae78',
    suggestedAmbience: 'brown',
    palette: {
      ink: '#090d09', surface: '#101610', raised: '#182018', line: '#293429',
      muted: '#708171', body: '#a9b8a8', bright: '#eff5ec', deep: '#d9a84e',
      short: '#7aa7b8', reflect: '#aa8ac0', rest: '#6eae78', commit: '#d2736c',
    },
  },
}

export const ROOM_IDS = Object.keys(ROOMS) as RoomId[]

export const ambienceLabel = (kind: AmbienceKind): string =>
  kind === 'brown' ? 'Brown noise' : kind === 'pink' ? 'Pink noise' : 'Rain'
