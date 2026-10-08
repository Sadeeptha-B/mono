/**
 * A block's urges and logs, drawn at the minutes they happened: an urge as a
 * dot in the block's own tone, a log as a small bright rounded bar. On the
 * calendar they run down the block's right edge; on the mini window's strip
 * (`SegmentGlance`), along it. `marks.ts` decides exactly where.
 *
 * One column for both. They were first split across the two edges, urges as
 * ticks on the right and logs as dots on the left, which read as damage to
 * the block's border rather than as marks on it. Logs are held apart so each
 * can be pointed at, and neighbours share a mark — drawn as a small stack of
 * bars — where the block is too short to hold them apart; urges sit at their
 * own minutes, under the logs. `marks.ts` says why.
 *
 * Both open a card on hover, the same card. A log is something to read and
 * sometimes to put right, so its bar is a control and its card holds the log's
 * edit and delete — that one log, or the few sharing its mark, not the block's
 * whole log, which on a long block would be a wall of text standing on the
 * day it annotates. The strip draws these same marks, cards and all: what is
 * under the pointer is not the list the mini window declines to hold.
 *
 * Not `Marks.tsx`: beside `marks.ts`, on a filesystem that ignores case, the
 * two would be one import.
 */

import { useMemo, useRef, type CSSProperties } from 'react'

import { drawnWithin, markOffsets, offsetAt, stackRuns } from './marks'
import { LogCard, useLogDrafts, type LogDrafts } from '../BlockLog'
import { cardClass, useOpenCard } from '../hoverCard'
import { formatClock } from '@/domain/time'
import type { BlockLog, Interval, Ms, TimelineEntry } from '@/domain/types'
import { useSession } from '@/store/session'

/** Keeps a mark off the block's rounded corners. */
const MARK_INSET_PX = 3
/** Room enough between two marks that each can be pointed at. See `marks.ts`. */
const MARK_GAP_PX = 10
/** How far in from a block's right edge the column of marks is centred. */
const MARK_CENTRE_PX = 8
/** What a block's own text keeps clear of, on the right, when it carries marks. */
export const MARK_LANE_PX = 18

/** What was written into a block: its id, to correct a log by, and the two lists. */
export type Written = { blockId: string; logs: readonly BlockLog[]; urges: readonly Ms[] }

/**
 * The logs and urges of a block on the axis, running or over, or null when
 * there are none — or when the entry is not a block at all.
 */
export function writtenIn(entry: TimelineEntry): Written | null {
  if ((entry.kind !== 'past' && entry.kind !== 'active') || entry.segment.kind !== 'block') {
    return null
  }
  const { id, logs, urges } = entry.segment
  return logs.length > 0 || urges.length > 0 ? { blockId: id, logs, urges } : null
}

/**
 * What of `written` is drawn when only `shown` of a block spanning `whole` is
 * on the axis — its own day's side of midnight (`drawnWithin`) — or null when
 * none of it is. The block itself still holds everything; only the drawing is
 * cut, as the calendar cuts the block's box.
 */
export function writtenWithin(written: Written, whole: Interval, shown: Interval): Written | null {
  const logs = written.logs.filter((log) => drawnWithin(log.at, whole, shown))
  const urges = written.urges.filter((at) => drawnWithin(at, whole, shown))
  if (logs.length === written.logs.length && urges.length === written.urges.length) {
    return written
  }
  return logs.length > 0 || urges.length > 0 ? { ...written, logs, urges } : null
}

/** "2 logs · 1 urge", leaving out whichever there are none of. */
export function countsOf({ logs, urges }: Written, separator: string): string {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return [
    ...(logs.length > 0 ? [count(logs.length, 'log')] : []),
    ...(urges.length > 0 ? [count(urges.length, 'urge')] : []),
  ].join(separator)
}

/**
 * Which way a block's marks run: down a column on the calendar's block, or
 * along a row on the mini window's strip. Down a column a log's card opens
 * beside its mark, over the block; along a row, above or below it.
 */
export type MarkAxis = 'column' | 'row'

type MarksProps = {
  written: Written
  span: Interval
  /** How long the run of marks is, in pixels: the block's height, or the strip's width. */
  length: number
  axis: MarkAxis
  tone: string
  /** A past block is dimmed, and so are its marks; never their cards. */
  dim: boolean
}

