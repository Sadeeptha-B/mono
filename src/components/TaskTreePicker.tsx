/**
 * Choosing tasks from the whole backlog, drawn as the tree it is.
 *
 * Every open task in play, under its area, epic and outcome (`taskTree`), each
 * with a checkbox, and a `+ Task` beside every place that writes a new one
 * straight into it and ticks it. It is the one way tasks are chosen: for an
 * intention where one is written (`IntentionFields`), and on the purpose
 * prompt for each intention and for the block alone.
 *
 * Not a listbox. A listbox's options are single choices and cannot hold a
 * field, and this needs many choices and a field under any place. So it is a
 * panel of native checkboxes and small forms — each control accessible as
 * itself — behind a button that says what has been chosen.
 *
 * It opens over the stage, lined up under its button, rather than in the flow
 * of the page, which would push the rest of the question down for the length
 * of a choice; and upwards when the window has more room above it, since the
 * stage scrolls inside itself on a wide screen. It closes on Escape, on the
 * button again, on a finished click outside it, and when focus moves to
 * something outside it. That last is safe here, unlike for the add fields: the
 * panel floats, so closing it moves nothing under the pointer.
 *
 * A search at the head of the panel narrows the tree as it is typed: a task
 * stays when its title or a place above it matches, a place when it, a place
 * above it or anything beneath it does — so searching for an epic shows the
 * whole epic, and searching for a task shows the path down to it.
 *
 * A task found here can be put right without leaving: ✎ renames it in place
 * and × deletes it, as the tasks page's own row would. A new task's field and
 * a rename both carry a ✓ that keeps what is typed and a × that does not;
 * Enter in a new task's field keeps it and stays open for the next.
 *
 * The tree is drawn only while the panel is open, so a backlog of hundreds of
 * tasks costs nothing on a stage that re-renders every second.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { EditGlyph } from './ui'
import type { Item, TaskTreeNode } from '@/domain/tasks'

/** Room the panel wants below its button before it opens upwards instead. */
const PANEL_ROOM = 320

const LEVEL: Record<TaskTreeNode['kind'], string> = { area: 'Area', epic: 'Epic', outcome: 'Outcome' }

