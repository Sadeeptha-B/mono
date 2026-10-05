/** The backlog's own page: areas, their inboxes, and today's grouping. */

import { expect, test, type Page } from '@playwright/test'
import { addIntention, goToStage, openMono, stage, startBlock } from './support/mono'

const main = (page: Page) => page.getByRole('main')

async function openTasks(page: Page) {
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible()
}

async function addTo(page: Page, area: string, title: string) {
  await main(page).getByLabel(`New task in ${area}`, { exact: true }).fill(title)
  await main(page).getByLabel(`New task in ${area}`, { exact: true }).press('Enter')
}

const inbox = (page: Page, area: string) =>
  main(page).getByRole('list', { name: `${area} inbox` })

test('a new backlog starts with Work and Personal, and an inbox is just tasks', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)

  await expect(main(page).getByRole('heading', { name: 'Work' })).toBeVisible()
  await expect(main(page).getByRole('heading', { name: 'Personal' })).toBeVisible()

  await addTo(page, 'Work', 'Call Priya')
  await expect(inbox(page, 'Work')).toContainText('Call Priya')

  // It is in IndexedDB, not in the day's log: a reload brings it back.
  await page.reload()
  await expect(inbox(page, 'Work')).toContainText('Call Priya')
})

test('a task can be renamed, moved, dropped, reopened and deleted', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Buy a cable')

  await main(page).getByRole('button', { name: 'Rename Buy a cable' }).click()
  await main(page).getByLabel('Rename Buy a cable', { exact: true }).fill('Buy a USB-C cable')
  await main(page).getByLabel('Rename Buy a cable', { exact: true }).press('Enter')
  await expect(inbox(page, 'Work')).toContainText('Buy a USB-C cable')

  await main(page).getByLabel('Where Buy a USB-C cable lives').selectOption({ label: 'Personal' })
  await expect(inbox(page, 'Personal')).toContainText('Buy a USB-C cable')
  await expect(inbox(page, 'Work')).toHaveCount(0)

  // Dropping is a decision, so it is kept and can be undone.
  await main(page).getByRole('button', { name: 'Drop Buy a USB-C cable' }).click()
  await expect(inbox(page, 'Personal')).toHaveCount(0)
  await main(page).getByText('Done, dropped and archived (1)').click()
  await main(page).getByRole('button', { name: 'Reopen Buy a USB-C cable' }).click()
  await expect(inbox(page, 'Personal')).toContainText('Buy a USB-C cable')

  await main(page).getByRole('button', { name: 'Delete Buy a USB-C cable' }).click()
  await expect(main(page).getByText('Buy a USB-C cable')).toHaveCount(0)
})

test("a task can be put under one of today's intentions and taken out again", async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, "Today's intentions")
  await addIntention(page, 'Mono auth')
  await stage(page).getByRole('button', { name: 'Start the day' }).click()

  await openTasks(page)
  await addTo(page, 'Work', 'Login form')
  await main(page)
    .getByLabel("Today's intention for Login form")
    .selectOption({ label: 'Mono auth' })

  const today = main(page).getByRole('list', { name: 'Today: Mono auth' })
  await expect(today).toContainText('Login form')

  // And the purpose prompt offers it under that intention.
  await page.getByRole('link', { name: 'Back to today' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(
    stage(page).getByRole('group', { name: 'Mono auth' }).getByRole('checkbox', { name: 'Login form' }),
  ).toBeVisible()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  await openTasks(page)
  await today.getByRole('button', { name: 'Take Login form out of Mono auth' }).click()
  await expect(today).toHaveCount(0)
})

test('areas can be added, renamed, archived and restored', async ({ page }) => {
  await openMono(page)
  await openTasks(page)

  await main(page).getByLabel('New area', { exact: true }).fill('Health')
  await main(page).getByRole('button', { name: 'Add area' }).click()
  await expect(main(page).getByRole('heading', { name: 'Health' })).toBeVisible()

  await main(page).getByRole('button', { name: 'Rename Health' }).click()
  await main(page).getByLabel('Rename Health', { exact: true }).fill('Fitness')
  await main(page).getByLabel('Rename Health', { exact: true }).press('Enter')
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toBeVisible()

  await main(page).getByRole('button', { name: 'Archive Fitness' }).click()
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toHaveCount(0)
  await main(page).getByText('Archived (1)').click()
  await main(page).getByRole('button', { name: 'Restore' }).click()
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toBeVisible()
})

