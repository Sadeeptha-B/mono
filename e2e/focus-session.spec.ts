import { expect, test, type Locator, type Page } from '@playwright/test'

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
  // `exact` is not optional here. The day's opening question is headed "Are
  // these your hours today?", and a substring match on "Today" — the default —
  // resolves to both it and the calendar's own heading.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
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

/** How much of an element is hidden inside its own scrollbar. Zero if none is. */
const overflowOf = (locator: Locator) =>
  locator.evaluate((el) => el.scrollHeight - el.clientHeight)

/** The commitments already named, listed under the day's first question. */
const fixedList = (page: Page) => stage(page).getByRole('list', { name: 'Fixed today' })

/** The strip of stage dots under the stage. */
const carousel = (page: Page) => page.getByRole('navigation', { name: 'Stages of the day' })

/**
 * Move between the two opening questions using the carousel.
 *
 * Scoped to the strip on purpose: the setup panel also carries a button to the
 * other question, with the same name because it goes the same place. Two
 * controls sharing an accessible name is fine for a reader and ambiguous for a
 * locator, and this helper is specifically about the dots.
 */
async function goToStage(page: Page, name: string) {
  await carousel(page).getByRole('button', { name, exact: true }).click()
}

/**
 * Finish the opening questions. Available from either of them, and from the
 * commitments one with nothing added — an empty day is a complete answer.
 */
async function startDay(page: Page) {
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
}

/**
 * The first commitment is asked for inline on the stage, which is where the
 * requirements put it, and it is now the first thing the day asks. Later ones
 * go through the calendar's own composer.
 */
