/**
 * The backlog drawn as the tree it is, in place on the page, for choosing
 * tasks from: what today is for on the opening question, and what a block is
 * for on the purpose prompt, where it sits behind a fold.
 *
 * Every open task in play, under its area, epic and outcome (`taskTree`), each
 * with a checkbox, and a `+ Task` beside every place that writes a new one
 * straight into it and ticks it. What a tick means is the caller's: chosen for
 * today, or ticked for this block.
 *
 * In the flow of the page rather than floating over it. It replaced a
 * dropdown, which had to be placed against its button, flipped upwards when
 * there was more room above, kept on a phone's screen as the button changed
 * width, and closed on a click outside or on focus leaving — most of a file
 * spent on being a dropdown. Choosing today's tasks is the question itself
 * rather than an aside to it, so it is drawn where the answer is given, as a
 * box of a fixed height that scrolls inside itself, the search held at its
 * head. That box is a scroller inside a page that also scrolls, which the
 * layout otherwise avoids; it is bounded because a backlog is unbounded, and a
 * tree of every task flowing into the stage would push everything after it out
 * of reach. Overscroll is left to carry on to the page, so a thumb that reaches
 * the end of the tree keeps scrolling the page rather than stopping dead.
 *
 * Not a listbox. A listbox's options are single choices and cannot hold a
 * field, and this needs many choices and a field under any place. So it is a
 * group of native checkboxes and small forms, each control accessible as
 * itself.
 *
 * Drawn always rather than while a panel is open, on stages that render every
 * second, so it is memoised: callers pass a tree kept per backlog snapshot, a
 * selection kept per change, and handlers that do not change with the clock,
 * and a tick passes it by.
 *
 * A search narrows the tree as it is typed: a task stays when its title or a
 * place above it matches, a place when it, a place above it or anything beneath
 * it does — so searching for an epic shows the whole epic, and searching for a
 * task shows the path down to it. Escape in the search clears it.
 *
 * A task found here can be put right without leaving: ✓ marks it done, ✎
 * renames it in place and × deletes it, as the tasks page's own row would, and
 * one finished today can be reopened from its crossed-out row. The backlog is
 * all on screen here, so it can be kept here, without a trip to the tasks
 * page in the middle of choosing. A new task's field and
 * a rename both carry a ✓ that keeps what is typed and a × that does not;
 * Enter in a new task's field keeps it and stays open for the next. Enter in
 * any field here never submits the form the browser sits in.
 *
 * Those two fields are editors, and they keep the rule every editor in Mono
 * keeps: one whose subject vanishes closes, before paint. A rename lasts only
 * while its task is drawn and a new task's field only while its place is,
 * whether a search hid it or an update from another tab took it. The fields
 * are held up here by id, above the rows they edit, so without the rule the
 * state outlived the row, and when the task came back — its epic reopened, the
 * search cleared — the old editor came back with it.
 *
 * A field is focused by the press that opens it, never by mounting. The two
 * used to be the same thing, and then every other reason a field mounts took
 * focus too: the editor coming back with its task, or a task moved by another
 * tab from one place to another, whose rename unmounts under the old place and
 * mounts under the new, draft and all. So `+ Task` and ✎ ask for their field
 * by key, and it is focused after the render that draws it; a field drawn for
 * any other reason is drawn and left alone.
 *
 * Controls leave while focus is in them: a field closed by ✓, × or Escape, a
 * row whose × deleted it, or anything another tab deletes, finishes, closes or
 * moves. When the one with focus goes, focus falls to the page, and a keyboard
 * is left at the top of the document. So the browser remembers the control
 * that last had focus, and once that control has left the page with focus
 * lost, focus goes to the first of these still drawn: the same control drawn
 * again (a rename its task moved), what opened it (a field's `+ Task` or ✎),
 * the place its row is in, the search. Only when focus was lost: if it already
 * moved somewhere on purpose, it stays there. A control's own key is
 * `data-focus-key`; a field names its opener in `data-focus-back`, and a
 * place's list in `data-home`.
 *
 * Names wrap rather than being cut short: a task is chosen by what it says,
 * and two tasks that begin the same way were indistinguishable once truncated.
 *
 * The tasks finished today are drawn too, after the open ones of their place
 * and crossed out, when the caller passes a tree that holds them
 * (`taskTreeWithDone`). They are not choices: no checkbox, no ✎ or ×, only the
 * button that reopens them, and a search finds them only to show they are
 * done. What is left of an outcome reads differently beside what has already
 * gone. Marking one done or reopening it swaps one row for the other, so the
 * two buttons share a focus key and the keyboard stays on the task.
 *
 * Where today's list sits beside it, its open rows can be dragged into that
 * list's intentions (`draggable`, and the `Carry` the caller provides). Only
 * by pointer: the keyboard's way is to tick the task, which puts it in today,
 * and pick it up there with its grip. The browser draws no grip of its own,
 * because a second set of them on every row of the backlog would double the
 * stops a keyboard makes through it for a move it can already make.
 */

