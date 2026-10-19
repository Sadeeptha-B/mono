import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.restoreAllMocks()
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
  })
  vi.resetModules()
})

afterEach(() => vi.unstubAllGlobals())

describe('the draft', () => {
  it('starts empty, and comes back as it was left on a fresh load', async () => {
    const { useDraftPad } = await import('./draftPad')
    expect(useDraftPad.getState().text).toBe('')
    useDraftPad.getState().setText('Call the plumber\nShip the login form')
    vi.resetModules()
    const reloaded = await import('./draftPad')
    expect(reloaded.useDraftPad.getState().text).toBe('Call the plumber\nShip the login form')
  })

  it('keeps no more than its limit', async () => {
    const { useDraftPad, DRAFT_MAX, DRAFT_KEY } = await import('./draftPad')
    useDraftPad.getState().setText('x'.repeat(DRAFT_MAX + 10))
    expect(useDraftPad.getState().text).toHaveLength(DRAFT_MAX)
    expect(localStorage.getItem(DRAFT_KEY)).toHaveLength(DRAFT_MAX)
  })

  it('keeps working in memory when storage refuses reads or writes, and says it is unsaved', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('denied') })
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('full') })
    const { useDraftPad } = await import('./draftPad')
    expect(useDraftPad.getState().text).toBe('')
    expect(useDraftPad.getState().unsaved).toBe(false)
    expect(() => useDraftPad.getState().setText('Still here')).not.toThrow()
    expect(useDraftPad.getState().text).toBe('Still here')
    expect(useDraftPad.getState().unsaved).toBe(true)

    // Emptying it is a write too: refused, the old text is still on disk.
    useDraftPad.getState().setText('')
    expect(useDraftPad.getState().unsaved).toBe(true)

    // The next write that lands catches up on all of it.
    vi.mocked(localStorage.setItem).mockImplementation(() => undefined)
    useDraftPad.getState().setText('Still here, saved')
    expect(useDraftPad.getState().unsaved).toBe(false)
  })

  it("takes what another tab saved, as storage holds it when the event arrives", async () => {
    const listeners: ((e: { key: string | null; newValue: string | null }) => void)[] = []
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (typeof listeners)[number]) => {
        if (type === 'storage') listeners.push(listener)
      },
    })
    const { useDraftPad, DRAFT_KEY } = await import('./draftPad')
    // Another tab's write lands in the shared storage, then its event fires.
    const otherTab = (value: string | null) => {
      if (value === null) vi.mocked(localStorage.getItem).mockReturnValueOnce(null)
      else localStorage.setItem(DRAFT_KEY, value)
      listeners.forEach((l) => l({ key: value === null ? null : DRAFT_KEY, newValue: value }))
    }

    useDraftPad.getState().setText('Mine')
    listeners.forEach((l) => l({ key: 'mono.board-folds', newValue: '{}' }))
    expect(useDraftPad.getState().text).toBe('Mine')
    otherTab('From the other tab')
    expect(useDraftPad.getState().text).toBe('From the other tab')
    otherTab(null)
    expect(useDraftPad.getState().text).toBe('')

    // An event queued before this tab saved something newer says what was
    // written then; storage says what was written last, which is ours.
    localStorage.setItem(DRAFT_KEY, 'Older, from the other tab')
    useDraftPad.getState().setText('Newer, from this tab')
    listeners.forEach((l) => l({ key: DRAFT_KEY, newValue: 'Older, from the other tab' }))
    expect(useDraftPad.getState().text).toBe('Newer, from this tab')

    // Text held only here is not replaced by what another tab saved.
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('full') })
    useDraftPad.getState().setText('Only in this tab')
    listeners.forEach((l) => l({ key: DRAFT_KEY, newValue: 'From the other tab' }))
    expect(useDraftPad.getState().text).toBe('Only in this tab')
  })
})
