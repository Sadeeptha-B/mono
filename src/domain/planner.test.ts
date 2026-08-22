import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import {
  bestFill,
  breakCost,
  countPlannedFocus,
  derivePlan,
  mergeIntervals,
  subtractIntervals,
  type DerivePlanInput,
} from './planner'
import {
  DEFAULT_SETTINGS,
  minutesToMs,
  type Commitment,
  type Ms,
  type PlannedBreak,
  type Settings,
  type Timeline,
  type TimelineEntry,
  type WorkRegion,
} from './types'

/**
 * A fixed local day well clear of any DST transition, so these tests describe
 * the planner rather than the machine's timezone.
 */
const BASE_DAY = new Date(2026, 7, 20)

/** Local wall-clock time on the base day, as epoch ms. */
function at(hour: number, minute = 0): Ms {
  const d = new Date(BASE_DAY)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** A work region on the base day, as the planner receives them. */
const region = (fromHour: number, toHour: number, id = `r-${fromHour}`): WorkRegion => ({
  id,
  startsAt: at(fromHour),
  endsAt: at(toHour),
})

function input(overrides: Partial<DerivePlanInput> = {}): DerivePlanInput {
  return {
    now: at(14),
    settings: DEFAULT_SETTINGS,
    // A single 9-6 working day, matching the default shape.
    regions: [region(9, 18)],
    commitments: [],
    history: [],
    active: null,
    overrides: [],
    ...overrides,
  }
}

const commitment = (
  id: string,
  startsAt: Ms,
  durationMin: number,
  title = id,
): Commitment => ({ id, title, startsAt, durationMin })

const commitmentMargins = (t: Timeline) =>
  t.entries.filter((e) => e.kind === 'commitment-margin')

const plannedBlocks = (t: Timeline) =>
  t.entries.filter((e) => e.kind === 'planned-block')

const margins = (t: Timeline) => t.entries.filter((e) => e.kind === 'margin')

const durationMin = (e: TimelineEntry) => (e.endsAt - e.startsAt) / 60_000

describe('bestFill', () => {
  const deep = minutesToMs(45)
  const short = minutesToMs(20)

  it('matches the worked example from the requirements: 50 min is one block and 5 min dead', () => {
    const fill = bestFill(minutesToMs(50), deep, short, 'prefer-deep')
    expect(fill).toMatchObject({ deepCount: 1, shortCount: 0 })
    expect(minutesToMs(50) - fill.focusMs).toBe(minutesToMs(5))
  })

  it('prefer-deep keeps the hour whole rather than shredding it into short blocks', () => {
    expect(bestFill(minutesToMs(60), deep, short, 'prefer-deep')).toMatchObject({
      deepCount: 1,
      shortCount: 0,
    })
  })

  it('maximise-focus fills the same hour completely, at the cost of depth', () => {
    expect(bestFill(minutesToMs(60), deep, short, 'maximise-focus')).toMatchObject({
      deepCount: 0,
      shortCount: 3,
    })
  })

  it('fills the remainder after deep blocks with short ones', () => {
    // 120 min => 2 deep (90) + 1 short (20), 10 min dead.
    expect(bestFill(minutesToMs(120), deep, short, 'prefer-deep')).toMatchObject({
      deepCount: 2,
      shortCount: 1,
    })
  })

  it('plans nothing when the stretch is shorter than the shortest block', () => {
    expect(bestFill(minutesToMs(19), deep, short, 'prefer-deep')).toMatchObject({
      deepCount: 0,
      shortCount: 0,
    })
  })

  it.each([
    ['zero-length', 0, 0],
    ['negative', -minutesToMs(30), 0],
  ])('returns an empty fill for a %s stretch', (_label, available, expected) => {
    expect(bestFill(available, deep, short, 'prefer-deep').focusMs).toBe(expected)
  })

  it('does not hang or divide by zero on nonsensical block durations', () => {
    expect(bestFill(minutesToMs(60), 0, 0, 'prefer-deep')).toMatchObject({
      deepCount: 0,
      shortCount: 0,
      focusMs: 0,
    })
    expect(bestFill(minutesToMs(60), 0, short, 'prefer-deep').shortCount).toBe(3)
  })
})

describe('interval helpers', () => {
  it('coalesces overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 20, end: 30 },
        { start: 15, end: 18 },
        { start: 50, end: 60 },
      ]),
    ).toEqual([
      { start: 10, end: 30 },
      { start: 50, end: 60 },
    ])
  })

  it('drops empty intervals', () => {
    expect(mergeIntervals([{ start: 10, end: 10 }])).toEqual([])
  })

  it('subtracts busy intervals from a span', () => {
    expect(
      subtractIntervals({ start: 0, end: 100 }, [
        { start: 20, end: 30 },
        { start: 60, end: 70 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 60 },
      { start: 70, end: 100 },
    ])
  })

  it('returns nothing when the span is fully covered', () => {
    expect(subtractIntervals({ start: 0, end: 100 }, [{ start: 0, end: 100 }])).toEqual([])
  })

  it('ignores busy intervals outside the span', () => {
    expect(
      subtractIntervals({ start: 50, end: 100 }, [
        { start: 0, end: 10 },
        { start: 200, end: 300 },
      ]),
    ).toEqual([{ start: 50, end: 100 }])
  })
})

