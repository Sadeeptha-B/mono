/**
 * The backlog's board: each area a band split by a rule, its epics and inbox
 * down the left, and level with each, its outcomes as columns of tasks. Every
 * row and card here is carried by the board's carry (`Backlog`), dragged
 * between rows to put it in order, or stepped with its arrows.
 */

import { useRef, useState, type ReactNode } from 'react'

import {
  CarryGrip,
  DropZone,
  MoveHere,
  SlotMark,
  slotAttrs,
  TOP,
  useCarriedRow,
  useDropList,
  useSlotEdge,
} from '../carry'
import { ArchiveIcon, CheckIcon, DeleteIcon, DropIcon, MoveIcon, TodayIcon } from '../icons'
import { EditGlyph, IconButton, RenameField, revealOnHover, useRefocus } from '../ui'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import { childrenOf, openTasksUnder, type Area, type Item } from '@/domain/tasks'
import { isToday, type Today } from '@/domain/today'
import { DeleteButton, liveInside } from './DeleteButton'
import { PutAway } from './PutAway'
import { AddForm } from './addFields'

/**
 * The bands, in order. One rule above the first and one under each, so every
 * area reads as its own band and the last is closed off from the control that
 * adds another. An area is dragged up or down by its name; inside the board's
 * carry, since that is what carries it.
 */
export function AreaList({ areas, ...tree }: TreeProps & { areas: readonly Area[] }) {
  return (
    <div className="mt-8 border-t border-line" {...useDropList(TOP, ['area'])}>
      {areas.map((area, i) => (
        <AreaBand
          key={area.id}
          area={area}
          first={i === 0}
          last={i === areas.length - 1}
          {...tree}
        />
      ))}
    </div>
  )
}

/** Shared down the tree: everything a task row or a card needs to act. */
type TreeProps = {
  items: readonly Item[]
  /** Today's tasks, for the sun on each row and card. */
  today: Today
  /** Every open task in play beneath each epic and outcome, for the sun on its card. */
  beneath: ReadonlyMap<string, readonly string[]>
}

/**
 * One area as a band: a row for its name and its actions, a row for each open
 * epic, a row to add another, and its inbox last.
 *
 * Every row is the same two-column grid, and the left cell of each carries the
 * dividing rule, so rows stacked without gaps draw one unbroken line down the
 * band. One grid holding every row would draw the same picture, but it could
 * not make an epic's row a single region holding both its card and its board.
 *
 * The band is a row of the list of areas and the list of its own epics at
 * once: an area dragged over it falls through to the list of areas, and an
 * epic is taken here.
 */
