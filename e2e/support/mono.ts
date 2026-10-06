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
 *
 * Traps that have each already produced a convincing bug that was not one:
 *
 * - **A paused clock pauses everything built on time.** Motion's frame loop
 *   runs off the faked timers, so an animated transform never settles until a
 *   spec calls `clock.resume()` and waits. React's Suspense reveal is a
 *   `setTimeout` too, which is why the app loads deferred views without it.
 * - **Seed storage with `addInitScript`, before the first `goto`.** Set after
 *   navigating, it loses to the app's own write, and the day rollover then sees
 *   a stale key and wipes the log down to one `day/reset`.
 * - **A backlog edit is on screen before it is on disk.** The backlog updates
 *   memory at once and queues the IndexedDB write, so a reload straight after
 *   an edit can abort the write carrying it — and the reloaded page is then
 *   right to show what the disk had. A spec that reloads to prove an edit was
 *   kept polls `storedRecord` for it first, never a delay.
 * - **Locators are substring and case-insensitive by default.** `getByLabel('At')`
 *   matches "Wh*at*", a `5m` button matches "1*5m*", `2 PM` matches "1*2 PM*",
 *   and `Hours` matches "Change today's *hours*". Use `{ exact: true }`
 *   liberally, and scope to `stage` or `calendar`: the same words often appear
 *   in both panels.
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
 * Move between the opening questions using the carousel.
 *
 * Scoped to the strip on purpose: the setup panel also carries buttons to the
 * neighbouring questions, with the same names because they go the same place.
 * Two controls sharing an accessible name is fine for a reader and ambiguous
 * for a locator, and this helper is specifically about the dots.
 */
export async function goToStage(page: Page, name: string) {
  await carousel(page).getByRole('button', { name, exact: true }).click()
}

/** Today's list on the third opening question: the tasks chosen, under their intentions. */
export const todayList = (page: Page) =>
  stage(page).getByRole('region', { name: 'Today', exact: true })

/** The backlog drawn in place on today's question, where a tick chooses a task for today. */
export const todayBrowser = (page: Page) =>
  page.getByRole('complementary').getByRole('group', { name: 'Tasks for today', exact: true })

/**
 * Write a task into an area's inbox from All Tasks on the opening question,
 * which chooses it for today as it is written.
 */
export async function addTodayTask(page: Page, title: string, area = 'Work') {
  const browser = todayBrowser(page)
  const field = browser.getByLabel(`New task in ${area}`, { exact: true })
  if (!(await field.isVisible())) await addTaskIn(browser, area)
  await field.fill(title)
  await field.press('Enter')
  await browser.getByRole('button', { name: `Cancel the new task in ${area}`, exact: true }).click()
}

/**
 * Open a new task's field under a place in All Tasks: `+ Task` is in the popup
 * the place's `⋯` opens.
 */
export async function addTaskIn(browser: Locator, place: string) {
  await browser.getByRole('button', { name: `More for ${place}`, exact: true }).click()
  await browser.getByRole('button', { name: `Add a task to ${place}`, exact: true }).click()
}

/**
 * Press one of a task's actions in All Tasks. They are in the popup its `⋯`
 * opens, and the `⋯` shows on hover, so the row is pointed at first, as a hand
 * would.
 */
export async function taskAction(browser: Locator, title: string, action: string) {
  await browser.getByText(title, { exact: true }).first().hover()
  await browser.getByRole('button', { name: `More for task ${title}`, exact: true }).click()
  await browser.getByRole('button', { name: action, exact: true }).click()
}

/** Name an intention to group today's tasks under, on the opening question. */
export async function addIntention(page: Page, title: string) {
  const field = stage(page).getByLabel('New intention', { exact: true })
  // Folded behind `Add intention` until asked for, and open for a run after.
  if (!(await field.isVisible())) {
    await stage(page).getByRole('button', { name: 'Add intention', exact: true }).click()
  }
  await field.fill(title)
  await field.press('Enter')
}

/**
 * Finish the opening questions.
 *
 * An empty day is a complete answer to the first two, but the first ask needs
 * one task chosen for today, so this writes one on the way out when none has
 * been. Going to the third question first changes nothing the others recorded:
 * the drafts outlive the switch, which is a rule the setup specs hold
 * separately.
 */
