/** The backlog's own page: areas, their inboxes, and today's grouping. */

import { expect, test, type Page } from '@playwright/test'
import {
  addIntention,
  addOnTasksPage,
  goToStage,
  importSession,
  openMono,
  stage,
  startBlock,
} from './support/mono'

const main = (page: Page) => page.getByRole('main')

async function openTasks(page: Page) {
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible()
}

const addTo = (page: Page, area: string, title: string) => addOnTasksPage(page, 'task', area, title)

const inbox = (page: Page, area: string) =>
  main(page).getByRole('list', { name: `${area} inbox` })

test('a new backlog starts with Work and Personal, and an inbox is just tasks', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)

  await expect(main(page).getByRole('heading', { name: 'Work' })).toBeVisible()
  await expect(main(page).getByRole('heading', { name: 'Personal' })).toBeVisible()

  // Every header carries both pages, the one you are on marked rather than
  // dropped, so the guide is one click away from here and back.
  const tasksLink = page.getByRole('link', { name: 'Tasks', exact: true })
  await expect(tasksLink).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await tasksLink.click()
  await expect(tasksLink).toHaveAttribute('aria-current', 'page')

  await addTo(page, 'Work', 'Call Priya')
  await expect(inbox(page, 'Work')).toContainText('Call Priya')

  // It is in IndexedDB, not in the day's log: a reload brings it back.
  await page.reload()
  await expect(inbox(page, 'Work')).toContainText('Call Priya')
})

test('an add field is folded until asked for, stays open for a run, and folds away again', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  const opener = main(page).getByRole('button', { name: 'Add a task to Work', exact: true })
  const field = main(page).getByLabel('New task in Work', { exact: true })

  await expect(field).toHaveCount(0)
  await opener.click()
  await expect(field).toBeFocused()

  // Open after each add, cleared and focused, so several go in a row.
  await field.fill('Call Priya')
  await field.press('Enter')
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await field.fill('Buy a cable')
  await field.press('Enter')
  await expect(inbox(page, 'Work')).toContainText('Call Priya')
  await expect(inbox(page, 'Work')).toContainText('Buy a cable')

  // Escape folds it and hands focus back to the button.
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(opener).toBeFocused()

  // Opening another folds it, but only while nothing is typed in it.
  const other = main(page).getByLabel('New task in Personal', { exact: true })
  await opener.click()
  await field.fill('Half a thought')
  await main(page).getByRole('button', { name: 'Add a task to Personal', exact: true }).click()
  await expect(other).toBeFocused()
  await expect(field).toHaveValue('Half a thought')

  await field.fill('')
  await main(page).getByRole('button', { name: 'Add an epic to Work', exact: true }).click()
  await expect(main(page).getByLabel('New epic in Work', { exact: true })).toBeFocused()
  await expect(field).toHaveCount(0)
  await expect(other).toHaveCount(0)
})

test('a new outcome is added beside the last one, where its column will stand', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await addOnTasksPage(page, 'epic', 'Work', 'Mono auth')
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Login pages')

  // The field stays open for the next outcome, now to the right of the first.
  const last = await outcome(page, 'Login pages').boundingBox()
  const slot = await main(page).getByLabel('New outcome in Mono auth', { exact: true }).boundingBox()
  expect(slot!.x).toBeGreaterThan(last!.x + last!.width)
  expect(slot!.y).toBeLessThan(last!.y + last!.height)
})

