/**
 * The backlog's board: each area a band split by a rule, its epics and inbox
 * down the left, and level with each, its outcomes as columns of tasks. Every
 * row and card here is carried by the board's carry (`Backlog`), dragged
 * between rows to put it in order, or stepped with its arrows.
 *
 * Only work is drawn here: open tasks, and those finished today crossed out
 * under them. Everything else put away is on the page's other view
 * (`PutAwayView`), so a column is as long as what is left to do in it.
 *
 * An area folds by the caret in front of its name (`useBoardFold`), to its
 * name and one line saying how much it holds. Inside an area, what folds is a
 * column of tasks: an outcome's, by the caret on its card, and an epic's own
 * `Tasks`, by its heading. Each stays as it was left across visits. Outcomes
 * start folded, the rest open, so a long backlog first reads as its places. A
 * folded column is its card or heading and a count. A folded area or column
 * still takes a carried task, which lands last in it — a folded area's in its
 * inbox — so filing into a place does not mean opening it first.
 *
 * An epic's caret folds every column in its row at once (`useFoldAll`): its
 * outcomes stay where they are, as cards, and only the tasks go. It is folded
 * when every column in the row is, rather than holding a fold of its own, so
 * the caret on its card can never say something the columns beside it do not.
 * An area's actions do the same for every epic in it at once, for reading an
 * area as its epics and their outcomes.
 *
 * A title — an area's, a card's, a task's — is renamed by a double-click on
 * it as well as by its ✎, which stays for the keyboard and a touch screen. A
 * rename here, like an add, keeps what was typed when it is left
 * (`saveOnLeave`, `useLeave`): the board is the one place that saves that way.
 * Every rename on it is held by `useRename`, which says why.
 */

import { useCallback, useContext, useRef, useState, type ReactNode } from 'react'

import {
  CarryGrip,
  DropZone,
  MoveHere,
  SlotMark,
  slotAttrs,
  TOP,
  useCarriedRow,
  useDropList,
  useLanding,
  useSlotEdge,
} from '../carry'
import { HoverNote } from '../HoverNote'
import {
  ArchiveIcon,
  CheckIcon,
  DeleteIcon,
  DropIcon,
  FoldAllIcon,
  MoveIcon,
  TodayIcon,
} from '../icons'
import { KEEPS_BLOCK, KEEPS_BLOCK_PLACE, useKeepsBlock } from '../keepsBlock'
import { Caret, EditGlyph, IconButton, RenameField, revealOnHover, useRefocus } from '../ui'
import { settleLeaves } from '../useLeave'
import { useSession } from '@/store/session'
import { epicTasksFold, useBoardFolds } from '@/store/taskFolds'
import { useTasks } from '@/store/tasks'
import {
  openContainers,
  openTasksUnder,
  tasksDoneOn,
  type Area,
  type Item,
} from '@/domain/tasks'
import type { DayKey } from '@/domain/time'
import { isToday, type Today } from '@/domain/today'
import { DeleteButton, liveInside } from './DeleteButton'
import { AddFields, AddForm } from './addFields'

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
  /** The session's day, whose finished tasks stay in their columns; null before it is known. */
  day: DayKey | null
}

