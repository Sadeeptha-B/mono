/**
 * Today's tasks, gathered under the intentions some of them are given, and the
 * field that names a new intention.
 *
 * Shared by the opening question, the tasks page, and All Tasks' column while
 * the purpose prompt is open (`AllTasksPane`), which all say what today is,
 * so they read it from the session themselves rather than each being handed
 * it.
 *
 * The intentions come first, right under the field that names them, then the
 * tasks under none. Each intention is a place a task can be carried to —
 * dragged by its row, or picked up with its grip and put down with `Move here`
 * (`carry.tsx`) — and the list after them is the place for a task under none,
 * which is where every task starts. It carries no heading of its own: it is
 * simply today, and the intentions above are what is apart from it. An empty
 * intention is one line, its hint beside its name, so naming one before any
 * task is dragged adds a row rather than a block. An intention is named by
 * title alone and filled by carrying tasks in: written title first, with
 * nothing scoped yet, it came out as the name of an epic the backlog already
 * had, while carrying today's own tasks into a name asks it to describe
 * something already chosen.
 *
 * The carrying is `TodayCarry`'s, which the caller puts around this list and
 * anything else that can hand it a task. Beside All Tasks that is the backlog
 * too: a task dragged from there into an intention is chosen for today and
 * grouped in one move, and dropped on today's own list it is only chosen.
 *
 * A new intention is asked for with `+ Intention` level with the list's
 * heading, as `+ Task` sits in a place's menu in the backlog, and written right
 * under the button that asked for it: an empty intention, dashed, at the head
 * of the list, its name a bare field with a ✓ and a ×. Kept, it takes its
 * place after the others. A day needs no intention, so nothing about one
 * stands on the question until it is asked for. Enter keeps it and leaves an
 * empty one for the next, ✓ keeps it and closes, and × or Escape close without
 * keeping anything, handing focus back to `+ Intention`. An intention is drawn
 * as a level of the same tree as the places, with only a fine border to mark
 * it, rather than as one more kind of box.
 *
 * Every task sits under the places it lives in (`GroupedTasks`), each place
 * said once, so an intention gathering tasks from two areas shows both. A
 * place's heading carries what it heads in that group into another, all at
 * once (`PlaceHeading`), and an epic or outcome dragged in from All Tasks
 * brings everything open in it (`Bundle`): grouping an outcome's worth of work
 * is one move rather than one per task. An epic's or outcome's heading can
 * also be made an intention of its own name (`MakeIntention`), since an
 * intention so often turns out to be one outcome of an epic, or near an epic's
 * end the epic itself, and its × takes all it heads out of today. Tasks
 * finished today stay, crossed out after the open ones of their place, because
 * the list is also the day's progress; they are not carried, since there is
 * nothing left to plan about them. A task taken out with its × leaves today
 * and its intention, and stays in the backlog.
 *
 * Beside the purpose prompt, and while a block runs, an intention also takes
 * a box for the block (`forBlock`), the one All Tasks gives an epic or outcome
 * (`PlaceTick`): it ticks every open task under it at once, and the prompt
 * then names the purpose after it (`purposeParts`). The day's intentions were
 * written to say what its blocks would be for, and choosing one a task at a
 * time in the tree, then typing its name again as the purpose, was that work
 * done twice. Ticking stays the column's: the box is on today's list here,
 * not on the stage, which still lists only what is ticked.
 *
 * Deleting an intention leaves its tasks today, under none: removing a name is
 * not deciding against the work it named. Marking one done is the ring in
 * front of it (`IntentionDoneToggle`), by hand, and touches no task.
 *
 * Both drafts — the new intention's title and a rename — are held by the
 * caller, as the opening question holds its other drafts, so moving between
 * the questions loses nothing: that question draws this list only while it is
 * on screen. A rename held here went with the list, and came back as the old
 * name. `useIntentionRename` holds one, and closes it before paint if its
 * intention goes — the rule every editor in Mono keeps.
 */

