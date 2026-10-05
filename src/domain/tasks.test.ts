import { describe, expect, it } from 'vitest'

import {
  activeAreas,
  areaOf,
  canParent,
  childrenOf,
  complete,
  defaultPurpose,
  drop,
  inboxOf,
  newArea,
  newer,
  newItem,
  nextOrder,
  openTasks,
  PURPOSE_MAX_LENGTH,
  reopen,
  type Item,
} from './tasks'

const AT = 1_000

const work = newArea('work', 'Work', 0, AT)
const personal = newArea('personal', 'Personal', 1, AT)

const item = (
  id: string,
  kind: Item['kind'],
  parentId: string,
  extra: Partial<Item> = {},
): Item => ({ ...newItem({ id, kind, title: id, parentId, order: 0 }, AT), ...extra })

describe('canParent', () => {
  it('lets a task sit under anything but another task', () => {
    expect(canParent('task', 'area')).toBe(true)
    expect(canParent('task', 'epic')).toBe(true)
    expect(canParent('task', 'outcome')).toBe(true)
    expect(canParent('task', 'task')).toBe(false)
  })

  it('keeps epics under areas and outcomes under epics', () => {
    expect(canParent('epic', 'area')).toBe(true)
    expect(canParent('epic', 'epic')).toBe(false)
    expect(canParent('outcome', 'epic')).toBe(true)
    expect(canParent('outcome', 'area')).toBe(false)
  })
})

describe('the inbox', () => {
  it('is the open tasks directly under an area, nothing deeper', () => {
    const items = [
      item('call-priya', 'task', 'work'),
      item('auth', 'epic', 'work'),
      item('login', 'task', 'auth'),
      item('shipped', 'task', 'work', { status: 'done', doneAt: AT }),
      item('gone', 'task', 'work', { deletedAt: AT }),
      item('groceries', 'task', 'personal'),
    ]

    expect(inboxOf('work', items).map((i) => i.id)).toEqual(['call-priya'])
    expect(inboxOf('personal', items).map((i) => i.id)).toEqual(['groceries'])
  })

  it('keeps sibling order', () => {
    const items = [
      item('b', 'task', 'work', { order: 2 }),
      item('a', 'task', 'work', { order: 1 }),
    ]
    expect(childrenOf('work', items).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('openTasks', () => {
  it('finds open tasks at any depth and skips epics, finished and deleted ones', () => {
    const items = [
      item('auth', 'epic', 'work'),
      item('login', 'task', 'auth'),
      item('done', 'task', 'work', { status: 'done' }),
      item('dropped', 'task', 'work', { status: 'dropped' }),
      item('deleted', 'task', 'work', { deletedAt: AT }),
    ]
    expect(openTasks(items).map((i) => i.id)).toEqual(['login'])
  })
})

describe('areaOf', () => {
  it('walks up through epics and outcomes', () => {
    const items = [
      item('auth', 'epic', 'work'),
      item('pages', 'outcome', 'auth'),
      item('login', 'task', 'pages'),
    ]
    expect(areaOf('login', items, [work, personal])?.id).toBe('work')
  })

  it('answers null for a broken chain or a cycle rather than hanging', () => {
    const orphan = [item('lost', 'task', 'nowhere')]
    expect(areaOf('lost', orphan, [work])).toBeNull()

    const cycle = [item('a', 'task', 'b'), item('b', 'epic', 'a')]
    expect(areaOf('a', cycle, [work])).toBeNull()
  })
})

describe('activeAreas', () => {
  it('drops archived and deleted areas and keeps order', () => {
    const areas = [
      { ...personal, order: 0 },
      { ...work, order: 1 },
      { ...newArea('old', 'Old', 2, AT), archivedAt: AT },
      { ...newArea('gone', 'Gone', 3, AT), deletedAt: AT },
    ]
    expect(activeAreas(areas).map((a) => a.id)).toEqual(['personal', 'work'])
  })
})

describe('nextOrder', () => {
  it('goes after the last sibling', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([{ order: 3 }, { order: 1 }])).toBe(4)
  })
})

describe('defaultPurpose', () => {
  it('is the title itself for one task', () => {
    expect(defaultPurpose(['  Fix the login redirect '])).toBe('Fix the login redirect')
  })

  it('joins several and ignores blanks', () => {
    expect(defaultPurpose(['Login form', '', 'CSRF token'])).toBe('Login form, CSRF token')
  })

  it('never exceeds the purpose field, and says when it was shortened', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Task number ${i}`)
    const purpose = defaultPurpose(long)
    expect(purpose.length).toBeLessThanOrEqual(PURPOSE_MAX_LENGTH)
    expect(purpose.endsWith('…')).toBe(true)
  })
})

describe('status transitions', () => {
  const open = item('t', 'task', 'work')

  it('stamps doneAt on completion and clears it on reopen', () => {
    const done = complete(open, 2_000)
    expect(done).toMatchObject({ status: 'done', doneAt: 2_000, updatedAt: 2_000 })

    const again = reopen(done, 3_000)
    expect(again.status).toBe('open')
    expect('doneAt' in again).toBe(false)
    expect(again.updatedAt).toBe(3_000)
  })

  it('drops without a doneAt', () => {
    const dropped = drop(complete(open, 2_000), 3_000)
    expect(dropped.status).toBe('dropped')
    expect('doneAt' in dropped).toBe(false)
  })
})

describe('newer', () => {
  it('keeps the later write, and the first on a tie', () => {
    const a = { id: 'x', updatedAt: 1 }
    const b = { id: 'x', updatedAt: 2 }
    expect(newer(a, b)).toBe(b)
    expect(newer(b, a)).toBe(b)
    const c = { id: 'x', updatedAt: 1 }
    expect(newer(a, c)).toBe(a)
  })
})
