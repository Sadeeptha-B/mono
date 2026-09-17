/** Room controls and companion progression outside the mini-window contract. */

import { expect, test } from '@playwright/test'
import {
  openMono,
  stage,
  goToStage,
  shapeDay,
  startBlock,
  importSession,
} from './support/mono'

test('the room menu stays inside a narrow viewport and its speaker toggles sound', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 })
  await openMono(page)

  const trigger = page.getByRole('button', { name: /^Room/ })
  await trigger.click()
  const roomMenu = page.getByRole('dialog', { name: 'Room and ambient sound' })
  await expect(roomMenu.getByRole('radio', { name: 'Fern' })).toBeVisible()
  const [bounds, triggerBounds] = await Promise.all([
    roomMenu.boundingBox(),
    trigger.boundingBox(),
  ])
  expect(bounds).not.toBeNull()
  expect(triggerBounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320)

  // Fitting on screen is not the same as being placed. The panel is measured
  // before it has been narrowed to its final width unless something makes it
  // so, and a height read off a half-width column looks too tall to fit below
  // the trigger — which sends the menu above it, then hard against the top
  // edge, sitting on top of the button that opened it. This viewport has much
  // more room below, so that is where it has to be.
  expect(bounds!.y).toBeGreaterThanOrEqual(triggerBounds!.y + triggerBounds!.height)

  const soundToggle = roomMenu.getByRole('button', { name: 'Ambient sound' })
  const focusRooms = roomMenu.getByRole('group', { name: 'Focus room' })
  const [toggleBounds, roomBounds] = await Promise.all([
    soundToggle.boundingBox(),
    focusRooms.boundingBox(),
  ])
  expect(toggleBounds).not.toBeNull()
  expect(roomBounds).not.toBeNull()
  expect(toggleBounds!.y + toggleBounds!.height).toBeLessThanOrEqual(roomBounds!.y)

  await soundToggle.click()
  await expect(roomMenu.getByRole('radio', { name: /Room sound/ })).toBeChecked()
  await roomMenu.getByRole('button', { name: 'Ambient sound' }).click()
  await expect(
    roomMenu.getByRole('group', { name: 'Ambient sound' }).getByRole('radio', { checked: true }),
  ).toHaveCount(0)
})

test('the room menu shows keyboard focus on its radio cards', async ({ page }) => {
  await openMono(page)

  const trigger = page.getByRole('button', { name: /^Room/ })
  await trigger.click()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Ambient sound' })).toBeFocused()

  await page.keyboard.press('Tab')
  const room = page.getByRole('radio', { name: 'Mono' })
  await expect(room).toBeFocused()
  await expect(room.locator('..')).toHaveCSS('outline-style', 'solid')

  await page.keyboard.press('Tab')
  const sound = page.getByRole('radio', { name: /Room sound/ })
  await expect(sound).toBeFocused()
  await expect(sound.locator('..')).toHaveCSS('outline-style', 'solid')
})

test('volume keeps drag steps local and journals only the committed value', async ({ page }) => {
  await openMono(page)
  await page.getByRole('button', { name: /^Room/ }).click()
  const roomMenu = page.getByRole('dialog', { name: 'Room and ambient sound' })
  await roomMenu.getByText('Brown noise', { exact: true }).click()

  const volume = roomMenu.getByRole('slider', { name: 'Volume', exact: true })
  await volume.evaluate((input) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    for (const value of ['40', '50', '60', '70', '80']) {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await expect(roomMenu.getByText('80%', { exact: true })).toBeVisible()

  const beforeCommit = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('mono.session')!)
    return stored.state.events.filter((event: { type: string }) => event.type === 'settings/changed').length
  })
  expect(beforeCommit).toBe(1)

  await volume.dispatchEvent('pointerup')
  await expect(volume).toHaveValue('80')
  const afterCommit = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('mono.session')!)
    return stored.state.events.filter((event: { type: string }) => event.type === 'settings/changed').length
  })
  expect(afterCommit).toBe(2)

  // Keyboard changes have no pointer release. Clicking outside removes the
  // menu before the browser can blur the range, so teardown is the commit
  // boundary for this path.
  await volume.focus()
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('81')
  await stage(page).getByRole('heading', { name: "What's already fixed today?" }).click()
  await expect(roomMenu).toBeHidden()
  await expect.poll(async () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('mono.session')!)
    return stored.state.events.filter((event: { type: string }) => event.type === 'settings/changed').length
  })).toBe(3)

  await page.getByRole('button', { name: /^Room/ }).click()
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue('81')
})

