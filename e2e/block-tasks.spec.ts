/** Every focus block is for at least one task, and ticking them is the backlog's business. */

import { expect, test } from '@playwright/test'
import {
  addBlockTask,
  addIntention,
  addOnTasksPage,
  blockPicker,
  goToStage,
  openMono,
  stage,
  storedRecord,
} from './support/mono'

const startButton = (page: Parameters<typeof stage>[0]) =>
  stage(page).getByRole('button', { name: 'Start', exact: true })
const purposeField = (page: Parameters<typeof stage>[0]) =>
  stage(page).getByLabel('Purpose for this block', { exact: true })
const blockTasks = (page: Parameters<typeof stage>[0]) =>
  stage(page).getByRole('list', { name: 'Tasks in this block' })
const blockPanel = (page: Parameters<typeof stage>[0]) =>
  stage(page).getByRole('group', { name: 'Tasks for this block', exact: true })

/** Shape the day with one intention, and open the purpose prompt. */
async function toPurposePrompt(page: Parameters<typeof stage>[0], intention = 'Mono auth') {
  await openMono(page)
  await goToStage(page, 'Intentions')
  await addIntention(page, intention)
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
  await stage(page).getByRole('checkbox', { name: 'CSRF token' }).uncheck()
  await expect(purposeField(page)).toHaveValue('Get the login form submitting')

  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).not.toContainText('CSRF token')
})

