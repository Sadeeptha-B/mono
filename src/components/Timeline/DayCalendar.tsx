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
 *
 * The header's three controls open an editor *inside* this column rather than
 * a dialog over the page. Which one is open is owned by `App`, because the
 * out-of-hours panel on the stage opens the hours editor too — the two are the
 * same affordance reached from different places, and there should only ever be
 * one of it.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { format } from 'date-fns'

import {
  BreakComposer,
  CommitmentComposer,
  HoursComposer,
  type ComposerKind,
} from './SegmentEditor'
import { formatClock, formatDuration } from '@/domain/time'
import type {
  Commitment,
  Interval,
  Ms,
  PlannedBreak,
  Timeline,
  TimelineEntry,
  WorkRegion,
} from '@/domain/types'

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
  /** Today's hours, for the editor. Not the same list as `timeline.regions`. */
  regions: readonly WorkRegion[]
  usingDefaultRegions: boolean
  /** Which editor is expanded under the header, if any. Owned by `App`. */
  composer: ComposerKind | null
  onComposer: (next: ComposerKind | null) => void
  onRemoveBreak: (id: string) => void
  onRemoveCommitment: (id: string) => void
  onAddBreak: (input: Omit<PlannedBreak, 'id'>) => void
  onAddCommitment: (input: Omit<Commitment, 'id'>) => void
  onSetRegions: (regions: WorkRegion[]) => void
}

export function DayCalendar({
  timeline,
  now,
  regions,
  usingDefaultRegions,
  composer,
  onComposer,
  onRemoveBreak,
  onRemoveCommitment,
  onAddBreak,
  onAddCommitment,
  onSetRegions,
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
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Today</h2>
        {/* Toggles, not launchers: the panel they open is right below them and
            stays part of this column, so the pressed state is the whole of the
            feedback. `flex-wrap` because three of these already fill a 22rem
            column at text-xs. */}
        <div className="flex flex-wrap gap-1">
          <HeaderToggle kind="hours" composer={composer} onComposer={onComposer}>
            Hours
          </HeaderToggle>
          <HeaderToggle kind="break" composer={composer} onComposer={onComposer}>
            + Break
          </HeaderToggle>
          <HeaderToggle kind="commitment" composer={composer} onComposer={onComposer}>
            + Commitment
          </HeaderToggle>
        </div>
      </header>

      {/*
        The editors live here rather than in a dialog over the page. Everything
        they ask about — when is this, what does it displace — is drawn directly
        below, and the axis scrolls, so the cost of opening one is a shorter
        view of the day rather than no view of it.
      */}
      {composer === 'hours' && (
        <HoursComposer
          now={now}
          regions={regions}
          usingDefaults={usingDefaultRegions}
          onSave={(next) => {
            // `null` means the draft matched what the day already says. Saving
            // it anyway would override the day with its own current shape and
            // stop it following the recurring default.
            if (next) onSetRegions(next)
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}
      {composer === 'break' && (
        <BreakComposer
          now={now}
          onAdd={(input) => {
            onAddBreak(input)
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}
      {composer === 'commitment' && (
        <CommitmentComposer
          now={now}
          onAdd={(input) => {
            onAddCommitment(input)
            onComposer(null)
          }}
          onCancel={() => onComposer(null)}
        />
      )}

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

/**
 * One of the header controls.
 *
 * Clicking the open one closes it, which is the behaviour a toggle promises and
 * also the only way out that does not involve moving the pointer somewhere
 * else. `aria-expanded` is what tells a screen reader this reveals something
 * rather than navigating away.
 */
function HeaderToggle({
  kind,
  composer,
  onComposer,
  children,
}: {
  kind: ComposerKind
  composer: ComposerKind | null
  onComposer: (next: ComposerKind | null) => void
  children: ReactNode
}) {
  const open = composer === kind

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onComposer(open ? null : kind)}
      className={`rounded-md px-2 py-1 text-xs transition hover:bg-surface-raised hover:text-bright ${
        open ? 'bg-surface-raised text-bright' : 'text-body'
      }`}
    >
      {children}
    </button>
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

    // The commitment's own colour, at half the weight and with a dashed edge:
    // it is unmistakably part of that commitment, and unmistakably not the
    // thing itself.
    case 'commitment-margin':
      return {
        label: entry.side === 'before' ? 'Getting ready' : 'Getting back',
        detail: entry.commitment.title,
        text: 'text-commit/70',
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
    case 'commitment-margin':
      return `commit-${entry.commitment.id}-${entry.side}`
    case 'planned-break':
      return `break-${entry.id}`
    case 'planned-block':
      return entry.id
    case 'margin':
      return `margin-${index}`
  }
}
