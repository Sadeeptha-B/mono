/** The third opening question: what today is for, and the timer it carries. */

import { expect, test } from '@playwright/test'
import {
  addIntention,
  addOnTasksPage,
  goToStage,
  intentionList,
  openMono,
  stage,
  startDay,
} from './support/mono'

const start = (page: Parameters<typeof stage>[0]) =>
  stage(page).getByRole('button', { name: 'Start the day' })

test('the day cannot start until it is for something, the first time it is asked', async ({
  page,
}) => {
  await openMono(page)

  // From the first question as much as the third: the button is the same one.
  await expect(start(page)).toBeDisabled()
  await expect(stage(page)).toContainText("name at least one thing it is for under Intentions")

  await goToStage(page, 'Intentions')
  await expect(
    stage(page).getByRole('heading', { name: 'What are your intentions for the day?' }),
  ).toBeVisible()
  await addIntention(page, 'Handle the billing ticket')
  await expect(intentionList(page)).toContainText('Handle the billing ticket')

  await start(page).click()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test('intentions can be edited and removed', async ({ page }) => {
  await openMono(page)
  await goToStage(page, 'Intentions')

  await stage(page).getByLabel('Next intention', { exact: true }).fill('Mono auth')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(intentionList(page)).toContainText('Mono auth')

  await intentionList(page).getByRole('button', { name: 'Edit Mono auth' }).click()
  await stage(page).getByLabel('This intention', { exact: true }).fill('Mono login pages')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(intentionList(page)).toContainText('Mono login pages')

  await intentionList(page).getByRole('button', { name: 'Remove Mono login pages' }).click()
  await expect(intentionList(page)).toHaveCount(0)
  await expect(start(page)).toBeDisabled()
})

test('an intention is marked done by hand, and reads done wherever it is listed', async ({
  page,
}) => {
  await openMono(page)
  await goToStage(page, 'Intentions')
  await addIntention(page, 'Mono auth')
  await addIntention(page, 'Billing ticket')

  await intentionList(page).getByRole('button', { name: 'Mark intention Mono auth done' }).click()
  await expect(
    intentionList(page).getByRole('button', { name: 'Reopen intention Mono auth' }),
  ).toBeVisible()
  await expect(intentionList(page).getByText('Mono auth', { exact: true })).toHaveCSS(
    'text-decoration-line',
    'line-through',
  )
  await start(page).click()

  // The purpose prompt shows it done, and can reopen it and finish it again.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await stage(page).getByRole('button', { name: 'Reopen intention Mono auth' }).click()
  await stage(page).getByRole('button', { name: 'Mark intention Mono auth done' }).click()
  await stage(page).getByRole('button', { name: 'Not yet' }).click()

  // So does the tasks page, and it is the day's to keep: a reload still has it.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  const today = page.getByRole('main').getByRole('region', { name: 'My intentions for today' })
  await page.reload()
  await expect(today.getByRole('button', { name: 'Reopen intention Mono auth' })).toBeVisible()
  await today.getByRole('button', { name: 'Reopen intention Mono auth' }).click()
  await expect(
    today.getByRole('button', { name: 'Mark intention Mono auth done' }),
  ).toBeVisible()
  await expect(
    today.getByRole('button', { name: 'Mark intention Billing ticket done' }),
  ).toBeVisible()
})

test('an intention takes its tasks from the backlog, shown under the places they live in', async ({
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

  await goToStage(page, 'Intentions')
  await stage(page).getByLabel('Next intention', { exact: true }).fill('Ship the login pages')

  // Every task, under the area, epic and outcome it lives in. The panel opens
  // over the stage, so nothing below it moves.
  const picker = stage(page).getByRole('button', { name: 'Tasks for this intention' })
  const done = stage(page).getByRole('button', { name: 'Done', exact: true })
  await expect(picker).toBeVisible()
  // Against the picker rather than the window: opening it may scroll it into view.
  const gap = async () => (await done.boundingBox())!.y - (await picker.boundingBox())!.y
  const before = await gap()
  await picker.click()
  const tree = stage(page).getByRole('group', { name: 'Tasks for this intention' })
  await expect(tree).toContainText('Outcome: Login pages')
  await expect(tree.getByRole('checkbox')).toHaveCount(3)
  expect(await gap()).toBe(before)

  // A task can be written straight into any place, and is chosen as it is.
  await tree.getByRole('button', { name: 'Add a task to Login pages' }).click()
  const field = tree.getByLabel('New task in Login pages', { exact: true })
  await expect(field).toBeFocused()
  await field.fill('Remember me')
  await field.press('Enter')
  await expect(tree.getByRole('checkbox', { name: 'Remember me' })).toBeChecked()
  // Enter wrote the task without adding the intention around it.
  await expect(intentionList(page)).toHaveCount(0)

  // ✓ keeps a new task and puts its field away; a task can be renamed in
  // place with ✎ and deleted with ×, without leaving the panel.
  await field.fill('Throwaway')
  await tree.getByRole('button', { name: 'Add the new task to Login pages' }).click()
  await expect(field).toHaveCount(0)
  // None of these closes the panel: only a click outside it does.
  await expect(tree).toBeVisible()
  await tree.getByRole('button', { name: 'Edit task Throwaway' }).click()
  await expect(tree).toBeVisible()
  await tree.getByLabel('Rename Throwaway', { exact: true }).fill('Still throwaway')
  await tree.getByRole('button', { name: 'Save the name of Throwaway' }).click()
  await expect(tree.getByRole('checkbox', { name: 'Still throwaway' })).toBeChecked()
  await tree.getByRole('button', { name: 'Delete task Still throwaway' }).click()
  await expect(tree.getByRole('checkbox', { name: 'Still throwaway' })).toHaveCount(0)
  await expect(tree).toBeVisible()

  await tree.getByRole('checkbox', { name: 'Login form' }).check()
  await tree.getByRole('checkbox', { name: 'CSRF token' }).check()
  await tree.getByRole('checkbox', { name: 'Fix the gate' }).check()
  await picker.click()
  await expect(tree).toHaveCount(0)
  await expect(picker).toHaveText(/Remember me \+ 3 more/)

  // What is chosen is shown under its places, each said once: tasks from two
  // areas are under both, and a lone chain is one line.
  const chosen = stage(page).getByRole('list', { name: 'Chosen tasks' })
  await expect(chosen).toContainText('Work › Mono auth')
  await expect(chosen).toContainText('Login pages')
  await expect(chosen).toContainText('Personal')
  await expect(chosen.getByText('Login pages', { exact: true })).toHaveCount(1)

  await done.click()
  const row = intentionList(page).getByRole('list', { name: 'Tasks for Ship the login pages' })
  await expect(row).toContainText('Work › Mono auth')
  await expect(row).toContainText('Personal')
  await expect(row).toContainText('Remember me')

  // Linked in the day, as the tasks page shows them.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  const today = page.getByRole('main').getByRole('list', { name: 'Today: Ship the login pages' })
  await expect(today).toContainText('Login form')
  await expect(today).toContainText('CSRF token')
  await expect(today).toContainText('Remember me')
  await expect(today).toContainText('Fix the gate')
  await page.getByRole('link', { name: 'Back to today' }).click()

  // Taking tasks out on an edit unlinks them, and the grouping narrows with it.
  await intentionList(page).getByRole('button', { name: 'Edit Ship the login pages' }).click()
  await picker.click()
  await tree.getByRole('checkbox', { name: 'CSRF token' }).uncheck()
  await tree.getByRole('checkbox', { name: 'Fix the gate' }).uncheck()
  await done.click()
  await expect(row).toContainText('Work › Mono auth › Login pages')
  await expect(row).not.toContainText('Personal')
  await expect(row).not.toContainText('CSRF token')
})

test('the question gives itself a few minutes, then stops and offers more', async ({ page }) => {
  await openMono(page)

  // Not before it is asked: the timer belongs to the question.
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)

  await goToStage(page, 'Intentions')
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('5:00')

  await page.clock.fastForward('02:00')
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('3:00')

  // It keeps running while you look at another question, because it is about
  // setting up the day rather than about that one screen.
  await goToStage(page, 'Hours')
  await page.clock.fastForward('03:01')
  await goToStage(page, 'Intentions')

  // At zero it stops. Nothing moves on and the day is not started for you.
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)
  await expect(stage(page)).toContainText("Time's up")
  await expect(start(page)).toBeDisabled()

  await stage(page).getByRole('button', { name: 'Take another 5 mins' }).click()
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('5:00')
})

test('coming back to the intentions later does not start the timer by itself', async ({
  page,
}) => {
  await openMono(page)
  await startDay(page)

  await goToStage(page, 'Intentions')
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)
  await expect(stage(page).getByRole('button', { name: 'Take 5 mins to decide' })).toBeVisible()
  await expect(stage(page).getByRole('button', { name: 'Focus', exact: true })).toBeEnabled()

  // With something already named, the field for the next one is folded until
  // asked for, stays open for a run, and folds away on Escape.
  const field = stage(page).getByLabel('Next intention', { exact: true })
  const opener = stage(page).getByRole('button', { name: 'Add intention', exact: true })
  await expect(field).toHaveCount(0)
  await opener.click()
  await expect(field).toBeFocused()
  await field.fill('Reply to Priya')
  await field.press('Enter')
  await expect(intentionList(page)).toContainText('Reply to Priya')
  await expect(field).toBeFocused()
  await field.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(opener).toBeFocused()

  // A draft is whatever has been written in it. Tasks chosen before the title
  // keep the form open across the other questions, as typed text does.
  await opener.click()
  const picker = stage(page).getByRole('button', { name: 'Tasks for this intention' })
  await picker.click()
  const tree = stage(page).getByRole('group', { name: 'Tasks for this intention' })
  await tree.getByRole('button', { name: 'Add a task to Work', exact: true }).click()
  await tree.getByLabel('New task in Work', { exact: true }).fill('Draft task')
  await tree.getByLabel('New task in Work', { exact: true }).press('Enter')
  await picker.click()
  await goToStage(page, 'Hours')
  await goToStage(page, 'Intentions')
  await expect(field).toBeVisible()
  await expect(picker).toContainText('Draft task')
})

test('intentions survive a reload and are gone the next day', async ({ page }) => {
  await openMono(page)
  await goToStage(page, 'Intentions')
  await addIntention(page, 'Handle the billing ticket')
  await start(page).click()

  await page.reload()
  await goToStage(page, 'Intentions')
  await expect(intentionList(page)).toContainText('Handle the billing ticket')

  // Past midnight, with nothing running: the day resets and asks again.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await goToStage(page, 'Intentions')
  await expect(intentionList(page)).toHaveCount(0)
})
