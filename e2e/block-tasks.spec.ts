/** Every focus block is for at least one task, and ticking them is the backlog's business. */

import { expect, test, type Locator } from '@playwright/test'
import {
  addBlockTask,
  addIntention,
  addOnTasksPage,
  addTaskIn,
  addTodayTask,
  blockBacklog,
  goToStage,
  openBlockBacklog,
  openMono,
  shapeDay,
  stage,
  startBlock,
  storedRecord,
  todayList,
} from './support/mono'

type Page = Parameters<typeof stage>[0]

const startButton = (page: Page) => stage(page).getByRole('button', { name: 'Start', exact: true })
const purposeField = (page: Page) =>
  stage(page).getByLabel('Purpose for this block', { exact: true })
const blockTasks = (page: Page) => stage(page).getByRole('list', { name: 'Tasks in this block' })
/** The block's answer on the prompt: what is ticked for it, and nothing else. */
const chosen = (page: Page) =>
  stage(page).getByRole('region', { name: 'Tasks for this block', exact: true })
const offBlock = (page: Page, title: string) =>
  stage(page).getByRole('button', { name: `Take ${title} off this block`, exact: true })
/** Today's own list, in the column under All Tasks while the prompt is open. */
const todayView = (page: Page) =>
  page.getByRole('complementary').getByRole('region', { name: "Today's tasks", exact: true })

/** Shape the day with one task chosen for it, and open the purpose prompt. */
async function toPurposePrompt(page: Page, task = 'Ship the planner') {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, task)
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
}

test('a block cannot start without a task, and its purpose starts as their titles', async ({
  page,
}) => {
  await toPurposePrompt(page)

  await expect(startButton(page)).toBeDisabled()

  await addBlockTask(page, 'Login form')
  await expect(purposeField(page)).toHaveValue('Login form')
  await addBlockTask(page, 'CSRF token')
  await expect(purposeField(page)).toHaveValue('Login form, CSRF token')

  // Once edited, the purpose is the user's and stops following the ticks.
  await purposeField(page).fill('Get the login form submitting')
  await offBlock(page, 'CSRF token').click()
  await expect(chosen(page)).not.toContainText('CSRF token')
  await expect(purposeField(page)).toHaveValue('Get the login form submitting')

  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).not.toContainText('CSRF token')
})

