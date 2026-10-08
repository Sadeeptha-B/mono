/**
 * All Tasks, in the calendar's column: the backlog drawn as a tree
 * (`TaskBrowser`) for the two questions that choose from it.
 *
 * The right column is the day, always, except while today's question or the
 * purpose prompt is open. Those two choose tasks, and choosing needs the whole
 * backlog in view, which the stage has no room for. So for those two the
 * column offers a second view, switched from its header (`ColumnSwitch`): the
 * day, or All Tasks.
 * Both open on All Tasks, since that is where their answers come from, and
 * the stage beside it already shows today's own list. Whatever is chosen by
 * hand holds until the question closes, and the column is the day again.
 * `App` owns which is showing, and hides the other rather than unmounting it,
 * so a field half written in either is still there when it is switched back.
 *
 * What a tick means follows the question. On today's question it chooses the
 * task for today; on the purpose prompt it ticks the task for the block,
 * through the same pick the prompt reads (`BlockPick`), and chooses it for
 * today as well (`App`). On both, a row can be dragged across onto one of
 * today's intentions on the stage — the list and the backlog share one hand,
 * `TodayCarry`, held around both columns.
 *
 * The column scrolls the tree itself, so the search is held at its head and
 * nothing here scrolls inside anything else.
 *
 * On the purpose prompt the column is split. Under the tree is the day itself,
 * today's own list (`TodayList`, as on the opening question): what today has
 * chosen, under its intentions, which are named, renamed, marked done,
 * deleted and filled by carrying tasks in, from the list itself or from the
 * tree above. Ticking stays in the tree, and the prompt lists only what is
 * ticked; a block is often where the day's grouping turns out wrong, and this
 * is where it is put right without going back to the opening question. Under
 * the tree rather than over it, because the tree is what the prompt is
 * choosing from and should be the first thing in the column. From `lg` up a
 * divider between the two is dragged to share the column's height
 * (`Splitter`), and the day starts folded down to its heading, since the
 * prompt is mostly answered from the tree; `+ Intention` opens it. Below
 * `lg` both are as tall as they are and the page scrolls.
 *
 * Areas, epics and outcomes are kept from here as well as tasks, behind a `⋯`
 * on their rows (`PlaceActions`): renamed, given an epic or an outcome,
 * finished, archived or deleted — an area only renamed, given an epic or
 * archived, its delete left to the tasks page.
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { TaskBrowser, type PlaceActions } from './TaskBrowser'
import { TodayList, useIntentionRename } from './TodayList'
import { useTodayBacklog } from './useTodayBacklog'
import { liveDescendantsOf } from '@/domain/tasks'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'

/** What the column shows. */
export type ColumnView = 'day' | 'tasks'

/** The question All Tasks is choosing for, while one is open. */
export type ChoosingFor = 'today' | 'block'

