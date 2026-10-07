/**
 * How each kind of entry on the day is drawn: its label, its one line of
 * detail, and its tones.
 *
 * Its own module because two surfaces draw the same entry — the calendar's
 * block and the mini window's strip (`SegmentGlance`) — and a block that was
 * deep blue in one and something else in the other would be two blocks.
 * Class names only, no markup.
 */

import type { TimelineEntry } from '@/domain/types'

export type RowStyle = {
  label: string
  detail?: string
  bg: string
  border: string
  ring: string
  text: string
  /** The block's own tone at full strength, for the urges drawn on its edge. */
  mark?: string
}

export function styleFor(entry: TimelineEntry): RowStyle {
  const block = (kind: string, label: string, detail?: string): RowStyle => {
    const tone =
      kind === 'deep'
        ? {
            text: 'text-deep',
            ring: 'ring-deep/50',
            bg: 'bg-deep/15',
            border: 'border-deep/40',
            mark: 'bg-deep',
          }
        : kind === 'short'
          ? {
              text: 'text-short',
              ring: 'ring-short/50',
              bg: 'bg-short/15',
              border: 'border-short/40',
              mark: 'bg-short',
            }
          : {
              text: 'text-reflect',
              ring: 'ring-reflect/50',
              bg: 'bg-reflect/15',
              border: 'border-reflect/40',
              mark: 'bg-reflect',
            }
    return { label, ...(detail === undefined ? {} : { detail }), ...tone }
  }

  const rest: Omit<RowStyle, 'label' | 'detail'> = {
    text: 'text-rest',
    ring: 'ring-rest/50',
    bg: 'bg-rest/15',
    border: 'border-rest/40',
  }

  switch (entry.kind) {
    case 'past': {
      const s = entry.segment
      if (s.kind === 'block') {
        return block(
          s.blockKind,
          s.result === 'abandoned' ? `${kindLabel(s.blockKind)} (cut short)` : kindLabel(s.blockKind),
          purposeLine(s.purpose) ?? undefined,
        )
      }
      if (s.kind === 'break') return { label: 'Break', ...rest }
      return {
        label: 'Away',
        detail: 'unaccounted',
        text: 'text-muted',
        ring: 'ring-line',
        bg: 'bg-transparent',
        border: 'border-line border-dashed',
      }
    }

    case 'active': {
      const s = entry.segment
      if (s.kind === 'break') return { label: 'Break', detail: 'now', ...rest }
      return block(s.blockKind, kindLabel(s.blockKind), purposeLine(s.purpose) ?? 'now')
    }

    case 'planned-block':
      return block(entry.blockKind, kindLabel(entry.blockKind))

    case 'planned-break':
      return { label: 'Break', detail: 'planned', ...rest }

    case 'commitment':
      return {
        label: entry.commitment.title,
        detail: 'commitment',
        text: 'text-commit',
        ring: 'ring-commit/50',
        bg: 'bg-commit/15',
        border: 'border-commit/40',
      }

    // The commitment's own colour, at half the weight and with a dashed edge:
    // it is unmistakably part of that commitment, and unmistakably not the
    // thing itself.
    case 'commitment-margin':
      return {
        label: entry.side === 'before' ? 'Getting ready' : 'Getting back',
        detail: entry.commitment.title,
        text: 'text-commit/85',
        ring: 'ring-commit/30',
        bg: 'bg-commit/5',
        border: 'border-commit/30 border-dashed',
      }

    case 'margin':
      return {
        label: 'Unfocused',
        text: 'text-muted',
        ring: 'ring-line',
        bg: 'bg-transparent',
        border: 'border-line border-dashed',
      }
  }
}

/** A block's purpose as the stage and the pop-out name it, or null for none. */
const purposeLine = (purpose: string | null): string | null =>
  purpose === null ? null : `Purpose: ${purpose}`

const kindLabel = (kind: string): string =>
  kind === 'deep' ? 'Deep' : kind === 'short' ? 'Short' : 'Priorities'