import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  Carry,
  CarryGrip,
  CarryStatus,
  DropZone,
  MoveHere,
  useCarriedRow,
  useCarryState,
  type Carried,
  type CarryHand,
  type CarryMode,
  type CarryPayload,
} from './carry'
import { PlaceTick } from './allTasks/rows'
import { GroupedTasks } from './GroupedTasks'
import { DeleteIcon, DoneRingIcon, IntendIcon } from './icons'
import { useTodayBacklog } from './useTodayBacklog'
import { EditGlyph, IconButton, KeepField, RenameField, revealOnHover } from './ui'
import {
  deepestHolding,
  openTasksBeneath,
  tasksIn,
  type Item,
  type TaskTreeNode,
} from '@/domain/tasks'
import {
  intentionNamed,
  isToday,
  tasksOfIntention,
  ungroupedToday,
  type Today,
} from '@/domain/today'
import type { Intention } from '@/domain/types'
import { useSession } from '@/store/session'

/** The place a task under no intention is carried to. Never an intention's id. */
const NOT_GROUPED = ':not-grouped'

/**
 * The purpose prompt's own list, a place a task is carried to as well: put
 * down there, it is ticked for the block being named (`TodayCarry`'s
 * `blockPicked`). Never an intention's id.
 */
export const FOR_BLOCK = ':for-block'

/**
 * Everything open in a place, carried as one into an intention: an epic or
 * outcome dragged from All Tasks, which brings all of it, chosen for today or
 * not; or a place's heading in today's own list, which brings the tasks it
 * heads there — the tasks in that place in that one group, and no others, so
 * grouping what the day has chosen never chooses more.
 *
 * A heading's bundle also says the group it heads part of (`from`): what it
 * heads there can change while it is held, and the heading drawn over it with
 * it, so where the keyboard's focus goes back to is asked of that group then.
 */
type Bundle = { id: string; title: string; taskIds: readonly string[]; from?: string }
type TodayCarried = Item | Bundle
const isBundle = (carried: TodayCarried): carried is Bundle => 'taskIds' in carried

/**
 * A heading's key: the group it heads part of — an intention, or none — and
 * the place. Compared, never read back: what a heading carries is its payload.
 */
const headingKey = (group: string, placeId: string) => `heading:${group}:${placeId}`

/**
 * The key of the heading some tasks now sit under in a group, as it is drawn
 * there, for the keyboard's focus to follow them to; null when no heading
 * holds them all, so the focus waits for nothing. Read from the day as it is after the move, since that is
 * what decides which heading it is: one already drawn, or a deeper one than
 * they came from (`deepestHolding`) — an epic whose own task was finished
 * today arrives as its outcome alone. The heading they left is no guide: its
 * grip may not be drawn there at all, and a focus waiting on a key nothing
 * draws waits for whatever draws it next.
 */
function headingLandedOn(
  group: (taskIds: readonly string[]) => readonly TaskTreeNode[],
  target: string,
  taskIds: readonly string[],
): string | null {
  const after = useSession.getState().session.today
  const inGroup = target === NOT_GROUPED ? ungroupedToday(after) : tasksOfIntention(target, after)
  const landed = deepestHolding(group(inGroup), taskIds)
  return landed === null ? null : headingKey(target, landed.id)
}

type PlaceEntry = { name: string; kind: TaskTreeNode['kind']; open: readonly string[] }

/** Every place in the tree, by id, with everything open beneath it. */
function placeIndex(tree: readonly TaskTreeNode[]): ReadonlyMap<string, PlaceEntry> {
  const open = openTasksBeneath(tree)
  const index = new Map<string, PlaceEntry>()
  const walk = (node: TaskTreeNode) => {
    index.set(node.id, { name: node.name, kind: node.kind, open: open.get(node.id) ?? [] })
    node.children.forEach(walk)
  }
  tree.forEach(walk)
  return index
}