/**
 * One area as a band: a row for its name and its actions, a row for each open
 * epic, a row to add another, and its inbox last. What it has put away is on
 * the page's other view.
 *
 * Every row is the same two-column grid, and the left cell of each carries the
 * dividing rule, so rows stacked without gaps draw one unbroken line down the
 * band. One grid holding every row would draw the same picture, but it could
 * not make an epic's row a single region holding both its card and its board.
 *
 * The band is a row of the list of areas and the list of its own epics at
 * once: an area dragged over it falls through to the list of areas, and an
 * epic is taken here.
 *
 * Folded, the band is its name row alone, the right of it saying how much it
 * holds and taking a carried task into the inbox. Its actions then lose the
 * fold over every epic, which has nothing on screen to fold.
 *
 * The fold over every epic is each epic's caret pressed at once: every column
 * in every epic's row folds, and the epics and outcomes stay as cards
 * (`useFoldAll`). It folds them all unless all are folded already.
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
  const rename = useRename((title) => renameArea(area.id, title))
  const { dragProps } = useCarriedRow({ id: area.id, title: area.name }, rename.field === null)
  const edge = useSlotEdge(TOP, 'area', area.id, last)
  const epicDrop = useDropList(area.id, ['epic'])
  const [folded, toggleFold] = useBoardFold(area.id, STARTS_FOLDED.area)

  const openEpics = openContainers(area.id, 'epic', tree.items)
  const [epicsFolded, toggleEpics] = useFoldAll(
    (items) => everyEpicsColumns(area.id, items),
    tree.items,
  )
  const inbox = openTasksUnder(area.id, tree.items).length

  const actions = rename.field === null && (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 md:justify-end md:pt-0.5">
      {!folded && openEpics.length > 0 && (
        <IconButton
          onClick={toggleEpics}
          label={`${epicsFolded ? 'Unfold' : 'Fold'} every epic in ${area.name}`}
          hint={epicsFolded ? 'Unfold epics' : 'Fold epics'}
          className={revealOnHover}
        >
          <FoldAllIcon fold={!epicsFolded} />
        </IconButton>
      )}
      <StepButtons
        title={area.name}
        axis="list"
        first={first}
        last={last}
        onStep={(by) => shiftArea(area.id, by)}
      />
      <IconButton
        onClick={() => rename.start(area.name)}
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
  )

  return (
    <div {...slotAttrs('area', area.id)} {...epicDrop} className="relative border-b border-line py-2">
      <SlotMark edge={edge} />
      <Row
        className="group/row"
        side={
          <div className="flex items-start gap-1">
            <FoldButton
              landing={foldLanding(area.id)}
              label={`What ${area.name} holds`}
              folded={folded}
              onFold={toggleFold}
              className="-ml-1 mt-1"
            />
            {/* A rename puts a form where the heading was, since a form cannot
                sit inside a heading. The heading is what drags the band. */}
            {rename.field === null ? (
              <h2
                {...dragProps}
                onDoubleClick={() => rename.start(area.name)}
                className="min-w-0 cursor-grab text-lg text-bright wrap-break-word"
              >
                {area.name}
              </h2>
            ) : (
              <div className="flex min-w-0 flex-1">
                <RenameField label={`Rename ${area.name}`} {...rename.field} />
              </div>
            )}
          </div>
        }
      >
        {folded ? (
          <DropZone target={area.id} className="min-w-0">
            <MoveHere target={area.id} name={area.name} landOn={foldLanding(area.id)} />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm text-muted md:pt-0.5">
                {openEpics.length === 0 && inbox === 0
                  ? 'Nothing open in it.'
                  : [
                      ...(openEpics.length > 0 ? [count(openEpics.length, 'epic')] : []),
                      ...(inbox > 0 ? [`${inbox} in the inbox`] : []),
                    ].join(' · ')}
              </p>
              {actions}
            </div>
          </DropZone>
        ) : (
          actions
        )}
      </Row>

      {!folded && <AreaContents area={area} openEpics={openEpics} {...tree} />}
    </div>
  )
}