test("one dropdown ticks tasks, listed under their intentions and the rest above them", async ({
  page,
}) => {
  await toPurposePrompt(page)
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // A task put under the intention for the day, on the tasks page.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await addOnTasksPage(page, 'task', 'Work', 'Login form')
  await page
    .getByRole('main')
    .getByLabel("Today's intention for Login form")
    .selectOption({ label: 'Mono auth' })
  await page.getByRole('link', { name: 'Back to today' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()

  // Offered under its intention before anything is ticked.
  const section = stage(page).getByRole('group', { name: 'Mono auth', exact: true })
  await expect(section.getByRole('checkbox', { name: 'Login form' })).not.toBeChecked()

  // One dropdown for every task, which ticks and links nothing.
  await blockPicker(page).click()
  await blockPanel(page).getByRole('checkbox', { name: 'Login form' }).check()
  await blockPanel(page).getByRole('button', { name: 'Add a task to Personal', exact: true }).click()
  await blockPanel(page).getByLabel('New task in Personal', { exact: true }).fill('Fix the gate')
  await blockPanel(page).getByLabel('New task in Personal', { exact: true }).press('Enter')
  await blockPicker(page).click()
  await expect(section.getByRole('checkbox', { name: 'Login form' })).toBeChecked()

  // What is not under an intention comes first, under its own places.
  const outside = stage(page).getByRole('list', { name: "Tasks outside today's intentions" })
  await expect(outside).toContainText('Personal')
  await expect(outside.getByRole('checkbox', { name: 'Fix the gate' })).toBeChecked()
  expect((await outside.boundingBox())!.y).toBeLessThan((await section.boundingBox())!.y)

  // Nothing was linked by choosing it here.
  await startButton(page).click()
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  const today = page.getByRole('main').getByRole('list', { name: 'Today: Mono auth' })
  await expect(today).toContainText('Login form')
  await expect(today).not.toContainText('Fix the gate')
})

test('an intention is put right where it is listed, keeping what was ticked', async ({ page }) => {
  await toPurposePrompt(page)
  await addBlockTask(page, 'Login form')
  await purposeField(page).fill('Get the login form submitting')

  const mine = stage(page).getByRole('region', { name: 'My intentions' })
  await expect(mine.getByRole('group', { name: 'Mono auth', exact: true })).toBeVisible()

  await mine.getByRole('button', { name: 'Edit intention Mono auth' }).click()
  await stage(page).getByLabel('This intention', { exact: true }).fill('Mono login')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()

  // Still the same prompt: renamed in place, nothing ticked or written lost.
  await expect(mine.getByRole('group', { name: 'Mono login', exact: true })).toBeVisible()
  await expect(purposeField(page)).toHaveValue('Get the login form submitting')
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toBeChecked()
})

test('a small task from outside the intentions can join a block', async ({ page }) => {
  await toPurposePrompt(page)

  // Written with no intention, so it lives in the backlog only.
  await addBlockTask(page, 'Reply to Priya')
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // Found again with the dropdown's search, and ticked from there.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await blockPicker(page).click()
  await blockPanel(page).getByLabel('Find a task', { exact: true }).fill('priya')
  await expect(blockPanel(page).getByRole('checkbox')).toHaveCount(1)
  await blockPanel(page).getByRole('checkbox', { name: 'Reply to Priya' }).check()
  await blockPicker(page).click()
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
  await blockPicker(page).click()
  await expect(blockPanel(page).getByRole('checkbox', { name: 'CSRF token' })).toBeVisible()
  await expect(blockPanel(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
})

test('the task dropdown stays on a phone screen, while it is open too', async ({ page }) => {
  // Regression, twice over. The panel hung from the button's left edge with a
  // width that only knew the viewport, so on a phone, where the button starts
  // halfway across, it ran off the right edge and took its controls with it.
  // Then its placement was measured only as it opened, so a button grown by
  // the task just chosen, or a phone turned upright, left it off the edge
  // again.
  const panel = blockPanel(page)
  /** The panel's edges and the page's width, against the window as it is now. */
  const overhang = async () => {
    const width = page.viewportSize()!.width
    const box = (await panel.boundingBox())!
    const scrolled = await page.evaluate(() => document.documentElement.scrollWidth)
    return Math.max(0, -box.x, box.x + box.width - width, scrolled - width)
  }
  const rightHand = panel.getByRole('button', { name: 'Add a task to Personal', exact: true })

  await page.setViewportSize({ width: 375, height: 740 })
  await toPurposePrompt(page)
  await blockPicker(page).click()
  expect(await overhang()).toBe(0)
  await expect(rightHand).toBeInViewport()

  // Choosing a task grows the button's summary; the panel stays open for the
  // next and keeps to the screen.
  await panel.getByRole('button', { name: 'Add a task to Work', exact: true }).click()
  const field = panel.getByLabel('New task in Work', { exact: true })
  await field.fill('A lengthy task title that makes the picker button grow')
  await field.press('Enter')
  await expect(blockPicker(page)).toContainText('A lengthy task title')
  await expect.poll(overhang).toBe(0)
  await expect(rightHand).toBeInViewport()

  // Opened on its side, then turned upright with the panel still open.
  await blockPicker(page).click()
  await page.setViewportSize({ width: 740, height: 375 })
  await blockPicker(page).click()
  expect(await overhang()).toBe(0)
  await page.setViewportSize({ width: 375, height: 740 })
  await expect.poll(overhang).toBe(0)
  await expect(rightHand).toBeInViewport()
})

test('the keyboard stays in the task dropdown as its fields come and go', async ({
  page,
}) => {
  // Regression: cancelling a field, keeping a rename or deleting a task took
  // away the control that had focus and left focus on the page, where the
  // panel's Escape no longer reached it and nothing could close it.
  await toPurposePrompt(page)
  await blockPicker(page).click()
  const panel = blockPanel(page)
  const addToWork = panel.getByRole('button', { name: 'Add a task to Work', exact: true })
  const newTask = panel.getByLabel('New task in Work', { exact: true })

  // A new task's field put away with Escape: back to the + Task that opened
  // it, with the panel still open.
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

  // So Escape still reaches the panel, and closes it onto its button.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(blockPicker(page)).toBeFocused()
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
 * then back to a day with one intention and the purpose prompt open.
 */
async function withAuthEpic(page: Parameters<typeof stage>[0]) {
  await openMono(page)
  await goToStage(page, 'Intentions')
  await addIntention(page, 'Billing ticket')
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

  await blockPicker(page).click()
  await blockPanel(page).getByRole('checkbox', { name: 'Login form' }).check()
  await blockPanel(page).getByRole('checkbox', { name: 'Session cookie' }).check()
  await blockPicker(page).click()

  // Its tasks are listed under it, each said once, with its heading a box of its own.
  const other = stage(page).getByRole('list', { name: "Tasks outside today's intentions" })
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

  await blockPicker(page).click()
  await blockPanel(page).getByRole('button', { name: 'Add a task to Login pages', exact: true }).click()
  await blockPanel(page).getByLabel('New task in Login pages', { exact: true }).fill('Remember me')
  await blockPanel(page).getByLabel('New task in Login pages', { exact: true }).press('Enter')
  await blockPicker(page).click()
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

test('a rename in the dropdown closes when its task goes, and does not come back with it', async ({
  page,
  context,
}) => {
  // Regression: the rename outlived its row. When the task came back, its
  // epic reopened in another tab or a search cleared, the old editor came
  // back with it and took focus from wherever the user had gone since.
  await withAuthEpic(page)
  await expect.poll(() => storedRecord(page, 'Session cookie')).not.toBeNull()
  await blockPicker(page).click()
  const panel = blockPanel(page)
  const find = panel.getByLabel('Find a task', { exact: true })
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
  // leaving focus on the page where Escape could not close the panel.
  await withAuthEpic(page)
  await expect.poll(() => storedRecord(page, 'Session cookie')).not.toBeNull()
  await blockPicker(page).click()
  const panel = blockPanel(page)
  const find = panel.getByLabel('Find a task', { exact: true })
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
  // it was in, so Escape still reaches the panel and closes it.
  await elsewhere.getByRole('button', { name: 'Delete Login form' }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    panel.getByRole('button', { name: 'Add a task to Login pages', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(blockPicker(page)).toBeFocused()
})

test('an archived epic takes its tasks out of the prompt', async ({ page }) => {
  await withAuthEpic(page)
  await blockPicker(page).click()
  await expect(blockPanel(page).getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await blockPicker(page).click()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Archive Mono auth' }).click()
  await page.getByRole('link', { name: 'Back to today' }).click()

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await blockPicker(page).click()
  await expect(blockPanel(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  await expect(blockPanel(page)).not.toContainText('Login pages')
})