test('a task can be renamed, moved, dropped, reopened and deleted', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Buy a cable')

  await main(page).getByRole('button', { name: 'Rename Buy a cable' }).click()
  await main(page).getByLabel('Rename Buy a cable', { exact: true }).fill('Buy a USB-C cable')
  await main(page).getByLabel('Rename Buy a cable', { exact: true }).press('Enter')
  await expect(inbox(page, 'Work')).toContainText('Buy a USB-C cable')

  // Without a pointer, it is picked up by its grip and put down with the
  // `Move here` every other column then offers; focus goes with it.
  const grip = main(page).getByRole('button', { name: 'Move Buy a USB-C cable', exact: true })
  await grip.click()
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await main(page)
    .getByRole('button', { name: 'Move Buy a USB-C cable to Personal', exact: true })
    .click()
  await expect(inbox(page, 'Personal')).toContainText('Buy a USB-C cable')
  await expect(inbox(page, 'Work')).toHaveCount(0)
  await expect(grip).toBeFocused()
  await expect(main(page).getByRole('button', { name: 'Move here' })).toHaveCount(0)

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
  await goToStage(page, 'Intentions')
  await addIntention(page, 'Mono auth')
  await stage(page).getByRole('button', { name: 'Start the day' }).click()

  await openTasks(page)
  await expect(
    main(page).getByRole('heading', { name: 'My intentions for today' }),
  ).toBeVisible()
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

test("today's intentions can be written, edited and deleted from the tasks page", async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  // Written with its tasks, as on the opening question. Opening it folds the
  // empty add field the backlog was left with, as opening any add field does.
  const section = main(page).getByRole('region', { name: 'My intentions for today' })
  await expect(main(page).getByLabel('New task in Mono auth', { exact: true })).toBeVisible()
  await section.getByRole('button', { name: 'Add intention', exact: true }).click()
  await expect(main(page).getByLabel('New task in Mono auth', { exact: true })).toHaveCount(0)
  await section.getByLabel('Next intention', { exact: true }).fill('Ship it')
  await section.getByRole('button', { name: 'Tasks for this intention' }).click()
  await section
    .getByRole('group', { name: 'Tasks for this intention' })
    .getByRole('checkbox', { name: 'Login form' })
    .check()
  await section.getByRole('button', { name: 'Done', exact: true }).click()

  // Its tasks under their places, each said once.
  const today = section.getByRole('list', { name: 'Today: Ship it' })
  await expect(today).toContainText('Work › Mono auth › Login pages')
  await expect(today).toContainText('Login form')

  await section.getByRole('button', { name: 'Edit intention Ship it' }).click()
  await section.getByLabel('This intention', { exact: true }).fill('Ship the login pages')
  await section.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(section.getByRole('list', { name: 'Today: Ship the login pages' })).toContainText(
    'Login form',
  )

  // Deleting it leaves its tasks in the backlog.
  await section.getByRole('button', { name: 'Delete intention Ship the login pages' }).click()
  await expect(main(page).getByRole('heading', { name: 'Ship the login pages' })).toHaveCount(0)
  await expect(outcome(page, 'Login pages')).toContainText('Login form')

  // And the opening question sees what the page did.
  await page.getByRole('link', { name: 'Back to today' }).click()
  await goToStage(page, 'Intentions')
  await expect(stage(page).getByRole('list', { name: 'Intended today' })).toHaveCount(0)
})