/** The bundle a payload names, or undefined when nothing in it is open. */
function bundleOf(
  carried: Carried,
  payload: CarryPayload,
  by: CarryMode,
  places: ReadonlyMap<string, PlaceEntry>,
  today: Today,
): Bundle | undefined {
  const place = places.get(payload.placeId)
  if (!place) return undefined
  const title = `tasks in ${place.name}`
  if (payload.kind === 'heading') {
    const inPlace = new Set(place.open)
    const inGroup =
      payload.group === NOT_GROUPED ? ungroupedToday(today) : tasksOfIntention(payload.group, today)
    const taskIds = inGroup.filter((taskId) => inPlace.has(taskId))
    return taskIds.length > 0 ? { id: carried.id, title, taskIds, from: payload.group } : undefined
  }
  // A place is carried from All Tasks only, by drag; an area is too much of a
  // life to carry at once.
  if (by !== 'drag' || place.kind === 'area') return undefined
  return place.open.length > 0 ? { id: carried.id, title, taskIds: place.open } : undefined
}

/** An intention being renamed, and the name typed so far. */
export type IntentionRename = { id: string; title: string }

/**
 * A rename of one of today's intentions, for whichever component outlives
 * `TodayList` on its surface. Let go for good, during render, once its
 * intention has gone; a new session's drafts go with the remount every host
 * already keys on the generation.
 */
export function useIntentionRename() {
  const intentions = useSession((s) => s.session.intentions)
  const [renaming, setRenaming] = useState<IntentionRename | null>(null)
  if (renaming && !intentions.some((i) => i.id === renaming.id)) setRenaming(null)
  return [renaming, setRenaming] as const
}

/**
 * Carrying tasks into today's intentions, for `TodayList` and whatever is
 * drawn beside it inside this provider.
 *
 * Any open task in play can be carried, chosen for today or not. Into an
 * intention, it is grouped there, and chosen if it was not (`linkTask` implies
 * choosing); onto `Not grouped`, a task of today's leaves its intention and one
 * from the backlog is simply chosen. A task already where it is dropped is not
 * taken. One finished or gone while held is put down (see `carry.tsx`), and so
 * is a pick-up whose task leaves today: it was picked up from today's row,
 * which has gone.
 *
 * A carry also ends with what it was begun in, which is not always this
 * provider's own mount. `App` holds it around both columns for as long as the
 * app is open, while the places a task goes are drawn only while a question
 * chooses tasks; held past that, the status bar kept asking for a `Move here`
 * nowhere on screen, into the block. So the caller names what the carry
 * belongs to as `scope` — `App` the question and the session — and a change
 * puts down whatever is in hand. A provider remounted with what it serves
 * needs none.
 *
 * While the purpose prompt is open the block being named is one more place
 * (`FOR_BLOCK`), given as what it has ticked (`blockPicked`) and how to tick
 * more (`onPickForBlock`). Anything that can be carried into an intention can
 * be carried there — a task or a place's row from All Tasks, a task or a
 * heading from today's list — and putting it down ticks what it holds for
 * the block, as its box would, and groups nothing: the box ticks the whole of
 * a place or an intention, and a drag is how part of one is taken without
 * ticking a task at a time. It takes anything not all ticked already. Only
 * the prompt: a running block changes its tasks in All Tasks alone.
 */
