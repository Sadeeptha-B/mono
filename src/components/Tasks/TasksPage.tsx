/**
 * The backlog, as a page.
 *
 * A page rather than a panel on the day, for the guide's reason: this is
 * somewhere you go and stay a while, and the stage is for one question at a
 * time. The day only ever sees today's intentions and the tasks a block is for;
 * filing, renaming and tidying the backlog happens here, away from the timer.
 * `App` swaps the view without unmounting anything, so a block keeps running
 * while you are here, and the header says what the timer would be saying.
 *
 * Two parts, in the order a morning uses them. **Today** is the day's
 * intentions and the tasks gathered under each — the grouping the day keeps,
 * and edits through the event log. **Areas** are the backlog itself, one band
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
 * what is inside; the subtree leaves the page and the task picker together
 * because its chain is no longer active, and returns unchanged when the epic
 * or area is reopened or restored — see `isInActiveTree`. Deleting takes the
 * subtree too, the same way and for good (`isGone`), so it asks first, naming
 * how much will go with it.
 *
 * Every edit here is a backlog edit — the task store writes the one record it
 * changed — except linking a task to an intention, which is a fact about today
 * and goes to the log like the intentions themselves. A task that is dropped
 * or done keeps its link for the day, and the page simply stops listing it as
 * open.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { PixelCat } from '../Companion/PixelCat'
import { HeaderStatus } from '../HeaderStatus'
import { StorageWarning } from '../StorageWarning'
import { EditGlyph, fieldClass, GhostButton, headerControlClass, InlineSelect } from '../ui'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { DAY_HASH } from '@/hooks/useRoute'
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
  pathOf,
  PATH_SEPARATOR,
  placesForTasks,
  type Area,
  type Item,
  type Place,
} from '@/domain/tasks'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Intention, Ms } from '@/domain/types'

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
  const intentions = useSession((s) => s.session.intentions)
  const taskIntentions = useSession((s) => s.session.taskIntentions)
  const linkTask = useSession((s) => s.linkTask)

  const hydrated = useTasks((s) => s.hydrated)
  const allAreas = useTasks((s) => s.areas)
  const items = useTasks((s) => s.items)
  const addArea = useTasks((s) => s.addArea)
  const unarchiveArea = useTasks((s) => s.unarchiveArea)

  const areas = activeAreas(allAreas)
  const archived = allAreas.filter((a) => isLive(a) && a.archivedAt !== undefined)
  // Per backlog snapshot, not per render: the header's timer re-renders this
  // page every second, and the backlog has not changed on most of those.
  const places = useMemo(() => placesForTasks(items, allAreas), [items, allAreas])
  const inPlay = useMemo(() => activeTasks(items, allAreas), [items, allAreas])
  const [addField, setAddField] = useState<string | null>(null)
  // Stable across the timer's once-a-second render, so no field re-runs its
  // fold check for a tick.
  const addFields = useMemo(() => ({ current: addField, claim: setAddField }), [addField])

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The guide's header, for the guide's reasons: pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ink px-4 py-3 sm:px-6 lg:static">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <PixelCat
              phase={phase}
              progress={null}
              variant="mark"
              className="h-7 w-11"
              decorative
            />
            <span className="text-sm font-medium tracking-widest text-body uppercase">
              Mono
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <StorageWarning onOpenSettings={onOpenSettings} />
            <HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />
            <RoomMenu idPrefix="tasks-header" />
            <PopOutButton mini={mini} />
            <button type="button" onClick={onOpenSettings} className={headerControlClass}>
              Settings
            </button>
            <a href={DAY_HASH} className={headerControlClass}>
              Back to today
            </a>
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
            <>
              <Section title="Today">
                {intentions.length === 0 ? (
                  <p className="text-sm text-muted">
                    No intentions yet. They are the day's third opening question, and can be
                    changed between blocks from the dots under the timer.
                  </p>
                ) : (
                  <div className="flex flex-col gap-5">
                    {intentions.map((intention) => (
                      <TodayGroup
                        key={intention.id}
                        intention={intention}
                        // Only tasks still in play: one inside an archived or
                        // finished epic leaves today's list with its epic.
                        tasks={inPlay.filter((t) => taskIntentions[t.id] === intention.id)}
                        pathFor={(t) => pathOf(t.id, items, allAreas).join(PATH_SEPARATOR)}
                        onUnlink={(taskId) => linkTask(taskId, null)}
                      />
                    ))}
                  </div>
                )}
              </Section>

              <AddFields.Provider value={addFields}>
                {/* One rule above the first band and one under each, so every
                    area reads as its own band and the last is closed off from
                    the control that adds another. */}
                <div className="mt-8 border-t border-line">
                  {areas.map((area) => (
                    <AreaBand
                      key={area.id}
                      area={area}
                      places={places}
                      items={items}
                      intentions={intentions}
                      taskIntentions={taskIntentions}
                      onLink={linkTask}
                    />
                  ))}
                </div>

                <div className="mt-6">
                  <AddForm
                    opener="Add area"
                    variant="prominent"
                    label="New area"
                    placeholder="Health, Home, Side project"
                    button="Add area"
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
                          <li key={area.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-muted">{area.name}</span>
                            <TextButton onClick={() => unarchiveArea(area.id)}>Restore</TextButton>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </AddFields.Provider>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">{title}</h2>
      {/* Lines of text, so held to a reading width while the bands go wide. */}
      <div className="max-w-3xl">{children}</div>
    </section>
  )
}