/** What an unfolded area holds: a row per open epic, the row that adds one, and its inbox. */
function AreaContents({
  area,
  openEpics,
  ...tree
}: TreeProps & { area: Area; openEpics: readonly Item[] }) {
  return (
    <>
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
            variant="epic"
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
      </Row>
    </>
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
  className = '',
  children,
}: {
  /** What a row of outcomes takes from a drag, from `useDropList`. */
  drop?: ReturnType<typeof useDropList>
  className?: string
  children: ReactNode
}) {
  return (
    <div
      {...drop}
      className={`grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] items-start gap-4 ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * An epic's row: its card on the left; on the right a column for each open
 * outcome, then a slot that adds another beside the last, then a column of the
 * tasks straight under the epic, which needs no card of its own because the
 * epic's is level with it.
 *
 * The card's caret folds every column in the row at once (`useFoldAll`): the
 * outcomes' cards stay, saying how much each holds, so a folded epic still
 * reads as its outcomes. It once folded the row to one line, outcomes and
 * all, which hid the places tasks are filed into along with the tasks.
 *
 * A new outcome is a new column, and its empty card is drawn as one, after
 * the last outcome, where it will stand. What asks for it is a small `+` at
 * the board's top right, in a strip kept clear for it, rather than a slot
 * taking a column of its own: as a whole column it cost a row an outcome, and
 * on most boards it was the biggest thing in view. The tasks after the
 * outcomes are headed `Tasks`, since a column with nothing at its head read as
 * one more outcome — see the header.
 */
function EpicRow({
  epic,
  first,
  last,
  ...tree
}: TreeProps & { epic: Item; first: boolean; last: boolean }) {
  const openOutcomes = openContainers(epic.id, 'outcome', tree.items)
  const edge = useSlotEdge(epic.parentId, 'epic', epic.id, last)
  const outcomeDrop = useDropList(epic.id, ['outcome'], 'grid')
  const [folded, toggle] = useFoldAll((items) => epicColumns(epic.id, items), tree.items)
  const taskIds = tree.beneath.get(epic.id) ?? []

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
          taskIds={taskIds}
          today={tree.today}
          folded={folded}
          onFold={toggle}
        />
      }
    >
      <EpicBoard epic={epic} openOutcomes={openOutcomes} drop={outcomeDrop} {...tree} />
    </Row>
  )
}

/**
 * An epic's board: its outcomes, the `+` that adds one, and its own tasks.
 *
 * The `+` is laid over the strip the board keeps clear down its right edge
 * (`pr-9`), out of the grid's flow, so it takes no column: a positioned child
 * of a grid is not one of its cells. Opened, the same element joins the flow
 * as the new outcome's card, after the last outcome, and goes back to the
 * corner once it folds. One element throughout, so the opener the × hands the
 * focus back to is the one drawn again (`AddForm`). The strip is narrow enough
 * that a row at every view's width still holds four columns.
 */
function EpicBoard({
  epic,
  openOutcomes,
  drop,
  ...tree
}: TreeProps & {
  epic: Item
  openOutcomes: readonly Item[]
  drop: ReturnType<typeof useDropList>
}) {
  const addKey = `outcome:${epic.id}`
  const adding = useContext(AddFields).drafts.has(addKey)
  return (
    <Board drop={drop} className="relative pr-9">
      {openOutcomes.map((outcome, i) => (
        <OutcomeColumn
          key={outcome.id}
          outcome={outcome}
          first={i === 0}
          last={i === openOutcomes.length - 1}
          {...tree}
        />
      ))}
      <div className={adding ? 'min-w-0' : 'absolute top-0 right-0'}>
        <AddForm
          draftKey={addKey}
          variant="outcome"
          opener="Add outcome"
          openerLabel={`Add an outcome to ${epic.title}`}
          label={`New outcome in ${epic.title}`}
          placeholder="A new outcome"
          onAdd={(title) =>
            unfoldNew(useTasks.getState().addItem({ kind: 'outcome', title, parentId: epic.id }))
          }
        />
      </div>
      <EpicTasks epic={epic} {...tree} />
    </Board>
  )
}

/**
 * The tasks straight under an epic, as a column after its outcomes, headed
 * `Tasks`. Its heading folds it alone, as an outcome's caret folds an
 * outcome, under a key of its own (`epicTasksFold`); the epic's caret folds it
 * with the outcomes. Folded, it says how many are open and still takes a
 * carried task, which lands last among them.
 */
function EpicTasks({ epic, ...tree }: TreeProps & { epic: Item }) {
  const key = epicTasksFold(epic.id)
  const [folded, toggle] = useBoardFold(key, STARTS_FOLDED.epicTasks)
  const open = folded ? openTasksUnder(epic.id, tree.items).length : 0
  const heading = useRef<HTMLButtonElement>(null)
  useLanding(foldLanding(key), heading)
  return (
    <DropZone target={epic.id} className="min-w-0">
      <h4 className="mb-2 border-b border-line px-1 pt-1 pb-1.5">
        <button
          ref={heading}
          type="button"
          onClick={toggle}
          // Its name starts with what it shows, `Tasks`, and says whose.
          aria-label={`Tasks straight under ${epic.title}`}
          aria-expanded={!folded}
          title={folded ? 'Unfold' : 'Fold'}
          className="-ml-1 inline-flex items-center gap-1 rounded text-[10px] font-medium tracking-widest text-muted uppercase transition hover:text-bright"
        >
          <span className="inline-flex size-4 items-center justify-center">
            <Caret open={!folded} />
          </span>
          Tasks
        </button>
      </h4>
      {folded ? (
        <>
          <MoveHere target={epic.id} name={epic.title} landOn={foldLanding(key)} />
          <p className="px-1 text-xs text-muted">
            {open === 0 ? 'No open tasks.' : count(open, 'open task')}
          </p>
        </>
      ) : (
        <TaskList
          parent={epic.id}
          name={epic.title}
          listLabel={`${epic.title} tasks`}
          empty="No tasks directly under this epic."
          {...tree}
        />
      )}
    </DropZone>
  )
}

/**
 * An outcome's column: its card, and its tasks beneath. The whole column
 * takes a dropped task, card included, since the card is the biggest thing in
 * it that says which outcome this is. Its card is also what drags the column
 * along its epic's row of outcomes.
 *
 * Folded, the column is the card alone, saying how much it holds, and still
 * takes a task: dropped on the card, or put down with its `Move here`.
 */
function OutcomeColumn({
  outcome,
  first,
  last,
  ...tree
}: TreeProps & { outcome: Item; first: boolean; last: boolean }) {
  const edge = useSlotEdge(outcome.parentId, 'outcome', outcome.id, last)
  const [folded, toggle] = useBoardFold(outcome.id, STARTS_FOLDED.outcome)
  const taskIds = tree.beneath.get(outcome.id) ?? []
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
          taskIds={taskIds}
          today={tree.today}
          folded={folded}
          onFold={toggle}
          summary={taskIds.length === 0 ? 'No open tasks.' : count(taskIds.length, 'open task')}
        />
        {folded ? (
          <MoveHere target={outcome.id} name={outcome.title} landOn={foldLanding(outcome.id)} />
        ) : (
          <TaskList
            parent={outcome.id}
            name={outcome.title}
            listLabel={`${outcome.title} tasks`}
            empty="No tasks yet."
            {...tree}
          />
        )}
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
 *
 * The caret in front of `Epic` or `Outcome` folds the tasks the card heads:
 * an outcome's column, or every column in an epic's row. It is always shown
 * rather than on hover, because it says something — whether anything is
 * folded away — as the grip and a lit sun do. A folded card may say how much
 * it holds under its title (`summary`).
 */
function ContainerCard({
  item,
  allItems,
  first,
  last,
  taskIds,
  today,
  folded,
  onFold,
  summary,
}: {
  item: Item
  allItems: readonly Item[]
  first: boolean
  last: boolean
  /** Every open task in play beneath it. */
  taskIds: readonly string[]
  today: Today
  folded: boolean
  onFold: () => void
  /** What a folded card says it holds, under its title. */
  summary?: string
}) {
  const renameItem = useTasks((s) => s.renameItem)
  const completeItem = useTasks((s) => s.completeItem)
  const archiveItem = useTasks((s) => s.archiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const shiftItem = useTasks((s) => s.shiftItem)
  const rename = useRename((title) => renameItem(item.id, title))
  const { dragProps } = useCarriedRow(item, rename.field === null)

  const noun = item.kind === 'epic' ? 'Epic' : 'Outcome'
  const Heading = item.kind === 'epic' ? 'h3' : 'h4'

  return (
    <div
      {...dragProps}
      className={`group/row rounded-xl border border-muted bg-surface/40 px-3 py-2.5 ${
        rename.field === null ? 'cursor-grab' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="-ml-1 flex items-center gap-0.5">
          <FoldButton
            // Only an outcome's column folds away under its own card.
            {...(item.kind === 'outcome' ? { landing: foldLanding(item.id) } : {})}
            label={`What ${item.title} holds`}
            folded={folded}
            onFold={onFold}
          />
          <span className="text-[10px] font-medium tracking-widest text-muted uppercase">
            {noun}
          </span>
        </span>
        {rename.field === null && (
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
              onClick={() => rename.start(item.title)}
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
      {rename.field === null ? (
        <>
          <Heading
            onDoubleClick={() => rename.start(item.title)}
            className="mt-0.5 text-sm text-bright wrap-break-word"
          >
            {item.title}
          </Heading>
          {folded && summary !== undefined && <p className="mt-1 text-xs text-muted">{summary}</p>}
        </>
      ) : (
        <div className="mt-1 flex">
          <RenameField label={`Rename ${item.title}`} {...rename.field} />
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
 *
 * While a block runs, taking out of today what is all the block holds is
 * refused (`useKeepsBlock`), so a lit sun that would do that is held back and
 * says why, as a task's is.
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
  const keepsBlock = useKeepsBlock()
  if (taskIds.length === 0) return null
  const chosen = taskIds.filter((id) => isToday(today, id)).length
  const all = chosen === taskIds.length
  const some = chosen > 0 && !all
  const locked = all && keepsBlock(taskIds)
  return (
    <HoverNote note={locked ? KEEPS_BLOCK_PLACE : null} className="flex shrink-0">
      {(describedBy) => (
        <button
          type="button"
          onClick={() => {
            if (locked) return
            if (all) removeAllFromToday(taskIds)
            else addAllToToday(taskIds)
          }}
          aria-label={`All of ${title} for today`}
          aria-pressed={all ? true : some ? 'mixed' : false}
          {...(locked
            ? { 'aria-disabled': true }
            : {
                title: all
                  ? 'Today — take it all out'
                  : some
                    ? 'Add the rest to today'
                    : 'Add all of it to today',
              })}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 text-xs transition ${
            locked ? 'cursor-default' : 'hover:bg-surface-raised hover:text-bright'
          } ${all || some ? 'text-deep' : `text-muted ${revealOnHover}`}`}
        >
          <TodayIcon chosen={all} />
          {all && <span>Today</span>}
          {some && (
            <span>
              {chosen} of {taskIds.length}
            </span>
          )}
        </button>
      )}
    </HoverNote>
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

/**
 * The open tasks directly under one parent, those finished there today crossed
 * out under them, and the form that adds one there.
 *
 * Today's finished ones stay where they were ticked, as they do in All Tasks
 * and today's list, so the column shows the day's progress in it and a tick
 * made by mistake is undone where it was made. Older ones, and dropped ones,
 * are on the page's other view. They are a list of their own after the open
 * ones: only open tasks are carried or put in order, so a drag's line is never
 * drawn among them.
 */
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
  const done = tree.day === null ? [] : tasksDoneOn(parent, tree.items, tree.day)
  const drop = useDropList(parent, ['task'])

  return (
    <>
      <MoveHere target={parent} name={name} />
      {open.length === 0 ? (
        done.length === 0 && <p className="text-sm text-muted">{empty}</p>
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
      {/* Under the open tasks, above today's finished ones: a new task lands
          last among the open, so its card is drawn where it will stand. */}
      <AddForm
        draftKey={`task:${parent}`}
        variant="task"
        opener="Add task"
        openerLabel={`Add a task to ${name}`}
        label={`New task in ${name}`}
        // The column already says whose; a column is too narrow to say it twice.
        placeholder="Add a task"
        onAdd={(title) => useTasks.getState().addItem({ kind: 'task', title, parentId: parent })}
      />
      {done.length > 0 && (
        <ul aria-label={`${name} done today`} className="mt-2 flex flex-col gap-2">
          {done.map((task) => (
            <DoneRow key={task.id} task={task} />
          ))}
        </ul>
      )}
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
  const keepsBlock = useKeepsBlock()
  const rename = useRename((title) => renameItem(task.id, title))
  const { picked, dragProps } = useCarriedRow(task, rename.field === null)
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
        {rename.field === null ? (
          <>
            <span
              onDoubleClick={() => rename.start(task.title)}
              className="min-w-0 flex-1 text-sm text-bright wrap-break-word"
            >
              {task.title}
            </span>
            {/* Drawn over the row's padding rather than heightening the line. */}
            <IconButton
              onClick={() => rename.start(task.title)}
              label={`Rename ${task.title}`}
              hint="Rename"
              className={`-my-0.5 -mr-1.5 ${revealOnHover}`}
            >
              <EditGlyph />
            </IconButton>
          </>
        ) : (
          <RenameField label={`Rename ${task.title}`} {...rename.field} />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-9 text-xs">
        <HoverNote
          // All a running block holds is not taken out of today; it says so.
          note={chosen && keepsBlock([task.id]) ? KEEPS_BLOCK : null}
          className="-my-1 -ml-1.5 flex"
        >
          {(describedBy) => {
            const locked = describedBy !== undefined
            return (
              <button
                type="button"
                onClick={() => {
                  if (locked) return
                  if (chosen) removeFromToday(task.id)
                  else addToToday(task.id)
                }}
                // A toggle keeps one name and says its state by being pressed;
                // `Take … out of today` is the × in today's own list.
                aria-label={`${task.title} for today`}
                aria-pressed={chosen}
                {...(locked
                  ? { 'aria-disabled': true, 'aria-describedby': describedBy }
                  : { title: chosen ? 'Today — take it out' : 'Add to today' })}
                // Chosen, it says so and stays; otherwise it is an action like
                // the others, shown on hover.
                className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 transition ${
                  locked ? 'cursor-default' : 'hover:bg-surface-raised hover:text-bright'
                } ${chosen ? 'text-deep' : `text-muted ${revealOnHover}`}`}
              >
                <TodayIcon chosen={chosen} />
                {chosen && <span>Today</span>}
              </button>
            )
          }}
        </HoverNote>
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

/**
 * A task finished today, crossed out where it was: its box unticks it, and
 * that is all it offers. It is not carried, chosen or renamed — it is done —
 * and its box sits where an open row's does, past the grip it has no use for.
 */
function DoneRow({ task }: { task: Item }) {
  const reopenItem = useTasks((s) => s.reopenItem)
  return (
    <li className="rounded-lg border border-line px-3 py-2">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked
          onChange={() => reopenItem(task.id)}
          aria-label={`${task.title} done`}
          title="Done today — untick to reopen"
          className="mt-1 ml-3.5 accent-[var(--color-deep)]"
        />
        <span className="min-w-0 flex-1 text-sm text-muted line-through wrap-break-word">
          {task.title}
        </span>
      </div>
    </li>
  )
}

/**
 * A title being renamed on the board — an area's, a card's or a task's — and,
 * while it is, the props of its `RenameField`, which keeps it when left.
 *
 * A leave is carried out even when the click that made it takes the field
 * away (`useLeave`): folding the outcome a task is in, ticking the task done,
 * turning the page to Put away. That click can also land after the board the
 * rename was typed on has gone, started again because an import replaced the
 * backlog while the press was held (`Backlog`); and an import may bring the
 * same id back saying something else, which a title typed before it must not
 * be written over. So a rename notes which backlog it was opened against
 * (`replaced`) and is written only into that one; otherwise it goes with the
 * board it was on, as that board's other drafts do. A fold or a tick
 * replaces nothing, so the rename it interrupted is written.
 */
function useRename(rename: (title: string) => void) {
  const [renaming, setRenaming] = useState<{ title: string; against: number } | null>(null)
  const start = (title: string) => setRenaming({ title, against: useTasks.getState().replaced })
  const field =
    renaming === null
      ? null
      : {
          value: renaming.title,
          onChange: (title: string) => setRenaming({ title, against: renaming.against }),
          saveOnLeave: true,
          onSave: () => {
            if (useTasks.getState().replaced === renaming.against) rename(renaming.title)
            setRenaming(null)
          },
          onCancel: () => setRenaming(null),
        }
  return { start, field }
}

/**
 * The caret that folds what a name heads: an area's whole band, every column
 * in an epic's row, or an outcome's one column. Always shown rather than on
 * hover, because it says something — whether anything is folded away — as the
 * grip and a lit sun do.
 *
 * An area's or outcome's is also where a task put down in it from the keyboard
 * leaves the focus while it is folded (`landing`), since the task's own row is
 * folded away with it. An epic's folds columns that each have a control of
 * their own to land on, so it takes none.
 */
function FoldButton({
  landing,
  label,
  folded,
  onFold,
  className = '',
}: {
  /** The landing key it takes the focus for (`foldLanding`), if any. */
  landing?: string
  /** `What … holds`: one name for what it shows, and whether it shows it. */
  label: string
  folded: boolean
  onFold: () => void
  className?: string
}) {
  const control = useRef<HTMLButtonElement>(null)
  useLanding(landing, control)
  return (
    <button
      ref={control}
      type="button"
      onClick={onFold}
      aria-label={label}
      aria-expanded={!folded}
      title={folded ? 'Unfold' : 'Fold'}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition hover:bg-surface-raised hover:text-bright ${className}`}
    >
      <Caret open={!folded} />
    </button>
  )
}

/**
 * What a folded place's `Move here` lands on (`landOn`): the control that
 * folds it alone, by its fold key. Never a task's id, which is a UUID.
 */
const foldLanding = (foldKey: string): string => `fold:${foldKey}`

/**
 * How each thing the board folds starts, until it is folded by hand. Outcomes
 * start folded, so an area reads as its epics and the outcomes in each and an
 * outcome's tasks are shown once asked for; areas and an epic's own tasks
 * start open, as they were drawn before they could fold.
 */
const STARTS_FOLDED = { area: false, outcome: true, epicTasks: false } as const

/** A column the board folds on its own: its key, and how it starts. */
type Column = { key: string; startsFolded: boolean }

/** What an epic's caret folds: each open outcome's column, then its own tasks. */
const epicColumns = (epicId: string, items: readonly Item[]): Column[] => [
  ...openContainers(epicId, 'outcome', items).map((outcome) => ({
    key: outcome.id,
    startsFolded: STARTS_FOLDED.outcome,
  })),
  { key: epicTasksFold(epicId), startsFolded: STARTS_FOLDED.epicTasks },
]

/** What an area's fold over every epic folds: every column of every open epic in it. */
const everyEpicsColumns = (areaId: string, items: readonly Item[]): Column[] =>
  openContainers(areaId, 'epic', items).flatMap((epic) => epicColumns(epic.id, items))

/**
 * The fold over many columns: an epic's caret over its row, and an area's
 * fold over every epic in it, over all of theirs. Derived, not kept — folded
 * when every column under it is — so it cannot disagree with the columns, each
 * of which still folds on its own. A press folds them all unless all are
 * folded already, written as one choice per column in one write
 * (`setManyFolded`), so each still answers for itself afterwards. An epic
 * always has a column to fold, its own tasks; an area with no epic shows no
 * fold over them.
 *
 * Which way a press turns is what was on screen when it was made. What it
 * writes is every column there is once the press has settled the fields it
 * left (`settleLeaves`): an outcome or epic typed into an add field and left
 * by this very press is added first, and folded with the rest. Left to its
 * own turn it was added after the fold, and an outcome written on the board
 * starts open (`unfoldNew`), so the epic the press had just folded read as
 * open again. Columns are therefore named from the backlog's items, read
 * again at the press, rather than from the ones this render drew.
 */
function useFoldAll(
  columnsIn: (items: readonly Item[]) => Column[],
  items: readonly Item[],
): [boolean, () => void] {
  const folded = useBoardFolds((s) =>
    columnsIn(items).every(({ key, startsFolded }) => s.choices[key] ?? startsFolded),
  )
  const toggle = () => {
    settleLeaves()
    useBoardFolds.getState().setManyFolded(
      columnsIn(useTasks.getState().items).map(({ key }) => key),
      !folded,
    )
  }
  return [folded, toggle]
}

/**
 * Whether the board has something folded, and the press that turns it over.
 * How it starts is `STARTS_FOLDED`'s. A choice made by hand is kept by id
 * (`useBoardFolds`), apart from All Tasks'; an outcome written here starts
 * open (`unfoldNew`), since it was made to be filled.
 */
function useBoardFold(id: string, startsFolded: boolean): [boolean, () => void] {
  const folded = useBoardFolds((s) => s.choices[id] ?? startsFolded)
  const setFolded = useBoardFolds((s) => s.setFolded)
  const toggle = useCallback(() => setFolded(id, !folded), [id, folded, setFolded])
  return [folded, toggle]
}

/**
 * An outcome written on the board starts open, though outcomes start folded:
 * it was made here to have tasks written into it, which a folded one hides.
 * Recorded as a choice, as opening it by hand would be. Passes the new id on.
 */
const unfoldNew = (id: string | null): string | null => {
  if (id !== null) useBoardFolds.getState().setFolded(id, false)
  return id
}

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