export function TaskTreePicker({
  label,
  prefix,
  tree,
  selected,
  onChange,
  onAdd,
  onRename,
  onDelete,
  elsewhere,
}: {
  /** What is being chosen, for the button and the panel alike. */
  label: string
  /** The word in front of the button. */
  prefix: string
  tree: readonly TaskTreeNode[]
  selected: readonly string[]
  onChange: (taskIds: string[]) => void
  /** Write a task under a place; its id, or null when the store refused it. */
  onAdd: (parentId: string, title: string) => string | null
  onRename: (taskId: string, title: string) => void
  onDelete: (taskId: string) => void
  /** Where else a task already belongs today, said beside it, or null. */
  elsewhere: (taskId: string) => string | null
}) {
  const [open, setOpen] = useState(false)
  const [upwards, setUpwards] = useState(false)
  /** The place a new task is being written into, if any, and what is typed. */
  const [adding, setAdding] = useState<{ parentId: string; title: string } | null>(null)
  /** The task being renamed, if any, and its title as typed. */
  const [renaming, setRenaming] = useState<{ taskId: string; title: string } | null>(null)
  const [query, setQuery] = useState('')
  const shown = narrow(tree, query.trim().toLowerCase())

  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const panelId = `${useId()}-tasks`

  // Titles by id, for the button's summary of what is chosen. Per tree, which
  // is per backlog snapshot, not per second.
  const titles = useMemo(() => {
    const found = new Map<string, string>()
    const walk = (node: TaskTreeNode) => {
      for (const task of node.tasks) found.set(task.id, task.title)
      node.children.forEach(walk)
    }
    tree.forEach(walk)
    return found
  }, [tree])
  const chosen = selected.flatMap((id) => titles.get(id) ?? [])
  const summary =
    chosen.length === 0
      ? 'None yet'
      : chosen.length === 1
        ? chosen[0]!
        : `${chosen[0]!} + ${chosen.length - 1} more`

  // Which way to open is decided as it opens, in the handler, so the panel
  // never paints facing one way and then jumps to the other.
  const openPanel = () => {
    const box = toggle.current?.getBoundingClientRect()
    const height = toggle.current?.ownerDocument.defaultView?.innerHeight
    if (box && height !== undefined) {
      const below = height - box.bottom
      setUpwards(below < PANEL_ROOM && box.top > below)
    }
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    setAdding(null)
    setRenaming(null)
    setQuery('')
    if (refocus) toggle.current?.focus()
  }

  // Close on a finished click anywhere outside. The document is the one the
  // picker was drawn into, which is not always the tab's own. Asked of the
  // path the click took rather than of where its target is now: a ✓ or a ×
  // inside the panel is gone from the page by the time the click reaches the
  // document, and a target no longer inside anything reads as outside.
  useEffect(() => {
    if (!open) return
    const doc = root.current?.ownerDocument
    if (!doc) return
    const onClick = (e: MouseEvent) => {
      if (root.current && !e.composedPath().includes(root.current)) {
        setOpen(false)
        setAdding(null)
        setRenaming(null)
        setQuery('')
      }
    }
    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [open])

  const toggleTask = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id])

  /** Keep the new task: Enter stays open for the next, ✓ closes the field. */
  const write = (then: 'next' | 'done') => {
    if (!adding) return
    if (adding.title.trim() !== '') {
      const id = onAdd(adding.parentId, adding.title)
      if (id === null) return
      onChange([...selected, id])
    }
    setAdding(then === 'next' ? { parentId: adding.parentId, title: '' } : null)
  }

  const rename = () => {
    if (!renaming) return
    if (renaming.title.trim() !== '') onRename(renaming.taskId, renaming.title)
    setRenaming(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // No field in here submits the form the picker sits in: Enter in a new
    // task's field writes the task, in a rename keeps it, and on a checkbox
    // does nothing. Buttons keep their Enter — they are not submit buttons.
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
  }

  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, level) => (
      <span key={level} aria-hidden="true" className="ml-1 w-2.5 shrink-0 self-stretch border-l border-line" />
    ))

  const branch = (node: TaskTreeNode, depth: number) => (
    <li key={node.id}>
      <div className="flex items-stretch gap-2 px-2.5">
        {guides(depth)}
        <span className="min-w-0 flex-1 truncate py-1.5 text-sm">
          <span className="text-muted">{LEVEL[node.kind]}: </span>
          <span className={depth === 0 ? 'font-medium text-bright' : 'text-body'}>{node.name}</span>
        </span>
        <button
          type="button"
          onClick={() => setAdding({ parentId: node.id, title: '' })}
          aria-label={`Add a task to ${node.name}`}
          className="shrink-0 self-center text-xs text-muted transition hover:text-bright"
        >
          + Task
        </button>
      </div>
      <ul>
        {adding?.parentId === node.id && (
          <li className="flex items-stretch gap-2 px-2.5 py-1">
            {guides(depth + 1)}
            <InlineField
              value={adding.title}
              onChange={(title) => setAdding({ parentId: node.id, title })}
              onEnter={() => write('next')}
              onKeep={() => write('done')}
              onCancel={() => setAdding(null)}
              placeholder="A new task"
              label={`New task in ${node.name}`}
              keepLabel={`Add the new task to ${node.name}`}
              cancelLabel={`Cancel the new task in ${node.name}`}
            />
          </li>
        )}
        {node.children.map((child) => branch(child, depth + 1))}
        {node.tasks.map((task) =>
          renaming?.taskId === task.id ? (
            <li key={task.id} className="flex items-stretch gap-2 px-2.5 py-1">
              {guides(depth + 1)}
              <InlineField
                value={renaming.title}
                onChange={(title) => setRenaming({ taskId: task.id, title })}
                onEnter={rename}
                onKeep={rename}
                onCancel={() => setRenaming(null)}
                placeholder={task.title}
                label={`Rename ${task.title}`}
                keepLabel={`Save the name of ${task.title}`}
                cancelLabel={`Keep the name of ${task.title}`}
              />
            </li>
          ) : (
            <TaskOption
              key={task.id}
              task={task}
              guides={guides(depth + 1)}
              checked={selected.includes(task.id)}
              onToggle={() => toggleTask(task.id)}
              onRename={() => setRenaming({ taskId: task.id, title: task.title })}
              onDelete={() => onDelete(task.id)}
              elsewhere={elsewhere(task.id)}
            />
          ),
        )}
      </ul>
    </li>
  )

  return (
    <div
      ref={root}
      className="min-w-0"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Focus moved somewhere outside — by Tab, or a press on another
        // control. A blur with nowhere to go is a click on nothing, which the
        // click handler above judges instead.
        const to = e.relatedTarget as Node | null
        if (open && to !== null && !e.currentTarget.contains(to)) close(false)
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-muted">
        <span className="shrink-0">{prefix}</span>
        <div className="relative min-w-0">
          <button
            ref={toggle}
            type="button"
            onClick={() => (open ? close(false) : openPanel())}
            aria-label={label}
            aria-expanded={open}
            {...(open ? { 'aria-controls': panelId } : {})}
            className="flex max-w-[18rem] min-w-0 items-center gap-1.5 rounded-md border border-muted/70 bg-ink px-1.5 py-0.5 text-body transition hover:text-bright focus:border-deep focus:outline-none"
          >
            <span className="min-w-0 truncate">{summary}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 10 6"
              width="8"
              height="5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 transition ${open ? 'rotate-180' : ''}`}
            >
              <path d="M1 1l4 4 4-4" />
            </svg>
          </button>

          {open && (
            <div
              id={panelId}
              role="group"
              aria-label={label}
              className={`mono-scroll absolute left-0 z-30 max-h-80 w-max max-w-[min(26rem,calc(100vw-2rem))] min-w-[16rem] overflow-y-auto rounded-lg border border-muted/70 bg-ink py-1.5 shadow-lg ${
                upwards ? 'bottom-full mb-1' : 'top-full mt-1'
              }`}
            >
              {tree.length > 0 && (
                <div className="relative px-2.5 pt-0.5 pb-1.5">
                  <SearchGlyph className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Escape clears a search before it closes the panel.
                      if (e.key !== 'Escape' || query === '') return
                      e.preventDefault()
                      e.stopPropagation()
                      setQuery('')
                    }}
                    placeholder="Find a task or place"
                    aria-label="Find a task"
                    className="w-full min-w-0 rounded-md border border-muted/70 bg-ink py-1 pr-2 pl-7 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
                  />
                </div>
              )}
              {tree.length === 0 ? (
                <p className="px-2.5 py-1.5 text-sm text-muted">No areas to choose from.</p>
              ) : shown.length === 0 ? (
                <p className="px-2.5 py-1.5 text-sm text-muted">Nothing open matches.</p>
              ) : (
                <ul>{shown.map((node) => branch(node, 0))}</ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A field written in place inside the panel — a new task, or a rename — with
 * a ✓ that keeps what is typed and a × that does not. Escape is the ×, and
 * puts this field away rather than the whole panel.
 */
function InlineField({
  value,
  onChange,
  onEnter,
  onKeep,
  onCancel,
  placeholder,
  label,
  keepLabel,
  cancelLabel,
}: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onKeep: () => void
  onCancel: () => void
  placeholder: string
  label: string
  keepLabel: string
  cancelLabel: string
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter()
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        // Opened by a click asking for exactly this field.
        autoFocus
        maxLength={120}
        className="min-w-0 flex-1 rounded-md border border-muted/70 bg-ink px-2 py-1 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
      />
      <button
        type="button"
        onClick={onKeep}
        aria-label={keepLabel}
        className="shrink-0 px-0.5 text-deep transition hover:text-bright"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={cancelLabel}
        className="shrink-0 px-0.5 text-muted transition hover:text-bright"
      >
        ×
      </button>
    </span>
  )
}

function TaskOption({
  task,
  guides,
  checked,
  onToggle,
  onRename,
  onDelete,
  elsewhere,
}: {
  task: Item
  guides: ReactNode
  checked: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  elsewhere: string | null
}) {
  return (
    <li className="flex items-stretch gap-2 px-2.5">
      {guides}
      <label className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-sm text-body hover:text-bright">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="translate-y-0.5 accent-[var(--color-deep)]"
        />
        <span className="min-w-0 truncate">{task.title}</span>
        {/* A task belongs to one intention a day; choosing it here moves it. */}
        {elsewhere !== null && (
          <span className="min-w-0 shrink-3 truncate text-xs text-muted">under {elsewhere}</span>
        )}
      </label>
      {/* Named "task" as well as by title: on the tasks page the backlog's own
          rows carry a Rename and a Delete for the same task. */}
      <button
        type="button"
        onClick={onRename}
        aria-label={`Edit task ${task.title}`}
        className="shrink-0 self-center px-0.5 text-muted transition hover:text-bright"
      >
        <EditGlyph />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete task ${task.title}`}
        className="shrink-0 self-center px-0.5 text-muted transition hover:text-commit"
      >
        ×
      </button>
    </li>
  )
}

/**
 * The tree as a search leaves it. Empty asks for nothing and gets the whole
 * tree back; otherwise a place whose name matches keeps everything beneath it.
 */
function narrow(tree: readonly TaskTreeNode[], needle: string): readonly TaskTreeNode[] {
  if (needle === '') return tree
  const matches = (text: string) => text.toLowerCase().includes(needle)
  const prune = (node: TaskTreeNode): TaskTreeNode | null => {
    if (matches(node.name)) return node
    const children = node.children.flatMap((child) => prune(child) ?? [])
    const tasks = node.tasks.filter((task) => matches(task.title))
    return children.length > 0 || tasks.length > 0 ? { ...node, children, tasks } : null
  }
  return tree.flatMap((node) => prune(node) ?? [])
}

function SearchGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  )
}
