/**
 * The rows of All Tasks' tree and the popups their `⋯` opens, drawn from what
 * `PlaceBranch` hands each one. No state of their own beyond a box's mixed
 * mark: what is open, being renamed or asked about is the tree's
 * (`editors.ts`).
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
 * The tasks finished today are drawn after the open ones of their place,
 * crossed out (`DoneOption`). They are not choices: no checkbox, and only
 * reopen in their `⋯`. Marking one done or reopening it swaps one row for the
 * other, so the two rows' `⋯` share a focus key and the keyboard stays on the
 * task.
 */

import { useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react'

import { Carry, dragInto, SlotMark, slotAttrs, type CarryContext } from '../carry'
import { HoverNote } from '../HoverNote'
import { ArchiveIcon, CheckIcon, DeleteIcon, MoveIcon, ReopenIcon } from '../icons'
import { EditGlyph, IconButton, KeepField, revealOnHover } from '../ui'
import type { Item, ItemKind, TaskTreeNode } from '@/domain/tasks'

export const LEVEL: Record<TaskTreeNode['kind'], string> = { area: 'Area', epic: 'Epic', outcome: 'Outcome' }

/**
 * The box on an epic's or outcome's row, which ticks everything open in it
 * at once — for today, or for the block, as a task's box does. Ticked when
 * all of it is, mixed when some is, and pressed while mixed it ticks the rest:
 * the commoner wish is to take the whole of it. A place with nothing open has
 * no box, only the room one would take, so its name stays in line.
 */
export function PlaceTick({
  name,
  taskIds,
  selected,
  onToggle,
  keepsOne,
}: {
  name: string
  taskIds: readonly string[]
  selected: ReadonlySet<string>
  onToggle: (taskIds: readonly string[], on: boolean) => void
  keepsOne: boolean
}) {
  const box = useRef<HTMLInputElement>(null)
  const ticked = taskIds.filter((id) => selected.has(id)).length
  const all = taskIds.length > 0 && ticked === taskIds.length
  const some = ticked > 0 && !all
  // Unticking it would leave nothing ticked: everything ticked is in it.
  const locked = keepsOne && all && ticked === selected.size
  useEffect(() => {
    if (box.current) box.current.indeterminate = some
  }, [some])
  if (taskIds.length === 0) return <span aria-hidden="true" className="size-[13px] shrink-0" />
  const input = (describedBy: string | undefined) => (
    <input
      ref={box}
      type="checkbox"
      checked={all}
      onChange={() => {
        if (!locked) onToggle(taskIds, !all)
      }}
      aria-label={`All of ${name}`}
      {...(locked ? { 'aria-disabled': true } : {})}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      {...(locked ? {} : { title: all ? 'Untick all of it' : 'Tick all of it' })}
      className="m-0 mt-[9.5px] size-[13px] shrink-0 accent-[var(--color-deep)]"
    />
  )
  if (!keepsOne) return input(undefined)
  return (
    <HoverNote note={locked ? KEEPS_ONE_PLACE : null} className="flex shrink-0 self-start">
      {input}
    </HoverNote>
  )
}

/**
 * What a box that cannot be unticked says, while a running block holds it as
 * its only task, or holds nothing else. The machine refuses it anyway; this is
 * the reason, said where the press was made.
 */
const KEEPS_ONE = 'Every block is for at least one task. Tick another before letting this one go.'
const KEEPS_ONE_PLACE =
  'Every block is for at least one task. Tick another before letting all of this go.'

/** A row's popup, opened from its `⋯`: under the row, over the rows below. */
const MENU =
  'absolute top-full right-1.5 z-20 -mt-0.5 flex items-center gap-0.5 rounded-md border border-line bg-surface-raised px-0.5 py-0.5 shadow-lg'

/** A word in a place's toolbar, beside its icons. */
const WORD = 'px-1.5 text-xs whitespace-nowrap text-muted transition hover:text-bright'

/** A field written in place — a new task or place, or a rename — in a row of the tree. */
export function InlineField({
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
      {/* Focused by the press that opened it, not on mount: see `editors.ts`. */}
      <KeepField
        {...field}
        focusKey={focusKey}
        inputClassName="min-w-0 flex-1 rounded-md border border-muted/70 bg-ink px-2 py-1 text-sm text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none"
      />
    </span>
  )
}

export function TaskOption({
  task,
  guides,
  checked,
  onToggle,
  keepsOne,
  locked,
  menu,
  onMenu,
  menuRef,
  onRename,
  onDelete,
  onComplete,
  elsewhere,
  draggable,
  reorder,
  edge,
  steps,
}: {
  task: Item
  guides: ReactNode
  checked: boolean
  onToggle: () => void
  /** Whether the row can come to be the one that cannot be unticked: it carries a note's host. */
  keepsOne: boolean
  /** Whether it is that one now (`KEEPS_ONE`). */
  locked: boolean
  menu: boolean
  onMenu: () => void
  menuRef: RefObject<HTMLSpanElement | null>
  onRename: () => void
  onDelete: () => void
  onComplete: () => void
  elsewhere: string | null
  draggable: boolean
  /** The tree's own carry, when it can be put in order: a drag is in both. */
  reorder: CarryContext | null
  /** Where a drag's line is drawn on this row, if anywhere. */
  edge: 'before' | 'after' | null
  steps: Steps | undefined
}) {
  // Carried into today's intentions by the carry around the tree, and in the
  // tree by its own; each lets go when the drop lands, whichever took it,
  // or when the drag ends on nothing.
  const outer = useContext(Carry)
  const label = (describedBy: string | undefined) => (
    <label className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 py-1 text-sm text-body hover:text-bright">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {
          if (!locked) onToggle()
        }}
        {...(locked ? { 'aria-disabled': true } : {})}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        // No margins of its own: the tick on a done row is this wide, and
        // a browser's default margins put the two titles out of line.
        className="m-0 size-[13px] shrink-0 translate-y-0.5 accent-[var(--color-deep)]"
      />
      <span className="min-w-0 wrap-break-word">
        {task.title}
        {/* A task belongs to one intention a day; the caller says which. */}
        {elsewhere !== null && <span className="ml-1.5 text-xs text-muted">under {elsewhere}</span>}
      </span>
    </label>
  )
  // Dragged into today's intentions, into its place in the tree, or both: each
  // carry that takes it is told, and the row drags if either does.
  const drags = draggable || reorder !== null
  const both = {
    draggable: drags,
    ...dragInto(
      [
        ...(draggable ? [[outer, task] as const] : []),
        ...(reorder ? [[reorder, task] as const] : []),
      ],
      task.title,
    ),
  }
  return (
    <li
      {...(drags ? both : {})}
      {...(reorder ? slotAttrs('task', task.id) : {})}
      className={`group/row relative flex items-stretch gap-2 px-2.5 ${drags ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <SlotMark edge={edge} />
      {guides}
      {keepsOne ? (
        <HoverNote note={locked ? KEEPS_ONE : null} className="flex min-w-0 flex-1">
          {label}
        </HoverNote>
      ) : (
        label(undefined)
      )}
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
          {steps && <StepPair id={task.id} name={`task ${task.title}`} {...steps} />}
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
 * up. Not a choice; the one thing it offers is to be reopened.
 */
export function DoneOption({
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
export function More({
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

/** Where a row stands in its own list, and the step that moves it through it. */
export type Steps = { first: boolean; last: boolean; onStep: (by: -1 | 1) => void }

/**
 * A row's ↑ and ↓, first in its popup. At either end the one that cannot move
 * says so and stays, so the press that brought the row there leaves the focus
 * where it was; the tree hands it back after the row moves (`focusField`).
 * Nothing when the row has no siblings to move past.
 */
function StepPair({ id, name, first, last, onStep }: Steps & { id: string; name: string }) {
  if (first && last) return null
  return (
    <>
      <IconButton
        onClick={() => onStep(-1)}
        disabled={first}
        focusKey={`up:${id}`}
        label={`Move ${name} up`}
        hint="Move up"
      >
        <MoveIcon towards="up" />
      </IconButton>
      <IconButton
        onClick={() => onStep(1)}
        disabled={last}
        focusKey={`down:${id}`}
        label={`Move ${name} down`}
        hint="Move down"
      >
        <MoveIcon towards="down" />
      </IconButton>
    </>
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
export function PlaceTools({
  node,
  child,
  steps,
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
  /** Its ↑ and ↓, when the tree can be put in order. */
  steps: Steps | undefined
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
          {steps && <StepPair id={node.id} name={node.name} {...steps} />}
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
          {/* An area is deleted on the tasks page only — see above. */}
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