export function TodayCarry({
  children,
  hand,
  scope,
  blockPicked,
  onPickForBlock,
}: {
  children: ReactNode
  hand?: CarryHand
  scope?: string
  /** What the purpose prompt has ticked, while it is open; the block takes nothing else. */
  blockPicked?: readonly string[] | undefined
  onPickForBlock?: ((taskIds: readonly string[], on: boolean) => void) | undefined
}) {
  const backlog = useTodayBacklog()
  const today = useSession((s) => s.session.today)
  const linkTask = useSession((s) => s.linkTask)
  const linkTasks = useSession((s) => s.linkTasks)
  const addToToday = useSession((s) => s.addToToday)

  const taskById = backlog.task
  const group = backlog.group
  const places = useMemo(() => placeIndex(backlog.pickerTree), [backlog.pickerTree])
  // Changes with the day or the backlog, not the clock, so the carry asks it
  // again only then and a bundle in hand keeps its identity across the tick.
  const find = useCallback(
    (carried: Carried, by: CarryMode): TodayCarried | undefined => {
      if (carried.payload) return bundleOf(carried, carried.payload, by, places, today)
      const task = taskById(carried.id)
      // Only today's rows have a grip; a drag may come from All Tasks.
      const inPlace = by === 'drag' || isToday(today, carried.id)
      return task?.status === 'open' && inPlace ? task : undefined
    },
    [taskById, today, places],
  )
  const picked = useMemo(
    () => (blockPicked === undefined ? null : new Set(blockPicked)),
    [blockPicked],
  )
  const takes = useCallback(
    (carried: TodayCarried, target: string) => {
      const ids = isBundle(carried) ? carried.taskIds : [carried.id]
      if (target === FOR_BLOCK) return picked !== null && ids.some((id) => !picked.has(id))
      return ids.some((id) => !isToday(today, id) || (today[id] ?? NOT_GROUPED) !== target)
    },
    [today, picked],
  )
  const move = useCallback(
    (carried: TodayCarried, target: string) => {
      if (target === FOR_BLOCK) {
        const ids = isBundle(carried) ? carried.taskIds : [carried.id]
        onPickForBlock?.(ids.filter((id) => !picked?.has(id)), true)
        // Nothing moved, so a pick-up's focus goes back to the row it came
        // from. A task's row is where it was. A heading may not be: what it
        // heads can have changed while it was held — an epic whose own task
        // left today folds into its one outcome's line — so the focus goes to
        // the heading over its tasks in that group now, or nowhere.
        if (!isBundle(carried) || carried.from === undefined) return
        return headingLandedOn(group, carried.from, carried.taskIds)
      }
      if (isBundle(carried)) {
        linkTasks(carried.taskIds, target === NOT_GROUPED ? null : target)
        return headingLandedOn(group, target, carried.taskIds)
      }
      if (target !== NOT_GROUPED) linkTask(carried.id, target)
      else if (isToday(today, carried.id)) linkTask(carried.id, null)
      else addToToday(carried.id)
    },
    [today, group, linkTask, linkTasks, addToToday, picked, onPickForBlock],
  )
  const carry = useCarryState({ find, takes, move, hand })
  // Adjusted during render, so the stale bar is never painted.
  const [seenScope, setSeenScope] = useState(scope)
  if (seenScope !== scope) {
    setSeenScope(scope)
    carry.putDown()
  }

  return (
    <Carry.Provider value={carry}>
      {children}
      <CarryStatus />
    </Carry.Provider>
  )
}

/**
 * What the block being named, or running, has ticked, and how a whole
 * intention is ticked for it — the same tick-many All Tasks' boxes use.
 */
export type IntentionTicks = {
  selected: readonly string[]
  onTickMany: (taskIds: readonly string[], on: boolean) => void
  /** While a block runs: its last task cannot be let go (`PlaceTick`). */
  keepsOne: boolean
}

