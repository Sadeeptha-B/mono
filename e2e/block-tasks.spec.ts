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

  // The backlog owns it: a reload brings the tick back from IndexedDB.
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
