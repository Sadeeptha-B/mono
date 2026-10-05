/** The third opening question: what today is for, and the timer it carries. */

import { expect, test } from '@playwright/test'
import {
  addIntention,
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
  await expect(stage(page)).toContainText("name at least one thing it is for under Today's intentions")

  await goToStage(page, "Today's intentions")
  await expect(
    stage(page).getByRole('heading', { name: 'What do you intend today?' }),
  ).toBeVisible()
  await addIntention(page, 'Handle the billing ticket')
  await expect(intentionList(page)).toContainText('Handle the billing ticket')

  await start(page).click()
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
})

test('intentions can be linked to an area, edited and removed', async ({ page }) => {
  await openMono(page)
  await goToStage(page, "Today's intentions")

  await stage(page).getByLabel('Next intention', { exact: true }).fill('Mono auth')
  await stage(page)
    .getByLabel('What this intention is part of')
    .selectOption({ label: 'Work' })
  await stage(page).getByRole('button', { name: 'Add intention' }).click()
  await expect(intentionList(page).getByRole('listitem')).toHaveText(/Mono auth\s*Work/)

  await intentionList(page).getByRole('button', { name: 'Edit Mono auth' }).click()
  await stage(page).getByLabel('This intention', { exact: true }).fill('Mono login pages')
  await stage(page).getByRole('button', { name: 'Save intention' }).click()
  await expect(intentionList(page)).toContainText('Mono login pages')

  await intentionList(page).getByRole('button', { name: 'Remove Mono login pages' }).click()
  await expect(intentionList(page)).toHaveCount(0)
  await expect(start(page)).toBeDisabled()
})

test('an intention can point at an epic by its path', async ({ page }) => {
  await openMono(page)
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page.getByRole('main').getByLabel('New epic in Work', { exact: true }).fill('Mono auth')
  await page.getByRole('main').getByLabel('New epic in Work', { exact: true }).press('Enter')
  await page.getByRole('link', { name: 'Back to today' }).click()

  await goToStage(page, "Today's intentions")
  await stage(page).getByLabel('Next intention', { exact: true }).fill('Ship the login pages')
  await stage(page)
    .getByLabel('What this intention is part of')
    .selectOption({ label: 'Work › Mono auth' })
  await stage(page).getByRole('button', { name: 'Add intention' }).click()
  await expect(intentionList(page).getByRole('listitem')).toHaveText(
    /Ship the login pages\s*Work › Mono auth/,
  )
})

test('the question gives itself a few minutes, then stops and offers more', async ({ page }) => {
  await openMono(page)

  // Not before it is asked: the timer belongs to the question.
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)

  await goToStage(page, "Today's intentions")
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('5:00')

  await page.clock.fastForward('02:00')
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('3:00')

  // It keeps running while you look at another question, because it is about
  // setting up the day rather than about that one screen.
  await goToStage(page, "Today's hours")
  await page.clock.fastForward('03:01')
  await goToStage(page, "Today's intentions")

  // At zero it stops. Nothing moves on and the day is not started for you.
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)
  await expect(stage(page)).toContainText("Time's up. Another 5 minutes?")
  await expect(start(page)).toBeDisabled()

  await stage(page).getByRole('button', { name: 'Give it 5 minutes' }).click()
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveText('5:00')
})

test('coming back to the intentions later does not start the timer by itself', async ({
  page,
}) => {
  await openMono(page)
  await startDay(page)

  await goToStage(page, "Today's intentions")
  await expect(stage(page).getByLabel('Time left for intentions')).toHaveCount(0)
  await expect(stage(page).getByRole('button', { name: 'Back to the day' })).toBeEnabled()
})

test('intentions survive a reload and are gone the next day', async ({ page }) => {
  await openMono(page)
  await goToStage(page, "Today's intentions")
  await addIntention(page, 'Handle the billing ticket')
  await start(page).click()

  await page.reload()
  await goToStage(page, "Today's intentions")
  await expect(intentionList(page)).toContainText('Handle the billing ticket')

  // Past midnight, with nothing running: the day resets and asks again.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 8, 0, 0))
  await page.clock.fastForward('00:02')
  await goToStage(page, "Today's intentions")
  await expect(intentionList(page)).toHaveCount(0)
})
