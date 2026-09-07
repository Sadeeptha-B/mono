import { expect, test, type Page } from '@playwright/test'

/**
 * What Mono publishes for the site-blocking extension.
 *
 * No extension is loaded here, and none can be: the default run uses
 * `chrome-headless-shell`, which has no extension layer at all. What that
 * leaves is still worth testing and it is the half that is ours — the app posts
 * an intent at its own window whenever a block starts or stops, and the
 * timestamps in it are the only thing standing between a user and a browser
 * that stays blocked. The same bargain as the iframe standing in for
 * picture-in-picture, and `docs/manual-qa.md` covers the other half by hand.
 *
 * The recorder goes in through `addInitScript` so it is listening before the
 * app's first publish, which happens during module evaluation. Attaching after
 * `goto` would miss it, and missing it would hide the one case that matters
 * most: a reload in the middle of a block re-arming a worker that has been
 * killed and knows nothing.
 */

const TWO_PM = new Date(2026, 7, 20, 14, 0, 0)
const DEEP_MS = 45 * 60_000

type Intent = {
  channel: string
  v: number
  running: boolean
  segmentId?: string
  endsAt?: number
  startedAt?: number
  blockKind?: string
  purpose?: string | null
}

declare global {
  interface Window {
    __monoIntents?: Intent[]
  }
}

async function openMono(page: Page, time: Date = TWO_PM) {
  await page.clock.install({ time: new Date(time.getTime() - 1000) })
  await page.clock.pauseAt(time)

  await page.addInitScript(() => {
    window.__monoIntents = []
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data as Record<string, unknown> | null
      if (data === null || typeof data !== 'object') return
      if (data.channel !== 'mono.blocking') return
      // Requests travel the other way and are the extension talking to the app.
      if ('request' in data) return
      window.__monoIntents?.push(data as unknown as Intent)
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
}

const intents = (page: Page) => page.evaluate(() => window.__monoIntents ?? [])

const stage = (page: Page) => page.getByRole('main')

async function shapeDay(page: Page) {
  await stage(page).getByRole('button', { name: 'Start the day' }).click()
}

async function startBlock(page: Page, purpose: string) {
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByLabel('Purpose for this block').fill(purpose)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
}

/** The most recent intent, which is the only one a listener would be acting on. */
const latest = async (page: Page): Promise<Intent | undefined> => (await intents(page)).at(-1)

test('an idle app says so before anything has happened', async ({ page }) => {
  await openMono(page)

  // Published during module evaluation, before React has rendered. An extension
  // whose worker was killed while Mono sat idle has to hear this to know it can
  // tear its rules down.
  expect(await latest(page)).toEqual({
    channel: 'mono.blocking',
    v: 1,
    running: false,
    stoppedSegmentId: null,
  })
})

test('starting a block publishes its absolute end, not a duration', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Rewrite the planner docs')

  const intent = await latest(page)

  expect(intent).toMatchObject({
    channel: 'mono.blocking',
    v: 1,
    running: true,
    blockKind: 'deep',
    purpose: 'Rewrite the planner docs',
  })
  // The whole design rests on this being an instant. A listener that received a
  // duration would have to count, and anything that counts can be throttled,
  // frozen or slept through.
  expect(intent?.endsAt).toBe(TWO_PM.getTime() + DEEP_MS)
  expect(intent?.segmentId).toBeTruthy()
  // The ordering token the extension uses to tell a newer block from a stale
  // tab's older one. It is the instant the block began, off the segment itself.
  expect(intent?.startedAt).toBe(TWO_PM.getTime())
})

test('the ticker does not republish the same block every second', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Quiet, please')

  const before = (await intents(page)).length
  await page.clock.fastForward(10_000)
  await expect(stage(page).getByText('44:50')).toBeVisible()

  // Ten ticks, and the block has not changed. A listener that had to filter out
  // forty-five identical messages a minute would be one someone eventually
  // decided to debounce, and debouncing is how the last one gets dropped.
  expect((await intents(page)).length).toBe(before)
})

test('a block reaching zero publishes that nothing is running', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Ship the thing')

  await page.clock.fastForward(DEEP_MS)
  await expect(stage(page).getByRole('heading', { name: 'Need a break?' })).toBeVisible()

  // The block is still `active` at this point — nothing is banked until the user
  // answers — so anything reading `active` alone would keep blocking. The phase
  // is the authority, which is what `isBlockRunning` encodes.
  expect(await latest(page)).toMatchObject({ running: false, stoppedSegmentId: expect.any(String) })
})

test('abandoning a block stops blocking immediately', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Not today')

  await page.clock.fastForward(5 * 60_000)
  await stage(page).getByRole('button', { name: 'End early' }).click()

  expect(await latest(page)).toMatchObject({ running: false, stoppedSegmentId: expect.any(String) })
})

test('a break is not a block', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Then a rest')

  await page.clock.fastForward(DEEP_MS)
  await page.getByRole('button', { name: 'Take a break' }).click()
  await page.getByRole('button', { name: '10m', exact: true }).click()
  await page.getByRole('button', { name: 'Start break' }).click()
  await expect(stage(page).getByText('Break')).toBeVisible()

  // A break is a running segment with an `endsAt` of its own, and blocking
  // websites during one would be the extension arguing with the app about what
  // a break is for.
  expect(await latest(page)).toMatchObject({ running: false, stoppedSegmentId: expect.any(String) })
})

