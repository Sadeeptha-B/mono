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
 * stage scrolls inside itself on a wide screen. Across, it hangs from the
 * button's left edge while there is room to the right, and otherwise lines up
 * with the right of the screen or the scroller it is in (`placeAcross`), so a
 * button halfway across a phone does not push the panel off the edge. Across
 * is kept in step while the panel is open, because the panel is placed against
 * the button and the button does not hold still: choosing a task changes the
 * summary it shows, and a phone turned on its side changes the room. Measured
 * once, a right-aligned panel was left hanging from the button's old right
 * edge, off the screen again. It closes on Escape, on the
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
 * mounts under the new, draft and all. Each of those took focus from the
 * search or wherever the user had gone. So `+ Task` and ✎ ask for their field
 * by key, and it is focused after the render that draws it; a field drawn for
 * any other reason is drawn and left alone.
 *
 * Controls leave the panel while it stays open: a field closed by ✓, × or
 * Escape, a row whose × deleted it, or anything another tab deletes, finishes,
 * closes or moves. When the one with focus goes, focus falls to the page, out
 * of reach of the panel's own Escape and of the blur that closes it on Tab, so
 * a keyboard had no way left to close it. So the panel remembers the control
 * that last had focus, and once that control has left the page with focus
 * lost, focus goes to the first of these still drawn: the same control drawn
 * again (a rename its task moved), what opened it (a field's `+ Task` or ✎),
 * the place its row is in, the search, the button. Only when focus was lost:
 * if it already moved somewhere on purpose, it stays there, the rule `AddFold`
 * keeps. A control's own key is `data-focus-key`; a field names its opener in
 * `data-focus-back`, and a place's list in `data-home`.
 *
 * Names wrap rather than being cut short: a task is chosen by what it says,
 * and two tasks that begin the same way were indistinguishable once
 * truncated. So the panel has a fixed size instead of sizing to its longest
 * line — as wide as `placeAcross` allows, and at most `max-h-80` tall,
 * scrolling inside itself beyond that with the search held at its head. A
 * panel that grew to fit its rows changed width as a search narrowed them.
 *
 * The tasks finished today are drawn too, after the open ones of their place
 * and crossed out, when the caller passes a tree that holds them
 * (`taskTreeWithDone`). They are not choices: no checkbox, no ✎ or ×, and a
 * search finds them only to show they are done. What is left of an outcome
 * reads differently beside what has already gone.
 *
 * The tree is drawn only while the panel is open, so a backlog of hundreds of
 * tasks costs nothing on a stage that re-renders every second.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import { CheckIcon } from './icons'
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, placeAcross, roomFor, type Across } from './panelPlacement'
import { EditGlyph } from './ui'
import type { Item, TaskTreeNode } from '@/domain/tasks'

/** Room the panel wants below its button before it opens upwards instead. */
const PANEL_ROOM = 320
/** Clear space kept between the panel and the edge of the screen. */
const GUTTER = 16

const LEVEL: Record<TaskTreeNode['kind'], string> = { area: 'Area', epic: 'Epic', outcome: 'Outcome' }