test("the purpose heads the prompt, then what is ticked for the block, with All Tasks beside it", async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Login form')
  await addTodayTask(page, 'Session cookie')
  await addIntention(page, 'Mono auth')
  await todayList(page).getByRole('button', { name: 'Move Login form', exact: true }).click()
  await todayList(page)
    .getByRole('button', { name: 'Move Login form to Mono auth', exact: true })
    .click()
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()

  // Nothing is ticked yet, so the prompt lists nothing and has no checkboxes
  // of its own: ticking is All Tasks', beside it, with today's own list under
  // that.
  await expect(blockBacklog(page)).toBeVisible()
  await expect(chosen(page)).toContainText('Tick tasks in All Tasks')
  await expect(stage(page).getByRole('checkbox')).toHaveCount(0)
  await expect(todayView(page)).toContainText('Session cookie')

  // A tick is listed under the intention today gives it.
  await blockBacklog(page).getByRole('checkbox', { name: 'Login form' }).check()
  const mono = stage(page).getByRole('group', { name: 'Mono auth', exact: true })
  await expect(mono).toContainText('Login form')
  await expect(purposeField(page)).toHaveValue('Login form')
  await expect(chosen(page)).not.toContainText('Session cookie')

  // One from outside today is chosen for today as it is ticked, and listed
  // under no intention.
  await addBlockTask(page, 'Fix the gate', 'Personal')
  const rest = stage(page).getByRole('list', { name: 'Not grouped', exact: true })
  await expect(rest).toContainText('Personal')
  await expect(rest).toContainText('Fix the gate')
  await expect(todayView(page)).toContainText('Fix the gate')
  // Taken off the block, it stays today's, and can be ticked again.
  await offBlock(page, 'Fix the gate').click()
  await expect(chosen(page)).not.toContainText('Fix the gate')
  await expect(blockBacklog(page).getByRole('checkbox', { name: 'Fix the gate' })).not.toBeChecked()
  await expect(todayView(page)).toContainText('Fix the gate')
  await blockBacklog(page).getByRole('checkbox', { name: 'Fix the gate' }).check()
  await expect(rest).toContainText('Fix the gate')

  // In that order down the prompt, as today's question draws it, with the
  // purpose over all of it.
  const y = async (locator: Locator) => (await locator.boundingBox())!.y
  expect(await y(purposeField(page))).toBeLessThan(await y(mono))
  expect(await y(mono)).toBeLessThan(await y(rest))

  // Intentions are kept in today's list in the column: one is named there,
  // and a ticked task carried into it is listed under it on the prompt.
  await expect(stage(page).getByRole('button', { name: 'Add intention' })).toHaveCount(0)
  const day = todayView(page)
  await day.getByRole('button', { name: 'Add intention', exact: true }).click()
  const name = day.getByLabel('New intention', { exact: true })
  await name.fill('Gate')
  await name.press('Enter')
  await name.press('Escape')
  await day.getByRole('button', { name: 'Move Fix the gate', exact: true }).click()
  await day.getByRole('button', { name: 'Move Fix the gate to Gate', exact: true }).click()
  await expect(stage(page).getByRole('group', { name: 'Gate', exact: true })).toContainText(
    'Fix the gate',
  )

  // Starting it keeps that grouping; the column is the day again, with All
  // Tasks a press away while the block runs.
  await startButton(page).click()
  await expect(blockBacklog(page)).toHaveCount(0)
  await expect(
    page
      .getByRole('group', { name: 'Show in this column' })
      .getByRole('button', { name: 'Today', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  const today = page.getByRole('main').getByRole('region', { name: 'Today', exact: true })
  await expect(today.getByRole('region', { name: 'Intention: Mono auth' })).toContainText(
    'Login form',
  )
  await expect(today.getByRole('region', { name: 'Intention: Gate' })).toContainText('Fix the gate')
})

test('a task from outside today joins it as it is ticked for a block', async ({ page }) => {
  await toPurposePrompt(page)

  // Written from the prompt, it is ticked and chosen for today at once, and
  // stays today's when the block is not started.
  await addBlockTask(page, 'Reply to Priya')
  await expect(chosen(page)).toContainText('Reply to Priya')
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // The next prompt starts with nothing ticked; it is found again with the
  // backlog's search, and ticked from there.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(chosen(page)).not.toContainText('Reply to Priya')
  await expect(todayView(page)).toContainText('Reply to Priya')
  const browser = await openBlockBacklog(page)
  await browser.getByLabel('Find a task in Tasks for this block', { exact: true }).fill('priya')
  await expect(browser.getByRole('checkbox')).toHaveCount(1)
  await browser.getByRole('checkbox', { name: 'Reply to Priya' }).check()
  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Reply to Priya')
})

test('a task ticked during a block stays done, and is not offered again', async ({ page }) => {
  await toPurposePrompt(page)
  await addBlockTask(page, 'Login form')
  await addBlockTask(page, 'CSRF token')
  await startButton(page).click()

  await blockTasks(page).getByRole('checkbox', { name: 'Login form done' }).check()

  // The backlog owns it: a reload brings the tick back from IndexedDB, once
  // the write carrying it has landed there.
  await expect.poll(async () => (await storedRecord(page, 'Login form'))?.status).toBe('done')
  await page.reload()
  await expect(
    blockTasks(page).getByRole('checkbox', { name: 'Login form done' }),
  ).toBeChecked()

  // Ending the block is one click, because the tick already happened.
  await stage(page).getByRole('button', { name: 'End early' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  // Both joined today as they were ticked: one still to do, one crossed out.
  await expect(todayView(page)).toContainText('CSRF token')
  await expect(blockBacklog(page).getByRole('checkbox', { name: 'CSRF token' })).toBeVisible()
  await expect(blockBacklog(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  // Not exact: the row also says, to a screen reader, that it is done today.
  await expect(todayView(page).getByText('Login form')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
})

test('the backlog keeps to a phone screen, as long titles are written into it', async ({
  page,
}) => {
  // Drawn in place, it is as wide as the stage and no wider: nothing in it may
  // push the page sideways, however long what is written there.
  const overhang = async () => {
    const width = page.viewportSize()!.width
    const box = (await blockBacklog(page).boundingBox())!
    const scrolled = await page.evaluate(() => document.documentElement.scrollWidth)
    return Math.max(0, -box.x, box.x + box.width - width, scrolled - width)
  }

  await page.setViewportSize({ width: 375, height: 740 })
  await toPurposePrompt(page)
  const browser = await openBlockBacklog(page)
  expect(await overhang()).toBe(0)

  await addTaskIn(browser, 'Work')
  const field = browser.getByLabel('New task in Work', { exact: true })
  const long = 'A lengthy task title that would once have made the picker button grow'
  await field.fill(long)
  await field.press('Enter')
  await expect(chosen(page)).toContainText(long)
  await expect.poll(overhang).toBe(0)

  // Turned on its side and back.
  await page.setViewportSize({ width: 740, height: 375 })
  await expect.poll(overhang).toBe(0)
  await page.setViewportSize({ width: 375, height: 740 })
  await expect.poll(overhang).toBe(0)
})

test('the keyboard stays in the backlog as its fields come and go', async ({ page }) => {
  // Regression: cancelling a field, keeping a rename or deleting a task took
  // away the control that had focus and left focus on the page, at the top of
  // the document, far from where the keyboard was working.
  await toPurposePrompt(page)
  const panel = await openBlockBacklog(page)
  const moreWork = panel.getByRole('button', { name: 'More for Work', exact: true })
  const addToWork = panel.getByRole('button', { name: 'Add a task to Work', exact: true })
  const newTask = panel.getByLabel('New task in Work', { exact: true })

  // A new task's field, opened from the place's ⋯ and put away with Escape:
  // back to the ⋯.
  await moreWork.press('Enter')
  await addToWork.press('Enter')
  await expect(newTask).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(newTask).toHaveCount(0)
  await expect(moreWork).toBeFocused()

  // A task written, then renamed and kept: back to its ⋯.
  await moreWork.press('Enter')
  await addToWork.press('Enter')
  await newTask.fill('Draft')
  await newTask.press('Enter')
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: 'More for task Draft', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Edit task Draft', exact: true }).press('Enter')
  const rename = panel.getByLabel('Rename Draft', { exact: true })
  await rename.fill('Final')
  await rename.press('Enter')
  const moreFinal = panel.getByRole('button', { name: 'More for task Final', exact: true })
  await expect(moreFinal).toBeFocused()

  // Deleted: back to the ⋯ of the place it was in.
  await moreFinal.press('Enter')
  await panel.getByRole('button', { name: 'Delete task Final', exact: true }).press('Enter')
  await expect(panel.getByRole('checkbox', { name: 'Final' })).toHaveCount(0)
  await expect(moreWork).toBeFocused()
})

test('the end of a block asks what got done', async ({ page }) => {
  await toPurposePrompt(page)
  await addBlockTask(page, 'Login form')
  await startButton(page).click()

  await page.clock.fastForward('45:00')
  await expect(stage(page).getByRole('heading', { name: /Need a break|last one/ })).toBeVisible()
  await blockTasks(page).getByRole('checkbox', { name: 'Login form done' }).check()
  await expect(
    blockTasks(page).getByRole('checkbox', { name: 'Login form done' }),
  ).toBeChecked()
})

/**
 * Work › Mono auth › Login pages holding two tasks, built on the tasks page,
 * then back to a day with one other task chosen and the purpose prompt open.
 */
async function withAuthEpic(page: Page) {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Billing ticket')
  await stage(page).getByRole('button', { name: 'Start the day' }).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  for (const [kind, parent, title] of [
    ['epic', 'Work', 'Mono auth'],
    ['outcome', 'Mono auth', 'Login pages'],
    ['task', 'Login pages', 'Login form'],
    ['task', 'Login pages', 'Session cookie'],
  ] as const) {
    await addOnTasksPage(page, kind, parent, title)
  }
  await page.getByRole('link', { name: 'Back to today' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
}

test('ticking all of an outcome names the purpose after it', async ({ page }) => {
  await withAuthEpic(page)

  const browser = await openBlockBacklog(page)
  await browser.getByRole('checkbox', { name: 'Login form' }).check()
  await browser.getByRole('checkbox', { name: 'Session cookie' }).check()

  // Its tasks are listed under it on the prompt, each place said once.
  await expect(chosen(page)).toContainText('Mono auth › Login pages')
  await expect(purposeField(page)).toHaveValue('Login pages')

  // With only some of it, the purpose names the tasks.
  await offBlock(page, 'Session cookie').click()
  await expect(purposeField(page)).toHaveValue('Login form')

  await browser.getByRole('checkbox', { name: 'Session cookie' }).check()
  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).toContainText('Session cookie')
})

test('a task written on the prompt can be filed straight into an outcome', async ({ page }) => {
  await withAuthEpic(page)

  const browser = await openBlockBacklog(page)
  await addTaskIn(browser, 'Login pages')
  await browser.getByLabel('New task in Login pages', { exact: true }).fill('Remember me')
  await browser.getByLabel('New task in Login pages', { exact: true }).press('Enter')
  await startButton(page).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(
    page.getByRole('main').getByRole('region', { name: 'Outcome: Login pages' }),
  ).toContainText('Remember me')
})

test('a task taken out of today leaves the block, and choosing it again does not tick it', async ({
  page,
}) => {
  // Regression: the tick was hidden while its task was out of today, and came
  // back, with Start enabled, as soon as the task was chosen again.
  await toPurposePrompt(page)
  await addBlockTask(page, 'Reply to Priya')
  await expect(startButton(page)).toBeEnabled()

  await todayView(page)
    .getByRole('button', { name: 'Take Reply to Priya out of today', exact: true })
    .click()
  await expect(chosen(page)).not.toContainText('Reply to Priya')
  await expect(startButton(page)).toBeDisabled()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Reply to Priya for today', exact: true })
    .click()
  await page.getByRole('link', { name: 'Back to today' }).click()
  await expect(todayView(page)).toContainText('Reply to Priya')
  await expect(
    blockBacklog(page).getByRole('checkbox', { name: 'Reply to Priya' }),
  ).not.toBeChecked()
  await expect(startButton(page)).toBeDisabled()
})

test('a ticked task deleted in another tab cannot start the block', async ({ page, context }) => {
  await toPurposePrompt(page)
  await addBlockTask(page, 'Doomed')
  await expect(startButton(page)).toBeEnabled()

  // A second tab on the same browser profile: same database, same channel.
  const other = await context.newPage()
  await openMono(other)
  await other.getByRole('link', { name: 'Tasks', exact: true }).click()
  await other.getByRole('main').getByRole('button', { name: 'Delete Doomed' }).click()

  // Its row goes, and so does the tick behind it.
  await expect(chosen(page)).not.toContainText('Doomed')
  await expect(startButton(page)).toBeDisabled()
  await expect(purposeField(page)).toHaveValue('')
})

test('a rename in the backlog closes when its task goes, and does not come back with it', async ({
  page,
  context,
}) => {
  // Regression: the rename outlived its row. When the task came back, its
  // epic reopened in another tab or a search cleared, the old editor came
  // back with it and took focus from wherever the user had gone since.
  await withAuthEpic(page)
  await expect.poll(() => storedRecord(page, 'Session cookie')).not.toBeNull()
  const panel = await openBlockBacklog(page)
  const find = panel.getByLabel('Find a task in Tasks for this block', { exact: true })
  const editor = panel.getByLabel('Rename Login form', { exact: true })

  await panel.getByRole('button', { name: 'More for task Login form', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Edit task Login form', exact: true }).press('Enter')
  await editor.fill('A stale draft')

  // Its epic finished in another tab: the editor goes with the task.
  const other = await context.newPage()
  await openMono(other)
  await other.getByRole('link', { name: 'Tasks', exact: true }).click()
  await other.getByRole('main').getByRole('button', { name: 'Mark Mono auth done' }).click()
  await expect(editor).toHaveCount(0)

  // The user moves on to the search; the epic is reopened over there.
  await find.fill('Login')
  await other.getByRole('main').getByText('Done, dropped and archived (1)').click()
  await other.getByRole('main').getByRole('button', { name: 'Reopen Mono auth' }).click()
  await expect(panel.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await expect(editor).toHaveCount(0)
  await expect(find).toBeFocused()

  // The same when it is the search that hides the task and then shows it.
  await find.fill('')
  await panel.getByRole('button', { name: 'More for task Login form', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Edit task Login form', exact: true }).press('Enter')
  await expect(editor).toBeFocused()
  await find.fill('cookie')
  await expect(editor).toHaveCount(0)
  await find.fill('')
  await expect(panel.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await expect(editor).toHaveCount(0)
  await expect(find).toBeFocused()

  // The same when the task is finished in another tab: a done row has no
  // rename, and reopening it here does not bring the old draft back.
  await panel.getByRole('button', { name: 'More for task Login form', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Edit task Login form', exact: true }).press('Enter')
  await editor.fill('Another stale draft')
  await other.getByRole('main').getByLabel('Login form done', { exact: true }).click()
  await expect(panel.getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  await expect(editor).toHaveCount(0)
  await panel.getByRole('button', { name: 'More for task Login form', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Reopen task Login form', exact: true }).press('Enter')
  await expect(panel.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await expect(editor).toHaveCount(0)
})

test('a rename changed under it by another tab keeps the keyboard where it belongs', async ({
  page,
  context,
}) => {
  // Regressions, each from another tab. A field was focused by mounting, so a
  // task moved from one place to another, drawn again under the new place,
  // mounted its rename there and took focus from the search. And a task
  // deleted while its rename had focus took the field with nobody here asking,
  // leaving focus at the top of the page.
  await withAuthEpic(page)
  await expect.poll(() => storedRecord(page, 'Session cookie')).not.toBeNull()
  const panel = await openBlockBacklog(page)
  const find = panel.getByLabel('Find a task in Tasks for this block', { exact: true })
  const editor = panel.getByLabel('Rename Login form', { exact: true })
  // Which place's list the rename is drawn in: the signal this tab has heard
  // the move, before anything is asserted about focus.
  const placeOfEditor = editor.locator('xpath=ancestor::ul[@data-home][1]')
  const place = async (title: string) => `menu:${(await storedRecord(page, title))!.id}`

  await panel.getByRole('button', { name: 'More for task Login form', exact: true }).press('Enter')
  await panel.getByRole('button', { name: 'Edit task Login form', exact: true }).press('Enter')
  await editor.fill('Unfinished rename')
  await find.fill('Mono')
  await expect(editor).toBeVisible()
  await expect(find).toBeFocused()

  const other = await context.newPage()
  await openMono(other)
  await other.getByRole('link', { name: 'Tasks', exact: true }).click()
  const elsewhere = other.getByRole('main')
  const move = async (to: string) => {
    await elsewhere.getByRole('button', { name: 'Move Login form', exact: true }).click()
    await elsewhere.getByRole('button', { name: `Move Login form to ${to}`, exact: true }).click()
  }

  // Moved from the outcome to its epic: the rename goes with it, draft and
  // all, and the search keeps the focus.
  await move('Mono auth')
  await expect(placeOfEditor).toHaveAttribute('data-home', await place('Mono auth'))
  await expect(editor).toHaveValue('Unfinished rename')
  await expect(find).toBeFocused()

  // When the rename is what has focus, focus goes with it.
  await editor.click()
  await move('Login pages')
  await expect(placeOfEditor).toHaveAttribute('data-home', await place('Login pages'))
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Unfinished rename')

  // Deleted while its rename has focus: focus goes to the ⋯ of the place it
  // was in.
  await elsewhere.getByRole('button', { name: 'Delete Login form' }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: 'More for Login pages', exact: true }),
  ).toBeFocused()
})

test('an archived epic takes its tasks out of the prompt', async ({ page }) => {
  await withAuthEpic(page)
  const browser = await openBlockBacklog(page)
  await expect(browser.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Archive Mono auth' }).click()
  await page.getByRole('link', { name: 'Back to today' }).click()

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await openBlockBacklog(page)
  await expect(blockBacklog(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  await expect(blockBacklog(page)).not.toContainText('Login pages')
})

test("All Tasks is a press away while a block runs, and changes the block's tasks there alone", async ({
  page,
}) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  await expect(blockTasks(page)).toContainText('The task at hand')

  // The column stays on the day, which is drawing the block, until asked.
  const switcher = page.getByRole('group', { name: 'Show in this column' })
  await expect(switcher.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await switcher.getByRole('button', { name: 'All Tasks', exact: true }).click()

  // A task written there waits in the backlog: what turns up in a block is
  // usually not for it. Ticked, it is taken on by the block and chosen for
  // today; the purpose stays the sentence it started with.
  const tree = blockBacklog(page)
  const todays = page.getByRole('complementary').getByRole('region', {
    name: "Today's tasks",
    exact: true,
  })
  await expect(tree.getByRole('checkbox', { name: 'The task at hand' })).toBeChecked()
  await addTaskIn(tree, 'Personal')
  const field = tree.getByLabel('New task in Personal', { exact: true })
  await field.fill('Call the bank')
  await field.press('Enter')
  await tree.getByRole('button', { name: 'Cancel the new task in Personal', exact: true }).click()
  const bank = tree.getByRole('checkbox', { name: 'Call the bank' })
  await expect(bank).not.toBeChecked()
  await expect(blockTasks(page)).not.toContainText('Call the bank')
  await expect(todays).not.toContainText('Call the bank')
  await bank.check()
  await expect(blockTasks(page)).toContainText('Call the bank')
  await expect(todays).toContainText('Call the bank')
  await expect(stage(page)).toContainText('Write the migration')

  // Unticked, a task is let go by the block and stays today's. The last one
  // cannot be, since every block is for at least one task, and says so.
  await tree.getByRole('checkbox', { name: 'The task at hand' }).uncheck()
  await expect(blockTasks(page)).not.toContainText('The task at hand')
  await expect(todays).toContainText('The task at hand')
  await expect(bank).toBeChecked()
  await expect(bank).toBeDisabled()
  await bank.hover()
  await expect(tree.getByRole('tooltip')).toHaveText(
    'Every block is for at least one task. Tick another before letting this one go.',
  )
  await expect(bank).toHaveAccessibleDescription(/at least one task/)
  await expect(blockTasks(page)).toContainText('Call the bank')

  // The stage only ticks them done: nothing on it adds to the block or takes
  // a task off it.
  await expect(stage(page).getByRole('button', { name: /off this block$/ })).toHaveCount(0)

  // The block over, the column is the day again.
  await stage(page).getByRole('button', { name: 'End early' }).click()
  await expect(switcher).toHaveCount(0)
})
