/** Later: what is put down to come back to, from anywhere, and dealt with on the tasks page. */

import { expect, test, type Page } from '@playwright/test'
import {
  calendar,
  importSession,
  openMono,
  shapeDay,
  stage,
  startBlock,
  storedLater,
  storedRecord,
} from './support/mono'

const main = (page: Page) => page.getByRole('main')

/** The section on the tasks page, by its name. */
const later = (page: Page) => main(page).getByRole('region', { name: 'Later', exact: true })
const waiting = (page: Page) => later(page).getByRole('list', { name: 'Waiting for later' })

/**
 * Start an import that the disk holds open, as a slow or blocked one would,
 * until the returned function lets it land. Every backlog edit is refused
 * meanwhile. The page's first read-write transaction is held, so call this
 * once the backlog has loaded and before anything else writes.
 */
async function holdAnImport(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const w = window as unknown as { holdingImport: boolean }
    w.holdingImport = true
    const original = IDBDatabase.prototype.transaction
    let held = false
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = original.apply(this, args)
      if (!held && args[1] === 'readwrite') {
        held = true
        const keepAlive = () => {
          if (w.holdingImport) tx.objectStore('meta').get('__held__').onsuccess = keepAlive
        }
        keepAlive()
      }
      return tx
    } as typeof original
  })
  await importSession(page, {
    version: 8,
    dayKey: '2026-08-20',
    events: [],
    tasks: { areas: [], items: [], later: [] },
  })
  return () =>
    page.evaluate(() => {
      ;(window as unknown as { holdingImport: boolean }).holdingImport = false
    })
}

async function openTasks(page: Page) {
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible()
}

test('a line put down for later in a block waits on the tasks page, and is not drawn on the block', async ({
  page,
}) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')

  // Beside ✎ Log, and closed until asked for, as the log is.
  await stage(page).getByRole('button', { name: 'Put something down for later' }).click()
  const field = stage(page).getByRole('textbox', { name: 'Later', exact: true })
  await field.fill('Try WebGPU for the scene')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  // The block says it put something down, and lists nothing that is not about it.
  await expect(stage(page)).toContainText('1 for later')
  await expect(stage(page).getByRole('list', { name: 'Logs in this block' })).toHaveCount(0)
  await expect(calendar(page)).not.toContainText('Try WebGPU')

  await expect.poll(async () => (await storedLater(page)).map((l) => l.title)).toEqual([
    'Try WebGPU for the scene',
  ])
  await page.reload()
  await openTasks(page)
  const row = waiting(page).getByRole('listitem')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Try WebGPU for the scene')
  // Where it was written, which is what makes a line put down mid-thought legible later.
  await expect(row).toContainText('From Write the migration')

  // Saved and read back, it is still the line it was, and files as one.
  await later(page).getByRole('button', { name: 'Move Try WebGPU for the scene' }).click()
  await main(page).getByRole('button', { name: 'Move Try WebGPU for the scene to Work' }).click()
  await expect(main(page).getByRole('list', { name: 'Work inbox' })).toContainText(
    'Try WebGPU for the scene',
  )
  await expect(waiting(page)).toHaveCount(0)
  await expect
    .poll(async () => (await storedLater(page))[0]?.deletedAt)
    .toBeDefined()
})

test('a line added on the tasks page while a block runs is marked with that block, as from anywhere', async ({
  page,
}) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')
  await openTasks(page)

  await later(page).getByRole('button', { name: 'Add to Later', exact: true }).click()
  await later(page).getByLabel('New for later', { exact: true }).fill('Ask Priya about the index')
  await later(page).getByLabel('New for later', { exact: true }).press('Enter')
  await expect(waiting(page).getByRole('listitem')).toContainText('From Write the migration')

  // And the block counts it among what it put down.
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Today' }).click()
  await expect(stage(page)).toContainText('1 for later')
})

test('the header puts things down from any page, and carrying one into a column makes it a task', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)

  const tool = page.getByRole('button', { name: 'Later', exact: true })
  await tool.click()
  const menu = page.getByRole('dialog', { name: 'Put something down for later' })
  const field = menu.getByRole('textbox', { name: 'Later', exact: true })
  // It stays open once a line is kept, for the one that comes after it.
  await field.fill('Call the plumber')
  await field.press('Enter')
  await field.fill('Read the WebGPU spec')
  // Kept with a click this time: the field has the focus back for the next.
  await menu.getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(field).toBeFocused()
  await expect(menu).toContainText('Kept · 2 waiting on Tasks')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(tool).toBeFocused()

  await expect(waiting(page).getByRole('listitem')).toHaveCount(2)

  // The board's own gesture: pick it up by its grip, put it down where it goes.
  await later(page).getByRole('button', { name: 'Move Call the plumber' }).click()
  await main(page).getByRole('button', { name: 'Move Call the plumber to Personal' }).click()
  const personal = main(page).getByRole('list', { name: 'Personal inbox' })
  await expect(personal).toContainText('Call the plumber')
  await expect(waiting(page)).not.toContainText('Call the plumber')
  // From the keyboard, the focus lands on the task it became.
  await expect(personal.getByRole('button', { name: 'Move Call the plumber' })).toBeFocused()

  await expect.poll(() => storedRecord(page, 'Call the plumber')).toMatchObject({ status: 'open' })
  await expect
    .poll(async () => (await storedLater(page)).find((l) => l.title === 'Call the plumber')?.deletedAt)
    .toBeDefined()
  await page.reload()
  await expect(main(page).getByRole('list', { name: 'Personal inbox' })).toContainText(
    'Call the plumber',
  )
  await expect(waiting(page).getByRole('listitem')).toHaveText([/Read the WebGPU spec/])
})

