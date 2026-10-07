/**
 * The third opening question: the tasks today is for, the intentions some of
 * them are grouped under, and the timer the question carries.
 */

import { expect, test, type Page } from '@playwright/test'
import {
  addIntention,
  addOnTasksPage,
  addTaskIn,
  addTodayTask,
  goToStage,
  openMono,
  stage,
  startDay,
  taskAction,
  todayBrowser,
  todayList,
} from './support/mono'

const start = (page: Page) => stage(page).getByRole('button', { name: 'Start the day' })

const intention = (page: Page, title: string) =>
  todayList(page).getByRole('region', { name: `Intention: ${title}` })

test('the day cannot start until a task is chosen for it, the first time it is asked', async ({
  page,
}) => {
  await openMono(page)

  // From the first question as much as the third: the button is the same one.
  await expect(start(page)).toBeDisabled()
  await expect(stage(page)).toContainText('Choose at least one task under Today to start the day.')

  await goToStage(page, 'Today')
  await expect(
    stage(page).getByRole('heading', { name: 'What are you working on today?' }),
  ).toBeVisible()
  // Written from All Tasks into an area's inbox, and chosen as it is written.
  await addTodayTask(page, 'Look into the double charge')
  await expect(todayList(page)).toContainText('Look into the double charge')
  await expect(todayList(page)).toContainText('Work')

  await start(page).click()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test("today's tasks are chosen from the backlog in place, and put back the same way", async ({
  page,
}) => {
  await openMono(page)
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await addOnTasksPage(page, 'epic', 'Work', 'Mono auth')
  await addOnTasksPage(page, 'outcome', 'Mono auth', 'Login pages')
  await addOnTasksPage(page, 'task', 'Login pages', 'Login form')
  await addOnTasksPage(page, 'task', 'Mono auth', 'CSRF token')
  await addOnTasksPage(page, 'task', 'Personal', 'Fix the gate')
  await page.getByRole('link', { name: 'Back to today' }).click()

  await goToStage(page, 'Today')
  const tree = todayBrowser(page)
  await expect(tree).toContainText('Outcome: Login pages')
  await expect(tree.getByRole('checkbox')).toHaveCount(3)

  // A tick chooses a task for today, and today shows it under its places,
  // each said once: tasks from two areas are under both.
  await tree.getByRole('checkbox', { name: 'Login form' }).check()
  await tree.getByRole('checkbox', { name: 'Fix the gate' }).check()
  await expect(todayList(page)).toContainText('Work › Mono auth › Login pages')
  await expect(todayList(page)).toContainText('Personal')

  // Unticking puts it back, and so does its × in today.
  await tree.getByRole('checkbox', { name: 'Fix the gate' }).uncheck()
  await expect(todayList(page)).not.toContainText('Fix the gate')
  await todayList(page).getByRole('button', { name: 'Take Login form out of today' }).click()
  await expect(tree.getByRole('checkbox', { name: 'Login form' })).not.toBeChecked()
  await expect(start(page)).toBeDisabled()

  // A task can be written straight into any place, from its ⋯, and is chosen
  // as it is.
  await addTaskIn(tree, 'Login pages')
  const field = tree.getByLabel('New task in Login pages', { exact: true })
  await expect(field).toBeFocused()
  await field.fill('Remember me')
  await field.press('Enter')
  await expect(tree.getByRole('checkbox', { name: 'Remember me' })).toBeChecked()
  await expect(todayList(page)).toContainText('Remember me')

  // ✓ keeps a new task and puts its field away; a task can be renamed in place
  // with ✎ and deleted with ×.
  await field.fill('Throwaway')
  await tree.getByRole('button', { name: 'Add the new task to Login pages' }).click()
  await expect(field).toHaveCount(0)
  await taskAction(tree, 'Throwaway', 'Edit task Throwaway')
  await tree.getByLabel('Rename Throwaway', { exact: true }).fill('Still throwaway')
  await tree.getByRole('button', { name: 'Save the name of Throwaway' }).click()
  await expect(todayList(page)).toContainText('Still throwaway')
  await taskAction(tree, 'Still throwaway', 'Delete task Still throwaway')
  await expect(tree.getByRole('checkbox', { name: 'Still throwaway' })).toHaveCount(0)
  await expect(todayList(page)).not.toContainText('Still throwaway')

  // A search narrows the tree to the path down to what it finds.
  await tree.getByLabel('Find a task in Tasks for today').fill('gate')
  await expect(tree.getByRole('checkbox')).toHaveCount(1)
  await expect(tree).toContainText('Area: Personal')
})

test('All Tasks keeps the backlog: tasks are finished and reopened there', async ({ page }) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Reply to Priya')
  const tree = todayBrowser(page)

  // Done from its row: crossed out there and in today, and no longer a choice.
  // Its actions are behind a ⋯, as a place's are, shown on hover.
  const more = tree.getByRole('button', { name: 'More for task Reply to Priya', exact: true })
  await page.mouse.move(0, 0)
  await expect(more).toHaveCSS('opacity', '0')
  await taskAction(tree, 'Reply to Priya', 'Mark task Reply to Priya done')
  await expect(tree.getByRole('checkbox', { name: 'Reply to Priya' })).toHaveCount(0)
  await expect(tree.getByText('Reply to Priya', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  // Not exact: the row also says, to a screen reader, that it is done today.
  await expect(todayList(page).getByText('Reply to Priya')).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  // The keyboard stays on the task, now on the ⋯ of its done row, which
  // holds the reopen.
  await expect(more).toBeFocused()
  await more.press('Enter')

  // Reopened, it is open and still today's.
  await tree.getByRole('button', { name: 'Reopen task Reply to Priya', exact: true }).press('Enter')
  await expect(tree.getByRole('checkbox', { name: 'Reply to Priya' })).toBeChecked()
  await expect(
    todayList(page).getByRole('button', { name: 'Move Reply to Priya', exact: true }),
  ).toBeVisible()

  // All Tasks stands in the calendar's column while this question is open,
  // and the column's switch turns it back to the day. A choice made by hand
  // lasts until the question closes; the other questions have the day.
  const column = page.getByRole('group', { name: 'Show in this column' })
  await expect(column.getByRole('button', { name: 'All Tasks' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(stage(page).getByRole('group', { name: 'Tasks for today' })).toHaveCount(0)
  await column.getByRole('button', { name: 'Today' }).click()
  await expect(tree).toHaveCount(0)
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Hours' })).toBeVisible()
  await goToStage(page, 'Hours')
  await expect(column).toHaveCount(0)
  await goToStage(page, 'Today')
  await expect(tree).toBeVisible()
})

test("the column's switch keeps what was being typed in either view", async ({ page }) => {
  // Regression: the switch unmounted the view it hid, and a draft in it went.
  await openMono(page)
  await goToStage(page, 'Today')
  const column = page.getByRole('group', { name: 'Show in this column' })
  const tree = todayBrowser(page)
  await addTaskIn(tree, 'Work')
  const task = tree.getByLabel('New task in Work', { exact: true })
  await task.fill('Half a task')

  await column.getByRole('button', { name: 'Today' }).click()
  await page.getByRole('complementary').getByRole('button', { name: 'Hours', exact: true }).click()
  const end = page.getByRole('complementary').getByLabel('Hours 1 end', { exact: true })
  await end.fill('22:00')

  await column.getByRole('button', { name: 'All Tasks' }).click()
  await expect(task).toHaveValue('Half a task')
  await column.getByRole('button', { name: 'Today' }).click()
  await expect(end).toHaveValue('22:00')
})

test('an intention half renamed is still being renamed after another question', async ({
  page,
}) => {
  // Regression: the rename was held by today's list, which the question
  // draws only while it is on screen, and it came back as the old name.
  await openMono(page)
  await goToStage(page, 'Today')
  await addIntention(page, 'Admin')
  await intention(page, 'Admin').getByRole('button', { name: 'Rename intention Admin' }).click()
  const rename = stage(page).getByLabel('Rename intention Admin', { exact: true })
  await rename.fill('Calls and invoices')

  await goToStage(page, 'Hours')
  await expect(rename).toHaveCount(0)
  await goToStage(page, 'Today')
  await expect(rename).toHaveValue('Calls and invoices')
})

test('a task picked up in today is put down when it leaves today, its question closes, or the day turns', async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Reply to Priya')
  await addTodayTask(page, 'Call the bank')
  await addIntention(page, 'Admin')
  const moving = page.getByRole('status').filter({ hasText: 'Moving' })
  const grip = (title: string) =>
    todayList(page).getByRole('button', { name: `Move ${title}`, exact: true })

  // Its row has gone, so the move goes too, and choosing it again is not
  // picking it up again.
  await grip('Reply to Priya').click()
  await expect(moving).toBeVisible()
  await todayList(page).getByRole('button', { name: 'Take Reply to Priya out of today' }).click()
  await expect(moving).toHaveCount(0)
  await todayBrowser(page).getByRole('checkbox', { name: 'Reply to Priya' }).check()
  await expect(moving).toHaveCount(0)
  await expect(todayList(page).getByRole('button', { name: 'Move here' })).toHaveCount(0)

  // Anywhere to put it down is drawn only while a question chooses tasks, so
  // the move ends with the question: for another question, and when the day
  // starts, rather than asking for a `Move here` into the block.
  await grip('Call the bank').click()
  await expect(moving).toBeVisible()
  await goToStage(page, 'Hours')
  await expect(moving).toHaveCount(0)
  await goToStage(page, 'Today')
  await grip('Call the bank').click()
  await expect(moving).toBeVisible()
  await start(page).click()
  await expect(moving).toHaveCount(0)
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(moving).toHaveCount(0)
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // Held at midnight, it is not carried into the next day.
  await goToStage(page, 'Today')
  await grip('Call the bank').click()
  await expect(moving).toBeVisible()
  await page.clock.setSystemTime(new Date(2026, 7, 21, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await expect(moving).toHaveCount(0)
  await goToStage(page, 'Today')
  await expect(stage(page).getByRole('button', { name: 'Move here' })).toHaveCount(0)
})

test('areas, epics and outcomes are kept from All Tasks, from the popup of their ⋯', async ({
  page,
}) => {
  await openMono(page)
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await addOnTasksPage(page, 'epic', 'Work', 'SC Prefix')
  await addOnTasksPage(page, 'outcome', 'SC Prefix', 'New Item')
  await addOnTasksPage(page, 'task', 'New Item', 'sfsdfs')
  await page.getByRole('link', { name: 'Back to today' }).click()
  await goToStage(page, 'Today')
  const tree = todayBrowser(page)
  const more = (name: string) => tree.getByRole('button', { name: `More for ${name}`, exact: true })
  const popup = (name: string) => tree.getByRole('group', { name: `Actions for ${name}` })

  // At rest a row's ⋯ is hidden; hovering the row shows it, and a press opens
  // its popup, floating under it rather than pushing the rows below down.
  await expect(more('SC Prefix')).toHaveCSS('opacity', '0')
  await tree.getByText('SC Prefix', { exact: true }).hover()
  await expect(more('SC Prefix')).toHaveCSS('opacity', '1')
  // Measured from the row above rather than from the viewport, which the
  // column's scroller can move by a pixel as the popup opens.
  const gap = async () =>
    (await tree.getByText('New Item', { exact: true }).boundingBox())!.y -
    (await tree.getByText('SC Prefix', { exact: true }).boundingBox())!.y
  const before = await gap()
  await more('SC Prefix').click()
  await expect(popup('SC Prefix')).toHaveCSS('position', 'absolute')
  expect(await gap()).toBeCloseTo(before, 0)

  // A press outside closes it.
  await page.getByRole('heading', { name: 'What are you working on today?' }).click()
  await expect(popup('SC Prefix')).toHaveCount(0)

  // Renamed in place; the keyboard comes back to the ⋯.
  await more('SC Prefix').click()
  await popup('SC Prefix').getByRole('button', { name: 'Rename SC Prefix', exact: true }).click()
  const name = tree.getByLabel('Rename epic SC Prefix', { exact: true })
  await expect(name).toBeFocused()
  await name.fill('Auth')
  await name.press('Enter')
  await expect(tree).toContainText('Epic: Auth')
  await expect(more('Auth')).toBeFocused()

  // An epic takes a new outcome; Escape closes an open popup onto its ⋯.
  await more('Auth').click()
  await popup('Auth').getByRole('button', { name: 'Add an outcome to Auth', exact: true }).click()
  const outcome = tree.getByLabel('New outcome in Auth', { exact: true })
  await outcome.fill('Password reset')
  await outcome.press('Enter')
  await outcome.press('Escape')
  await expect(tree).toContainText('Outcome: Password reset')
  await more('Password reset').click()
  await page.keyboard.press('Escape')
  await expect(popup('Password reset')).toHaveCount(0)
  await expect(more('Password reset')).toBeFocused()

  // Archived and finished, each is put away with what it holds.
  await more('Password reset').click()
  await popup('Password reset').getByRole('button', { name: 'Archive Password reset' }).click()
  await expect(tree).not.toContainText('Password reset')
  await more('New Item').click()
  await popup('New Item').getByRole('button', { name: 'Mark New Item done' }).click()
  await expect(tree).not.toContainText('New Item')
  await expect(tree.getByRole('checkbox', { name: 'sfsdfs' })).toHaveCount(0)

  // A delete with something inside asks first.
  await more('Auth').click()
  await popup('Auth').getByRole('button', { name: 'Delete Auth', exact: true }).click()
  await expect(popup('Auth')).toContainText('inside?')
  await popup('Auth').getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(tree).toContainText('Epic: Auth')
  await popup('Auth').getByRole('button', { name: 'Delete Auth', exact: true }).click()
  await popup('Auth')
    .getByRole('button', { name: 'Delete Auth and everything in it', exact: true })
    .click()
  await expect(tree).not.toContainText('Auth')

  // An area takes a new epic and can be archived, but is deleted only on the
  // tasks page.
  await more('Work').click()
  await expect(popup('Work').getByRole('button', { name: 'Delete Work', exact: true })).toHaveCount(0)
  await popup('Work').getByRole('button', { name: 'Add an epic to Work', exact: true }).click()
  await tree.getByLabel('New epic in Work', { exact: true }).fill('Billing')
  await tree.getByLabel('New epic in Work', { exact: true }).press('Enter')
  await expect(tree).toContainText('Epic: Billing')
})

test('tasks are carried into intentions, which group them and can go again', async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Reproduce the double charge')
  await addTodayTask(page, 'Patch the webhook retry')
  await addTodayTask(page, 'Reply to Priya')
  await addIntention(page, 'Ship the billing fix')

  // Named by title alone, and empty until something is carried in.
  await expect(intention(page, 'Ship the billing fix')).toContainText('drag tasks here')

  // Picked up with the grip and put down with Move here, from the keyboard or
  // a touch screen; focus goes with it.
  await todayList(page)
    .getByRole('button', { name: 'Move Reproduce the double charge', exact: true })
    .click()
  await todayList(page)
    .getByRole('button', {
      name: 'Move Reproduce the double charge to Ship the billing fix',
      exact: true,
    })
    .click()
  await expect(intention(page, 'Ship the billing fix')).toContainText(
    'Reproduce the double charge',
  )
  await expect(
    todayList(page).getByRole('button', { name: 'Move Reproduce the double charge', exact: true }),
  ).toBeFocused()

  // Or dragged by its row.
  await todayList(page)
    .getByRole('button', { name: 'Move Patch the webhook retry', exact: true })
    .dragTo(intention(page, 'Ship the billing fix'))

  await expect(intention(page, 'Ship the billing fix')).toContainText('Patch the webhook retry')
  const notGrouped = todayList(page).getByRole('region', { name: 'Not grouped' })
  await expect(notGrouped).toContainText('Reply to Priya')
  await expect(notGrouped).not.toContainText('Patch the webhook retry')

  // Renamed in place.
  await intention(page, 'Ship the billing fix')
    .getByRole('button', { name: 'Rename intention Ship the billing fix' })
    .click()
  const rename = stage(page).getByLabel('Rename intention Ship the billing fix', { exact: true })
  await rename.fill('Billing')
  await rename.press('Enter')
  await expect(intention(page, 'Billing')).toContainText('Patch the webhook retry')

  // Marked done by hand, and it reads done on the purpose prompt too.
  await intention(page, 'Billing')
    .getByRole('button', { name: 'Mark intention Billing done' })
    .click()
  await expect(intention(page, 'Billing').getByText('Billing', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  await start(page).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  // It is kept from the column beside the prompt. Its tasks can still be
  // ticked for a block, and are listed under it on the prompt.
  await expect(
    page.getByRole('complementary').getByRole('button', { name: 'Reopen intention Billing' }),
  ).toBeVisible()
  await page
    .getByRole('complementary')
    .getByRole('group', { name: 'Tasks for this block', exact: true })
    .getByRole('checkbox', { name: 'Patch the webhook retry' })
    .check()
  await expect(stage(page).getByRole('group', { name: 'Billing' })).toContainText(
    'Patch the webhook retry',
  )
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // Deleting it leaves its tasks today, under none.
  await goToStage(page, 'Today')
  await intention(page, 'Billing')
    .getByRole('button', { name: 'Delete intention Billing' })
    .click()
  await expect(todayList(page)).toContainText('Reproduce the double charge')
  await expect(todayList(page)).toContainText('Patch the webhook retry')
  await expect(todayList(page).getByRole('region', { name: /^Intention:/ })).toHaveCount(0)
})

test('a task dragged from All Tasks onto an intention is chosen and grouped at once', async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Reply to Priya')
  await addIntention(page, 'Admin')
  await addTodayTask(page, 'Call the bank', 'Personal')
  await todayList(page).getByRole('button', { name: 'Take Call the bank out of today' }).click()
  const tree = todayBrowser(page)
  await expect(tree.getByRole('checkbox', { name: 'Call the bank' })).not.toBeChecked()

  // By its title, in steps as a hand would: a checkbox is not somewhere a drag
  // can start, and a single jump gives the drag no move to begin on.
  const title = tree.getByText('Call the bank', { exact: true })
  await title.scrollIntoViewIfNeeded()
  const from = (await title.boundingBox())!
  await page.mouse.move(from.x + 5, from.y + 5)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 })
  const to = (await intention(page, 'Admin').boundingBox())!
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 10 })
  await page.mouse.up()

  await expect(intention(page, 'Admin')).toContainText('Call the bank')
  await expect(tree.getByRole('checkbox', { name: 'Call the bank' })).toBeChecked()
  await expect(tree.getByText('under Admin')).toBeVisible()
})

test('what the last day left unfinished is offered, not added, and lasts a day', async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Finished today')
  await addTodayTask(page, 'Left over')
  await start(page).click()

  // Finished on the tasks page; the other is left open.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  // Clicked rather than checked: the row leaves the column as it is ticked.
  await page.getByRole('main').getByLabel('Finished today done', { exact: true }).click()
  await page.getByRole('link', { name: 'Back to today' }).click()

  // The next morning: today is empty, and only the open one is offered.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await goToStage(page, 'Today')
  await expect(todayList(page)).not.toContainText('Left over')
  const offered = stage(page).getByRole('list', { name: 'Unfinished from last time' })
  await stage(page).getByText('From last time (1)').click()
  await expect(offered).toContainText('Left over')
  await expect(offered).not.toContainText('Finished today')

  // Chosen again with its +, and no longer offered.
  await offered.getByRole('button', { name: 'Add Left over to today' }).click()
  await expect(todayList(page)).toContainText('Left over')
  await expect(stage(page).getByText(/From last time/)).toHaveCount(0)
  await todayList(page).getByRole('button', { name: 'Take Left over out of today' }).click()
  await addTodayTask(page, 'Something else')

  // A day later only what that day chose is offered: the leftover expired.
  await page.clock.setSystemTime(new Date(2026, 7, 22, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await goToStage(page, 'Today')
  await stage(page).getByText('From last time (1)').click()
  await expect(offered).toContainText('Something else')
  await expect(offered).not.toContainText('Left over')
})

test('the question gives itself a few minutes, then stops and offers more', async ({ page }) => {
  await openMono(page)
  const left = stage(page).getByLabel("Time left to choose today's tasks")

  // Not before it is asked: the timer belongs to the question.
  await expect(left).toHaveCount(0)

  await goToStage(page, 'Today')
  await expect(left).toHaveText('5:00')

  await page.clock.fastForward('02:00')
  await expect(left).toHaveText('3:00')

  // It keeps running while you look at another question, because it is about
  // setting up the day rather than about that one screen.
  await goToStage(page, 'Hours')
  await page.clock.fastForward('03:01')
  await goToStage(page, 'Today')

  // At zero it stops. Nothing moves on and the day is not started for you.
  await expect(left).toHaveCount(0)
  await expect(stage(page)).toContainText("Time's up")
  await expect(start(page)).toBeDisabled()

  await stage(page).getByRole('button', { name: 'Take another 5 mins' }).click()
  await expect(left).toHaveText('5:00')
})

test('coming back to today later does not start the timer by itself', async ({ page }) => {
  await openMono(page)
  await startDay(page)

  await goToStage(page, 'Today')
  await expect(stage(page).getByLabel("Time left to choose today's tasks")).toHaveCount(0)
  await expect(stage(page).getByRole('button', { name: 'Take 5 mins to decide' })).toBeVisible()
  await expect(stage(page).getByRole('button', { name: 'Focus', exact: true })).toBeEnabled()

  // `+ Intention` sits level with the list's heading, and writes a new one in
  // place where it will stand: Enter keeps it and leaves an empty one for the
  // next, Escape closes it and hands focus back.
  const field = stage(page).getByLabel('New intention', { exact: true })
  const opener = stage(page).getByRole('button', { name: 'Add intention', exact: true })
  const heading = stage(page).getByRole('heading', { name: "Today's tasks" })
  await expect(field).toHaveCount(0)
  expect(Math.abs((await opener.boundingBox())!.y - (await heading.boundingBox())!.y)).toBeLessThan(8)
  await opener.click()
  await expect(field).toBeFocused()
  await field.fill('Reply to Priya')
  await field.press('Enter')
  await expect(intention(page, 'Reply to Priya')).toBeVisible()
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(opener).toBeFocused()

  // Its ✓ keeps it and closes.
  await opener.click()
  await field.fill('Billing')
  await stage(page).getByRole('button', { name: 'Keep the new intention', exact: true }).click()
  await expect(intention(page, 'Billing')).toBeVisible()
  await expect(field).toHaveCount(0)

  // The new one is written at the head of the list, under the button that
  // asked for it; the intentions come next, then the tasks under none.
  const y = async (locator: ReturnType<typeof stage>) => (await locator.boundingBox())!.y
  const ship = todayList(page).getByText('Ship the planner', { exact: true })
  expect(await y(intention(page, 'Billing'))).toBeLessThan(await y(ship))
  await opener.click()
  expect(await y(field)).toBeLessThan(await y(intention(page, 'Reply to Priya')))

  // What is typed survives a look at the other questions.
  await field.fill('Half a name')
  await goToStage(page, 'Hours')
  await goToStage(page, 'Today')
  await expect(field).toHaveValue('Half a name')
})

test("today's tasks survive a reload and are gone the next day", async ({ page }) => {
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Handle the billing ticket')
  await start(page).click()

  await page.reload()
  await goToStage(page, 'Today')
  await expect(todayList(page)).toContainText('Handle the billing ticket')

  // Past midnight, with nothing running: the day resets and asks again.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await goToStage(page, 'Today')
  await expect(todayList(page)).not.toContainText('Handle the billing ticket')
  await expect(start(page)).toBeDisabled()
})
