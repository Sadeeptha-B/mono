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

describe('All Tasks view preferences', () => {
  it('restores explicit open and closed choices on a fresh load', async () => {
    const { useTaskFolds } = await import('./taskFolds')
    useTaskFolds.getState().setFolded('epic', false)
    useTaskFolds.getState().setFolded('area', true)
    vi.resetModules()
    const reloaded = await import('./taskFolds')
    expect(reloaded.useTaskFolds.getState().choices).toEqual({ epic: false, area: true })
  })

  it('ignores damaged data and non-boolean choices', async () => {
    localStorage.setItem('mono.task-folds', '{bad json')
    expect((await import('./taskFolds')).useTaskFolds.getState().choices).toEqual({})
    vi.resetModules()
    localStorage.setItem('mono.task-folds', '{"open":false,"closed":true,"invalid":"false"}')
    expect((await import('./taskFolds')).useTaskFolds.getState().choices)
      .toEqual({ open: false, closed: true })
  })

  it('keeps working in memory when storage refuses reads or writes', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('denied') })
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('full') })
    const { useTaskFolds } = await import('./taskFolds')
    expect(() => useTaskFolds.getState().setFolded('epic', false)).not.toThrow()
    expect(useTaskFolds.getState().choices).toEqual({ epic: false })
  })
})
