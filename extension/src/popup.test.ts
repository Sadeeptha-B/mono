/**
 * The popup's transaction boundary.
 *
 * Worker tests prove which reply follows each Chrome failure; these tests prove
 * the UI acts on those facts in the safe order. In particular, a permission is
 * not allowed to outlive a failed addition, and a failed deletion must not
 * revoke the permission for a host that remains canonical.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GetStatusReply, SetHostsReply } from './messages'

const markup = `
  <header><span id="status"></span></header>
  <form id="add">
    <input id="host" />
    <button type="submit">Add</button>
  </form>
  <p id="hint"></p>
  <ul id="list"></ul>
`

type PopupChrome = {
  sendMessage: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const status = (
  hosts: string[] = [],
  redirectable: string[] = [],
  rulesPending = false,
): GetStatusReply => ({
  available: true,
  armed: null,
  hosts,
  redirectable,
  rulesPending,
})

function installPopupChrome(
  onMessage: (message: { kind: string; hosts?: string[] }) => unknown | Promise<unknown>,
  permissionGranted = true,
): PopupChrome {
  const sendMessage = vi.fn(onMessage)
  const request = vi.fn(() => Promise.resolve(permissionGranted))
  const remove = vi.fn(() => Promise.resolve(true))

  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage },
    permissions: { request, remove },
  }
  return { sendMessage, request, remove }
}

async function loadPopup(): Promise<void> {
  await import('./popup')
  await vi.waitFor(() =>
    expect((document.getElementById('host') as HTMLInputElement).disabled).toBe(false),
  )
}

function submit(host: string): void {
  const field = document.getElementById('host')
  if (!(field instanceof HTMLInputElement)) throw new Error('missing host field')
  field.value = host
  document.getElementById('add')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/**
 * Pay Vite's one-time transform of the popup, its shared time formatter and
 * both stylesheets in a hook with an explicit cold-cache allowance. Individual
 * transaction tests retain the normal five-second timeout and still import a
 * fresh module, so a real asynchronous hang cannot hide behind this warm-up.
 */
beforeAll(async () => {
  document.body.innerHTML = markup
  installPopupChrome(() => Promise.resolve(status()))
  await loadPopup()
  vi.resetModules()
  Reflect.deleteProperty(globalThis, 'chrome')
  document.body.textContent = ''
}, 30_000)

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = markup
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'chrome')
  document.body.textContent = ''
})

