/** Editing and laying out the calendar on every supported screen size. */

import { expect, test, type Page } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  blocksOf,
  overflowOf,
  goToStage,
  startDay,
  addStandup,
  shapeDay,
  openRoutine,
  backToToday,
  importSession,
} from './support/mono'

const framedTime = (surface: ReturnType<typeof stage>, label: string) => {
  const input = surface.getByLabel(label, { exact: true })
  const frame = input.locator('xpath=ancestor::*[@data-time-input-frame][1]')
  return { input, frame }
}

test('time and duration fields stay contained and stack on a narrow phone', async ({
  page,
}) => {
  // WebKit can draw the native time control wider than the input's reported
  // box, which makes two non-overlapping DOM rectangles a false reassurance.
  // The invariant we can test in every engine is structural: on a phone these
  // controls do not share a row at all.
  await page.setViewportSize({ width: 320, height: 844 })
  await openMono(page, new Date(2026, 7, 20, 12, 58, 0))

  // The clock is widest around noon. The Stage companion must scale inside
  // the width flexbox actually gives it rather than spilling left over the
  // clock while the wrapper itself reports a non-overlapping rectangle.
  const clock = stage(page).locator('[data-clock]')
  const cat = stage(page).getByRole('button', { name: /Pet Mono/ })
  const [clockBox, catBox, companionBox] = await Promise.all([
    clock.boundingBox(),
    cat.boundingBox(),
    cat.locator('..').boundingBox(),
  ])
  expect(clockBox).not.toBeNull()
  expect(catBox).not.toBeNull()
  expect(companionBox).not.toBeNull()
  expect(clockBox!.x + clockBox!.width).toBeLessThanOrEqual(catBox!.x)
  expect(catBox!.x).toBeGreaterThanOrEqual(companionBox!.x - 1)
  expect(catBox!.x + catBox!.width).toBeLessThanOrEqual(
    companionBox!.x + companionBox!.width + 1,
  )

  const expectPairToStack = async (
    surface: ReturnType<typeof stage>,
    timeLabel: string,
    durationLabel: string,
  ) => {
    const { input: time, frame } = framedTime(surface, timeLabel)
    const duration = surface.getByLabel(durationLabel, { exact: true })
    const [frameBox, durationBox, surfaceBox] = await Promise.all([
      frame.boundingBox(),
      duration.boundingBox(),
      surface.boundingBox(),
    ])

    expect(frameBox).not.toBeNull()
    expect(durationBox).not.toBeNull()
    expect(surfaceBox).not.toBeNull()
    expect(frameBox!.y + frameBox!.height).toBeLessThanOrEqual(durationBox!.y)

    // The visual padding lives on a clipping frame rather than the temporal
    // input. This is the part Chromium cannot reproduce but can keep us from
    // regressing: padded `width: 100%` time inputs overflow on iOS Safari 26.
    await expect(time).toHaveCSS('padding-left', '0px')
    await expect(time).toHaveCSS('padding-right', '0px')
    await expect(frame).toHaveCSS('overflow', 'hidden')

    // The visible boxes still line up after moving the time field's padding to
    // its frame; stacking must not trade overlap for a ragged form.
    expect(Math.abs(frameBox!.x - durationBox!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(frameBox!.width - durationBox!.width)).toBeLessThanOrEqual(1)
    expect(frameBox!.x).toBeGreaterThanOrEqual(surfaceBox!.x - 1)
    expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(
      surfaceBox!.x + surfaceBox!.width + 1,
    )
    expect(durationBox!.x).toBeGreaterThanOrEqual(surfaceBox!.x - 1)
    expect(durationBox!.x + durationBox!.width).toBeLessThanOrEqual(
      surfaceBox!.x + surfaceBox!.width + 1,
    )
  }

  await expectPairToStack(stage(page), 'At', 'For (minutes)')

  // The frame owns the visual padding, but that padding is not a dead strip.
  // A mouse focuses without forcing the desktop picker open; a touch asks for
  // the picker because the whole visible control is its tap target.
  const stageTime = framedTime(stage(page), 'At')
  await stageTime.input.evaluate((input) => {
    const field = input as HTMLInputElement
    field.showPicker = () => {
      field.dataset.pickerCalls = String(Number(field.dataset.pickerCalls ?? 0) + 1)
    }
  })
  await stageTime.frame.click({ position: { x: 2, y: 2 } })
  await expect(stageTime.input).toBeFocused()
  await expect(stageTime.input).not.toHaveAttribute('data-picker-calls')

  await stageTime.frame.dispatchEvent('pointerdown', { pointerType: 'touch' })
  await stageTime.frame.dispatchEvent('click')
  await expect(stageTime.input).toHaveAttribute('data-picker-calls', '1')

  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await expectPairToStack(calendar(page), 'At', 'For (minutes)')

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await expectPairToStack(calendar(page), 'From', 'For (minutes)')

  // The phone owns one vertical scroll surface: the document. A horizontal
  // clip on the calendar would make its other axis compute to `auto`, even
  // when it happened not to overflow in Chromium today.
  await expect(calendar(page)).toHaveCSS('overflow-y', 'visible')

  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(sideways).toBeLessThanOrEqual(0)
})

test('time and duration fields share a row when the surface has room', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 844 })
  await openMono(page)

  const expectPairToShareRow = async (
    surface: ReturnType<typeof stage>,
    timeLabel: string,
    durationLabel: string,
  ) => {
    const { frame } = framedTime(surface, timeLabel)
    const [timeFrameBox, durationBox] = await Promise.all([
      frame.boundingBox(),
      surface.getByLabel(durationLabel, { exact: true }).boundingBox(),
    ])

    expect(timeFrameBox).not.toBeNull()
    expect(durationBox).not.toBeNull()
    expect(Math.abs(timeFrameBox!.y - durationBox!.y)).toBeLessThanOrEqual(1)
    expect(timeFrameBox!.x + timeFrameBox!.width).toBeLessThanOrEqual(durationBox!.x)
  }

  await expectPairToShareRow(stage(page), 'At', 'For (minutes)')

  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await expectPairToShareRow(calendar(page), 'At', 'For (minutes)')

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await expectPairToShareRow(calendar(page), 'From', 'For (minutes)')
})