export function TodayList({
  newIntention,
  onNewIntention,
  renaming,
  onRenaming,
  empty,
  heading,
  forBlock,
}: {
  /** The new intention's title while its field is open, or null while folded. */
  newIntention: string | null
  onNewIntention: (title: string | null) => void
  /** The rename in progress, from `useIntentionRename`. */
  renaming: IntentionRename | null
  onRenaming: (rename: IntentionRename | null) => void
  /** What an empty day says, which depends on where the ways in are. */
  empty: string
  /**
   * The list's heading, with `+ Intention` level with it: text for the
   * stage's own small heading, or the caller's heading element where the page
   * already styles its sections.
   */
  heading: ReactNode
  /** Beside the purpose prompt or a running block, a box on each intention ticks it for the block. */
  forBlock?: IntentionTicks
}) {
  const backlog = useTodayBacklog()
  const today = useSession((s) => s.session.today)
  const intentions = useSession((s) => s.session.intentions)
  const removeFromToday = useSession((s) => s.removeFromToday)
  const addIntention = useSession((s) => s.addIntention)
  const updateIntention = useSession((s) => s.updateIntention)
  const removeIntention = useSession((s) => s.removeIntention)
  const { held, takes } = useContext(Carry)

  // Grouped per change to the day or the backlog, not per tick.
  const group = backlog.group
  const groups = useMemo(
    () => ({
      byIntention: new Map(intentions.map((i) => [i.id, group(tasksOfIntention(i.id, today))])),
      none: group(ungroupedToday(today)),
    }),
    [intentions, today, group],
  )
  // What each intention's box ticks: its tasks still open and in play, as an
  // epic's box ticks only what is open in it.
  const offered = backlog.offered
  const openOf = useMemo(() => {
    const open = new Set(offered)
    return new Map(
      intentions.map((i) => [i.id, tasksOfIntention(i.id, today).filter((id) => open.has(id))]),
    )
  }, [intentions, today, offered])
  const blockSelected = forBlock?.selected
  const ticked = useMemo(() => new Set(blockSelected), [blockSelected])

  const opener = useRef<HTMLButtonElement>(null)
  /** Close the new intention without keeping it, and hand focus back. */
  const closeNew = () => {
    onNewIntention(null)
    opener.current?.focus()
  }
  /** Keep the intention typed: Enter leaves an empty one for the next, ✓ closes. */
  const addNamed = (then: 'next' | 'done') => {
    const title = newIntention?.trim() ?? ''
    if (title !== '') addIntention({ title })
    if (then === 'next') onNewIntention('')
    else closeNew()
  }

  const renderTask = (task: Item) => (
    <TodayTaskRow task={task} onRemove={() => removeFromToday(task.id)} />
  )
  // A place's heading in one group carries that group's tasks in it.
  const placeIn =
    (group: string) =>
    (node: TaskTreeNode, line: string, className: string, folded: readonly TaskTreeNode[]) => (
      <PlaceHeading
        group={group}
        node={node}
        folded={folded}
        line={line}
        className={className}
        grouped={backlog.group}
      />
    )
  const nothingChosen = backlog.chosen.length === 0

  const addButton = (
    <button
      ref={opener}
      type="button"
      onClick={() => onNewIntention(newIntention ?? '')}
      aria-label="Add intention"
      className="shrink-0 text-[13px] text-muted transition hover:text-bright"
    >
      + Intention
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        {typeof heading === 'string' ? (
          <h3 className="text-[13px] font-medium tracking-wide text-muted uppercase">{heading}</h3>
        ) : (
          heading
        )}
        {addButton}
      </div>

      {newIntention !== null && (
        <NewIntention
          value={newIntention}
          onChange={onNewIntention}
          onEnter={() => addNamed('next')}
          onKeep={() => addNamed('done')}
          onCancel={closeNew}
        />
      )}

      {intentions.map((intention) => {
        const tasks = groups.byIntention.get(intention.id) ?? []
        const done = intention.done === true
        return (
          <DropZone key={intention.id} target={intention.id} className="min-w-0">
            {/* A level of the same tree as the places: its name as a heading,
                what it holds beneath, and only a fine border to say it is an
                intention rather than somewhere the tasks live. */}
            <section
              aria-label={`Intention: ${intention.title}`}
              className={`rounded-md border border-line px-2 py-1.5 ${done ? 'opacity-70' : ''}`}
            >
              {renaming?.id === intention.id ? (
                <RenameField
                  label={`Rename intention ${intention.title}`}
                  value={renaming.title}
                  onChange={(title) => onRenaming({ id: intention.id, title })}
                  onSave={() => {
                    updateIntention(intention.id, { title: renaming.title.trim() })
                    onRenaming(null)
                  }}
                  onCancel={() => onRenaming(null)}
                  textClass="text-[15px]"
                />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  {forBlock && (
                    // Held at the top of the heading's first line, as a tree
                    // row holds its box, whether or not it has a note to say.
                    <span className="flex shrink-0 self-start">
                      <PlaceTick
                        name={intention.title}
                        label={`All of ${intention.title} for this block`}
                        taskIds={openOf.get(intention.id) ?? []}
                        selected={ticked}
                        onToggle={forBlock.onTickMany}
                        keepsOne={forBlock.keepsOne}
                        boxClass="mt-[5px]"
                      />
                    </span>
                  )}
                  <IntentionDoneToggle
                    intention={intention}
                    onToggle={() => updateIntention(intention.id, { done: !done })}
                  />
                  <h3
                    className={`min-w-0 flex-1 text-[15px] wrap-break-word ${
                      done ? 'text-muted line-through' : 'text-bright'
                    }`}
                  >
                    {intention.title}
                    {/* Empty, the hint sits beside the name rather than on a
                        line of its own, so an empty intention is one line. */}
                    {tasks.length === 0 && (
                      <span className="ml-2 text-xs text-muted no-underline">drag tasks here</span>
                    )}
                  </h3>
                  <IconButton
                    onClick={() => onRenaming({ id: intention.id, title: intention.title })}
                    label={`Rename intention ${intention.title}`}
                    hint="Rename"
                    className="-my-1"
                  >
                    <EditGlyph />
                  </IconButton>
                  {/* At once: its tasks stay today's, under none. */}
                  <IconButton
                    danger
                    onClick={() => removeIntention(intention.id)}
                    label={`Delete intention ${intention.title}`}
                    hint="Delete"
                    className="-my-1 -mr-1.5"
                  >
                    <DeleteIcon />
                  </IconButton>
                </div>
              )}
              {/* Under the title rather than the ring, without a guide line of
                  its own: the border already says what the places inside are
                  under, and a line there was one more beside theirs. */}
              {(tasks.length > 0 || held?.by === 'pick') && (
                <div className="mt-1 pl-5">
                  <MoveHere target={intention.id} name={intention.title} />
                  {tasks.length > 0 && (
                    <GroupedTasks
                      label={`Tasks for ${intention.title}`}
                      groups={tasks}
                      renderTask={renderTask}
                      renderPlace={placeIn(intention.id)}
                      gutter="wide"
                      placeText="text-sm"
                    />
                  )}
                </div>
              )}
            </section>
          </DropZone>
        )
      })}

      {nothingChosen && <p className="text-sm text-muted">{empty}</p>}

      {/* Under no intention: today itself, so it carries no heading. Shown
          while it holds something, or while something could be dropped on it:
          a task of today's leaving its intention, or one from the backlog being
          chosen. */}
      {(groups.none.length > 0 ||
        (held !== null && (intentions.length > 0 || takes(NOT_GROUPED)))) && (
        <DropZone target={NOT_GROUPED} className="min-w-0">
          <section aria-label={intentions.length > 0 ? 'Not grouped' : 'Chosen today'}>
            <MoveHere target={NOT_GROUPED} name="no intention" />
            {groups.none.length > 0 ? (
              <GroupedTasks
                label={intentions.length > 0 ? 'Tasks not grouped' : 'Tasks chosen today'}
                groups={groups.none}
                renderTask={renderTask}
                renderPlace={placeIn(NOT_GROUPED)}
                gutter="wide"
                placeText="text-sm"
              />
            ) : (
              <p className="py-1 text-xs text-muted">Drop here to keep it under no intention.</p>
            )}
          </section>
        </DropZone>
      )}
    </div>
  )
}