const sameAcross = (a: Across, b: Across): boolean =>
  a.side === b.side &&
  a.offset === b.offset &&
  a.minWidth === b.minWidth &&
  a.maxWidth === b.maxWidth

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
  /** The places and their tasks; a task whose status is `done` is drawn as done. */
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
  const [across, setAcross] = useState<Across>({
    side: 'left',
    offset: 0,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
  })
  /** The place a new task is being written into, if any, and what is typed. */
  const [adding, setAdding] = useState<{ parentId: string; title: string } | null>(null)
  /** The task being renamed, if any, and its title as typed. */
  const [renaming, setRenaming] = useState<{ taskId: string; title: string } | null>(null)
  const [query, setQuery] = useState('')
  const shown = narrow(tree, query.trim().toLowerCase())
  // An editor whose subject is no longer drawn closes — see the header.
  // Adjusted during render, as `TasksPage` drops a carry, so the stale editor
  // is never painted and never mounts again on its own.
  if (renaming && !drawsTask(shown, renaming.taskId)) setRenaming(null)
  if (adding && !drawsPlace(shown, adding.parentId)) setAdding(null)

  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  /**
   * The control in the panel that last had focus, and the keys of where focus
   * goes if it is taken away, in order — see the header.
   */
  const lastFocus = useRef<{ control: Element; to: (string | null)[] } | null>(null)
  /** The field a press has just opened, to be focused once it is drawn. */
  const focusField = useRef<string | null>(null)
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

  /**
   * Where the panel goes across, measured now from the box it is placed
   * against — the button's wrapper — and the room around it. Leaves the state
   * alone when nothing moved, so a resize that changes nothing renders nothing.
   */
  const placePanel = useCallback(() => {
    const anchor = toggle.current?.parentElement
    if (!anchor) return
    const next = placeAcross(anchor.getBoundingClientRect(), roomFor(anchor, GUTTER))
    setAcross((current) => (sameAcross(current, next) ? current : next))
  }, [])

  // Which way to open is decided as it opens, in the handler, so the panel
  // never paints facing one way and then jumps to the other.
  const openPanel = () => {
    const box = toggle.current?.getBoundingClientRect()
    const height = toggle.current?.ownerDocument.defaultView?.innerHeight
    if (box && height !== undefined) {
      const below = height - box.bottom
      setUpwards(below < PANEL_ROOM && box.top > below)
    }
    placePanel()
    setOpen(true)
  }

  // Across, kept in step while open — see the header. The summary is the usual
  // reason the button changes width, and a layout effect re-places the panel
  // before that change is painted. Anything else that resizes the button, and
  // the window itself changing size, is heard through an observer and the
  // window's own resize — the window this was drawn into, which is not always
  // the tab's.
  useLayoutEffect(() => {
    if (open) placePanel()
  }, [open, summary, placePanel])
  useEffect(() => {
    if (!open) return
    const anchor = toggle.current?.parentElement
    const view = anchor?.ownerDocument.defaultView
    if (!anchor || !view) return
    view.addEventListener('resize', placePanel)
    const observer = 'ResizeObserver' in view ? new view.ResizeObserver(placePanel) : null
    observer?.observe(anchor)
    return () => {
      view.removeEventListener('resize', placePanel)
      observer?.disconnect()
    }
  }, [open, placePanel])
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

  // After every render: a field a press has just opened is focused; otherwise,
  // once the control that last had focus has left the page and focus went
  // with it, focus is handed back. Not before it has gone, since the render
  // that takes it may not be this one.
  useEffect(() => {
    const doc = root.current?.ownerDocument
    if (!doc) return
    const keyed = (key: string | null) =>
      key ? root.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null

    // A field a press has just opened: focused here, after the render that
    // drew it, rather than by mounting — see the header.
    const wanted = focusField.current
    if (wanted) {
      focusField.current = null
      keyed(wanted)?.focus()
      return
    }

    // Forgotten as the panel closes, so a later opening — by a click that, in
    // Safari, focuses nothing — is never taken for focus lost.
    if (!open) {
      lastFocus.current = null
      return
    }
    const last = lastFocus.current
    if (!last || last.control.isConnected) return
    lastFocus.current = null
    const active = doc.activeElement
    if (active !== null && active !== doc.body) return
    const named = last.to.map(keyed).find((el) => el)
    ;(named ?? search.current ?? toggle.current)?.focus()
  })

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
            <DoneOption key={task.id} task={task} guides={guides(depth + 1)} />
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
              onToggle={() => toggleTask(task.id)}
              onRename={() => {
                focusField.current = `rename:${task.id}`
                setRenaming({ taskId: task.id, title: task.title })
              }}
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
      onFocus={(e) => {
        const near = (name: string) => e.target.closest(`[${name}]`)?.getAttribute(name) ?? null
        lastFocus.current = {
          control: e.target,
          to: [e.target.getAttribute('data-focus-key'), near('data-focus-back'), near('data-home')],
        }
      }}
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
          {/* No wider than the wrapper as well as no wider than 18rem. A button
              sizes to its content rather than to its box, so with only the
              18rem cap a long summary on a phone ran the button past its
              wrapper and off the screen, widening the page. */}
          <button
            ref={toggle}
            type="button"
            onClick={() => (open ? close(false) : openPanel())}
            aria-label={label}
            aria-expanded={open}
            {...(open ? { 'aria-controls': panelId } : {})}
            className="flex max-w-[min(18rem,100%)] min-w-0 items-center gap-1.5 rounded-md border border-muted/70 bg-ink px-1.5 py-0.5 text-body transition hover:text-bright focus:border-deep focus:outline-none"
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
              // A fixed width, the widest there is room for — see the header.
              style={{
                ...(across.side === 'left' ? { left: 0 } : { right: across.offset }),
                width: across.maxWidth,
                minWidth: across.minWidth,
                maxWidth: across.maxWidth,
              }}
              className={`mono-scroll absolute z-30 max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-muted/70 bg-ink pb-1.5 shadow-lg ${
                upwards ? 'bottom-full mb-1' : 'top-full mt-1'
              }`}
            >
              {/* Held at the head of the panel while the tree scrolls under it. */}
              {tree.length > 0 && (
                <div className="sticky top-0 z-10 bg-ink px-2.5 pt-2 pb-1.5">
                  <SearchGlyph className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted" />
                  <input
                    ref={search}
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
                <p className="px-2.5 pt-3 pb-1.5 text-sm text-muted">No areas to choose from.</p>
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
        // Focused by the press that opened it, not here: see the picker's
        // header for what focusing on mount did.
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
          className="shrink-0 translate-y-0.5 accent-[var(--color-deep)]"
        />
        <span className="min-w-0 wrap-break-word">
          {task.title}
          {/* A task belongs to one intention a day; choosing it here moves it. */}
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
        onClick={onRename}
        aria-label={`Edit task ${task.title}`}
        data-focus-key={`edit:${task.id}`}
        className="mt-1.5 shrink-0 self-start px-0.5 text-muted transition hover:text-bright"
      >
        <EditGlyph />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete task ${task.title}`}
        className="mt-1.5 shrink-0 self-start px-0.5 text-muted transition hover:text-commit"
      >
        ×
      </button>
    </li>
  )
}

/**
 * A task finished today: crossed out where it lives, after what is still open
 * there, with a tick where an open task's checkbox would be so the titles line
 * up. Not a choice, so nothing here can be pressed — see the header.
 */
function DoneOption({ task, guides }: { task: Item; guides: ReactNode }) {
  return (
    <li className="flex items-stretch gap-2 px-2.5">
      {guides}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-sm text-muted">
        <CheckIcon className="w-[13px] translate-y-0.5 text-deep/80" />
        <span className="min-w-0 wrap-break-word line-through">{task.title}</span>
        <span className="sr-only">, done today</span>
      </span>
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
