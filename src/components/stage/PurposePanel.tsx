/**
 * "One thing" — asked in place, where the timer will be.
 *
 * This deliberately is not a dialog. Naming the block is part of the work, not
 * an interruption to it, and a modal would blank out the very timeline that
 * tells you what the rest of the day looks like.
 *
 * Two answers now, in order: which tasks this block is for, and what it is
 * for. They are different questions. Tasks are the backlog's — "login form",
 * "CSRF token" — and a block takes at least one, picked from today's
 * intentions, found elsewhere in the backlog, or written here and then. The
 * purpose is the block's own sentence about these forty-five minutes, and it
 * stays one sentence: it is what the blocked-site page shows you, and what the
 * timer carries all block.
 *
 * So the purpose starts as the tasks' titles and stops following them the
 * moment it is edited. The cursor is still put in front of you, because a list
 * of titles joined with commas is the least interesting thing this block could
 * be called and the prompt's whole job is to ask for something better. Nothing
 * stops you accepting it.
 *
 * Tasks from outside today's intentions are offered as readily as the ones
 * inside them. Something small from elsewhere is a perfectly good use of the
 * end of a block, and a picker that hid it would make the intentions a fence.
 * Writing a new task here can put it under an intention, or under none.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

import { fieldClass, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import {
  activeAreas,
  areaOf,
  defaultPurpose,
  openTasks,
  PURPOSE_MAX_LENGTH,
  type Area,
  type Item,
} from '@/domain/tasks'
import { useTasks } from '@/store/tasks'
import type { BlockKind, Intention } from '@/domain/types'

type Props = {
  blockKind: BlockKind
  afterReflection: boolean
  minutes: number
  reflectMinutes: number
  intentions: readonly Intention[]
  /** Which of today's intentions each task belongs to. */
  taskIntentions: Readonly<Record<string, string>>
  onLinkTask: (taskId: string, intentionId: string | null) => void
  onSubmit: (purpose: string, taskIds: string[]) => void
  onCannotDecide: () => void
  onCancel: () => void
}

/** How many tasks from elsewhere in the backlog to offer before asking for a filter. */
const OTHERS_SHOWN = 6

export function PurposePanel({
  blockKind,
  afterReflection,
  minutes,
  reflectMinutes,
  intentions,
  taskIntentions,
  onLinkTask,
  onSubmit,
  onCannotDecide,
  onCancel,
}: Props) {
  const hydrated = useTasks((s) => s.hydrated)
  const items = useTasks((s) => s.items)
  const areas = activeAreas(useTasks((s) => s.areas))
  const addTask = useTasks((s) => s.addTask)

  const [selected, setSelected] = useState<string[]>([])
  // `null` while the purpose is still following the tasks; text once edited.
  const [ownPurpose, setOwnPurpose] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newArea, setNewArea] = useState<string | null>(null)
  const [newIntention, setNewIntention] = useState<string | null | undefined>(undefined)
  const newTaskInput = useRef<HTMLInputElement>(null)

  const open = openTasks(items)
  const byId = new Map(items.map((i) => [i.id, i]))
  const chosen = selected.map((id) => byId.get(id)).filter((t): t is Item => t !== undefined)
  const purpose = ownPurpose ?? defaultPurpose(chosen.map((t) => t.title))
  const trimmed = purpose.trim()

  // Today's intentions with their open tasks, in the order the day named them.
  const groups = intentions.map((intention) => ({
    intention,
    tasks: open.filter((t) => taskIntentions[t.id] === intention.id),
  }))
  // Everything else that is open, plus anything already picked from it, so a
  // ticked task never disappears from under the hand that ticked it.
  const needle = filter.trim().toLowerCase()
  const others = open.filter((t) => taskIntentions[t.id] === undefined)
  const matching = others.filter((t) => needle === '' || t.title.toLowerCase().includes(needle))
  const shownOthers = [
    ...others.filter((t) => selected.includes(t.id) && !matching.slice(0, OTHERS_SHOWN).includes(t)),
    ...matching.slice(0, OTHERS_SHOWN),
  ]

  // The intention a new task lands in unless told otherwise: whichever one
  // every task already picked belongs to, if they agree, and none if they
  // do not — guessing between two would be filing the task for the user.
  const pickedIntentions = new Set(chosen.map((t) => taskIntentions[t.id] ?? null))
  const impliedIntention =
    pickedIntentions.size === 1 ? ([...pickedIntentions][0] ?? null) : null
  const intentionForNew = newIntention === undefined ? impliedIntention : newIntention
  // And the area: the first picked task's, then the intention's own area link,
  // then the first area there is.
  const linkedArea = intentions.find((i) => i.id === intentionForNew)?.link
  const areaForNew =
    newArea ??
    (chosen[0] ? areaOf(chosen[0].id, items, areas)?.id : undefined) ??
    (linkedArea?.kind === 'area' ? linkedArea.id : undefined) ??
    areas[0]?.id ??
    null

  // Focus on entry, and start from a blank prompt rather than the last block's
  // text. Runs once per mount: the panel unmounts when the phase moves on.
  //
  // Only if this document already has focus, which matters since the mini
  // window arrived. Starting a block from there mounts this panel in a tab
  // nobody is looking at, and focusing an element in an unfocused window can
  // raise that window — so an ungated call would drag the user back to the tab
  // they had just walked away from, mid-keystroke.
  //
  // Which field depends on what there is to pick. With nothing open under
  // today's intentions the first thing to do is write a task, so that is where
  // the cursor goes; otherwise it waits for a tick.
  useEffect(() => {
    if (!document.hasFocus()) return
    if (groups.every((g) => g.tasks.length === 0)) newTaskInput.current?.focus()
    // Mount only, by design — see above.
  }, [])

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    )

  const createTask = () => {
    if (areaForNew === null || newTitle.trim() === '') return
    const id = addTask({ title: newTitle, parentId: areaForNew })
    if (id === null) return
    if (intentionForNew !== null) onLinkTask(id, intentionForNew)
    setSelected((current) => [...current, id])
    setNewTitle('')
  }

  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed && selected.length > 0) onSubmit(trimmed, selected)
      }}
    >
      <StagePrompt
        eyebrow={`${minutes} minute ${blockKind === 'deep' ? 'deep' : 'short'} block`}
        title="One thing"
        detail={
          afterReflection
            ? 'Now that the day has a shape — which tasks is this block for?'
            : 'Which tasks is this block for, and what is it for?'
        }
      />

      {!hydrated ? (
        <p className="text-sm text-muted">Loading your tasks…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ intention, tasks }) => (
            <TaskGroup
              key={intention.id}
              label={intention.title}
              tasks={tasks}
              selected={selected}
              onToggle={toggle}
              empty="Nothing open under this one yet."
            />
          ))}

          {others.length > 0 && (
            <div>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a task from elsewhere"
                aria-label="Find a task"
                className={`${fieldClass} py-2 text-sm`}
              />
              <TaskGroup
                label="From the backlog"
                tasks={shownOthers}
                selected={selected}
                onToggle={toggle}
                empty="Nothing open matches."
                areaOf={(t) => areaOf(t.id, items, areas)?.name ?? null}
              />
            </div>
          )}

          <NewTask
            inputRef={newTaskInput}
            title={newTitle}
            onTitle={setNewTitle}
            areas={areas}
            area={areaForNew}
            onArea={setNewArea}
            intentions={intentions}
            intention={intentionForNew}
            onIntention={setNewIntention}
            onCreate={createTask}
          />
        </div>
      )}

      <input
        value={purpose}
        onChange={(e) => setOwnPurpose(e.target.value)}
        placeholder={selected.length > 0 ? 'What is this block for?' : 'Pick a task first'}
        aria-label="Purpose for this block"
        maxLength={PURPOSE_MAX_LENGTH}
        className={`${fieldClass} mt-5 py-3 text-lg`}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={!trimmed || selected.length === 0}>
          Start
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Not yet
        </GhostButton>
        <button
          type="button"
          onClick={onCannotDecide}
          className="ml-auto text-sm text-muted underline-offset-4 transition hover:text-body hover:underline"
        >
          I can't pick one
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Stuck? Take {reflectMinutes} minutes to work out what actually matters today. It
        gets recorded like any other block.
      </p>
    </form>
  )
}

