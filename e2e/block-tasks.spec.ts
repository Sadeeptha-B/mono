/** Every focus block is for at least one task, and ticking them is the backlog's business. */

import { expect, test, type Locator } from '@playwright/test'
import {
  addBlockTask,
  addIntention,
  addOnTasksPage,
  addTodayTask,
  blockBacklog,
  goToStage,
  openBlockBacklog,
  openMono,
  stage,
  storedRecord,
  todayList,
} from './support/mono'

type Page = Parameters<typeof stage>[0]

const startButton = (page: Page) => stage(page).getByRole('button', { name: 'Start', exact: true })
const purposeField = (page: Page) =>
  stage(page).getByLabel('Purpose for this block', { exact: true })
const blockTasks = (page: Page) => stage(page).getByRole('list', { name: 'Tasks in this block' })
/** What this prompt has taken from outside today. */
const alsoList = (page: Page) => stage(page).getByRole('list', { name: 'Also for this block' })

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
  await alsoList(page).getByRole('checkbox', { name: 'CSRF token' }).uncheck()
  await expect(purposeField(page)).toHaveValue('Get the login form submitting')

  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).not.toContainText('CSRF token')
})

test("the purpose heads the prompt, then today's tasks, then All Tasks folded below", async ({
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

  // Today's tasks are offered under their intention, then the rest of today,
  // and nothing is ticked yet. The backlog is folded.
  const mono = stage(page).getByRole('group', { name: 'Mono auth', exact: true })
  await expect(mono.getByRole('checkbox', { name: 'Login form' })).not.toBeChecked()
  const rest = stage(page).getByRole('list', { name: 'Not grouped', exact: true })
  await expect(rest.getByRole('checkbox', { name: 'Session cookie' })).toBeVisible()
  await expect(blockBacklog(page)).toHaveCount(0)

  await mono.getByRole('checkbox', { name: 'Login form' }).check()
  await expect(purposeField(page)).toHaveValue('Login form')

  // Something from outside today, written from All Tasks, is listed apart.
  await addBlockTask(page, 'Fix the gate', 'Personal')
  await expect(alsoList(page)).toContainText('Personal')
  await expect(alsoList(page).getByRole('checkbox', { name: 'Fix the gate' })).toBeChecked()

  // In that order down the prompt, with the purpose over all of it.
  const y = async (locator: Locator) => (await locator.boundingBox())!.y
  expect(await y(purposeField(page))).toBeLessThan(await y(mono))
  expect(await y(mono)).toBeLessThan(await y(alsoList(page)))
  expect(await y(alsoList(page))).toBeLessThan(await y(blockBacklog(page)))

  // Starting it makes the outside task today's, under no intention, and
  // groups nothing.
  await startButton(page).click()
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  const today = page.getByRole('main').getByRole('region', { name: 'Today', exact: true })
  await expect(today.getByRole('region', { name: 'Intention: Mono auth' })).toContainText(
    'Login form',
  )
  await expect(today.getByRole('region', { name: 'Not grouped' })).toContainText('Fix the gate')
})

test('a small task from outside today can join a block', async ({ page }) => {
  await toPurposePrompt(page)

  // Written from the prompt, and the block never started, so it lives in the
  // backlog only.
  await addBlockTask(page, 'Reply to Priya')
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // Found again with the backlog's search, and ticked from there.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(alsoList(page)).toHaveCount(0)
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
  // Both joined today when the block started: one still to do, one crossed out.
  await expect(stage(page).getByRole('checkbox', { name: 'CSRF token' })).toBeVisible()
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  await expect(stage(page).getByText('Login form', { exact: true })).toHaveCSS(
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

  await browser.getByRole('button', { name: 'Add a task to Work', exact: true }).click()
  const field = browser.getByLabel('New task in Work', { exact: true })
  await field.fill('A lengthy task title that would once have made the picker button grow')
  await field.press('Enter')
  await expect(alsoList(page)).toContainText('A lengthy task title')
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
  const addToWork = panel.getByRole('button', { name: 'Add a task to Work', exact: true })
  const newTask = panel.getByLabel('New task in Work', { exact: true })

  // A new task's field put away with Escape: back to the + Task that opened it.
  await addToWork.press('Enter')
  await expect(newTask).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(newTask).toHaveCount(0)
  await expect(addToWork).toBeFocused()

  // A task written, then renamed and kept: back to its ✎.
  await addToWork.press('Enter')
  await newTask.fill('Draft')
  await newTask.press('Enter')
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: 'Edit task Draft', exact: true }).press('Enter')
  const rename = panel.getByLabel('Rename Draft', { exact: true })
  await rename.fill('Final')
  await rename.press('Enter')
  await expect(panel.getByRole('button', { name: 'Edit task Final', exact: true })).toBeFocused()

  // Deleted: back to the + Task of the place it was in.
  await panel.getByRole('button', { name: 'Delete task Final', exact: true }).press('Enter')
  await expect(panel.getByRole('checkbox', { name: 'Final' })).toHaveCount(0)
  await expect(addToWork).toBeFocused()
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

test('ticking a whole outcome picks its tasks, and names the purpose after it', async ({
  page,
}) => {
  await withAuthEpic(page)

  const browser = await openBlockBacklog(page)
  await browser.getByRole('checkbox', { name: 'Login form' }).check()
  await browser.getByRole('checkbox', { name: 'Session cookie' }).check()

  // Its tasks are listed under it, each said once, with its heading a box of its own.
  const other = alsoList(page)
  await expect(other).toContainText('Work › Mono auth › Login pages')
  const whole = other.getByRole('checkbox', { name: 'All of Login pages' })
  await expect(whole).toBeChecked()
  await expect(purposeField(page)).toHaveValue('Login pages')

  // Partly picked is said as partly picked, and the purpose names the tasks.
  // An unticked task stays listed, so it can be ticked again.
  await other.getByRole('checkbox', { name: 'Session cookie' }).uncheck()
  await expect(whole).toHaveAttribute('aria-checked', 'mixed')
  await expect(purposeField(page)).toHaveValue('Login form')

  await whole.check()
  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).toContainText('Session cookie')
})

test('a task written on the prompt can be filed straight into an outcome', async ({ page }) => {
  await withAuthEpic(page)

  const browser = await openBlockBacklog(page)
  await browser.getByRole('button', { name: 'Add a task to Login pages', exact: true }).click()
  await browser.getByLabel('New task in Login pages', { exact: true }).fill('Remember me')
  await browser.getByLabel('New task in Login pages', { exact: true }).press('Enter')
  await startButton(page).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(
    page.getByRole('main').getByRole('region', { name: 'Outcome: Login pages' }),
  ).toContainText('Remember me')
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

  // The checkbox goes, and so does the tick behind it.
  await expect(stage(page).getByRole('checkbox', { name: 'Doomed' })).toHaveCount(0)
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
  await panel.getByRole('button', { name: 'Edit task Login form', exact: true }).press('Enter')
  await expect(editor).toBeFocused()
  await find.fill('cookie')
  await expect(editor).toHaveCount(0)
  await find.fill('')
  await expect(panel.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await expect(editor).toHaveCount(0)
  await expect(find).toBeFocused()
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
  const place = async (title: string) => `place:${(await storedRecord(page, title))!.id}`

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

  // Deleted while its rename has focus: focus goes to the + Task of the place
  // it was in.
  await elsewhere.getByRole('button', { name: 'Delete Login form' }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: 'Add a task to Login pages', exact: true }),
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