function TodayGroup({
  intention,
  tasks,
  pathFor,
  onUnlink,
}: {
  intention: Intention
  tasks: readonly Item[]
  /** Where each task lives, so two tasks of the same name can be told apart. */
  pathFor: (task: Item) => string
  onUnlink: (taskId: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm text-bright">{intention.title}</h3>
      {tasks.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          Nothing open under this one. Put a task here from its area below.
        </p>
      ) : (
        <ul aria-label={`Today: ${intention.title}`} className="mt-1.5 flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-body">
                {task.title}
                <span className="ml-2 text-xs text-muted">{pathFor(task)}</span>
              </span>
              <TextButton
                onClick={() => onUnlink(task.id)}
                label={`Take ${task.title} out of ${intention.title}`}
              >
                Not today
              </TextButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Shared down the tree: everything a task row or a card needs to act. */
type TreeProps = {
  items: readonly Item[]
  places: readonly Place[]
  intentions: readonly Intention[]
  taskIntentions: Readonly<Record<string, string>>
  onLink: (taskId: string, intentionId: string | null) => void
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
        side={
          // A rename puts a form where the heading was, since a form cannot
          // sit inside a heading.
          renaming === null ? (
            <h2 className="text-lg text-bright wrap-break-word">{area.name}</h2>
          ) : (
            <div className="flex">
              <InlineEdit
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
          <div className="flex flex-wrap gap-x-4 gap-y-1 md:justify-end md:pt-1.5">
            <TextButton onClick={() => setRenaming(area.name)} label={`Rename ${area.name}`}>
              Rename
            </TextButton>
            <TextButton onClick={() => archiveArea(area.id)} label={`Archive ${area.name}`}>
              Archive
            </TextButton>
            <DeleteButton
              title={area.name}
              inside={liveInside(area.id, tree.items)}
              onDelete={() => deleteArea(area.id)}
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
            button="Add epic"
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'epic', title, parentId: area.id })
            }
          />
        }
      />

      <Row side={<h3 className="text-sm text-body md:pt-2">Inbox</h3>}>
        <Board>
          <div className="min-w-0">
            <TaskList
              parent={area.id}
              name={area.name}
              listLabel={`${area.name} inbox`}
              empty="The inbox is empty."
              {...tree}
            />
          </div>
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
function Row({ side, label, children }: { side: ReactNode; label?: string; children?: ReactNode }) {
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
  const layout = 'grid md:grid-cols-[14rem_minmax(0,1fr)]'
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
            button="Add"
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'outcome', title, parentId: epic.id })
            }
          />
        </div>
        <div className="min-w-0">
          <TaskList
            parent={epic.id}
            name={epic.title}
            listLabel={`${epic.title} tasks`}
            empty="No tasks directly under this epic."
            {...tree}
          />
        </div>
      </Board>

      <PutAway
        items={[...finishedTasks(children), ...outcomes.filter((o) => !isOpenContainer(o))]}
        allItems={tree.items}
      />
    </Row>
  )
}

