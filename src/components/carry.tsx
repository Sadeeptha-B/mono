/**
 * Carrying a task from one place to another: dragged by its row, or picked up
 * with the grip and put down with a `Move here`.
 *
 * Two surfaces carry tasks. The tasks page moves one between the columns of
 * the backlog, and today's list moves one between the intentions it is
 * grouped under. What a place is, and what moving there writes, differs; the
 * gesture does not, so the gesture is here once and each surface says only
 * which places take a task (`takes`) and what putting it down does (`move`).
 *
 * The drag is the browser's own rather than Motion's: Motion's drag moves an
 * element under the pointer but knows nothing about what it is over, so the
 * drop targets, the hit-testing and the scrolling at the page's edge would all
 * have been written here, and its drag features would have been one more
 * chunk to load. The native drag brings those with it, and what it does badly
 * — touch, and anyone not using a pointer — is what the pick-up path is for.
 * A drag and a pick-up are the same move begun two ways, so they share one
 * piece of state: whichever started it, the places that will take the task
 * are the same ones, and putting it down is the same write.
 *
 * The task in hand is read back from its surface (`find`) rather than kept, so
 * it is always where the backlog and the day say it is. One that leaves play
 * while held — ticked, deleted, its epic finished, taken out of today in
 * another place — is put down, and for good: hiding it only while it was out of
 * play would hand the old move back the moment it returned, with nobody having
 * picked it up. That is adjusted during render rather than in an effect, so the
 * stale move is never painted.
 *
 * Two surfaces on one page share a hand (`useCarryHand`): taking a task up with
 * one puts down whatever the other held, so there is one status bar and one
 * set of `Move here` at a time.
 *
 * A drag can also be let go *between* rows, which is how the backlog is put in
 * order. A list that takes a row at a position (`useDropList`) works out from
 * the pointer which of its rows the carried one would land before — its rows
 * mark themselves with `slotAttrs` — and asks the surface whether that slot
 * fits (`fits`); the row it would land before draws a line there
 * (`SlotMark`), and letting go writes it (`place`). Only for a drag: the
 * keyboard's way to reorder is a step at a time, from a grip's arrow keys or a
 * row's own buttons, since a pick-up offering a `Move here` between every
 * pair of rows would be most of the page.
 *
 * Lists nest — a task list inside an outcome's column inside an epic's row of
 * outcomes, all in an area's band — and a drag event passes through all of
 * them on its way up. The innermost that takes the carried row claims the
 * event by cancelling it, and everything above, lists and columns alike,
 * leaves a cancelled event alone. So a task over a task list lands among its
 * tasks, and an outcome dragged over the same list falls through to the row
 * of outcomes around it.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'

import { useRefocus } from './ui'

/**
 * What can be carried: a task, or on the tasks page something put down for
 * later, which is carried into the backlog to become a task there. The
 * gesture needs only something to find again and a title to say it is moving;
 * what putting it down writes is each surface's own (`move`).
 */
export type Carried = { id: string; title: string }

/** How a task is being carried: under the pointer, or picked up to be put down. */
export type CarryMode = 'drag' | 'pick'

/** What a list of rows holds, so a list holding two kinds can tell them apart. */
export type SlotKind = 'area' | 'epic' | 'outcome' | 'task'

/**
 * A position among a list's rows: under `parent`, among its rows of `kind`,
 * before the row `before`, or after the last when that is null.
 */
export type Slot = { parent: string; kind: SlotKind; before: string | null }

/** The parent of the list of areas, which have none. Never an id. */
export const TOP = ''

