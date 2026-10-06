/**
 * The backlog drawn as the tree it is, for choosing tasks from: what today is
 * for on the opening question, and what a block is for on the purpose prompt.
 * It is drawn in the calendar's column as All Tasks (`AllTasksPane`), which
 * trades places with the day while one of those two questions is open.
 *
 * Every open task in play, under its area, epic and outcome (`taskTree`), each
 * with a checkbox; a place's `⋯` offers `+ Task`, which writes a new one
 * straight into it and ticks it. What a tick means is the caller's: chosen for
 * today, or ticked for this block.
 *
 * It replaced a dropdown, which had to be placed against its button, flipped
 * upwards when there was more room above, kept on a phone's screen as the
 * button changed width, and closed on a click outside or on focus leaving —
 * most of a file spent on being a dropdown. In the column it is as long as the
 * backlog and scrolls with the column, its search held at the head of it, and
 * the stage keeps only the answer.
 *
 * Every row's actions are asked for the same way: a `⋯` at its end, shown on
 * hover or with focus in the row (always, on a touch screen), opens them as a
 * small popup under it (`MENU`) — for a place `+ Task`, `+ Outcome` or
 * `+ Epic`, then rename, done, archive and delete; for a task done, rename and
 * delete; for one finished today, reopen. One row at a time, closed by a press
 * outside it, by Escape, or by using it. The icons are the tasks page's, so the
 * two read alike. Floating, the popup takes no room: at rest the column is a
 * tree with checkboxes, and a name gives up only the `⋯`'s width, which three
 * icons beside every task could not have left it in a column this narrow.
 *
 * Done and archive put a place away with everything in it, as the tasks page
 * does, and are undone there. Delete asks first, in the popup, when there is
 * more than the place to lose, and an area cannot be deleted from here at all:
 * it is the one action that takes a whole part of a life at once, and it stays
 * on the tasks page.
 *
 * Not a listbox. A listbox's options are single choices and cannot hold a
 * field, and this needs many choices and a field under any place. So it is a
 * group of native checkboxes and small forms, each control accessible as
 * itself.
 *
 * Drawn always rather than while a panel is open, in an app that renders every
 * second, so it is memoised: callers pass a tree kept per backlog snapshot, a
 * selection kept per change, and handlers that do not change with the clock,
 * and a tick passes it by.
 *
 * A search narrows the tree as it is typed: a task stays when its title or a
 * place above it matches, a place when it, a place above it or anything beneath
 * it does — so searching for an epic shows the whole epic, and searching for a
 * task shows the path down to it. Escape in the search clears it.
 *
 * A task found here can be put right without leaving: its `⋯` marks it done,
 * renames it in place or deletes it, as the tasks page's own row would, and
 * one finished today can be reopened from its crossed-out row. The backlog is
 * all on screen here, so it can be kept here, without a trip to the tasks
 * page in the middle of choosing. A new task's field and a rename both carry a
 * ✓ that keeps what is typed and a × that does not (`KeepField`); Enter in a
 * new task's field keeps it and stays open for the next. Enter in any field
 * here never submits the form the browser sits in.
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
 * again (a rename its task moved), what opened it (the `⋯` of the row a popup
 * or a field belongs to), the `⋯` of the place its row is in, the search. Only
 * when focus was lost: if it already moved somewhere on purpose, it stays
 * there. A control's own key is `data-focus-key`; a field names its opener in
 * `data-focus-back`, and a place's list in `data-home`.
 *
 * Names wrap rather than being cut short: a task is chosen by what it says,
 * and two tasks that begin the same way were indistinguishable once truncated.
 *
 * The tasks finished today are drawn too, after the open ones of their place
 * and crossed out, when the caller passes a tree that holds them
 * (`taskTreeWithDone`). They are not choices: no checkbox, and only reopen in
 * their `⋯`, and a search finds them only to show they are done. What is left
 * of an outcome reads differently beside what has already gone. Marking one
 * done or reopening it swaps one row for the other, so the two rows' `⋯` share
 * a focus key and the keyboard stays on the task.
 *
 * Where today's list sits beside it, its open rows can be dragged into that
 * list's intentions (`draggable`, and the `Carry` the caller provides). Only
 * by pointer: the keyboard's way is to tick the task, which puts it in today,
 * and pick it up there with its grip. The browser draws no grip of its own,
 * because a second set of them on every row of the backlog would double the
 * stops a keyboard makes through it for a move it can already make.
 */