/** An outcome's column: its card, its open tasks beneath, and what it has put away. */
function OutcomeColumn({ outcome, ...tree }: TreeProps & { outcome: Item }) {
  return (
    <section aria-label={`Outcome: ${outcome.title}`} className="flex min-w-0 flex-col gap-2">
      <ContainerCard item={outcome} allItems={tree.items} />
      <TaskList
        parent={outcome.id}
        name={outcome.title}
        listLabel={`${outcome.title} tasks`}
        empty="No tasks yet."
        {...tree}
      />
      <PutAway items={finishedTasks(childrenOf(outcome.id, tree.items))} allItems={tree.items} />
    </section>
  )
}

/**
 * The card that names an epic or an outcome and carries its own actions:
 * rename, finish, archive, delete. What it holds is drawn beside or beneath it
 * by the row or column it heads, not inside it.
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
    <div className="rounded-xl border border-muted bg-surface/40 px-3 py-2.5">
      <span className="text-[10px] font-medium tracking-widest text-muted uppercase">{noun}</span>
      {renaming === null ? (
        <>
          <div className="mt-0.5 flex items-start gap-2">
            <Heading className="min-w-0 flex-1 text-sm text-bright wrap-break-word">
              {item.title}
            </Heading>
            <button
              type="button"
              onClick={() => setRenaming(item.title)}
              aria-label={`Rename ${item.title}`}
              className="shrink-0 text-muted transition hover:text-bright"
            >
              <EditGlyph />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <TextButton onClick={() => completeItem(item.id)} label={`Mark ${item.title} done`}>
              Done
            </TextButton>
            <TextButton onClick={() => archiveItem(item.id)} label={`Archive ${item.title}`}>
              Archive
            </TextButton>
            <DeleteButton
              title={item.title}
              inside={liveInside(item.id, allItems)}
              onDelete={() => deleteItem(item.id)}
            />
          </div>
        </>
      ) : (
        <div className="mt-1 flex">
          <InlineEdit
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
      {open.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul aria-label={listLabel} className="flex flex-col gap-2">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              places={tree.places}
              intentions={tree.intentions}
              intentionId={tree.taskIntentions[task.id] ?? null}
              onLink={(id) => tree.onLink(task.id, id)}
            />
          ))}
        </ul>
      )}
      <AddForm
        opener="Add task"
        openerLabel={`Add a task to ${name}`}
        label={`New task in ${name}`}
        // The column already says whose; a column is too narrow to say it twice.
        placeholder="Add a task"
        button="Add"
        onAdd={(title) => useTasks.getState().addItem({ kind: 'task', title, parentId: parent })}
      />
    </>
  )
}

const OPENER_CLASS = {
  // `self-start` so a flex column (an outcome's) does not stretch it to full width.
  inline: 'mt-2 self-start text-xs text-muted',
  prominent: 'mt-2 self-start text-sm text-body',
  slot: 'w-full rounded-xl border border-dashed border-line px-3 py-4 text-left text-xs text-muted hover:border-muted',
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
 * A `+ Add …` button that opens into the field it asks for.
 *
 * Folded because the board has one in every column, every epic and every area,
 * and open they outweighed the tasks they add to: a page that is mostly empty
 * fields reads as a form to fill in rather than as the backlog. The fold costs
 * one click, and only on the rarer visit that adds rather than ticks.
 *
 * Once open it stays open after each add, cleared and focused, because things
 * are usually written down in runs — three tasks for one outcome, not one. It
 * folds again on Escape or ×, which hand focus back to the button, and when
 * another field is opened while it is empty, so at most one empty field is
 * ever showing and nothing typed is ever thrown away.
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
  button,
  maxLength = 120,
  className = '',
  onAdd,
}: {
  /** The folded button's text, after its `+`. */
  opener: string
  /** The folded button's accessible name, when its text alone does not say where. */
  openerLabel?: string
  /**
   * `inline` under what it adds to; `prominent` for the page's own `+ Add
   * area`, sized as the page's last word rather than a column's; `slot` for a
   * whole column of the board, outlined where the new column will stand.
   */
  variant?: 'inline' | 'prominent' | 'slot'
  label: string
  placeholder: string
  button: string
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
  const openerButton = useRef<HTMLButtonElement>(null)
  const refocusOpener = useRef(false)

  // The button only exists again once the fold has rendered, so focus is
  // handed back after it rather than in the handler that folds it.
  useEffect(() => {
    if (open || !refocusOpener.current) return
    refocusOpener.current = false
    openerButton.current?.focus()
  }, [open])

  const fold = () => {
    refocusOpener.current = true
    setTitle(null)
    if (current === id) claim(null)
  }

  if (!open) {
    return (
      <button
        ref={openerButton}
        type="button"
        onClick={() => {
          setTitle('')
          claim(id)
        }}
        {...(openerLabel ? { 'aria-label': openerLabel } : {})}
        className={`transition hover:text-bright ${OPENER_CLASS[variant]} ${className}`}
      >
        <span aria-hidden="true">+ </span>
        {opener}
      </button>
    )
  }

  return (
    <form
      className={`flex items-center gap-2 ${variant === 'slot' ? '' : 'mt-2'} ${className}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (onAdd(title) === null) return
        setTitle('')
        field.current?.focus()
      }}
    >
      <input
        ref={field}
        value={title}
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
      <GhostButton
        type="submit"
        disabled={title.trim() === ''}
        className="shrink-0 px-3 py-1.5 text-xs"
      >
        {button}
      </GhostButton>
      <button
        type="button"
        onClick={fold}
        aria-label={`Cancel ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        className="shrink-0 px-1 text-muted transition hover:text-bright"
      >
        ×
      </button>
    </form>
  )
}

