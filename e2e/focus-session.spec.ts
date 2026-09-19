/** A focus session from readiness through completion and recovery. */

import { expect, test } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  blocksOf,
  startDay,
  addStandup,
  shapeDay,
  startBlock,
} from './support/mono'

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
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('45:00')

  // Ten minutes in, the countdown reflects it.
  await page.clock.fastForward('10:00')
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')
  await stage(page).getByRole('button', { name: /Show elapsed time$/ }).click()
  await expect(stage(page).getByRole('button', { name: /Show time remaining$/ })).toHaveText('10:00')

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
  await expect(stage(page).getByText('Break', { exact: true })).toBeVisible()
  // The chosen face carries into the break and labels its time honestly.
  await expect(stage(page).getByText('Break elapsed')).toBeVisible()
  await expect(stage(page).getByRole('button', { name: /Show time remaining$/ })).toHaveText('0:00')

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
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('5:00')

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
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')
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
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')

  await stage(page).getByRole('button', { name: /Show elapsed time$/ }).click()
  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByTitle('Back to the timer')).toContainText('10:00')
  await expect(page.getByTitle('Back to the timer').getByText('focused')).toBeVisible()
  await page.clock.fastForward('05:00')
  await expect(page.getByTitle('Back to the timer')).toContainText('15:00')
  await page.getByRole('link', { name: 'Back to today', exact: true }).click()
  await expect(stage(page).getByRole('button', { name: /Show time remaining$/ })).toHaveText('15:00')
})

test('settings open from the guide, which quotes them', async ({ page }) => {
  // The guide explains each setting using its current value, so it is the one
  // page where you are most likely to want to change one. It used to be the one
  // place you could not.
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(
    page.getByText(/The two block lengths, currently 45 and 20 minutes/),
  ).toBeVisible()

  const deep = page.getByLabel('Deep block', { exact: true })
  // Exact again: the guide's own contents list has a "Settings, one by one".
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(deep).toBeVisible()
  await deep.fill('30')
  await deep.blur()

  await page.keyboard.press('Escape')
  await expect(deep).toBeHidden()
  // Closing settings leaves the guide where it was, not back on the day.
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(
    page.getByText(/The two block lengths, currently 30 and 20 minutes/),
  ).toBeVisible()
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