/**
 * One of today's tasks: the grip that carries it between intentions, its
 * title, and the × that takes it out of today — shown on hover or with focus
 * in the row, and always on a touch screen, as a row's actions are on the
 * tasks page: at rest the list reads as what the day is for. Finished today, it is crossed
 * out and stays where it is, with nothing to carry.
 *
 * The grip hangs in the gutter `GroupedTasks` leaves between its guide line
 * and its rows, so the title starts where a place's name beside it starts. In
 * line with the title it pushed every task a grip's width further in than the
 * places around it, and a task read as nested one level deeper than it was.
 */
function TodayTaskRow({ task, onRemove }: { task: Item; onRemove: () => void }) {
  const open = task.status === 'open'
  const { picked, dragProps } = useCarriedRow(task, open)
  return (
    <div
      {...(open ? dragProps : {})}
      className={`group/row relative flex items-start gap-1.5 rounded-md text-[15px] ${
        picked ? 'bg-surface/60 outline-1 outline-deep/70 outline-dashed' : ''
      }`}
    >
      {open && <CarryGrip task={task} className="absolute top-1 -left-4" />}
      <span
        className={`min-w-0 flex-1 wrap-break-word ${open ? 'text-body' : 'text-muted line-through'}`}
      >
        {task.title}
        {!open && <span className="sr-only">, done today</span>}
      </span>
      {/* Out of today, not out of the backlog. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Take ${task.title} out of today`}
        title="Not today"
        className={`shrink-0 px-1 text-muted transition hover:text-bright ${revealOnHover}`}
      >
        ×
      </button>
    </div>
  )
}

/**
 * A place's heading in one group of today's list — an intention, or none —
 * which carries the open tasks it heads there into another, all at once:
 * dragged by the heading, or picked up with the grip at its end and put down
 * with `Move here`. The grip shows on hover or with focus in the line, as a
 * row's actions do, since most of the time a heading is only read; a heading
 * over nothing open has none.
 *
 * An epic's or outcome's heading also has an × at the end of its line, level
 * with its tasks' own, which takes everything it heads in that group out of
 * today, finished tasks too (`tasksIn`): the whole of a place was otherwise
 * let go only by unticking its box in All Tasks, which takes it out of every
 * group at once, or a task at a time here. An area's heading has none, as an
 * area has no box: that is a whole part of a life at once.
 */
function PlaceHeading({
  group,
  node,
  folded,
  line,
  className,
  grouped,
}: {
  group: string
  node: TaskTreeNode
  /** The places folded into its line ahead of it, outermost first. */
  folded: readonly TaskTreeNode[]
  line: string
  className: string
  /** Today's tasks under their places, for where a gathered heading lands. */
  grouped: (taskIds: readonly string[]) => readonly TaskTreeNode[]
}) {
  const removeAllFromToday = useSession((s) => s.removeAllFromToday)
  const carried: Carried = {
    id: headingKey(group, node.id),
    title: `tasks in ${node.name}`,
    payload: { kind: 'heading', group, placeId: node.id },
  }
  const open = holdsOpen(node)
  const { picked, dragProps } = useCarriedRow(carried, open)
  // The line's outermost epic or outcome is what it can be made an intention
  // of. On a line folded over an epic's one outcome that is the epic: it is
  // the commonest shape near an epic's end, which is when naming the epic
  // helps, and two rings side by side differed only in their hints. The
  // outcome is still named from its own line wherever the epic holds more.
  const nameable = [...folded, node].find((place) => place.kind !== 'area')
  return (
    <div
      {...(open ? dragProps : {})}
      className={`group/row flex min-w-0 items-center gap-1 rounded-md ${open ? 'cursor-grab' : ''} ${
        picked ? 'bg-surface/60 outline-1 outline-deep/70 outline-dashed' : ''
      }`}
    >
      <span className={`min-w-0 ${className}`}>{line}</span>
      {open && nameable && <MakeIntention group={group} place={nameable} heading={node} grouped={grouped} />}
      {open && <CarryGrip task={carried} className={picked ? '' : revealOnHover} />}
      {node.kind !== 'area' && (
        // Out of today, not out of the backlog, as a task's × is.
        <button
          type="button"
          onClick={() => removeAllFromToday(tasksIn(node))}
          aria-label={`Take everything in ${node.name} out of today`}
          title="Not today"
          className={`ml-auto shrink-0 px-1 text-[15px] text-muted transition hover:text-bright ${revealOnHover}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

/**
 * The button on an epic's or outcome's heading that makes it an intention:
 * named after the place, holding the open tasks the heading heads in its
 * group — what carrying the heading would take, and no more, so making an
 * intention never chooses anything (`gatherUnder`). Where an open intention
 * already has the place's name, it fills that one instead, so a second press
 * after more of it is ticked does not name it twice; inside that intention it
 * is not offered, having nothing left to do there.
 *
 * `place` is what it names and `heading` the place the line ends with, whose
 * tasks it gathers. They differ only on a line folded over an epic's one
 * outcome, where the epic is named and holds nothing in the group beyond
 * that outcome's tasks.
 *
 * The heading it was pressed on leaves its group, so the focus follows to the
 * grip of the heading its tasks land under in the intention, as a pick-up's
 * does when it lands (`headingLandedOn`). Not necessarily the same place: an
 * epic whose own task was finished today leaves it behind, and arrives as its
 * one outcome's heading.
 */
function MakeIntention({
  group,
  place,
  heading,
  grouped,
}: {
  group: string
  place: TaskTreeNode
  heading: TaskTreeNode
  grouped: (taskIds: readonly string[]) => readonly TaskTreeNode[]
}) {
  const intentions = useSession((s) => s.session.intentions)
  const gatherUnder = useSession((s) => s.gatherUnder)
  const { landed } = useContext(Carry)
  const into = intentionNamed(intentions, place.name)
  if (into?.id === group) return null
  const level = place.kind === 'epic' ? 'epic' : 'outcome'
  return (
    <IconButton
      onClick={() => {
        // Cut from this group by the list, so these are its tasks in this place.
        const taskIds = openTasksBeneath([heading]).get(heading.id) ?? []
        const id = gatherUnder(place.name, taskIds)
        landed.current = headingLandedOn(grouped, id, taskIds)
      }}
      label={
        into ? `Move ${place.name} into intention ${into.title}` : `Make ${place.name} an intention`
      }
      hint={into ? 'Move into its intention' : `Make the ${level} an intention`}
      className={`-my-1 ${revealOnHover}`}
    >
      <IntendIcon />
    </IconButton>
  )
}

const holdsOpen = (node: TaskTreeNode): boolean =>
  node.tasks.some((t) => t.status === 'open') || node.children.some(holdsOpen)

/**
 * A new intention written where it will stand: dashed, its ring faint, its
 * name a bare field with a ✓ and a × (`KeepField`).
 */
function NewIntention({
  value,
  onChange,
  onEnter,
  onKeep,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5">
      <DoneRingIcon done={false} className="text-muted/50" />
      <KeepField
        value={value}
        onChange={onChange}
        onEnter={onEnter}
        onKeep={onKeep}
        onCancel={onCancel}
        placeholder="Name an intention, then drag tasks into it"
        label="New intention"
        keepLabel="Keep the new intention"
        cancelLabel="Cancel new intention"
        // Opened by a press asking for exactly this field.
        autoFocus
        inputClassName="min-w-0 flex-1 bg-transparent text-[15px] text-bright placeholder:text-muted/80 focus:outline-none"
      />
    </div>
  )
}

/**
 * The ring in front of an intention that marks it done, and reopens it.
 *
 * Offered wherever intentions are kept — the opening question, the column
 * beside the purpose prompt and the tasks page — because whether the day has
 * had what it wanted from an intention is the user's to say, at whichever of
 * them they notice it. Nothing decides it for them: not its tasks running out,
 * which can happen with the intention unmet, and not a block. It is one patch
 * on the intention and touches none of its tasks, so reopening it puts back
 * exactly what was there. A done intention stays where it was in the list,
 * crossed out, rather than moving under the pointer that just ticked it.
 */
function IntentionDoneToggle({
  intention,
  onToggle,
}: {
  intention: Intention
  onToggle: () => void
}) {
  const done = intention.done === true
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? `Reopen intention ${intention.title}` : `Mark intention ${intention.title} done`}
      title={done ? 'Reopen' : 'Mark done'}
      className={`inline-flex shrink-0 translate-y-0.5 items-center justify-center transition hover:text-bright ${
        done ? 'text-deep' : 'text-muted'
      }`}
    >
      <DoneRingIcon done={done} />
    </button>
  )
}