/**
 * A block's urges and logs at the minutes they happened, each opening its
 * card on hover. `length` and `axis` say which surface: the calendar's block,
 * down its height, or the mini window's strip, along its width. `span` is the
 * stretch of time that length draws, which on the calendar is only the day's
 * side of a block cut at midnight; `written` is expected to hold only what
 * falls there (`writtenWithin`).
 *
 * The cards' edits under way are held here, above the marks, by log id
 * (`useLogDrafts`): which mark a log is drawn on changes as neighbours are
 * written or deleted, and an edit must not go with a mark. They are about one
 * session, so the whole of this starts again with the session's `generation`
 * — an import, or the turn of the day — as the stage does: kept, an edit begun
 * before an import could be saved over the imported log that took its id.
 */
export function Marks(props: MarksProps) {
  const generation = useSession((s) => s.generation)
  return <SessionMarks key={generation} {...props} />
}

function SessionMarks({ written, span, length, axis, tone, dim }: MarksProps) {
  const edits = useLogDrafts()
  const inner = Math.max(0, length - MARK_INSET_PX * 2)

  // Grouped when the logs or the room change, not on every tick of the clock.
  const { logs, runs, offsets } = useMemo(() => {
    const logs = [...written.logs].sort((x, y) => x.at - y.at)
    const at = logs.map((log) => log.at)
    const runs = stackRuns(at, span.start, span.end, inner, MARK_GAP_PX)
    const firsts = runs.map((run) => at[run.first]!)
    return { logs, runs, offsets: markOffsets(firsts, span.start, span.end, inner, MARK_GAP_PX) }
  }, [written.logs, span.start, span.end, inner])

  const place = (offset: number) => placeMark(offset + MARK_INSET_PX, length, axis)

  // In three layers, whatever is pointed at: urges, then logs' targets above
  // them, then an open card above both. Where an urge and a log meet, the
  // log is the one a pointer finds — it is the mark with something to do —
  // and opening a card, the urge's included, never changes which that is.
  return (
    <>
      {written.urges.map((at, i) => (
        <UrgeMark
          // Index among the urges, not instant: two can share a millisecond,
          // and the list only ever grows or loses its last.
          key={`urge-${i}`}
          at={at}
          place={place(offsetAt(at, span.start, span.end, inner))}
          tone={tone}
          dim={dim}
        />
      ))}
      {runs.map((run, i) => {
        const members = logs.slice(run.first, run.last + 1)
        return (
          <LogMark
            key={members[0]!.id}
            blockId={written.blockId}
            logs={members}
            edits={edits}
            place={place(offsets[i]!)}
            beside={axis === 'column'}
            dim={dim}
          />
        )
      })}
    </>
  )
}

/** Where one mark goes, and an urge's one-line card. A log's card is placed when it opens. */
type MarkPlace = {
  /** A zero-width line through the mark, which holds it and its card. */
  anchor: { className: string; style: CSSProperties }
  /** The target, centred on the mark. */
  target: { className: string; style: CSSProperties }
  /** An urge's card: one short line, which needs no room worked out for it. */
  tip: { className: string; style: CSSProperties }
}

function placeMark(offset: number, length: number, axis: MarkAxis): MarkPlace {
  if (axis === 'column') {
    return {
      anchor: { className: 'absolute right-0 left-0 h-0', style: { top: offset } },
      target: {
        className: 'absolute top-0 translate-x-1/2 -translate-y-1/2',
        style: { right: MARK_CENTRE_PX },
      },
      // Leftward over the block, its right edge just inside the target.
      tip: { className: '-top-[7px]', style: { right: MARK_CENTRE_PX + 6 } },
    }
  }
  return {
    anchor: { className: 'absolute top-0 bottom-0 w-0', style: { left: offset } },
    target: {
      className: 'absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2',
      style: {},
    },
    // Above the strip, growing inward from whichever end the mark is nearer.
    tip: {
      className: '',
      style: {
        bottom: 'calc(50% + 5px)',
        ...(offset < length / 2 ? { left: -6 } : { right: -6 }),
      },
    },
  }
}

