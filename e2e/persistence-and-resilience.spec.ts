/** Day rollover, import, storage failure and lazy-load recovery. */

import { expect, test, type Page } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  blocksOf,
  goToStage,
  startDay,
  shapeDay,
  startBlock,
  importSession,
} from './support/mono'

/** Just before midnight, so the tab can be left open across the day boundary. */
const LATE = new Date(2026, 7, 20, 23, 50, 0)

/** Roll the clock into the small hours of the next day and let a tick land. */
async function crossMidnight(page: Page) {
  await page.clock.setSystemTime(new Date(2026, 7, 21, 0, 1, 0))
  await page.clock.fastForward('00:02')
}

test('the calendar editors do not carry a draft into the next day', async ({ page }) => {
  // Regression: the composers seeded their state once, at mount, and nothing
  // closed them at the rollover. An hours draft edited at 23:59 could be saved
  // at 00:01 and would land as an override on a day it was never about.
  await openMono(page, LATE)
  await shapeDay(page)

  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await calendar(page).getByLabel("Today's hours 1 end").fill('22:00')

  await crossMidnight(page)

  // The editor is gone, and yesterday's draft with it.
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toBeHidden()
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()

  // Reopening seeds from the new day's own shape, not from what was typed.
  await calendar(page).getByRole('button', { name: 'Hours', exact: true }).click()
  await expect(calendar(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')
})

test("yesterday stays in the journal and off today's axis", async ({ page }) => {
  // Regression: history survives the midnight reset by design — it is the
  // journal — and the planner drew every segment in it. So the axis reached
  // back to the first block ever recorded: on a phone, where nothing scrolls
  // itself to now, the calendar opened days before today.
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Ship the thing')
  await page.clock.fastForward('10:00')
  await stage(page).getByRole('button', { name: 'End early' }).click()

  // Drawn on the day it happened.
  await expect(blocksOf(page, 'Deep (cut short)')).toHaveCount(1)

  // Tomorrow morning, with the tab still open.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 9, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(blocksOf(page, 'Deep (cut short)')).toHaveCount(0)
  // And the axis does not span the night to reach it: 3 AM is only ever a row
  // on a timeline that started yesterday.
  await expect(calendar(page).getByText('3 AM', { exact: true })).toHaveCount(0)
})

test('an unanswered day left open overnight reopens on the first question', async ({
  page,
}) => {
  // Regression: the reset watched `shapedAt`, which never changes when the day
  // was not answered in the first place — so this, the case it mattered most
  // for, was exactly the one it missed.
  await openMono(page, LATE)
  await goToStage(page, "Today's hours")
  await expect(
    stage(page).getByRole('heading', { name: 'Are these your hours today?' }),
  ).toBeVisible()

  await crossMidnight(page)

  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
})

test('the opening questions do not carry a draft into the next day', async ({ page }) => {
  await openMono(page, LATE)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await crossMidnight(page)

  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  // And starting the new day leaves it following the recurring shape, rather
  // than overriding it with what was typed yesterday.
  await startDay(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
})

test('an import replaces the opening questions, even one for the same day', async ({
  page,
}) => {
  // The nastiest version of this bug: a same-day import into a day that was
  // never answered moves neither the date nor the answered flag, so there was
  // nothing for the UI to notice. The session generation is the fact itself.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await importSession(page, { version: 3, dayKey: '2026-08-20', events: [] })

  // Back to the first question, with nothing carried over from before.
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  await startDay(page)
  await expect(page.getByText(/Working until 6:00 PM/)).toBeVisible()
})

test('the hours question follows the recurring shape until it is edited', async ({
  page,
}) => {
  // An untouched draft is not a snapshot. Change the shape every day starts
  // from while the question is open, and the question has to be asking about
  // the new shape — not quietly holding the old one ready to save back over it.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('18:00')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('16:00')
  await page.keyboard.press('Escape')

  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('16:00')

  // And starting the day leaves it following that shape rather than overriding
  // it with what the panel happened to be showing when it mounted.
  await startDay(page)
  await expect(page.getByText(/Working until 4:00 PM/)).toBeVisible()
})

test('an edited hours draft is left alone when the default shape changes', async ({
  page,
}) => {
  // The other side of it: following the day is for a draft nobody has touched.
  // Clearing what someone is in the middle of typing would be its own bug.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await stage(page).getByLabel("Today's hours 1 end").fill('22:00')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Working hours 1 end', { exact: true }).fill('16:00')
  await page.keyboard.press('Escape')

  await expect(stage(page).getByLabel("Today's hours 1 end")).toHaveValue('22:00')

  await startDay(page)
  await expect(page.getByText(/Working until 10:00 PM/)).toBeVisible()
})

test('a new day opens on the first question, whatever yesterday ended on', async ({
  page,
}) => {
  // Regression: the setup carousel's position was component state and nothing
  // put it back at the day reset, so a tab left open overnight reopened on
  // whichever question was last looked at.
  await openMono(page)
  await goToStage(page, "Today's hours")
  await startDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()

  // Midnight, with the tab still open. Nothing is running, so the day rolls.
  await page.clock.setSystemTime(new Date(2026, 7, 21, 9, 0, 0))
  await page.clock.fastForward('00:02')

  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
})

test('plans nothing once the working day is over', async ({ page }) => {
  // 9pm against the default 9-6 shape. This is the case that used to run the
  // plan on to midnight regardless of the setting.
  await openMono(page, new Date(2026, 7, 20, 21, 0, 0))
  await shapeDay(page)

  await expect(stage(page).getByRole('heading', { name: 'Day done' })).toBeVisible()
  await expect(stage(page).getByText('Nothing banked today', { exact: true })).toBeVisible()
  await expect(stage(page).getByText(/0 blocks.*0 deep.*0 short/)).toHaveCount(0)
  await expect(blocksOf(page, 'Deep')).toHaveCount(0)
  await expect(page.getByText('0 blocks ahead · 0m of focus')).toBeVisible()
})

/**
 * A browser that refuses to write the log, from before the first load.
 *
 * Thrown out of `setItem` rather than faked in the store, because what is being
 * tested is how Mono survives the real thing: zustand's persist lets a quota
 * error out of whichever store action happened to trigger the write.
 */
async function refuseToSave(page: Page) {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem
    let refusing = true
    Object.assign(window, { __allowSaving: () => (refusing = false) })
    Storage.prototype.setItem = function (key: string, value: string) {
      if (refusing && key === 'mono.session') {
        throw new DOMException('exceeded', 'QuotaExceededError')
      }
      return original.call(this, key, value)
    }
  })
}

/** Let the writes through again, from this point on. */
const allowSaving = (page: Page) =>
  page.evaluate(() => (window as unknown as { __allowSaving: () => void }).__allowSaving())

test('a browser that will not save says so, and keeps working', async ({ page }) => {
  // The failure Mono cannot recover from on its own: the log is the one thing
  // here that cannot be rebuilt from anything else, and a quota error is a
  // silent way to lose a day. Uncaught it is worse than silent — the click that
  // shaped the day would shape it and then not finish leaving the question.
  await refuseToSave(page)

  // Mono records the day it woke up on, so the very first write is on load and
  // the warning is up before anything has been asked of it.
  await openMono(page)
  await expect(page.getByRole('button', { name: 'Not saving' })).toBeVisible()

  // The gesture still finishes: the day shapes and the stage moves on.
  await startDay(page)
  await expect(page.getByRole('button', { name: 'Start deep block' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Not saving' })).toBeVisible()

  // And it leads to the one thing that can rescue the day.
  await page.getByRole('button', { name: 'Not saving' }).click()
  await expect(page.getByRole('alert')).toContainText('Export now')
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('Escape')

  // A write that lands carries the whole log, so it catches up on everything
  // the refused ones missed — and there is nothing left to warn about.
  await allowSaving(page)
  await page.getByRole('button', { name: 'Start deep block' }).click()
  await expect(page.getByRole('button', { name: 'Not saving' })).toHaveCount(0)
})

/**
 * The guide is the one view Mono fetches after the first paint, so it is the
 * one view that can fail to arrive. What it offers when it does is a data
 * safety question rather than a cosmetic one, which is why both branches of it
 * are pinned here.
 *
 * A reload is the only thing that can fix a failed dynamic import — the browser
 * remembers the failure in its module map, so importing the same specifier
 * again never even reaches the network. But a reload is free only while the log
 * is on disk. If the browser has also stopped saving, the same click is the
 * whole day, and the offer has to be the export instead.
 */
test.describe('a guide that never arrives', () => {
  // The chunk is blocked at the network, so the service worker must not be
  // allowed to answer from its precache and route around the point of the test.
  test.use({ serviceWorkers: 'block' })

  /**
   * Cut the guide module off, before anything has asked for it.
   *
   * Production emits `GuidePage-<hash>.js`; development serves `GuidePage.tsx`.
   * Cover both so the fast loop exercises the same recovery path as the
   * production gate. If either convention changes, the guide simply loads and
   * the assertions fail rather than letting a broken interception pass.
   */
  const blockTheChunk = (page: Page) =>
    page.route(
      /\/(?:assets\/GuidePage-[^/]+\.js|src\/components\/Guide\/GuidePage\.tsx)(?:\?.*)?$/,
      (route) => route.abort(),
    )

  test('says so, and offers the reload that fixes it', async ({ page }) => {
    await blockTheChunk(page)
    await openMono(page)

    await page.getByRole('link', { name: 'Guide' }).click()
    const card = page.getByRole('alert')
    await expect(card).toContainText('The guide did not load')
    await expect(card).toContainText('is saved')
    await expect(card.getByRole('button', { name: 'Reload Mono' })).toBeVisible()

    // And it is not a dead end: the app is still there to go back to.
    await card.getByRole('button', { name: 'Back to Mono' }).click()
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  })

  test('never offers that reload while the log is unsaved', async ({ page }) => {
    await refuseToSave(page)
    await blockTheChunk(page)
    await openMono(page)
    await expect(page.getByRole('button', { name: 'Not saving' })).toBeVisible()

    await page.getByRole('link', { name: 'Guide' }).click()
    const card = page.getByRole('alert')
    await expect(card).toContainText('only in this tab')

    // The whole reason this branch exists: the click that would delete the day
    // is not on the card at all, rather than there and discouraged.
    await expect(card.getByRole('button', { name: 'Reload Mono' })).toHaveCount(0)

    // What is offered instead reaches the export — which is in the opening
    // bundle precisely so that it cannot be the second thing to fail here.
    await card.getByRole('button', { name: 'Export today' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  })
})