import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { useCarriedRow } from './carry'
import { CheckIcon, ReopenIcon } from './icons'
import { EditGlyph } from './ui'
import type { Item, TaskTreeNode } from '@/domain/tasks'

const LEVEL: Record<TaskTreeNode['kind'], string> = { area: 'Area', epic: 'Epic', outcome: 'Outcome' }

/**
 * A row's action button: a fixed column, level with the first line of a title
 * that wraps, so the ✓, ✎ and × of one row line up with the next.
 */
const ACTION =
  'mt-1.5 inline-flex w-5 shrink-0 justify-center self-start text-muted transition'

export const TaskBrowser = memo(function TaskBrowser({
  label,
  tree,
  selected,
  onToggle,
  onAdd,
  onRename,
  onDelete,
  onComplete,
  onReopen,
  elsewhere,
  draggable = false,
}: {
  /** What is being chosen, as the group's accessible name. */
  label: string
  /** The places and their tasks; a task whose status is `done` is drawn as done. */
  tree: readonly TaskTreeNode[]
  selected: readonly string[]
  onToggle: (taskId: string, on: boolean) => void
  /**
   * Write a task under a place; its id, or null when the store refused it.
   * A task written here is ticked as well.
   */
  onAdd: (parentId: string, title: string) => string | null
  onRename: (taskId: string, title: string) => void
  onDelete: (taskId: string) => void
  /** Mark a task done, and reopen one finished today. */
  onComplete: (taskId: string) => void
  onReopen: (taskId: string) => void
  /** Where else a task already belongs today, said beside it, or null. */
  elsewhere: (taskId: string) => string | null
  /** Whether open rows can be dragged to the `Carry` the caller provides. */
  draggable?: boolean
}) {
  /** The place a new task is being written into, if any, and what is typed. */
  const [adding, setAdding] = useState<{ parentId: string; title: string } | null>(null)
  /** The task being renamed, if any, and its title as typed. */
  const [renaming, setRenaming] = useState<{ taskId: string; title: string } | null>(null)
  const [query, setQuery] = useState('')
  const shown = narrow(tree, query.trim().toLowerCase())
  // An editor whose subject is no longer drawn closes — see the header.
  // Adjusted during render, so the stale editor is never painted and never
  // mounts again on its own.
  if (renaming && !drawsTask(shown, renaming.taskId)) setRenaming(null)
  if (adding && !drawsPlace(shown, adding.parentId)) setAdding(null)

  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  /**
   * The control that last had focus, and the keys of where focus goes if it is
   * taken away, in order — see the header.
   */
  const lastFocus = useRef<{ control: Element; to: (string | null)[] } | null>(null)
  /** The field a press has just opened, to be focused once it is drawn. */
  const focusField = useRef<string | null>(null)

  // After every render: a field a press has just opened is focused; otherwise,
  // once the control that last had focus has left the page and focus went
  // with it, focus is handed back. Not before it has gone, since the render
  // that takes it may not be this one.
  useEffect(() => {
    const doc = root.current?.ownerDocument
    if (!doc) return
    const keyed = (key: string | null) =>
      key ? root.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null

    const wanted = focusField.current
    if (wanted) {
      focusField.current = null
      keyed(wanted)?.focus()
      return
    }

    const last = lastFocus.current
    if (!last || last.control.isConnected) return
    lastFocus.current = null
    const active = doc.activeElement
    if (active !== null && active !== doc.body) return
    const named = last.to.map(keyed).find((el) => el)
    ;(named ?? search.current)?.focus()
  })

  /** Keep the new task: Enter stays open for the next, ✓ closes the field. */
  const write = (then: 'next' | 'done') => {
    if (!adding) return
    if (adding.title.trim() !== '') {
      const id = onAdd(adding.parentId, adding.title)
      if (id === null) return
      onToggle(id, true)
    }
    setAdding(then === 'next' ? { parentId: adding.parentId, title: '' } : null)
  }

  const rename = () => {
    if (!renaming) return
    if (renaming.title.trim() !== '') onRename(renaming.taskId, renaming.title)
    setRenaming(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // No field in here submits the form the browser sits in: Enter in a new
    // task's field writes the task, in a rename keeps it, and on a checkbox
    // does nothing. Buttons keep their Enter — they are not submit buttons.
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
  }

  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, level) => (
      <span key={level} aria-hidden="true" className="ml-1 w-2.5 shrink-0 self-stretch border-l border-line" />
    ))

  const branch = (node: TaskTreeNode, depth: number) => (
    <li key={node.id}>
      <div className="flex items-stretch gap-2 px-2.5">
        {guides(depth)}
        <span className="min-w-0 flex-1 py-1.5 text-sm wrap-break-word">
          <span className="text-muted">{LEVEL[node.kind]}: </span>
          <span className={depth === 0 ? 'font-medium text-bright' : 'text-body'}>{node.name}</span>
        </span>
        {/* Level with the first line of a name that wraps. */}
        <button
          type="button"
          onClick={() => {
            focusField.current = `add:${node.id}`
            setAdding({ parentId: node.id, title: '' })
          }}
          aria-label={`Add a task to ${node.name}`}
          data-focus-key={`place:${node.id}`}
          className="mt-2 shrink-0 self-start text-xs text-muted transition hover:text-bright"
        >
          + Task
        </button>
      </div>
      {/* Every row and field in here belongs to this place: where focus goes
          if one of them is taken away from under it. */}
      <ul data-home={`place:${node.id}`}>
        {adding?.parentId === node.id && (
          <li className="flex items-stretch gap-2 px-2.5 py-1">
            {guides(depth + 1)}
            <InlineField
              value={adding.title}
              onChange={(title) => setAdding({ parentId: node.id, title })}
              onEnter={() => write('next')}
              onKeep={() => write('done')}
              onCancel={() => setAdding(null)}
              focusKey={`add:${node.id}`}
              focusBack={`place:${node.id}`}
              placeholder="A new task"
              label={`New task in ${node.name}`}
              keepLabel={`Add the new task to ${node.name}`}
              cancelLabel={`Cancel the new task in ${node.name}`}
            />
          </li>
        )}
        {node.children.map((child) => branch(child, depth + 1))}
        {node.tasks.map((task) =>
          task.status === 'done' ? (
            <DoneOption
              key={task.id}
              task={task}
              guides={guides(depth + 1)}
              onReopen={() => onReopen(task.id)}
            />
          ) : renaming?.taskId === task.id ? (
            <li key={task.id} className="flex items-stretch gap-2 px-2.5 py-1">
              {guides(depth + 1)}
              <InlineField
                value={renaming.title}
                onChange={(title) => setRenaming({ taskId: task.id, title })}
                onEnter={rename}
                onKeep={rename}
                onCancel={() => setRenaming(null)}
                focusKey={`rename:${task.id}`}
                focusBack={`edit:${task.id}`}
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
              onToggle={() => onToggle(task.id, !selected.includes(task.id))}
              onRename={() => {
                focusField.current = `rename:${task.id}`
                setRenaming({ taskId: task.id, title: task.title })
              }}
              onDelete={() => onDelete(task.id)}
              onComplete={() => onComplete(task.id)}
              elsewhere={elsewhere(task.id)}
              draggable={draggable}
            />
          ),
        )}
      </ul>
    </li>
  )

  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const near = (name: string) => e.target.closest(`[${name}]`)?.getAttribute(name) ?? null
        lastFocus.current = {
          control: e.target,
          to: [e.target.getAttribute('data-focus-key'), near('data-focus-back'), near('data-home')],
        }
      }}
      className="mono-scroll max-h-80 min-w-0 overflow-y-auto rounded-lg border border-line bg-ink pb-1.5"
    >
      {/* Held at the head of the box while the tree scrolls under it. */}
      {tree.length > 0 && (
        <div className="sticky top-0 z-10 bg-ink px-2.5 pt-2 pb-1.5">
          <SearchGlyph className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || query === '') return
              e.preventDefault()
              e.stopPropagation()
              setQuery('')
            }}
            placeholder="Find a task or place"
            aria-label={`Find a task in ${label}`}
            className="w-full min-w-0 rounded-md border border-muted/70 bg-ink py-1 pr-2 pl-7 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
          />
        </div>
      )}
      {tree.length === 0 ? (
        <p className="px-2.5 pt-3 pb-1.5 text-sm text-muted">No areas to choose from.</p>
      ) : shown.length === 0 ? (
        <p className="px-2.5 py-1.5 text-sm text-muted">Nothing open matches.</p>
      ) : (
        <ul>{shown.map((node) => branch(node, 0))}</ul>
      )}
    </div>
  )
})