test('areas can be added, renamed, archived and restored', async ({ page }) => {
  await openMono(page)
  await openTasks(page)

  // The field is folded away under its button until asked for.
  await expect(main(page).getByLabel('New area', { exact: true })).toHaveCount(0)
  await main(page).getByRole('button', { name: 'Add area' }).click()
  await main(page).getByLabel('New area', { exact: true }).fill('Health')
  // Done keeps what was typed and folds the field away under its heading.
  await main(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(main(page).getByRole('heading', { name: 'Health' })).toBeVisible()
  await expect(main(page).getByLabel('New area', { exact: true })).toHaveCount(0)
  await expect(main(page).getByRole('button', { name: 'Add area' })).toHaveAttribute(
    'aria-expanded',
    'false',
  )

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
  await goToStage(page, 'Intentions')
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

/** Work › Mono auth › Login pages › Login form, plus a task straight under the epic. */
async function buildAuthEpic(page: Page) {
  await addOnTasksPage(page, 'epic', 'Work', 'Mono auth')
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Login pages')
  await addOnTasksPage(page, 'task', 'Login pages', 'Login form')
  await addOnTasksPage(page, 'task', 'Mono auth', 'CSRF token')
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

  // A task is dragged to any column a task can live in.
  await addTo(page, 'Work', 'Rate limiting')
  await inbox(page, 'Work')
    .getByRole('listitem')
    .filter({ hasText: 'Rate limiting' })
    .dragTo(outcome(page, 'Login pages'))
  await expect(outcome(page, 'Login pages')).toContainText('Rate limiting')
  await expect(inbox(page, 'Work')).toHaveCount(0)

  await page.reload()
  await expect(outcome(page, 'Login pages')).toContainText('Rate limiting')
})

test('a task picked up is put back with Escape, and only other columns offer to take it', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  await main(page).getByRole('button', { name: 'Move Login form', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Moving Login form' })).toBeVisible()
  // Every column but its own: the epic's, and each area's inbox.
  await expect(
    outcome(page, 'Login pages').getByRole('button', { name: 'Move here' }),
  ).toHaveCount(0)
  await expect(
    main(page).getByRole('button', { name: 'Move Login form to Mono auth', exact: true }),
  ).toBeVisible()
  await expect(
    main(page).getByRole('button', { name: 'Move Login form to Personal', exact: true }),
  ).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(main(page).getByRole('button', { name: 'Move here' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Moving' })).toHaveCount(0)
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
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

test('deleting an area asks first, then takes everything in it and nothing else', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addTo(page, 'Work', 'Call Priya')
  await addTo(page, 'Personal', 'Fix the gate')

  await main(page).getByRole('button', { name: 'Delete Work', exact: true }).click()
  // The epic, its outcome, and three tasks.
  await expect(main(page).getByText('And the 5 items inside?')).toBeVisible()
  await main(page).getByRole('button', { name: 'Keep' }).click()
  await expect(main(page).getByRole('heading', { name: 'Work' })).toBeVisible()

  await main(page).getByRole('button', { name: 'Delete Work', exact: true }).click()
  await main(page).getByRole('button', { name: 'Delete Work and everything in it' }).click()
  await expect(main(page).getByRole('heading', { name: 'Work' })).toHaveCount(0)
  await expect(main(page).getByText('Login form')).toHaveCount(0)
  await expect(inbox(page, 'Personal')).toContainText('Fix the gate')

  await page.reload()
  await expect(main(page).getByRole('heading', { name: 'Work' })).toHaveCount(0)
  await expect(inbox(page, 'Personal')).toContainText('Fix the gate')
})

test('an empty area is deleted at once', async ({ page }) => {
  await openMono(page)
  await openTasks(page)

  await main(page).getByRole('button', { name: 'Delete Personal', exact: true }).click()
  await expect(main(page).getByRole('heading', { name: 'Personal' })).toHaveCount(0)
  await expect(main(page).getByRole('heading', { name: 'Work' })).toBeVisible()
})

test('an epic row holds its outcomes as columns beside its card, and its own tasks after them', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Password reset')

  const row = epic(page, 'Mono auth')
  const card = row.getByRole('heading', { name: 'Mono auth', level: 3 })
  const first = outcome(page, 'Login pages')
  const second = outcome(page, 'Password reset')
  const loose = row.getByRole('list', { name: 'Mono auth tasks' })

  // The card on the left of the rule, the board on the right of it, and the
  // outcomes level with each other along the top of the board.
  const [c, a, b] = await Promise.all([card, first, second].map((l) => l.boundingBox()))
  expect(a!.x).toBeGreaterThan(c!.x + c!.width)
  expect(b!.x).toBeGreaterThan(a!.x + a!.width)
  expect(Math.abs(b!.y - a!.y)).toBeLessThan(2)
  await expect(first.getByRole('list', { name: 'Login pages tasks' })).toContainText('Login form')
  await expect(loose).toContainText('CSRF token')
})

test('an import brings its backlog with it, replacing the one here, and it is saved', async ({
  page,
}) => {
  await openMono(page)
  await importSession(page, {
    version: 4,
    dayKey: '2026-08-20',
    events: [],
    tasks: {
      areas: [{ id: 'home', name: 'Home', order: 0, createdAt: 1, updatedAt: 1 }],
      items: [
        {
          id: 'gate',
          kind: 'task',
          title: 'Fix the gate',
          parentId: 'home',
          status: 'open',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
  })
  await openTasks(page)

  await expect(inbox(page, 'Home')).toContainText('Fix the gate')
  await expect(main(page).getByRole('heading', { name: 'Work' })).toHaveCount(0)

  // Written to IndexedDB before it was shown, so a reload finds it there.
  await page.reload()
  await expect(inbox(page, 'Home')).toContainText('Fix the gate')
})

test('an archived task is put away, not listed as work, and can be restored', async ({ page }) => {
  await openMono(page)
  // Nothing on the page archives a single task, but a file can carry one.
  await importSession(page, {
    version: 4,
    dayKey: '2026-08-20',
    events: [],
    tasks: {
      areas: [{ id: 'home', name: 'Home', order: 0, createdAt: 1, updatedAt: 1 }],
      items: [
        {
          id: 'gate',
          kind: 'task',
          title: 'Fix the gate',
          parentId: 'home',
          status: 'open',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'shed',
          kind: 'task',
          title: 'Paint the shed',
          parentId: 'home',
          status: 'open',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          archivedAt: 1,
        },
      ],
    },
  })
  await openTasks(page)

  await expect(inbox(page, 'Home')).toContainText('Fix the gate')
  await expect(inbox(page, 'Home')).not.toContainText('Paint the shed')
  await main(page).getByText('Done, dropped and archived (1)').click()
  await main(page).getByRole('button', { name: 'Restore Paint the shed' }).click()
  await expect(inbox(page, 'Home')).toContainText('Paint the shed')
})