test('what is let go can be brought back, and deleted for good', async ({ page }) => {
  await openMono(page)
  await openTasks(page)

  await later(page).getByRole('button', { name: 'Add to Later', exact: true }).click()
  const field = later(page).getByLabel('New for later', { exact: true })
  await field.fill('Learn the cello')
  await field.press('Enter')
  await expect(waiting(page)).toContainText('Learn the cello')

  await later(page).getByRole('button', { name: 'Let go of Learn the cello' }).click()
  await expect(waiting(page)).toHaveCount(0)
  await later(page).getByText('Let go (1)').click()
  await later(page).getByRole('button', { name: 'Bring back Learn the cello' }).click()
  await expect(waiting(page)).toContainText('Learn the cello')

  await later(page).getByRole('button', { name: 'Delete Learn the cello' }).click()
  await expect(waiting(page)).toHaveCount(0)
  await expect(later(page)).not.toContainText('Let go (')
  await expect
    .poll(async () => (await storedLater(page))[0]?.deletedAt)
    .toBeDefined()
})

test('a rename under way does not outlive an import that brings the same line back', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await later(page).getByRole('button', { name: 'Add to Later', exact: true }).click()
  await later(page).getByLabel('New for later', { exact: true }).fill('Learn the cello')
  await later(page).getByLabel('New for later', { exact: true }).press('Enter')
  await expect.poll(async () => (await storedLater(page)).length).toBe(1)
  const [kept] = await storedLater(page)

  await later(page).getByRole('button', { name: 'Rename Learn the cello' }).click()
  const rename = later(page).getByRole('textbox', { name: 'Rename Learn the cello' })
  await rename.fill('Learn the viola')

  // The same line, under the same id, saying something else.
  await importSession(page, {
    version: 8,
    dayKey: '2026-08-20',
    events: [],
    tasks: { areas: [], items: [], later: [{ ...kept, title: 'Learn the piano', updatedAt: 9 }] },
  })
  await expect(rename).toHaveCount(0)
  await expect(waiting(page)).toContainText('Learn the piano')
  await expect
    .poll(async () => (await storedLater(page)).map((l) => l.title))
    .toEqual(['Learn the piano'])
})

test('a line put down while an import is landing stays in the field until it can be kept', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await expect(later(page)).toBeVisible()

  const land = await holdAnImport(page)

  await page.getByRole('button', { name: 'Later', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Put something down for later' })
  const field = menu.getByRole('textbox', { name: 'Later', exact: true })
  await field.fill('Call the plumber')
  await field.press('Enter')
  await expect(menu).toContainText('Not kept yet')
  await expect(menu).not.toContainText('Kept ·')
  await expect(field).toHaveValue('Call the plumber')

  await land()
  await expect(async () => {
    await field.press('Enter')
    await expect(menu).toContainText('Kept · 1 waiting on Tasks', { timeout: 500 })
  }).toPass()
  await expect(field).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(waiting(page)).toContainText('Call the plumber')
})

test('a line typed on the tasks page while an import lands is still there once it has', async ({
  page,
}) => {
  await openMono(page)
  await openTasks(page)
  await expect(later(page)).toBeVisible()
  const land = await holdAnImport(page)

  await later(page).getByRole('button', { name: 'Add to Later', exact: true }).click()
  const field = later(page).getByLabel('New for later', { exact: true })
  await field.fill('Call the plumber')
  await field.press('Enter')
  // Refused while the import lands, and kept in the field to be kept again.
  await expect(field).toHaveValue('Call the plumber')

  // The import lands: the backlog it brought has no areas at all.
  await land()
  await expect(main(page).getByRole('list', { name: 'Work inbox' })).toHaveCount(0)
  // The line is not one of the replaced backlog's records, and goes nowhere with it.
  await expect(field).toHaveValue('Call the plumber')
  await field.press('Enter')
  await expect(waiting(page)).toContainText('Call the plumber')
})

test('leaving a header panel by keyboard puts it away, so two never stand over each other', async ({
  page,
}) => {
  await openMono(page)
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Put something down for later' })
  await menu.getByRole('textbox', { name: 'Later', exact: true }).fill('Half a thought')

  // Out through Keep and ×, to the room's swatch, and open it from there.
  const room = page.getByRole('button', { name: /^Room/ })
  for (let i = 0; i < 5 && !(await room.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab')
  }
  await expect(room).toBeFocused()
  await expect(menu).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Room and ambient sound' })).toBeVisible()
  await expect(menu).toHaveCount(0)
})
