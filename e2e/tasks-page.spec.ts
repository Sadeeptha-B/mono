/** The backlog's own page: areas, their inboxes, and today's grouping. */

import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  openGuide,
  addOnTasksPage,
  addTodayTask,
  goToStage,
  importSession,
  openMono,
  stage,
  startBlock,
  startDay,
  storedItems,
  storedRecord,
  todayBrowser,
  todayList,
  todayOnTasksPage,
} from './support/mono'

const main = (page: Page) => page.getByRole('main')

async function openTasks(page: Page) {
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible()
}

const addTo = (page: Page, area: string, title: string) => addOnTasksPage(page, 'task', area, title)

const inbox = (page: Page, area: string) =>
  main(page).getByRole('list', { name: `${area} inbox` })

/** The backlog's two views: the board's work, and everything put away. */
const showPutAway = (page: Page) =>
  main(page).getByRole('button', { name: /^Put away/ }).click()
const showOpen = (page: Page) =>
  main(page)
    .getByRole('group', { name: 'Show in the backlog' })
    .getByRole('button', { name: 'Open', exact: true })
    .click()

test('a new backlog starts with Work and Personal, and an inbox is just tasks', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)

  await expect(main(page).getByRole('heading', { name: 'Work' })).toBeVisible()
  await expect(main(page).getByRole('heading', { name: 'Personal' })).toBeVisible()

  // Every header carries the places, the one you are on marked rather than
  // dropped, so the tasks page is one click back from the guide.
  const tasksLink = page.getByRole('link', { name: 'Tasks', exact: true })
  await expect(tasksLink).toHaveAttribute('aria-current', 'page')
  await openGuide(page)
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(tasksLink).not.toHaveAttribute('aria-current')
  await tasksLink.click()
  await expect(tasksLink).toHaveAttribute('aria-current', 'page')

  await addTo(page, 'Work', 'Call Priya')
  await expect(inbox(page, 'Work')).toContainText('Call Priya')

  // It is in IndexedDB, not in the day's log: a reload brings it back.
  await expect.poll(() => storedRecord(page, 'Call Priya')).not.toBeNull()
  await page.reload()
  await expect(inbox(page, 'Work')).toContainText('Call Priya')
})

test('an add field is folded until asked for, stays open for a run, and keeps what it holds when left', async ({
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

  // Escape and the × throw away what is typed in it.
  await opener.click()
  await field.fill('Never mind')
  await field.press('Escape')
  await expect(opener).toBeFocused()
  await opener.click()
  await field.fill('Not this either')
  await main(page).getByRole('button', { name: 'Cancel new task in Work', exact: true }).click()
  await expect(field).toHaveCount(0)
  await expect(inbox(page, 'Work')).not.toContainText('Never mind')
  await expect(inbox(page, 'Work')).not.toContainText('Not this either')

  // Left for another field, it keeps what was typed and folds — and the click
  // that left it lands where it was aimed, though the row it added and the
  // field folding moved that further down the page.
  const other = main(page).getByLabel('New task in Personal', { exact: true })
  await opener.click()
  await field.fill('Half a thought')
  await main(page).getByRole('button', { name: 'Add a task to Personal', exact: true }).click()
  await expect(other).toBeFocused()
  await expect(field).toHaveCount(0)
  await expect(inbox(page, 'Work')).toContainText('Half a thought')

  // Tab out of it keeps it too — past its own ×, which is still inside it —
  // and the focus goes on where Tab took it.
  await other.fill('Tabbed away')
  await other.press('Tab')
  await expect(main(page).getByRole('button', { name: 'Cancel new task in Personal' })).toBeFocused()
  await expect(other).toHaveValue('Tabbed away')
  await page.keyboard.press('Tab')
  await expect(other).toHaveCount(0)
  await expect(inbox(page, 'Personal')).toContainText('Tabbed away')
  await expect(main(page).getByRole('button', { name: 'Add area', exact: true })).toBeFocused()

  // Left empty, it only folds, and the focus stays on the page it went to
  // rather than being pulled back to the heading.
  await opener.click()
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()
  await expect(field).toHaveCount(0)
  await expect(opener).not.toBeFocused()
  await expect(inbox(page, 'Work').getByRole('listitem')).toHaveCount(3)
})

test('a field left by a drag keeps what was typed once the drag is let go', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Call Priya')
  const field = main(page).getByLabel('New task in Personal', { exact: true })
  await main(page).getByRole('button', { name: 'Add a task to Personal', exact: true }).click()
  await field.fill('Fix the gate')

  // Nothing moves while the row is in the air; both land once it is let go.
  await drag(
    page,
    inbox(page, 'Work').getByRole('listitem').filter({ hasText: 'Call Priya' }),
    main(page).getByText('The inbox is empty.', { exact: true }),
    { x: 10, y: 4 },
  )
  await expect(inbox(page, 'Personal')).toContainText('Call Priya')
  await expect(inbox(page, 'Personal')).toContainText('Fix the gate')
  await expect(field).toHaveCount(0)
})

test('a field left by a press the browser cancels keeps what was typed without waiting for another', async ({
  page,
}) => {
  // Regression: only a release or a drop ended the wait, so a press cancelled
  // with no drag begun — a gesture the browser took over — left the field
  // waiting for some later, unrelated release to keep what it held.
  await openMono(page)
  await openTasks(page)
  const field = main(page).getByLabel('New task in Work', { exact: true })
  await main(page).getByRole('button', { name: 'Add a task to Work', exact: true }).click()
  await field.fill('Fix the gate')

  const title = (await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).boundingBox())!
  await page.mouse.move(title.x + 4, title.y + 4)
  await page.mouse.down()
  await expect(field).not.toBeFocused()
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel')))
  await expect(inbox(page, 'Work')).toContainText('Fix the gate')
  await expect(field).toHaveCount(0)
  await page.mouse.up()
})