describe('popup host transactions', () => {
  it('keeps editing disabled when canonical state is unavailable', async () => {
    installPopupChrome(() => Promise.resolve({ available: false } satisfies GetStatusReply))
    await import('./popup')

    await vi.waitFor(() =>
      expect(document.getElementById('status')?.textContent).toBe('Status unavailable'),
    )
    expect((document.getElementById('host') as HTMLInputElement).disabled).toBe(true)
    expect(document.getElementById('hint')?.textContent).toContain('could not read its saved state')
  })

  it('compensates a newly granted permission when an addition was not stored', async () => {
    const setReply: SetHostsReply = { stored: false }
    const fake = installPopupChrome((message) =>
      Promise.resolve(message.kind === 'getStatus' ? status() : setReply),
    )
    await loadPopup()

    submit('reddit.com')

    await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledOnce())
    expect(document.querySelectorAll('#list li')).toHaveLength(0)
    expect(document.getElementById('hint')?.textContent).toBe('reddit.com was not saved.')
    expect(fake.request.mock.invocationCallOrder[0]).toBeLessThan(
      fake.sendMessage.mock.invocationCallOrder.at(-1) ?? Infinity,
    )
  })

  it('keeps the row and permission when a deletion was not stored', async () => {
    const setReply: SetHostsReply = { stored: false }
    const fake = installPopupChrome((message) =>
      Promise.resolve(
        message.kind === 'getStatus' ? status(['reddit.com'], ['reddit.com']) : setReply,
      ),
    )
    await loadPopup()

    const remove = document.querySelector('[aria-label="Stop blocking reddit.com"]')
    if (!(remove instanceof HTMLButtonElement)) throw new Error('missing remove button')
    remove.click()

    await vi.waitFor(() =>
      expect(document.getElementById('hint')?.textContent).toContain('removal was not saved'),
    )
    expect(document.querySelectorAll('#list li')).toHaveLength(1)
    expect(fake.remove).not.toHaveBeenCalled()
  })

  it('persists a deletion before revoking its permission even when projection is pending', async () => {
    const setReply: SetHostsReply = { stored: true, applied: false, retryScheduled: true }
    let statusReads = 0
    const fake = installPopupChrome((message) => {
      if (message.kind !== 'getStatus') return Promise.resolve(setReply)
      statusReads += 1
      return Promise.resolve(
        statusReads === 1 ? status(['reddit.com'], ['reddit.com']) : status([], [], true),
      )
    })
    await loadPopup()

    const remove = document.querySelector('[aria-label="Stop blocking reddit.com"]')
    if (!(remove instanceof HTMLButtonElement)) throw new Error('missing remove button')
    remove.click()

    await vi.waitFor(() => expect(fake.remove).toHaveBeenCalledOnce())
    const setCall = fake.sendMessage.mock.calls.findIndex(
      ([message]) => (message as { kind?: string }).kind === 'setHosts',
    )
    expect(setCall).toBeGreaterThanOrEqual(0)
    expect(fake.sendMessage.mock.invocationCallOrder[setCall]).toBeLessThan(
      fake.remove.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(document.querySelectorAll('#list li')).toHaveLength(0)
    expect(document.getElementById('hint')?.textContent).toContain('Trying again shortly')
  })

  it('refreshes a child row after removing the parent permission that covered it', async () => {
    let statusReads = 0
    const fake = installPopupChrome((message) => {
      if (message.kind === 'setHosts') {
        return Promise.resolve({ stored: true, applied: true } satisfies SetHostsReply)
      }

      statusReads += 1
      return Promise.resolve(
        statusReads === 1
          ? status(['reddit.com', 'old.reddit.com'], ['reddit.com', 'old.reddit.com'])
          : status(['old.reddit.com'], []),
      )
    })
    await loadPopup()

    const remove = document.querySelector('[aria-label="Stop blocking reddit.com"]')
    if (!(remove instanceof HTMLButtonElement)) throw new Error('missing parent remove button')
    remove.click()

    await vi.waitFor(() =>
      expect(
        document.querySelector('[aria-label="Allow the reminder page for old.reddit.com"]'),
      ).toBeInstanceOf(HTMLButtonElement),
    )
    expect(fake.remove).toHaveBeenCalledOnce()
    expect(statusReads).toBe(2)
    expect(document.querySelectorAll('#list li')).toHaveLength(1)
  })

  it('does not claim a surviving permission state when its refresh fails', async () => {
    let statusReads = 0
    installPopupChrome((message) => {
      if (message.kind === 'setHosts') {
        return Promise.resolve({ stored: true, applied: true } satisfies SetHostsReply)
      }

      statusReads += 1
      return Promise.resolve(
        statusReads === 1
          ? status(['reddit.com', 'old.reddit.com'], ['reddit.com', 'old.reddit.com'])
          : ({ available: false } satisfies GetStatusReply),
      )
    })
    await loadPopup()

    const remove = document.querySelector('[aria-label="Stop blocking reddit.com"]')
    if (!(remove instanceof HTMLButtonElement)) throw new Error('missing parent remove button')
    remove.click()

    await vi.waitFor(() =>
      expect(document.querySelector('#list li')?.textContent).toContain('permission unavailable'),
    )
    const childRemove = document.querySelector('[aria-label="Stop blocking old.reddit.com"]')
    expect(childRemove).toBeInstanceOf(HTMLButtonElement)
    expect((childRemove as HTMLButtonElement).disabled).toBe(true)
    expect(document.getElementById('hint')?.textContent).toContain(
      'could not refresh the remaining permissions',
    )
  })

  it('re-reads canonical state before compensating an ambiguous addition', async () => {
    let statusReads = 0
    const fake = installPopupChrome((message) => {
      if (message.kind === 'setHosts') return Promise.reject(new Error('reply port closed'))
      statusReads += 1
      return Promise.resolve(statusReads === 1 ? status() : status(['reddit.com'], ['reddit.com']))
    })
    await loadPopup()

    submit('reddit.com')

    await vi.waitFor(() => expect(document.querySelectorAll('#list li')).toHaveLength(1))
    expect(fake.remove).not.toHaveBeenCalled()
  })
})