function TaskGroup({
  label,
  tasks,
  selected,
  onToggle,
  empty,
  areaOf,
}: {
  label: string
  tasks: readonly Item[]
  selected: readonly string[]
  onToggle: (id: string) => void
  empty: string
  /** When given, each row names its area, for tasks gathered from all of them. */
  areaOf?: (task: Item) => string | null
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </legend>
      {tasks.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <label className="flex cursor-pointer items-baseline gap-2 text-sm text-body hover:text-bright">
                <input
                  type="checkbox"
                  checked={selected.includes(task.id)}
                  onChange={() => onToggle(task.id)}
                  className="translate-y-0.5 accent-[var(--color-deep)]"
                />
                <span className="min-w-0 truncate">{task.title}</span>
                {areaOf && <span className="shrink-0 text-xs text-muted">{areaOf(task)}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

/**
 * Writing a task down without leaving the question.
 *
 * Not a nested form — HTML has none — so Enter is caught here and turned into
 * Add, rather than reaching the outer form and starting a block whose task was
 * still being typed.
 */
function NewTask({
  inputRef,
  title,
  onTitle,
  areas,
  area,
  onArea,
  intentions,
  intention,
  onIntention,
  onCreate,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  title: string
  onTitle: (title: string) => void
  areas: readonly Area[]
  area: string | null
  onArea: (id: string) => void
  intentions: readonly Intention[]
  intention: string | null
  onIntention: (id: string | null) => void
  onCreate: () => void
}) {
  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            onCreate()
          }}
          placeholder="A new task"
          aria-label="New task"
          maxLength={PURPOSE_MAX_LENGTH}
          className={`${fieldClass} py-2 text-sm`}
        />
        <GhostButton
          type="button"
          onClick={onCreate}
          disabled={title.trim() === '' || area === null}
          className="shrink-0"
        >
          Add task
        </GhostButton>
      </div>

      {title.trim() !== '' && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Chips
            label="In"
            options={areas.map((a) => ({ id: a.id, name: a.name }))}
            value={area}
            onChange={(id) => id !== null && onArea(id)}
          />
          {intentions.length > 0 && (
            <Chips
              label="For"
              options={intentions.map((i) => ({ id: i.id, name: i.title }))}
              value={intention}
              // Choosing the chosen one again is how you say "no intention".
              onChange={onIntention}
              allowNone
            />
          )}
        </div>
      )}
    </div>
  )
}

function Chips({
  label,
  options,
  value,
  onChange,
  allowNone = false,
}: {
  label: string
  options: readonly { id: string; name: string }[]
  value: string | null
  onChange: (id: string | null) => void
  allowNone?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="w-6 text-xs text-muted">{label}</span>
      {options.map((option) => {
        const on = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on && allowNone ? null : option.id)}
            className={[
              'max-w-[12rem] truncate rounded-lg border px-2.5 py-1 text-xs transition',
              on
                ? 'border-deep bg-deep/15 text-deep'
                : 'border-muted/70 text-body hover:bg-surface-raised hover:text-bright',
            ].join(' ')}
          >
            {option.name}
          </button>
        )
      })}
    </div>
  )
}
