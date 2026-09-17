/**
 * Shared browser-test vocabulary for Mono.
 *
 * These helpers describe product gestures and surfaces rather than test
 * scenarios. Keeping them here lets the concern-based specs stay independent
 * without growing subtly different ways to open, shape or inspect the day.
 *
 * Playwright's clock control models two importantly different events.
 * `fastForward` fires the intervening timers, like an ordinary running block;
 * `setSystemTime` jumps without firing them, like a laptop waking from sleep.
 * Tests use the one that matches the behavior they mean to exercise.
 */

import { expect, type Locator, type Page } from '@playwright/test'

/** 2pm on a fixed weekday, well clear of any DST boundary. */
const TWO_PM = new Date(2026, 7, 20, 14, 0, 0)

export async function openMono(page: Page, time: Date = TWO_PM) {
  // `install` alone leaves the clock ticking, which makes block arithmetic
  // drift by a few hundred milliseconds — enough to turn a 180-minute runway
  // into 179.9 and cost a deep block. Install slightly early, then pause at
  // the exact target so we avoid rewinding while still landing on the right
  // millisecond.
  await page.clock.install({ time: new Date(time.getTime() - 1000) })
  await page.clock.pauseAt(time)
  await page.goto('/')
  // `exact` is not optional here. The day's opening question is headed "Are
  // these your hours today?", and a substring match on "Today" — the default —
  // resolves to both it and the calendar's own heading.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
}

/** A palette hex as `getComputedStyle` hands it back. */
export const rgb = (hex: string): string => {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  return `rgb(${channels.join(', ')})`
}

/** The stage, to disambiguate from the same text on the calendar. */
export const stage = (page: Page) => page.getByRole('main')
/** The calendar column. */
export const calendar = (page: Page) => page.getByRole('complementary')

/**
 * Blocks on the calendar carry a descriptive title, e.g. "Deep · 2:00 PM · 45m".
 *
 * Anchored on purpose. `getByTitle` is substring *and* case-insensitive by
 * default, so a plain "Deep" would also match a commitment the user happened to
 * call "deep dive". Including the separator keeps the block label distinct.
 */
export const blocksOf = (page: Page, label: string) =>
  calendar(page).locator(`[title^="${label} ·"]`)

/** How much of an element is hidden inside its own scrollbar. Zero if none is. */
export const overflowOf = (locator: Locator) =>
  locator.evaluate((el) => el.scrollHeight - el.clientHeight)

/** The commitments already named, listed under the day's first question. */
export const fixedList = (page: Page) => stage(page).getByRole('list', { name: 'Fixed today' })

/** The strip of stage dots under the stage. */
export const carousel = (page: Page) => page.getByRole('navigation', { name: 'Stages of the day' })

/**
 * Move between the two opening questions using the carousel.
 *
 * Scoped to the strip on purpose: the setup panel also carries a button to the
 * other question, with the same name because it goes the same place. Two
 * controls sharing an accessible name is fine for a reader and ambiguous for a
 * locator, and this helper is specifically about the dots.
 */
export async function goToStage(page: Page, name: string) {
  await carousel(page).getByRole('button', { name, exact: true }).click()
}

/**
 * Finish the opening questions. Available from either of them, and from the
 * commitments one with nothing added — an empty day is a complete answer.
 */
export async function startDay(page: Page) {
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
}

/**
 * The first commitment is asked for inline on the stage, which is where the
 * requirements put it, and it is now the first thing the day asks. Later ones
 * go through the calendar's own composer.
 */
export async function addStandup(page: Page) {
  await page.getByLabel('Next commitment', { exact: true }).fill('Daily standup')
  // Exact matching throughout: "At" is a substring of "What".
  await page.getByLabel('At', { exact: true }).fill('17:00')
  await page.getByLabel('For (minutes)', { exact: true }).fill('15')
  await page.getByRole('button', { name: 'Add commitment' }).click()
  await startDay(page)
}

/** Answer both opening questions, with nothing fixed in the day. */
export async function shapeDay(page: Page) {
  await startDay(page)
}

export async function startBlock(page: Page, purpose: string) {
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block').fill(purpose)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
}

/** Hand a file straight to the import control, without going via a download. */
export async function importSession(page: Page, contents: unknown) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'mono-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(contents)),
  })
  await page.keyboard.press('Escape')
}
