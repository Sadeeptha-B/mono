/**
 * A list of working stretches, as wall clock.
 *
 * This replaces the old single "day ends at" time. That setting could only say
 * when the day stopped, so an unstructured evening had to be expressed by
 * pretending the day was longer than it was — and once the clock passed it, it
 * silently fell back to midnight. A list of regions says the same thing
 * precisely, and says the interesting parts too.
 *
 * `label` exists because there are now two of these on screen at once: the
 * recurring shape in settings, and today's own hours on the stage or the
 * calendar. They edit different things, and rows called "Working hours 1 start"
 * in both places are ambiguous to a screen reader and to a test alike.
 */

import { useRef } from 'react'

import { GhostButton, labelClass } from './ui'
import type { DefaultRegion } from '@/domain/types'

/**
 * `fieldClass` with tighter horizontal padding, spelled out rather than
 * appended to it.
 *
 * Tailwind resolves a `px-3.5 px-2.5` collision by stylesheet order, not by the
 * order the classes appear in the string, so overriding one padding utility
 * with another silently does nothing. Two of these plus a "to" and a remove
 * button have to fit in a 22rem column, and the padding is where the room is.
 */
const timeFieldClass =
  'tnum min-w-0 flex-1 rounded-lg border border-line bg-ink px-2 py-2.5 text-bright focus:border-deep focus:outline-none'

type Props = {
  regions: DefaultRegion[]
  onChange: (regions: DefaultRegion[]) => void
  /** Names the fieldset and every row. Must be unique on the page. */
  label?: string
  /**
   * Keep the legend for screen readers but drop it from the page, for callers
   * whose own heading already says the same words directly above it.
   */
  hideLegend?: boolean
}

export function RegionShapeEditor({
  regions,
  onChange,
  label = 'Working hours',
  hideLegend = false,
}: Props) {
  const keys = useRowKeys(regions.length)

  const update = (index: number, patch: Partial<DefaultRegion>) =>
    onChange(regions.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const remove = (index: number) => {
    keys.removeAt(index)
    onChange(regions.filter((_, i) => i !== index))
  }

  const add = () => {
    keys.append()
    // Start the new region after the last one ends, which is almost always
    // what "another stretch later today" means.
    const last = regions.at(-1)
    onChange([...regions, last ? nextAfter(last.end) : { start: '09:00', end: '18:00' }])
  }

  // `min-w-0` on the fieldset is not decoration: a fieldset's default
  // `min-inline-size` is `min-content`, so without it the element refuses to
  // shrink below its widest row and quietly overflows its container. In the
  // calendar's 22rem column that put the remove buttons past the panel edge.
  return (
    <fieldset className="min-w-0">
      <legend className={hideLegend ? 'sr-only' : labelClass}>{label}</legend>

      <div className="space-y-2">
        {regions.length === 0 && (
          <p className="rounded-lg border border-dashed border-line px-3.5 py-3 text-xs leading-relaxed text-muted">
            No working hours. Mono won't plan anything until you add at least one
            stretch.
          </p>
        )}

        {regions.map((region, index) => (
          <div key={keys.at(index)} className="flex items-center gap-2">
            <input
              type="time"
              aria-label={`${label} ${index + 1} start`}
              value={region.start}
              onChange={(e) => update(index, { start: e.target.value })}
              className={timeFieldClass}
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="time"
              aria-label={`${label} ${index + 1} end`}
              value={region.end}
              onChange={(e) => update(index, { end: e.target.value })}
              className={timeFieldClass}
            />
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              className="shrink-0 rounded px-2 py-1 text-muted transition hover:text-commit"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Wraps rather than squeezing: in the calendar's 22rem column the hint
          has nowhere near the room it has in settings, and a line of prose
          crushed into forty pixels is worse than one sitting on its own row. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <GhostButton
          type="button"
          onClick={add}
          className="shrink-0 px-3 py-1.5 text-xs whitespace-nowrap"
        >
          + Add a stretch
        </GhostButton>
        <p className="min-w-40 flex-1 text-xs leading-relaxed text-muted">
          Leave a gap for anything unstructured. Planning resumes after it.
        </p>
      </div>
    </fieldset>
  )
}

/**
 * A stable key per row, so React does not reuse the third row's input for what
 * is now the third row after a deletion.
 *
 * The rows have no id of their own — a `DefaultRegion` is a pair of strings,
 * and giving one an identity would put it in settings and in storage for the
 * sake of a list. So identity is tracked here instead: the removals and
 * additions both go through this component, and any other change to the list
 * (a different day loaded into the editor) is re-keyed by length.
 */
function useRowKeys(count: number) {
  const rows = useRef<number[]>([])
  const next = useRef(0)

  // A cache, corrected during render rather than in an effect: keys have to be
  // right for *this* paint, and an effect would arrive a frame too late.
  while (rows.current.length < count) rows.current.push(next.current++)
  if (rows.current.length > count) rows.current = rows.current.slice(0, count)

  return {
    at: (index: number): string => `row-${rows.current[index] ?? index}`,
    append: () => rows.current.push(next.current++),
    removeAt: (index: number) => {
      rows.current = rows.current.filter((_, i) => i !== index)
    },
  }
}

/** A two-hour stretch beginning where the previous one ended. */
function nextAfter(end: string): DefaultRegion {
  const [h = 0, m = 0] = end.split(':').map(Number)
  const startMinutes = Math.min(h * 60 + m, 22 * 60)
  const endMinutes = Math.min(startMinutes + 120, 23 * 60 + 59)
  return { start: toHHMM(startMinutes), end: toHHMM(endMinutes) }
}

const toHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
