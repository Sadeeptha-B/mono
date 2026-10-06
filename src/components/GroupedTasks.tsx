/**
 * Tasks under the places they live in, each place said once.
 *
 * How today's tasks and an intention's are shown — on the opening question,
 * the purpose prompt and the tasks page alike — from the same pruned tree
 * (`groupTasks`). A list of tasks each carrying its own path said "Work › Mono
 * auth › Login pages" again for every task in that outcome; here the place
 * heads its tasks, and a task from another area simply sits under that area
 * too.
 *
 * A place holding nothing of its own and only one place beneath it is said on
 * one line with that place — `Mono auth › Login pages` — rather than as a
 * heading over a heading: the indent is for places that hold more than one
 * thing, and three nested headings over one task read as a form, not a list.
 *
 * `placeText` sets the size of a place's line, for a list read at the stage's
 * size rather than in a column's.
 *
 * `gutter` widens the space between a guide line and the rows it holds, for a
 * caller that hangs something in it: today's list hangs each task's grip
 * there, so a task's title still starts where a place's name beside it does.
 */

import type { ReactNode } from 'react'

import { PATH_SEPARATOR, type Item, type TaskTreeNode } from '@/domain/tasks'

/** How every level of one list is drawn, handed down unchanged. */
type Look = {
  renderTask: (task: Item) => ReactNode
  gutter: 'narrow' | 'wide'
  placeText: 'text-xs' | 'text-sm'
}

export function GroupedTasks({
  groups,
  label,
  renderTask,
  gutter = 'narrow',
  placeText = 'text-xs',
  className = '',
}: {
  groups: readonly TaskTreeNode[]
  /** The list's accessible name. */
  label: string
  /** What a task's row holds, inside its list item. */
  renderTask: (task: Item) => ReactNode
  /** Room between a guide line and its rows: `wide` for something hung there. */
  gutter?: Look['gutter']
  /** The size of a place's line. */
  placeText?: Look['placeText']
  className?: string
}) {
  const look: Look = { renderTask, gutter, placeText }
  return (
    <ul aria-label={label} className={`flex flex-col gap-1.5 ${className}`}>
      {groups.map((node) => (
        <Group key={node.id} node={node} above={[]} look={look} />
      ))}
    </ul>
  )
}

function Group({
  node,
  above,
  look,
}: {
  node: TaskTreeNode
  /** Places folded into this one's line, outermost first. */
  above: readonly string[]
  look: Look
}) {
  const only = node.children[0]
  if (node.tasks.length === 0 && node.children.length === 1 && only) {
    return <Group node={only} above={[...above, node.name]} look={look} />
  }
  const top = above.length === 0 && node.kind === 'area'
  return (
    <li className="min-w-0">
      <div className={`truncate ${look.placeText} ${top ? 'text-body' : 'text-muted'}`}>
        {[...above, node.name].join(PATH_SEPARATOR)}
      </div>
      <ul
        className={`mt-1 ml-1 flex flex-col gap-1 border-l border-line ${
          look.gutter === 'wide' ? 'pl-5' : 'pl-3'
        }`}
      >
        {node.children.map((child) => (
          <Group key={child.id} node={child} above={[]} look={look} />
        ))}
        {node.tasks.map((task) => (
          <li key={task.id} className="min-w-0">
            {look.renderTask(task)}
          </li>
        ))}
      </ul>
    </li>
  )
}
