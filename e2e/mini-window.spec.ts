/** The document picture-in-picture reduction of the running session. */

import { expect, test, type Page } from '@playwright/test'
import { PALETTES } from '../src/ambient/palette.ts'
import {
  openMono,
  rgb,
  stage,
  shapeDay,
  startBlock,
} from './support/mono'

/**
 * Document Picture-in-Picture, stubbed with a same-origin iframe.
 *
 * Playwright cannot drive a real one. The default run uses
 * `chrome-headless-shell`, which has no browser-window layer to put a
 * picture-in-picture window in, and Playwright only ever promotes CDP targets
 * of type `page` — so even headed, the window would be attached and silently
 * dropped rather than handed over as something to click.
 *
 * What that leaves is still worth testing, and it is the half that is ours: the
 * portal into a foreign document, the stylesheet copy, one store shared by two
 * documents, and a click in the second one moving the session in the first. An
 * iframe's `contentWindow` is a different document in the same origin, which is
 * exactly the shape of the real thing. What it cannot check is the window
 * actually floating above other applications, and its timers surviving a
 * backgrounded tab — both of those are in README's by-hand list.
 */
const MINI = '#mono-mini'

async function stubMiniWindow(page: Page) {
  await page.addInitScript(() => {
    let open: Window | null = null

    const api = {
      get window() {
        return open
      },
      async requestWindow() {
        // Faithful to the algorithm, which is the opposite of what it looks
        // like it should be: a second request does not fail, it *closes the
        // window that is open* and hands back a replacement. Mono's own guards
        // are the only thing standing between a stray second call and the
        // user's window being swapped underneath them, so a stub that refused
        // instead would be testing those guards against a browser that does
        // not exist.
        open?.close()

        const frame = document.createElement('iframe')
        frame.id = 'mono-mini'
        frame.style.cssText =
          'position:fixed;right:0;bottom:0;width:400px;height:320px;border:0;z-index:9999'
        document.body.append(frame)

        const win = frame.contentWindow as Window
        // `close()` on an iframe's window does nothing, so give it the two
        // behaviours the app relies on: `pagehide` fires, and then the document
        // goes away. The event is the whole of how Mono learns about a window
        // the user closed rather than one it closed itself, so a stub without
        // it would quietly pass the test that matters most here.
        Object.defineProperty(win, 'close', {
          configurable: true,
          value: () => {
            if (!open) return
            open = null
            win.dispatchEvent(new Event('pagehide'))
            frame.remove()
          },
        })
        open = win
        return win
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }

    // The window's own close control, which Mono never hears about except
    // through `pagehide`. Named on `window` the way the storage spec names its
    // own escape hatch, because there is no other way to reach a title bar.
    Object.assign(window, { __closeMini: () => open?.close() })

    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: api,
    })
  })
}

test('a browser without the API is not offered the pop-out at all', async ({ page }) => {
  // Hidden rather than deleted: the property lives on `Window.prototype`, so
  // shadowing it with `undefined` on the instance is what "this browser does
  // not have it" looks like from the app's side. Chromium under Playwright
  // does expose the API — it just cannot produce a window from it — so the
  // absent case has to be arranged, the same way the storage test arranges a
  // browser that refuses to save.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: undefined,
    })
  })

  await openMono(page)
  // Nothing at all, rather than a disabled button explaining itself. A window
  // this browser was never going to open costs the user nothing, so there is
  // nothing to apologise for; the guide names the requirement once, where
  // somebody looking for the feature would go.
  await expect(page.getByRole('button', { name: 'Pop out' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
})

test('the pop-out carries the running block, and answers for it', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)
  // Already open by the time the block is running: `popOutOnStart` defaults on,
  // so starting a block is what opens it. The header offers to close it rather
  // than to open one, and the test that turns the setting off covers the other
  // way in.
  await startBlock(page, 'Write the migration')
  await expect(page.getByRole('button', { name: 'Close pop-out' })).toBeVisible()

  // A different document entirely: none of these are reachable from a page-level
  // locator, which is also why the mini window's purpose field can keep its own
  // accessible name without making `startBlock` above ambiguous.
  const mini = page.frameLocator(MINI)
  await expect(mini.getByText('Deep block')).toBeVisible()
  await expect(mini.getByText('Write the migration')).toBeVisible()

  // The stylesheet copy is what makes the window legible at all — without it
  // the cat is a silhouette with holes in it and every layout class is inert.
  // The ink background is the cheapest proof the tokens arrived.
  const painted = await page
    .frameLocator(MINI)
    .locator('body')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(painted).toBe(rgb(PALETTES.mono.ink))

  // One store, two documents: a click out here moves the session in there.
  await mini.getByRole('button', { name: 'End early' }).click()
  await expect(stage(page).getByRole('button', { name: 'Start deep block' })).toBeVisible()
  // And the window keeps up rather than going stale on a phase it missed.
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()

  // The same control closes it, and the app carries on without it.
  await page.getByRole('button', { name: 'Close pop-out' }).click()
  await expect(page.locator(MINI)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible()
})

