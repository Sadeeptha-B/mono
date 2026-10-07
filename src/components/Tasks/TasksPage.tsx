/**
 * The backlog, as a page.
 *
 * A page rather than a panel on the day, for the guide's reason: this is
 * somewhere you go and stay a while, and the stage is for one question at a
 * time. The day only ever sees today's tasks and the tasks a block is for;
 * filing, renaming and tidying the backlog happens here, away from the timer.
 * `App` swaps the view without unmounting anything, so a block keeps running
 * while you are here, and the header says what the timer would be saying.
 *
 * Two parts, in the order a morning uses them. **Today** is the tasks chosen
 * for the day, gathered under the intentions some of them are carried into —
 * the same list as on the opening question (`TodayList`), kept in the event
 * log like everything else about the day. **Areas** are the backlog itself, one band
 * each, drawn as a board rather than as a general-purpose tree, because three
 * levels is the whole depth the model allows. A rule splits every band in two.
 * Down the left is what the area is made of: its name, one card per epic, and
 * its inbox last, the open tasks that sit directly under it. On the right, level
 * with each of those, is what it holds — beside an epic, one column per outcome
 * with that outcome's tasks beneath it, then a column of the tasks that sit
 * straight under the epic; beside the inbox, its tasks. The area's own actions
 * sit level with its name. Columns wrap rather than scroll, so a wide epic
 * grows downwards and the page never scrolls sideways; below `md` the two
 * halves of each row stack, the board indented under its card.
 *
 * Epics and outcomes are finished by hand, archived, or deleted; areas, which
 * never finish, are archived or deleted. Finishing and archiving never touch
 * what is inside; the subtree leaves the page and All Tasks together
 * because its chain is no longer active, and returns unchanged when the epic
 * or area is reopened or restored — see `isInActiveTree`. Deleting takes the
 * subtree too, the same way and for good (`isGone`), so it asks first, naming
 * how much will go with it.
 *
 * A task moves by being carried (`carry.tsx`): dragged by its row to any other
 * column, or, from the keyboard or a touch screen, picked up with the grip on
 * its row and put down with the `Move here` that every other column then
 * offers. Only open tasks are carried, and every column on the page takes one,
 * because every column is a place a task can live. Today's list carries its
 * own tasks between intentions the same way, with its own targets but the
 * board's hand, so picking up on one puts down the other: a task on the
 * board is not dragged into Today, it is chosen with the sun on its row.
 *
 * Every edit here is a backlog edit — the task store writes the one record it
 * changed — except choosing a task for today, grouping it under an intention,
 * or marking an intention done, which are facts about today and go to the log
 * like the intentions themselves. A task that is dropped or done stays
 * today's, and today's list shows it crossed out or stops drawing it.
 *
 * Actions are icons (`IconButton`): today, rename, done, drop, archive,
 * reopen, restore, delete. A column is narrow, and as words they took more of
 * a row than the title they acted on. Each says in its accessible name what it
 * acts on and shows its verb on hover. They show only on hover or with focus
 * in their row or card, and always on a touch screen (`revealOnHover`), as in
 * All Tasks: at rest the board reads as its titles. What says something rather
 * than offering it stays — the grip, the checkbox, and the sun of a task
 * chosen for today. The words left are answers to a question — a delete asking
 * about what is inside — and the fields' own `Done` and `Save`, which finish
 * what is being typed rather than act on a record.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { HeaderMark } from '../HeaderMark'
import { HeaderStatus } from '../HeaderStatus'
import {
  Carry,
  CarryGrip,
  CarryStatus,
  DropZone,
  MoveHere,
  useCarriedRow,
  useCarryHand,
  useCarryState,
  type CarryHand,
} from '../carry'
import { TodayCarry, TodayList, useIntentionRename } from '../TodayList'
import {
  ArchiveIcon,
  CheckIcon,
  DeleteIcon,
  DoneRingIcon,
  DropIcon,
  ReopenIcon,
  RestoreIcon,
  TodayIcon,
} from '../icons'
import { StorageWarning } from '../StorageWarning'
import {
  AddFold,
  EditGlyph,
  fieldClass,
  GhostButton,
  headerControlClass,
  IconButton,
  PageLinks,
  RenameField,
  revealOnHover,
} from '../ui'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { RoomMenu } from '@/ambient/RoomMenu'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import {
  activeAreas,
  activeTasks,
  childrenOf,
  isLive,
  liveDescendantsOf,
  openTasksUnder,
  type Area,
  type Item,
} from '@/domain/tasks'
import { isToday, type Today } from '@/domain/today'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'

export function TasksPage({
  now,
  active,
  timerMode,
  onOpenSettings,
  mini,
}: {
  now: Ms
  active: ActiveSegment | null
  timerMode: TimerMode
  onOpenSettings: () => void
  mini: MiniWindowControls
}) {
  const phase = useSession((s) => s.phase)
  const today = useSession((s) => s.session.today)
  const generation = useSession((s) => s.generation)

  const hydrated = useTasks((s) => s.hydrated)
  const allAreas = useTasks((s) => s.areas)
  const items = useTasks((s) => s.items)
  const addArea = useTasks((s) => s.addArea)
  const unarchiveArea = useTasks((s) => s.unarchiveArea)
  const moveItem = useTasks((s) => s.moveItem)

  const areas = activeAreas(allAreas)
  const archived = allAreas.filter((a) => isLive(a) && a.archivedAt !== undefined)
  // Per backlog snapshot, not per render: the header's timer re-renders this
  // page every second, and the backlog has not changed on most of those.
  const inPlay = useMemo(() => activeTasks(items, allAreas), [items, allAreas])
  const inPlayById = useMemo(() => new Map(inPlay.map((t) => [t.id, t])), [inPlay])
  const [addField, setAddField] = useState<string | null>(null)
  // Stable across the timer's once-a-second render, so no field re-runs its
  // fold check for a tick.
  const addFields = useMemo(() => ({ current: addField, claim: setAddField }), [addField])

  // The board's hand: a task goes to any column but its own. Shared with
  // today's, so only one of the two holds a task at a time.
  const hand = useCarryHand()
  const find = useCallback((taskId: string) => inPlayById.get(taskId), [inPlayById])
  const takes = useCallback((task: Item, parentId: string) => task.parentId !== parentId, [])
  const move = useCallback(
    (task: Item, parentId: string) => moveItem(task.id, parentId),
    [moveItem],
  )
  const carry = useCarryState({ find, takes, move, hand })

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The guide's header, for the guide's reasons: pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ink px-4 py-3 sm:px-6 lg:static">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <HeaderMark phase={phase} home={false} />

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <StorageWarning onOpenSettings={onOpenSettings} />
            <HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />
            <RoomMenu idPrefix="tasks-header" />
            <PopOutButton mini={mini} />
            <PageLinks current="tasks" />
            <button type="button" onClick={onOpenSettings} className={headerControlClass}>
              Settings
            </button>
          </div>
        </div>
      </header>

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* As wide as the header, not the guide's reading measure: a band
            sets columns side by side, and the prose here is capped on its own. */}
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-3xl font-light text-bright sm:text-4xl">Tasks</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Everything you mean to do, by area of life. A task sitting straight under an
            area is that area's inbox — file it deeper later, or never.
          </p>

          {!hydrated ? (
            <p className="mt-8 text-sm text-muted">Loading your tasks…</p>
          ) : (
            <AddFields.Provider value={addFields}>
              {/* Its heading is drawn by the list, so `+ Intention` sits level
                  with it. Keyed by the session's generation, as the stage is:
                  what is being typed about today belongs to one particular
                  day, and the midnight reset or an import must not carry it
                  into the next, nor a task half carried between intentions.
                  Only this; the backlog's own add fields describe long-lived
                  records and keep what is typed in them. */}
              <section aria-label="Today" className="mt-8 border-t border-line pt-6">
                <div className="max-w-3xl">
                  <TodaySection key={generation} hand={hand} />
                </div>
              </section>

              <Carry.Provider value={carry}>
                {/* One rule above the first band and one under each, so every
                    area reads as its own band and the last is closed off from
                    the control that adds another. */}
                <div className="mt-8 border-t border-line">
                  {areas.map((area) => (
                    <AreaBand key={area.id} area={area} items={items} today={today} />
                  ))}
                </div>

                <div className="mt-6">
                  <AddForm
                    opener="Add area"
                    variant="prominent"
                    label="New area"
                    placeholder="Health, Home, Side project"
                    maxLength={60}
                    className="max-w-md"
                    onAdd={addArea}
                  />

                  {archived.length > 0 && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-xs text-muted hover:text-body">
                        Archived ({archived.length})
                      </summary>
                      <ul className="mt-2 flex max-w-md flex-col gap-1.5">
                        {archived.map((area) => (
                          <li key={area.id} className="group/row flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 wrap-break-word text-muted">{area.name}</span>
                            <IconButton
                              onClick={() => unarchiveArea(area.id)}
                              label={`Restore ${area.name}`}
                              hint="Restore"
                              className={revealOnHover}
                            >
                              <RestoreIcon />
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <CarryStatus />
              </Carry.Provider>
            </AddFields.Provider>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * Today on this page: today's list with its intentions (`TodayList`). Tasks
 * are chosen with the sun on their rows below; carrying between intentions
 * has its own carry here, apart from the board's, sharing one hand with it.
 *
 * The intention field keeps the page's rule for add fields: opening it folds
 * any other that is empty, and opening another folds it while nothing has been
 * written in it.
 */
function TodaySection({ hand }: { hand: CarryHand }) {
  const [intention, setIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  const formId = useId()
  const { current, claim } = useContext(AddFields)
  // Another field was opened: fold this one if nothing has been written in it.
  useEffect(() => {
    if (current !== null && current !== formId) setIntention((t) => (t === '' ? null : t))
  }, [current, formId])

  return (
    <TodayCarry hand={hand}>
      <TodayList
        heading={
          <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Today</h2>
        }
        newIntention={intention}
        onNewIntention={(next) => {
          if (intention === null && next !== null) claim(formId)
          if (next === null && current === formId) claim(null)
          setIntention(next)
        }}
        renaming={renaming}
        onRenaming={setRenaming}
        empty="Nothing chosen for today yet. Choose a task with the sun on its row below."
      />
    </TodayCarry>
  )
}

/** Shared down the tree: everything a task row or a card needs to act. */
type TreeProps = {
  items: readonly Item[]
  /** Today's tasks, for the sun on each row. */
  today: Today
}

/**
 * One area as a band: a row for its name and its actions, a row for each open
 * epic, a row to add another, and its inbox last.
 *
 * Every row is the same two-column grid, and the left cell of each carries the
 * dividing rule, so rows stacked without gaps draw one unbroken line down the
 * band. One grid holding every row would draw the same picture, but it could
 * not make an epic's row a single region holding both its card and its board.
 */
function AreaBand({ area, ...tree }: TreeProps & { area: Area }) {
  const renameArea = useTasks((s) => s.renameArea)
  const archiveArea = useTasks((s) => s.archiveArea)
  const deleteArea = useTasks((s) => s.deleteArea)
  const [renaming, setRenaming] = useState<string | null>(null)

  const children = childrenOf(area.id, tree.items)
  const epics = children.filter((i) => i.kind === 'epic')
  const openEpics = epics.filter(isOpenContainer)
  const putAway = epics.filter((e) => !isOpenContainer(e))

  return (
    <div className="border-b border-line py-2">
      <Row
        className="group/row"
        side={
          // A rename puts a form where the heading was, since a form cannot
          // sit inside a heading.
          renaming === null ? (
            <h2 className="text-lg text-bright wrap-break-word">{area.name}</h2>
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

      {openEpics.map((epic) => (
        <EpicRow key={epic.id} epic={epic} {...tree} />
      ))}

      <Row
        side={
          <AddForm
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
  className = '',
  children,
}: {
  side: ReactNode
  label?: string
  className?: string
  children?: ReactNode
}) {
  const cells = (
    <>
      <div className="min-w-0 py-2 md:border-r md:border-line md:py-3 md:pr-5">{side}</div>
      {children && (
        <div className="mb-3 ml-1 min-w-0 border-l border-line pl-3 md:mb-0 md:ml-0 md:border-l-0 md:py-3 md:pl-5">
          {children}
        </div>
      )}
    </>
  )
  const layout = `grid md:grid-cols-[14rem_minmax(0,1fr)] ${className}`
  return label === undefined ? (
    <div className={layout}>{cells}</div>
  ) : (
    <section aria-label={label} className={layout}>
      {cells}
    </section>
  )
}

/**
 * Columns side by side that wrap, rather than scroll, when they run out of
 * room — the page never scrolls sideways, and a phone gets one column.
 */
function Board({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] items-start gap-4">
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
 * a new outcome is a new column: it appears where the button was.
 */
function EpicRow({ epic, ...tree }: TreeProps & { epic: Item }) {
  const children = childrenOf(epic.id, tree.items)
  const outcomes = children.filter((i) => i.kind === 'outcome')

  return (
    <Row label={`Epic: ${epic.title}`} side={<ContainerCard item={epic} allItems={tree.items} />}>
      <Board>
        {outcomes.filter(isOpenContainer).map((outcome) => (
          <OutcomeColumn key={outcome.id} outcome={outcome} {...tree} />
        ))}
        <div className="min-w-0">
          <AddForm
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
 * is the biggest thing in it that says which outcome this is.
 */
function OutcomeColumn({ outcome, ...tree }: TreeProps & { outcome: Item }) {
  return (
    <section aria-label={`Outcome: ${outcome.title}`} className="min-w-0">
      <DropZone target={outcome.id} className="flex flex-col gap-2">
        <ContainerCard item={outcome} allItems={tree.items} />
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
 */
function ContainerCard({ item, allItems }: { item: Item; allItems: readonly Item[] }) {
  const renameItem = useTasks((s) => s.renameItem)
  const completeItem = useTasks((s) => s.completeItem)
  const archiveItem = useTasks((s) => s.archiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const [renaming, setRenaming] = useState<string | null>(null)

  const noun = item.kind === 'epic' ? 'Epic' : 'Outcome'
  const Heading = item.kind === 'epic' ? 'h3' : 'h4'

  return (
    <div className="group/row rounded-xl border border-muted bg-surface/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-[10px] font-medium tracking-widest text-muted uppercase">{noun}</span>
        {renaming === null && (
          <span className="-mr-1.5 -mb-0.5 flex flex-wrap items-center justify-end">
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

  return (
    <>
      <MoveHere target={parent} name={name} />
      {open.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul aria-label={listLabel} className="flex flex-col gap-2">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} chosen={isToday(tree.today, task.id)} />
          ))}
        </ul>
      )}
      <AddForm
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

const FOLD_CLASS = {
  inline: { box: 'mt-2', heading: 'text-xs text-muted' },
  prominent: { box: 'mt-2', heading: 'text-sm text-body' },
  slot: {
    box: 'rounded-xl border border-dashed border-line px-3 py-4 hover:border-muted',
    heading: 'w-full text-xs text-muted',
  },
} as const

/**
 * Which add field was opened last, page-wide, so opening one can fold the
 * others. `null` once the last one opened has been folded by hand.
 */
const AddFields = createContext<{
  current: string | null
  claim: (id: string | null) => void
}>({
  current: null,
  claim: () => undefined,
})

/**
 * An `Add …` heading that opens into the field it asks for (`AddFold`).
 *
 * Folded because the board has one in every column, every epic and every area,
 * and open they outweighed the tasks they add to: a page that is mostly empty
 * fields reads as a form to fill in rather than as the backlog. The fold costs
 * one click, and only on the rarer visit that adds rather than ticks.
 *
 * Enter adds and keeps it open, cleared and focused, because things are
 * usually written down in runs — three tasks for one outcome, not one. `Done`
 * adds what is typed and folds it. The caret, the × and Escape fold it without
 * adding, and all three hand focus back to the heading. It also folds when
 * another field is opened while it is empty, so at most one empty field is
 * ever showing and nothing typed is thrown away unasked.
 *
 * Not on blur, which was tried first. A press elsewhere blurs the field before
 * the release that completes the click, so a field folding on blur moved the
 * page under the pointer and the click landed on whatever slid into its place
 * — usually not the button below it that was aimed at. Opening another field
 * is itself a finished click, so folding in answer to it moves nothing that
 * matters.
 */
function AddForm({
  opener,
  openerLabel,
  variant = 'inline',
  label,
  placeholder,
  maxLength = 120,
  className = '',
  onAdd,
}: {
  /** The heading: `Add task`, `Add outcome`. */
  opener: string
  /** The heading's accessible name, when its text alone does not say where. */
  openerLabel?: string
  /**
   * `inline` under what it adds to; `prominent` for the page's own `Add
   * area`, sized as the page's last word rather than a column's; `slot` for a
   * whole column of the board, outlined where the new column will stand.
   */
  variant?: 'inline' | 'prominent' | 'slot'
  label: string
  placeholder: string
  maxLength?: number
  className?: string
  /** Returns the new id, or null when the store refused it. */
  onAdd: (title: string) => string | null
}) {
  const id = useId()
  const { current, claim } = useContext(AddFields)
  /** What is typed while open, or null while folded. */
  const [title, setTitle] = useState<string | null>(null)
  const open = title !== null

  // Another field was opened: fold this one if nothing has been typed in it.
  useEffect(() => {
    if (current !== null && current !== id) setTitle((t) => (t === '' ? null : t))
  }, [current, id])

  const field = useRef<HTMLInputElement>(null)

  const fold = () => {
    setTitle(null)
    if (current === id) claim(null)
  }

  // Keeps what is typed, if anything, and folds; a refusal keeps it open.
  const done = () => {
    if (title !== null && title.trim() !== '' && onAdd(title) === null) return
    fold()
  }

  const style = FOLD_CLASS[variant]
  return (
    <div className={`${style.box} ${className}`}>
      <AddFold
        title={opener}
        {...(openerLabel ? { label: openerLabel } : {})}
        open={open}
        onOpen={() => {
          setTitle('')
          claim(id)
        }}
        onCancel={fold}
        cancelLabel={`Cancel ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        className={style.heading}
      >
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (title === null || onAdd(title) === null) return
            setTitle('')
            field.current?.focus()
          }}
        >
          <input
            ref={field}
            value={title ?? ''}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && fold()}
            placeholder={placeholder}
            aria-label={label}
            // Opened by a click asking for exactly this field.
            autoFocus
            maxLength={maxLength}
            className={`${fieldClass} py-1.5 text-sm`}
          />
          {/* Smaller than the page's other buttons: every column can carry one. */}
          <GhostButton type="button" onClick={done} className="shrink-0 px-3 py-1.5 text-xs">
            Done
          </GhostButton>
        </form>
      </AddFold>
    </div>
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
function TaskRow({ task, chosen }: { task: Item; chosen: boolean }) {
  const completeItem = useTasks((s) => s.completeItem)
  const renameItem = useTasks((s) => s.renameItem)
  const dropItem = useTasks((s) => s.dropItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const addToToday = useSession((s) => s.addToToday)
  const removeFromToday = useSession((s) => s.removeFromToday)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { picked, dragProps } = useCarriedRow(task, renaming === null)

  return (
    <li
      {...dragProps}
      className={`group/row rounded-lg border px-3 py-2 ${
        picked ? 'border-dashed border-deep/70 bg-surface/60' : 'border-muted/70'
      }`}
    >
      <div className="flex items-start gap-2">
        <CarryGrip task={task} className="-ml-1.5 mt-0.5" />
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

/**
 * Delete, asking first when there is more than the thing itself to lose.
 *
 * Asked inline rather than in a dialog — Settings is the only dialog Mono has
 * — and only when it matters: an empty epic or area goes at once, one holding
 * tasks says how many will go with it. The same for an area as for an item,
 * since both take what is beneath them the same way.
 */
function DeleteButton({
  title,
  inside,
  onDelete,
  className = '',
}: {
  title: string
  /** How many live items would go with it. */
  inside: number
  onDelete: () => void
  /** For the icon at rest only: a question being asked stays on screen. */
  className?: string
}) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <IconButton
        danger
        onClick={() => (inside === 0 ? onDelete() : setAsking(true))}
        label={`Delete ${title}`}
        hint="Delete"
        className={className}
      >
        <DeleteIcon />
      </IconButton>
    )
  }
  // A line of its own in the row of icons it replaces one of: the question is
  // words, and squeezed beside the icons it wrapped a word to a line.
  return (
    <span
      role="group"
      aria-label={`Confirm deleting ${title}`}
      className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 py-1"
    >
      <span className="text-xs text-commit">
        And the {inside} item{inside === 1 ? '' : 's'} inside?
      </span>
      <TextButton onClick={onDelete} label={`Delete ${title} and everything in it`}>
        Delete all
      </TextButton>
      <TextButton onClick={() => setAsking(false)}>Keep</TextButton>
    </span>
  )
}

/** The live items anywhere beneath an area or an item: what deleting it takes. */
const liveInside = (id: string, items: readonly Item[]): number =>
  liveDescendantsOf(id, items).length

/**
 * What has been put away under one parent — done and dropped tasks, and
 * finished or archived epics and outcomes — folded, each able to come back.
 *
 * Each is a card of its own, quieter than the open tasks above it: an outline
 * in the page's rule colour rather than the controls' and no fill, its state
 * as a mark in front of a title that wraps rather than being cut short, and
 * its actions as icons. As a line of words — state, title, `Reopen`, `Delete`
 * — the title was what gave way in a column, down to its first few letters.
 *
 * An archived item can also be finished; restoring it brings it back as it was,
 * finished or not, so archived ones offer Restore and finished ones Reopen.
 *
 * A finished or archived epic or outcome shows what it took with it, nested
 * under it as it was left (`PutAwayInside`): its outcomes and its tasks, each
 * with its own state, since finishing one never touched them. They are only
 * shown — they are hidden by their parent, so the parent's card is where they
 * come back from.
 *
 * The cards are drawn only while the fold is open. The page re-renders every
 * second for the header's timer, and a column of finished work nobody has
 * asked to see is the part of the page that grows without end.
 */
function PutAway({ items, allItems }: { items: readonly Item[]; allItems: readonly Item[] }) {
  if (items.length === 0) return null
  return <PutAwayFold items={items} allItems={allItems} />
}

/**
 * The fold itself, apart from `PutAway` so that whether it is open is
 * forgotten when the last thing in it comes back: the next thing put away
 * arrives folded, as it does on a fresh page.
 */
function PutAwayFold({ items, allItems }: { items: readonly Item[]; allItems: readonly Item[] }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="mt-4" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted hover:text-body">
        Done, dropped and archived ({items.length})
      </summary>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <PutAwayCard key={item.id} item={item} allItems={allItems} />
          ))}
        </ul>
      )}
    </details>
  )
}

/** Where a put-away item stands. Archived wins: it is what hides the item. */
type PutAwayState = 'open' | 'done' | 'dropped' | 'archived'

const putAwayState = (item: Item): PutAwayState =>
  item.archivedAt !== undefined ? 'archived' : item.status

const STATE_NAME: Record<PutAwayState, string> = {
  open: 'Open',
  done: 'Done',
  dropped: 'Dropped',
  archived: 'Archived',
}

/**
 * The mark in front of a put-away title: a tick, a struck circle, a box, or an
 * empty ring for something still open inside what was put away. Its name is
 * read before the title and shown on hover.
 */
function StateMark({ state, className = '' }: { state: PutAwayState; className?: string }) {
  const name = STATE_NAME[state]
  return (
    <span title={name} className={`shrink-0 ${state === 'done' ? 'text-deep/80' : 'text-muted'} ${className}`}>
      {state === 'done' ? (
        <CheckIcon />
      ) : state === 'dropped' ? (
        <DropIcon />
      ) : state === 'archived' ? (
        <ArchiveIcon />
      ) : (
        <DoneRingIcon done={false} />
      )}
      <span className="sr-only">{name}: </span>
    </span>
  )
}

function PutAwayCard({ item, allItems }: { item: Item; allItems: readonly Item[] }) {
  const reopenItem = useTasks((s) => s.reopenItem)
  const unarchiveItem = useTasks((s) => s.unarchiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const state = putAwayState(item)

  return (
    <li className="group/row rounded-lg border border-line px-2.5 py-2">
      {/* Wraps, so a delete that asks first drops to a line of its own
          rather than squeezing the title. */}
      <div className="flex flex-wrap items-start gap-x-2">
        <StateMark state={state} className="mt-[3px]" />
        <div className="min-w-0 flex-1 basis-24 text-sm text-muted wrap-break-word">
          {item.kind !== 'task' && (
            <span className="block text-[10px] tracking-widest uppercase">{item.kind}</span>
          )}
          <span className={state === 'done' ? 'line-through' : ''}>{item.title}</span>
        </div>
        <span className="-my-0.5 -mr-1.5 ml-auto flex flex-wrap items-center justify-end">
          {state === 'archived' ? (
            <IconButton
              onClick={() => unarchiveItem(item.id)}
              label={`Restore ${item.title}`}
              hint="Restore"
              className={revealOnHover}
            >
              <RestoreIcon />
            </IconButton>
          ) : (
            <IconButton
              onClick={() => reopenItem(item.id)}
              label={`Reopen ${item.title}`}
              hint="Reopen"
              className={revealOnHover}
            >
              <ReopenIcon />
            </IconButton>
          )}
          <DeleteButton
            title={item.title}
            inside={liveInside(item.id, allItems)}
            onDelete={() => deleteItem(item.id)}
            className={revealOnHover}
          />
        </span>
      </div>
      {item.kind !== 'task' && <PutAwayInside parent={item} allItems={allItems} />}
    </li>
  )
}

/**
 * What a put-away epic or outcome holds, as it was left: each child with its
 * own state, an outcome's tasks under it in turn. Only shown — see `PutAway`.
 */
function PutAwayInside({ parent, allItems }: { parent: Item; allItems: readonly Item[] }) {
  const children = childrenOf(parent.id, allItems)
  if (children.length === 0) return null
  return (
    <ul
      aria-label={`Inside ${parent.title}`}
      className="mt-1.5 ml-1.5 flex flex-col gap-1 border-l border-line pl-2.5"
    >
      {children.map((child) => {
        const state = putAwayState(child)
        return (
          <li key={child.id} className="min-w-0">
            <div className="flex items-start gap-1.5 text-xs text-muted">
              <StateMark state={state} className="mt-px" />
              <div className="min-w-0 flex-1 wrap-break-word">
                {child.kind !== 'task' && (
                  <span className="mr-1.5 text-[10px] tracking-widest uppercase">{child.kind}</span>
                )}
                <span className={state === 'done' ? 'line-through' : ''}>{child.title}</span>
              </div>
            </div>
            {child.kind !== 'task' && <PutAwayInside parent={child} allItems={allItems} />}
          </li>
        )
      })}
    </ul>
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

function TextButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(label ? { 'aria-label': label } : {})}
      className="text-xs text-muted underline-offset-4 transition hover:text-bright hover:underline"
    >
      {children}
    </button>
  )
}
