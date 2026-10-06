/** The document picture-in-picture reduction of the running session. */

import { expect, test, type Page } from '@playwright/test'
import { PALETTES } from '../src/ambient/palette.ts'
import {
  addBlockTask,
  addIntention,
  addTodayTask,
  goToStage,
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
      async requestWindow({ width, height }: { width: number; height: number }) {
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
          `position:fixed;right:0;bottom:0;width:${width}px;height:${height}px;border:0;z-index:9999`
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
        Object.defineProperty(win, 'resizeBy', {
          configurable: true,
          value: (width: number, height: number) => {
            frame.style.width = `${win.innerWidth + width}px`
            frame.style.height = `${win.innerHeight + height}px`
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

/**
 * Shape the day, and put away the window that came out with it.
 *
 * The intentions question's timer brings the pop-out by default, so a day
 * shaped with the stub installed ends with a window open. The tests that use
 * this are about what happens after that, and start from no window.
 */
async function shapeDayInTab(page: Page) {
  await shapeDay(page)
  await page.getByRole('button', { name: 'Close pop-out' }).click()
  await expect(page.locator(MINI)).toHaveCount(0)
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
  await shapeDayInTab(page)
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
  await shapeDayInTab(page)
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

test('the pop-out follows the opening questions, with their answers so far', async ({
  page,
}) => {
  await stubMiniWindow(page)
  await openMono(page)

  // Popped out on the first question. It is answered beside the calendar, so
  // the window says where the answer stands and hands the answering back.
  await page.getByRole('button', { name: 'Pop out' }).click()
  const mini = page.frameLocator(MINI)
  await expect(
    mini.getByRole('heading', { name: 'What are your commitments for today?' }),
  ).toBeVisible()
  await expect(mini.getByText('Nothing fixed yet')).toBeVisible()
  await expect(mini.getByRole('textbox')).toHaveCount(0)

  await goToStage(page, 'Hours')
  await expect(mini.getByRole('heading', { name: 'Are these your hours today?' })).toBeVisible()
  await expect(mini.getByText('9:00 AM–6:00 PM')).toBeVisible()

  await goToStage(page, 'Today')
  await expect(mini.getByRole('heading', { name: "Choose today's tasks" })).toBeVisible()
  await addTodayTask(page, 'Ship the planner')
  await expect(mini.getByText('1 task chosen so far.')).toBeVisible()
  await addIntention(page, 'The planner')
  await expect(mini.getByText('1 task chosen so far, grouped as The planner.')).toBeVisible()

  // Answered, the window follows the day into being ready…
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()

  // …and back to whichever question the stage goes back to.
  await goToStage(page, 'Hours')
  await expect(mini.getByRole('heading', { name: 'Are these your hours today?' })).toBeVisible()
  await expect(mini.getByText('Changing today')).toBeVisible()
  await stage(page).getByRole('button', { name: 'Focus', exact: true }).click()
  await expect(mini.getByText('Ready for 45 minutes')).toBeVisible()
})

test('a pop-out closed from its own window is noticed', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDayInTab(page)

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

test('an awkwardly sized pop-out offers to return to its opening size', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDayInTab(page)
  await startBlock(page, 'Write the migration')

  const frame = page.locator(MINI)
  const mini = page.frameLocator(MINI)
  const reset = mini.getByRole('button', { name: 'Reset size' })
  await expect(frame).toHaveCSS('width', '470px')
  await expect(frame).toHaveCSS('height', '210px')
  await expect(reset).toHaveCount(0)
  const openingOverflow = await mini.locator('.mono-scroll').evaluate(
    (scroller) => scroller.scrollHeight - scroller.clientHeight,
  )
  expect(openingOverflow).toBeLessThanOrEqual(2)

  await frame.evaluate((el) => {
    el.style.width = '600px'
    el.style.height = '500px'
  })
  await expect(reset).toBeVisible()
  await reset.click()
  await expect(frame).toHaveCSS('width', '470px')
  await expect(frame).toHaveCSS('height', '210px')
  await expect(reset).toHaveCount(0)

  // A small trim from the chosen opening height is still within the preferred
  // range, so it should not offer a rescue action prematurely.
  await frame.evaluate((el) => {
    el.style.height = '180px'
  })
  await expect(reset).toHaveCount(0)
  await frame.evaluate((el) => {
    el.style.height = '210px'
  })

  // A visible locator is not enough here: Playwright can scroll a clipped
  // button into view before clicking it. Check its actual onscreen rectangle
  // before any click at the short sizes that previously buried the footer.
  for (const [width, height] of [[400, 150], [340, 120], [320, 100]]) {
    await frame.evaluate((el, size) => {
      el.style.width = `${size.width}px`
      el.style.height = `${size.height}px`
    }, { width, height })
    await expect(reset).toBeVisible()
    const bounds = await reset.evaluate((button) => {
      const rect = button.getBoundingClientRect()
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: button.ownerDocument.defaultView!.innerHeight,
      }
    })
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
  }
  const shortWindowOverflow = await mini.locator('.mono-scroll').evaluate(
    (scroller) => scroller.scrollHeight - scroller.clientHeight,
  )
  expect(shortWindowOverflow).toBeGreaterThan(0)

  await reset.click()
  await expect(frame).toHaveCSS('width', '470px')
  await expect(frame).toHaveCSS('height', '210px')
  await expect(reset).toHaveCount(0)
})

test('a block starting brings the pop-out with it, by default', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDayInTab(page)

  // Nothing popped out yet: naming the block is still happening in the tab, and
  // a window arriving now would take the focus off the field being typed in.
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await addBlockTask(page)
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
  await shapeDayInTab(page)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page
    .getByRole('checkbox', { name: 'Pop the timer out when a block starts' })
    .uncheck()
  await page
    .getByRole('checkbox', { name: 'Pop the timer out when you take time to decide' })
    .uncheck()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await stage(page).getByRole('button', { name: 'Take 5 mins to decide' }).click()
  await expect(page.locator(MINI)).toHaveCount(0)
  await addBlockTask(page)
  await page.getByLabel('Purpose for this block', { exact: true }).fill('Write the migration')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator(MINI)).toHaveCount(0)

  // And the header still gets you there by hand.
  await page.getByRole('button', { name: 'Pop out' }).click()
  await expect(page.frameLocator(MINI).getByText('Write the migration')).toBeVisible()
})

test("picking a block's tasks is handed back to the tab", async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDayInTab(page)

  await page.getByRole('button', { name: 'Pop out' }).click()
  const mini = page.frameLocator(MINI)
  await mini.getByRole('button', { name: /Start (deep|short) block/ }).click()

  // The list to pick from is the tab's; this window says so, and keeps only
  // the answers that need no list.
  await expect(
    mini.getByRole('heading', { name: /^Decide what the next \d+ minutes are for$/ }),
  ).toBeVisible()
  await expect(mini.getByText("Pick this block's tasks in the tab")).toBeVisible()
  await expect(mini.getByRole('textbox')).toHaveCount(0)
  await expect(mini.getByRole('button', { name: 'Not yet' })).toBeVisible()

  // One of which is a few minutes to decide in, on the same clock as the tab's.
  await mini.getByRole('button', { name: 'Take 5 mins to decide' }).click()
  await expect(mini.getByLabel('Time left to decide')).toHaveText('5:00')
  await expect(stage(page).getByLabel('Time left to decide')).toHaveText('5:00')
  await page.clock.fastForward('02:00')
  await expect(mini.getByLabel('Time left to decide')).toHaveText('3:00')
})

test("a question's timer brings the pop-out with it, by default", async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await expect(page.locator(MINI)).toHaveCount(0)

  // Today's timer starts by itself on the first visit, so the click that shows
  // the question is the one that brings the window, with the clock in it.
  await goToStage(page, 'Today')
  const mini = page.frameLocator(MINI)
  await expect(mini.getByRole('heading', { name: "Choose today's tasks" })).toBeVisible()
  await expect(mini.getByLabel("Time left to choose today's tasks")).toHaveText('5:00')
  await page.clock.fastForward('05:00')
  await expect(mini.getByText("Time's up")).toBeVisible()

  // Another round from out here runs on the stage too.
  await mini.getByRole('button', { name: 'Take another 5 mins' }).click()
  await expect(stage(page).getByLabel("Time left to choose today's tasks")).toHaveText('5:00')

  // The purpose prompt's few minutes bring it the same way.
  await addTodayTask(page, 'Ship the planner')
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
  await page.getByRole('button', { name: 'Close pop-out' }).click()
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await expect(page.locator(MINI)).toHaveCount(0)
  await stage(page).getByRole('button', { name: 'Take 5 mins to decide' }).click()
  await expect(mini.getByLabel('Time left to decide')).toHaveText('5:00')
})

test('Open Mono brings the tab back to the day, wherever it was', async ({ page }) => {
  await stubMiniWindow(page)
  await openMono(page)
  await shapeDayInTab(page)

  // Popped out from the tasks page, which has no stage on it.
  await page.getByRole('link', { name: 'Tasks', exact: true }).click()
  await page.getByRole('button', { name: 'Pop out' }).click()
  const mini = page.frameLocator(MINI)
  await mini.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await mini.getByRole('button', { name: 'Open Mono' }).click()

  // The picker the window promised is now on screen.
  await expect(stage(page).getByRole('heading', { name: 'Your purpose for this block' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/')
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
  await shapeDayInTab(page)

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
