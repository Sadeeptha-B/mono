/**
 * The day, on a time axis.
 *
 * Blocks are positioned against real hours rather than stacked in a list, so a
 * 45-minute block looks like 45 minutes and the gaps are visible as gaps. That
 * is the whole point: it puts the work in the context of the day around it.
 *
 * Geometry is driven entirely by elapsed milliseconds — both the hour rows and
 * the block offsets — which keeps it correct across a DST boundary without any
 * special handling. The axis simply labels each elapsed hour with its wall
 * clock time, which is what a calendar should do on such a day anyway.
 */

import { useEffect, useMemo, useRef } from 'react'
import { format } from 'date-fns'

import { formatClock, formatDuration } from '@/domain/time'
import type { Interval, Ms, Timeline, TimelineEntry } from '@/domain/types'

const HOUR_PX = 96
const HOUR_MS = 3_600_000
/** Below this height a block cannot fit a legible label, so it renders bare. */
const LABEL_MIN_PX = 22
const GUTTER_PX = 52
/** Headroom so the first hour label is not clipped by the scroll container. */
const TOP_PAD_PX = 12

type Props = {
  timeline: Timeline
  now: Ms
  onRemoveBreak: (id: string) => void
  onRemoveCommitment: (id: string) => void
  onAddBreak: () => void
  onAddCommitment: () => void
  onAddRegion: () => void
}