test("a new task's card is drawn where the task will stand", async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Call Priya')
  await addTo(page, 'Work', 'Buy a cable')
  // Finished today, it stays under the open ones, below where a new one goes.
  await main(page).getByRole('checkbox', { name: 'Buy a cable done' }).check()
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()

  const opener = main(page).getByRole('button', { name: 'Add a task to Work', exact: true })
  await opener.click()
  await expect(opener).toHaveCount(0)
  const field = main(page).getByLabel('New task in Work', { exact: true })
  const card = (await field.boundingBox())!
  const open = (await inbox(page, 'Work').boundingBox())!
  const done = (await main(page).getByRole('list', { name: 'Work done today' }).boundingBox())!
  expect(card.y).toBeGreaterThan(open.y + open.height)
  expect(card.y + card.height).toBeLessThan(done.y)

  // Added, it takes the card's place, and the next card waits under it.
  await field.fill('Fix the printer')
  await field.press('Enter')
  const row = (await inbox(page, 'Work').getByRole('listitem').last().boundingBox())!
  expect(row.y).toBeLessThan(card.y + card.height)
  expect(row.y + row.height).toBeGreaterThan(card.y)
  await expect(inbox(page, 'Work').getByRole('listitem').last()).toContainText('Fix the printer')
  await expect(field).toBeFocused()
})

test('a title on the board is renamed by a double-click, as by its ✎', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  const field = (name: string) => main(page).getByRole('textbox', { name, exact: true })

  await outcome(page, 'Login pages').getByText('Login form', { exact: true }).dblclick()
  await field('Rename Login form').fill('Login screen')
  await field('Rename Login form').press('Enter')
  await expect(outcome(page, 'Login pages')).toContainText('Login screen')

  await outcome(page, 'Login pages').getByRole('heading', { name: 'Login pages' }).dblclick()
  await field('Rename Login pages').fill('Sign-in pages')
  await field('Rename Login pages').press('Enter')
  await expect(outcome(page, 'Sign-in pages')).toBeVisible()

  await main(page).getByRole('heading', { name: 'Work', level: 2 }).dblclick()
  await field('Rename Work').fill('Day job')
  await field('Rename Work').press('Enter')
  await expect(main(page).getByRole('heading', { name: 'Day job', level: 2 })).toBeVisible()
})