/** The task in hand on one surface, and the verbs that carry it. */
export type CarryContext = {
  held: { task: Carried; by: CarryMode } | null
  /** The place a drag is over, so only that one lights up. */
  over: string | null
  hover: Dispatch<SetStateAction<string | null>>
  pickUp: (task: Carried, by: CarryMode) => void
  putDown: () => void
  /** Whether the task in hand would go to `target`: anywhere but where it is. */
  takes: (target: string) => boolean
  /** Put the task in hand at `target`, and let go of it. */
  moveTo: (target: string) => void
  /** The task a pick-up just put down, which takes focus when it lands. */
  landed: RefObject<string | null>
  /** The slot a drag is over, so only its line is drawn. */
  aimed: Slot | null
  aim: Dispatch<SetStateAction<Slot | null>>
  /** Whether the task in hand would go to `slot`: somewhere it is not already. */
  fits: (slot: Slot) => boolean
  /** Put the task in hand at `slot`, and let go of it. */
  placeAt: (slot: Slot) => void
}

export const Carry = createContext<CarryContext>({
  held: null,
  over: null,
  hover: () => undefined,
  pickUp: () => undefined,
  putDown: () => undefined,
  takes: () => false,
  moveTo: () => undefined,
  landed: { current: null },
  aimed: null,
  aim: () => undefined,
  fits: () => false,
  placeAt: () => undefined,
})

/** Which of several carries on a page holds the task in hand. */
export type CarryHand = { holder: string | null; take: (carrier: string) => void }

export function useCarryHand(): CarryHand {
  const [holder, take] = useState<string | null>(null)
  return useMemo(() => ({ holder, take }), [holder])
}

/**
 * One surface's carry, for its `Carry.Provider`. The three functions are read
 * by identity, so a caller keeps them stable — they change with the backlog or
 * the day, not with the clock.
 */
export function useCarryState<T extends Carried>({
  find,
  takes,
  move,
  fits,
  place,
  hand,
}: {
  /**
   * The task by id as the surface now holds it, or undefined once it has left;
   * asked with how it was taken up, since a surface may hold a drag and a
   * pick-up to different terms.
   */
  find: (taskId: string, by: CarryMode) => T | undefined
  /** Whether a task would go to `target`. */
  takes: (task: T, target: string) => boolean
  /**
   * Put it down. Returns the id of what landed when that is not what was
   * carried — something filed from Later lands as a new task — so a pick-up's
   * focus follows it there.
   */
  move: (task: T, target: string) => string | undefined | void
  /** Whether a task would go to a slot between rows; none would, without it. */
  fits?: (task: T, slot: Slot) => boolean
  /** Put it down at a slot, returning what landed as `move` does. */
  place?: (task: T, slot: Slot) => string | undefined | void
  /** Shared with the page's other carries, so only one holds a task at once. */
  hand?: CarryHand | undefined
}): CarryContext {
  const [carrying, setCarrying] = useState<{ id: string; by: CarryMode } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [aimed, setAimed] = useState<Slot | null>(null)
  const landed = useRef<string | null>(null)
  const me = useId()

  const mine = hand === undefined || hand.holder === me
  const heldTask = carrying && mine ? find(carrying.id, carrying.by) : undefined
  if (carrying && !heldTask) {
    setCarrying(null)
    setOver(null)
    setAimed(null)
  }

  const carry = useMemo<CarryContext>(() => {
    const putDown = () => {
      setCarrying(null)
      setOver(null)
      setAimed(null)
    }
    const held = heldTask && carrying ? { task: heldTask, by: carrying.by } : null
    return {
      held,
      over,
      hover: setOver,
      pickUp: (task, by) => {
        hand?.take(me)
        setCarrying({ id: task.id, by })
        setOver(null)
      },
      putDown,
      takes: (target) => held !== null && takes(held.task, target),
      moveTo: (target) => {
        if (!held || !takes(held.task, target)) return
        const arrived = move(held.task, target) ?? held.task.id
        // From the keyboard, focus goes with the task to where it landed.
        if (held.by === 'pick') landed.current = arrived
        putDown()
      },
      landed,
      aimed,
      aim: setAimed,
      fits: (slot) => held !== null && fits !== undefined && fits(held.task, slot),
      placeAt: (slot) => {
        if (!held || !place || !fits?.(held.task, slot)) return
        const arrived = place(held.task, slot) ?? held.task.id
        if (held.by === 'pick') landed.current = arrived
        putDown()
      },
    }
  }, [heldTask, carrying, over, aimed, takes, move, fits, place, hand, me])

  // Escape puts a picked-up task back down. A drag has its own Escape.
  const picked = carry.held?.by === 'pick'
  const putDown = carry.putDown
  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') putDown()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picked, putDown])

  return carry
}

