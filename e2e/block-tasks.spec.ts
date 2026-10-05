/** Every focus block is for at least one task, and ticking them is the backlog's business. */

import { expect, test } from '@playwright/test'
import {
  addBlockTask,
  addIntention,
  addOnTasksPage,
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

/** Shape the day with one intention, and open the purpose prompt. */
async function toPurposePrompt(page: Parameters<typeof stage>[0], intention = 'Mono auth') {
  await openMono(page)
  await goToStage(page, "Today's intentions")
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

test('a task written under an intention is offered there next time', async ({ page }) => {
  await toPurposePrompt(page)

  await stage(page).getByLabel('New task', { exact: true }).fill('Login form')
  await stage(page).getByRole('group', { name: 'For' }).getByRole('button', { name: 'Mono auth' }).click()
  await stage(page).getByRole('button', { name: 'Add task' }).click()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  const group = stage(page).getByRole('group', { name: 'Mono auth' })
  await expect(group.getByRole('checkbox', { name: 'Login form' })).toBeVisible()
})

test('a small task from outside the intentions can join a block', async ({ page }) => {
  await toPurposePrompt(page)

  // Written with no intention, so it lives in the backlog only.
  await addBlockTask(page, 'Reply to Priya')
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await stage(page).getByLabel('Find a task', { exact: true }).fill('priya')
  await stage(page).getByRole('checkbox', { name: 'Reply to Priya' }).check()
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
  await expect(stage(page).getByRole('checkbox', { name: 'CSRF token' })).toBeVisible()
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
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
  await goToStage(page, "Today's intentions")
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

  const whole = stage(page).getByRole('checkbox', { name: 'All of Login pages' })
  await whole.check()
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toBeChecked()
  await expect(stage(page).getByRole('checkbox', { name: 'Session cookie' })).toBeChecked()
  await expect(purposeField(page)).toHaveValue('Login pages')

  // Partly picked is said as partly picked, and the purpose names the tasks.
  await stage(page).getByRole('checkbox', { name: 'Session cookie' }).uncheck()
  await expect(whole).toHaveAttribute('aria-checked', 'mixed')
  await expect(purposeField(page)).toHaveValue('Login form')

  await whole.check()
  await startButton(page).click()
  await expect(blockTasks(page)).toContainText('Login form')
  await expect(blockTasks(page)).toContainText('Session cookie')
})

test('a task written on the prompt can be filed straight into an outcome', async ({ page }) => {
  await withAuthEpic(page)

  await stage(page).getByLabel('New task', { exact: true }).fill('Remember me')
  await stage(page)
    .getByLabel('Where the new task goes')
    .selectOption({ label: 'Work › Mono auth › Login pages' })
  await stage(page).getByRole('button', { name: 'Add task' }).click()
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
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toBeVisible()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Archive Mono auth' }).click()
  await page.getByRole('link', { name: 'Back to today' }).click()

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(stage(page).getByRole('checkbox', { name: 'Login form' })).toHaveCount(0)
  await expect(stage(page).getByRole('checkbox', { name: 'All of Login pages' })).toHaveCount(0)
})