test('a block keeps running while the tasks page is open', async ({ page }) => {
  await openMono(page)
  await goToStage(page, "Today's intentions")
  await addIntention(page, 'Mono auth')
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
  await startBlock(page, 'Write the planner')

  await openTasks(page)
  // The header carries what the timer would be saying, and leads back to it.
  await expect(page.getByRole('link', { name: /Focusing/ })).toBeVisible()
  // The task the block was started with is in the backlog, ticked or not.
  await expect(inbox(page, 'Work')).toContainText('The task at hand')

  await page.clock.fastForward('10:00')
  await page.getByRole('link', { name: 'Back to today' }).click()
  await expect(stage(page).getByRole('button', { name: 'End early' })).toBeVisible()
})

const epic = (page: Page, title: string) =>
  main(page).getByRole('region', { name: `Epic: ${title}` })
const outcome = (page: Page, title: string) =>
  main(page).getByRole('region', { name: `Outcome: ${title}` })

async function addInto(page: Page, label: string, title: string) {
  await main(page).getByLabel(label, { exact: true }).fill(title)
  await main(page).getByLabel(label, { exact: true }).press('Enter')
}

/** Work › Mono auth › Login pages › Login form, plus a task straight under the epic. */
async function buildAuthEpic(page: Page) {
  await addInto(page, 'New epic in Work', 'Mono auth')
  await addInto(page, 'New outcome in Mono auth', 'Login pages')
  await addInto(page, 'New task in Login pages', 'Login form')
  await addInto(page, 'New task in Mono auth', 'CSRF token')
}

test('an epic holds outcomes, and both hold tasks', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  await expect(epic(page, 'Mono auth').getByRole('list', { name: 'Mono auth tasks' })).toContainText(
    'CSRF token',
  )
  await expect(
    outcome(page, 'Login pages').getByRole('list', { name: 'Login pages tasks' }),
  ).toContainText('Login form')

  // A task moves anywhere a task can live, by its full path.
  await addTo(page, 'Work', 'Rate limiting')
  await main(page)
    .getByLabel('Where Rate limiting lives')
    .selectOption({ label: 'Work › Mono auth › Login pages' })
  await expect(outcome(page, 'Login pages')).toContainText('Rate limiting')
  await expect(inbox(page, 'Work')).toHaveCount(0)

  await page.reload()
  await expect(outcome(page, 'Login pages')).toContainText('Rate limiting')
})

test('a finished epic takes its tasks with it, and reopening brings them back', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  await main(page).getByRole('button', { name: 'Mark Mono auth done' }).click()
  await expect(epic(page, 'Mono auth')).toHaveCount(0)
  await expect(main(page).getByText('Login form')).toHaveCount(0)

  await main(page).getByText('Done, dropped and archived (1)').click()
  await main(page).getByRole('button', { name: 'Reopen Mono auth' }).click()
  // Exactly as they were: the tasks were never touched.
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
  await expect(epic(page, 'Mono auth')).toContainText('CSRF token')
})

test('archiving puts an epic away without finishing anything in it', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  await main(page).getByRole('button', { name: 'Archive Login pages' }).click()
  await expect(outcome(page, 'Login pages')).toHaveCount(0)
  await expect(epic(page, 'Mono auth')).toContainText('CSRF token')

  await epic(page, 'Mono auth').getByText('Done, dropped and archived (1)').click()
  await main(page).getByRole('button', { name: 'Restore Login pages' }).click()
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
})

test('deleting an epic asks first, then takes everything in it', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addTo(page, 'Work', 'Call Priya')

  await epic(page, 'Mono auth').getByRole('button', { name: 'Delete Mono auth', exact: true }).click()
  // Three things go with it: the outcome and both tasks.
  await expect(main(page).getByText('And the 3 items inside?')).toBeVisible()
  await main(page).getByRole('button', { name: 'Keep' }).click()
  await expect(epic(page, 'Mono auth')).toBeVisible()

  await epic(page, 'Mono auth').getByRole('button', { name: 'Delete Mono auth', exact: true }).click()
  await main(page).getByRole('button', { name: 'Delete Mono auth and everything in it' }).click()
  await expect(epic(page, 'Mono auth')).toHaveCount(0)
  await expect(main(page).getByText('Login form')).toHaveCount(0)
  await expect(inbox(page, 'Work')).toContainText('Call Priya')

  await page.reload()
  await expect(main(page).getByText('Mono auth')).toHaveCount(0)
})
