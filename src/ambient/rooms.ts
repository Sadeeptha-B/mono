/**
 * Mono's four coordinated focus rooms: what each one is called, which sound it
 * suggests and which of its own colours the menu shows as its swatch.
 *
 * Colour itself is next door in `palette.ts`. This file names rooms; that one
 * decides what they look like, and `applyRoomTheme` exposes its tokens as CSS
 * properties.
 *
 * Adding a room touches four exhaustive declarations:
 *
 *  1. `domain/types.ts` — add the id to `ROOM_IDS`. That tuple is the union
 *     and the menu order. The persisted-settings check reads the same tuple.
 *  2. `palette.ts` — the room's hue and how much of the shared chroma curve it
 *     takes.
 *  3. Here — the label, description, suggested sound and swatch token.
 *  4. `ambient/scene.ts` — the room's own scenery at tiers 1, 2 and 3.
 *
 * Then run `npm run companion` and look at it. Palette contrast, occlusion and
 * whether an earned tier reads as *earned* are not things a test can see.
 *
 * Do not tint the cat to make a room feel more distinct. Its fur, shade, eyes
 * and paper are fixed across every room; only the semantic accent follows. A
 * room is the surfaces, the accent and the scenery — a recoloured animal would
 * read as four cats rather than one cat in four rooms.
 */

// The extension is load-bearing: the companion contact sheet imports this
// module under plain Node, which does not resolve extensionless specifiers.
import { PALETTES, type RoomPalette } from './palette.ts'
import type { RoomId } from '../domain/types.ts'

export type AmbienceKind = 'brown' | 'pink' | 'rain'

export type Room = {
  id: RoomId
  label: string
  detail: string
  /** Which of this room's own tokens the quick-menu swatch shows. */
  indicator: keyof RoomPalette
  suggestedAmbience: AmbienceKind
  palette: RoomPalette
}

export const ROOMS: Record<RoomId, Room> = {
  mono: {
    id: 'mono',
    label: 'Mono',
    detail: 'Graphite near-black, quiet and familiar.',
    indicator: 'body',
    suggestedAmbience: 'brown',
    palette: PALETTES.mono,
  },
  hearth: {
    id: 'hearth',
    label: 'Hearth',
    detail: 'Wood-black, cosy and lamplit.',
    indicator: 'deep',
    suggestedAmbience: 'pink',
    palette: PALETTES.hearth,
  },
  tide: {
    id: 'tide',
    label: 'Tide',
    detail: 'Blue-black, cool and rain-lit.',
    indicator: 'short',
    suggestedAmbience: 'rain',
    palette: PALETTES.tide,
  },
  fern: {
    id: 'fern',
    label: 'Fern',
    detail: 'Pine-black, cool and still.',
    indicator: 'rest',
    suggestedAmbience: 'brown',
    palette: PALETTES.fern,
  },
}

export const ambienceLabel = (kind: AmbienceKind): string =>
  kind === 'brown' ? 'Brown noise' : kind === 'pink' ? 'Pink noise' : 'Rain'
