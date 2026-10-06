/**
 * Tasks under the places they live in, each place said once.
 *
 * How an intention's tasks are shown on the tasks page and on the opening
 * question alike, from the same pruned tree (`groupTasks`). A list of tasks
 * each carrying its own path said "Work › Mono auth › Login pages" again for
 * every task in that outcome; here the place heads its tasks, and a task from
 * another area simply sits under that area too.
 *
 * A place holding nothing of its own and only one place beneath it is said on
 * one line with that place — `Mono auth › Login pages` — rather than as a
 * heading over a heading: the indent is for places that hold more than one
 * thing, and three nested headings over one task read as a form, not a list.
 *
 * A place's heading is its line of names unless the caller draws it: the
 * purpose prompt puts a checkbox on an outcome's heading that ticks every task
 * under it in that list.
 */

import type { ReactNode } from 'react'

import { PATH_SEPARATOR, type Item, type TaskTreeNode } from '@/domain/tasks'

export function GroupedTasks({
  groups,
  label,
  renderTask,
  renderPlace,
  className = '',
}: {
  groups: readonly TaskTreeNode[]
  /** The list's accessible name. */
  label: string
  /** What a task's row holds, inside its list item. */
  renderTask: (task: Item) => ReactNode
  /** A place's heading, given its node and its line of names; the line itself when absent. */
  renderPlace?: (node: TaskTreeNode, line: string) => ReactNode
  className?: string
}) {
  return (
    <ul aria-label={label} className={`flex flex-col gap-1.5 ${className}`}>
      {groups.map((node) => (
        <Group
          key={node.id}
          node={node}
          above={[]}
          renderTask={renderTask}
          renderPlace={renderPlace}
        />
      ))}
    </ul>
  )
}

function Group({
  node,
  above,
  renderTask,
  renderPlace,
}: {
  node: TaskTreeNode
  /** Places folded into this one's line, outermost first. */
  above: readonly string[]
  renderTask: (task: Item) => ReactNode
  renderPlace: ((node: TaskTreeNode, line: string) => ReactNode) | undefined
}) {
  const only = node.children[0]
  if (node.tasks.length === 0 && node.children.length === 1 && only) {
    return (
      <Group
        node={only}
        above={[...above, node.name]}
        renderTask={renderTask}
        renderPlace={renderPlace}
      />
    )
  }
  const top = above.length === 0 && node.kind === 'area'
  const line = [...above, node.name].join(PATH_SEPARATOR)
  return (
    <li className="min-w-0">
      <div className={`truncate text-xs ${top ? 'text-body' : 'text-muted'}`}>
        {renderPlace ? renderPlace(node, line) : line}
      </div>
      <ul className="mt-1 ml-1 flex flex-col gap-1 border-l border-line pl-3">
        {node.children.map((child) => (
          <Group
            key={child.id}
            node={child}
            above={[]}
            renderTask={renderTask}
            renderPlace={renderPlace}
          />
        ))}
        {node.tasks.map((task) => (
          <li key={task.id} className="min-w-0">
            {renderTask(task)}
          </li>
        ))}
      </ul>
    </li>
  )
}