/**
 * A field written in place — a new task, or a rename — with a ✓ that keeps
 * what is typed and a × that does not. Escape is the ×.
 */
function InlineField({
  value,
  onChange,
  onEnter,
  onKeep,
  onCancel,
  focusKey,
  focusBack,
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
  /** Who it is, for the press that opens it and for focus coming back to it. */
  focusKey: string
  /** What opened it, where focus goes when it closes with focus in it. */
  focusBack: string
  placeholder: string
  label: string
  keepLabel: string
  cancelLabel: string
}) {
  return (
    <span data-focus-back={focusBack} className="flex min-w-0 flex-1 items-center gap-1.5">
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
        // Focused by the press that opened it, not here: see the header for
        // what focusing on mount did.
        data-focus-key={focusKey}
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
  onComplete,
  elsewhere,
  draggable,
}: {
  task: Item
  guides: ReactNode
  checked: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  onComplete: () => void
  elsewhere: string | null
  draggable: boolean
}) {
  const { dragProps } = useCarriedRow(task, draggable)
  return (
    <li
      {...(draggable ? dragProps : {})}
      className={`flex items-stretch gap-2 px-2.5 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {guides}
      <label className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-sm text-body hover:text-bright">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          // No margins of its own: the tick on a done row is this wide, and
          // a browser's default margins put the two titles out of line.
          className="m-0 size-[13px] shrink-0 translate-y-0.5 accent-[var(--color-deep)]"
        />
        <span className="min-w-0 wrap-break-word">
          {task.title}
          {/* A task belongs to one intention a day; the caller says which. */}
          {elsewhere !== null && (
            <span className="ml-1.5 text-xs text-muted">under {elsewhere}</span>
          )}
        </span>
      </label>
      {/* Named "task" as well as by title: on the tasks page the backlog's own
          rows carry a Rename and a Delete for the same task. Level with the
          first line of a title that wraps. */}
      <button
        type="button"
        onClick={onComplete}
        aria-label={`Mark task ${task.title} done`}
        title="Mark done"
        data-focus-key={`state:${task.id}`}
        className={`${ACTION} hover:text-deep`}
      >
        <CheckIcon className="w-[13px]" />
      </button>
      <button
        type="button"
        onClick={onRename}
        aria-label={`Edit task ${task.title}`}
        data-focus-key={`edit:${task.id}`}
        className={`${ACTION} hover:text-bright`}
      >
        <EditGlyph />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete task ${task.title}`}
        className={`${ACTION} hover:text-commit`}
      >
        ×
      </button>
    </li>
  )
}