function AreaBand({
  area,
  first,
  last,
  ...tree
}: TreeProps & { area: Area; first: boolean; last: boolean }) {
  const renameArea = useTasks((s) => s.renameArea)
  const archiveArea = useTasks((s) => s.archiveArea)
  const deleteArea = useTasks((s) => s.deleteArea)
  const shiftArea = useTasks((s) => s.shiftArea)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { dragProps } = useCarriedRow({ id: area.id, title: area.name }, renaming === null)
  const edge = useSlotEdge(TOP, 'area', area.id, last)
  const epicDrop = useDropList(area.id, ['epic'])

  const children = childrenOf(area.id, tree.items)
  const epics = children.filter((i) => i.kind === 'epic')
  const openEpics = epics.filter(isOpenContainer)
  const putAway = epics.filter((e) => !isOpenContainer(e))

  return (
    <div {...slotAttrs('area', area.id)} {...epicDrop} className="relative border-b border-line py-2">
      <SlotMark edge={edge} />
      <Row
        className="group/row"
        side={
          // A rename puts a form where the heading was, since a form cannot
          // sit inside a heading. The heading is what drags the band.
          renaming === null ? (
            <h2 {...dragProps} className="cursor-grab text-lg text-bright wrap-break-word">
              {area.name}
            </h2>
          ) : (
            <div className="flex">
              <RenameField
                label={`Rename ${area.name}`}
                value={renaming}
                onChange={setRenaming}
                onSave={() => {
                  renameArea(area.id, renaming)
                  setRenaming(null)
                }}
                onCancel={() => setRenaming(null)}
              />
            </div>
          )
        }
      >
        {renaming === null && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 md:justify-end md:pt-0.5">
            <StepButtons
              title={area.name}
              axis="list"
              first={first}
              last={last}
              onStep={(by) => shiftArea(area.id, by)}
            />
            <IconButton
              onClick={() => setRenaming(area.name)}
              label={`Rename ${area.name}`}
              hint="Rename"
              className={revealOnHover}
            >
              <EditGlyph />
            </IconButton>
            <IconButton
              onClick={() => archiveArea(area.id)}
              label={`Archive ${area.name}`}
              hint="Archive"
              className={revealOnHover}
            >
              <ArchiveIcon />
            </IconButton>
            <DeleteButton
              title={area.name}
              inside={liveInside(area.id, tree.items)}
              onDelete={() => deleteArea(area.id)}
              className={revealOnHover}
            />
          </div>
        )}
      </Row>

      {openEpics.map((epic, i) => (
        <EpicRow
          key={epic.id}
          epic={epic}
          first={i === 0}
          last={i === openEpics.length - 1}
          {...tree}
        />
      ))}

      <Row
        side={
          <AddForm
            draftKey={`epic:${area.id}`}
            opener="Add epic"
            openerLabel={`Add an epic to ${area.name}`}
            label={`New epic in ${area.name}`}
            placeholder="A new epic"
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'epic', title, parentId: area.id })
            }
          />
        }
      />

      <Row side={<h3 className="text-sm text-body md:pt-2">Inbox</h3>}>
        <Board>
          <DropZone target={area.id} className="min-w-0">
            <TaskList
              parent={area.id}
              name={area.name}
              listLabel={`${area.name} inbox`}
              empty="The inbox is empty."
              {...tree}
            />
          </DropZone>
        </Board>
        <PutAway items={[...finishedTasks(children), ...putAway]} allItems={tree.items} />
      </Row>
    </div>
  )
}

/**
 * One row of a band: what the area is made of on the left of the rule, what
 * that holds on the right.
 *
 * Named rows are regions, so an epic's card and its board are found together.
 * Below `md` the halves stack, and a short rule down the left of the second
 * half keeps it reading as belonging to the first.
 */
function Row({
  side,
  label,
  slot,
  className = '',
  children,
}: {
  side: ReactNode
  label?: string
  /** Marks the row as one of a list a drag can reorder, and its line if one is drawn on it. */
  slot?: { attrs: ReturnType<typeof slotAttrs>; mark: ReactNode }
  className?: string
  children?: ReactNode
}) {
  const cells = (
    <>
      {slot?.mark}
      <div className="min-w-0 py-2 md:border-r md:border-line md:py-3 md:pr-5">{side}</div>
      {children && (
        <div className="mb-3 ml-1 min-w-0 border-l border-line pl-3 md:mb-0 md:ml-0 md:border-l-0 md:py-3 md:pl-5">
          {children}
        </div>
      )}
    </>
  )
  const layout = `grid md:grid-cols-[14rem_minmax(0,1fr)] ${slot ? 'relative' : ''} ${className}`
  return label === undefined ? (
    <div {...slot?.attrs} className={layout}>
      {cells}
    </div>
  ) : (
    <section {...slot?.attrs} aria-label={label} className={layout}>
      {cells}
    </section>
  )
}

/**
 * Columns side by side that wrap, rather than scroll, when they run out of
 * room — the page never scrolls sideways, and a phone gets one column.
 */
function Board({
  drop,
  children,
}: {
  /** What a row of outcomes takes from a drag, from `useDropList`. */
  drop?: ReturnType<typeof useDropList>
  children: ReactNode
}) {
  return (
    <div {...drop} className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] items-start gap-4">
      {children}
    </div>
  )
}