/**
 * One open task: tick it, rename it, put it under one of today's intentions,
 * move it anywhere a task can live, drop it, or delete it.
 *
 * Drop and delete are different on purpose. Dropping is deciding not to do
 * it, and it stays in the finished list as a decision; deleting is a mistake
 * being taken back, and leaves only a tombstone the page never shows.
 */
function TaskRow({
  task,
  places,
  intentions,
  intentionId,
  onLink,
}: {
  task: Item
  places: readonly Place[]
  intentions: readonly Intention[]
  intentionId: string | null
  onLink: (intentionId: string | null) => void
}) {
  const completeItem = useTasks((s) => s.completeItem)
  const renameItem = useTasks((s) => s.renameItem)
  const moveItem = useTasks((s) => s.moveItem)
  const dropItem = useTasks((s) => s.dropItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const [renaming, setRenaming] = useState<string | null>(null)

  return (
    <li className="rounded-lg border border-muted/70 px-3 py-2">
      <div className="flex items-start gap-2">
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
            <button
              type="button"
              onClick={() => setRenaming(task.title)}
              aria-label={`Rename ${task.title}`}
              className="shrink-0 text-muted transition hover:text-bright"
            >
              <EditGlyph />
            </button>
          </>
        ) : (
          <InlineEdit
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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6 text-xs">
        {intentions.length > 0 && (
          <InlineSelect
            label={`Today's intention for ${task.title}`}
            prefix="Today"
            value={intentionId ?? ''}
            onChange={(value) => onLink(value === '' ? null : value)}
            options={[
              { value: '', name: '—' },
              ...intentions.map((i) => ({ value: i.id, name: i.title })),
            ]}
          />
        )}
        {places.length > 1 && (
          <MovePicker task={task} places={places} onMove={(value) => moveItem(task.id, value)} />
        )}
        <span className="ml-auto flex gap-3">
          <TextButton onClick={() => dropItem(task.id)} label={`Drop ${task.title}`}>
            Drop
          </TextButton>
          <TextButton onClick={() => deleteItem(task.id)} label={`Delete ${task.title}`}>
            Delete
          </TextButton>
        </span>
      </div>
    </li>
  )
}

/**
 * Where a task lives, shown as a button that becomes the select only when
 * asked.
 *
 * A select in every row mounts every place as an option in every row: a
 * thousand tasks across sixty places is sixty thousand elements, growing with
 * both, and re-rendered with the page each second — for a control used on one
 * row at a time. The button says where the task is; the whole list exists only
 * once it is asked for. It stays a select until a place is picked, rather than
 * folding back when focus leaves: a press elsewhere blurs it before the click
 * completes, and the fold would move the row under that click — the trap the
 * add fields fell into. What stays mounted is bounded by the rows someone
 * actually opened.
 */
function MovePicker({
  task,
  places,
  onMove,
}: {
  task: Item
  places: readonly Place[]
  onMove: (parentId: string) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (!choosing) return
    select.current?.focus()
    // Opened at once where the browser allows it, so a move is still one
    // click; elsewhere the focused select opens on the next.
    try {
      select.current?.showPicker()
    } catch {
      // Unsupported, or the click's activation has lapsed. Focus is enough.
    }
  }, [choosing])

  if (!choosing) {
    const here = labelsOf(places).get(task.parentId) ?? '—'
    return (
      <button
        type="button"
        onClick={() => setChoosing(true)}
        aria-label={`Move ${task.title} from ${here}`}
        className="flex min-w-0 items-center gap-1.5 text-muted transition hover:text-bright"
      >
        <span>In</span>
        <span className="max-w-[11rem] min-w-0 truncate rounded-md border border-muted/70 px-1.5 py-0.5 text-body">
          {here}
        </span>
      </button>
    )
  }
  return (
    <InlineSelect
      ref={select}
      label={`Where ${task.title} lives`}
      prefix="In"
      value={task.parentId}
      onChange={(value) => {
        setChoosing(false)
        onMove(value)
      }}
      options={places.map((p) => ({ value: p.id, name: p.label }))}
    />
  )
}