async function addStandup(page: Page) {
  await page.getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  // Exact matching throughout: "At" is a substring of "What".
  await page.getByLabel('At', { exact: true }).fill('17:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('15')
  await page.getByRole('button', { name: 'Add commitment' }).click()
  await startDay(page)
}

/** Answer both opening questions, with nothing fixed in the day. */
async function shapeDay(page: Page) {
  await startDay(page)
}

async function startBlock(page: Page, purpose: string) {
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block').fill(purpose)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
}

test('the day opens by asking what is already fixed, then for the hours', async ({
  page,
}) => {
  await openMono(page)

  // Commitments come first: they are the part of the day you cannot move, so
  // they decide how much of it is left to declare.
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()

  // An empty day is a complete answer. Before "Start the day" existed, a user
  // with no meetings could never get past this question and never start a block.
  await startDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()

  // And the answer sticks across a reload — it is in the event log.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test('the opening questions can be answered in either order', async ({ page }) => {
  await openMono(page)

  // The carousel is a control while the day is being set up, not just an
  // indicator: both questions are reachable from either one.
  await goToStage(page, "Today's hours")
  await expect(
    stage(page).getByRole('heading', { name: 'Are these your hours today?' }),
  ).toBeVisible()
  await expect(stage(page).getByLabel("Today's hours 1 start")).toHaveValue('09:00')

  await stage(page).getByRole('button', { name: '+ Add a stretch' }).click()
  await stage(page).getByLabel("Today's hours 2 start").fill('20:00')
  await stage(page).getByLabel("Today's hours 2 end").fill('22:00')

  // Back to the other question and forward again: the edit is still there,
  // because the drafts outlive the switch.
  await goToStage(page, "What's already fixed")
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 2 start")).toHaveValue('20:00')

  await startDay(page)
  await expect(page.getByText(/Working until 10:00 PM/)).toBeVisible()
  await expect(calendar(page).getByText('8 PM', { exact: true })).toBeVisible()
})

test('hours edited on one question survive finishing from the other', async ({ page }) => {
  // The regression this guards: the hours draft used to be committed by the
  // hours panel's own button, so answering the questions out of order and
  // finishing from the commitments side dropped the edit on the floor.
  await openMono(page)

  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('20:00')
  await goToStage(page, "What's already fixed")
  await startDay(page)

  await expect(page.getByText(/Working until 8:00 PM/)).toBeVisible()
})

test('the opening questions can be re-opened once the day is under way', async ({
  page,
}) => {
  // Answering them once used to be the only chance: `day/shaped` closed the
  // questions for good and the dots went inert. But what is fixed today and
  // which hours are yours are ordinary facts about a day, and they keep
  // changing — so between blocks the strip goes back to them.
  await openMono(page)
  await shapeDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()

  await goToStage(page, "What's already fixed")
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()

  await page.getByLabel('Next commitment', { exact: true }).fill('Dentist')
  await page.getByLabel('At', { exact: true }).fill('16:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('30')
  await page.getByRole('button', { name: 'Add commitment' }).click()

  // The way out is not "Start the day" a second time: the day has already
  // begun, and `day/shaped` records having been asked rather than the answer.
  await stage(page).getByRole('button', { name: 'Back to the day' }).click()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
  await expect(blocksOf(page, 'Dentist')).toHaveCount(1)

  // Hours edited on the way through are saved by the same button.
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('16:00')
  await stage(page).getByRole('button', { name: 'Back to the day' }).click()
  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()
})

test('the strip never offers the questions while a block is running', async ({ page }) => {
  // The other half of the rule above. Naming the block is the product, so the
  // strip must not become a way to click past it.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the thing')

  await expect(
    carousel(page).getByRole('button', { name: "What's already fixed" }),
  ).toHaveAttribute('aria-disabled', 'true')
  await expect(
    carousel(page).getByRole('button', { name: "Today's hours" }),
  ).toHaveAttribute('aria-disabled', 'true')
})

test("there is only ever one editor of today's hours on screen", async ({ page }) => {
  // Two of them, each holding its own draft, is a race with a user in it: type
  // in both and whichever you save second silently overwrites the first.
  await openMono(page)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeVisible()

  // Going to the question on the stage closes the composer.
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toBeVisible()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeHidden()

  // And opening the composer takes the question back off the stage.
  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeVisible()
  await expect(stage(page).getByLabel("Today's hours 1 end")).toBeHidden()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test('the unanswered day moves to the other question rather than asking twice', async ({
  page,
}) => {
  // The same rule where the setup panel cannot simply close, because the day
  // has not been shaped yet. The question moves; the composer wins the edit.
  await openMono(page)
  await goToStage(page, "Today's hours")

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeVisible()
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
})

test('a commitment can carry the time it costs either side of itself', async ({ page }) => {
  await openMono(page)

  // The 4pm swim: an hour in the pool, half an hour getting there, twenty
  // minutes getting back. Mono must not offer a block at 3:40.
  await page.getByLabel('Next commitment', { exact: true }).fill('Swimming')
  await page.getByLabel('At', { exact: true }).fill('16:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('60')
  await stage(page).getByRole('button', { name: '+ Time either side' }).click()
  await page.getByLabel('Getting ready', { exact: true }).fill('30')
  await page.getByLabel('Getting back', { exact: true }).fill('20')
  await page.getByRole('button', { name: 'Add commitment' }).click()

  // It is listed with what it really costs before the day even starts.
  await expect(stage(page).getByText('Swimming')).toBeVisible()
  await expect(stage(page).getByText(/1h 00m \+ 50m around/)).toBeVisible()

  await startDay(page)

  // Drawn as three things: the swim, and the travel either side of it.
  await expect(blocksOf(page, 'Swimming')).toHaveCount(1)
  await expect(blocksOf(page, 'Getting ready')).toHaveCount(1)
  await expect(blocksOf(page, 'Getting back')).toHaveCount(1)

  // 2:00 to 3:30 is exactly two deep blocks, and nothing is planned into the
  // 3:30-5:20 the swim really occupies.
  const titles = await calendar(page).locator('[title^="Deep ·"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('title') ?? ''),
  )
  expect(titles.some((t) => t.includes('2:00 PM'))).toBe(true)
  expect(titles.some((t) => t.includes('2:45 PM'))).toBe(true)
  expect(titles.some((t) => t.includes('3:30 PM'))).toBe(false)
  expect(titles.some((t) => t.includes('4:00 PM'))).toBe(false)
  expect(titles.some((t) => t.includes('5:00 PM'))).toBe(false)
})

test('the time either side folds away again, and folding it clears it', async ({
  page,
}) => {
  // The fold used to be one-way. A margin still shapes the plan whether or not
  // its field is on screen, so closing it has to mean "this costs nothing
  // either side" rather than "stop showing me what it costs".
  await openMono(page)

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Swimming')
  await stage(page).getByLabel('At', { exact: true }).fill('16:00')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('60')
  await stage(page).getByRole('button', { name: '+ Time either side' }).click()
  await stage(page).getByLabel('Getting ready', { exact: true }).fill('30')

  await stage(page).getByRole('button', { name: '− Time either side' }).click()
  await expect(stage(page).getByLabel('Getting ready', { exact: true })).toBeHidden()

  await stage(page).getByRole('button', { name: 'Add commitment' }).click()
  await expect(stage(page).getByText(/1h 00m$/)).toBeVisible()

  await startDay(page)
  await expect(blocksOf(page, 'Getting ready')).toHaveCount(0)
  await expect(blocksOf(page, 'Swimming')).toHaveCount(1)
})

test('editing a commitment cannot hide what it costs either side', async ({ page }) => {
  // Regression: the fold seeded its state once, at mount, and the opening
  // question's fieldset does not remount between commitments — its draft lives
  // in the panel above it. So a form opened on a new commitment stayed
  // collapsed when it was pointed at one carrying half an hour of travel, and
  // the fold whose whole meaning is "this costs nothing either side" was
  // sitting on thirty minutes that were still shaping the plan.
  await openMono(page)

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Swimming')
  await stage(page).getByLabel('At', { exact: true }).fill('16:00')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('60')
  await stage(page).getByRole('button', { name: '+ Time either side' }).click()
  await stage(page).getByLabel('Getting ready', { exact: true }).fill('30')
  await stage(page).getByLabel('Getting back', { exact: true }).fill('20')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  // A fresh form over a day that already has one: the fold starts closed,
  // which is the state the bug needed.
  await page.reload()
  await expect(stage(page).getByText(/1h 00m \+ 50m around/)).toBeVisible()
  await expect(stage(page).getByLabel('Getting ready', { exact: true })).toBeHidden()

  await stage(page).getByRole('button', { name: 'Edit Swimming' }).click()
  await expect(stage(page).getByLabel('Getting ready', { exact: true })).toHaveValue('30')
  await expect(stage(page).getByLabel('Getting back', { exact: true })).toHaveValue('20')

  // And it closes again once the form is back to adding, because what is on
  // screen follows the draft rather than the last thing that was clicked.
  await stage(page).getByRole('button', { name: 'Save commitment' }).click()
  await expect(stage(page).getByLabel('Getting ready', { exact: true })).toBeHidden()
  await expect(stage(page).getByText(/1h 00m \+ 50m around/)).toBeVisible()
})

test('the opening question lists commitments in the order the day happens', async ({
  page,
}) => {
  // Insertion order is the order you remembered them in, which is no order at
  // all. The list is a reading of the day, so it reads like the day.
  await openMono(page)

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Swimming')
  await stage(page).getByLabel('At', { exact: true }).fill('16:00')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  await stage(page).getByLabel('At', { exact: true }).fill('09:00')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  const rows = fixedList(page).getByRole('listitem')
  await expect(rows.first()).toContainText('Daily standup')
  await expect(rows.last()).toContainText('Swimming')
})

test('the axis starts where the day does, not where the hours do', async ({ page }) => {
  // Regression: a work region held the top of the grid open even with nothing
  // in it. Opening Mono at two against a nine-to-six day put five empty hours
  // above everything worth looking at — beside the stage that is dead scroll
  // the column skips past, but stacked under it on a phone it was the entire
  // first screenful of calendar, and the day looked empty when it was full.
  await openMono(page)
  await shapeDay(page)

  await expect(calendar(page).getByText('2 PM', { exact: true })).toBeVisible()
  await expect(calendar(page).getByText('9 AM', { exact: true })).toHaveCount(0)
  await expect(calendar(page).getByText('1 PM', { exact: true })).toHaveCount(0)

  // Only *empty* hours go. Anything that happened up there still reaches back
  // for them, because it is an entry rather than a region.
  await goToStage(page, "What's already fixed")
  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Standup')
  await stage(page).getByLabel('At', { exact: true }).fill('09:00')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  await expect(calendar(page).getByText('9 AM', { exact: true })).toBeVisible()
  await expect(blocksOf(page, 'Standup')).toHaveCount(1)
})

test('the commitment form folds away once the day has something in it', async ({
  page,
}) => {
  await openMono(page)

  // Nothing fixed yet, so the form is the question and there is nothing to
  // fold back to.
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toBeVisible()
  await expect(stage(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  await stage(page).getByLabel('At', { exact: true }).fill('17:00')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  // Still open straight after adding: the commonest next thing is another one.
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toBeVisible()

  await stage(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toBeHidden()
  await expect(
    stage(page).getByRole('button', { name: '+ Another commitment' }),
  ).toBeVisible()

  // Coming back to the question shows the answer, not the next question.
  await goToStage(page, "Today's hours")
  await goToStage(page, "What's already fixed")
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toBeHidden()
  await expect(fixedList(page).getByRole('listitem')).toHaveCount(1)

  // The ✎ opens it pointed at the row, whatever the fold was doing.
  await stage(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  await expect(stage(page).getByLabel('This commitment', { exact: true })).toHaveValue(
    'Daily standup',
  )
  await stage(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(
    stage(page).getByRole('button', { name: '+ Another commitment' }),
  ).toBeVisible()

  // And with the list empty again the question needs the form back, without
  // anything having to notice the removal.
  await stage(page).getByRole('button', { name: 'Remove Daily standup' }).click()
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toBeVisible()
})

test('arriving at the question folds away a form nobody was using', async ({
  page,
}) => {
  // The fold resets on arrival, and an edit is part of what folds — but only
  // one that is merely open. Losing what somebody typed because they glanced at
  // the other question is the older and worse bug, so anything actually written
  // survives the trip.
  await openMono(page)
  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  await stage(page).getByLabel('At', { exact: true }).fill('17:00')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()
  await stage(page).getByRole('button', { name: 'Cancel' }).click()

  // Opened and left alone: gone on return.
  await stage(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  await expect(stage(page).getByLabel('This commitment', { exact: true })).toBeVisible()
  await goToStage(page, "Today's hours")
  await goToStage(page, "What's already fixed")
  await expect(stage(page).getByLabel('This commitment', { exact: true })).toBeHidden()
  await expect(
    stage(page).getByRole('button', { name: '+ Another commitment' }),
  ).toBeVisible()

  // Opened and changed: still there, still pointed at the same row.
  await stage(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  await stage(page).getByLabel('This commitment', { exact: true }).fill('Design review')
  await goToStage(page, "Today's hours")
  await goToStage(page, "What's already fixed")
  await expect(stage(page).getByLabel('This commitment', { exact: true })).toHaveValue(
    'Design review',
  )
  await stage(page).getByRole('button', { name: 'Cancel' }).click()

  // And the same promise for a half-written *new* one: the fold closes over it
  // on the way out, and reopening finds it rather than a fresh form.
  await stage(page).getByRole('button', { name: '+ Another commitment' }).click()
  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Dentist')
  await goToStage(page, "Today's hours")
  await goToStage(page, "What's already fixed")
  await stage(page).getByRole('button', { name: '+ Another commitment' }).click()
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toHaveValue(
    'Dentist',
  )
})

test('a commitment just after midnight does not pull yesterday onto the axis', async ({
  page,
}) => {
  // The planner scopes the day by when a thing starts, which leaves the two
  // ways a *span* can reach out of it. Ten past midnight with half an hour of
  // getting ready begins at twenty to twelve the night before, and that one
  // entry used to drag the whole axis back across the night.
  await openMono(page, new Date(2026, 7, 20, 8, 0, 0))

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Night flight')
  await stage(page).getByLabel('At', { exact: true }).fill('00:10')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('60')
  await stage(page).getByRole('button', { name: '+ Time either side' }).click()
  await stage(page).getByLabel('Getting ready', { exact: true }).fill('30')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()
  await startDay(page)

  // The day starts at midnight and no earlier.
  await expect(calendar(page).getByText('12 AM', { exact: true })).toBeVisible()
  await expect(calendar(page).getByText('11 PM', { exact: true })).toHaveCount(0)

  // Both are still drawn — the part of them that is today — and the block still
  // says what the commitment really is.
  await expect(blocksOf(page, 'Night flight')).toHaveCount(1)
  await expect(blocksOf(page, 'Getting ready')).toHaveAttribute(
    'title',
    'Getting ready · 11:40 PM · 30m',
  )
})

test('a commitment can be rewritten from the opening question', async ({ page }) => {
  // The same affordance the calendar block carries, on the row that names it —
  // and the same rule behind it: editing keeps the id, so the plan re-derives
  // around the same thing moved rather than around a second one.
  await openMono(page)

  await stage(page).getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  await stage(page).getByLabel('At', { exact: true }).fill('17:00')
  await stage(page).getByLabel('For (minutes)', { exact: true }).fill('15')
  await stage(page).getByRole('button', { name: 'Add commitment' }).click()

  await stage(page).getByRole('button', { name: 'Edit Daily standup' }).click()
  const what = stage(page).getByLabel('This commitment', { exact: true })
  await expect(what).toHaveValue('Daily standup')
  await expect(stage(page).getByLabel('At', { exact: true })).toHaveValue('17:00')

  await what.fill('Design review')
  await stage(page).getByLabel('At', { exact: true }).fill('16:00')
  await stage(page).getByRole('button', { name: 'Save commitment' }).click()

  // Moved and renamed, not duplicated, and the form is back to adding.
  await expect(fixedList(page).getByRole('listitem')).toHaveCount(1)
  await expect(stage(page).getByLabel('Next commitment', { exact: true })).toHaveValue('')

  await startDay(page)
  await expect(blocksOf(page, 'Daily standup')).toHaveCount(0)
  await expect(blocksOf(page, 'Design review')).toHaveAttribute(
    'title',
    'Design review · 4:00 PM · 15m',
  )
})

test('the calendar follows the hours question as it is typed', async ({ page }) => {
  // Regression: the hours draft lived in the panel, so the day drawn beside it
  // went on showing the old shape until "Start the day". The plan is a pure
  // function, so the draft is simply fed to it — nothing is written until the
  // question is finished.
  await openMono(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()

  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('20:00')

  await expect(page.getByText(/Working until 8:00 PM/)).toBeVisible()
  await expect(calendar(page).getByText('7 PM', { exact: true })).toBeVisible()

  // Still a draft: the composer, which edits the saved thing, is unchanged.
  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
})

test('plans the runway on a time axis and charges a break against the plan', async ({
  page,
}) => {
  await openMono(page)

  // A day with no shape asks for one, in place rather than behind a button.
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()

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

test('settings open from the guide, which quotes them', async ({ page }) => {
  // The guide explains each setting using its current value, so it is the one
  // page where you are most likely to want to change one. It used to be the one
  // place you could not.
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()

  const deep = page.getByLabel('Deep block', { exact: true })
  // Exact again: the guide's own contents list has a "Settings, one by one".
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(deep).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(deep).toBeHidden()
  // Closing settings leaves the guide where it was, not back on the day.
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
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

test('an open calendar editor closes when Mono asks what happened', async ({ page }) => {
  // "You were away" is an interruption rather than a stage — the strip hides
  // itself for it, because nothing is recorded until it is answered. An editor
  // left expanded beside it is somewhere else for that click to land.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the planner tests')

  await calendar(page).getByRole('button', { name: '+ Commitment' }).click()
  await expect(calendar(page).getByLabel('What', { exact: true })).toBeVisible()

  // The machine slept across the end of the block.
  await page.clock.setSystemTime(new Date(2026, 7, 20, 16, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(stage(page).getByText('You were away')).toBeVisible()
  await expect(calendar(page).getByLabel('What', { exact: true })).toBeHidden()
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

  // And the same for the calendar's own composer.
  await page.getByRole('button', { name: 'Add commitment' }).click()
  await startDay(page)
  await calendar(page).getByRole('button', { name: '+ Commitment' }).click()

  const composerTitle = calendar(page).getByLabel('What', { exact: true })
  await composerTitle.pressSequentially('Design review', { delay: 120 })
  await page.waitForTimeout(1500)
  await expect(composerTitle).toHaveValue('Design review')
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

/** Just before midnight, so the tab can be left open across the day boundary. */
const LATE = new Date(2026, 7, 20, 23, 50, 0)

/** Roll the clock into the small hours of the next day and let a tick land. */
async function crossMidnight(page: Page) {
  await page.clock.setSystemTime(new Date(2026, 7, 21, 0, 1, 0))
  await page.clock.fastForward('00:02')
}

test('the calendar editors do not carry a draft into the next day', async ({ page }) => {
  // Regression: the composers seeded their state once, at mount, and nothing
  // closed them at the rollover. An hours draft edited at 23:59 could be saved
  // at 00:01 and would land as an override on a day it was never about.
  await openMono(page, LATE)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByLabel("Today's hours 1 end").fill('22:00')

  await crossMidnight(page)

  // The editor is gone, and yesterday's draft with it.
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeHidden()
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()

  // Reopening seeds from the new day's own shape, not from what was typed.
  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')
})

test("yesterday stays in the journal and off today's axis", async ({ page }) => {
  // Regression: history survives the midnight reset by design — it is the
  // journal — and the planner drew every segment in it. So the axis reached
  // back to the first block ever recorded: on a phone, where nothing scrolls
  // itself to now, the calendar opened days before today.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Ship the thing')
  await page.clock.fastForward('10:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  // Drawn on the day it happened.
  await expect(blocksOf(page, 'Deep (cut short)')).toHaveCount(1)

  // Tomorrow morning, with the tab still open.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 9, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(blocksOf(page, 'Deep (cut short)')).toHaveCount(0)
  // And the axis does not span the night to reach it: 3 AM is only ever a row
  // on a timeline that started yesterday.
  await expect(calendar(page).getByText('3 AM', { exact: true })).toHaveCount(0)
})

test('an unanswered day left open overnight reopens on the first question', async ({
  page,
}) => {
  // Regression: the reset watched `shapedAt`, which never changes when the day
  // was not answered in the first place — so this, the case it mattered most
  // for, was exactly the one it missed.
  await openMono(page, LATE)
  await goToStage(page, "Today's hours")
  await expect(
    stage(page).getByRole('heading', { name: 'Are these your hours today?' }),
  ).toBeVisible()

  await crossMidnight(page)

  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
})

test('the opening questions do not carry a draft into the next day', async ({ page }) => {
  await openMono(page, LATE)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await crossMidnight(page)

  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  // And starting the new day leaves it following the recurring shape, rather
  // than overriding it with what was typed yesterday.
  await startDay(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
})

/** Hand a file straight to the import control, without going via a download. */
async function importSession(page: Page, contents: unknown) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'mono-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(contents)),
  })
  await page.keyboard.press('Escape')
}

test('an import replaces the opening questions, even one for the same day', async ({
  page,
}) => {
  // The nastiest version of this bug: a same-day import into a day that was
  // never answered moves neither the date nor the answered flag, so there was
  // nothing for the UI to notice. The session generation is the fact itself.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await importSession(page, { version: 2, dayKey: '2026-08-20', events: [] })

  // Back to the first question, with nothing carried over from before.
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  await startDay(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
})

test('the hours question follows the recurring shape until it is edited', async ({
  page,
}) => {
  // An untouched draft is not a snapshot. Change the shape every day starts
  // from while the question is open, and the question has to be asking about
  // the new shape — not quietly holding the old one ready to save back over it.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('16:00')
  await page.keyboard.press('Escape')

  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('16:00')

  // And starting the day leaves it following that shape rather than overriding
  // it with what the panel happened to be showing when it mounted.
  await startDay(page)
  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()
})

test('an edited hours draft is left alone when the default shape changes', async ({
  page,
}) => {
  // The other side of it: following the day is for a draft nobody has touched.
  // Clearing what someone is in the middle of typing would be its own bug.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('16:00')
  await page.keyboard.press('Escape')

  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('22:00')

  await startDay(page)
  await expect(page.getByText(/Working until 10:00 PM/)).toBeVisible()
})

test('a new day opens on the first question, whatever yesterday ended on', async ({
  page,
}) => {
  // Regression: the setup carousel's position was component state and nothing
  // put it back at the day reset, so a tab left open overnight reopened on
  // whichever question was last looked at.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await startDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()

  // Midnight, with the tab still open. Nothing is running, so the day rolls.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 9, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
})

test('plans nothing once the working day is over', async ({ page }) => {
  // 9pm against the default 9-6 shape. This is the case that used to run the
  // plan on to midnight regardless of the setting.
  await openMono(page, new Date(2026, 7, 20, 21, 0, 0))
  await shapeDay(page)

  await expect(stage(page).getByRole('heading', { name: 'Day done' })).toBeVisible()
  await expect(blocksOf(page, 'Deep')).toHaveCount(0)
  await expect(page.getByText('0 blocks ahead · 0m of focus')).toBeVisible()
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
  // DOM to assert on. So the guard is arithmetic: measure what one of these
  // needs, then check what each surface actually gives it. Settings on a phone
  // is the tightest of the three, being a dialog inside a screen.
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 740 })
    await openMono(page)

    const needed = await page.evaluate(() => {
      const probe = document.createElement('input')
      probe.type = 'time'
      probe.value = '09:00'
      probe.style.cssText =
        'position:absolute;left:-9999px;width:auto;padding:10px 8px;border:1px solid;font:inherit'
      document.body.appendChild(probe)
      const natural = probe.getBoundingClientRect().width
      probe.remove()
      return natural
    })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const field = await page.getByLabel('Working hours 1 start').boundingBox()
    expect(field, `settings at ${width}`).not.toBeNull()
    expect(field!.width, `settings at ${width}`).toBeGreaterThanOrEqual(needed - 1)
    await page.keyboard.press('Escape')

    await goToStage(page, "Today's hours")
    const stageField = await stage(page).getByLabel("Today's hours 1 start").boundingBox()
    expect(stageField!.width, `the hours question at ${width}`).toBeGreaterThanOrEqual(
      needed - 1,
    )
  }
})

test('a browser that will not save says so, and keeps working', async ({ page }) => {
  // The failure Mono cannot recover from on its own: the log is the one thing
  // here that cannot be rebuilt from anything else, and a quota error is a
  // silent way to lose a day. Uncaught it is worse than silent — zustand's
  // persist throws it out of the store action, so the click that shaped the day
  // would shape it and then not finish leaving the question.
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    let refusing = true
    Object.assign(window, { __allowSaving: () => (refusing = false) })
    Storage.prototype.setItem = function (key: string, value: string) {
      if (refusing && key === 'mono.session') {
        throw new DOMException('exceeded', 'QuotaExceededError')
      }
      return original.call(this, key, value)
    }
  })

  // Mono records the day it woke up on, so the very first write is on load and
  // the warning is up before anything has been asked of it.
  await openMono(page)
  await expect(page.getByRole('button', { name: 'Not saving' })).toBeVisible()

  // The gesture still finishes: the day shapes and the stage moves on.
  await startDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Not saving' })).toBeVisible()

  // And it leads to the one thing that can rescue the day.
  await page.getByRole('button', { name: 'Not saving' }).click()
  await expect(page.getByRole('alert')).toContainText('Export now')
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('Escape')

  // A write that lands carries the whole log, so it catches up on everything
  // the refused ones missed — and there is nothing left to warn about.
  await page.evaluate(() => (window as unknown as { __allowSaving: () => void }).__allowSaving())
  await page.getByRole('button', { name: 'Start deep block' }).click()
  await expect(page.getByRole('button', { name: 'Not saving' })).toHaveCount(0)
})

/**
 * Document Picture-in-Picture, stubbed with a same-origin iframe.
 *
 * Playwright cannot drive a real one. The default run uses
 * `chrome-headless-shell`, which has no browser-window layer to put a
 * picture-in-picture window in, and Playwright only ever promotes CDP targets
 * of type `page` — so even headed, the window would be attached and silently
 * dropped rather than handed over as something to click.
 *
 * What that leaves is still worth testing, and it is the half that is ours: the
 * portal into a foreign document, the stylesheet copy, one store shared by two
 * documents, and a click in the second one moving the session in the first. An
 * iframe's `contentWindow` is a different document in the same origin, which is
 * exactly the shape of the real thing. What it cannot check is the window
 * actually floating above other applications, and its timers surviving a
 * backgrounded tab — both of those are in README's by-hand list.
 */
const MINI = '#mono-mini'

async function stubMiniWindow(page: Page) {
  await page.addInitScript(() => {
    let open: Window | null = null

    const api = {
      get window() {
        return open
      },
      async requestWindow() {
        // Faithful to the algorithm, which is the opposite of what it looks
        // like it should be: a second request does not fail, it *closes the
        // window that is open* and hands back a replacement. Mono's own guards
        // are the only thing standing between a stray second call and the
        // user's window being swapped underneath them, so a stub that refused
        // instead would be testing those guards against a browser that does
        // not exist.
        open?.close()

        const frame = document.createElement('iframe')
        frame.id = 'mono-mini'
        frame.style.cssText =
          'position:fixed;right:0;bottom:0;width:400px;height:320px;border:0;z-index:9999'
        document.body.append(frame)

        const win = frame.contentWindow as Window
        // `close()` on an iframe's window does nothing, so give it the two
        // behaviours the app relies on: `pagehide` fires, and then the document
        // goes away. The event is the whole of how Mono learns about a window
        // the user closed rather than one it closed itself, so a stub without
        // it would quietly pass the test that matters most here.
        Object.defineProperty(win, 'close', {
          configurable: true,
          value: () => {
            if (!open) return
            open = null
            win.dispatchEvent(new Event('pagehide'))
            frame.remove()
          },
        })
        open = win
        return win
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }

    // The window's own close control, which Mono never hears about except
    // through `pagehide`. Named on `window` the way the storage spec names its
    // own escape hatch, because there is no other way to reach a title bar.
    Object.assign(window, { __closeMini: () => open?.close() })

    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: api,
    })
  })
}

test('a browser without the API is not offered the pop-out at all', async ({ page }) => {
  // Hidden rather than deleted: the property lives on `Window.prototype`, so
  // shadowing it with `undefined` on the instance is what "this browser does
  // not have it" looks like from the app's side. Chromium under Playwright
  // does expose the API — it just cannot produce a window from it — so the
  // absent case has to be arranged, the same way the storage test arranges a
  // browser that refuses to save.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: undefined,
    })
  })

  await openMono(page)
  // Nothing at all, rather than a disabled button explaining itself. A window
  // this browser was never going to open costs the user nothing, so there is
  // nothing to apologise for; the guide names the requirement once, where
  // somebody looking for the feature would go.
  await expect(page.getByRole('button', { name: 'Pop out' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('the pop-out carries the running block, and answers for it', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)
  // Already open by the time the block is running: `popOutOnStart` defaults on,
  // so starting a block is what opens it. The header offers to close it rather
  // than to open one, and the test that turns the setting off covers the other
  // way in.
  await startBlock(page, 'Write the migration')
  await expect(page.getByRole('button', { name: 'Close pop-out' })).toBeVisible()

  // A different document entirely: none of these are reachable from a page-level
  // locator, which is also why the mini window's purpose field can keep its own
  // accessible name without making `startBlock` above ambiguous.
  const mini = page.frameLocator(MINI)
  await expect(mini.getByText('Deep block')).toBeVisible()
  await expect(mini.getByText('Write the migration')).toBeVisible()

  // The stylesheet copy is what makes the window legible at all — without it
  // the cat is a silhouette with holes in it and every layout class is inert.
  // The ink background is the cheapest proof the tokens arrived.
  const painted = await page
    .frameLocator(MINI)
    .locator('body')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(painted).toBe('rgb(8, 8, 11)')

  // One store, two documents: a click out here moves the session in there.
  await mini.getByRole('button', { name: 'End early' }).click()
  await expect(stage(page).getByRole('button', { name: 'Start deep block' })).toBeVisible()
  // And the window keeps up rather than going stale on a phase it missed.
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()

  // The same control closes it, and the app carries on without it.
  await page.getByRole('button', { name: 'Close pop-out' }).click()
  await expect(page.locator(MINI)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible()
})

test('the pop-out asks the day to be shaped rather than asking for it', async ({
  page,
}) => {
  await stubMiniWindow(page)
  await openMono(page)

  // Popped out before the day has been given a shape. Hours and commitments
  // need the calendar beside them, and there is no calendar in a window this
  // size, so this is the one question it declines and hands back.
  await page.getByRole('button', { name: 'Pop out' }).click()

  const mini = page.frameLocator(MINI)
  await expect(mini.getByText('Give the day a shape')).toBeVisible()
  await expect(mini.getByRole('textbox')).toHaveCount(0)

  // Answer it in the tab, and the window follows the day into being ready.
  await shapeDay(page)
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()
})

test('a pop-out closed from its own window is noticed', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.getByRole('button', { name: 'Close pop-out' })).toBeVisible()

  // Closed from the window rather than from Mono — the case Mono did not ask
  // for and only hears about through `pagehide`. Missing it would leave the
  // header offering to close a window that is not there, a timer ticking
  // against it, and a portal rendering into a discarded document.
  await page.evaluate(() => (window as unknown as { __closeMini: () => void }).__closeMini())

  await expect(page.locator(MINI)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible()

  // And the app is left in a state that can open another one.
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).getByText('Ready for 45 minutes')).toBeVisible()
})

test('a block starting brings the pop-out with it, by default', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  // Nothing popped out yet: naming the block is still happening in the tab, and
  // a window arriving now would take the focus off the field being typed in.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block', { exact: true }).fill('Write the migration')
  await expect(page.locator(MINI)).toHaveCount(0)

  // The click that starts the timer is the last user gesture before they go
  // elsewhere, and it is the only moment a window can be asked for at all.
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.frameLocator(MINI).getByText('Write the migration')).toBeVisible()
})

test('the pop-out stays put when the setting is off', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('checkbox', { name: 'Pop the timer out when a block starts' })
    .uncheck()
  await page.keyboard.press('Escape')

  await startBlock(page, 'Write the migration')
  await expect(page.locator(MINI)).toHaveCount(0)

  // And the header still gets you there by hand.
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).getByText('Write the migration')).toBeVisible()
})

test('the priorities timer brings the pop-out with it too', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()

  // The other way into a running segment, and a separate handler from the one
  // that submits a purpose — so it needs its own coverage or half the feature
  // is only working by accident.
  await page.getByRole('button', { name: "I can't pick one" }).click()

  await expect(page.frameLocator(MINI).getByText('Priorities')).toBeVisible()
})