export function AllTasksPane({
  choosingFor,
  blockSelected,
  onBlockTick,
  switcher,
}: {
  choosingFor: ChoosingFor
  /** The block's ticks still in play, for the purpose prompt. */
  blockSelected: readonly string[]
  onBlockTick: (taskId: string, on: boolean) => void
  /** The header's switch between the day and All Tasks. */
  switcher: ReactNode
}) {
  const backlog = useTodayBacklog()
  const today = useSession((s) => s.session.today)
  const intentions = useSession((s) => s.session.intentions)
  const addToToday = useSession((s) => s.addToToday)
  const removeFromToday = useSession((s) => s.removeFromToday)
  const addItem = useTasks((s) => s.addItem)
  const renameItem = useTasks((s) => s.renameItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const completeItem = useTasks((s) => s.completeItem)
  const reopenItem = useTasks((s) => s.reopenItem)
  const renameArea = useTasks((s) => s.renameArea)
  const archiveArea = useTasks((s) => s.archiveArea)
  const archiveItem = useTasks((s) => s.archiveItem)
  const items = useTasks((s) => s.items)
  const replaced = useTasks((s) => s.replaced)
  // A new intention's title while its field is open, on the purpose prompt.
  const [newIntention, setNewIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  // How much of the column today's list takes, on the purpose prompt.
  const [share, setShare] = useState(MIN_SHARE)
  const nameIntention = (title: string | null) => {
    // A field asked for under a folded heading would open out of sight.
    if (newIntention === null && title !== null && share < OPEN_SHARE) setShare(OPEN_SHARE)
    setNewIntention(title)
  }

  // Stable across the clock's tick, so the browser passes the tick by.
  const chooseForToday = useCallback(
    (taskId: string, on: boolean) => (on ? addToToday(taskId) : removeFromToday(taskId)),
    [addToToday, removeFromToday],
  )
  const write = useCallback(
    (parentId: string, title: string) => addItem({ kind: 'task', title, parentId }),
    [addItem],
  )
  const under = useCallback(
    (taskId: string) => {
      const id = today[taskId]
      return typeof id === 'string' ? (intentions.find((i) => i.id === id)?.title ?? null) : null
    },
    [today, intentions],
  )

  // Areas, epics and outcomes, kept from their `⋯`. Per backlog snapshot, so
  // the browser passes the tick by. An area is never deleted from here.
  const places = useMemo<PlaceActions>(
    () => ({
      rename: (node, name) =>
        node.kind === 'area' ? renameArea(node.id, name) : renameItem(node.id, name),
      add: (parentId, kind, title) => addItem({ kind, title, parentId }),
      complete: (node) => node.kind !== 'area' && completeItem(node.id),
      archive: (node) => (node.kind === 'area' ? archiveArea(node.id) : archiveItem(node.id)),
      remove: (node) => node.kind !== 'area' && deleteItem(node.id),
      inside: (node) => (node.kind === 'area' ? 0 : liveDescendantsOf(node.id, items).length),
    }),
    [renameArea, renameItem, addItem, completeItem, archiveArea, archiveItem, deleteItem, items],
  )

  const forToday = choosingFor === 'today'
  return (
    // The calendar's own frame and header, so the two views read as one column
    // turned over rather than as a panel laid over it.
    <aside
      id="all-tasks"
      aria-label="All Tasks"
      className="min-w-0 flex flex-col rounded-2xl border border-line bg-surface lg:h-full lg:min-h-0"
    >
      <header className="flex flex-wrap items-center justify-between gap-y-1 border-b border-line px-4 py-3">
        <h2 className="sr-only">All Tasks</h2>
        {switcher}
        <span className="text-xs text-muted">
          {forToday ? 'Tick to choose for today' : 'Tick for this block'}
        </span>
      </header>
      <div className="mono-scroll px-1.5 pt-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {!backlog.hydrated ? (
          <p className="px-2.5 py-3 text-sm text-muted">Loading your tasks…</p>
        ) : (
          // Keyed by the backlog's replacements as well as the session's
          // generation above: a rename half typed names a task by id, and an
          // import in another tab can bring that id back saying something else.
          // Everything in it goes, a task half written included, unlike the
          // tasks page's Add fields: this column is a question's, gone when the
          // question closes, and an import in this tab already clears all of it
          // through the generation. Keeping what is being added only when the
          // import came from another tab would make the rarer case the gentler.
          <TaskBrowser
            key={replaced}
            label={forToday ? 'Tasks for today' : 'Tasks for this block'}
            tree={backlog.pickerTree}
            selected={forToday ? backlog.chosen : blockSelected}
            onToggle={forToday ? chooseForToday : onBlockTick}
            onAdd={write}
            onRename={renameItem}
            onDelete={deleteItem}
            onComplete={completeItem}
            onReopen={reopenItem}
            places={places}
            elsewhere={under}
            draggable
          />
        )}
      </div>
      {!forToday && backlog.hydrated && (
        <>
          <Splitter share={share} onShare={setShare} />
          <section
            id="today-view"
            aria-label="Today's tasks"
            style={{ '--split': `${Math.round(share * 100)}%` } as CSSProperties}
            className="mono-scroll border-t border-line px-4 py-3 lg:min-h-11 lg:shrink-0 lg:basis-[var(--split)] lg:overflow-y-auto lg:border-t-0"
          >
            <TodayList
              heading="Today's tasks"
              newIntention={newIntention}
              onNewIntention={nameIntention}
              renaming={renaming}
              onRenaming={setRenaming}
              empty="Nothing chosen for today yet. Tick a task above."
            />
          </section>
        </>
      )}
    </aside>
  )
}

/**
 * The share of the column today's list takes: none past its heading, which
 * the section's own minimum height keeps, up to most of it. It opens to a
 * third when asked.
 */
const MIN_SHARE = 0
const MAX_SHARE = 0.8
const OPEN_SHARE = 0.35
const clampShare = (share: number) => Math.min(MAX_SHARE, Math.max(MIN_SHARE, share))

/**
 * The line between All Tasks and today's list under it, dragged to give one
 * more of the column. From `lg` up only: below it nothing scrolls inside
 * itself, so there is no height to share. The arrow keys move it a step, and
 * a double press opens the list to a third or folds it back. Its
 * position is the column's own, gone when the prompt closes, like the
 * column's switch.
 */
function Splitter({ share, onShare }: { share: number; onShare: (share: number) => void }) {
  const bar = useRef<HTMLDivElement>(null)

  const follow = (clientY: number) => {
    const column = bar.current?.parentElement
    if (!column) return
    const box = column.getBoundingClientRect()
    onShare(clampShare((box.bottom - clientY) / box.height))
  }

  return (
    <div
      ref={bar}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize today's tasks"
      aria-controls="today-view"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(MIN_SHARE * 100)}
      aria-valuemax={Math.round(MAX_SHARE * 100)}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) follow(e.clientY)
      }}
      onDoubleClick={() => onShare(share > MIN_SHARE ? MIN_SHARE : OPEN_SHARE)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0
        if (step === 0) return
        e.preventDefault()
        onShare(clampShare(share + step))
      }}
      className="group/split hidden h-3 shrink-0 cursor-row-resize touch-none items-center justify-center border-t border-line focus:outline-none lg:flex"
    >
      <span className="h-1 w-10 rounded-full bg-line transition group-hover/split:bg-muted group-focus-visible/split:bg-deep" />
    </div>
  )
}

/**
 * The column's two views, as a pair of pressed buttons in its header. Shown
 * only while a question that chooses tasks is open; the rest of the time the
 * column is the day and says so with its own heading.
 */
export function ColumnSwitch({
  view,
  onView,
}: {
  view: ColumnView
  onView: (view: ColumnView) => void
}) {
  const option = (value: ColumnView, name: string) => (
    <button
      type="button"
      onClick={() => onView(value)}
      aria-pressed={view === value}
      className={`rounded-md px-2 py-0.5 text-xs font-medium tracking-widest uppercase transition ${
        view === value ? 'bg-surface-raised text-bright' : 'text-muted hover:text-bright'
      }`}
    >
      {name}
    </button>
  )
  return (
    <div role="group" aria-label="Show in this column" className="-ml-2 flex items-center gap-1">
      {option('day', 'Today')}
      {option('tasks', 'All Tasks')}
    </div>
  )
}