/**
 * Each place's label by id, built once per list of places — which is once per
 * backlog snapshot — so a row's button finds its own in one lookup.
 */
const placeLabels = new WeakMap<readonly Place[], ReadonlyMap<string, string>>()
function labelsOf(places: readonly Place[]): ReadonlyMap<string, string> {
  let labels = placeLabels.get(places)
  if (!labels) {
    labels = new Map(places.map((p) => [p.id, p.label]))
    placeLabels.set(places, labels)
  }
  return labels
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
}: {
  title: string
  /** How many live items would go with it. */
  inside: number
  onDelete: () => void
}) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <TextButton
        onClick={() => (inside === 0 ? onDelete() : setAsking(true))}
        label={`Delete ${title}`}
      >
        Delete
      </TextButton>
    )
  }
  return (
    <span
      role="group"
      aria-label={`Confirm deleting ${title}`}
      className="flex flex-wrap gap-x-2 gap-y-1"
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
 * An archived item can also be finished; restoring it brings it back as it was,
 * finished or not, so archived ones offer Restore and finished ones Reopen.
 */
function PutAway({ items, allItems }: { items: readonly Item[]; allItems: readonly Item[] }) {
  const reopenItem = useTasks((s) => s.reopenItem)
  const unarchiveItem = useTasks((s) => s.unarchiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  if (items.length === 0) return null

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-muted hover:text-body">
        Done, dropped and archived ({items.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => {
          const archived = item.archivedAt !== undefined
          const state = archived ? 'Archived' : item.status === 'done' ? 'Done' : 'Dropped'
          return (
            <li key={item.id} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-xs text-muted">{state}</span>
              <span
                className={`min-w-0 flex-1 truncate text-muted ${
                  item.status === 'done' && !archived ? 'line-through' : ''
                }`}
              >
                {item.kind !== 'task' && (
                  <span className="mr-1.5 text-[10px] tracking-widest uppercase">{item.kind}</span>
                )}
                {item.title}
              </span>
              {archived ? (
                <TextButton onClick={() => unarchiveItem(item.id)} label={`Restore ${item.title}`}>
                  Restore
                </TextButton>
              ) : (
                <TextButton onClick={() => reopenItem(item.id)} label={`Reopen ${item.title}`}>
                  Reopen
                </TextButton>
              )}
              <DeleteButton
                title={item.title}
                inside={liveInside(item.id, allItems)}
                onDelete={() => deleteItem(item.id)}
              />
            </li>
          )
        })}
      </ul>
    </details>
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

function InlineEdit({
  label,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <form
      className="flex min-w-0 flex-1 gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        aria-label={label}
        // A rename is asked for by a click on this row, so the field it opens
        // is the one place the user is about to type.
        autoFocus
        maxLength={120}
        className={`${fieldClass} py-1 text-sm`}
      />
      <GhostButton type="submit" disabled={value.trim() === ''} className="shrink-0 px-3 py-1 text-xs">
        Save
      </GhostButton>
    </form>
  )
}

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