test('the stage and pop-out switch the same timer between remaining and elapsed time', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Write the migration')

  const mini = page.frameLocator(MINI)
  const stageTimer = stage(page).getByRole('button', { name: /Show elapsed time$/ })
  await expect(stageTimer).toHaveText('45:00')
  await expect(mini.getByRole('button', { name: /Show elapsed time$/ })).toHaveText('45:00')

  await stageTimer.click()
  const stageElapsed = stage(page).getByRole('button', { name: /Show time remaining$/ })
  const miniElapsed = mini.getByRole('button', { name: /Show time remaining$/ })
  const stageReading = stageElapsed.locator('xpath=following-sibling::span[1]')
  const miniReading = miniElapsed.locator('xpath=following-sibling::span[1]')
  await expect(stageElapsed).toHaveText('0:00')
  await expect(miniElapsed).toHaveText('0:00')
  await expect(stageReading).toHaveClass('sr-only')
  await expect(stageReading).toHaveText('0:00')
  await expect(miniReading).toHaveClass('sr-only')
  await expect(miniReading).toHaveText('0:00')
  await expect(stageElapsed).toHaveAttribute(
    'aria-label',
    'Timer showing elapsed time. Show time remaining',
  )

  await page.clock.fastForward('10:00')
  await expect(stageElapsed).toHaveText('10:00')
  await expect(miniElapsed).toHaveText('10:00')
  await expect(stageReading).toHaveText('10:00')
  await expect(miniReading).toHaveText('10:00')
  await expect(stageElapsed).toHaveAttribute(
    'aria-label',
    'Timer showing elapsed time. Show time remaining',
  )

  await miniElapsed.click()
  await expect(stage(page).getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')
  await expect(mini.getByRole('button', { name: /Show elapsed time$/ })).toHaveText('35:00')
})

test('the pop-out asks the day to be shaped rather than asking for it', async ({
  page,
}) => {
  await stubMiniWindow(page)
  await openMono(page)

  // Popped out before the day has been given a shape. Hours and commitments
  // need the calendar beside them, and there is no calendar in a window this
  // size, so this is the one question it declines and hands back.
  await page.getByRole('button', { name: 'Pop out' }).click()

  const mini = page.frameLocator(MINI)
  await expect(mini.getByText('Give the day a shape')).toBeVisible()
  await expect(mini.getByRole('textbox')).toHaveCount(0)

  // Answer it in the tab, and the window follows the day into being ready.
  await shapeDay(page)
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()
})

test('a pop-out closed from its own window is noticed', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.getByRole('button', { name: 'Close pop-out' })).toBeVisible()

  // Closed from the window rather than from Mono — the case Mono did not ask
  // for and only hears about through `pagehide`. Missing it would leave the
  // header offering to close a window that is not there, a timer ticking
  // against it, and a portal rendering into a discarded document.
  await page.evaluate(() => (window as unknown as { __closeMini: () => void }).__closeMini())

  await expect(page.locator(MINI)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible()

  // And the app is left in a state that can open another one.
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).getByText('Ready for 45 minutes')).toBeVisible()
})

test('a block starting brings the pop-out with it, by default', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  // Nothing popped out yet: naming the block is still happening in the tab, and
  // a window arriving now would take the focus off the field being typed in.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block', { exact: true }).fill('Write the migration')
  await expect(page.locator(MINI)).toHaveCount(0)

  // The click that starts the timer is the last user gesture before they go
  // elsewhere, and it is the only moment a window can be asked for at all.
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.frameLocator(MINI).getByText('Write the migration')).toBeVisible()
})

test('the pop-out stays put when the setting is off', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('checkbox', { name: 'Pop the timer out when a block starts' })
    .uncheck()
  await page.keyboard.press('Escape')

  await startBlock(page, 'Write the migration')
  await expect(page.locator(MINI)).toHaveCount(0)

  // And the header still gets you there by hand.
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).getByText('Write the migration')).toBeVisible()
})

test('the priorities timer brings the pop-out with it too', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()

  // The other way into a running segment, and a separate handler from the one
  // that submits a purpose — so it needs its own coverage or half the feature
  // is only working by accident.
  await page.getByRole('button', { name: "I can't pick one" }).click()

  await expect(page.frameLocator(MINI).getByText('Priorities')).toBeVisible()
})

test('a focus room persists and dresses the pop-out document', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)

  await page.getByRole('button', { name: /^Room/ }).click()
  const roomMenu = page.getByRole('dialog', { name: 'Room and ambient sound' })
  await expect(roomMenu.locator('[data-room-swatch]')).toHaveCount(4)
  await roomMenu.getByText('Tide', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-room', 'tide')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', PALETTES.tide.ink)
  await expect(page.locator('body')).toHaveCSS('background-color', rgb(PALETTES.tide.ink))
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-room', 'tide')
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).locator('html')).toHaveAttribute('data-room', 'tide')
})

test('ambience is silent by default and the mini control shares its mute', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDay(page)

  await page.getByRole('button', { name: /^Room/ }).click()
  const roomMenu = page.getByRole('dialog', { name: 'Room and ambient sound' })
  await expect(roomMenu.getByRole('button', { name: 'Ambient sound' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await roomMenu.getByText('Brown noise', { exact: true }).click()
  await expect(roomMenu.getByRole('button', { name: 'Ambient sound' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Escape')

  await startBlock(page, 'Quiet work')
  const mini = page.frameLocator(MINI)
  await expect(stage(page).getByRole('button', { name: 'Mute ambience' })).toBeVisible()
  await mini.getByRole('button', { name: 'Mute ambience' }).click()
  await expect(stage(page).getByRole('button', { name: 'Resume ambience' })).toBeVisible()
})
