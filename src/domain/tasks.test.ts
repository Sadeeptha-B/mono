import { describe, expect, it } from 'vitest'

import { dayKey } from './time'
import {
  activeAreas,
  activeTasks,
  archive,
  areaOf,
  backlogProblem,
  blockTasks,
  canParent,
  childrenOf,
  complete,
  groupTasks,
  defaultPurpose,
  drop,
  inboxOf,
  isGone,
  isInActiveTree,
  isVersion,
  liveDescendantsOf,
  newArea,
  newItem,
  nextVersion,
  nextOrder,
  openTasks,
  openTasksUnder,
  outranks,
  pathOf,
  purposeParts,
  tasksOfOutcome,
  PURPOSE_MAX_LENGTH,
  reopen,
  taskTree,
  taskTreeWithDone,
  unarchive,
  type Item,
  type TaskTreeNode,
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
      item('shelved', 'task', 'work', { archivedAt: AT }),
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

describe('versions', () => {
  it('stamps an edit now, or one past a version from a clock running ahead', () => {
    expect(nextVersion(5, 100)).toBe(100)
    expect(nextVersion(500, 100)).toBe(501)
  })

  it('has no next version for a record already at the last one, so nothing passes it', () => {
    const last = Number.MAX_SAFE_INTEGER
    expect(nextVersion(last - 1, 100)).toBe(last)
    expect(isVersion(last)).toBe(true)
    expect(nextVersion(last, 100)).toBeNull()
    expect(isVersion(last + 1)).toBe(false)
    expect(isVersion(1.5)).toBe(false)
    expect(isVersion(-1)).toBe(false)
  })
})

describe('outranks', () => {
  it('lets the later write win, and neither of two at the same version', () => {
    const a = { id: 'x', updatedAt: 1 }
    const b = { id: 'x', updatedAt: 2 }
    expect(outranks(b, a)).toBe(true)
    expect(outranks(a, b)).toBe(false)
    const c = { id: 'x', updatedAt: 1 }
    expect(outranks(a, c)).toBe(false)
    expect(outranks(c, a)).toBe(false)
  })

  it('lets a delete win over any live copy, and never the other way round', () => {
    const deleted = { id: 'x', updatedAt: 1, deletedAt: 1 }
    const renamedLater = { id: 'x', updatedAt: 5 }
    expect(outranks(deleted, renamedLater)).toBe(true)
    expect(outranks(renamedLater, deleted)).toBe(false)
    // Between two tombstones, versions decide as usual.
    const deletedLater = { id: 'x', updatedAt: 3, deletedAt: 3 }
    expect(outranks(deletedLater, deleted)).toBe(true)
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

describe('liveDescendantsOf', () => {
  it('finds what deleting would take: live items beneath, through live ones only', () => {
    const items = [
      item('auth', 'epic', 'work'),
      item('pages', 'outcome', 'auth'),
      item('form', 'task', 'pages'),
      item('gone', 'outcome', 'auth', { deletedAt: AT }),
      item('under-gone', 'task', 'gone'),
      item('elsewhere', 'task', 'work'),
    ]
    expect(liveDescendantsOf('auth', items).map((i) => i.id).sort()).toEqual(['form', 'pages'])

    const loop = [item('a', 'task', 'b'), item('b', 'epic', 'a')]
    expect(liveDescendantsOf('a', loop).map((i) => i.id)).toEqual(['b'])
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
})

describe('the backlog as a tree of tasks', () => {
  const items = [
    item('auth', 'epic', 'work', { title: 'Mono auth' }),
    item('pages', 'outcome', 'auth', { title: 'Login pages' }),
    item('reset', 'outcome', 'auth', { title: 'Password reset' }),
    item('form', 'task', 'pages', { title: 'Login form' }),
    item('cookie', 'task', 'pages', { title: 'Session cookie' }),
    item('csrf', 'task', 'auth', { title: 'CSRF token' }),
    item('call', 'task', 'work', { title: 'Call Priya' }),
    item('gate', 'task', 'personal', { title: 'Fix the gate' }),
    item('old', 'epic', 'work', { title: 'Old epic', status: 'done' }),
    item('hidden', 'task', 'old'),
    item('ticked', 'task', 'pages', { status: 'done' }),
  ]

  /** A node as names: its own, then its tasks', then its children's. */
  const shape = (node: TaskTreeNode): unknown => [
    `${node.kind}: ${node.name}`,
    node.tasks.map((t) => t.title),
    node.children.map(shape),
  ]

  it('holds every open task under the place it sits in, empty places included', () => {
    expect(taskTree(items, [work, personal]).map(shape)).toEqual([
      [
        'area: Work',
        ['Call Priya'],
        [
          [
            'epic: Mono auth',
            ['CSRF token'],
            [
              ['outcome: Login pages', ['Login form', 'Session cookie'], []],
              ['outcome: Password reset', [], []],
            ],
          ],
        ],
      ],
      ['area: Personal', ['Fix the gate'], []],
    ])
  })

  it('is built once per backlog snapshot', () => {
    expect(taskTree(items, [work, personal])).toBe(taskTree(items, [work, personal]))
  })

  it('groups some tasks under the places they sit in, and nothing else', () => {
    expect(groupTasks(['cookie', 'call', 'gate'], taskTree(items, [work, personal])).map(shape)).toEqual([
      [
        'area: Work',
        ['Call Priya'],
        [['epic: Mono auth', [], [['outcome: Login pages', ['Session cookie'], []]]]],
      ],
      ['area: Personal', ['Fix the gate'], []],
    ])
    expect(groupTasks(['hidden', 'ticked'], taskTree(items, [work, personal]))).toEqual([])
  })

  it("puts back the tasks done on the day asked about, after each place's open ones", () => {
    const today = new Date(2026, 9, 6, 10).getTime()
    const yesterday = new Date(2026, 9, 5, 16).getTime()
    const day = dayKey(today)
    const withDone = [
      ...items,
      item('remember', 'task', 'pages', { title: 'Remember me', status: 'done', doneAt: today }),
      item('stale', 'task', 'pages', { title: 'Stale', status: 'done', doneAt: yesterday }),
      item('mended', 'task', 'personal', { title: 'Mended', status: 'done', doneAt: today }),
      item('let go', 'task', 'personal', { title: 'Let go', status: 'dropped' }),
      item('shelved', 'task', 'work', { status: 'done', doneAt: today, archivedAt: today }),
      item('inside', 'task', 'old', { status: 'done', doneAt: today }),
    ]
    expect(taskTreeWithDone(withDone, [work, personal], day).map(shape)).toEqual([
      [
        'area: Work',
        ['Call Priya'],
        [
          [
            'epic: Mono auth',
            ['CSRF token'],
            [
              ['outcome: Login pages', ['Login form', 'Session cookie', 'Remember me'], []],
              ['outcome: Password reset', [], []],
            ],
          ],
        ],
      ],
      ['area: Personal', ['Fix the gate', 'Mended'], []],
    ])
    // The open tree is untouched, and a day not known yet adds nothing.
    expect(taskTree(withDone, [work, personal])[1]!.tasks.map((t) => t.title)).toEqual([
      'Fix the gate',
    ])
    expect(taskTreeWithDone(withDone, [work, personal], null)).toBe(
      taskTree(withDone, [work, personal]),
    )
  })

  it("groups today's finished tasks too when cut from the tree that holds them", () => {
    const today = new Date(2026, 9, 6, 10).getTime()
    const withDone = [
      ...items,
      item('remember', 'task', 'pages', { title: 'Remember me', status: 'done', doneAt: today }),
    ]
    const tree = taskTreeWithDone(withDone, [work, personal], dayKey(today))
    expect(groupTasks(['remember', 'cookie'], tree).map(shape)).toEqual([
      [
        'area: Work',
        [],
        [['epic: Mono auth', [], [['outcome: Login pages', ['Session cookie', 'Remember me'], []]]]],
      ],
    ])
    // The open tree has nothing to say about it.
    expect(groupTasks(['remember'], taskTree(withDone, [work, personal]))).toEqual([])
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

describe('a large backlog', () => {
  // 100 epics of 5 outcomes, each outcome holding 20 open tasks: 10,000 tasks.
  const build = () => {
    const items: Item[] = []
    for (let e = 0; e < 100; e++) {
      items.push(item(`e${e}`, 'epic', 'work'))
      for (let o = 0; o < 5; o++) {
        items.push(item(`e${e}o${o}`, 'outcome', `e${e}`))
        for (let t = 0; t < 20; t++) items.push(item(`e${e}o${o}t${t}`, 'task', `e${e}o${o}`))
      }
    }
    return items
  }

  it('projects in linear time, not one tree walk per task', () => {
    const items = build()
    const started = performance.now()

    expect(activeTasks(items, [work])).toHaveLength(10_000)
    expect(taskTree(items, [work])[0]!.children).toHaveLength(100)
    for (let e = 0; e < 100; e++) {
      for (let o = 0; o < 5; o++) expect(tasksOfOutcome(`e${e}o${o}`, items, [work])).toHaveLength(20)
    }
    const picked = Array.from({ length: 20 }, (_, t) => `e0o0t${t}`)
    expect(purposeParts(picked, items, [work])).toEqual(['e0o0'])

    // About 35 ms here. Ten times that, so a slow machine does not fail it,
    // while still catching both regressions met so far: a tree walk per task
    // (25 s for the first line alone) and an index rebuilt per call because the
    // areas arrived as a fresh array (600 ms for the outcome loop).
    expect(performance.now() - started).toBeLessThan(400)
  })

  it('answers repeat questions about the same snapshot from the same index', () => {
    const items = build()
    const areas = [work]
    expect(activeTasks(items, areas)).toBe(activeTasks(items, areas))
    expect(taskTree(items, areas)).toBe(taskTree(items, areas))
    // A new snapshot is a new answer.
    expect(activeTasks([...items], areas)).not.toBe(activeTasks(items, areas))
  })
})

describe('open tasks under a parent', () => {
  it('leaves out an archived task, which belongs with the put-away ones', () => {
    const items = [
      item('auth', 'epic', 'work'),
      item('form', 'task', 'auth'),
      item('shelved', 'task', 'auth', { archivedAt: AT }),
      item('shipped', 'task', 'auth', { status: 'done', doneAt: AT }),
    ]
    expect(openTasksUnder('auth', items).map((i) => i.id)).toEqual(['form'])
  })
})

describe("a block's tasks", () => {
  it("keeps the block's order and done tasks, and leaves out what is gone or unknown", () => {
    const items = [
      item('auth', 'epic', 'work', { deletedAt: AT }),
      item('form', 'task', 'auth'),
      item('readme', 'task', 'work'),
      item('ship', 'task', 'work', { status: 'done', doneAt: AT }),
      item('typo', 'task', 'work', { deletedAt: AT }),
    ]
    const tasks = blockTasks(['ship', 'form', 'missing', 'typo', 'readme'], items, [work])
    expect(tasks.map((t) => t.id)).toEqual(['ship', 'readme'])
  })
})

describe('isGone', () => {
  it('counts an item deleted with its epic or outcome, at any depth', () => {
    const items = [
      item('auth', 'epic', 'work', { deletedAt: AT }),
      item('pages', 'outcome', 'auth'),
      item('form', 'task', 'pages'),
      item('kept', 'task', 'work'),
    ]
    expect(isGone('auth', items, [work])).toBe(true)
    expect(isGone('pages', items, [work])).toBe(true)
    expect(isGone('form', items, [work])).toBe(true)
    expect(isGone('kept', items, [work])).toBe(false)
  })

  it('counts everything in a deleted area', () => {
    const items = [item('auth', 'epic', 'work'), item('call', 'task', 'auth')]
    const deleted = { ...work, deletedAt: AT }
    expect(isGone('auth', items, [deleted])).toBe(true)
    expect(isGone('call', items, [deleted])).toBe(true)
  })

  it('keeps what was moved out, and is not fooled by a missing parent or a cycle', () => {
    const items = [
      item('auth', 'epic', 'work', { deletedAt: AT }),
      item('moved', 'task', 'personal'),
      item('stray', 'task', 'nowhere'),
      item('a', 'task', 'b'),
      item('b', 'epic', 'a'),
    ]
    for (const id of ['moved', 'stray', 'a', 'b']) {
      expect(isGone(id, items, [work, personal])).toBe(false)
    }
    expect(isGone('unknown', items, [work, personal])).toBe(true)
  })

  it('takes a deleted subtree out of the active tree too', () => {
    const items = [item('auth', 'epic', 'work', { deletedAt: AT }), item('form', 'task', 'auth')]
    expect(isInActiveTree('form', items, [work])).toBe(false)
    expect(activeTasks(items, [work])).toEqual([])
  })
})

describe('backlogProblem', () => {
  it('accepts a backlog whose records fit together, under tombstones too', () => {
    const items = [
      item('auth', 'epic', 'work', { deletedAt: AT }),
      item('pages', 'outcome', 'auth'),
      item('form', 'task', 'pages'),
    ]
    expect(backlogProblem({ areas: [work], items })).toBeNull()
  })

  it('refuses a child whose parent the file does not have', () => {
    expect(backlogProblem({ areas: [work], items: [item('form', 'task', 'missing')] })).toMatch(
      /belongs to something/,
    )
  })

  it('refuses a child under a parent that cannot hold it, which every cycle has', () => {
    expect(backlogProblem({ areas: [work], items: [item('pages', 'outcome', 'work')] })).toMatch(
      /cannot/,
    )
    const loop = [item('a', 'task', 'b'), item('b', 'epic', 'a')]
    expect(backlogProblem({ areas: [work], items: loop })).toMatch(/cannot/)
  })

  it('refuses two records with one id, across areas and items too', () => {
    expect(
      backlogProblem({ areas: [work], items: [item('x', 'task', 'work'), item('x', 'task', 'work')] }),
    ).toMatch(/share an id/)
    expect(backlogProblem({ areas: [work], items: [item('work', 'task', 'work')] })).toMatch(
      /share an id/,
    )
  })

  it('refuses something put down for later under an id already used, there or anywhere', () => {
    const items = [item('form', 'task', 'work')]
    expect(backlogProblem({ areas: [work], items, later: [{ id: 'l' }, { id: 'm' }] })).toBeNull()
    expect(backlogProblem({ areas: [work], items, later: [{ id: 'l' }, { id: 'l' }] })).toMatch(
      /share an id/,
    )
    expect(backlogProblem({ areas: [work], items, later: [{ id: 'form' }] })).toMatch(/share an id/)
    expect(backlogProblem({ areas: [work], items, later: [{ id: work.id }] })).toMatch(/share an id/)
  })
})
