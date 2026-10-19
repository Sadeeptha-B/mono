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

describe('backlog view folds', () => {
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

  it("keeps the board's folds apart from All Tasks', each under its own key", async () => {
    const { useBoardFolds, useTaskFolds } = await import('./taskFolds')
    useBoardFolds.getState().setFolded('epic', true)
    expect(useTaskFolds.getState().choices).toEqual({})
    vi.resetModules()
    const reloaded = await import('./taskFolds')
    expect(reloaded.useBoardFolds.getState().choices).toEqual({ epic: true })
    expect(reloaded.useTaskFolds.getState().choices).toEqual({})
    expect(localStorage.getItem('mono.board-folds')).toBe('{"epic":true}')
  })

  it('folds many at once as one choice each, leaving every other choice alone', async () => {
    const { useBoardFolds, epicTasksFold } = await import('./taskFolds')
    useBoardFolds.getState().setFolded('outcome', false)
    useBoardFolds.getState().setFolded('one', false)
    useBoardFolds.getState().setManyFolded(['one', 'two'], true)
    expect(useBoardFolds.getState().choices).toEqual({ outcome: false, one: true, two: true })
    expect(vi.mocked(localStorage.setItem)).toHaveBeenCalledTimes(3)
    vi.resetModules()
    const reloaded = await import('./taskFolds')
    expect(reloaded.useBoardFolds.getState().choices).toEqual({ outcome: false, one: true, two: true })
    // An epic's own tasks fold under a key of their own, never the epic's.
    expect(epicTasksFold('one')).not.toBe('one')
  })

  it('keeps working in memory when storage refuses reads or writes', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('denied') })
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('full') })
    const { useTaskFolds } = await import('./taskFolds')
    expect(() => useTaskFolds.getState().setFolded('epic', false)).not.toThrow()
    expect(useTaskFolds.getState().choices).toEqual({ epic: false })
  })
})
