import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end coverage for the things unit tests cannot reach: that the derived
 * plan actually renders on the calendar, that decisions happen in place rather
 * than behind a modal, and that the timer survives the clock moving underneath
 * it.
 *
 * Playwright's clock control is doing real work here. `fastForward` fires the
 * intervening timers, which is an ordinary running block; `setSystemTime`
 * jumps without firing them, which is exactly what a sleeping laptop looks
 * like to the app.
 */

/** 2pm on a fixed weekday, well clear of any DST boundary. */
const TWO_PM = new Date(2026, 7, 20, 14, 0, 0)

async function openMono(page: Page, time: Date = TWO_PM) {
  // `install` alone leaves the clock ticking, which makes block arithmetic
  // drift by a few hundred milliseconds — enough to turn a 180-minute runway
  // into 179.9 and cost a deep block. Install slightly early, then pause at
  // the exact target so we avoid rewinding while still landing on the right
  // millisecond.
  await page.clock.install({ time: new Date(time.getTime() - 1000) })
  await page.clock.pauseAt(time)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
}

/** The stage, to disambiguate from the same text on the calendar. */
const stage = (page: Page) => page.getByRole('main')
/** The calendar column. */
const calendar = (page: Page) => page.getByRole('complementary')

/**
 * Blocks on the calendar carry a descriptive title, e.g. "Deep · 2:00 PM · 45m".
 *
 * Anchored on purpose. `getByTitle` is substring *and* case-insensitive by
 * default, so a plain "Deep" would also match a commitment the user happened to
 * call "deep dive" — the exact trap this file's header warns about.
 */
const blocksOf = (page: Page, label: string) =>
  calendar(page).locator(`[title^="${label} ·"]`)

/**
 * The first commitment is asked for inline on the stage, which is where the
 * requirements put it. Later ones go through the calendar's own dialog.
 */