import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { useCarriedRow } from './carry'
import { ArchiveIcon, CheckIcon, DeleteIcon, ReopenIcon } from './icons'
import { EditGlyph, IconButton, KeepField, revealOnHover } from './ui'
import type { Item, ItemKind, TaskTreeNode } from '@/domain/tasks'

const LEVEL: Record<TaskTreeNode['kind'], string> = { area: 'Area', epic: 'Epic', outcome: 'Outcome' }

/**
 * What can be done to a place — an area, epic or outcome — from its `⋯`.
 * Handed in rather than read from the store here, so the browser stays a
 * drawing of the tree it is given.
 */
export type PlaceActions = {
  rename: (node: TaskTreeNode, name: string) => void
  /** Write an epic under an area or an outcome under an epic; its id, or null when refused. */
  add: (parentId: string, kind: 'epic' | 'outcome', title: string) => string | null
  complete: (node: TaskTreeNode) => void
  archive: (node: TaskTreeNode) => void
  remove: (node: TaskTreeNode) => void
  /** How many live items would go with it if it were deleted. */
  inside: (node: TaskTreeNode) => number
}

/** What a place's `+` writes under it. */
const CHILD: Partial<Record<TaskTreeNode['kind'], 'epic' | 'outcome'>> = {
  area: 'epic',
  epic: 'outcome',
}

/** A row's popup, opened from its `⋯`: under the row, over the rows below. */
const MENU =
  'absolute top-full right-1.5 z-20 -mt-0.5 flex items-center gap-0.5 rounded-md border border-line bg-surface-raised px-0.5 py-0.5 shadow-lg'

