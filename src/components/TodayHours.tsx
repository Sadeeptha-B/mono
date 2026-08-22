/**
 * Today's hours, as a form.
 *
 * Three surfaces edit the same thing now — the question the day opens with, the
 * calendar's Hours composer, and the escape hatch on the out-of-hours panel —
 * so the drafting, the resolve back into epoch milliseconds, and the warning
 * about stretches that cannot survive it live here rather than in three places
 * that would slowly disagree.
 *
 * Times are authored as wall clock and only become milliseconds at save, which
 * is what keeps the domain on the right side of that boundary: it never sees an
 * "HH:mm" and never has to work out what day it is.
 */

import { useState } from 'react'
import { format } from 'date-fns'

import { RegionShapeEditor } from './RegionShapeEditor'
import { wallClockOn } from '@/domain/time'
import type { DefaultRegion, Ms, WorkRegion } from '@/domain/types'

/**
 * The label every editor of *today's* hours uses.
 *
 * Settings edits the recurring shape and keeps the default label. Both can be
 * on screen at once now, and two fieldsets of identically named rows are
 * ambiguous to a screen reader long before they are ambiguous to a test.
 */
export const TODAY_HOURS_LABEL = "Today's hours"

/** What the domain takes back: absolute instants, no id yet. */
export type ResolvedRegion = { startsAt: Ms; endsAt: Ms }

/** Seed a draft from the day's regions. */
export const toWallClock = (region: WorkRegion): DefaultRegion => ({
  start: format(region.startsAt, 'HH:mm'),
  end: format(region.endsAt, 'HH:mm'),
})

/**
 * The draft as instants, dropping anything that cannot become one.
 *
 * A stretch has to end after it starts, and `wallClockOn` refuses a time that
 * would run past midnight — the plan is scoped to one calendar day. Both are
 * silent here and reported by the caller, which knows where to put the line.
 */
export function resolveHours(now: Ms, draft: readonly DefaultRegion[]): ResolvedRegion[] {
  return draft
    .map((r) => ({ startsAt: wallClockOn(now, r.start), endsAt: wallClockOn(now, r.end) }))
    .filter(
      (r): r is ResolvedRegion =>
        r.startsAt !== null && r.endsAt !== null && r.endsAt > r.startsAt,
    )
}

/**
 * Ids from position, the same rule the planner follows for its own entries:
 * saving the same shape twice has to produce the same list, or React keys move
 * under a component that has not changed.
 */
export const withIds = (regions: readonly ResolvedRegion[]): WorkRegion[] =>
  regions.map((r, i) => ({ ...r, id: `today-${i}-${r.startsAt}` }))

/** True when the draft says something different from the day's current shape. */
export const hoursChanged = (
  draft: readonly DefaultRegion[],
  regions: readonly WorkRegion[],
): boolean => {
  const current = regions.map(toWallClock)
  if (current.length !== draft.length) return true
  return draft.some((r, i) => r.start !== current[i]?.start || r.end !== current[i]?.end)
}

/**
 * What to write for today, or `null` when the draft says nothing new.
 *
 * Every surface that saves hours goes through here, and the null case is the
 * point of it. Writing an untouched draft back looks harmless — the regions are
 * identical — but it stamps a per-day override, and today's regions are meant to
 * stay *derived* from the recurring shape. A day that has been silently
 * detached from the default stops following it: change 09:00–18:00 to
 * 09:00–20:00 in settings and today would keep the old shape, having been
 * "customised" by a user who opened the editor, changed nothing, and saved.
 */
export function hoursToSave(
  now: Ms,
  draft: readonly DefaultRegion[],
  regions: readonly WorkRegion[],
): WorkRegion[] | null {
  return hoursChanged(draft, regions) ? withIds(resolveHours(now, draft)) : null
}

/**
 * A draft of today's hours that follows the day until the user edits it.
 *
 * The obvious implementation — seed a copy at mount and hold it — is wrong in a
 * way that took three goes to see. The seed is a photograph of the day's shape
 * at one instant, and the day's shape can change underneath it: the recurring
 * default is edited in settings, a file is imported, midnight arrives. The
 * editor then shows something the day no longer says, and worse, saving it
 * writes that stale shape back as an override.
 *
 * So an untouched draft is not stored at all. `null` means "whatever the day
 * currently says", which is re-read on every render and therefore cannot go
 * stale. Only once the user actually types does the draft become theirs, and
 * from that point it is theirs to keep — including across a settings change,
 * because clearing what someone is in the middle of typing is its own bug.
 *
 * A draft that *has* been typed into is cleared by the session generation,
 * which remounts this hook. That is the other half of the rule, and it lives in
 * `App`.
 */
export function useHoursDraft(regions: readonly WorkRegion[]): {
  draft: DefaultRegion[]
  onDraft: (regions: DefaultRegion[]) => void
} {
  const [edited, setEdited] = useState<DefaultRegion[] | null>(null)
  return { draft: edited ?? regions.map(toWallClock), onDraft: setEdited }
}

export function TodayHoursFields({
  draft,
  onDraft,
  now,
  hideLegend = false,
}: {
  draft: DefaultRegion[]
  onDraft: (regions: DefaultRegion[]) => void
  now: Ms
  /** For callers whose own heading already reads "Today's hours". */
  hideLegend?: boolean
}) {
  const dropped = draft.length - resolveHours(now, draft).length

  return (
    <>
      <RegionShapeEditor
        regions={draft}
        onChange={onDraft}
        label={TODAY_HOURS_LABEL}
        hideLegend={hideLegend}
      />
      {dropped > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-commit">
          {dropped} stretch{dropped === 1 ? '' : 'es'} will be dropped — a stretch has to
          end after it starts, and cannot run past midnight.
        </p>
      )}
    </>
  )
}
