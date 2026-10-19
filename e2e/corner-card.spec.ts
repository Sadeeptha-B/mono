/** The corner card: today's list and the draft, from the sun in the corner of every page. */

import { expect, test, type Page } from '@playwright/test'
import {
  addIntention,
  addTodayTask,
  calendar,
  goToStage,
  openMono,
  stage,
  startDay,
  todayList,
} from './support/mono'

const launcher = (page: Page) => page.getByRole('button', { name: 'Today and draft', exact: true })
const card = (page: Page) => page.getByRole('dialog', { name: 'Today and draft' })
const tab = (page: Page, name: 'Today' | 'Draft') =>
  card(page).getByRole('tab', { name, exact: true })
const draft = (page: Page) => card(page).getByRole('textbox', { name: 'Draft', exact: true })

test('today and the draft open from the corner of every page, and the draft is kept', async ({
  page,
}) => {
  await openMono(page)
  await startDay(page)

  // On the day, beside both columns rather than in either: today's list, as
  // the question has it.
  await launcher(page).click()
  await expect(tab(page, 'Today')).toHaveAttribute('aria-selected', 'true')
  await expect(card(page)).toContainText('Ship the planner')
  await expect(stage(page).getByRole('dialog', { name: 'Today and draft' })).toHaveCount(0)
  await expect(calendar(page).getByRole('dialog', { name: 'Today and draft' })).toHaveCount(0)

  // The draft is a page of loose text beside it.
  await tab(page, 'Draft').click()
  await draft(page).fill('Ask about the API keys\nSplit the planner work')

  // Still open, on the same tab, on another page.
  await page.getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible()
  await expect(draft(page)).toHaveValue('Ask about the API keys\nSplit the planner work')

  // Escape from inside closes it, and hands the focus back to its button.
  await draft(page).press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(launcher(page)).toBeFocused()

  // A reload starts it closed on Today, and the draft is still there.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible()
  await expect(card(page)).toHaveCount(0)
  await launcher(page).click()
  await expect(tab(page, 'Today')).toHaveAttribute('aria-selected', 'true')
  await tab(page, 'Today').press('ArrowRight')
  await expect(tab(page, 'Draft')).toBeFocused()
  await expect(draft(page)).toHaveValue('Ask about the API keys\nSplit the planner work')

  // Opened onto the draft, its page takes the focus.
  await launcher(page).click()
  await launcher(page).click()
  await expect(draft(page)).toBeFocused()

  // The guide and the routine have it too.
  await page.getByRole('link', { name: 'Guide', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'How Mono works' })).toBeVisible()
  await expect(draft(page)).toHaveValue('Ask about the API keys\nSplit the planner work')
  await page.goto('/#/routine')
  await expect(page.getByRole('heading', { name: 'Routine', level: 1 })).toBeVisible()
  await expect(launcher(page)).toBeVisible()
})

test("a task moved in the card's list keeps the focus in the card, beside the question's own", async ({
  page,
}) => {
  // Regression: both lists share the day's carry, and the first grip drawn
  // took the focus — the question's, on the stage — wherever the move was made.
  await openMono(page)
  await goToStage(page, 'Today')
  await addTodayTask(page, 'Patch the webhook retry')
  await addIntention(page, 'Ship the billing fix')
  await launcher(page).click()
  const grip = (list: ReturnType<typeof card>) =>
    list.getByRole('button', { name: 'Move Patch the webhook retry', exact: true })

  await grip(card(page)).click()
  // Picked up in the card, and drawn as picked up there alone.
  await expect(grip(card(page))).toHaveAttribute('aria-pressed', 'true')
  await expect(grip(todayList(page))).toHaveAttribute('aria-pressed', 'false')
  await card(page)
    .getByRole('button', { name: 'Move Patch the webhook retry to Ship the billing fix', exact: true })
    .click()
  await expect(
    card(page).getByRole('region', { name: 'Intention: Ship the billing fix' }),
  ).toContainText('Patch the webhook retry')
  await expect(grip(card(page))).toBeFocused()

  // And the other way about: moved on the stage, the focus stays there.
  await grip(todayList(page)).click()
  await todayList(page)
    .getByRole('button', { name: 'Move Patch the webhook retry to no intention', exact: true })
    .click()
  await expect(grip(todayList(page))).toBeFocused()
})

