/**
 * Everything the ambient room can truthfully say about today.
 *
 * Like the plan and the existing vitals, this is a pure projection of the
 * append-only history. The only provisional input is a block whose timer has
 * landed on the completion prompt but has deliberately not been banked yet.
 */

import { completeBlock } from './events'
import { onSameDay } from './time'
import { isBankedFocus, vitalsFor } from './vitals'
import type { ActiveSegment, CompletedSegment, Ms } from './types'

export type TrailKind = 'deep' | 'short' | 'reflect' | 'break' | 'gap' | 'aggregate'
export type TrailEntry = { kind: TrailKind; count?: number }
export type DayMilestone = 'recovery' | 'return' | 'ninety' | 'three' | 'first-deep' | 'first'

export type DayProgress = {
  blocks: number
  deepBlocks: number
  shortBlocks: number
  focusMinutes: number
  breaks: number
  breakMinutes: number
  sceneTier: 0 | 1 | 2 | 3
  trail: TrailEntry[]
  milestone: DayMilestone | null
  longestBlock: { purpose: string; minutes: number } | null
}

export const dayProgressLabel = ({
  blocks,
  focusMinutes,
}: Pick<DayProgress, 'blocks' | 'focusMinutes'>): string =>
  `${blocks} focus block${blocks === 1 ? '' : 's'} and ${focusMinutes} focus minute${focusMinutes === 1 ? '' : 's'} today`

const today = (history: readonly CompletedSegment[], now: Ms): CompletedSegment[] =>
  history.filter((segment) => onSameDay(segment.startedAt, now))

export function dayProgressFor(
  history: readonly CompletedSegment[],
  now: Ms,
  pending: ActiveSegment | null = null,
): DayProgress {
  const before = today(history, now)
  const landed = pending?.kind === 'block'
    ? completeBlock(pending, pending.endsAt, 'completed')
    : null
  const segments = landed && onSameDay(landed.startedAt, now) ? [...before, landed] : before

  let deepBlocks = 0
  let shortBlocks = 0
  let focusMs = 0
  let breaks = 0
  let breakMs = 0
  let longestBlock: DayProgress['longestBlock'] = null
  let longestMs = -1
  const rawTrail: TrailEntry[] = []

  for (const segment of segments) {
    if (segment.kind === 'away') {
      rawTrail.push({ kind: 'gap' })
      continue
    }
    if (segment.kind === 'break') {
      breaks += 1
      breakMs += Math.max(0, segment.endedAt - segment.startedAt)
      rawTrail.push({ kind: 'break' })
      continue
    }
    if (segment.outcome !== 'completed') {
      rawTrail.push({ kind: 'gap' })
      continue
    }
    if (segment.blockKind === 'reflect') {
      rawTrail.push({ kind: 'reflect' })
      continue
    }

    const duration = Math.max(0, segment.endedAt - segment.startedAt)
    focusMs += duration
    if (segment.blockKind === 'deep') deepBlocks += 1
    else shortBlocks += 1
    rawTrail.push({ kind: segment.blockKind })

    const purpose = segment.purpose?.trim()
    if (purpose && duration > longestMs) {
      longestMs = duration
      longestBlock = { purpose, minutes: Math.floor(duration / 60_000) }
    }
  }

  const blocks = deepBlocks + shortBlocks
  const sceneTier: DayProgress['sceneTier'] = blocks >= 6 ? 3 : blocks >= 3 ? 2 : blocks >= 1 ? 1 : 0
  const trail: TrailEntry[] = rawTrail.length <= 32
    ? rawTrail
    : [{ kind: 'aggregate' as const, count: rawTrail.length - 31 }, ...rawTrail.slice(-31)]

  return {
    blocks,
    deepBlocks,
    shortBlocks,
    focusMinutes: Math.floor(focusMs / 60_000),
    breaks,
    breakMinutes: Math.floor(breakMs / 60_000),
    sceneTier,
    trail,
    milestone: landed && isBankedFocus(landed) ? milestoneFor(before, landed, now) : null,
    longestBlock,
  }
}

function milestoneFor(
  before: readonly CompletedSegment[],
  landed: CompletedSegment,
  now: Ms,
): DayMilestone | null {
  const shown = transitionMilestonesShown(before, now)
  return selectMilestone(before, landed, now, shown)
}

type TransitionMilestone = Extract<DayMilestone, 'recovery' | 'return'>

function selectMilestone(
  before: readonly CompletedSegment[],
  landed: CompletedSegment,
  now: Ms,
  shown: ReadonlySet<TransitionMilestone>,
): DayMilestone | null {
  // Thresholds and firsts can only be said on one completion. They come before
  // the repeatable transition facts so a break immediately before 90 minutes
  // cannot make the day's only 90-minute crossing disappear forever.
  const beforeVitals = vitalsFor(before, now)
  const afterVitals = vitalsFor([...before, landed], now)
  if (beforeVitals.focusMinutesToday < 90 && afterVitals.focusMinutesToday >= 90) return 'ninety'
  if (beforeVitals.streak < 3 && afterVitals.streak >= 3) return 'three'
  if (
    landed.kind === 'block' &&
    landed.blockKind === 'deep' &&
    !before.some((segment) => isBankedFocus(segment) && segment.kind === 'block' && segment.blockKind === 'deep')
  ) return 'first-deep'
  if (!before.some(isBankedFocus)) return 'first'

  const previousConsequential = [...before].reverse().find(
    (segment) =>
      segment.kind !== 'break' &&
      !(segment.kind === 'block' && segment.blockKind === 'reflect'),
  )
  if (
    !shown.has('recovery') &&
    previousConsequential?.kind === 'block' &&
    previousConsequential.outcome === 'abandoned'
  ) {
    return 'recovery'
  }
  if (!shown.has('return') && before.at(-1)?.kind === 'break') return 'return'
  return null
}

/**
 * Reconstruct which repeatable seam remarks would already have been shown.
 *
 * `segments` is the already-filtered current day, never the permanent log. The
 * replay calls the vitals fold for each banked block and is consequently O(n²),
 * which is deliberate at one day's scale and belongs behind App's day memo.
 *
 * With no milestone events, a block banked through away reconciliation is
 * indistinguishable here from one completed through the live prompt. It can
 * therefore consume a recovery/return remark the user did not see; that is the
 * accepted cost of keeping milestones derived rather than persisted.
 */
function transitionMilestonesShown(
  segments: readonly CompletedSegment[],
  now: Ms,
): ReadonlySet<TransitionMilestone> {
  const shown = new Set<TransitionMilestone>()
  const before: CompletedSegment[] = []
  for (const segment of segments) {
    if (isBankedFocus(segment)) {
      const milestone = selectMilestone(before, segment, now, shown)
      if (milestone === 'recovery' || milestone === 'return') shown.add(milestone)
    }
    before.push(segment)
  }
  return shown
}

export const MILESTONE_REMARKS: Record<DayMilestone, string> = {
  recovery: 'Back on the trail.',
  return: 'Rest did its job.',
  ninety: '90 minutes banked.',
  three: '3 in a row.',
  'first-deep': 'First deep block.',
  first: 'First one today.',
}
