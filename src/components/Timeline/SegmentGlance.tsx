/**
 * The running block or break, drawn as the calendar draws it but laid on its
 * side, as a strip across the mini window.
 *
 * The mini window is there for the stretch when the day is not on screen, and
 * what the calendar gives that a countdown does not is a shape: how long this
 * block is, how much of it has gone, where in it you wrote something or felt
 * the pull to leave. So this is the calendar's block — its tones, label and
 * marks (`styleFor`, `Marks`), never a second copy of them — with the
 * calendar's line for now standing across it, the part behind that line
 * faintly filled, and its clock times at its two ends, outside it, as the
 * calendar's axis puts them outside its blocks.
 *
 * On its side rather than upright, as it first was beneath the cat. Upright, it
 * needed a column of its own and a gutter for its times, and the window became
 * two crowded columns; across the window it is one band among four — timer,
 * strip, the row to write in, the footer — and reads as progress at a glance,
 * left to right.
 *
 * Its marks open on hover as the calendar's do, one log at a time, to read or
 * put right without going back to the tab; the window still holds no list of
 * them. The strip rises above the rest of the window while the pointer is in
 * it, so a card opening over the timer lies on top of it.
 *
 * The marks are spaced in pixels, so the strip measures itself, and measures
 * again when its window is resized. That window is the mini window's own, not
 * the tab this code runs in, which is why it listens on the element's document.
 * A card finds its own room in the window as it opens (`BlockMarks`).
 */

import { useLayoutEffect, useRef, useState } from 'react'

import { Marks, writtenIn } from './BlockMarks'
import { styleFor } from './style'
import { formatClock } from '@/domain/time'
import type { ActiveSegment, Ms, TimelineEntry } from '@/domain/types'

export function SegmentGlance({ now, active }: { now: Ms; active: ActiveSegment }) {
  const strip = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = strip.current
    const view = el?.ownerDocument.defaultView
    if (!el || !view) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    view.addEventListener('resize', measure)
    return () => view.removeEventListener('resize', measure)
  }, [])

  const entry: TimelineEntry = {
    kind: 'active',
    segment: active,
    startsAt: active.startedAt,
    endsAt: active.endsAt,
  }
  const style = styleFor(entry)
  const span = active.endsAt - active.startedAt
  // Past the end is drawn at the end: running over is the timer's to say.
  const progress = span > 0 ? Math.min(1, Math.max(0, (now - active.startedAt) / span)) : 1
  const written = writtenIn(entry)
  const kind = active.kind === 'break' ? 'Break' : `${style.label} block`

  return (
    <div
      role="group"
      aria-label={`${kind} from ${formatClock(active.startedAt)} to ${formatClock(active.endsAt)}`}
      className="flex items-center gap-2"
    >
      <Time at={active.startedAt} />
      <div ref={strip} className="relative isolate h-[22px] min-w-0 flex-1 focus-within:z-30 hover:z-30 [&:has([data-open])]:z-30">
        {/* No label inside: the timer above already names the block, and a
            word here sat under the first marks. */}
        <div
          className={`h-full rounded-md border ring-1 ring-inset ${style.border} ${style.bg} ${style.ring}`}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-bright/8"
          style={{ width: `${progress * 100}%` }}
        />
        {written && width > 0 && (
          <Marks
            written={written}
            span={{ start: active.startedAt, end: active.endsAt }}
            length={width}
            axis="row"
            tone={style.mark ?? 'bg-muted'}
            dim={false}
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-l border-bright/70"
          style={{ left: `${progress * 100}%` }}
        >
          <span className="absolute -top-1 -left-1 size-2 rounded-full bg-bright/80" />
        </div>
      </div>
      <Time at={active.endsAt} />
    </div>
  )
}

/** A clock time at one end of the strip, outside it, as the calendar's axis has them. */
const Time = ({ at }: { at: Ms }) => (
  <span aria-hidden className="tnum shrink-0 text-[10px] whitespace-nowrap text-muted">
    {formatClock(at)}
  </span>
)
