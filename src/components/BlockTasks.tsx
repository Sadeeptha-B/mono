/**
 * The tasks a block is for, as a checklist.
 *
 * Shown under the running timer and again when the block is done, and in the
 * mini window when the block is done — one component, so the three places
 * cannot disagree about what ticking a task means. It means one thing: the
 * backlog marks the task done, and only the backlog. A block is completed or
 * abandoned by its own
 * controls and on its own terms; a task can be finished in a block that was
 * cut short, and a block can run its full length without finishing anything.
 * Neither says anything about the other, so neither writes the other.
 *
 * Ticking is allowed during the block rather than only at the end of it, which
 * is what lets `End early` stay one click: anything finished has already been
 * ticked on the way past.
 *
 * Reads the task store directly rather than taking titles as props. The block
 * knows ids, the backlog knows what they say now, and a task renamed in another
 * tab mid-block should read as renamed here too. The calendar's blocks read
 * them the same way, through `useBlockTasks`.
 */

import { SectionHeading } from './ui'
import { blockTasks, type Item } from '@/domain/tasks'
import { useTasks } from '@/store/tasks'

/** The tasks a block is for, as the backlog has them now (`blockTasks`). */
export function useBlockTasks(taskIds: readonly string[]): Item[] {
  const items = useTasks((s) => s.items)
  const areas = useTasks((s) => s.areas)
  return blockTasks(taskIds, items, areas)
}

export function BlockTasks({
  taskIds,
  compact = false,
}: {
  taskIds: readonly string[]
  /** Sized for the mini window. */
  compact?: boolean
}) {
  const tasks = useBlockTasks(taskIds)
  const completeItem = useTasks((s) => s.completeItem)
  const reopenItem = useTasks((s) => s.reopenItem)
  if (tasks.length === 0) return null

  const list = (
    <ul
      aria-label="Tasks in this block"
      className={`flex flex-col ${compact ? 'mt-2 gap-0.5 text-xs' : 'mt-1.5 gap-1.5 text-sm'}`}
    >
      {tasks.map((task) => {
        const done = task.status === 'done'
        return (
          <li key={task.id} className="flex items-baseline gap-2">
            <input
              type="checkbox"
              checked={done}
              onChange={() => (done ? reopenItem(task.id) : completeItem(task.id))}
              aria-label={`${task.title} done`}
              className="translate-y-0.5 accent-[var(--color-deep)]"
            />
            <span
              className={`min-w-0 truncate ${done ? 'text-muted line-through' : 'text-body'}`}
            >
              {task.title}
            </span>
          </li>
        )
      })}
    </ul>
  )

  // Headed on the stage, where the block's logs follow it and the two lists
  // would otherwise run together. The mini window shows one list at a time and
  // has no room to spare for a heading.
  if (compact) return list
  return (
    <section className="mt-5">
      <SectionHeading>Tasks</SectionHeading>
      {list}
    </section>
  )
}
