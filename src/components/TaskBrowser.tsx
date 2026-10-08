/**
 * The backlog drawn as the tree it is, for choosing tasks from: what today is
 * for on the opening question, and what a block is for on the purpose prompt.
 * It is drawn in the calendar's column as All Tasks (`AllTasksPane`), which
 * trades places with the day while one of those two questions is open.
 *
 * Every open task in play, under its area, epic and outcome (`taskTree`), each
 * with a checkbox; a place's `⋯` offers `+ Task`, which writes a new one
 * straight into it and ticks it, unless the caller says not to (`tickWritten`).
 * What a tick means is the caller's: chosen for today, or ticked for this
 * block; where what is ticked can never be emptied (`keepsOne`), the last box
 * stays ticked and says why. An epic or outcome has a box of its own
 * (`PlaceTick`), which ticks everything open beneath it at once
 * (`onToggleMany`), and its row can be dragged onto one of today's intentions
 * to carry all of it there; an area has neither, being a whole part of a life.
 *
 * It replaced a dropdown, which had to be placed against its button, flipped
 * upwards when there was more room above, kept on a phone's screen as the
 * button changed width, and closed on a click outside or on focus leaving —
 * most of a file spent on being a dropdown. In the column it is as long as the
 * backlog and scrolls with the column, its search held at the head of it, and
 * the stage keeps only the answer.
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
 * A search narrows the tree as it is typed (`shown.ts`); Escape in the search
 * clears it.
 *
 * A task found here can be put right without leaving: its `⋯` marks it done,
 * renames it in place or deletes it, as the tasks page's own row would, and
 * one finished today can be reopened from its crossed-out row (`rows.tsx`).
 * The backlog is all on screen here, so it can be kept here, without a trip to
 * the tasks page in the middle of choosing. A new task's field and a rename
 * both carry a ✓ that keeps what is typed and a × that does not (`KeepField`);
 * Enter in a new task's field keeps it and stays open for the next. Enter in
 * any field here never submits the form the browser sits in. What is open is
 * held by id, and let go when its row goes (`editors.ts`); where the focus
 * goes when what had it leaves is `focusReturn.ts`'s.
 *
 * Names wrap rather than being cut short: a task is chosen by what it says,
 * and two tasks that begin the same way were indistinguishable once truncated.
 *
 * The tasks finished today are drawn too, after the open ones of their place
 * and crossed out, when the caller passes a tree that holds them
 * (`taskTreeWithDone`), and a search finds them only to show they are done.
 * What is left of an outcome reads differently beside what has already gone.
 *
 * Where today's list sits beside it, its open rows can be dragged into that
 * list's intentions (`draggable`, and the `Carry` the caller provides). Only
 * by pointer: the keyboard's way is to tick the task, which puts it in today,
 * and pick it up there with its grip. The browser draws no grip of its own,
 * because a second set of them on every row of the backlog would double the
 * stops a keyboard makes through it for a move it can already make. An epic's
 * or outcome's row says what it brings to today's carry in its payload,
 * everything open in it, rather than by its id alone.
 *
 * The tree is put in order here as well, when the caller says how (`onPlace`,
 * `ordering.ts`).
 *
 * The parts are in `allTasks/`: the rows and their popups, one place's
 * branch, and the hooks for what is open, where the focus goes, and order.
 */

import { memo, useContext, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Carry, dropListProps, TOP } from './carry'
import { PlaceBranch, TreeContext, type Tree } from './allTasks/branch'
import { useTreeEditors } from './allTasks/editors'
import { useFocusReturn } from './allTasks/focusReturn'
import { useTreeOrdering } from './allTasks/ordering'
import { narrow } from './allTasks/shown'
import type { PlaceActions, PlaceInOrder } from './allTasks/types'
import { openTasksBeneath, type TaskTreeNode } from '@/domain/tasks'

export type { PlaceActions, PlaceInOrder } from './allTasks/types'