/**
 * An epic's row: its card on the left; on the right a column for each open
 * outcome, then a slot that adds another beside the last, then a column of the
 * tasks straight under the epic, which needs no card of its own because the
 * epic's is level with it. Below the board, what has been put away.
 *
 * The add slot sits in the row of outcomes rather than under the board because
 * a new outcome is a new column: it appears where the button was. The tasks
 * after it are headed `Tasks`, since a column with nothing at its
 * head read as one more outcome — see the header.
 */
function EpicRow({
  epic,
  first,
  last,
  ...tree
}: TreeProps & { epic: Item; first: boolean; last: boolean }) {
  const children = childrenOf(epic.id, tree.items)
  const outcomes = children.filter((i) => i.kind === 'outcome')
  const openOutcomes = outcomes.filter(isOpenContainer)
  const edge = useSlotEdge(epic.parentId, 'epic', epic.id, last)
  const outcomeDrop = useDropList(epic.id, ['outcome'], 'grid')

  return (
    <Row
      label={`Epic: ${epic.title}`}
      slot={{ attrs: slotAttrs('epic', epic.id), mark: <SlotMark edge={edge} /> }}
      side={
        <ContainerCard
          item={epic}
          allItems={tree.items}
          first={first}
          last={last}
          taskIds={tree.beneath.get(epic.id) ?? []}
          today={tree.today}
        />
      }
    >
      <Board drop={outcomeDrop}>
        {openOutcomes.map((outcome, i) => (
          <OutcomeColumn
            key={outcome.id}
            outcome={outcome}
            first={i === 0}
            last={i === openOutcomes.length - 1}
            {...tree}
          />
        ))}
        <div className="min-w-0">
          <AddForm
            draftKey={`outcome:${epic.id}`}
            variant="slot"
            opener="Add outcome"
            openerLabel={`Add an outcome to ${epic.title}`}
            label={`New outcome in ${epic.title}`}
            placeholder="A new outcome"
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'outcome', title, parentId: epic.id })
            }
          />
        </div>
        <DropZone target={epic.id} className="min-w-0">
          <h4 className="mb-2 border-b border-line px-1 pt-1 pb-1.5 text-[10px] font-medium tracking-widest text-muted uppercase">
            Tasks
          </h4>
          <TaskList
            parent={epic.id}
            name={epic.title}
            listLabel={`${epic.title} tasks`}
            empty="No tasks directly under this epic."
            {...tree}
          />
        </DropZone>
      </Board>

      <PutAway
        items={[...finishedTasks(children), ...outcomes.filter((o) => !isOpenContainer(o))]}
        allItems={tree.items}
      />
    </Row>
  )
}

/**
 * An outcome's column: its card, its open tasks beneath, and what it has put
 * away. The whole column takes a dropped task, card included, since the card
 * is the biggest thing in it that says which outcome this is. Its card is
 * also what drags the column along its epic's row of outcomes.
 */
function OutcomeColumn({
  outcome,
  first,
  last,
  ...tree
}: TreeProps & { outcome: Item; first: boolean; last: boolean }) {
  const edge = useSlotEdge(outcome.parentId, 'outcome', outcome.id, last)
  return (
    <section
      {...slotAttrs('outcome', outcome.id)}
      aria-label={`Outcome: ${outcome.title}`}
      className="relative min-w-0"
    >
      <SlotMark edge={edge} axis="grid" />
      <DropZone target={outcome.id} className="flex flex-col gap-2">
        <ContainerCard
          item={outcome}
          allItems={tree.items}
          first={first}
          last={last}
          taskIds={tree.beneath.get(outcome.id) ?? []}
          today={tree.today}
        />
        <TaskList
          parent={outcome.id}
          name={outcome.title}
          listLabel={`${outcome.title} tasks`}
          empty="No tasks yet."
          {...tree}
        />
        <PutAway items={finishedTasks(childrenOf(outcome.id, tree.items))} allItems={tree.items} />
      </DropZone>
    </section>
  )
}