/**
 * A task finished today: crossed out where it lives, after what is still open
 * there, with a tick where an open task's checkbox would be so the titles line
 * up. Not a choice; the one thing it offers is to be reopened — see the header.
 */
function DoneOption({
  task,
  guides,
  onReopen,
}: {
  task: Item
  guides: ReactNode
  onReopen: () => void
}) {
  return (
    <li className="flex items-stretch gap-2 px-2.5">
      {guides}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-sm text-muted">
        <span className="inline-flex size-[13px] shrink-0 translate-y-0.5 items-center justify-center">
          <CheckIcon className="w-[13px] text-deep/80" />
        </span>
        <span className="min-w-0 wrap-break-word line-through">{task.title}</span>
        <span className="sr-only">, done today</span>
      </span>
      <button
        type="button"
        onClick={onReopen}
        aria-label={`Reopen task ${task.title}`}
        title="Reopen"
        data-focus-key={`state:${task.id}`}
        className={`${ACTION} hover:text-bright`}
      >
        <ReopenIcon className="w-[13px]" />
      </button>
      {/* Where the open row's ✎ and × are, so the reopen sits under its ✓. */}
      <span aria-hidden="true" className="w-5 shrink-0" />
      <span aria-hidden="true" className="w-5 shrink-0" />
    </li>
  )
}

/** Whether this tree, as drawn, has a row for the task. */
const drawsTask = (nodes: readonly TaskTreeNode[], taskId: string): boolean =>
  nodes.some((node) => node.tasks.some((t) => t.id === taskId) || drawsTask(node.children, taskId))

/** Whether this tree, as drawn, has the place. */
const drawsPlace = (nodes: readonly TaskTreeNode[], placeId: string): boolean =>
  nodes.some((node) => node.id === placeId || drawsPlace(node.children, placeId))

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