export async function startDay(page: Page) {
  await goToStage(page, 'Today')
  const chosen = todayList(page).getByRole('button', { name: / out of today$/ })
  if ((await chosen.count()) === 0) await addTodayTask(page, 'Ship the planner')
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
  await stage(page).getByRole('button', { name: 'Done', exact: true }).click()
  await startDay(page)
}

/** Answer both opening questions, with nothing fixed in the day. */
export async function shapeDay(page: Page) {
  await startDay(page)
}

/**
 * Write a task down on the purpose prompt and tick it for this block: written
 * into an area's inbox from All Tasks, in the column beside the prompt, which
 * chooses it for today as it is ticked.
 *
 * The default title is deliberately unlike any purpose a spec types, so a
 * text query for the purpose never also finds the task listed under the timer.
 */
export async function addBlockTask(page: Page, title = 'The task at hand', area = 'Work') {
  const browser = await openBlockBacklog(page)
  await addTaskIn(browser, area)
  const field = browser.getByLabel(`New task in ${area}`, { exact: true })
  await field.fill(title)
  await field.press('Enter')
  await browser.getByRole('button', { name: `Cancel the new task in ${area}`, exact: true }).click()
}

/** The purpose prompt's backlog, where a tick is for this block. */
export const blockBacklog = (page: Page) =>
  page.getByRole('complementary').getByRole('group', { name: 'Tasks for this block', exact: true })

/**
 * The purpose prompt's backlog, turned back to with the column's switch if
 * the day was chosen there instead, and handed back.
 */
export async function openBlockBacklog(page: Page) {
  const browser = blockBacklog(page)
  if (!(await browser.isVisible())) {
    await page
      .getByRole('group', { name: 'Show in this column' })
      .getByRole('button', { name: 'All Tasks', exact: true })
      .click()
  }
  await expect(browser).toBeVisible()
  return browser
}

/**
 * Start a block with a purpose. Every focus block carries a task, so this
 * writes one first; the purpose typed afterwards replaces the one the task's
 * title would have suggested.
 */
export async function startBlock(page: Page, purpose: string) {
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await addBlockTask(page)
  await page.getByLabel('Purpose for this block', { exact: true }).fill(purpose)
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

const ADD_ARTICLE = { task: 'a task', epic: 'an epic', outcome: 'an outcome' } as const

/**
 * Write a task, epic or outcome into its parent on the tasks page.
 *
 * Every add field there is folded behind its `+ Add …` button until asked for,
 * and stays open after an add so a run of them can be written in a row, so the
 * button is clicked only when the field is not already showing.
 */
export async function addOnTasksPage(
  page: Page,
  kind: keyof typeof ADD_ARTICLE,
  parent: string,
  title: string,
) {
  const main = page.getByRole('main')
  const field = main.getByLabel(`New ${kind} in ${parent}`, { exact: true })
  if (!(await field.isVisible())) {
    await main.getByRole('button', { name: `Add ${ADD_ARTICLE[kind]} to ${parent}`, exact: true }).click()
  }
  await field.fill(title)
  await field.press('Enter')
}

/** The fields of a stored backlog record a spec may wait on. */
export type StoredRecord = {
  id: string
  title?: string
  name?: string
  parentId?: string
  status?: string
  deletedAt?: number
}

/**
 * Every area and item the backlog's IndexedDB holds right now, read in the
 * page through a connection of its own.
 *
 * The disk, not the screen, which is the point: see the trap above. Use it
 * with `expect.poll` before a reload that is meant to prove an edit was kept.
 */
export function storedItems(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(
    () =>
      new Promise<StoredRecord[]>((resolve, reject) => {
        const open = indexedDB.open('mono')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['areas', 'items'], 'readonly')
          const areas = tx.objectStore('areas').getAll()
          const items = tx.objectStore('items').getAll()
          tx.oncomplete = () => {
            db.close()
            resolve([...areas.result, ...items.result] as StoredRecord[])
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
}

/** The stored record with this title or name, or null until the disk has it. */
export async function storedRecord(page: Page, label: string): Promise<StoredRecord | null> {
  return (await storedItems(page)).find((r) => r.title === label || r.name === label) ?? null
}