export function DayCalendar({
  timeline,
  now,
  onRemoveBreak,
  onRemoveCommitment,
  onAddBreak,
  onAddCommitment,
  onAddRegion,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const { rangeStart, hours, placed } = useMemo(
    () => layout(timeline, now),
    [timeline, now],
  )

  // Bring the current hour into view once, on mount. Doing this on every tick
  // would yank the view back while the user is scrolling around their day.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const offset = ((now - rangeStart) / HOUR_MS) * HOUR_PX
    el.scrollTop = Math.max(0, offset - el.clientHeight / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nowOffset = TOP_PAD_PX + ((now - rangeStart) / HOUR_MS) * HOUR_PX
  const nowVisible = now >= rangeStart && now <= rangeStart + hours.length * HOUR_MS

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Today</h2>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onAddRegion}
            className="rounded-md px-2 py-1 text-xs text-body transition hover:bg-surface-raised hover:text-bright"
          >
            Hours
          </button>
          <button
            type="button"
            onClick={onAddBreak}
            className="rounded-md px-2 py-1 text-xs text-body transition hover:bg-surface-raised hover:text-bright"
          >
            + Break
          </button>
          <button
            type="button"
            onClick={onAddCommitment}
            className="rounded-md px-2 py-1 text-xs text-body transition hover:bg-surface-raised hover:text-bright"
          >
            + Commitment
          </button>
        </div>
      </header>

      <div ref={scroller} className="mono-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative"
          style={{ height: hours.length * HOUR_PX + TOP_PAD_PX * 2, paddingLeft: GUTTER_PX }}
        >
          {/* The axis: one row per hour, labelled on the left. */}
          {hours.map((hour, index) => (
            <div
              key={hour}
              className="absolute right-0 left-0 border-t border-line/70"
              style={{ top: TOP_PAD_PX + index * HOUR_PX, height: HOUR_PX }}
            >
              <span className="tnum absolute -top-2 left-2 bg-surface pr-1 text-[11px] text-muted">
                {format(hour, 'h a')}
              </span>
              {/* Half-hour tick, to make 20 and 45 minute blocks readable. */}
              <div
                className="absolute right-0 left-0 border-t border-dashed border-line/35"
                style={{ top: HOUR_PX / 2 }}
              />
            </div>
          ))}

          {/*
            Work regions are the canvas the plan is painted on: everything
            outside them is time Mono is not allowed to touch. Drawing them as
            lit bands rather than drawing the gaps as hatching keeps the empty
            parts of the day genuinely empty-looking.
          */}
          {timeline.regions.map((region) => (
            <RegionBand
              key={region.start}
              region={region}
              rangeStart={rangeStart}
            />
          ))}

          {placed.map((item) => (
            <Block
              key={item.key}
              item={item}
              now={now}
              onRemoveBreak={onRemoveBreak}
              onRemoveCommitment={onRemoveCommitment}
            />
          ))}

          {nowVisible && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-20"
              style={{ top: nowOffset }}
              aria-hidden
            >
              <div className="relative border-t border-bright/70">
                <span className="absolute -top-1.5 -left-1 h-2.5 w-2.5 rounded-full bg-bright/80" />
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-line px-4 py-2.5 text-xs text-muted">
        {timeline.regions.length === 0
          ? 'No working hours set for today'
          : `Working until ${formatClock(timeline.horizon)}`}
      </footer>
    </aside>
  )
}

function RegionBand({ region, rangeStart }: { region: Interval; rangeStart: Ms }) {
  const top = TOP_PAD_PX + ((region.start - rangeStart) / HOUR_MS) * HOUR_PX
  const height = ((region.end - region.start) / HOUR_MS) * HOUR_PX

  return (
    <div
      aria-hidden
      className="absolute right-0 rounded-lg border border-line/60 bg-surface-raised/45"
      style={{ top, height, left: GUTTER_PX - 4 }}
    />
  )
}

function Block({
  item,
  now,
  onRemoveBreak,
  onRemoveCommitment,
}: {
  item: Placed
  now: Ms
  onRemoveBreak: (id: string) => void
  onRemoveCommitment: (id: string) => void
}) {
  const { entry, top, height, lane, lanes } = item
  const style = styleFor(entry)
  const isPast = entry.endsAt <= now
  const isActive = entry.kind === 'active'
  const showLabel = height >= LABEL_MIN_PX

  const remove =
    entry.kind === 'planned-break'
      ? () => onRemoveBreak(entry.id)
      : entry.kind === 'commitment'
        ? () => onRemoveCommitment(entry.commitment.id)
        : null

  const width = `calc((100% - ${GUTTER_PX}px) / ${lanes} - 4px)`
  const left = `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${lane} / ${lanes})`

  return (
    <div
      className={[
        'group absolute overflow-hidden rounded-md border px-2 py-1 transition',
        style.border,
        style.bg,
        isPast && !isActive ? 'opacity-40' : '',
        isActive ? 'z-10 ring-1 ring-inset ' + style.ring : '',
      ].join(' ')}
      style={{ top, height: Math.max(height, 4), width, left }}
      title={`${style.label} · ${formatClock(entry.startsAt)} · ${formatDuration(
        entry.endsAt - entry.startsAt,
      )}`}
    >
      {showLabel ? (
        <>
          <div className="flex items-baseline justify-between gap-1.5">
            <span className={`truncate text-xs font-medium ${style.text}`}>
              {style.label}
            </span>
            {remove && !isPast && (
              <button
                type="button"
                onClick={remove}
                aria-label={`Remove ${style.label}`}
                className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100 hover:text-commit focus-visible:opacity-100"
              >
                ×
              </button>
            )}
          </div>
          {height >= 44 && style.detail && (
            <div className="truncate text-[11px] text-muted italic">{style.detail}</div>
          )}
          {height >= 60 && (
            <div className="tnum mt-0.5 text-[11px] text-muted">
              {formatDuration(entry.endsAt - entry.startsAt)}
            </div>
          )}
        </>
      ) : (
        <span className="sr-only">{style.label}</span>
      )}
    </div>
  )
}

type Placed = {
  key: string
  entry: TimelineEntry
  top: number
  height: number
  lane: number
  lanes: number
}

function layout(timeline: Timeline, now: Ms) {
  // Margins are dropped: on a time axis an empty gap already reads as empty,
  // and drawing a box labelled "nothing" only adds noise.
  const entries = timeline.entries.filter((e) => e.kind !== 'margin')

  // Work regions bound the view alongside the entries. Without them a morning
  // region would be positioned above the top of the grid once the day is under
  // way, and its band would render at a negative offset.
  const starts = [...entries.map((e) => e.startsAt), ...timeline.regions.map((r) => r.start)]
  const ends = [...entries.map((e) => e.endsAt), ...timeline.regions.map((r) => r.end)]
  const earliest = Math.min(now, ...(starts.length ? starts : [now]))
  const latest = Math.max(timeline.horizon, now, ...(ends.length ? ends : [now]))

  const rangeStart = floorToHour(earliest)
  const hourCount = Math.max(1, Math.ceil((latest - rangeStart) / HOUR_MS))
  const hours = Array.from({ length: hourCount }, (_, i) => rangeStart + i * HOUR_MS)

  const placed = assignLanes(entries).map(({ entry, lane, lanes }, index) => ({
    key: keyFor(entry, index),
    entry,
    top: TOP_PAD_PX + ((entry.startsAt - rangeStart) / HOUR_MS) * HOUR_PX,
    height: ((entry.endsAt - entry.startsAt) / HOUR_MS) * HOUR_PX,
    lane,
    lanes,
  }))

  return { rangeStart, hours, placed }
}

/**
 * Side-by-side columns for anything that overlaps.
 *
 * The planner guarantees blocks never collide with commitments, but a
 * commitment added *during* a running block legitimately does — that is the
 * case the user resolves by hand. Lanes are counted per overlapping cluster so
 * one collision late in the day does not narrow every block above it.
 */
function assignLanes(entries: readonly TimelineEntry[]) {
  const sorted = [...entries].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)
  const result: { entry: TimelineEntry; lane: number; lanes: number }[] = []

  let cluster: { entry: TimelineEntry; lane: number }[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const lanes = cluster.reduce((max, c) => Math.max(max, c.lane + 1), 1)
    for (const c of cluster) result.push({ ...c, lanes })
    cluster = []
    clusterEnd = -Infinity
  }

  for (const entry of sorted) {
    if (entry.startsAt >= clusterEnd) flush()

    const laneEnds: number[] = []
    for (const c of cluster) {
      laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -Infinity, c.entry.endsAt)
    }
    let lane = laneEnds.findIndex((end) => end <= entry.startsAt)
    if (lane === -1) lane = laneEnds.length

    cluster.push({ entry, lane })
    clusterEnd = Math.max(clusterEnd, entry.endsAt)
  }
  flush()

  return result
}