/**
 * The card that names an epic or an outcome and carries its own actions:
 * rename, finish, archive, delete. What it holds is drawn beside or beneath it
 * by the row or column it heads, not inside it.
 *
 * The actions sit level with the small `Epic` or `Outcome` over the title, so
 * the title has the card's whole width to wrap in. A delete that asks first
 * takes a line of its own under them.
 *
 * One component for both, because an outcome is an epic one level down.
 *
 * The card is what a pointer drags to put it in order among its siblings —
 * outcomes across their epic's row, epics down their area — and its move
 * icons are the keyboard's way to do the same, a step at a time.
 *
 * Its sun chooses everything open in it for today at once (`PlaceSun`), as a
 * task's sun chooses one, so an outcome's worth of work is one press here as
 * it is one box in All Tasks.
 */
function ContainerCard({
  item,
  allItems,
  first,
  last,
  taskIds,
  today,
}: {
  item: Item
  allItems: readonly Item[]
  first: boolean
  last: boolean
  /** Every open task in play beneath it. */
  taskIds: readonly string[]
  today: Today
}) {
  const renameItem = useTasks((s) => s.renameItem)
  const completeItem = useTasks((s) => s.completeItem)
  const archiveItem = useTasks((s) => s.archiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const shiftItem = useTasks((s) => s.shiftItem)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { dragProps } = useCarriedRow(item, renaming === null)

  const noun = item.kind === 'epic' ? 'Epic' : 'Outcome'
  const Heading = item.kind === 'epic' ? 'h3' : 'h4'

  return (
    <div
      {...dragProps}
      className={`group/row rounded-xl border border-muted bg-surface/40 px-3 py-2.5 ${
        renaming === null ? 'cursor-grab' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-[10px] font-medium tracking-widest text-muted uppercase">{noun}</span>
        {renaming === null && (
          <span className="-mr-1.5 -mb-0.5 flex flex-wrap items-center justify-end">
            <PlaceSun title={item.title} taskIds={taskIds} today={today} />
            <StepButtons
              title={item.title}
              axis={item.kind === 'outcome' ? 'grid' : 'list'}
              first={first}
              last={last}
              onStep={(by) => shiftItem(item.id, by)}
            />
            <IconButton
              onClick={() => setRenaming(item.title)}
              label={`Rename ${item.title}`}
              hint="Rename"
              className={revealOnHover}
            >
              <EditGlyph />
            </IconButton>
            <IconButton
              onClick={() => completeItem(item.id)}
              label={`Mark ${item.title} done`}
              hint="Done"
              className={revealOnHover}
            >
              <CheckIcon />
            </IconButton>
            <IconButton
              onClick={() => archiveItem(item.id)}
              label={`Archive ${item.title}`}
              hint="Archive"
              className={revealOnHover}
            >
              <ArchiveIcon />
            </IconButton>
            <DeleteButton
              title={item.title}
              inside={liveInside(item.id, allItems)}
              onDelete={() => deleteItem(item.id)}
              className={revealOnHover}
            />
          </span>
        )}
      </div>
      {renaming === null ? (
        <Heading className="mt-0.5 text-sm text-bright wrap-break-word">{item.title}</Heading>
      ) : (
        <div className="mt-1 flex">
          <RenameField
            label={`Rename ${item.title}`}
            value={renaming}
            onChange={setRenaming}
            onSave={() => {
              renameItem(item.id, renaming)
              setRenaming(null)
            }}
            onCancel={() => setRenaming(null)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * An epic's or outcome's sun: every open task in it chosen for today at once,
 * or taken out again. Lit and saying `Today` when all of it is today's, as a
 * task's sun says so; while only some is, lit and saying how much, and a
 * press chooses the rest, the commoner wish being the whole of it. Otherwise
 * an action like the card's others, shown on hover. Nothing open in it, no
 * sun: there is nothing for today to take.
 *
 * Which intention the tasks go under is today's list's business, as for a
 * single task: grouping is done where the groups are.
 */
function PlaceSun({
  title,
  taskIds,
  today,
}: {
  title: string
  taskIds: readonly string[]
  today: Today
}) {
  const addAllToToday = useSession((s) => s.addAllToToday)
  const removeAllFromToday = useSession((s) => s.removeAllFromToday)
  if (taskIds.length === 0) return null
  const chosen = taskIds.filter((id) => isToday(today, id)).length
  const all = chosen === taskIds.length
  const some = chosen > 0 && !all
  return (
    <button
      type="button"
      onClick={() => (all ? removeAllFromToday(taskIds) : addAllToToday(taskIds))}
      aria-label={`All of ${title} for today`}
      aria-pressed={all ? true : some ? 'mixed' : false}
      title={all ? 'Today — take it all out' : some ? 'Add the rest to today' : 'Add all of it to today'}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-xs transition hover:bg-surface-raised hover:text-bright ${
        all || some ? 'text-deep' : `text-muted ${revealOnHover}`
      }`}
    >
      <TodayIcon chosen={all} />
      {all && <span>Today</span>}
      {some && (
        <span>
          {chosen} of {taskIds.length}
        </span>
      )}
    </button>
  )
}

/**
 * A card's or an area's pair of move icons: earlier and later in its list, up
 * and down it, or left and right along a row of outcomes. Drawn only where
 * there is something to move past; at either end the one that cannot move
 * says so and stays, so the focus is not thrown out of the row by the press
 * that brought it there, and comes back to it if the move took it away
 * (`useRefocus`).
 */
function StepButtons({
  title,
  axis,
  first,
  last,
  onStep,
}: {
  title: string
  axis: 'list' | 'grid'
  first: boolean
  last: boolean
  onStep: (by: -1 | 1) => void
}) {
  const earlier = useRef<HTMLButtonElement>(null)
  const later = useRef<HTMLButtonElement>(null)
  const keepEarlier = useRefocus(earlier)
  const keepLater = useRefocus(later)
  if (first && last) return null
  const [back, on] = axis === 'grid' ? (['left', 'right'] as const) : (['up', 'down'] as const)
  return (
    <>
      <IconButton
        ref={earlier}
        disabled={first}
        onClick={() => {
          keepEarlier()
          onStep(-1)
        }}
        label={`Move ${title} ${back}`}
        hint={`Move ${back}`}
        className={revealOnHover}
      >
        <MoveIcon towards={back} />
      </IconButton>
      <IconButton
        ref={later}
        disabled={last}
        onClick={() => {
          keepLater()
          onStep(1)
        }}
        label={`Move ${title} ${on}`}
        hint={`Move ${on}`}
        className={revealOnHover}
      >
        <MoveIcon towards={on} />
      </IconButton>
    </>
  )
}

/** The open tasks directly under one parent, and the form that adds one there. */
function TaskList({
  parent,
  name,
  listLabel,
  empty,
  ...tree
}: TreeProps & {
  parent: string
  name: string
  listLabel: string
  empty: string
}) {
  const open = openTasksUnder(parent, tree.items)
  const drop = useDropList(parent, ['task'])

  return (
    <>
      <MoveHere target={parent} name={name} />
      {open.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul {...drop} aria-label={listLabel} className="flex flex-col gap-2">
          {open.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              chosen={isToday(tree.today, task.id)}
              last={i === open.length - 1}
            />
          ))}
        </ul>
      )}
      <AddForm
        draftKey={`task:${parent}`}
        opener="Add task"
        openerLabel={`Add a task to ${name}`}
        label={`New task in ${name}`}
        // The column already says whose; a column is too narrow to say it twice.
        placeholder="Add a task"
        onAdd={(title) => useTasks.getState().addItem({ kind: 'task', title, parentId: parent })}
      />
    </>
  )
}