async function addStandup(page: Page) {
  await page.getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  // Exact matching throughout: "At" is a substring of "What".
  await page.getByLabel('At', { exact: true }).fill('17:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('15')
  await page.getByRole('button', { name: 'Plan around it' }).click()
}

async function startBlock(page: Page, purpose: string) {
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block').fill(purpose)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
}

test('plans the runway on a time axis and charges a break against the plan', async ({
  page,
}) => {
  await openMono(page)

  // A day with no shape asks for one, in place rather than behind a button.
  await expect(stage(page).getByRole('heading', { name: /What's next in your day/ })).toBeVisible()

  await addStandup(page)

  // The calendar is laid out against real hours.
  await expect(calendar(page).getByText('2 PM', { exact: true })).toBeVisible()
  await expect(calendar(page).getByText('5 PM', { exact: true })).toBeVisible()
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(1)

  // 2pm to a 5pm standup is exactly four 45-minute deep blocks, plus one more
  // in the 45 minutes between the standup ending and working hours ending at 6.
  await expect(blocksOf(page, 'Deep')).toHaveCount(5)

  await startBlock(page, 'Write the planner tests')

  await expect(stage(page).getByText('Deep block')).toBeVisible()
  await expect(stage(page).getByText('Write the planner tests')).toBeVisible()
  await expect(stage(page).getByText('45:00')).toBeVisible()

  // Ten minutes in, the countdown reflects it.
  await page.clock.fastForward('10:00')
  await expect(stage(page).getByText('35:00')).toBeVisible()

  // Run out the rest of the block.
  await page.clock.fastForward('35:00')
  await expect(stage(page).getByRole('heading', { name: 'Need a break?' })).toBeVisible()

  await page.getByRole('button', { name: 'Take a break' }).click()

  // The cost of the break is stated before it is taken — and the calendar
  // stays visible behind it, which is the point of not using a modal.
  await expect(stage(page).getByRole('heading', { name: 'How long?' })).toBeVisible()
  await expect(blocksOf(page, 'Deep')).not.toHaveCount(0)
  await page.getByRole('button', { name: '30m', exact: true }).click()
  await expect(stage(page).getByText(/Costs you|It's free/)).toBeVisible()

  await page.getByRole('button', { name: 'Start break' }).click()
  await expect(stage(page).getByText('Break')).toBeVisible()

  // The finished block is on the calendar, with the purpose it was given.
  await expect(calendar(page).getByText('Write the planner tests')).toBeVisible()
})

test('asks what happened when a block ended while the machine was asleep', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)
  await startBlock(page, 'Write the planner tests')

  // Jump the clock without firing the timers in between: the app was frozen.
  await page.clock.setSystemTime(new Date(2026, 7, 20, 16, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(stage(page).getByText('You were away')).toBeVisible()
  await expect(stage(page).getByRole('heading', { name: 'Did you finish it?' })).toBeVisible()

  // Crucially, nothing was banked while we waited for an answer.
  await page.getByRole('button', { name: 'Finished it' }).click()

  await expect(stage(page).getByText('You were away')).toBeHidden()
  // The unaccounted stretch is on the calendar rather than quietly absorbed.
  await expect(blocksOf(page, 'Away')).toHaveCount(1)
})

test('offers five minutes to think when a purpose will not come', async ({ page }) => {
  await openMono(page)
  await addStandup(page)

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByRole('button', { name: "I can't pick one" }).click()

  await expect(stage(page).getByText('Working out priorities')).toBeVisible()
  await expect(stage(page).getByText('5:00')).toBeVisible()

  await page.clock.fastForward('05:00')

  // Straight back to the question, with the day's shape now worked out.
  await expect(stage(page).getByRole('heading', { name: 'One thing' })).toBeVisible()
  await expect(stage(page).getByText(/Now that the day has a shape/)).toBeVisible()
})

test('survives a reload mid-block', async ({ page }) => {
  await openMono(page)
  await addStandup(page)
  await startBlock(page, 'Write the planner tests')

  await page.clock.fastForward('10:00')
  await page.reload()

  // The block is rebuilt from the event log, and the timer is computed from
  // absolute timestamps rather than anything that could have been lost.
  await expect(stage(page).getByText('Write the planner tests')).toBeVisible()
  await expect(stage(page).getByText('35:00')).toBeVisible()
})

test('the guide is a page of its own, and keeps a running block in sight', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)
  await startBlock(page, 'Write the planner tests')

  await page.getByRole('link', { name: 'Guide', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'A block, start to finish' }),
  ).toBeVisible()

  // The page costs sight of the timer, so the header carries it instead.
  await expect(page.getByTitle('Back to the timer')).toContainText('45:00')

  // The block kept running while the guide was open, on absolute time.
  await page.clock.fastForward('10:00')
  await expect(page.getByTitle('Back to the timer')).toContainText('35:00')

  await page.getByRole('link', { name: 'Back to today', exact: true }).click()
  await expect(stage(page).getByText('Write the planner tests')).toBeVisible()
  await expect(stage(page).getByText('35:00')).toBeVisible()
})

test('reopening the app long after a block ended still asks what happened', async ({
  page,
}) => {
  // Regression: the away check compared the current tick with the previous
  // one, and a fresh page has no previous one — so a block that ended while
  // the tab was closed was banked as completed without asking. Closing the
  // tab has to be worth exactly as much as sleeping the machine.
  await openMono(page)
  await addStandup(page)
  await startBlock(page, 'Write the planner tests')

  await page.clock.setSystemTime(new Date(2026, 7, 20, 16, 0, 0))
  await page.reload()

  await expect(stage(page).getByText('You were away')).toBeVisible()
  await expect(
    stage(page).getByRole('heading', { name: 'Did you finish it?' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Finished it' }).click()
  await expect(blocksOf(page, 'Away')).toHaveCount(1)
})

test('settings close every way they offer, and refuse a nonsense duration', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)

  const deep = page.getByLabel('Deep block', { exact: true })

  // Clearing the field used to write a zero-minute block straight into
  // settings — `Number('')` is 0 — and min/max were decoration.
  await page.getByRole('button', { name: 'Settings' }).click()
  await deep.fill('')
  await deep.blur()
  await expect(deep).toHaveValue('45')

  await deep.fill('999')
  await deep.blur()
  await expect(deep).toHaveValue('180')

  await deep.fill('30')
  await deep.blur()
  await expect(deep).toHaveValue('30')

  // A dialog that offers a close button and escape also closes on a click
  // away: all the ways out, or none of them.
  await page.mouse.click(8, 8)
  await expect(deep).toBeHidden()

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(deep).toBeHidden()

  // The clamped setting survived, and the plan is derived from it.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(deep).toHaveValue('30')
  await page.keyboard.press('Escape')
  await expect(deep).toBeHidden()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test('the commitment form accepts typing while the clock is running', async ({ page }) => {
  // Regression: the form reset itself on every tick, which read as the field
  // clearing on each keystroke.
  await openMono(page)
  await page.clock.resume()

  const title = page.getByLabel('Next commitment', { exact: true })
  await title.pressSequentially('Daily standup', { delay: 120 })
  await page.getByLabel('At', { exact: true }).fill('17:00')

  // More than a tick has passed while typing; nothing should have been wiped.
  await page.waitForTimeout(1500)
  await expect(title).toHaveValue('Daily standup')
  await expect(page.getByLabel('At', { exact: true })).toHaveValue('17:00')

  // And the same for the calendar's own dialog.
  await page.getByRole('button', { name: 'Plan around it' }).click()
  await page.getByRole('button', { name: '+ Commitment' }).click()

  const dialogTitle = page.getByLabel('What', { exact: true })
  await dialogTitle.pressSequentially('Design review', { delay: 120 })
  await page.waitForTimeout(1500)
  await expect(dialogTitle).toHaveValue('Design review')
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
  await page.getByRole('button', { name: '+ Add a stretch' }).click()
  await page.getByLabel('Working hours 2 start').fill('20:00')
  await page.getByLabel('Working hours 2 end').fill('22:00')
  await page.getByRole('button', { name: 'Save for today' }).click()

  // The day now runs to 10, and the evening stretch is planned.
  await expect(page.getByText(/Working until 10:00 PM/)).toBeVisible()
  expect(await blocksOf(page, 'Deep').count()).toBeGreaterThan(before)
  await expect(calendar(page).getByText('8 PM', { exact: true })).toBeVisible()
})

test('says when the next stretch opens instead of planning through a gap', async ({
  page,
}) => {
  // 7pm sits in the gap between a 9-6 day and a 8-10 evening stretch.
  await openMono(page, new Date(2026, 7, 20, 19, 0, 0))

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await page.getByRole('button', { name: '+ Add a stretch' }).click()
  await page.getByLabel('Working hours 2 start').fill('20:00')
  await page.getByLabel('Working hours 2 end').fill('22:00')
  await page.getByRole('button', { name: 'Save for today' }).click()

  await expect(
    stage(page).getByText('Outside working hours', { exact: true }),
  ).toBeVisible()
  await expect(stage(page).getByText(/Nothing scheduled until 8:00 PM/)).toBeVisible()
  // No block can be started in time the user declared unstructured.
  await expect(page.getByRole('button', { name: /Start (deep|short) block/ })).toHaveCount(0)
})

test('plans nothing once the working day is over', async ({ page }) => {
  // 9pm against the default 9-6 shape. This is the case that used to run the
  // plan on to midnight regardless of the setting.
  await openMono(page, new Date(2026, 7, 20, 21, 0, 0))

  await expect(stage(page).getByRole('heading', { name: 'Day done' })).toBeVisible()
  await expect(blocksOf(page, 'Deep')).toHaveCount(0)
  await expect(page.getByText('0 blocks ahead · 0m of focus')).toBeVisible()
})