test('the larger focus companion previews its room and markings across taps', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Stay with the work')

  const companion = stage(page).getByRole('button', {
    name: /Encourage Mono and preview the room/,
  })
  await expect(companion).toHaveAttribute('data-scene-tier', '0')
  expect((await companion.boundingBox())?.width).toBeGreaterThanOrEqual(220)

  await companion.click()
  await expect(companion).toHaveAttribute('data-scene-tier', '1')
  await expect(companion).toHaveAttribute('data-mark-tier', '0')
  await companion.click()
  await expect(companion).toHaveAttribute('data-scene-tier', '2')
  await expect(companion).toHaveAttribute('data-mark-tier', '1')
  await companion.click()
  await expect(companion).toHaveAttribute('data-scene-tier', '3')
  await expect(companion).toHaveAttribute('data-mark-tier', '2')

  await page.clock.fastForward('00:02')
  await expect(companion).toHaveAttribute('data-scene-tier', '0')
  await expect(companion).toHaveAttribute('data-mark-tier', '0')
})

test('a fully earned focus scene deliberately previews from the first tier again', async ({ page }) => {
  const nine = new Date(2026, 7, 20, 9, 0, 0).getTime()
  const events = [
    { type: 'day/shaped', at: nine },
    ...Array.from({ length: 6 }, (_, index) => {
      const startedAt = nine + index * 20 * 60_000
      return [
        {
          type: 'block/started', at: startedAt, id: `earned-${index}`,
          blockKind: 'short', endsAt: startedAt + 10 * 60_000, purpose: `Block ${index + 1}`,
        },
        { type: 'block/completed', at: startedAt + 10 * 60_000 },
      ]
    }).flat(),
  ]
  await openMono(page)
  await importSession(page, { version: 3, dayKey: '2026-08-20', events })
  await startBlock(page, 'Keep the room company')

  const companion = stage(page).getByRole('button', {
    name: /Encourage Mono and preview the room/,
  })
  await expect(companion).toHaveAttribute('data-scene-tier', '3')
  await expect(companion).toHaveAttribute('data-mark-tier', '2')
  await companion.click()
  await expect(companion).toHaveAttribute('data-scene-tier', '1')
  await expect(companion).toHaveAttribute('data-mark-tier', '0')

  await page.clock.fastForward('00:02')
  await expect(companion).toHaveAttribute('data-scene-tier', '3')
  await expect(companion).toHaveAttribute('data-mark-tier', '2')
})

test('the finished day reads back as a postcard', async ({ page }) => {
  const night = new Date(2026, 7, 20, 21, 0, 0)
  const ten = new Date(2026, 7, 20, 10, 0, 0).getTime()
  await openMono(page, night)
  await importSession(page, {
    version: 3,
    dayKey: '2026-08-20',
    events: [
      { type: 'day/shaped', at: new Date(2026, 7, 20, 9, 0, 0).getTime() },
      {
        type: 'block/started', at: ten, id: 'finished', blockKind: 'deep',
        endsAt: ten + 45 * 60_000, purpose: 'Write the ambient room',
      },
      { type: 'block/completed', at: ten + 45 * 60_000 },
    ],
  })

  await expect(stage(page).getByRole('heading', { name: 'Day done' })).toBeVisible()
  await expect(stage(page).getByText('45m focused')).toBeVisible()
  await expect(stage(page).getByText(/Longest block:/)).toContainText('Write the ambient room · 45m')
  await expect(stage(page).getByRole('img', { name: /1 focus block and 45 focus minutes/ })).toHaveCount(1)
  await expect(stage(page).getByRole('button', { name: /Pet Mono/ })).toHaveCount(0)

  // Setup outranks the postcard. The ordinary companion must return with the
  // setup panel instead of leaving the stage with neither scene.
  await goToStage(page, "What's already fixed")
  await expect(
    stage(page).getByRole('heading', { name: "What's already fixed today?" }),
  ).toBeVisible()
  await expect(stage(page).getByRole('heading', { name: 'Day done' })).toHaveCount(0)
  await expect(stage(page).getByRole('button', { name: /Pet Mono/ })).toBeVisible()
})
