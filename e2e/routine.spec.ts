/**
 * The routine page, and the header that no longer carries it.
 *
 * Commitments that come round on a schedule are written once on the routine
 * page, derived onto each day they fall on, and changed one day at a time from
 * the day itself. The rules and their variations are unit-tested beside the
 * domain (`recurrence.test.ts`, `events.test.ts`); these prove the wiring. The
 * usual working hours share the page, and the specs that change them are with
 * the rest of the hours in `timeline.spec.ts` and the persistence spec.
 *
 * `openMono` opens on Thursday 20 August 2026 at 2pm.
 */

import { expect, test, type Page } from '@playwright/test'
import {
  openMono,
  stage,
  calendar,
  fixedList,
  openRoutine,
  backToToday,
  importSession,
} from './support/mono'

/** The series written on the page, reached from the question it saves answering. */
async function addWeekdayStandup(page: Page) {
  await stage(page).getByRole('link', { name: 'Routine', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Routine', exact: true })).toBeVisible()
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

/** The standup as the calendar draws it, by the start of its title. */
const standupOnCalendar = (page: Page, at = '5:00 PM') =>
  calendar(page).locator(`[title^="Standup · ${at}"]`)

/** The next morning, with the tab left open. */
async function morningOf(page: Page, date: number) {
  await page.clock.setSystemTime(new Date(2026, 7, date, 9, 0, 0))
  await page.clock.fastForward('00:02')
}

test('the header is two places and its tools, on one row on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMono(page)

  const places = page.getByRole('navigation', { name: 'Pages' })
  await expect(places.getByRole('link')).toHaveText(['Today', 'Tasks'])
  await expect(places.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')

  // The tools keep the names they had as words.
  const tools = [
    page.getByRole('button', { name: 'Later', exact: true }),
    page.getByRole('button', { name: /^Room/ }),
    page.getByRole('link', { name: 'Guide', exact: true }),
    page.getByRole('button', { name: 'Settings', exact: true }),
  ]
  const top = (await places.boundingBox())!
  for (const tool of tools) {
    const box = (await tool.boundingBox())!
    // One row: every tool sits level with the places.
    expect(Math.abs(box.y + box.height / 2 - (top.y + top.height / 2))).toBeLessThan(8)
  }

  await places.getByRole('link', { name: 'Tasks' }).click()
  await expect(places.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  await expect(places.getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current')
})

test('Settings says where the usual hours went, and the routine page keeps them', async ({
  page,
}) => {
  await openMono(page)
  await openRoutine(page)
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
  await expect(page.getByLabel('Working hours 1 end', { exact: true })).toHaveValue('18:00')
})

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
  await openRoutine(page)
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