/**
 * One open task: tick it, rename it, choose it for today, carry it to any
 * other column, drop it, or delete it.
 *
 * The whole row drags, which is what a card on a board invites; the grip is
 * where it says so, and the button that picks it up without a pointer. A row
 * being renamed does not drag, so that selecting its text selects text.
 *
 * The sun chooses it for today and takes it out again. Which intention it is
 * under is today's list's business, not the row's: grouping is done where the
 * groups are.
 *
 * Drop and delete are different on purpose. Dropping is deciding not to do
 * it, and it stays in the finished list as a decision; deleting is a mistake
 * being taken back, and leaves only a tombstone the page never shows.
 */
function TaskRow({ task, chosen, last }: { task: Item; chosen: boolean; last: boolean }) {
  const completeItem = useTasks((s) => s.completeItem)
  const renameItem = useTasks((s) => s.renameItem)
  const dropItem = useTasks((s) => s.dropItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const shiftItem = useTasks((s) => s.shiftItem)
  const addToToday = useSession((s) => s.addToToday)
  const removeFromToday = useSession((s) => s.removeFromToday)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { picked, dragProps } = useCarriedRow(task, renaming === null)
  const edge = useSlotEdge(task.parentId, 'task', task.id, last)

  return (
    <li
      {...dragProps}
      {...slotAttrs('task', task.id)}
      className={`group/row relative rounded-lg border px-3 py-2 ${
        picked ? 'border-dashed border-deep/70 bg-surface/60' : 'border-muted/70'
      }`}
    >
      <SlotMark edge={edge} />
      <div className="flex items-start gap-2">
        <CarryGrip
          task={task}
          onStep={(by) => shiftItem(task.id, by)}
          className="-ml-1.5 mt-0.5"
        />
        {/* Level with the first line of the title, which now wraps: a column
            is too narrow to cut a title short and still say which task it is. */}
        <input
          type="checkbox"
          checked={false}
          onChange={() => completeItem(task.id)}
          aria-label={`${task.title} done`}
          className="mt-1 accent-[var(--color-deep)]"
        />
        {renaming === null ? (
          <>
            <span className="min-w-0 flex-1 text-sm text-bright wrap-break-word">{task.title}</span>
            {/* Drawn over the row's padding rather than heightening the line. */}
            <IconButton
              onClick={() => setRenaming(task.title)}
              label={`Rename ${task.title}`}
              hint="Rename"
              className={`-my-0.5 -mr-1.5 ${revealOnHover}`}
            >
              <EditGlyph />
            </IconButton>
          </>
        ) : (
          <RenameField
            label={`Rename ${task.title}`}
            value={renaming}
            onChange={setRenaming}
            onSave={() => {
              renameItem(task.id, renaming)
              setRenaming(null)
            }}
            onCancel={() => setRenaming(null)}
          />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-9 text-xs">
        <span className="-my-1 -ml-1.5 flex">
          <button
            type="button"
            onClick={() => (chosen ? removeFromToday(task.id) : addToToday(task.id))}
            // A toggle keeps one name and says its state by being pressed;
            // `Take … out of today` is the × in today's own list.
            aria-label={`${task.title} for today`}
            aria-pressed={chosen}
            title={chosen ? 'Today — take it out' : 'Add to today'}
            // Chosen, it says so and stays; otherwise it is an action like
            // the others, shown on hover.
            className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 transition hover:bg-surface-raised hover:text-bright ${
              chosen ? 'text-deep' : `text-muted ${revealOnHover}`
            }`}
          >
            <TodayIcon chosen={chosen} />
            {chosen && <span>Today</span>}
          </button>
        </span>
        <span className="-my-1 -mr-1.5 ml-auto flex">
          <IconButton
            onClick={() => dropItem(task.id)}
            label={`Drop ${task.title}`}
            hint="Drop"
            className={revealOnHover}
          >
            <DropIcon />
          </IconButton>
          <IconButton
            danger
            onClick={() => deleteItem(task.id)}
            label={`Delete ${task.title}`}
            hint="Delete"
            className={revealOnHover}
          >
            <DeleteIcon />
          </IconButton>
        </span>
      </div>
    </li>
  )
}

/** An epic or outcome still being worked: open and not archived. */
const isOpenContainer = (item: Item): boolean =>
  item.status === 'open' && item.archivedAt === undefined

/**
 * The tasks under one parent that have been put away: finished, dropped, or
 * archived while still open — the last can arrive in an import, and belongs
 * here, where it can be restored, rather than among the work.
 */
const finishedTasks = (children: readonly Item[]): Item[] =>
  children.filter((i) => i.kind === 'task' && (i.status !== 'open' || i.archivedAt !== undefined))
