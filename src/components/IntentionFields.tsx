/**
 * Writing an intention, wherever it is written: its title, the tasks it takes,
 * and what saving it does.
 *
 * The opening question and the tasks page both create and edit intentions, so
 * the fields, the reading of the backlog behind them and the save are here
 * once, and each surface keeps only its own frame — when the form is open,
 * what Enter and `Done` fold. The save is worked out by `planIntentionSave`
 * before anything is written, and then written in order: the intention, so a
 * new one has an id, then each task put under it or taken out of it.
 */

import { useMemo, type Ref } from 'react'

import { GroupedTasks } from './GroupedTasks'
import { TaskTreePicker } from './TaskTreePicker'
import { fieldClass } from './ui'
import { planIntentionSave, type IntentionDraft } from '@/domain/intentions'
import { activeTasks, groupTasks, taskTree } from '@/domain/tasks'
import type { Intention, IntentionPatch } from '@/domain/types'
import { useTasks } from '@/store/tasks'

/**
 * The backlog as the intention forms read it, per snapshot rather than per
 * tick: both surfaces render every second.
 */
export function useIntentionBacklog(taskIntentions: Readonly<Record<string, string>>) {
  const hydrated = useTasks((s) => s.hydrated)
  const items = useTasks((s) => s.items)
  const areas = useTasks((s) => s.areas)
  const tree = taskTree(items, areas)
  // Every task the tree offers: what a choice can still name.
  const offered = useMemo(() => activeTasks(items, areas).map((t) => t.id), [items, areas])
  // Each intention's tasks still in play, by intention.
  const under = useMemo(() => {
    const byIntention = new Map<string, string[]>()
    for (const taskId of offered) {
      const intentionId = taskIntentions[taskId]
      if (intentionId === undefined) continue
      const ids = byIntention.get(intentionId)
      if (ids) ids.push(taskId)
      else byIntention.set(intentionId, [taskId])
    }
    return byIntention
  }, [offered, taskIntentions])

  return {
    hydrated,
    items,
    areas,
    tree,
    offered,
    tasksUnder: (intentionId: string): string[] => under.get(intentionId) ?? [],
    group: (taskIds: readonly string[]) => groupTasks(taskIds, items, areas),
  }
}

/**
 * Saving a draft: the intention, then its tasks. Returns the intention's id,
 * or null when there was nothing to save.
 */
export function useSaveIntention({
  taskIntentions,
  onAdd,
  onUpdate,
  onLinkTask,
}: {
  taskIntentions: Readonly<Record<string, string>>
  onAdd: (input: Omit<Intention, 'id'>) => string
  onUpdate: (id: string, patch: IntentionPatch) => void
  onLinkTask: (taskId: string, intentionId: string | null) => void
}) {
  const { offered } = useIntentionBacklog(taskIntentions)
  return (draft: IntentionDraft): string | null => {
    const plan = planIntentionSave(draft, { offered, taskIntentions })
    if (plan === null) return null
    if (plan.kind === 'add') {
      const id = onAdd(plan.intention)
      for (const taskId of plan.link) onLinkTask(taskId, id)
      return id
    }
    onUpdate(plan.id, plan.patch)
    for (const taskId of plan.unlink) onLinkTask(taskId, null)
    for (const taskId of plan.link) onLinkTask(taskId, plan.id)
    return plan.id
  }
}

/**
 * The title, the tasks, and the tasks chosen so far shown under their places.
 * The enclosing form owns submitting; this owns what is typed and ticked.
 */
export function IntentionFields({
  draft,
  onDraft,
  intentions,
  taskIntentions,
  fieldRef,
  autoFocus = false,
  onEscape,
  large = false,
}: {
  draft: IntentionDraft
  onDraft: (draft: IntentionDraft) => void
  intentions: readonly Intention[]
  taskIntentions: Readonly<Record<string, string>>
  fieldRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
  /** Escape in the title field; nothing when absent. */
  onEscape?: () => void
  /** The stage's size of field rather than the tasks page's. */
  large?: boolean
}) {
  const backlog = useIntentionBacklog(taskIntentions)
  const addItem = useTasks((s) => s.addItem)
  const renameItem = useTasks((s) => s.renameItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  // The choice as it still stands: a task finished or deleted since it was
  // ticked leaves the choice with it.
  const chosen = draft.taskIds.filter((id) => backlog.offered.includes(id))

  return (
    <>
      <input
        ref={fieldRef}
        value={draft.title}
        onChange={(e) => onDraft({ ...draft, title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !onEscape) return
          e.preventDefault()
          onEscape()
        }}
        placeholder="Handle the billing ticket"
        aria-label={draft.editing ? 'This intention' : 'Next intention'}
        autoFocus={autoFocus}
        maxLength={120}
        className={`${fieldClass} ${large ? 'py-3 text-lg' : 'py-1.5 text-sm'}`}
      />

      {/* Its tasks, from anywhere in the backlog or written here and then.
          Where they live is shown by grouping them, which says both areas
          when they come from two, rather than by one place read from them. */}
      {backlog.hydrated && (
        <div className="mt-3 flex flex-col gap-2 text-xs">
          <TaskTreePicker
            label="Tasks for this intention"
            prefix="Choose tasks"
            tree={backlog.tree}
            selected={chosen}
            onChange={(taskIds) => onDraft({ ...draft, taskIds })}
            onAdd={(parentId, title) => addItem({ kind: 'task', title, parentId })}
            onRename={renameItem}
            onDelete={deleteItem}
            elsewhere={(taskId) => {
              const under = taskIntentions[taskId]
              if (under === undefined || under === draft.editing) return null
              return intentions.find((i) => i.id === under)?.title ?? null
            }}
          />
          {chosen.length > 0 && (
            <GroupedTasks
              label="Chosen tasks"
              groups={backlog.group(chosen)}
              renderTask={(task) => <span className="block truncate text-sm text-body">{task.title}</span>}
            />
          )}
        </div>
      )}
    </>
  )
}
