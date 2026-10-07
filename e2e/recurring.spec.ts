/**
 * Commitments that come round on a schedule: written once on their own page,
 * derived onto each day they fall on, and changed one day at a time from the
 * day itself. The rules and their variations are unit-tested beside the
 * domain (`recurrence.test.ts`, `events.test.ts`); these prove the wiring.
 *
 * `openMono` opens on Thursday 20 August 2026 at 2pm.
 */

import { expect, test, type Page } from '@playwright/test'
import { openMono, stage, calendar, fixedList, importSession } from './support/mono'

/** The series written on the page, as the guide tells someone to. */
async function addWeekdayStandup(page: Page) {
  await page.getByRole('link', { name: 'Recurring', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recurring', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add a recurring commitment', exact: true }).click()
  await page.getByLabel('What', { exact: true }).fill('Standup')
  // Exact matching throughout: "At" is a substring of "What".
  await page.getByLabel('At', { exact: true }).fill('17:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('15')
  // Every weekday is the default, and the form says what it means.
  await expect(page.getByText(/Every weekday\. Next: Thu 20 Aug \(today\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Recurring commitments' }).getByText('Standup'),
  ).toBeVisible()
}

const backToToday = (page: Page) => page.getByRole('link', { name: 'Back to today' }).click()

/** The standup as the calendar draws it, by the start of its title. */
const standupOnCalendar = (page: Page, at = '5:00 PM') =>
  calendar(page).locator(`[title^="Standup · ${at}"]`)

/** The next morning, with the tab left open. */
async function morningOf(page: Page, date: number) {
  await page.clock.setSystemTime(new Date(2026, 7, date, 9, 0, 0))
  await page.clock.fastForward('00:02')
}

test('a series written once comes round on the days it names, and only those', async ({
  page,
}) => {
  await openMono(page)
  await addWeekdayStandup(page)
  await backToToday(page)

  // Today is a Thursday, so it is already among the day's commitments, marked
  // as repeating, and drawn on the calendar.
  await expect(fixedList(page).getByText('Standup')).toBeVisible()
  await expect(fixedList(page).getByText('Recurring:')).toBeAttached()
  await expect(standupOnCalendar(page)).toHaveCount(1)

  // Not on Saturday.
  await morningOf(page, 22)
  await expect(standupOnCalendar(page)).toHaveCount(0)
  await expect(fixedList(page)).toHaveCount(0)

  // Back on Monday, with nothing typed in again.
  await morningOf(page, 24)
  await expect(fixedList(page).getByText('Standup')).toBeVisible()
  await expect(standupOnCalendar(page)).toHaveCount(1)
})

test("skipping today's leaves the series and tomorrow alone", async ({ page }) => {
  await openMono(page)
  await addWeekdayStandup(page)
  await backToToday(page)

  await stage(page).getByRole('button', { name: 'Skip Standup today', exact: true }).click()
  await expect(fixedList(page)).toHaveCount(0)
  await expect(standupOnCalendar(page)).toHaveCount(0)

  await morningOf(page, 21)
  await expect(fixedList(page).getByText('Standup')).toBeVisible()
  await expect(standupOnCalendar(page)).toHaveCount(1)
})

test("moving today's moves today only", async ({ page }) => {
  await openMono(page)
  await addWeekdayStandup(page)
  await backToToday(page)

  await fixedList(page).getByRole('button', { name: 'Edit Standup', exact: true }).click()
  await expect(stage(page).getByText("This changes today's only.")).toBeVisible()
  await stage(page).getByLabel('At', { exact: true }).fill('17:30')
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()

  await expect(standupOnCalendar(page, '5:30 PM')).toHaveCount(1)
  await expect(standupOnCalendar(page)).toHaveCount(0)

  // The series still says five o'clock, and tomorrow follows it.
  await page.getByRole('link', { name: 'Recurring', exact: true }).click()
  await expect(
    page.getByRole('list', { name: 'Recurring commitments' }).getByText('5:00 PM'),
  ).toBeVisible()
  await backToToday(page)
  await morningOf(page, 21)
  await expect(standupOnCalendar(page)).toHaveCount(1)
})

test('an import folds a series being edited, even one that keeps its id', async ({ page }) => {
  // Regression: the editor let go of its series only when the id vanished,
  // and a backup restores the same ids. Saving the stale draft afterwards
  // wrote it over what had just been restored.
  await openMono(page)
  await addWeekdayStandup(page)

  const events = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('mono.session')!) as {
      state: { events: { type: string; rule?: object }[] }
    }
    return saved.state.events.map((e) =>
      e.type === 'recurring/added' ? { ...e, rule: { ...e.rule, title: 'Sync', time: '10:00' } } : e,
    )
  })

  await page.getByRole('button', { name: 'Edit Standup', exact: true }).click()
  await page.getByLabel('What', { exact: true }).fill('Standup, half typed')
  await importSession(page, { version: 7, dayKey: '2026-08-20', events })

  await expect(page.getByLabel('What', { exact: true })).toHaveCount(0)
  const list = page.getByRole('list', { name: 'Recurring commitments' })
  await expect(list.getByText('Sync')).toBeVisible()
  await expect(list.getByText('10:00 AM')).toBeVisible()
})