/** A word in a place's toolbar, beside its icons. */
const WORD = 'px-1.5 text-xs whitespace-nowrap text-muted transition hover:text-bright'

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
  places,
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
  /** What a place's `⋯` can do; stable across the clock's tick. */
  places: PlaceActions
  /** Where else a task already belongs today, said beside it, or null. */
  elsewhere: (taskId: string) => string | null
  /** Whether open rows can be dragged to the `Carry` the caller provides. */
  draggable?: boolean
}) {
  /** The place something new is being written into, if any: what, and what is typed. */
  const [adding, setAdding] = useState<{
    parentId: string
    kind: ItemKind
    title: string
  } | null>(null)
  /** The place being renamed, if any, and its name as typed. */
  const [renamingPlace, setRenamingPlace] = useState<{ id: string; name: string } | null>(null)
  /** The place or task whose `⋯` is open, if any — one at a time. */
  const [menu, setMenu] = useState<string | null>(null)
  /** The place whose delete is asking first, if any. */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The task being renamed, if any, and its title as typed. */
  const [renaming, setRenaming] = useState<{ taskId: string; title: string } | null>(null)
  const [query, setQuery] = useState('')
  const shown = narrow(tree, query.trim().toLowerCase())
  // An editor whose subject is no longer drawn closes — see the header.
  // Adjusted during render, so the stale editor is never painted and never
  // mounts again on its own.
  if (renaming && !drawsTask(shown, renaming.taskId)) setRenaming(null)
  if (adding && !drawsPlace(shown, adding.parentId)) setAdding(null)
  if (renamingPlace && !drawsPlace(shown, renamingPlace.id)) setRenamingPlace(null)
  if (confirming !== null && !drawsPlace(shown, confirming)) setConfirming(null)
  if (menu !== null && !drawsPlace(shown, menu) && !drawsTask(shown, menu)) setMenu(null)

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

  /**
   * Keep what is written: Enter stays open for the next, ✓ closes the field. A
   * task is ticked as it is written; an epic or outcome is only a place.
   */
  const write = (then: 'next' | 'done') => {
    if (!adding) return
    if (adding.title.trim() !== '') {
      if (adding.kind === 'task') {
        const id = onAdd(adding.parentId, adding.title)
        if (id === null) return
        onToggle(id, true)
      } else if (places.add(adding.parentId, adding.kind, adding.title) === null) {
        return
      }
    }
    setAdding(then === 'next' ? { ...adding, title: '' } : null)
  }

  /** Close a row's `⋯`, and whatever it had asking. */
  const closeMenu = () => {
    setMenu(null)
    setConfirming(null)
  }
  const toggleMenu = (id: string) => {
    if (menu === id) return closeMenu()
    setMenu(id)
    setConfirming(null)
  }

  // A press anywhere outside the open popup and its `⋯` closes it. Asked of
  // the path the press took rather than of where its target is now: a button
  // inside the popup is gone from the page by the time the press reaches the
  // document, and a target no longer inside anything reads as outside.
  const openMenu = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (menu === null) return
    const doc = root.current?.ownerDocument
    if (!doc) return
    const onClick = (e: MouseEvent) => {
      if (openMenu.current && !e.composedPath().includes(openMenu.current)) {
        setMenu(null)
        setConfirming(null)
      }
    }
    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [menu])

  const renamePlace = (node: TaskTreeNode) => {
    if (!renamingPlace) return
    if (renamingPlace.name.trim() !== '') places.rename(node, renamingPlace.name)
    setRenamingPlace(null)
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
    // Escape closes an open `⋯` wherever focus is in the browser, and hands
    // focus back to it. Fields keep their own Escape, and stop it before it
    // gets here.
    if (e.key === 'Escape' && menu !== null) {
      e.preventDefault()
      focusField.current = `menu:${menu}`
      closeMenu()
    }
  }

  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, level) => (
      <span key={level} aria-hidden="true" className="ml-1 w-2.5 shrink-0 self-stretch border-l border-line" />
    ))

  const branch = (node: TaskTreeNode, depth: number) => {
    const child = CHILD[node.kind]
    const asking = confirming === node.id
    const open = menu === node.id
    return (
      <li key={node.id}>
        <div className="group/row relative flex items-stretch gap-2 px-2.5">
          {guides(depth)}
          {renamingPlace?.id === node.id ? (
            <span className="flex min-w-0 flex-1 py-1">
              <InlineField
                value={renamingPlace.name}
                onChange={(name) => setRenamingPlace({ id: node.id, name })}
                onEnter={() => renamePlace(node)}
                onKeep={() => renamePlace(node)}
                onCancel={() => setRenamingPlace(null)}
                focusKey={`rename-place:${node.id}`}
                focusBack={`menu:${node.id}`}
                placeholder={node.name}
                label={`Rename ${LEVEL[node.kind].toLowerCase()} ${node.name}`}
                keepLabel={`Save the name of ${node.name}`}
                cancelLabel={`Keep the name of ${node.name}`}
              />
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1 py-1.5 text-sm wrap-break-word">
                <span className="text-muted">{LEVEL[node.kind]}: </span>
                <span className={depth === 0 ? 'font-medium text-bright' : 'text-body'}>
                  {node.name}
                </span>
              </span>
              <More
                id={node.id}
                label={`More for ${node.name}`}
                open={open}
                onToggle={() => toggleMenu(node.id)}
                menuRef={openMenu}
                className="mt-1"
              >
                <PlaceTools
                  node={node}
                  child={child}
                  asking={asking}
                  inside={asking ? places.inside(node) : 0}
                  onAdd={(kind) => {
                    focusField.current = `add:${node.id}`
                    setAdding({ parentId: node.id, kind, title: '' })
                    closeMenu()
                  }}
                  onRename={() => {
                    focusField.current = `rename-place:${node.id}`
                    setRenamingPlace({ id: node.id, name: node.name })
                    closeMenu()
                  }}
                  onComplete={() => {
                    places.complete(node)
                    closeMenu()
                  }}
                  onArchive={() => {
                    places.archive(node)
                    closeMenu()
                  }}
                  onDelete={() => {
                    if (asking || places.inside(node) === 0) {
                      places.remove(node)
                      closeMenu()
                    } else {
                      setConfirming(node.id)
                    }
                  }}
                  onKeep={() => setConfirming(null)}
                />
              </More>
            </>
          )}
        </div>
        {/* Every row and field in here belongs to this place: where focus goes
            if one of them is taken away from under it. */}
        <ul data-home={`menu:${node.id}`}>
          {adding?.parentId === node.id && (
            <li className="flex items-stretch gap-2 px-2.5 py-1">
              {guides(depth + 1)}
              <InlineField
                value={adding.title}
                onChange={(title) => setAdding({ ...adding, title })}
                onEnter={() => write('next')}
                onKeep={() => write('done')}
                onCancel={() => setAdding(null)}
                focusKey={`add:${node.id}`}
                focusBack={`menu:${node.id}`}
                placeholder={`A new ${adding.kind}`}
                label={`New ${adding.kind} in ${node.name}`}
                keepLabel={`Add the new ${adding.kind} to ${node.name}`}
                cancelLabel={`Cancel the new ${adding.kind} in ${node.name}`}
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
                menu={menu === task.id}
                onMenu={() => toggleMenu(task.id)}
                menuRef={openMenu}
                onReopen={() => {
                  onReopen(task.id)
                  closeMenu()
                }}
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
                  focusBack={`menu:${task.id}`}
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
                menu={menu === task.id}
                onMenu={() => toggleMenu(task.id)}
                menuRef={openMenu}
                onRename={() => {
                  focusField.current = `rename:${task.id}`
                  setRenaming({ taskId: task.id, title: task.title })
                  closeMenu()
                }}
                onDelete={() => {
                  onDelete(task.id)
                  closeMenu()
                }}
                onComplete={() => {
                  onComplete(task.id)
                  closeMenu()
                }}
                elsewhere={elsewhere(task.id)}
                draggable={draggable}
              />
            ),
          )}
        </ul>
      </li>
    )
  }

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
      className="min-w-0 pb-1.5"
    >
      {/* Held at the head of the column while the tree scrolls under it, on
          the column's own background. */}
      {tree.length > 0 && (
        <div className="sticky top-0 z-10 bg-surface px-2.5 pt-2 pb-1.5">
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
            className="w-full min-w-0 rounded-md border border-muted/70 bg-ink py-1.5 pr-2 pl-7 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
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

/** A field written in place — a new task or place, or a rename — in a row of the tree. */
function InlineField({
  focusKey,
  focusBack,
  ...field
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
      {/* Focused by the press that opened it, not on mount: see the header. */}
      <KeepField
        {...field}
        focusKey={focusKey}
        inputClassName="min-w-0 flex-1 rounded-md border border-muted/70 bg-ink px-2 py-1 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
      />
    </span>
  )
}

function TaskOption({
  task,
  guides,
  checked,
  onToggle,
  menu,
  onMenu,
  menuRef,
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
  menu: boolean
  onMenu: () => void
  menuRef: RefObject<HTMLSpanElement | null>
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
      className={`group/row relative flex items-stretch gap-2 px-2.5 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
          rows carry a Rename and a Delete for the same task. */}
      <More
        id={task.id}
        label={`More for task ${task.title}`}
        open={menu}
        onToggle={onMenu}
        menuRef={menuRef}
        className="mt-0.5"
      >
        <RowMenu id={task.id} name={`task ${task.title}`}>
          <IconButton onClick={onComplete} label={`Mark task ${task.title} done`} hint="Done">
            <CheckIcon />
          </IconButton>
          <IconButton onClick={onRename} label={`Edit task ${task.title}`} hint="Rename">
            <EditGlyph />
          </IconButton>
          <IconButton danger onClick={onDelete} label={`Delete task ${task.title}`} hint="Delete">
            <DeleteIcon />
          </IconButton>
        </RowMenu>
      </More>
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
  menu,
  onMenu,
  menuRef,
  onReopen,
}: {
  task: Item
  guides: ReactNode
  menu: boolean
  onMenu: () => void
  menuRef: RefObject<HTMLSpanElement | null>
  onReopen: () => void
}) {
  return (
    <li className="group/row relative flex items-stretch gap-2 px-2.5">
      {guides}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-sm text-muted">
        <span className="inline-flex size-[13px] shrink-0 translate-y-0.5 items-center justify-center">
          <CheckIcon className="w-[13px] text-deep/80" />
        </span>
        <span className="min-w-0 wrap-break-word line-through">{task.title}</span>
        <span className="sr-only">, done today</span>
      </span>
      <More
        id={task.id}
        label={`More for task ${task.title}`}
        open={menu}
        onToggle={onMenu}
        menuRef={menuRef}
        className="mt-0.5"
      >
        <RowMenu id={task.id} name={`task ${task.title}`}>
          <IconButton onClick={onReopen} label={`Reopen task ${task.title}`} hint="Reopen">
            <ReopenIcon />
          </IconButton>
        </RowMenu>
      </More>
    </li>
  )
}

/**
 * A row's `⋯`, and the popup it opens. The two are one thing to a press outside
 * them, so the open one carries the ref the browser checks presses against.
 * Level with the first line of a name that wraps.
 */
function More({
  id,
  label,
  open,
  onToggle,
  menuRef,
  className,
  children,
}: {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  menuRef: RefObject<HTMLSpanElement | null>
  /** Its top margin, which centres it on its row's first line. */
  className: string
  children: ReactNode
}) {
  return (
    <span ref={open ? menuRef : undefined} className="flex shrink-0 self-start">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={open}
        title="More"
        data-focus-key={`menu:${id}`}
        className={`${className} inline-flex h-6 w-6 items-center justify-center rounded-md leading-none text-muted transition hover:bg-surface-raised hover:text-bright ${
          open ? 'bg-surface-raised text-bright' : revealOnHover
        }`}
      >
        ⋯
      </button>
      {open && children}
    </span>
  )
}

/** A task's popup: its actions, as the tasks page's icons. */
function RowMenu({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <span role="group" aria-label={`Actions for ${name}`} data-focus-back={`menu:${id}`} className={MENU}>
      {children}
    </span>
  )
}

/**
 * A place's popup, opened from its `⋯`: what it can be given — a task, and the
 * level below — as words, because each names what it adds; then the tasks
 * page's icons for rename, done, archive and delete, each naming its target to
 * a screen reader and its verb on hover. A delete with something inside asks
 * first, here; `Keep` lets go.
 */
function PlaceTools({
  node,
  child,
  asking,
  inside,
  onAdd,
  onRename,
  onComplete,
  onArchive,
  onDelete,
  onKeep,
}: {
  node: TaskTreeNode
  /** What its `+` writes under it, if anything. */
  child: 'epic' | 'outcome' | undefined
  asking: boolean
  /** How many live items go with it, while it is asking. */
  inside: number
  onAdd: (kind: ItemKind) => void
  onRename: () => void
  onComplete: () => void
  onArchive: () => void
  onDelete: () => void
  onKeep: () => void
}) {
  const area = node.kind === 'area'
  return (
    <span
      role="group"
      aria-label={`Actions for ${node.name}`}
      data-focus-back={`menu:${node.id}`}
      className={MENU}
    >
      {asking ? (
        <span className="flex items-baseline gap-2 px-1.5 py-1">
          <span className="text-xs whitespace-nowrap text-commit">
            And the {inside} item{inside === 1 ? '' : 's'} inside?
          </span>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${node.name} and everything in it`}
            className={WORD}
          >
            Delete all
          </button>
          <button type="button" onClick={onKeep} className={WORD}>
            Keep
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onAdd('task')}
            aria-label={`Add a task to ${node.name}`}
            className={WORD}
          >
            + Task
          </button>
          {child && (
            <button
              type="button"
              onClick={() => onAdd(child)}
              aria-label={`Add ${child === 'epic' ? 'an epic' : 'an outcome'} to ${node.name}`}
              className={WORD}
            >
              + {child === 'epic' ? 'Epic' : 'Outcome'}
            </button>
          )}
          <IconButton onClick={onRename} label={`Rename ${node.name}`} hint="Rename">
            <EditGlyph />
          </IconButton>
          {!area && (
            <IconButton onClick={onComplete} label={`Mark ${node.name} done`} hint="Done">
              <CheckIcon />
            </IconButton>
          )}
          <IconButton onClick={onArchive} label={`Archive ${node.name}`} hint="Archive">
            <ArchiveIcon />
          </IconButton>
          {/* An area is deleted on the tasks page only — see the header. */}
          {!area && (
            <IconButton danger onClick={onDelete} label={`Delete ${node.name}`} hint="Delete">
              <DeleteIcon />
            </IconButton>
          )}
        </>
      )}
    </span>
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
