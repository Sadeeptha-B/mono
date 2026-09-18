/** Editing and laying out the calendar on every supported screen size. */

import { expect, test } from '@playwright/test'
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
  await calendar(page).getByRole('button', { name: '+ Commitment' }).click()
  await expectPairToStack(calendar(page), 'At', 'For (minutes)')

  await calendar(page).getByRole('button', { name: '+ Break' }).click()
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
  await calendar(page).getByRole('button', { name: '+ Commitment' }).click()
  await expectPairToShareRow(calendar(page), 'At', 'For (minutes)')

  await calendar(page).getByRole('button', { name: '+ Break' }).click()
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
  await expect(calendar(page).getByLabel("Today's hours 1 start")).toBeHidden()
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
  await expect(page.getByRole('button', { name: 'Remove Daily standup' })).toHaveCount(0)
})

test('a commitment clears only the breaks it swallows', async ({ page }) => {
  // Adding one used to delete every pin still to come, so a meeting at five
  // wiped a break pinned for three. Only the rest it would be drawn on top of
  // goes now.
  await openMono(page)
  await shapeDay(page)

  const pinBreak = async (time: string) => {
    await calendar(page).getByRole('button', { name: '+ Break' }).click()
    await calendar(page).getByLabel('From', { exact: true }).fill(time)
    await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()
  }

  await pinBreak('15:00')
  await pinBreak('17:10')
  await expect(blocksOf(page, 'Break')).toHaveCount(2)

  // A five o'clock meeting covers the second pin and nothing near the first.
  await calendar(page).getByRole('button', { name: '+ Commitment' }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Design review')
  await calendar(page).getByLabel('At', { exact: true }).fill('17:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('45')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()

  await expect(blocksOf(page, 'Design review')).toHaveCount(1)
  await expect(blocksOf(page, 'Break')).toHaveCount(1)
  await expect(blocksOf(page, 'Break')).toHaveAttribute('title', /3:00 PM/)
})

test('a break cannot be pinned across a commitment', async ({ page }) => {
  // The other half of the rule above. A commitment arriving on top of a pin
  // clears it; a pin aimed at a commitment is refused, and refused *here*,
  // where the person picking a time can see why — the reducer declines it too,
  // but a form that closes having silently done nothing is not an answer.
  await openMono(page)
  await addStandup(page)

  const from = calendar(page).getByLabel('From', { exact: true })
  const add = calendar(page).getByRole('button', { name: 'Add break', exact: true })

  await calendar(page).getByRole('button', { name: '+ Break' }).click()
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

test('an editor closes when the thing it is editing is cleared', async ({ page }) => {
  // Not by the × — that path already closed it — but by the pin being cleared
  // out from under the form. It used to stay open and quietly become an *add*
  // form: the same fields, the same values, a different meaning.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: '+ Break' }).click()
  await calendar(page).getByLabel('From', { exact: true }).fill('17:10')
  await calendar(page).getByRole('button', { name: 'Add break', exact: true }).click()

  await calendar(page).getByRole('button', { name: 'Edit Break' }).click()
  await expect(calendar(page).getByLabel('From', { exact: true })).toHaveValue('17:10')

  // Answering the day's first question again is the way to add a commitment
  // without touching the calendar's own composer. Every locator here is scoped
  // to the stage: two forms are deliberately on screen at once, and they share
  // the field names — which is the whole reason this case exists.
  await goToStage(page, "What's already fixed")
  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Design review')
  await stage(page).getByLabel('At', { exact: true }).fill('17:00')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('45')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  await expect(calendar(page).getByLabel('From', { exact: true })).toBeHidden()
})

test('removing the thing an editor is open on closes the editor', async ({ page }) => {
  // The × used to close the composer itself. It does not any more — the same
  // rule that catches a pin cleared from elsewhere catches this, because both
  // are the lookup failing — so the behaviour needs a test of its own rather
  // than a line of code beside the gesture.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: '+ Break' }).click()
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
  await calendar(page).getByRole('button', { name: '+ Break' }).click()
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
  await calendar(page).getByLabel("Today's hours 2 start").fill('20:00')
  await calendar(page).getByLabel("Today's hours 2 end").fill('22:00')
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

  await goToStage(page, "Today's hours")
  await expect(stage(page).getByText(/your day starts at|past everything below/)).toBeVisible()
  await stage(page).getByRole('button', { name: '+ Add a stretch' }).click()
  await stage(page).getByLabel("Today's hours 2 start").fill('20:00')
  await stage(page).getByLabel("Today's hours 2 end").fill('22:00')
  await startDay(page)

  await expect(
    stage(page).getByText('Outside working hours', { exact: true }),
  ).toBeVisible()
  await expect(stage(page).getByText(/Nothing scheduled until 8:00 PM/)).toBeVisible()
  // No block can be started in time the user declared unstructured.
  await expect(page.getByRole('button', { name: /Start (deep|short) block/ })).toHaveCount(0)

  // The escape hatch opens the calendar's own editor, in place.
  await page.getByRole('button', { name: "Change today's hours" }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 start")).toBeVisible()
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
  await expect(calendar(page).getByLabel("Today's hours 1 start")).toBeHidden()

  // Change the recurring shape. An uncustomised day has to follow it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('20:00')
  await page.keyboard.press('Escape')

  await expect(page.getByText(/Working until 8:00 PM/)).toBeVisible()
})

test('a real edit in the hours editor still overrides the day', async ({ page }) => {
  // The other half of the test above: skipping the write when nothing changed
  // must not skip it when something did.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByLabel("Today's hours 1 end").fill('16:00')
  await calendar(page).getByRole('button', { name: 'Save for today' }).click()

  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()

  // And now the day is genuinely customised, so the default no longer reaches it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('20:00')
  await page.keyboard.press('Escape')

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
  // gives its input. Settings on a phone is the tightest of the three, being a
  // dialog inside a screen.
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

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settingsInput = page.getByLabel('Working hours 1 start')
    await expect(settingsInput).toHaveCSS('padding-left', '0px')
    const field = await settingsInput.boundingBox()
    expect(field, `settings at ${width}`).not.toBeNull()
    expect(field!.width, `settings at ${width}`).toBeGreaterThanOrEqual(needed - 1)
    await page.keyboard.press('Escape')

    await goToStage(page, "Today's hours")
    const stageField = await stage(page).getByLabel("Today's hours 1 start").boundingBox()
    expect(stageField!.width, `the hours question at ${width}`).toBeGreaterThanOrEqual(
      needed - 1,
    )

    await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
    const calendarField = await calendar(page)
      .getByLabel("Today's hours 1 start")
      .boundingBox()
    expect(calendarField, `the calendar hours editor at ${width}`).not.toBeNull()
    expect(
      calendarField!.width,
      `the calendar hours editor at ${width}`,
    ).toBeGreaterThanOrEqual(needed - 1)
  }
})