test('turning back to Today keeps a half-named intention without taking the focus from the tabs', async ({
  page,
}) => {
  // Regression: the list drawn again focused the field it kept, after the
  // tabs had taken the focus, and the arrow keys then edited the field.
  await openMono(page)
  await startDay(page)
  await launcher(page).click()
  const field = card(page).getByLabel('New intention', { exact: true })

  await card(page).getByRole('button', { name: 'Add intention', exact: true }).click()
  await expect(field).toBeFocused()
  await field.fill('Ship the')
  await tab(page, 'Draft').click()
  await tab(page, 'Draft').press('ArrowLeft')
  await expect(tab(page, 'Today')).toBeFocused()
  await expect(field).toHaveValue('Ship the')
  await tab(page, 'Today').press('ArrowRight')
  await expect(tab(page, 'Draft')).toBeFocused()
  await expect(tab(page, 'Draft')).toHaveAttribute('aria-selected', 'true')
})

test("a task picked up in the card is put down when the card's list goes", async ({ page }) => {
  // Regression: the day's carry kept the pick-up after the list it came from
  // had gone, and the list drawn again no longer knew it as its own — its
  // grip said it was not picked up, and a Move here pressed on the prompt
  // left the focus on the page.
  await openMono(page)
  await startDay(page)
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await launcher(page).click()
  const grip = card(page).getByRole('button', { name: 'Move Ship the planner', exact: true })
  const moving = page.getByRole('status').filter({ hasText: 'Moving Ship the planner' })
  const ontoBlock = stage(page).getByRole('button', {
    name: 'Move Ship the planner to this block',
    exact: true,
  })

  // Turned to the draft and back: nothing is still in hand.
  await grip.click()
  await expect(moving).toBeVisible()
  await tab(page, 'Draft').click()
  await expect(moving).toHaveCount(0)
  await tab(page, 'Today').click()
  await expect(grip).toHaveAttribute('aria-pressed', 'false')
  await grip.click()
  await expect(grip).toHaveAttribute('aria-pressed', 'true')

  // Closed: the same, and the prompt no longer offers to take it.
  await launcher(page).click()
  await expect(moving).toHaveCount(0)
  await expect(ontoBlock).toHaveCount(0)

  // Kept open, the prompt's Move here sends the focus back to the card's grip.
  await launcher(page).click()
  await grip.click()
  await ontoBlock.click()
  await expect(stage(page).getByRole('region', { name: 'Tasks for this block' })).toContainText(
    'Ship the planner',
  )
  await expect(grip).toBeFocused()
})

test('a draft the browser will not save says so, on the card and its button, and leaves as a file', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    let refusing = true
    Object.assign(window, { __allowDraft: () => (refusing = false) })
    Storage.prototype.setItem = function (key: string, value: string) {
      if (refusing && key === 'mono.draft') throw new DOMException('exceeded', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await openMono(page)
  const warning = card(page).getByRole('alert')

  await launcher(page).click()
  await tab(page, 'Draft').click()
  await draft(page).fill('Call the plumber')
  await expect(warning).toContainText('This browser is not saving the draft')

  // Closed, the button still says so, on every page.
  await launcher(page).click()
  await page.getByRole('link', { name: 'Timeline', exact: true }).click()
  await expect(launcher(page)).toHaveAccessibleDescription('This browser is not saving the draft')

  // The text leaves as a file.
  await launcher(page).click()
  const download = page.waitForEvent('download')
  await warning.getByRole('button', { name: 'Save as file', exact: true }).click()
  const file = await (await download).path()
  expect((await import('node:fs')).readFileSync(file, 'utf8')).toBe('Call the plumber')

  // Emptied while it still will not save, it is still unsaved: what was
  // saved before would come back. Nothing is offered as a file.
  await draft(page).fill('')
  await expect(warning).toContainText('What it last saved will come back after a reload')
  await expect(warning.getByRole('button', { name: 'Save as file', exact: true })).toHaveCount(0)
  await expect(launcher(page)).toHaveAccessibleDescription('This browser is not saving the draft')

  // Once a write lands again, the warning goes.
  await page.evaluate(() => (window as unknown as { __allowDraft: () => void }).__allowDraft())
  await draft(page).fill('Call the plumber today')
  await expect(warning).toHaveCount(0)
  await expect(launcher(page)).not.toHaveAttribute('aria-describedby')
})