test('outcomes start folded on the board, but one written there starts open', async ({ page }) => {
  await openMono(page)
  await importSession(page, {
    version: 4,
    dayKey: '2026-08-20',
    events: [],
    tasks: {
      areas: [{ id: 'home', name: 'Home', order: 0, createdAt: 1, updatedAt: 1 }],
      items: [
        { id: 'move', kind: 'epic', title: 'Move house', parentId: 'home', status: 'open', order: 0, createdAt: 1, updatedAt: 1 },
        { id: 'pack', kind: 'outcome', title: 'Packing', parentId: 'move', status: 'open', order: 0, createdAt: 1, updatedAt: 1 },
        { id: 'box', kind: 'task', title: 'Buy boxes', parentId: 'pack', status: 'open', order: 0, createdAt: 1, updatedAt: 1 },
      ],
    },
  })
  await openTasks(page)

  // The epic is open, its outcome folded to its card until asked for.
  await expect(outcome(page, 'Packing')).toContainText('1 open task')
  await expect(outcome(page, 'Packing')).not.toContainText('Buy boxes')
  await main(page).getByRole('button', { name: 'What Packing holds', exact: true }).click()
  await expect(outcome(page, 'Packing')).toContainText('Buy boxes')

  // Written here, an outcome is open for its tasks at once.
  await addOnTasksPage(page, 'outcome', 'Move house', 'Utilities')
  await expect(
    main(page).getByRole('button', { name: 'What Utilities holds', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await addOnTasksPage(page, 'task', 'Utilities', 'Move the broadband')
  await expect(outcome(page, 'Utilities')).toContainText('Move the broadband')
})

test('Later keeps its own Done and Save, and is not kept by being left', async ({ page }) => {
  await openMono(page)
  await page.getByRole('link', { name: 'Timeline', exact: true }).click()
  const later = main(page).getByRole('region', { name: 'Later', exact: true })
  const field = later.getByLabel('New for later', { exact: true })

  await later.getByRole('button', { name: 'Add to Later', exact: true }).click()
  await field.fill('Learn the cello')
  await main(page).getByRole('heading', { name: 'Timeline', level: 1 }).click()
  await expect(field).toHaveValue('Learn the cello')
  await expect(later.getByRole('list', { name: 'Waiting for later' })).toHaveCount(0)
  await later.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(later.getByRole('list', { name: 'Waiting for later' })).toContainText(
    'Learn the cello',
  )

  await later.getByRole('button', { name: 'Rename Learn the cello' }).click()
  const rename = later.getByRole('textbox', { name: 'Rename Learn the cello', exact: true })
  await rename.fill('Learn the viola')
  await main(page).getByRole('heading', { name: 'Timeline', level: 1 }).click()
  await expect(rename).toHaveValue('Learn the viola')
  await later.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(later.getByRole('list', { name: 'Waiting for later' })).toContainText(
    'Learn the viola',
  )
})

test('a rename on the board is kept when the field is left, and an untouched one writes nothing', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Buy a cable')
  const rename = main(page).getByRole('textbox', { name: 'Rename Buy a cable', exact: true })

  // No Save to press: a click anywhere else keeps it.
  await main(page).getByRole('button', { name: 'Rename Buy a cable' }).click()
  await expect(main(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await rename.fill('Buy a USB-C cable')
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()
  await expect(rename).toHaveCount(0)
  await expect(inbox(page, 'Work')).toContainText('Buy a USB-C cable')
  await expect.poll(async () => (await storedRecord(page, 'Buy a USB-C cable'))?.title).toBe(
    'Buy a USB-C cable',
  )

  // Opened and left as it was, it closes without a write.
  const stamp = async () =>
    ((await storedRecord(page, 'Buy a USB-C cable')) as { updatedAt?: number } | null)?.updatedAt
  const before = await stamp()
  await main(page).getByRole('button', { name: 'Rename Buy a USB-C cable' }).click()
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()
  await expect(
    main(page).getByRole('textbox', { name: 'Rename Buy a USB-C cable', exact: true }),
  ).toHaveCount(0)

  // Escape still puts the old title back.
  await main(page).getByRole('button', { name: 'Rename Buy a USB-C cable' }).click()
  await main(page).getByRole('textbox', { name: 'Rename Buy a USB-C cable' }).fill('Typo')
  await page.keyboard.press('Escape')
  await expect(inbox(page, 'Work')).toContainText('Buy a USB-C cable')
  await expect(inbox(page, 'Work')).not.toContainText('Typo')
  // Read last, so a write either of them made has had time to reach the disk.
  expect(await stamp()).toBe(before)
})

test('a rename on the board is kept when the click that leaves it takes the field away', async ({
  page,
}) => {
  // Regression: the leave waited for the click, the click folded or finished
  // the row the field was in, and what was typed went with the field.
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  const field = (name: string) => main(page).getByRole('textbox', { name, exact: true })

  // Folding the outcome the task is in.
  await outcome(page, 'Login pages').getByText('Login form', { exact: true }).dblclick()
  await field('Rename Login form').fill('Login screen')
  await main(page).getByRole('button', { name: 'What Login pages holds', exact: true }).click()
  await expect(outcome(page, 'Login pages')).toContainText('1 open task')
  await main(page).getByRole('button', { name: 'What Login pages holds', exact: true }).click()
  await expect(outcome(page, 'Login pages')).toContainText('Login screen')

  // Ticking the task itself done: it is crossed out under its new name.
  await outcome(page, 'Login pages').getByText('Login screen', { exact: true }).dblclick()
  await field('Rename Login screen').fill('Sign-in screen')
  // A click rather than `check`: the box ticked leaves with its row.
  await main(page).getByRole('checkbox', { name: 'Login screen done', exact: true }).click()
  await expect(
    main(page).getByRole('list', { name: 'Login pages done today', exact: true }),
  ).toContainText('Sign-in screen')
  await expect.poll(async () => (await storedRecord(page, 'Sign-in screen'))?.title).toBe(
    'Sign-in screen',
  )

  // Turning the page to what is put away.
  await main(page).getByRole('heading', { name: 'Work', level: 2 }).dblclick()
  await field('Rename Work').fill('Day job')
  await showPutAway(page)
  await showOpen(page)
  await expect(main(page).getByRole('heading', { name: 'Day job', level: 2 })).toBeVisible()

  // Going to another page, which takes the whole board away.
  await main(page).getByRole('heading', { name: 'Day job', level: 2 }).dblclick()
  await field('Rename Day job').fill('Work')
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Timeline' }).click()
  await openTasks(page)
  await expect(main(page).getByRole('heading', { name: 'Work', level: 2 })).toBeVisible()
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
  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Reopen Buy a USB-C cable' }).click()
  await showOpen(page)
  await expect(inbox(page, 'Personal')).toContainText('Buy a USB-C cable')

  await main(page).getByRole('button', { name: 'Delete Buy a USB-C cable' }).click()
  await expect(main(page).getByText('Buy a USB-C cable')).toHaveCount(0)
})

test('a task is chosen for today with the sun on its row, and taken out again', async ({
  page,
}) => {
  await openMono(page)
  await startDay(page)

  await openTasks(page)
  await addTo(page, 'Work', 'Login form')
  const sun = main(page).getByRole('button', { name: 'Login form for today', exact: true })
  await expect(sun).toHaveAttribute('aria-pressed', 'false')
  // Today's list is behind the sun in the corner, and fills as the board's suns are pressed.
  const today = await todayOnTasksPage(page)
  await sun.click()
  await expect(today).toContainText('Login form')
  await expect(sun).toHaveAttribute('aria-pressed', 'true')

  // And the purpose prompt shows it in today's list, beside All Tasks.
  await page.getByRole('link', { name: 'Back to today' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(
    page.getByRole('complementary').getByRole('region', { name: "Today's tasks", exact: true }),
  ).toContainText('Login form')
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // Taken out from today's own list, it stays in the backlog.
  await openTasks(page)
  await todayOnTasksPage(page)
  await today.getByRole('button', { name: 'Take Login form out of today' }).click()
  await expect(today).not.toContainText('Login form')
  await expect(inbox(page, 'Work')).toContainText('Login form')
  await expect(sun).toHaveAttribute('aria-pressed', 'false')
})

test("today's tasks are grouped from the tasks page as on the opening question", async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  // The empty add field the backlog was left with folds as soon as anything
  // else is pressed.
  await expect(main(page).getByLabel('New task in Mono auth', { exact: true })).toBeVisible()
  await main(page).getByRole('button', { name: 'Login form for today', exact: true }).click()
  await main(page).getByRole('button', { name: 'CSRF token for today', exact: true }).click()
  await expect(main(page).getByLabel('New task in Mono auth', { exact: true })).toHaveCount(0)

  const section = await todayOnTasksPage(page)
  await section.getByRole('button', { name: 'Add intention', exact: true }).click()
  await section.getByLabel('New intention', { exact: true }).fill('Ship it')
  await section.getByLabel('New intention', { exact: true }).press('Enter')

  // Carried in by its grip, and shown under its places, each said once.
  const group = section.getByRole('region', { name: 'Intention: Ship it' })
  await section.getByRole('button', { name: 'Move Login form', exact: true }).click()
  await section.getByRole('button', { name: 'Move Login form to Ship it', exact: true }).click()
  await expect(group).toContainText('Work › Mono auth › Login pages')
  await expect(group).toContainText('Login form')

  await group.getByRole('button', { name: 'Rename intention Ship it' }).click()
  const rename = section.getByLabel('Rename intention Ship it', { exact: true })
  await rename.fill('Ship the login pages')
  await rename.press('Enter')
  await expect(section.getByRole('region', { name: 'Intention: Ship the login pages' })).toContainText(
    'Login form',
  )

  // Deleting it leaves its tasks today, and in the backlog.
  await section.getByRole('button', { name: 'Delete intention Ship the login pages' }).click()
  await expect(section.getByRole('region', { name: /^Intention:/ })).toHaveCount(0)
  await expect(section).toContainText('Login form')
  await expect(outcome(page, 'Login pages')).toContainText('Login form')

  // And the opening question sees what the page did.
  await page.getByRole('link', { name: 'Back to today' }).click()
  await goToStage(page, 'Today')
  await expect(todayList(page)).toContainText('Login form')
  await expect(todayList(page)).toContainText('CSRF token')
})

test('an intention being renamed here does not outlive the session it was about', async ({
  page,
}) => {
  // Regression: the editor kept its draft across an import. Saved afterwards,
  // an edit to an intention the import brought back under the same id wrote
  // its pre-import title over the imported one.
  const day = (title: string) => ({
    version: 5,
    dayKey: '2026-08-20',
    events: [
      {
        type: 'intention/added',
        at: new Date(2026, 7, 20, 9, 0, 0).getTime(),
        intention: { id: 'ship', title },
      },
    ],
  })
  await openMono(page)
  await importSession(page, day('Ship it'))
  await openTasks(page)

  const section = await todayOnTasksPage(page)
  await section.getByRole('button', { name: 'Rename intention Ship it' }).click()
  await section.getByLabel('Rename intention Ship it', { exact: true }).fill('Stale edit')

  await importSession(page, day('Ship the login pages'))
  await expect(section.getByLabel('Rename intention Ship it', { exact: true })).toHaveCount(0)
  await expect(
    section.getByRole('button', { name: 'Rename intention Ship the login pages' }),
  ).toBeVisible()
})

test('areas can be added, renamed, archived and restored', async ({ page }) => {
  await openMono(page)
  await openTasks(page)

  // The field is not there until asked for, and then stands where the new
  // band will, in place of the button that asked for it.
  const addArea = main(page).getByRole('button', { name: 'Add area', exact: true })
  await expect(main(page).getByLabel('New area', { exact: true })).toHaveCount(0)
  await addArea.click()
  await expect(addArea).toHaveCount(0)
  await main(page).getByLabel('New area', { exact: true }).fill('Health')
  // Leaving the field keeps what was typed, and the button comes back.
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()
  await expect(main(page).getByRole('heading', { name: 'Health' })).toBeVisible()
  await expect(main(page).getByLabel('New area', { exact: true })).toHaveCount(0)
  await expect(addArea).toBeVisible()

  await main(page).getByRole('button', { name: 'Rename Health' }).click()
  await main(page).getByLabel('Rename Health', { exact: true }).fill('Fitness')
  await main(page).getByLabel('Rename Health', { exact: true }).press('Enter')
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toBeVisible()

  await main(page).getByRole('button', { name: 'Archive Fitness' }).click()
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toHaveCount(0)
  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Restore Fitness' }).click()
  await showOpen(page)
  await expect(main(page).getByRole('heading', { name: 'Fitness' })).toBeVisible()
})

test('a block keeps running while the tasks page is open', async ({ page }) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Mono auth')
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

test("today's list opens from the corner, stays open while the board is used, and closes back to its button", async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Login form')
  const button = main(page).getByRole('button', { name: 'Today and draft', exact: true })
  const panel = main(page).getByRole('dialog', { name: 'Today and draft' })

  // Not on the page until asked for; the board is the page.
  await expect(panel).toHaveCount(0)
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toContainText('Nothing chosen for today yet')

  // The board behind it still answers, and the list fills as it does.
  await main(page).getByRole('button', { name: 'Login form for today', exact: true }).click()
  await expect(panel).toContainText('Login form')

  // Escape from inside it closes it, and hands the focus back to its button.
  await panel.getByRole('button', { name: 'Add intention', exact: true }).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(button).toBeFocused()

  // As does its ×.
  await button.click()
  await panel.getByRole('button', { name: 'Close today and draft', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(button).toBeFocused()
})

test("closing today's list keeps what is being written in it", async ({ page }) => {
  // Regression: the drafts were held inside the panel, and closing it threw
  // a half-written rename and a half-named intention away.
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Login form')
  await main(page).getByRole('button', { name: 'Login form for today', exact: true }).click()
  const button = main(page).getByRole('button', { name: 'Today and draft', exact: true })
  const panel = await todayOnTasksPage(page)
  const newIntention = panel.getByLabel('New intention', { exact: true })
  const rename = panel.getByRole('textbox', { name: 'Rename intention Ship it', exact: true })

  await panel.getByRole('button', { name: 'Add intention', exact: true }).click()
  await newIntention.fill('Ship it')
  await newIntention.press('Enter')
  await newIntention.fill('Tidy up')
  await panel.getByRole('button', { name: 'Rename intention Ship it' }).click()
  await rename.fill('Ship the login form')

  await button.click()
  await expect(panel).toHaveCount(0)
  await button.click()
  await expect(newIntention).toHaveValue('Tidy up')
  await expect(rename).toHaveValue('Ship the login form')

  // Nor does a look at the draft beside it.
  await panel.getByRole('tab', { name: 'Draft', exact: true }).click()
  await expect(newIntention).toHaveCount(0)
  await panel.getByRole('tab', { name: 'Today', exact: true }).click()
  await expect(newIntention).toHaveValue('Tidy up')
  await expect(rename).toHaveValue('Ship the login form')
  await rename.press('Enter')
  await expect(panel.getByRole('region', { name: 'Intention: Ship the login form' })).toBeVisible()
})

test("the board's two views are switched beside the page's title", async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  const title = (await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).boundingBox())!
  const views = (await main(page).getByRole('group', { name: 'Show in the backlog' }).boundingBox())!
  expect(views.x).toBeGreaterThan(title.x + title.width)
  expect(views.y).toBeLessThan(title.y + title.height)
  expect(views.y + views.height).toBeGreaterThan(title.y)
})

test('a pick-up in Today and one on the board are never both in hand', async ({ page }) => {
  // Regression: each kept its own, and the two status bars stood in one place.
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Login form')
  await addTo(page, 'Work', 'Rate limiting')
  await main(page).getByRole('button', { name: 'Login form for today', exact: true }).click()
  const today = await todayOnTasksPage(page)
  const moving = page.getByRole('status').filter({ hasText: 'Moving' })
  const boardMove = main(page).getByRole('button', {
    name: 'Move Rate limiting to Personal',
    exact: true,
  })

  await today.getByRole('button', { name: 'Move Login form', exact: true }).click()
  await expect(moving).toContainText('Login form')
  await inbox(page, 'Work').getByRole('button', { name: 'Move Rate limiting', exact: true }).click()
  await expect(moving).toHaveCount(1)
  await expect(moving).toContainText('Rate limiting')
  await expect(boardMove).toBeVisible()

  await today.getByRole('button', { name: 'Move Login form', exact: true }).click()
  await expect(moving).toHaveCount(1)
  await expect(moving).toContainText('Login form')
  await expect(boardMove).toHaveCount(0)
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

  // On disk under its new parent before the reload that proves it.
  await expect
    .poll(async () => {
      const stored = await storedItems(page)
      const task = stored.find((r) => r.title === 'Rate limiting')
      return stored.find((r) => r.id === task?.parentId)?.title
    })
    .toBe('Login pages')
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

  // A task that leaves play in hand is put down for good: reopening it does
  // not bring the old move back without another pick-up.
  const grip = main(page).getByRole('button', { name: 'Move Login form', exact: true })
  await grip.click()
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await main(page).getByRole('button', { name: 'Drop Login form' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Moving' })).toHaveCount(0)
  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Reopen Login form' }).click()
  await showOpen(page)
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
  await expect(grip).toHaveAttribute('aria-pressed', 'false')
  await expect(main(page).getByRole('button', { name: 'Move here' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Moving' })).toHaveCount(0)
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

  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Reopen Mono auth' }).click()
  await showOpen(page)
  // Exactly as they were: the tasks were never touched.
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
  await expect(epic(page, 'Mono auth')).toContainText('CSRF token')
})

test('a finished outcome is put away with its tasks nested under it, each as it was', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addOnTasksPage(page, 'task', 'Login pages', 'Remember me')
  await main(page).getByRole('checkbox', { name: 'Login form done' }).check()

  await main(page).getByRole('button', { name: 'Mark Login pages done' }).click()
  await expect(outcome(page, 'Login pages')).toHaveCount(0)
  await showPutAway(page)
  const work = main(page).getByRole('region', { name: 'Put away in Work' })
  await expect(work).toContainText('Mono auth')
  const inside = work.getByRole('list', { name: 'Inside Login pages' })
  await expect(inside.getByRole('listitem')).toHaveText(['Done: Login form', 'Open: Remember me'])
  await expect(inside.getByText('Login form', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )

  // The outcome's card is where they come back from, as they were.
  await work.getByRole('button', { name: 'Reopen Login pages' }).click()
  await showOpen(page)
  await expect(
    outcome(page, 'Login pages').getByRole('list', { name: 'Login pages tasks' }),
  ).toContainText('Remember me')
  await expect(
    outcome(page, 'Login pages').getByRole('list', { name: 'Login pages tasks' }),
  ).not.toContainText('Login form')
})

test("a task ticked today stays in today's backlog, crossed out rather than offered", async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await main(page).getByRole('checkbox', { name: 'Login form done' }).check()

  await page.getByRole('link', { name: 'Back to today' }).click()
  await goToStage(page, 'Today')
  const tree = todayBrowser(page)
  await tree.getByRole('button', { name: 'Epic: Mono auth', exact: true }).click()
  await tree.getByRole('button', { name: 'Outcome: Login pages', exact: true }).click()
  await expect(tree.getByRole('checkbox', { name: 'CSRF token' })).toBeVisible()
  await expect(tree.getByText('Login form', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  await expect(tree.getByRole('checkbox', { name: /Login form/ })).toHaveCount(0)
})

test('a task ticked on the board stays in its column today, crossed out, and unticks there', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await addTo(page, 'Work', 'Call Priya')
  await addTo(page, 'Work', 'Old cable')

  await main(page).getByRole('checkbox', { name: 'Call Priya done' }).check()
  const done = main(page).getByRole('list', { name: 'Work done today' })
  await expect(done.getByText('Call Priya', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  await expect(inbox(page, 'Work')).not.toContainText('Call Priya')

  // Everything put away is on the other view, which narrows by kind.
  await main(page).getByRole('button', { name: 'Drop Old cable' }).click()
  await showPutAway(page)
  const work = main(page).getByRole('region', { name: 'Put away in Work' })
  await expect(work).toContainText('Call Priya')
  await expect(work).toContainText('Old cable')
  await main(page)
    .getByRole('group', { name: 'Show what is put away' })
    .getByRole('button', { name: /^Dropped/ })
    .click()
  await expect(work).toContainText('Old cable')
  await expect(work).not.toContainText('Call Priya')

  // A tick made by mistake is undone where it was made.
  await showOpen(page)
  await main(page).getByRole('checkbox', { name: 'Call Priya done' }).uncheck()
  await expect(inbox(page, 'Work')).toContainText('Call Priya')
  await expect(done).toHaveCount(0)
})

test('an outcome folds by its caret and still takes a task; an epic folds every column in its row', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addTo(page, 'Work', 'Rate limiting')
  const fold = (title: string) =>
    main(page).getByRole('button', { name: `What ${title} holds`, exact: true })
  const pagesTasks = outcome(page, 'Login pages').getByRole('list', { name: 'Login pages tasks' })
  const ownTasks = epic(page, 'Mono auth').getByRole('list', { name: 'Mono auth tasks' })

  // A folded outcome is its card, saying how much it holds.
  await fold('Login pages').click()
  await expect(fold('Login pages')).toHaveAttribute('aria-expanded', 'false')
  await expect(pagesTasks).toHaveCount(0)
  await expect(outcome(page, 'Login pages')).toContainText('1 open task')

  // A task is put down in it without opening it.
  await main(page).getByRole('button', { name: 'Move Rate limiting', exact: true }).click()
  await main(page)
    .getByRole('button', { name: 'Move Rate limiting to Login pages', exact: true })
    .click()
  await expect(outcome(page, 'Login pages')).toContainText('2 open tasks')
  await expect(inbox(page, 'Work')).toHaveCount(0)
  // Its row is folded away, so the focus rests on the fold that holds it.
  await expect(fold('Login pages')).toBeFocused()

  // The epic's own tasks are still showing, so the epic is not folded. Its
  // caret folds every column in the row, and keeps its outcomes' cards.
  await expect(fold('Mono auth')).toHaveAttribute('aria-expanded', 'true')
  await fold('Mono auth').click()
  await expect(fold('Mono auth')).toHaveAttribute('aria-expanded', 'false')
  await expect(ownTasks).toHaveCount(0)
  await expect(epic(page, 'Mono auth').getByText('1 open task', { exact: true })).toBeVisible()
  await expect(outcome(page, 'Login pages')).toContainText('2 open tasks')
  await expect(fold('Login pages')).toHaveAttribute('aria-expanded', 'false')

  // Kept across a reload; unfolded, every column in the row opens.
  await page.reload()
  await expect(fold('Mono auth')).toHaveAttribute('aria-expanded', 'false')
  await expect(ownTasks).toHaveCount(0)
  await fold('Mono auth').click()
  await expect(pagesTasks).toContainText('Rate limiting')
  await expect(ownTasks).toContainText('CSRF token')

  // Each column still folds on its own afterwards.
  await fold('Login pages').click()
  await expect(pagesTasks).toHaveCount(0)
  await expect(ownTasks).toContainText('CSRF token')
  await expect(fold('Mono auth')).toHaveAttribute('aria-expanded', 'true')
})

test('archiving puts an epic away without finishing anything in it', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  await main(page).getByRole('button', { name: 'Archive Login pages' }).click()
  await expect(outcome(page, 'Login pages')).toHaveCount(0)
  await expect(epic(page, 'Mono auth')).toContainText('CSRF token')

  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Restore Login pages' }).click()
  await showOpen(page)
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

  await expect.poll(async () => (await storedRecord(page, 'Mono auth'))?.deletedAt).toBeDefined()
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

  await expect.poll(async () => (await storedRecord(page, 'Work'))?.deletedAt).toBeDefined()
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

test('the tasks straight under an epic are headed as its own tasks', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)

  const loose = epic(page, 'Mono auth').getByRole('list', { name: 'Mono auth tasks' })
  // Its heading is also what folds it, so it reads as whose tasks they are.
  const heading = epic(page, 'Mono auth').getByRole('heading', {
    name: 'Tasks straight under Mono auth',
    exact: true,
  })
  await expect(heading).toHaveText('Tasks')
  const [h, l] = await Promise.all([heading, loose].map((x) => x.boundingBox()))
  expect(Math.abs(h!.x - l!.x)).toBeLessThan(8)
  expect(h!.y).toBeLessThan(l!.y)
})

/** A pointer's drag in steps, as a hand would: a single jump gives the drag no move to begin on. */
async function drag(page: Page, from: Locator, to: Locator, at: { x: number; y: number }) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + 8, a.y + 8)
  await page.mouse.down()
  await page.mouse.move(a.x + 16, a.y + 16, { steps: 5 })
  const b = (await to.boundingBox())!
  await page.mouse.move(b.x + at.x, b.y + at.y, { steps: 10 })
  await page.mouse.up()
}

test('tasks are put in order by dragging between rows, and a step at a time from their grips', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  for (const title of ['First', 'Second', 'Third']) await addTo(page, 'Work', title)
  await addTo(page, 'Personal', 'Elsewhere')
  const rows = inbox(page, 'Work').getByRole('listitem')
  const row = (title: string) => rows.filter({ hasText: title })

  // Let go over the top half of a row, it lands above that row.
  await drag(page, row('Third'), row('First'), { x: 40, y: 4 })
  await expect(rows).toHaveText([/Third/, /First/, /Second/])

  // Between two rows of another column, it moves there, at that spot.
  await drag(page, row('First'), inbox(page, 'Personal').getByRole('listitem'), { x: 40, y: 4 })
  await expect(inbox(page, 'Personal').getByRole('listitem')).toHaveText([/First/, /Elsewhere/])
  await expect(rows).toHaveText([/Third/, /Second/])

  // From the keyboard the grip steps it, keeping the focus as it goes.
  const grip = main(page).getByRole('button', { name: 'Move Third', exact: true })
  await grip.focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows).toHaveText([/Second/, /Third/])
  await expect(grip).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(rows).toHaveText([/Third/, /Second/])
  await expect(grip).toBeFocused()

  // Kept on the disk, so a reload draws it the same way.
  await expect
    .poll(async () => {
      const stored = await storedItems(page)
      const order = (title: string) =>
        (stored.find((r) => r.title === title) as { order?: number } | undefined)?.order ?? 0
      return order('Third') < order('Second')
    })
    .toBe(true)
  await page.reload()
  await expect(rows).toHaveText([/Third/, /Second/])
})

test('outcomes, epics and areas are put in order by dragging, and by their move icons', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Password reset')
  await addOnTasksPage(page, 'epic', 'Work', 'Billing')
  const x = async (title: string) => (await outcome(page, title).boundingBox())!.x
  const y = async (locator: Locator) => (await locator.boundingBox())!.y

  // An outcome's card dragged over the left half of another lands before it.
  await drag(
    page,
    outcome(page, 'Password reset').getByRole('heading', { name: 'Password reset' }),
    outcome(page, 'Login pages'),
    { x: 10, y: 20 },
  )
  expect(await x('Password reset')).toBeLessThan(await x('Login pages'))

  // Its move icons do the same a step at a time; at the end of the row the one
  // that cannot move stays, and keeps the focus.
  const right = main(page).getByRole('button', { name: 'Move Password reset right', exact: true })
  await right.click()
  expect(await x('Password reset')).toBeGreaterThan(await x('Login pages'))
  await expect(right).toBeFocused()
  await expect(right).toHaveAttribute('aria-disabled', 'true')

  // Epics step up and down their area.
  await main(page).getByRole('button', { name: 'Move Billing up', exact: true }).click()
  expect(await y(epic(page, 'Billing'))).toBeLessThan(await y(epic(page, 'Mono auth')))

  // Areas by their names, and by their own icons. Tall enough to hold both
  // bands, since a drag cannot point at what is scrolled out of sight.
  await page.setViewportSize({ width: 1280, height: 1600 })
  const heading = (name: string) => main(page).getByRole('heading', { name, level: 2 })
  await drag(page, heading('Personal'), heading('Work'), { x: 10, y: 2 })
  expect(await y(heading('Personal'))).toBeLessThan(await y(heading('Work')))
  await main(page).getByRole('button', { name: 'Move Work up', exact: true }).click()
  expect(await y(heading('Work'))).toBeLessThan(await y(heading('Personal')))
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
  await showPutAway(page)
  await main(page).getByRole('button', { name: 'Restore Paint the shed' }).click()
  await showOpen(page)
  await expect(inbox(page, 'Home')).toContainText('Paint the shed')
})

test("an epic's or outcome's sun chooses everything open in it for today at once", async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addOnTasksPage(page, 'task', 'Login pages', 'Session cookie')
  const sun = (title: string) =>
    main(page).getByRole('button', { name: `All of ${title} for today`, exact: true })
  const today = await todayOnTasksPage(page)

  await sun('Login pages').click()
  await expect(sun('Login pages')).toHaveAttribute('aria-pressed', 'true')
  await expect(today).toContainText('Login form')
  await expect(today).toContainText('Session cookie')
  await expect(main(page).getByRole('button', { name: 'Login form for today', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // The epic holds a task still not today's, so its sun says how much is; a
  // press chooses the rest.
  await expect(sun('Mono auth')).toHaveAttribute('aria-pressed', 'mixed')
  await expect(sun('Mono auth')).toContainText('2 of 3')
  await sun('Mono auth').click()
  await expect(today).toContainText('CSRF token')
  await expect(sun('Mono auth')).toHaveAttribute('aria-pressed', 'true')

  // Pressed again, all of it leaves today and stays in the backlog.
  await sun('Mono auth').click()
  await expect(today).not.toContainText('Login form')
  await expect(outcome(page, 'Login pages')).toContainText('Login form')
})

test('an area folds to its name, and every epic in it folds at once', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  await addOnTasksPage(page, 'epic', 'Work', 'Rate limits')
  await addTo(page, 'Work', 'Buy a cable')
  const caret = (title: string) =>
    main(page).getByRole('button', { name: `What ${title} holds`, exact: true })
  const pagesTasks = outcome(page, 'Login pages').getByRole('list', { name: 'Login pages tasks' })
  const ownTasks = epic(page, 'Mono auth').getByRole('list', { name: 'Mono auth tasks' })

  // Every epic in the area at once, as each epic's caret would: every column
  // folds, and the epics and outcomes stay as cards. Then back again.
  await main(page).getByRole('button', { name: 'Fold every epic in Work', exact: true }).click()
  await expect(caret('Mono auth')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Rate limits')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Login pages')).toHaveAttribute('aria-expanded', 'false')
  await expect(outcome(page, 'Login pages')).toContainText('1 open task')
  await expect(pagesTasks).toHaveCount(0)
  await expect(ownTasks).toHaveCount(0)
  await expect(epic(page, 'Rate limits')).toBeVisible()
  // The inbox is not an epic's, and stays as it was.
  await expect(inbox(page, 'Work')).toContainText('Buy a cable')
  await main(page).getByRole('button', { name: 'Unfold every epic in Work', exact: true }).click()
  await expect(caret('Mono auth')).toHaveAttribute('aria-expanded', 'true')
  await expect(caret('Rate limits')).toHaveAttribute('aria-expanded', 'true')
  await expect(pagesTasks).toContainText('Login form')
  await expect(ownTasks).toContainText('CSRF token')

  // The area folds to its name, saying what it holds.
  await caret('Work').click()
  await expect(caret('Work')).toHaveAttribute('aria-expanded', 'false')
  await expect(epic(page, 'Mono auth')).toHaveCount(0)
  await expect(inbox(page, 'Work')).toHaveCount(0)
  await expect(main(page).getByText('2 epics · 1 in the inbox', { exact: true })).toBeVisible()

  // Folded, it still takes a task, into its inbox.
  await addTo(page, 'Personal', 'Water the plants')
  await main(page).getByRole('button', { name: 'Move Water the plants', exact: true }).click()
  await main(page)
    .getByRole('button', { name: 'Move Water the plants to Work', exact: true })
    .click()
  await expect(main(page).getByText('2 epics · 2 in the inbox', { exact: true })).toBeVisible()
  // The focus rests on the area's fold, and stays there when it opens.
  await expect(caret('Work')).toBeFocused()
  await caret('Work').click()
  await expect(inbox(page, 'Work')).toContainText('Water the plants')
  await expect(caret('Work')).toBeFocused()

  // Kept across a reload, as the board's other folds are.
  await caret('Work').click()
  await page.reload()
  await expect(caret('Work')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Personal')).toHaveAttribute('aria-expanded', 'true')
})

test('what an add field holds when the press that folds an epic leaves it is folded with the rest', async ({
  page,
}) => {
  // Regression: the field's leave waits a turn for the click, so the fold
  // was written first, and the outcome added after it started open — the
  // epic just folded read as open again.
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  const caret = (title: string) =>
    main(page).getByRole('button', { name: `What ${title} holds`, exact: true })
  const typeOutcome = async (title: string) => {
    await main(page).getByRole('button', { name: 'Add an outcome to Mono auth', exact: true }).click()
    await main(page).getByLabel('New outcome in Mono auth', { exact: true }).fill(title)
  }

  // The epic's caret.
  await typeOutcome('Sessions')
  await caret('Mono auth').click()
  await expect(outcome(page, 'Sessions')).toHaveCount(1)
  await expect(caret('Sessions')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Mono auth')).toHaveAttribute('aria-expanded', 'false')
  await caret('Mono auth').click()
  await expect(caret('Sessions')).toHaveAttribute('aria-expanded', 'true')

  // The area's fold over every epic, for an outcome and for a new epic alike.
  await typeOutcome('Tokens')
  await main(page).getByRole('button', { name: 'Fold every epic in Work', exact: true }).click()
  await expect(outcome(page, 'Tokens')).toHaveCount(1)
  await expect(caret('Tokens')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Mono auth')).toHaveAttribute('aria-expanded', 'false')
  await main(page).getByRole('button', { name: 'Unfold every epic in Work', exact: true }).click()
  await main(page).getByRole('button', { name: 'Add an epic to Work', exact: true }).click()
  await main(page).getByLabel('New epic in Work', { exact: true }).fill('Rate limits')
  await main(page).getByRole('button', { name: 'Fold every epic in Work', exact: true }).click()
  await expect(epic(page, 'Rate limits')).toHaveCount(1)
  await expect(caret('Rate limits')).toHaveAttribute('aria-expanded', 'false')
  await expect(caret('Mono auth')).toHaveAttribute('aria-expanded', 'false')

  // Left any other way, an outcome written on the board still starts open.
  await typeOutcome('Cookies')
  await main(page).getByRole('heading', { name: 'Tasks', level: 1 }).click()
  await expect(caret('Cookies')).toHaveAttribute('aria-expanded', 'true')
})

test("an epic's own tasks fold under their heading, and still take a task", async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await buildAuthEpic(page)
  const heading = main(page).getByRole('button', {
    name: 'Tasks straight under Mono auth',
    exact: true,
  })
  const ownTasks = epic(page, 'Mono auth').getByRole('list', { name: 'Mono auth tasks' })

  await expect(heading).toHaveAttribute('aria-expanded', 'true')
  await heading.click()
  await expect(heading).toHaveAttribute('aria-expanded', 'false')
  await expect(ownTasks).toHaveCount(0)
  await expect(epic(page, 'Mono auth').getByText('1 open task', { exact: true })).toBeVisible()
  // The epic and its outcome are as they were.
  await expect(
    main(page).getByRole('button', { name: 'What Mono auth holds', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await expect(outcome(page, 'Login pages')).toContainText('Login form')

  await main(page).getByRole('button', { name: 'Move Login form', exact: true }).click()
  await main(page)
    .getByRole('button', { name: 'Move Login form to Mono auth', exact: true })
    .click()
  await expect(epic(page, 'Mono auth').getByText('2 open tasks', { exact: true })).toBeVisible()
  await expect(heading).toBeFocused()
  await heading.click()
  await expect(ownTasks).toContainText('Login form')
  await expect(heading).toBeFocused()
  await expect(ownTasks).toContainText('CSRF token')
})

test('a small + adds an outcome, and takes no column of its own', async ({ page }) => {
  await openMono(page)
  await openTasks(page)
  await addOnTasksPage(page, 'epic', 'Work', 'Mono auth')
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Login pages')
  const plus = main(page).getByRole('button', { name: 'Add an outcome to Mono auth', exact: true })
  const field = main(page).getByLabel('New outcome in Mono auth', { exact: true })
  const ownTasks = main(page).getByRole('button', {
    name: 'Tasks straight under Mono auth',
    exact: true,
  })

  // Folded, it is a small + and the epic's own tasks stand straight after the
  // outcome, with no column between them.
  await field.press('Escape')
  await expect(plus).toBeFocused()
  expect((await plus.boundingBox())!.width).toBeLessThan(40)
  const column = (await outcome(page, 'Login pages').boundingBox())!
  const right = column.x + column.width
  const tasksAt = (await ownTasks.boundingBox())!.x
  expect(tasksAt).toBeGreaterThan(right)
  expect(tasksAt).toBeLessThan(right + 32)

  // Opened, the new outcome's card stands after the last outcome, and the ×
  // or Escape hands the focus back to the +.
  await plus.click()
  await expect(field).toBeFocused()
  const card = (await field.boundingBox())!
  expect(card.x).toBeGreaterThan(right)
  expect(card.x).toBeLessThan((await ownTasks.boundingBox())!.x)
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(plus).toBeFocused()
})
