/** The questions and drafts that give a day its shape. */

import { expect, test } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  blocksOf,
  fixedList,
  carousel,
  goToStage,
  startDay,
  shapeDay,
  startBlock,
} from './support/mono'

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