describe('derivePlan', () => {
  it('fills the runway to a single commitment', () => {
    // 2pm now, standup at 5pm => 180 min => 4 deep blocks exactly, no margin.
    const plan = derivePlan(
      input({ commitments: [commitment('standup', at(17), 15)] }),
    )

    const runway = plannedBlocks(plan).filter((b) => b.endsAt <= at(17))
    expect(runway).toHaveLength(4)
    expect(runway.every((b) => b.blockKind === 'deep')).toBe(true)
    expect(runway[0]?.startsAt).toBe(at(14))
    expect(runway.at(-1)?.endsAt).toBe(at(17))
    expect(margins(plan).filter((m) => m.endsAt <= at(17))).toHaveLength(0)
  })

  it('plans the free time on both sides of a commitment', () => {
    // Standup 5:00-5:15pm, day ends 6pm. The 45 min after it holds one deep block.
    const plan = derivePlan(
      input({ commitments: [commitment('standup', at(17), 15)] }),
    )

    const after = plannedBlocks(plan).filter((b) => b.startsAt >= at(17, 15))
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ blockKind: 'deep', startsAt: at(17, 15) })
    expect(after[0]?.endsAt).toBe(at(18))
  })

  it('never plans over a commitment', () => {
    const plan = derivePlan(
      input({
        now: at(14),
        commitments: [commitment('standup', at(15), 60)],
      }),
    )

    for (const block of plannedBlocks(plan)) {
      expect(block.startsAt >= at(16) || block.endsAt <= at(15)).toBe(true)
    }
  })

  it('keeps the time around a commitment clear as well as the commitment', () => {
    // The 4pm swim: an hour in the pool, half an hour getting there, twenty
    // minutes getting back. Nothing may be planned between 3:30 and 5:20.
    const swim: Commitment = {
      ...commitment('swim', at(16), 60),
      prepMin: 30,
      recoverMin: 20,
    }
    const plan = derivePlan(input({ commitments: [swim] }))

    for (const block of plannedBlocks(plan)) {
      expect(block.startsAt >= at(17, 20) || block.endsAt <= at(15, 30)).toBe(true)
    }

    // 2:00 to 3:30 is 90 minutes, which is exactly two deep blocks. Without the
    // half hour of getting ready it would have been 2:00 to 4:00 and held two
    // deep plus a short.
    const before = plannedBlocks(plan).filter((b) => b.endsAt <= at(15, 30))
    expect(before).toHaveLength(2)
    expect(before.every((b) => b.blockKind === 'deep')).toBe(true)
    expect(before[0]?.startsAt).toBe(at(14))
    expect(before.at(-1)?.endsAt).toBe(at(15, 30))
  })

  it('draws the time around a commitment as its own entries, not a longer one', () => {
    const swim: Commitment = {
      ...commitment('swim', at(16), 60),
      prepMin: 30,
      recoverMin: 20,
    }
    const plan = derivePlan(input({ commitments: [swim] }))

    // The commitment is still an hour long. Stretching it to cover the travel
    // would say the user is in the pool while they are in the car.
    const event = plan.entries.find((e) => e.kind === 'commitment')
    expect(event).toMatchObject({ startsAt: at(16), endsAt: at(17) })

    const around = commitmentMargins(plan)
    expect(around).toHaveLength(2)
    expect(around.find((e) => e.side === 'before')).toMatchObject({
      startsAt: at(15, 30),
      endsAt: at(16),
    })
    expect(around.find((e) => e.side === 'after')).toMatchObject({
      startsAt: at(17),
      endsAt: at(17, 20),
    })
  })

  it('draws no margin entries for a commitment that costs nothing either side', () => {
    const plan = derivePlan(input({ commitments: [commitment('standup', at(17), 15)] }))
    expect(commitmentMargins(plan)).toHaveLength(0)
  })

  it('still counts a commitment as ahead of us while its cooldown runs', () => {
    // The swim finished at 3pm; twenty minutes of getting back are still owed,
    // so the 3:00-3:20 stretch is not free.
    const swim: Commitment = { ...commitment('swim', at(14), 60), recoverMin: 20 }
    const plan = derivePlan(input({ now: at(14, 55), commitments: [swim] }))

    expect(plannedBlocks(plan).every((b) => b.startsAt >= at(15, 20))).toBe(true)
    expect(commitmentMargins(plan)).toHaveLength(1)
  })

  it('charges preparation that starts before the working day against the day', () => {
    // A 9:15 commitment with 30 minutes of prep reaches back to 8:45, outside
    // the 9-6 region. The part inside the region still has to be kept clear.
    const early: Commitment = { ...commitment('school', at(9, 15), 30), prepMin: 30 }
    const plan = derivePlan(input({ now: at(8), commitments: [early] }))

    for (const block of plannedBlocks(plan)) {
      expect(block.startsAt >= at(9, 45)).toBe(true)
    }
  })

  it('leaves the un-fillable remainder as margin, rounded down', () => {
    // 2:00pm to a 2:50pm commitment => one deep block, 5 minutes dead.
    const plan = derivePlan(
      input({ commitments: [commitment('call', at(14, 50), 190)] }),
    )

    const blocks = plannedBlocks(plan)
    expect(blocks).toHaveLength(1)
    expect(durationMin(blocks[0]!)).toBe(45)

    const dead = margins(plan)
    expect(dead).toHaveLength(1)
    expect(durationMin(dead[0]!)).toBe(5)
  })

  it('plans the rest of the work region when nothing is scheduled', () => {
    // 2pm to the region's 6pm end is 240 min: 5 deep blocks (225), 15 dead.
    const plan = derivePlan(input({ now: at(14), commitments: [] }))

    expect(plan.horizon).toBe(at(18))
    expect(plannedBlocks(plan)).toHaveLength(5)
    expect(durationMin(margins(plan)[0]!)).toBe(15)
  })

  it('plans nothing at all when the day has no work regions', () => {
    const plan = derivePlan(input({ regions: [] }))

    expect(plannedBlocks(plan)).toHaveLength(0)
    // No regions means no day, not a guess about when it ends.
    expect(plan.horizon).toBe(at(14))
  })

  it('skips the gap between regions and resumes after it', () => {
    // Work 2-6, plans 6-8, then an evening stretch 8-10.
    const plan = derivePlan(
      input({ regions: [region(14, 18), region(20, 22, 'evening')] }),
    )

    for (const block of plannedBlocks(plan)) {
      const inFirst = block.startsAt >= at(14) && block.endsAt <= at(18)
      const inSecond = block.startsAt >= at(20) && block.endsAt <= at(22)
      expect(inFirst || inSecond).toBe(true)
    }

    // The evening stretch is planned, so the gap did not end the day.
    expect(plannedBlocks(plan).some((b) => b.startsAt >= at(20))).toBe(true)
    expect(plan.horizon).toBe(at(22))
  })

  it('does not stretch the horizon for a commitment outside every region', () => {
    // The old dayEndsAt behaviour dragged the horizon out to cover this.
    const plan = derivePlan(
      input({ commitments: [commitment('evening call', at(19), 30)] }),
    )

    expect(plan.horizon).toBe(at(18))
    expect(plannedBlocks(plan).every((b) => b.endsAt <= at(18))).toBe(true)
    // It still shows on the timeline; it just does not create a work region.
    expect(plan.entries.some((e) => e.kind === 'commitment')).toBe(true)
  })

  it('coalesces overlapping regions rather than double counting them', () => {
    const plan = derivePlan(
      input({ regions: [region(14, 17), region(16, 18, 'overlap')] }),
    )

    expect(plan.regions).toEqual([{ start: at(14), end: at(18) }])
  })

  it('never plans before a region opens', () => {
    // Opening at 7am with a 9-6 day: the first block waits for 9.
    const plan = derivePlan(input({ now: at(7), regions: [region(9, 18)] }))

    expect(plannedBlocks(plan)[0]?.startsAt).toBe(at(9))
  })

  it('plans around a break the user pinned', () => {
    const base = input({ commitments: [commitment('standup', at(17), 15)] })
    const withBreak: DerivePlanInput = {
      ...base,
      overrides: [{ id: 'b1', startsAt: at(15, 30), durationMin: 15 }],
    }

    const plan = derivePlan(withBreak)
    for (const block of plannedBlocks(plan)) {
      expect(block.startsAt >= at(15, 45) || block.endsAt <= at(15, 30)).toBe(true)
    }
  })

  it('costs focus minutes even when the block count survives', () => {
    // A break can leave the block *count* unchanged while still costing time:
    // the stretch after it repacks into a deep block plus a short one rather
    // than two deep ones. This is why breakCost reports minutes, not just blocks.
    const base = input({ commitments: [commitment('standup', at(17), 15)] })
    const withBreak: DerivePlanInput = {
      ...base,
      overrides: [{ id: 'b1', startsAt: at(15, 30), durationMin: 15 }],
    }

    const before = countPlannedFocus(derivePlan(base))
    const after = countPlannedFocus(derivePlan(withBreak))

    expect(before).toEqual({ blocks: 5, minutes: 225 })
    expect(after).toEqual({ blocks: 5, minutes: 200 })
  })

  it('starts planning after the running block rather than re-planning it', () => {
    const plan = derivePlan(
      input({
        now: at(14, 10),
        active: {
          kind: 'block',
          id: 'active-1',
          blockKind: 'deep',
          purpose: 'Write the planner',
          startedAt: at(14),
          endsAt: at(14, 45),
        },
      }),
    )

    expect(plan.entries.some((e) => e.kind === 'active')).toBe(true)
    for (const block of plannedBlocks(plan)) {
      expect(block.startsAt).toBeGreaterThanOrEqual(at(14, 45))
    }
  })

  it('keeps history in the timeline without letting it affect planning', () => {
    const plan = derivePlan(
      input({
        now: at(15),
        history: [
          {
            kind: 'block',
            id: 'done-1',
            blockKind: 'deep',
            purpose: 'Ship the thing',
            startedAt: at(14),
            endedAt: at(14, 45),
            plannedEndsAt: at(14, 45),
            outcome: 'completed',
          },
        ],
      }),
    )

    expect(plan.entries.filter((e) => e.kind === 'past')).toHaveLength(1)
    expect(plannedBlocks(plan).every((b) => b.startsAt >= at(15))).toBe(true)
  })

  it('ignores commitments that are already over', () => {
    const plan = derivePlan(
      input({ now: at(14), commitments: [commitment('past', at(9), 30)] }),
    )
    expect(plan.entries.some((e) => e.kind === 'commitment')).toBe(false)
    expect(plannedBlocks(plan)).toHaveLength(5)
  })

  it('plans nothing once the last region has closed', () => {
    // 11:45pm on a day that ended at 6pm. Previously this quietly ran to
    // midnight; now the day is simply over.
    const plan = derivePlan(input({ now: at(23, 45) }))

    expect(plannedBlocks(plan)).toHaveLength(0)
    expect(plan.horizon).toBe(at(18))
  })

  it('returns entries in chronological order', () => {
    const plan = derivePlan(
      input({
        now: at(14),
        commitments: [commitment('standup', at(17), 15), commitment('1:1', at(15), 30)],
        overrides: [{ id: 'b1', startsAt: at(16), durationMin: 10 }],
      }),
    )

    const starts = plan.entries.map((e) => e.startsAt)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('breakCost', () => {
  it('reports the blocks a break would cost', () => {
    const base = input({ commitments: [commitment('standup', at(17), 15)] })
    const cost = breakCost(base, at(14, 45), 30)

    expect(cost.blocksLost).toBeGreaterThan(0)
    expect(cost.focusMinutesLost).toBeGreaterThan(0)
  })

  it('reports no cost for a break that fits inside dead time', () => {
    // 2:00-2:50 leaves 5 dead minutes after one deep block; a 5 min break is free.
    const base = input({ commitments: [commitment('call', at(14, 50), 190)] })
    expect(breakCost(base, at(14, 45), 5).blocksLost).toBe(0)
  })

  it('does not mutate the caller\'s input', () => {
    const base = input({ commitments: [commitment('standup', at(17), 15)] })
    breakCost(base, at(14, 45), 30)
    expect(base.overrides).toHaveLength(0)
  })
})

/**
 * The invariants that matter. These are the properties the rest of the app
 * relies on being true for *every* plan, not just the ones we thought to
 * write examples for.
 */
describe('derivePlan invariants', () => {
  const arbSettings: fc.Arbitrary<Settings> = fc.record({
    deepMinutes: fc.integer({ min: 5, max: 120 }),
    shortMinutes: fc.integer({ min: 5, max: 60 }),
    reflectMinutes: fc.constant(5),
    defaultRegions: fc.constant([{ start: '09:00', end: '18:00' }]),
    plannerPolicy: fc.constantFrom<Settings['plannerPolicy']>(
      'prefer-deep',
      'maximise-focus',
    ),
    notificationsEnabled: fc.boolean(),
    soundEnabled: fc.boolean(),
  })

  const arbCommitments: fc.Arbitrary<Commitment[]> = fc.array(
    fc
      .record({
        id: fc.uuid(),
        hour: fc.integer({ min: 6, max: 22 }),
        minute: fc.constantFrom(0, 15, 30, 45),
        durationMin: fc.integer({ min: 5, max: 120 }),
      })
      .map(({ id, hour, minute, durationMin: d }) =>
        commitment(id, at(hour, minute), d),
      ),
    { maxLength: 5 },
  )

  const arbBreaks: fc.Arbitrary<PlannedBreak[]> = fc.array(
    fc
      .record({
        id: fc.uuid(),
        hour: fc.integer({ min: 6, max: 22 }),
        minute: fc.constantFrom(0, 15, 30, 45),
        durationMin: fc.integer({ min: 5, max: 45 }),
      })
      .map(({ id, hour, minute, durationMin: d }) => ({
        id,
        startsAt: at(hour, minute),
        durationMin: d,
      })),
    { maxLength: 4 },
  )

  const arbRegions: fc.Arbitrary<WorkRegion[]> = fc.array(
    fc
      .record({
        id: fc.uuid(),
        fromHour: fc.integer({ min: 6, max: 20 }),
        lengthHours: fc.integer({ min: 1, max: 6 }),
      })
      .map(({ id, fromHour, lengthHours }) => ({
        id,
        startsAt: at(fromHour),
        endsAt: at(Math.min(23, fromHour + lengthHours)),
      }))
      .filter((r) => r.endsAt > r.startsAt),
    { maxLength: 3 },
  )

  const arbInput: fc.Arbitrary<DerivePlanInput> = fc
    .record({
      hour: fc.integer({ min: 6, max: 22 }),
      minute: fc.integer({ min: 0, max: 59 }),
      settings: arbSettings,
      regions: arbRegions,
      commitments: arbCommitments,
      overrides: arbBreaks,
    })
    .map(({ hour, minute, settings, regions, commitments, overrides }) => ({
      now: at(hour, minute),
      settings,
      regions,
      commitments,
      history: [],
      active: null,
      overrides,
    }))

  it('never plans anything in the past or beyond the horizon', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const plan = derivePlan(i)
        for (const entry of plan.entries) {
          if (entry.kind !== 'planned-block' && entry.kind !== 'margin') continue
          expect(entry.startsAt).toBeGreaterThanOrEqual(i.now)
          expect(entry.endsAt).toBeLessThanOrEqual(plan.horizon)
        }
      }),
    )
  })

  it('never overlaps a planned block with a break or a commitment', () => {
    // Commitments may legitimately overlap each other — being double-booked is
    // the user's problem, not the planner's. What must never happen is the
    // planner handing out time that is already spoken for.
    fc.assert(
      fc.property(arbInput, (i) => {
        const plan = derivePlan(i)
        const spokenFor = plan.entries.filter(
          (e) => e.kind === 'planned-break' || e.kind === 'commitment',
        )

        for (const block of plannedBlocks(plan)) {
          for (const busy of spokenFor) {
            const overlaps = block.startsAt < busy.endsAt && busy.startsAt < block.endsAt
            expect(overlaps).toBe(false)
          }
        }
      }),
    )
  })

  it('never overlaps two planned blocks', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const blocks = plannedBlocks(derivePlan(i)).sort(
          (a, b) => a.startsAt - b.startsAt,
        )
        for (let n = 1; n < blocks.length; n++) {
          expect(blocks[n]!.startsAt).toBeGreaterThanOrEqual(blocks[n - 1]!.endsAt)
        }
      }),
    )
  })

  it('never plans a block outside a work region', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const plan = derivePlan(i)
        for (const block of plannedBlocks(plan)) {
          const inside = plan.regions.some(
            (r) => block.startsAt >= r.start && block.endsAt <= r.end,
          )
          expect(inside).toBe(true)
        }
      }),
    )
  })

  it('never leaves a gap big enough for another block', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const plan = derivePlan(i)
        const smallest = Math.min(
          minutesToMs(i.settings.deepMinutes),
          minutesToMs(i.settings.shortMinutes),
        )
        for (const margin of margins(plan)) {
          expect(margin.endsAt - margin.startsAt).toBeLessThan(smallest)
        }
      }),
    )
  })

  it('is deterministic and idempotent for a fixed now', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        expect(derivePlan(i)).toEqual(derivePlan(i))
      }),
    )
  })

  it('produces entries in chronological order', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        const starts = derivePlan(i).entries.map((e) => e.startsAt)
        expect(starts).toEqual([...starts].sort((a, b) => a - b))
      }),
    )
  })

  it('never returns an entry that ends before it starts', () => {
    fc.assert(
      fc.property(arbInput, (i) => {
        for (const entry of derivePlan(i).entries) {
          expect(entry.endsAt).toBeGreaterThan(entry.startsAt)
        }
      }),
    )
  })
})
