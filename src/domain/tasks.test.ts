import { describe, expect, it } from 'vitest'

import {
  activeAreas,
  activeTasks,
  archive,
  areaOf,
  canParent,
  childrenOf,
  complete,
  defaultPurpose,
  descendantsOf,
  drop,
  inboxOf,
  isInActiveTree,
  newArea,
  newer,
  newItem,
  nextOrder,
  openTasks,
  pathOf,
  purposeParts,
  tasksOfOutcome,
  placesForTasks,
  PURPOSE_MAX_LENGTH,
  reopen,
  unarchive,
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

describe('the active tree', () => {
  const tree = [
    item('auth', 'epic', 'work', { title: 'Mono auth' }),
    item('pages', 'outcome', 'auth', { title: 'Login pages' }),
    item('form', 'task', 'pages', { title: 'Login form' }),
    item('csrf', 'task', 'auth', { title: 'CSRF token' }),
    item('priya', 'task', 'work', { title: 'Call Priya' }),
  ]

  it('offers every open task while nothing above it is finished', () => {
    expect(activeTasks(tree, [work]).map((t) => t.id).sort()).toEqual(['csrf', 'form', 'priya'])
  })

  it("hides a finished or archived epic's tasks without touching them", () => {
    for (const changed of [
      complete(tree[0]!, 2_000),
      drop(tree[0]!, 2_000),
      archive(tree[0]!, 2_000),
    ]) {
      const items = [changed, ...tree.slice(1)]
      expect(activeTasks(items, [work]).map((t) => t.id)).toEqual(['priya'])
      // The tasks themselves are exactly as they were.
      expect(items.find((i) => i.id === 'form')?.status).toBe('open')
    }
  })

  it('brings them back unchanged when the epic is restored', () => {
    const archived = archive(tree[0]!, 2_000)
    const restored = unarchive(archived, 3_000)
    expect('archivedAt' in restored).toBe(false)
    expect(isInActiveTree('form', [restored, ...tree.slice(1)], [work])).toBe(true)
  })

  it('hides everything in an archived area', () => {
    const shelved = { ...work, archivedAt: 2_000 }
    expect(activeTasks(tree, [shelved])).toEqual([])
  })

  it('still counts a finished task inside an active epic as in the tree', () => {
    const items = tree.map((i) => (i.id === 'form' ? complete(i, 2_000) : i))
    expect(isInActiveTree('form', items, [work])).toBe(true)
  })
})

describe('descendantsOf', () => {
  it('finds the whole subtree, deleted children included, and survives a cycle', () => {
    const items = [
      item('auth', 'epic', 'work'),
      item('pages', 'outcome', 'auth'),
      item('form', 'task', 'pages'),
      item('gone', 'task', 'auth', { deletedAt: AT }),
      item('elsewhere', 'task', 'work'),
    ]
    expect(descendantsOf('auth', items).map((i) => i.id).sort()).toEqual(['form', 'gone', 'pages'])

    const loop = [item('a', 'task', 'b'), item('b', 'epic', 'a')]
    expect(descendantsOf('a', loop).map((i) => i.id)).toEqual(['b'])
  })
})

describe('paths and places', () => {
  const items = [
    item('auth', 'epic', 'work', { title: 'Mono auth' }),
    item('pages', 'outcome', 'auth', { title: 'Login pages' }),
    item('form', 'task', 'pages', { title: 'Login form' }),
    item('old', 'epic', 'work', { title: 'Old epic', status: 'done' }),
  ]

  it('names everything above an item, area first', () => {
    expect(pathOf('form', items, [work])).toEqual(['Work', 'Mono auth', 'Login pages'])
    expect(pathOf('auth', items, [work])).toEqual(['Work'])
  })

  it('lists every open place a task can go, in tree order', () => {
    expect(placesForTasks(items, [work, personal]).map((p) => p.label)).toEqual([
      'Work',
      'Work › Mono auth',
      'Work › Mono auth › Login pages',
      'Personal',
    ])
  })
})

describe('picking an outcome', () => {
  const items = [
    item('auth', 'epic', 'work', { title: 'Mono auth' }),
    item('pages', 'outcome', 'auth', { title: 'Login pages' }),
    item('form', 'task', 'pages', { title: 'Login form', order: 0 }),
    item('cookie', 'task', 'pages', { title: 'Session cookie', order: 1 }),
    item('shipped', 'task', 'pages', { title: 'Shipped already', status: 'done' }),
    item('solo', 'outcome', 'auth', { title: 'Docs' }),
    item('readme', 'task', 'solo', { title: 'Write the README' }),
    item('priya', 'task', 'work', { title: 'Call Priya' }),
  ]

  it("holds only the outcome's open, active tasks", () => {
    expect(tasksOfOutcome('pages', items, [work]).map((t) => t.id)).toEqual(['form', 'cookie'])
    expect(tasksOfOutcome('pages', items, [{ ...work, archivedAt: 1 }])).toEqual([])
  })

  it('names a fully picked outcome once, where its first task was', () => {
    expect(purposeParts(['priya', 'cookie', 'form'], items, [work])).toEqual([
      'Call Priya',
      'Login pages',
    ])
  })

  it('names the tasks of an outcome only partly picked', () => {
    expect(purposeParts(['form'], items, [work])).toEqual(['Login form'])
  })

  it("keeps a single-task outcome's task title, the more specific name", () => {
    expect(purposeParts(['readme'], items, [work])).toEqual(['Write the README'])
  })
})
