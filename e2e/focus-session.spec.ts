/** A focus session from readiness through completion and recovery. */

import { expect, test } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  carousel,
  blocksOf,
  startDay,
  addBlockTask,
  addStandup,
  importSession,
  shapeDay,
  startBlock,
} from './support/mono'

test('plans the runway on a time axis and charges a break against the plan', async ({
  page,
}) => {
  await openMono(page)

  // A day with no shape asks for one, in place rather than behind a button.
  await expect(
    stage(page).getByRole('heading', { name: "What are your commitments for today?" }),
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

test('offers five minutes to decide when a purpose will not come, and records none of it', async ({
  page,
}) => {
  await openMono(page)
  await addStandup(page)

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  // A timer on the question, not a block of its own with a stage of its own.
  await expect(stage(page).getByRole('button', { name: "I can't pick one" })).toHaveCount(0)
  await expect(carousel(page).getByRole('button', { name: 'Priorities' })).toHaveCount(0)

  await stage(page).getByRole('button', { name: 'Take 5 mins to decide' }).click()
  await expect(stage(page).getByLabel('Time left to decide')).toHaveText('5:00')
  await page.clock.fastForward('05:00')

  // At zero it stops, and the question is still the question.
  await expect(stage(page)).toContainText("Time's up")
  await expect(
    stage(page).getByRole('heading', { name: 'Your purpose for this block' }),
  ).toBeVisible()

  // The block starts when it is named, so none of that time is charged to it.
  await addBlockTask(page)
  await stage(page).getByLabel('Purpose for this block', { exact: true }).fill('Write the plan')
  await stage(page).getByRole('button', { name: 'Start', exact: true }).click()
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText(
    /^(45|20):00$/,
  )
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

  await page.getByRole('link', { name: 'Mono — back to today', exact: true }).click()
  await expect(stage(page).getByText('Write the planner tests')).toBeVisible()
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')

  await stage(page).getByRole('button', { name: /Show elapsed time$/ }).click()
  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByTitle('Back to the timer')).toContainText('10:00')
  await expect(page.getByTitle('Back to the timer').getByText('focused')).toBeVisible()
  await page.clock.fastForward('05:00')
  await expect(page.getByTitle('Back to the timer')).toContainText('15:00')
  await page.getByRole('link', { name: 'Mono — back to today', exact: true }).click()
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

  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
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
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()
  await startDay(page)
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()

  const composerTitle = calendar(page).getByLabel('What', { exact: true })
  await composerTitle.pressSequentially('Design review', { delay: 120 })
  await page.waitForTimeout(1500)
  await expect(composerTitle).toHaveValue('Design review')
})

test('a block keeps a log and a count of urges, and the calendar shows them where they happened', async ({
  page,
}) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')

  // Counting is one click, and a mis-tap is one more to take back.
  const urges = stage(page).getByRole('group', { name: 'Urges' })
  const count = urges.locator('[aria-live]')
  await expect(count).toHaveText('0')
  await urges.getByRole('button', { name: 'Count an urge' }).click()
  await urges.getByRole('button', { name: 'Count an urge' }).click()
  await expect(count).toHaveText('2')
  await urges.getByRole('button', { name: 'Take back the last urge' }).click()
  await expect(count).toHaveText('1')

  // The log is closed until asked for, and closes again once a line is kept.
  const write = stage(page).getByRole('button', { name: 'Write a log' })
  const log = stage(page).getByLabel('Log', { exact: true })
  await expect(log).toHaveCount(0)
  await write.click()
  await log.fill('Shcema done')
  await log.press('Enter')
  await expect(log).toHaveCount(0)
  await page.clock.fastForward('10:00')
  await write.click()
  await log.fill('Stuck on the foreign key')
  await stage(page).getByRole('button', { name: 'Log', exact: true }).click()

  const logs = stage(page).getByRole('list', { name: 'Logs in this block' })
  await expect(logs.getByRole('listitem')).toHaveCount(2)

  // A mistype is put right where it is listed, and keeps the minute it was
  // written at.
  await logs.getByRole('button', { name: 'Edit log at 2:00 PM' }).click()
  const fix = logs.getByRole('textbox', { name: 'Change the log at 2:00 PM' })
  await fix.fill('Schema done')
  await fix.press('Enter')
  await expect(logs).toContainText('2:00 PM')
  await expect(logs).toContainText('Schema done')

  // Long enough for the block to be drawn tall enough to hold its tasks.
  await page.clock.fastForward('20:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  const block = blocksOf(page, 'Deep (cut short)')
  await expect(block).toHaveAttribute('title', /· 2 logs · 1 urge$/)
  // The block prints what it was for; its logs are marks on its edge.
  await expect(block).toContainText('The task at hand')
  await expect(block).not.toContainText('Schema done')

  // Each log is a mark at its minute. Pointing at it shows that one log, which
  // can be corrected or deleted there long after the block is over.
  await calendar(page).getByRole('button', { name: 'Log at 2:10 PM', exact: true }).hover()
  await expect(calendar(page).getByText('Stuck on the foreign key', { exact: true })).toBeVisible()
  await calendar(page).getByRole('button', { name: 'Edit log at 2:10 PM' }).click()
  const later = calendar(page).getByRole('textbox', { name: 'Change the log at 2:10 PM' })
  await later.fill('Unstuck: it was the index')
  await later.press('Enter')
  await calendar(page).getByRole('button', { name: 'Log at 2:10 PM', exact: true }).hover()
  await expect(
    calendar(page).getByText('Unstuck: it was the index', { exact: true }),
  ).toBeVisible()

  await calendar(page).getByRole('button', { name: 'Log at 2:00 PM', exact: true }).hover()
  await calendar(page).getByRole('button', { name: 'Delete log at 2:00 PM' }).click()
  await expect(calendar(page).getByRole('button', { name: 'Log at 2:00 PM', exact: true })).toHaveCount(0)
  await expect(block).toHaveAttribute('title', /· 1 log · 1 urge$/)
})

test('every log is reached on a block too short to hold them apart', async ({ page }) => {
  // Twenty minutes holds three marks a pointer's width apart. Squeezed
  // together, the marks used to overlap, and a log under another mark could
  // no longer be opened. Now the nearest logs share a mark, and the urges sit
  // under the logs rather than being pushed among them.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  const log = async (text: string) => {
    await stage(page).getByRole('button', { name: 'Write a log' }).click()
    await stage(page).getByLabel('Log', { exact: true }).fill(text)
    await stage(page).getByLabel('Log', { exact: true }).press('Enter')
  }
  await log('Schema done')
  await page.clock.fastForward('01:00')
  await log('Shcema checked')
  for (let i = 0; i < 5; i++) {
    await page.clock.fastForward('01:00')
    await stage(page).getByRole('button', { name: 'Count an urge' }).click()
  }
  await page.clock.fastForward('02:00')
  await log('Indexes next')
  await page.clock.fastForward('07:00')
  await log('Foreign keys done')
  await page.clock.fastForward('05:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  // The two written a minute apart share one mark, which opens both.
  const stack = calendar(page).getByRole('button', {
    name: '2 logs, 2:00 PM to 2:01 PM',
    exact: true,
  })
  await stack.hover()
  await expect(calendar(page).getByText('Schema done', { exact: true })).toBeVisible()
  await expect(calendar(page).getByText('Shcema checked', { exact: true })).toBeVisible()

  // Each of them is put right from there, like any other.
  await calendar(page).getByRole('button', { name: 'Edit log at 2:01 PM' }).click()
  const fix = calendar(page).getByRole('textbox', { name: 'Change the log at 2:01 PM' })
  await fix.fill('Schema checked')
  await fix.press('Enter')
  await stack.hover()
  await expect(calendar(page).getByText('Schema checked', { exact: true })).toBeVisible()

  // The rest keep marks of their own.
  for (const [time, text] of [
    ['2:08 PM', 'Indexes next'],
    ['2:15 PM', 'Foreign keys done'],
  ] as const) {
    await calendar(page).getByRole('button', { name: `Log at ${time}`, exact: true }).hover()
    await expect(calendar(page).getByText(text, { exact: true })).toBeVisible()
  }
  await expect(blocksOf(page, 'Deep (cut short)')).toHaveAttribute(
    'title',
    /· 4 logs · 5 urges$/,
  )
})

test('a log being corrected on the calendar does not outlive the session it was about', async ({
  page,
}) => {
  // Regression: the card kept its edit across an import. Saved afterwards, it
  // wrote its pre-import words over the imported log that took the same id.
  const ten = new Date(2026, 7, 20, 10, 0, 0).getTime()
  const minute = 60_000
  const day = (text: string) => ({
    version: 6,
    dayKey: '2026-08-20',
    events: [
      { type: 'day/shaped', at: ten - 60 * minute },
      {
        type: 'block/started', at: ten, id: 'morning', blockKind: 'deep',
        endsAt: ten + 45 * minute, purpose: 'Write the migration',
      },
      { type: 'block/noted', at: ten + 5 * minute, id: 'note', text },
      { type: 'block/completed', at: ten + 45 * minute },
    ],
  })
  await openMono(page)
  await importSession(page, day('Shcema done'))

  const mark = calendar(page).getByRole('button', { name: 'Log at 10:05 AM', exact: true })
  const fix = calendar(page).getByRole('textbox', { name: 'Change the log at 10:05 AM' })
  await mark.hover()
  await calendar(page).getByRole('button', { name: 'Edit log at 10:05 AM' }).click()
  await fix.fill('Stale edit')

  await importSession(page, day('Schema done'))
  await expect(fix).toHaveCount(0)
  await mark.hover()
  await expect(calendar(page).getByText('Schema done', { exact: true })).toBeVisible()
})

test('an edit under way survives its log moving to another mark', async ({ page }) => {
  // Regression: the edit belonged to the mark. Deleting the log that shared
  // it regrouped the block, the edited log was drawn on a new mark, and what
  // had been typed went with the old one.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  const log = async (text: string) => {
    await stage(page).getByRole('button', { name: 'Write a log' }).click()
    await stage(page).getByLabel('Log', { exact: true }).fill(text)
    await stage(page).getByLabel('Log', { exact: true }).press('Enter')
  }
  await log('Wrong block')
  await page.clock.fastForward('01:00')
  await log('Shcema checked')
  await page.clock.fastForward('07:00')
  await log('Indexes next')
  await page.clock.fastForward('07:00')
  await log('Foreign keys done')
  await page.clock.fastForward('05:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  await calendar(page)
    .getByRole('button', { name: '2 logs, 2:00 PM to 2:01 PM', exact: true })
    .hover()
  await calendar(page).getByRole('button', { name: 'Edit log at 2:01 PM' }).click()
  const fix = calendar(page).getByRole('textbox', { name: 'Change the log at 2:01 PM' })
  await fix.fill('Schema che')
  await calendar(page).getByRole('button', { name: 'Delete log at 2:00 PM' }).click()

  await expect(calendar(page).getByRole('button', { name: /^2 logs/ })).toHaveCount(0)
  await expect(fix).toHaveValue('Schema che')
  await expect(fix).toBeFocused()
  await fix.fill('Schema checked')
  await fix.press('Enter')
  await calendar(page).getByRole('button', { name: 'Log at 2:01 PM', exact: true }).hover()
  await expect(calendar(page).getByText('Schema checked', { exact: true })).toBeVisible()
})

test('a log is reached from an urge beside it', async ({ page }) => {
  // Regression: an urge pointed at rose above everything near it, its target
  // with its card, and moving on to a log a few minutes later found the urge.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  await page.clock.fastForward('10:00')
  await stage(page).getByRole('button', { name: 'Count an urge' }).click()
  await page.clock.fastForward('03:00')
  await stage(page).getByRole('button', { name: 'Write a log' }).click()
  await stage(page).getByLabel('Log', { exact: true }).fill('Back on the schema')
  await stage(page).getByLabel('Log', { exact: true }).press('Enter')
  await page.clock.fastForward('17:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  const mark = calendar(page).getByRole('button', { name: 'Log at 2:13 PM', exact: true })
  await mark.scrollIntoViewIfNeeded()
  const box = (await mark.boundingBox())!
  // Just above the log's target, where only the urge's reaches.
  await page.mouse.move(box.x + box.width / 2, box.y - 2)
  await mark.hover()
  await expect(calendar(page).getByText('Back on the schema', { exact: true })).toBeVisible()
})

test('a card stays in view in a crowded stretch of the calendar', async ({ page }) => {
  // Regression: a card was a fixed width, opened leftward from its block. A
  // block in the first of three lanes put the start of its log, time and all,
  // outside the column.
  const ten = new Date(2026, 7, 20, 10, 0, 0).getTime()
  const minute = 60_000
  await openMono(page)
  await importSession(page, {
    version: 6,
    dayKey: '2026-08-20',
    events: [
      { type: 'day/shaped', at: ten - 60 * minute },
      {
        type: 'block/started', at: ten, id: 'morning', blockKind: 'deep',
        endsAt: ten + 45 * minute, purpose: 'Write the migration',
      },
      { type: 'block/noted', at: ten + 5 * minute, id: 'note', text: 'Schema done' },
      ...[10, 15].map((start, i) => ({
        type: 'commitment/added',
        at: ten,
        commitment: {
          id: `call-${i}`, title: `Call ${i + 1}`, startsAt: ten + start * minute, durationMin: 20,
        },
      })),
      { type: 'block/completed', at: ten + 45 * minute },
    ],
  })

  const mark = calendar(page).getByRole('button', { name: 'Log at 10:05 AM', exact: true })
  await mark.hover()
  const column = (await calendar(page).locator('.mono-scroll').first().boundingBox())!
  const time = calendar(page).getByText('10:05 AM', { exact: true })
  await expect(time).toBeVisible()
  const edges = [
    (await time.boundingBox())!,
    (await calendar(page).getByRole('button', { name: 'Delete log at 10:05 AM' }).boundingBox())!,
  ]
  for (const edge of edges) {
    expect(edge.x).toBeGreaterThanOrEqual(column.x)
    expect(edge.x + edge.width).toBeLessThanOrEqual(column.x + column.width)
  }
})

test('a correction begun on the calendar outlasts the block ending', async ({ page }) => {
  // Regression: the calendar drew a block that had just ended as a new one,
  // and an edit under way in one of its cards went with the old.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  await stage(page).getByRole('button', { name: 'Write a log' }).click()
  await stage(page).getByLabel('Log', { exact: true }).fill('Shcema done')
  await stage(page).getByLabel('Log', { exact: true }).press('Enter')
  await page.clock.fastForward('10:00')

  await calendar(page).getByRole('button', { name: 'Log at 2:00 PM', exact: true }).hover()
  await calendar(page).getByRole('button', { name: 'Edit log at 2:00 PM' }).click()
  const fix = calendar(page).getByRole('textbox', { name: 'Change the log at 2:00 PM' })
  await fix.fill('Schema do')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  await expect(blocksOf(page, 'Deep (cut short)')).toHaveCount(1)
  await expect(fix).toHaveValue('Schema do')
  await fix.fill('Schema done')
  await fix.press('Enter')
  await calendar(page).getByRole('button', { name: 'Log at 2:00 PM', exact: true }).hover()
  await expect(calendar(page).getByText('Schema done', { exact: true })).toBeVisible()
})

test('an open card follows its block into a narrower lane', async ({ page }) => {
  // Regression: a card was placed as it opened and not again, so a commitment
  // added beside the block while one of its logs was being corrected moved the
  // block into the second lane and left the card hanging out of the column.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  await stage(page).getByRole('button', { name: 'Write a log' }).click()
  await stage(page).getByLabel('Log', { exact: true }).fill('Shcema done')
  await stage(page).getByLabel('Log', { exact: true }).press('Enter')

  await calendar(page).getByRole('button', { name: 'Log at 2:00 PM', exact: true }).hover()
  await calendar(page).getByRole('button', { name: 'Edit log at 2:00 PM' }).click()
  const fix = calendar(page).getByRole('textbox', { name: 'Change the log at 2:00 PM' })
  await fix.fill('Schema do')

  // Starting with the block and over first, the commitment takes the first lane.
  await calendar(page).getByRole('button', { name: 'Commitment', exact: true }).click()
  await calendar(page).getByLabel('What', { exact: true }).fill('Review')
  await calendar(page).getByLabel('At', { exact: true }).fill('14:00')
  await calendar(page).getByLabel('For (minutes)', { exact: true }).fill('20')
  await calendar(page).getByRole('button', { name: 'Add', exact: true }).click()
  await expect(blocksOf(page, 'Review')).toHaveCount(1)

  const column = (await calendar(page).locator('.mono-scroll').first().boundingBox())!
  const field = (await fix.boundingBox())!
  expect(field.x).toBeGreaterThanOrEqual(column.x)
  expect(field.x + field.width).toBeLessThanOrEqual(column.x + column.width)
  await expect(fix).toHaveValue('Schema do')
})

test('a card opened from the keyboard is kept in view as the window changes', async ({
  page,
}) => {
  // Regression: only a card pointed at or being edited was placed again on a
  // resize, so one opened by focus kept the room it had been given.
  const ten = new Date(2026, 7, 20, 10, 0, 0).getTime()
  const minute = 60_000
  const text =
    'Schema done, and checked against the old dump, which took longer than it should ' +
    'have because the dump was a week old and two tables had moved since, so the ' +
    'indexes are next, then the foreign keys, then the backfill, and the backfill ' +
    'wants a window of its own'
  await openMono(page)
  await importSession(page, {
    version: 6,
    dayKey: '2026-08-20',
    events: [
      { type: 'day/shaped', at: ten - 60 * minute },
      {
        type: 'block/started', at: ten, id: 'morning', blockKind: 'deep',
        endsAt: ten + 45 * minute, purpose: 'Write the migration',
      },
      { type: 'block/noted', at: ten + 5 * minute, id: 'note', text },
      { type: 'block/completed', at: ten + 45 * minute },
    ],
  })

  const mark = calendar(page).getByRole('button', { name: 'Log at 10:05 AM', exact: true })
  await mark.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await mark.focus()
  const card = calendar(page)
    .getByText(text, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]')
  await expect(card).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 340 })
  const column = calendar(page).locator('.mono-scroll').first()
  await expect
    .poll(async () => {
      const own = (await card.boundingBox())!
      const room = (await column.boundingBox())!
      return own.y + own.height <= room.y + room.height + 1
    })
    .toBe(true)
})