/**
 * A place that takes a carried task, drawn as one while there is one to take:
 * outlined while a task is in hand, lit while a drag is over it.
 *
 * The outline is an outline rather than a border so that showing it moves
 * nothing. The drag begins with this state changing, and a place that grew a
 * border would shift the page under the pointer mid-gesture. A drag from
 * outside the page carries no task, so no place answers it.
 */
export function DropZone({
  target,
  className = '',
  children,
}: {
  target: string
  className?: string
  children: ReactNode
}) {
  const { held, over, hover, takes, moveTo, aim } = useContext(Carry)
  const open = takes(target)
  const lit = open && over === target

  // A list inside it that took the drag at a position has claimed it.
  const accept = (e: DragEvent) => {
    if (!open || held?.by !== 'drag' || e.defaultPrevented) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (over !== target) hover(target)
    aim(null)
  }

  return (
    <div
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(e) => {
        // Leaving for one of its own children is not leaving.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        hover((current) => (current === target ? null : current))
      }}
      onDrop={(e) => {
        if (!open || e.defaultPrevented) return
        e.preventDefault()
        moveTo(target)
      }}
      className={`rounded-xl outline-offset-4 ${
        lit
          ?'bg-surface/60 outline-2 outline-deep'
          : open
            ? 'outline-1 outline-muted/70 outline-dashed'
            : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * The drag handlers for a list that takes a carried row at a position: spread
 * onto the element whose direct children are the rows, each marked with
 * `slotAttrs`. `kinds` are the rows it holds, tried in order — a place in
 * All Tasks holds both its places and its tasks.
 *
 * Which row the drag would land before is worked out from the pointer each
 * time it moves, against the rows as they are drawn now: in a list down the
 * page by the middle of each row, and in a grid that wraps (`grid`) in reading
 * order, by the middle of each column across and its bottom edge down. Past
 * the last, it lands last.
 *
 * A list holding two kinds takes a kind only where the pointer is not over a
 * row of the other. Otherwise a task let go over an outcome in All Tasks —
 * where it already stands last, so the outcome's own list turned it down —
 * fell through to the epic's list and landed among the epic's tasks, below
 * where the pointer was. And a list the pointer is over that takes nothing
 * there lets go of any line it drew, since no `dragleave` says the pointer
 * moved from one of its rows to another.
 */
export const useDropList = (
  parent: string,
  kinds: readonly SlotKind[],
  axis: 'list' | 'grid' = 'list',
): DropListProps => dropListProps(useContext(Carry), parent, kinds, axis)

type DropListProps = Pick<
  HTMLAttributes<HTMLElement>,
  'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
>

/**
 * `useDropList` for a carry held in hand rather than read from the context:
 * All Tasks keeps its own, for putting the tree in order, inside the carry of
 * today's list its rows are also dragged into.
 */
export function dropListProps(
  { held, fits, aim, hover, placeAt }: CarryContext,
  parent: string,
  kinds: readonly SlotKind[],
  axis: 'list' | 'grid' = 'list',
): DropListProps {
  const mine = (slot: Slot | null) => slot?.parent === parent && kinds.includes(slot.kind)
  const slotAt = (e: DragEvent<HTMLElement>): Slot | null => {
    const over = rowUnder(e.currentTarget, e.target)?.dataset.slot
    for (const kind of kinds) {
      if (over !== undefined && over !== kind) continue
      const rows = e.currentTarget.querySelectorAll<HTMLElement>(`:scope > [data-slot="${kind}"]`)
      const slot = { parent, kind, before: rowAfter(rows, e.clientX, e.clientY, axis) }
      if (fits(slot)) return slot
    }
    return null
  }
  const accept = (e: DragEvent<HTMLElement>) => {
    if (held?.by !== 'drag' || e.defaultPrevented) return
    const slot = slotAt(e)
    if (!slot) {
      aim((was) => (mine(was) ? null : was))
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    hover(null)
    aim((was) => (sameSlot(was, slot) ? was : slot))
  }

  return {
    onDragEnter: accept,
    onDragOver: accept,
    onDragLeave: (e) => {
      // Leaving for one of its own rows is not leaving.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      aim((was) => (mine(was) ? null : was))
    },
    onDrop: (e) => {
      if (held?.by !== 'drag' || e.defaultPrevented) return
      const slot = slotAt(e)
      if (!slot) return
      e.preventDefault()
      placeAt(slot)
    },
  }
}

/** What marks an element as a row of a `useDropList`. */
export const slotAttrs = (kind: SlotKind, id: string) => ({ 'data-slot': kind, 'data-slot-id': id })

/** The row the pointer is before, by the rule `useDropList` describes; null past the last. */
function rowAfter(
  rows: Iterable<HTMLElement>,
  x: number,
  y: number,
  axis: 'list' | 'grid',
): string | null {
  for (const row of rows) {
    const box = row.getBoundingClientRect()
    const before =
      axis === 'list'
        ? y < box.top + box.height / 2
        : y < box.top || (y <= box.bottom && x < box.left + box.width / 2)
    if (before) return row.dataset.slotId ?? null
  }
  return null
}

/** The direct child of `list` that `target` is in, if any. */
function rowUnder(list: HTMLElement, target: EventTarget | null): HTMLElement | null {
  let node = target instanceof Node ? target : null
  while (node && node.parentNode !== list) node = node.parentNode
  return node instanceof HTMLElement ? node : null
}

const sameSlot = (a: Slot | null, b: Slot) =>
  a !== null && a.parent === b.parent && a.kind === b.kind && a.before === b.before

/**
 * Which edge of a row a drag's line is drawn on, if any: the top of the row it
 * would land before, or the bottom of the last row when it would land last.
 */
export const useSlotEdge = (parent: string, kind: SlotKind, id: string, last: boolean) =>
  slotEdge(useContext(Carry).aimed, parent, kind, id, last)

/** `useSlotEdge`, for a carry held in hand (`dropListProps`). */
export function slotEdge(
  aimed: Slot | null,
  parent: string,
  kind: SlotKind,
  id: string,
  last: boolean,
): 'before' | 'after' | null {
  if (!aimed || aimed.parent !== parent || aimed.kind !== kind) return null
  if (aimed.before === id) return 'before'
  return last && aimed.before === null ? 'after' : null
}

/**
 * The line a drag would put its row down on, drawn in the gap on that edge of
 * the row. Laid over the page rather than in its flow, like a drop zone's
 * outline, so it moves nothing under the pointer. The row needs `relative`.
 */
export function SlotMark({
  edge,
  axis = 'list',
}: {
  edge: 'before' | 'after' | null
  axis?: 'list' | 'grid'
}) {
  if (edge === null) return null
  const where =
    axis === 'list'
      ? `inset-x-0 h-0.5 ${edge === 'before' ? '-top-[5px]' : '-bottom-[5px]'}`
      : `inset-y-0 w-0.5 ${edge === 'before' ? '-left-[9px]' : '-right-[9px]'}`
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 rounded-full bg-deep ${where}`}
    />
  )
}