/**
 * One urge's dot, and when it was on hover, in the same card a log opens in.
 *
 * It used the browser's own tooltip at first, which arrives late and looks
 * like nothing else in Mono, beside a log's card that opens at once. The two
 * kinds of mark now answer a pointer the same way. Not a control: there is
 * nothing to do with a past urge — only the last can be taken back, and that
 * is the counter's — so it takes no focus, and the block's own title already
 * carries the count for anything not pointing. Its target stays in the lowest
 * layer even while its card is open, so moving on from it to a log beside it
 * reaches the log.
 */
function UrgeMark({
  at,
  place,
  tone,
  dim,
}: {
  at: Ms
  place: MarkPlace
  tone: string
  dim: boolean
}) {
  return (
    <div aria-hidden className={`group/urge ${place.anchor.className}`} style={place.anchor.style}>
      {/* A target larger than the dot it draws. */}
      <span
        className={`grid h-3.5 w-5 place-items-center ${place.target.className}`}
        style={place.target.style}
      >
        <span className={`size-1.5 rounded-full ${tone} ${dim ? 'opacity-50' : ''}`} />
      </span>
      <span
        className={`absolute z-20 hidden rounded-md border border-muted/70 bg-surface-raised px-2 py-0.5 text-xs whitespace-nowrap shadow-lg group-hover/urge:block ${place.tip.className}`}
        style={place.tip.style}
      >
        <span className="tnum text-muted">{formatClock(at)}</span>{' '}
        <span className="text-body">Urge</span>
      </span>
    </div>
  )
}

/**
 * One log's bar, and the log itself on hover or focus, to read in full and
 * to edit or delete — or, where neighbours share the mark, a small stack of
 * bars and each of them in turn, oldest first.
 *
 * The card touches the bar, so the pointer can travel from one into the other
 * without crossing a gap that would close it. It stays open while any log in
 * it is being edited, whatever the pointer does — a field that vanished
 * because the hand drifted off it would lose the edit — and says so with
 * `data-open`, which raises its block above its neighbours. Hover rather than
 * a click is deliberate: Mono is used at a desk, and reading a log should
 * cost no more than pointing at it.
 *
 * Where the card goes is worked out as it opens and kept up while it is open
 * (`useOpenCard`, Mono's own hover card).
 */
function LogMark({
  blockId,
  logs,
  edits,
  place,
  beside,
  dim,
}: {
  blockId: string
  /** Oldest first; never empty. */
  logs: readonly BlockLog[]
  edits: LogDrafts
  place: MarkPlace
  beside: boolean
  dim: boolean
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const target = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const editing = logs.some((log) => edits.drafts.has(log.id))
  const opening = useOpenCard(anchor, target, card, { beside, size: CARD_SIZE, held: editing })
  const first = formatClock(logs[0]!.at)
  const last = formatClock(logs.at(-1)!.at)
  const stacked = logs.length > 1

  return (
    <div
      ref={anchor}
      className={`group/log ${place.anchor.className}`}
      style={place.anchor.style}
      {...opening}
    >
      {/* A target larger than the bar it draws, a layer above any urge's. */}
      <button
        ref={target}
        type="button"
        aria-label={stacked ? `${logs.length} logs, ${first} to ${last}` : `Log at ${first}`}
        className={`z-10 grid h-3.5 w-5 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-bright ${place.target.className}`}
        style={place.target.style}
      >
        <span className={`relative h-1.5 w-2.5 ${dim ? 'opacity-60' : ''}`}>
          {/* A second bar behind the first, down and to one side, so a stack
              at the very top of a block stays inside it: more than one log
              here. The count is in the card and the name, since a number
              would not fit between marks held a pointer's width apart. */}
          {stacked && (
            <span className="absolute top-[2px] -left-[2px] h-1.5 w-2.5 rounded-full bg-bright/55" />
          )}
          <span className="absolute inset-0 rounded-full bg-bright" />
        </span>
      </button>
      <div
        ref={card}
        {...(editing ? { 'data-open': '' } : {})}
        className={[
          cardClass,
          editing ? 'block' : 'hidden group-focus-within/log:block group-hover/log:block',
        ].join(' ')}
      >
        <LogCard blockId={blockId} logs={logs} edits={edits} />
      </div>
    </div>
  )
}

/** How wide a log's card is, and how tall before it scrolls, where there is room. */
const CARD_SIZE = { width: 224, height: 288 }