test('reloading mid-block republishes the same end instant', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Survive a reload')

  await page.clock.fastForward(10 * 60_000)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()

  // The re-arming path, and the reason the publisher fires once on startup
  // rather than only on change. `endsAt` is unchanged because it was never
  // recomputed — it was replayed off the log.
  const [intent] = await intents(page)
  // This must be the first message, not merely the state Mono eventually
  // reaches. In a no-lease worker, an anonymous idle published before async
  // rehydration would tear down the block that startup had just restored.
  expect(intent).toMatchObject({ running: true, purpose: 'Survive a reload' })
  expect(intent?.endsAt).toBe(TWO_PM.getTime() + DEEP_MS)
  // And so is `startedAt`, which matters for a different reason: a republished
  // block that looked newer every time it was republished would let a reloading
  // tab displace whatever another tab had started since.
  expect(intent?.startedAt).toBe(TWO_PM.getTime())
})

test('the priorities timer blocks too, and carries no purpose', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await page.getByRole('button', { name: /Start (deep|short) block/ }).click()
  await page.getByRole('button', { name: "I can't pick one" }).click()

  // It is a real block that consumes plan time and lands in history, so it is a
  // real block here too. Not being able to name a purpose is not a reason to
  // hand someone their distractions back.
  expect(await latest(page)).toMatchObject({
    running: true,
    blockKind: 'reflect',
    purpose: null,
  })
})

test('the extension can ask the app to end a block, and is not obeyed blindly', async ({
  page,
}) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Interrupt me')

  const running = await latest(page)
  const segmentId = running?.running === true ? running.segmentId : ''
  expect(segmentId).not.toBe('')

  // Exactly what the content script relays when the interstitial's one button
  // is pressed. It goes through the same action as End early, so the day
  // records a block cut short rather than a gap nobody explains. It has to name
  // the block it is about — see the two specs below.
  await page.evaluate((id) => {
    window.postMessage(
      { channel: 'mono.blocking', v: 1, request: 'endBlockEarly', segmentId: id },
      window.location.origin,
    )
  }, segmentId)

  await expect(stage(page).getByRole('button', { name: /Start (deep|short) block/ })).toBeVisible()
  expect(await latest(page)).toMatchObject({ running: false, stoppedSegmentId: segmentId })
})

/**
 * The interstitial is an ordinary page. It can sit in a background tab across
 * the end of the block that produced it and the start of the next one, and its
 * button would then be arguing with a block nobody is looking at. Ending
 * whatever happens to be running would throw away a block the user had only
 * just started.
 */
test('a request naming a block that is no longer running is refused', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'The block that is actually running')

  await page.evaluate(() => {
    window.postMessage(
      {
        channel: 'mono.blocking',
        v: 1,
        request: 'endBlockEarly',
        segmentId: 'a-block-that-ended-half-an-hour-ago',
      },
      window.location.origin,
    )
  })

  await expect(stage(page).getByText('The block that is actually running')).toBeVisible()
  expect(await latest(page)).toMatchObject({ running: true })
})

/**
 * No version of the extension has ever shipped without the segment id, so there
 * is nothing older to be compatible with — and "end whatever is running" is
 * exactly the behaviour the field exists to remove.
 */
test('a request that names no block at all is refused', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Still going')

  await page.evaluate(() => {
    for (const segmentId of [undefined, null, '', 42]) {
      window.postMessage(
        { channel: 'mono.blocking', v: 1, request: 'endBlockEarly', segmentId },
        window.location.origin,
      )
    }
  })

  await expect(stage(page).getByText('Still going')).toBeVisible()
  expect(await latest(page)).toMatchObject({ running: true })
})

test('a republish request is answered with the current state', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Say that again')

  const before = (await intents(page)).length

  await page.evaluate(() => {
    window.postMessage(
      { channel: 'mono.blocking', v: 1, request: 'republish' },
      window.location.origin,
    )
  })

  // Forced past the dedupe: a worker that has just started needs to be told
  // even though nothing about the session has changed since we last spoke.
  await expect.poll(async () => (await intents(page)).length).toBe(before + 1)
  expect(await latest(page)).toMatchObject({
    running: true,
    purpose: 'Say that again',
    startedAt: TWO_PM.getTime(),
  })
})

test('a request in the wrong contract version is ignored', async ({ page }) => {
  await openMono(page)
  await shapeDay(page)
  await startBlock(page, 'Keep going')

  await page.evaluate(() => {
    window.postMessage(
      { channel: 'mono.blocking', v: 99, request: 'endBlockEarly', segmentId: 'anything' },
      window.location.origin,
    )
    window.postMessage(
      { channel: 'someone.else', request: 'endBlockEarly', segmentId: 'anything' },
      window.location.origin,
    )
  })

  // The app is the newer half and will one day be talking to an extension built
  // against a contract it has never seen. Neither message may end a block.
  await expect(stage(page).getByText('Keep going')).toBeVisible()
  expect(await latest(page)).toMatchObject({ running: true })
})