/**
 * Where a picked-up task can be put down: a button at the head of every place
 * that would take it. Only for a pick-up — a drag has the place itself.
 */
export function MoveHere({ target, name }: { target: string; name: string }) {
  const { held, takes, moveTo } = useContext(Carry)
  if (!held || held.by !== 'pick' || !takes(target)) return null
  return (
    <button
      type="button"
      onClick={() => moveTo(target)}
      aria-label={`Move ${held.task.title} to ${name}`}
      className="mb-2 w-full rounded-lg border border-dashed border-deep/70 px-3 py-2 text-left text-xs text-deep transition hover:bg-surface-raised"
    >
      Move here
    </button>
  )
}

/**
 * What a row needs to be carried: the drag attributes for the element that
 * drags, whether it is the one picked up, and the grip that picks it up.
 *
 * The whole row drags, which is what a card invites; the grip is where it says
 * so, and the button that picks it up without a pointer. A row being edited
 * passes `draggable: false`, so that selecting its text selects text.
 */
export function useCarriedRow(task: Carried, draggable = true) {
  const { held, pickUp, putDown } = useContext(Carry)
  const picked = held?.task.id === task.id && held.by === 'pick'
  const dragProps: HTMLAttributes<HTMLElement> & { draggable: boolean } = {
    draggable,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      // Firefox starts no drag without data, and a title is what a drag
      // carried out of the page would sensibly drop as.
      e.dataTransfer.setData('text/plain', task.title)
      pickUp(task, 'drag')
    },
    onDragEnd: putDown,
  }
  return { picked, dragProps }
}