test('the calendar edits itself in place, without covering the day', async ({ page }) => {
  await openMono(page)
  await addStandup(page)

  const hours = calendar(page).getByRole('button', { name: 'Hours', exact: true })
  await hours.click()
  await expect(hours).toHaveAttribute('aria-expanded', 'true')

  // The whole point: the day is still on screen while you edit it. A dialog
  // put a card over a blurred backdrop exactly here.
  await expect(blocksOf(page, 'Deep')).not.toHaveCount(0)
  await expect(calendar(page).getByText('2 PM', { exact: true })).toBeVisible()

  // Clicking the open control closes it again.
  await hours.click()
  await expect(hours).toHaveAttribute('aria-expanded', 'false')
  await expect(calendar(page).getByLabel('Hours 1 start', { exact: true })).toBeHidden()
})

test('a commitment stays on the calendar once it is over', async ({ page }) => {
  // Regression: the filter deciding what *shapes* the plan was also deciding
  // what is drawn, so a meeting vanished off the axis the moment its last
  // minute passed — while every block and break of the day stayed put.
  await openMono(page)
  await addStandup(page)
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(1)

  // Half an hour after it finished, with the working day still running.
  await page.clock.setSystemTime(new Date(2026, 7, 20, 17, 30, 0))
  await page.clock.fastForward('00:02')

  await expect(blocksOf(page, 'Daily standup')).toHaveCount(1)
  // And still the user's to correct: a meeting that ran at another time, or
  // never ran, is put right on the record afterwards.
  await expect(page.getByRole('button', { name: 'Edit Daily standup' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Remove Daily standup' }).click()
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(0)
})

test('a planned break that has passed asks whether it was taken', async ({ page }) => {
  // It used to vanish the moment its last minute passed, and a break written
  // in for the morning was never drawn at all. Now it stays as the plan, and
  // ✓ makes it the record.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('11:00')
  // Long enough to be drawn with its words, which a quarter of an hour is not.
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('30')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 11:00 AM · 30m')
  await expect(calendar(page).getByText('planned · taken?')).toBeVisible()
  await calendar(page).getByRole('button', { name: 'Mark Break as taken' }).click()

  // On the record now: no longer asking, still the user's to put right.
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 11:00 AM · 30m')
  await expect(calendar(page).getByText('planned · taken?')).toHaveCount(0)
  await expect(calendar(page).getByRole('button', { name: 'Mark Break as taken' })).toHaveCount(0)
  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByText('Edit break taken')).toBeVisible()
  await calendar(page).getByRole('button', { name: 'Cancel', exact: true }).click()

  // Survives a reload: it went into the log as a break taken.
  await page.reload()
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 11:00 AM · 30m')
  await expect(calendar(page).getByText('planned · taken?')).toHaveCount(0)
  await calendar(page).getByRole('button', { name: 'Remove Break' }).click()
  await expect(blocksOf(page, 'Break')).toHaveCount(0)
})

test('a break too short for its words still offers its controls', async ({ page }) => {
  // Regression: a block under about fourteen minutes drew no controls at all,
  // so a ten-minute break could be neither confirmed, edited nor removed.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('11:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('10')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  const pin = blocksOf(page, 'Break')
  await expect(pin).toHaveAttribute('title', 'Break · 11:00 AM · 10m')
  await pin.hover()
  await calendar(page).getByRole('button', { name: 'Mark Break as taken' }).click()

  // On the record, and still reachable from the keyboard to put right.
  await expect(calendar(page).getByRole('button', { name: 'Mark Break as taken' })).toHaveCount(0)
  await calendar(page).getByRole('button', { name: 'Edit Break' }).focus()
  await expect(calendar(page).getByRole('button', { name: 'Edit Break' })).toHaveCSS('opacity', '1')
  await page.keyboard.press('Enter')
  await expect(calendar(page).getByText('Edit break taken')).toBeVisible()
  await calendar(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await pin.hover()
  await calendar(page).getByRole('button', { name: 'Remove Break' }).click()
  await expect(pin).toHaveCount(0)
})

/** Two five-minute pins back to back, at eleven, behind now: each asks to be confirmed. */
async function pinBackToBack(page: Page) {
  await openMono(page)
  await shapeDay(page)
  for (const time of ['11:00', '11:05']) {
    await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
    await calendar(page).getByLabel('From', { exact: true }).fill(time)
    await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('5')
    await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()
  }
  await expect(blocksOf(page, 'Break')).toHaveCount(2)
}

test("back-to-back short breaks each offer their own controls, not each other's", async ({
  page,
}) => {
  // Their cards are taller than they are, so each reaches over the other.
  // Only the one pointed at is shown, or takes the pointer at all.
  await pinBackToBack(page)
  const edit = calendar(page).getByRole('button', { name: 'Edit Break' })
  for (const [index, time] of [[0, '11:00'], [1, '11:05']] as const) {
    await blocksOf(page, 'Break').nth(index).hover()
    await edit.nth(index).click()
    await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue(time)
    await calendar(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  }
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test("a tap shows one short break's controls, and they act on that break", async ({ page }) => {
    await pinBackToBack(page)
    const edit = calendar(page).getByRole('button', { name: 'Edit Break' })
    for (const [index, time] of [[0, '11:00'], [1, '11:05']] as const) {
      await blocksOf(page, 'Break').nth(index).tap()
      await edit.nth(index).tap()
      await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue(time)
      await calendar(page).getByRole('button', { name: 'Cancel', exact: true }).tap()
    }
  })
})

test('a break taken is put right on the calendar, and the running one is left alone', async ({
  page,
}) => {
  const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m).getTime()
  await openMono(page)
  await importSession(page, {
    version: 10,
    dayKey: '2026-08-20',
    events: [
      { type: 'day/shaped', at: at(9) },
      {
        type: 'block/started', at: at(10), id: 'morning', blockKind: 'deep',
        endsAt: at(10, 45), purpose: 'Write the migration',
      },
      { type: 'block/completed', at: at(10, 45) },
      // Twenty minutes of a planned half hour, so it is drawn with its words.
      { type: 'break/started', at: at(11), id: 'walk', endsAt: at(11, 30) },
      { type: 'break/ended', at: at(11, 20) },
      // On a break now, since five to two.
      { type: 'break/started', at: at(13, 55), id: 'tea', endsAt: at(14, 10) },
    ],
  })

  const breaks = blocksOf(page, 'Break')
  const walk = calendar(page).locator('[title^="Break · 11:00 AM"]')
  await expect(walk).toHaveAttribute('title', 'Break · 11:00 AM · 20m')
  // The running break has nothing to edit, move or take off: it is the
  // stage's until it ends. The one taken this morning has all three.
  await expect(breaks).toHaveCount(2)
  await expect(calendar(page).getByRole('button', { name: 'Edit Break' })).toHaveCount(1)
  await expect(calendar(page).getByRole('button', { name: 'Remove Break' })).toHaveCount(1)

  // Its length, from its form, which knows it as a break taken.
  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByText('Edit break taken')).toBeVisible()
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('25')
  await calendar(page).getByRole('button', { name: 'Save break', exact: true }).click()
  await expect(walk).toHaveAttribute('title', 'Break · 11:00 AM · 25m')

  // Dragged half an hour earlier onto the morning's block, it goes to the
  // near side of the block rather than onto it: the record keeps clear of
  // the record.
  await walk.scrollIntoViewIfNeeded()
  const box = (await walk.boundingBox())!
  const x = box.x + 12
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 48, { steps: 6 })
  await page.mouse.up()
  const moved = calendar(page).locator('[title^="Break · 10:45 AM"]')
  await expect(moved).toHaveAttribute('title', 'Break · 10:45 AM · 25m')

  await calendar(page).getByRole('button', { name: 'Remove Break' }).click()
  await expect(breaks).toHaveCount(1)
})

test('a drag held at the edge of the column scrolls the day, then grows it', async ({ page }) => {
  // Opened at nine so the day is taller than the column beside the stage.
  await openMono(page, new Date(2026, 7, 20, 9, 0, 0))
  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('09:30')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  const column = calendar(page).locator('.mono-scroll')
  const seen = (await column.boundingBox())!
  const pin = blocksOf(page, 'Break')
  const box = (await pin.boundingBox())!
  const x = box.x + 12

  await page.mouse.move(x, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, seen.y + seen.height - 4, { steps: 10 })
  const before = await column.evaluate((el) => el.scrollTop)
  // The clock is paused, and the scrolling runs a frame at a time.
  await page.clock.runFor(400)
  expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(before)
  // Past the six o'clock end of the day the axis drew, an hour at a time.
  await page.clock.runFor(2000)
  await expect(calendar(page).getByText('8 PM', { exact: true })).toBeVisible()
  await page.mouse.up()

  // Carried past the bottom of the day rather than to the bottom of what was
  // on screen when it was picked up, and the evening it grew is drawn.
  await expect(pin).toHaveAttribute('title', /^Break · (6|7|8|9|10|11):\d\d PM · 15m$/)
})

test('a drag held at the top of the day grows it earlier', async ({ page }) => {
  // Opened at two, nothing earlier is drawn: the axis starts at two.
  await openMono(page)
  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Lunch')
  await calendar(page).getByLabel('At', { exact: true }).fill('15:00')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()
  await expect(calendar(page).getByText('1 PM', { exact: true })).toHaveCount(0)

  const column = calendar(page).locator('.mono-scroll')
  const lunch = blocksOf(page, 'Lunch')
  await lunch.scrollIntoViewIfNeeded()
  const box = (await lunch.boundingBox())!
  const x = box.x + 12
  await column.evaluate((el) => el.scrollTo(0, 0))
  const seen = (await column.boundingBox())!
  const start = (await lunch.boundingBox())!

  await page.mouse.move(x, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, seen.y + 2, { steps: 10 })
  await page.clock.runFor(1500)
  await expect(calendar(page).getByText('12 PM', { exact: true })).toBeVisible()
  await page.mouse.up()

  // Put right earlier than anything the day had drawn: lunch ran at noon-ish.
  await expect(lunch).toHaveAttribute('title', /^Lunch · (10|11):\d\d AM · |^Lunch · 12:\d\d PM · /)
})

test('stacked under the stage, a drag held at the top grows the day and keeps hold', async ({
  page,
}) => {
  // Regression: where the page scrolls the day, the drag scrolled on past the
  // start of the day into the stage, then grew the axis with nothing keeping
  // the drawing still, carried the block off the bottom of the screen, and let
  // it go where it had been an hour before.
  await page.setViewportSize({ width: 768, height: 844 })
  await openMono(page)
  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Lunch')
  await calendar(page).getByLabel('At', { exact: true }).fill('15:00')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()
  await expect(calendar(page).getByText('1 PM', { exact: true })).toHaveCount(0)

  const lunch = blocksOf(page, 'Lunch')
  await lunch.scrollIntoViewIfNeeded()
  const box = (await lunch.boundingBox())!
  const x = box.x + 12

  await page.mouse.move(x, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, 2, { steps: 10 })
  await page.clock.runFor(1500)
  await expect(calendar(page).getByText('12 PM', { exact: true })).toBeVisible()
  // Still under the pointer's end of the screen rather than carried off it.
  await expect(lunch).toBeInViewport()
  await page.mouse.up()

  // Let go where it was drawn, earlier than anything the day had drawn.
  await expect(lunch).toHaveAttribute('title', /^Lunch · (10|11):\d\d AM · |^Lunch · 12:\d\d PM · /)
  await expect(lunch).toBeInViewport()
})

test('a commitment moves only the breaks it lands on, down past it', async ({ page }) => {
  // Adding one used to delete every pin still to come, so a meeting at five
  // wiped a break pinned for three. Then it deleted only the rest it would be
  // drawn on top of. Now that one moves to just after it instead.
  await openMono(page)
  await shapeDay(page)

  const pinBreak = async (time: string) => {
    await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
    await calendar(page).getByLabel('From', { exact: true }).fill(time)
    await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()
  }

  await pinBreak('15:00')
  await pinBreak('17:10')
  await expect(blocksOf(page, 'Break')).toHaveCount(2)

  // A five o'clock meeting covers the second pin and nothing near the first.
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Design review')
  await calendar(page).getByLabel('At', { exact: true }).fill('17:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('45')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()

  await expect(blocksOf(page, 'Design review')).toHaveCount(1)
  await expect(blocksOf(page, 'Break')).toHaveCount(2)
  await expect(blocksOf(page, 'Break').first()).toHaveAttribute('title', /3:00 PM/)
  await expect(blocksOf(page, 'Break').last()).toHaveAttribute('title', /5:45 PM/)
})

test('a break pushed past the end of the day is drawn whole while the drag is held', async ({
  page,
}) => {
  // Regression: the axis only reached as far as the day already drew, so a
  // pin pushed past six was a sliver against the edge until the drop.
  await openMono(page)
  await shapeDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Review')
  await calendar(page).getByLabel('At', { exact: true }).fill('16:30')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('60')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()
  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('17:30')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  const review = blocksOf(page, 'Review')
  const pin = blocksOf(page, 'Break')
  await review.scrollIntoViewIfNeeded()
  const box = (await review.boundingBox())!
  const drawn = (await pin.boundingBox())!.height

  // Half an hour later is 48 pixels, and puts the break at six to quarter past.
  await page.mouse.move(box.x + 12, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 12, box.y + box.height / 2 + 48, { steps: 6 })
  await expect(calendar(page).getByText('5:00 PM', { exact: true })).toBeVisible()
  expect((await pin.boundingBox())!.height).toBeCloseTo(drawn, 0)
  await page.mouse.up()
  await expect(pin).toHaveAttribute('title', 'Break · 6:00 PM · 15m')
})

test('a break cannot be pinned across a commitment', async ({ page }) => {
  // The other half of the rule above. A commitment arriving on top of a pin
  // moves it; a pin aimed at a commitment is refused, and refused *here*,
  // where the person picking a time can see why — the reducer declines it too,
  // but a form that closes having silently done nothing is not an answer.
  await openMono(page)
  await addStandup(page)

  const from = calendar(page).getByLabel('From', { exact: true })
  const add = calendar(page).getByRole('button', { name: 'Add break', exact: true })

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await from.fill('17:05')
  await expect(calendar(page).getByText(/That runs into/)).toBeVisible()
  await expect(add).toBeDisabled()

  // Naming it, rather than saying "that clashes" — the meeting is the thing
  // the user has to think about to answer.
  await expect(calendar(page).getByText(/Daily standup/).first()).toBeVisible()

  // Clear of it, and the form is a form again.
  await from.fill('15:00')
  await expect(add).toBeEnabled()
  await add.click()
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', /3:00 PM/)
})

test('an editor follows the break a commitment moves out from under it', async ({ page }) => {
  // A pin a commitment lands on is moved down past it, with its form open.
  // Left holding where it was, the form would put it back on the meeting.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('17:10')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue('17:10')

  // Answering the day's first question again is the way to add a commitment
  // without touching the calendar's own composer. Every locator here is scoped
  // to the stage: two forms are deliberately on screen at once, and they share
  // the field names — which is the whole reason this case exists.
  await goToStage(page, 'Commitments')
  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Design review')
  await stage(page).getByLabel('At', { exact: true }).fill('17:00')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('45')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()

  await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue('17:45')
})

test('removing the thing an editor is open on closes the editor', async ({ page }) => {
  // The × used to close the composer itself. It does not any more — the same
  // rule that catches a pin cleared from elsewhere catches this, because both
  // are the lookup failing — so the behaviour needs a test of its own rather
  // than a line of code beside the gesture.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('15:00')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue('15:00')

  await calendar(page).getByRole('button', { name: 'Remove Break' }).click()
  await expect(calendar(page).getByLabel('From', { exact: true })).toBeHidden()
  await expect(blocksOf(page, 'Break')).toHaveCount(0)
})

test('a break and a commitment are edited where they are drawn', async ({ page }) => {
  await openMono(page)
  await addStandup(page)

  // The block is the control. There is no pencil to find, and no dialog: the
  // form that made the commitment opens under the calendar header, seeded from
  // it, with the day still drawn below.
  await calendar(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  const what = calendar(page).getByLabel('What', { exact: true })
  await expect(what).toHaveValue('Daily standup')
  await expect(calendar(page).getByLabel('At', { exact: true })).toHaveValue('17:00')
  await expect(calendar(page).getByLabel('For (minutes)', { exact: true })).toHaveValue('15')

  await what.fill('Design review')
  await calendar(page).getByLabel('At', { exact: true }).fill('16:00')
  await calendar(page).getByRole('button', { name: 'Save', exact: true }).click()

  // Moved and renamed, not duplicated: this is the same commitment.
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(0)
  await expect(blocksOf(page, 'Design review')).toHaveAttribute(
    'title',
    'Design review · 4:00 PM · 15m',
  )

  // And the same for a pinned break.
  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('15:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('20')
  await calendar(page).getByRole('button', { name: 'Add break' }).click()
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 3:00 PM · 20m')

  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue('15:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('45')
  await calendar(page).getByRole('button', { name: 'Save break' }).click()
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 3:00 PM · 45m')

  // It survives a reload, because it went into the log rather than into the
  // component holding the form.
  await page.reload()
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', 'Break · 3:00 PM · 45m')
  await expect(blocksOf(page, 'Design review')).toHaveCount(1)
})

test('a commitment is dragged to a new time, and Escape puts it back', async ({ page }) => {
  await openMono(page)
  await addStandup(page)

  const standup = blocksOf(page, 'Daily standup')
  await standup.scrollIntoViewIfNeeded()
  const box = (await standup.boundingBox())!
  // Pressed at its left, clear of the ✎ and × the pointer reveals on its right.
  const x = box.x + 12
  const y = box.y + box.height / 2

  // An hour is 96 pixels, so up 96 is an hour earlier.
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 96, { steps: 8 })
  await expect(calendar(page).getByText('4:00 PM', { exact: true })).toBeVisible()
  await page.mouse.up()
  await expect(standup).toHaveAttribute('title', 'Daily standup · 4:00 PM · 15m')

  // Survives a reload: it went into the log as an edit to the same commitment.
  await page.reload()
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(1)
  await expect(standup).toHaveAttribute('title', 'Daily standup · 4:00 PM · 15m')

  // A drag let go of with Escape writes nothing.
  await standup.scrollIntoViewIfNeeded()
  const again = (await standup.boundingBox())!
  await page.mouse.move(again.x + 12, again.y + again.height / 2)
  await page.mouse.down()
  await page.mouse.move(again.x + 12, again.y + again.height / 2 + 48, { steps: 6 })
  await expect(calendar(page).getByText('4:30 PM', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(standup).toHaveAttribute('title', 'Daily standup · 4:00 PM · 15m')
})

test("a commitment dragged under the stage's open form stays where it was put", async ({
  page,
}) => {
  // Regression: the stage's form held a copy of the whole commitment, so its
  // Done put back the time it was opened at, even when only the title had
  // been changed. It holds only what is typed into it now.
  await openMono(page)
  await addStandup(page)
  await goToStage(page, 'Commitments')
  await stage(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  const at = stage(page).getByLabel('At', { exact: true })
  await expect(at).toHaveValue('17:00')

  const standup = blocksOf(page, 'Daily standup')
  await standup.scrollIntoViewIfNeeded()
  const box = (await standup.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 12, box.y + box.height / 2 - 96, { steps: 8 })
  await page.mouse.up()
  await expect(standup).toHaveAttribute('title', 'Daily standup · 4:00 PM · 15m')

  // The form shows where it went, and keeping a new title keeps the move.
  await expect(at).toHaveValue('16:00')
  await stage(page).getByLabel('This commitment', { exact: true }).fill('Design review')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(blocksOf(page, 'Design review')).toHaveAttribute(
    'title',
    'Design review · 4:00 PM · 15m',
  )
})

test('a break is dragged anywhere but onto a commitment, and is moved by one', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)
  await calendar(page).getByRole('button', { name: 'Break', exact: true }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('15:00')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  const pin = blocksOf(page, 'Break')
  const standup = blocksOf(page, 'Daily standup')
  // Pressed at its left, clear of the ✎ and × on its right. An hour is 96px,
  // so 1.6px is a minute.
  const drag = async (block: typeof pin, minutes: number) => {
    await block.scrollIntoViewIfNeeded()
    const box = (await block.boundingBox())!
    const x = box.x + 12
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + minutes * 1.6, { steps: 8 })
    await page.mouse.up()
  }

  await drag(pin, 60)
  await expect(pin).toHaveAttribute('title', 'Break · 4:00 PM · 15m')

  // Let go of over the five o'clock standup, it goes to the nearer side of it.
  await drag(pin, 65)
  await expect(pin).toHaveAttribute('title', 'Break · 5:15 PM · 15m')

  // And the standup dragged onto it moves it down past the standup.
  await drag(standup, 15)
  await expect(standup).toHaveAttribute('title', 'Daily standup · 5:15 PM · 15m')
  await expect(pin).toHaveAttribute('title', 'Break · 5:30 PM · 15m')
})

test('plans only inside working hours, and resumes after an unstructured gap', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)

  // The default shape runs to 6pm, so nothing is planned beyond it.
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
  const before = await blocksOf(page, 'Deep').count()

  // Carve the evening: stop at 6, take 6-8 unstructured, work again 8-10.
  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByRole('button', { name: '+ Add a stretch' }).click()
  await calendar(page).getByLabel('Hours 2 start', { exact: true }).fill('20:00')
  await calendar(page).getByLabel('Hours 2 end', { exact: true }).fill('22:00')
  await calendar(page).getByRole('button', { name: 'Save for today' }).click()

  // The day now runs to 10, and the evening stretch is planned.
  await expect(page.getByText(/Working until 10:00 PM/)).toBeVisible()
  expect(await blocksOf(page, 'Deep').count()).toBeGreaterThan(before)
  await expect(calendar(page).getByText('8 PM', { exact: true })).toBeVisible()
})

test('says when the next stretch opens instead of planning through a gap', async ({
  page,
}) => {
  // 7pm sits in the gap between a 9-6 day and a 8-10 evening stretch. The
  // opening question is where the evening gets declared: being outside your
  // hours is no reason to be refused the form that sets them.
  await openMono(page, new Date(2026, 7, 20, 19, 0, 0))

  await goToStage(page, 'Hours')
  await expect(stage(page).getByText(/your day starts at|past everything below/)).toBeVisible()
  await stage(page).getByRole('button', { name: '+ Add a stretch' }).click()
  await stage(page).getByLabel('Hours 2 start', { exact: true }).fill('20:00')
  await stage(page).getByLabel('Hours 2 end', { exact: true }).fill('22:00')
  await startDay(page)

  await expect(
    stage(page).getByText('Outside working hours', { exact: true }),
  ).toBeVisible()
  await expect(stage(page).getByText(/Nothing scheduled until 8:00 PM/)).toBeVisible()
  // No block can be started in time the user declared unstructured.
  await expect(page.getByRole('button', { name: /Start (deep|short) block/ })).toHaveCount(0)

  // The escape hatch opens the calendar's own editor, in place.
  await page.getByRole('button', { name: "Change today's hours" }).click()
  await expect(calendar(page).getByLabel('Hours 1 start', { exact: true })).toBeVisible()
})

test('saving the hours editor unchanged leaves the day following the default', async ({
  page,
}) => {
  // Regression: "Save for today" wrote the draft back whatever it said, so
  // opening the editor and saving without touching anything stamped a
  // per-day override. The day looked identical and had quietly stopped
  // following the recurring shape.
  await openMono(page)
  await shapeDay(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByRole('button', { name: 'Save for today' }).click()
  await expect(calendar(page).getByLabel('Hours 1 start', { exact: true })).toBeHidden()

  // Change the recurring shape. An uncustomised day has to follow it.
  await openRoutine(page)
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('20:00')
  await backToToday(page)

  await expect(page.getByText(/Working until 8:00 PM/)).toBeVisible()
})

test('a real edit in the hours editor still overrides the day', async ({ page }) => {
  // The other half of the test above: skipping the write when nothing changed
  // must not skip it when something did.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByLabel('Hours 1 end', { exact: true }).fill('16:00')
  await calendar(page).getByRole('button', { name: 'Save for today' }).click()

  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()

  // And now the day is genuinely customised, so the default no longer reaches it.
  await openRoutine(page)
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('20:00')
  await backToToday(page)

  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()
})

test('a narrow screen scrolls as one page rather than as four boxes', async ({
  page,
}) => {
  // Both panels used to be fixed to the viewport with their own scrollbars,
  // which is right beside each other on a desktop and wrong stacked on a
  // phone: two short boxes scrolling inside a page that does not move.
  await page.setViewportSize({ width: 360, height: 740 })
  await openMono(page)
  await shapeDay(page)

  // Nothing runs off the side of a 360px screen.
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(sideways).toBeLessThanOrEqual(0)

  // Neither panel keeps a scrollbar of its own...
  expect(await overflowOf(stage(page))).toBe(0)
  expect(await overflowOf(calendar(page).locator('.mono-scroll'))).toBe(0)

  // ...and the document is what moves instead.
  const down = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(down).toBeGreaterThan(0)

  // So the far end of the day is reached by scrolling the page.
  const footer = page.getByText(/Working until 6:00 PM/)
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toBeInViewport()
})

test('a wide screen keeps the two columns and scrolls inside them', async ({ page }) => {
  // The other half of the rule. Beside the stage, the day scrolls in its own
  // column so the timer stays put while you look around it.
  //
  // Opened at nine, because the column only has something to scroll if the day
  // is taller than it is — and the axis no longer pads itself out with hours
  // that hold nothing.
  await openMono(page, new Date(2026, 7, 20, 9, 0, 0))
  await shapeDay(page)

  const down = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(down).toBeLessThanOrEqual(0)
  expect(await overflowOf(calendar(page).locator('.mono-scroll'))).toBeGreaterThan(0)
})

test('a time field is never drawn narrower than it can render', async ({ page }) => {
  // Chrome renders a `time` input's own text and icon, and below a fixed width
  // it clips `09:00 AM` to `09:00 A` — no wrap, no ellipsis, nothing in the
  // DOM to assert on. So the guard is arithmetic: measure what an unpadded
  // native control needs, then check what each working-hours surface actually
  // gives its input. The routine page holds the recurring shape; the stage
  // and the calendar's 22rem column hold today's.
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 740 })
    await openMono(page)

    const needed = await page.evaluate(() => {
      const probe = document.createElement('input')
      probe.type = 'time'
      probe.value = '09:00'
      probe.style.cssText =
        'position:absolute;left:-9999px;width:auto;padding:0;border:0;font:inherit'
      document.body.appendChild(probe)
      const natural = probe.getBoundingClientRect().width
      probe.remove()
      return natural
    })

    await openRoutine(page)
    const routineInput = page.getByLabel('Working hours 1 start')
    await expect(routineInput).toHaveCSS('padding-left', '0px')
    const field = await routineInput.boundingBox()
    expect(field, `the routine page at ${width}`).not.toBeNull()
    expect(field!.width, `the routine page at ${width}`).toBeGreaterThanOrEqual(needed - 1)
    await backToToday(page)

    await goToStage(page, 'Hours')
    const stageField = await stage(page).getByLabel('Hours 1 start', { exact: true }).boundingBox()
    expect(stageField!.width, `the hours question at ${width}`).toBeGreaterThanOrEqual(
      needed - 1,
    )

    await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
    const calendarField = await calendar(page)
      .getByLabel('Hours 1 start', { exact: true })
      .boundingBox()
    expect(calendarField, `the calendar hours editor at ${width}`).not.toBeNull()
    expect(
      calendarField!.width,
      `the calendar hours editor at ${width}`,
    ).toBeGreaterThanOrEqual(needed - 1)
  }
})