const floorToHour = (at: Ms): Ms => {
  const d = new Date(at)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

type RowStyle = {
  label: string
  detail?: string
  bg: string
  border: string
  ring: string
  text: string
}

function styleFor(entry: TimelineEntry): RowStyle {
  const block = (kind: string, label: string, detail?: string): RowStyle => {
    const tone =
      kind === 'deep'
        ? { text: 'text-deep', ring: 'ring-deep/50', bg: 'bg-deep/15', border: 'border-deep/40' }
        : kind === 'short'
          ? { text: 'text-short', ring: 'ring-short/50', bg: 'bg-short/15', border: 'border-short/40' }
          : {
              text: 'text-reflect',
              ring: 'ring-reflect/50',
              bg: 'bg-reflect/15',
              border: 'border-reflect/40',
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
          s.outcome === 'abandoned' ? `${kindLabel(s.blockKind)} (cut short)` : kindLabel(s.blockKind),
          s.purpose ?? undefined,
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
      return block(s.blockKind, kindLabel(s.blockKind), s.purpose ?? 'now')
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

const kindLabel = (kind: string): string =>
  kind === 'deep' ? 'Deep' : kind === 'short' ? 'Short' : 'Priorities'

function keyFor(entry: TimelineEntry, index: number): string {
  switch (entry.kind) {
    case 'past':
      return `past-${entry.segment.id}`
    case 'active':
      return `active-${entry.segment.id}`
    case 'commitment':
      return `commit-${entry.commitment.id}`
    case 'planned-break':
      return `break-${entry.id}`
    case 'planned-block':
      return entry.id
    case 'margin':
      return `margin-${index}`
  }
}