/**
 * The grip on a carried row: six dots, and the button that picks the task up
 * or puts it back. A row mounts afresh where it was moved to; the one a pick-up
 * just put down takes focus here, so the keyboard ends where the task did.
 */
export function CarryGrip({
  task,
  onStep,
  className = '',
}: {
  task: Carried
  /**
   * A step earlier or later in its list, from the arrow keys while the grip
   * has focus: the keyboard's way to put a list in order.
   */
  onStep?: (by: -1 | 1) => void
  className?: string
}) {
  const { held, pickUp, putDown, landed } = useContext(Carry)
  const picked = held?.task.id === task.id && held.by === 'pick'
  const grip = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (landed.current !== task.id) return
    landed.current = null
    grip.current?.focus()
  }, [landed, task.id])
  const stepped = useRefocus(grip)

  return (
    <button
      ref={grip}
      type="button"
      onClick={() => (picked ? putDown() : pickUp(task, 'pick'))}
      onKeyDown={(e) => {
        const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        if (!onStep || by === 0 || picked) return
        e.preventDefault()
        stepped()
        onStep(by)
      }}
      aria-label={`Move ${task.title}`}
      aria-pressed={picked}
      {...(onStep ? { 'aria-keyshortcuts': 'ArrowUp ArrowDown' } : {})}
      title={
        onStep
          ? 'Drag to move, click to pick up, or use the arrow keys to reorder'
          : 'Drag to move, or click to pick up'
      }
      className={`shrink-0 cursor-grab rounded px-0.5 py-0.5 transition hover:text-bright active:cursor-grabbing ${
        picked ? 'text-deep' : 'text-muted'
      } ${className}`}
    >
      <GripGlyph />
    </button>
  )
}

/**
 * What a pick-up is waiting for, and the way out of it, kept where a thumb can
 * reach it: the place it is looking for may be a long way down the page from
 * the row it left.
 */
export function CarryStatus() {
  const { held, putDown } = useContext(Carry)
  if (!held || held.by !== 'pick') return null
  const { title } = held.task
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-muted/70 bg-surface-raised px-4 py-3 text-sm shadow-lg"
    >
      <span className="min-w-0 flex-1 text-body">
        Moving <span className="text-bright">{title}</span>. Choose{' '}
        <span className="text-deep">Move here</span> where it goes.
      </span>
      <button
        type="button"
        onClick={putDown}
        aria-label={`Cancel moving ${title}`}
        className="text-xs text-muted underline-offset-4 transition hover:text-bright hover:underline"
      >
        Cancel
      </button>
    </div>
  )
}

/**
 * Six dots in two columns: the mark that says a row can be picked up. Drawn
 * rather than typed, because the braille character that looks like it is read
 * aloud as braille.
 */
function GripGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 12" width="8" height="12" fill="currentColor">
      {[2, 6, 10].map((y) => (
        <g key={y}>
          <circle cx="2" cy={y} r="1" />
          <circle cx="6" cy={y} r="1" />
        </g>
      ))}
    </svg>
  )
}