export const TaskBrowser = memo(function TaskBrowser({
  label,
  tree,
  selected,
  onToggle,
  onToggleMany,
  onAdd,
  onRename,
  onDelete,
  onComplete,
  onReopen,
  places,
  elsewhere,
  draggable = false,
  onPlace,
  tickWritten = true,
  keepsOne = false,
}: {
  /** What is being chosen, as the group's accessible name. */
  label: string
  /** The places and their tasks; a task whose status is `done` is drawn as done. */
  tree: readonly TaskTreeNode[]
  selected: readonly string[]
  onToggle: (taskId: string, on: boolean) => void
  /**
   * Tick or untick every open task in an epic or outcome at once, from the
   * box on its row. Without it, a place's row has no box.
   */
  onToggleMany?: (taskIds: readonly string[], on: boolean) => void
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
  /** How to put the tree in order; without it, it cannot be. Stable across the tick. */
  onPlace?: PlaceInOrder
  /**
   * Whether a task written here is ticked as it is written: yes while
   * choosing, since writing it is choosing it; no while a block runs, when
   * what turns up is usually not for the block it turned up in.
   */
  tickWritten?: boolean
  /**
   * Whether what is ticked can never be emptied — a running block, which is
   * always for at least one task. The box that would empty it stays ticked
   * and says why on hover (`HoverNote`).
   */
  keepsOne?: boolean
}) {
  const [query, setQuery] = useState('')
  // Per tree and search, not per render: the order below is read from it.
  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => narrow(tree, needle), [tree, needle])

  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const editors = useTreeEditors(shown, root)
  const { adding, setAdding, renamingPlace, setRenamingPlace, renaming, setRenaming } = editors
  const focus = useFocusReturn(root, search)
  const ordering = useTreeOrdering(shown, onPlace, focus.focusNext)
  // The carry around the tree, which takes a task — or everything open in an
  // epic or outcome — into one of today's intentions.
  const outer = useContext(Carry)
  // The whole of a place, not what a search leaves of it: its box takes all of it.
  const openUnder = useMemo(() => openTasksBeneath(tree), [tree])
  const selectedSet = useMemo(() => new Set(selected), [selected])

  /**
   * Keep what is written: Enter stays open for the next, ✓ closes the field. A
   * task is ticked as it is written, unless the caller says not to; an epic or
   * outcome is only a place.
   */
  const write = (then: 'next' | 'done') => {
    if (!adding) return
    if (adding.title.trim() !== '') {
      if (adding.kind === 'task') {
        const id = onAdd(adding.parentId, adding.title)
        if (id === null) return
        if (tickWritten) onToggle(id, true)
      } else if (places.add(adding.parentId, adding.kind, adding.title) === null) {
        return
      }
    }
    setAdding(then === 'next' ? { ...adding, title: '' } : null)
  }

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
    if (e.key === 'Escape' && editors.menu !== null) {
      e.preventDefault()
      focus.focusNext(`menu:${editors.menu}`)
      editors.closeMenu()
    }
  }

  // Everything a branch draws with, built again each time the tree draws,
  // which is when every branch draws anyway (`branch.tsx`).
  const held: Tree = {
    editors,
    ordering,
    focusNext: focus.focusNext,
    places,
    selected: selectedSet,
    openUnder,
    onToggle,
    onToggleMany,
    onDelete,
    onComplete,
    onReopen,
    elsewhere,
    draggable,
    keepsOne,
    write,
    renamePlace,
    rename,
    outer,
  }

  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={focus.onFocus}
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
        <TreeContext.Provider value={held}>
          <ul {...(ordering.ordering ? dropListProps(ordering.reorder, TOP, ['area']) : {})}>
            {shown.map((node, i) => (
              <PlaceBranch
                key={node.id}
                node={node}
                depth={0}
                parent={TOP}
                last={i === shown.length - 1}
              />
            ))}
          </ul>
        </TreeContext.Provider>
      )}
    </div>
  )
})

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
