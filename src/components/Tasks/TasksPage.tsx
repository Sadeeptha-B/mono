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
 * Two parts, in the order a morning uses them. **My intentions for today** is
 * the day's intentions, each with its tasks under the places they live in —
 * written, edited and deleted here as on the opening question, through the
 * same fields and the same save (`IntentionFields`), and kept in the event
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
 * what is inside; the subtree leaves the page and the task picker together
 * because its chain is no longer active, and returns unchanged when the epic
 * or area is reopened or restored — see `isInActiveTree`. Deleting takes the
 * subtree too, the same way and for good (`isGone`), so it asks first, naming
 * how much will go with it.
 *
 * A task moves by being carried: dragged by its row to any other column, or,
 * from the keyboard or a touch screen, picked up with the grip on its row and
 * put down with the `Move here` that every other column then offers. One
 * piece of state, `Carry`, holds the task in hand either way, so the two
 * cannot disagree about which columns will take it. The drag is the browser's
 * own rather than Motion's: Motion's drag moves an element under the pointer
 * but knows nothing about what it is over, so the columns, the hit-testing and
 * the scrolling at the page's edge would all have been written here, and its
 * drag features would have been one more chunk to load for one page. The
 * native drag brings drop targets and edge scrolling with it, and what it does
 * badly — touch, and anyone not using a pointer — is what the pick-up path is
 * for. Only open tasks are carried, and every column on the page takes one,
 * because every column is a place a task can live.
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
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { HeaderMark } from '../HeaderMark'
import { GroupedTasks } from '../GroupedTasks'
import { HeaderStatus } from '../HeaderStatus'
import { IntentionFields, useIntentionBacklog, useSaveIntention } from '../IntentionFields'
import { StorageWarning } from '../StorageWarning'
import {
  AddFold,
  EditGlyph,
  fieldClass,
  GhostButton,
  headerControlClass,
  InlineSelect,
  PageLinks,
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
  type TaskTreeNode,
} from '@/domain/tasks'
import { emptyIntentionDraft, type IntentionDraft } from '@/domain/intentions'
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

  const [carrying, setCarrying] = useState<{ id: string; by: CarryMode } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const landed = useRef<string | null>(null)
  // The task is read back from the backlog rather than kept, so a task in hand
  // is always where the backlog says it is. One that leaves play while held —
  // ticked or deleted in another tab, its epic finished — is simply put down.
  const heldTask = carrying ? inPlayById.get(carrying.id) : undefined
  const carry = useMemo<CarryContext>(() => {
    const putDown = () => {
      setCarrying(null)
      setOver(null)
    }
    const held = heldTask && carrying ? { task: heldTask, by: carrying.by } : null
    return {
      held,
      over,
      hover: setOver,
      pickUp: (task, by) => {
        setCarrying({ id: task.id, by })
        setOver(null)
      },
      putDown,
      moveTo: (parentId) => {
        if (!held) return
        moveItem(held.task.id, parentId)
        // From the keyboard, focus goes with the task to its new column.
        if (held.by === 'pick') landed.current = held.task.id
        putDown()
      },
      landed,
    }
  }, [heldTask, carrying, over, moveItem])

  // Escape puts a picked-up task back down. A drag has its own Escape.
  const picked = carry.held?.by === 'pick' ? carry.held.task : null
  const putDown = carry.putDown
  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') putDown()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picked, putDown])

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
            <>
              <AddFields.Provider value={addFields}>
                <Section title="My intentions for today">
                  <IntentionsToday intentions={intentions} taskIntentions={taskIntentions} />
                </Section>

                <Carry.Provider value={carry}>
                    {/* One rule above the first band and one under each, so every
                        area reads as its own band and the last is closed off from
                        the control that adds another. */}
                    <div className="mt-8 border-t border-line">
                      {areas.map((area) => (
                        <AreaBand
                          key={area.id}
                          area={area}
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
                </Carry.Provider>
              </AddFields.Provider>
            </>
          )}
        </main>
      </div>

      {/* What a pick-up is waiting for, and the way out of it, kept where a
          thumb can reach it: the column it is looking for may be a long way
          down the page from the row it left. */}
      {picked && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-muted/70 bg-surface-raised px-4 py-3 text-sm shadow-lg"
        >
          <span className="min-w-0 flex-1 text-body">
            Moving <span className="text-bright">{picked.title}</span>. Choose{' '}
            <span className="text-deep">Move here</span> where it goes.
          </span>
          <TextButton onClick={putDown} label={`Cancel moving ${picked.title}`}>
            Cancel
          </TextButton>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="mt-8 border-t border-line pt-6">
      <h2 id={headingId} className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
        {title}
      </h2>
      {/* Lines of text, so held to a reading width while the bands go wide. */}
      <div className="max-w-3xl">{children}</div>
    </section>
  )
}

/**
 * Today's intentions, each with its tasks, and the form that writes one.
 *
 * At most one intention form is open at a time — a new one, or an edit drawn
 * in place of the intention it changes — so the draft is one piece of state
 * saying which. A draft aimed at an intention that has since gone (removed on
 * the opening question, or by the midnight reset) is no draft at all. It keeps
 * the page's rule for add fields: opening it folds any other that is empty,
 * and opening another folds it while nothing has been written in it.
 */
function IntentionsToday({
  intentions,
  taskIntentions,
}: {
  intentions: readonly Intention[]
  taskIntentions: Readonly<Record<string, string>>
}) {
  const linkTask = useSession((s) => s.linkTask)
  const addIntention = useSession((s) => s.addIntention)
  const updateIntention = useSession((s) => s.updateIntention)
  const removeIntention = useSession((s) => s.removeIntention)
  const backlog = useIntentionBacklog(taskIntentions)
  const save = useSaveIntention({
    taskIntentions,
    onAdd: addIntention,
    onUpdate: updateIntention,
    onLinkTask: linkTask,
  })

  const [stored, setDraft] = useState<IntentionDraft | null>(null)
  const formId = useId()
  const { current, claim } = useContext(AddFields)
  // Another field was opened: close this form if nothing has been written in it.
  useEffect(() => {
    if (current === null || current === formId) return
    setDraft((d) => (d && d.editing === null && d.title === '' && d.taskIds.length === 0 ? null : d))
  }, [current, formId])
  const open = (next: IntentionDraft) => {
    setDraft(next)
    claim(formId)
  }
  const draft =
    stored && (stored.editing === null || intentions.some((i) => i.id === stored.editing))
      ? stored
      : null
  const adding = draft !== null && draft.editing === null

  const close = () => {
    setDraft(null)
    if (current === formId) claim(null)
  }

  /** Enter keeps a new one and stays open for the next; `Done` keeps it and closes. */
  const submit = (then: 'next' | 'done') => {
    if (draft === null || save(draft) === null) return
    if (then === 'next' && draft.editing === null) setDraft(emptyIntentionDraft)
    else close()
  }

  const form = (current: IntentionDraft) => (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit('next')
      }}
    >
      <IntentionFields
        draft={current}
        onDraft={setDraft}
        intentions={intentions}
        taskIntentions={taskIntentions}
        // Opened by a click asking for exactly this form.
        autoFocus
        onEscape={close}
      />
      {/* With nothing typed it only closes. */}
      <GhostButton
        type="button"
        onClick={() => (current.title.trim() ? submit('done') : close())}
        className="mt-3 px-3 py-1.5 text-xs"
      >
        Done
      </GhostButton>
    </form>
  )

  return (
    <div className="flex flex-col gap-5">
      {intentions.length === 0 && (
        <p className="text-sm text-muted">
          No intentions yet. Add one here, or answer the day's third opening question.
        </p>
      )}
      {intentions.map((intention) =>
        draft?.editing === intention.id ? (
          <AddFold
            key={intention.id}
            title="Edit intention"
            open
            onOpen={() => undefined}
            onCancel={close}
            cancelLabel={`Cancel editing ${intention.title}`}
            className="text-sm text-body"
          >
            {form(draft)}
          </AddFold>
        ) : (
          <TodayGroup
            key={intention.id}
            intention={intention}
            groups={backlog.group(backlog.tasksUnder(intention.id))}
            onEdit={() =>
              open({
                title: intention.title,
                taskIds: backlog.tasksUnder(intention.id),
                editing: intention.id,
              })
            }
            onDelete={() => removeIntention(intention.id)}
            onUnlink={(taskId) => linkTask(taskId, null)}
          />
        ),
      )}
      <AddFold
        title="Add intention"
        open={adding}
        onOpen={() => open(emptyIntentionDraft)}
        onCancel={close}
        cancelLabel="Cancel new intention"
        className="text-sm text-body"
      >
        {adding && form(draft)}
      </AddFold>
    </div>
  )
}

/**
 * One intention: its title and what can be done to it, and its tasks under the
 * places they live in, each place said once rather than on every task.
 */
function TodayGroup({
  intention,
  groups,
  onEdit,
  onDelete,
  onUnlink,
}: {
  intention: Intention
  groups: readonly TaskTreeNode[]
  onEdit: () => void
  onDelete: () => void
  onUnlink: (taskId: string) => void
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h3 className="min-w-0 flex-1 text-sm text-bright wrap-break-word">{intention.title}</h3>
        <TextButton onClick={onEdit} label={`Edit intention ${intention.title}`}>
          Edit
        </TextButton>
        {/* At once, as on the opening question: its tasks stay in the backlog,
            only their place under it goes. */}
        <TextButton onClick={onDelete} label={`Delete intention ${intention.title}`}>
          Delete
        </TextButton>
      </div>
      {groups.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          Nothing open under this one. Edit it to choose tasks, or put one here from its row below.
        </p>
      ) : (
        <GroupedTasks
          label={`Today: ${intention.title}`}
          groups={groups}
          className="mt-1.5"
          renderTask={(task) => (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-body">{task.title}</span>
              {/* Out of the intention, not out of the backlog: the task stays
                  in its column below. */}
              <button
                type="button"
                onClick={() => onUnlink(task.id)}
                aria-label={`Take ${task.title} out of ${intention.title}`}
                title="Not today"
                className="shrink-0 px-1 text-muted transition hover:text-bright"
              >
                ×
              </button>
            </div>
          )}
        />
      )}
    </div>
  )
}

/** Shared down the tree: everything a task row or a card needs to act. */
type TreeProps = {
  items: readonly Item[]
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
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'epic', title, parentId: area.id })
            }
          />
        }
      />

      <Row side={<h3 className="text-sm text-body md:pt-2">Inbox</h3>}>
        <Board>
          <DropZone parent={area.id} className="min-w-0">
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
            onAdd={(title) =>
              useTasks.getState().addItem({ kind: 'outcome', title, parentId: epic.id })
            }
          />
        </div>
        <DropZone parent={epic.id} className="min-w-0">
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
      <DropZone parent={outcome.id} className="flex flex-col gap-2">
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
      <MoveHere parent={parent} name={name} />
      {open.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul aria-label={listLabel} className="flex flex-col gap-2">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
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

/** How a task is being carried: under the pointer, or picked up to be put down. */
type CarryMode = 'drag' | 'pick'

/**
 * The task in hand, page-wide, and the verbs that carry it.
 *
 * A drag and a pick-up are the same move begun two ways, so they share this
 * state: whichever started it, the columns that will take the task are the
 * same ones, and putting it down is the same write.
 */
type CarryContext = {
  held: { task: Item; by: CarryMode } | null
  /** The column a drag is over, so only that one lights up. */
  over: string | null
  hover: (parentId: string | null | ((current: string | null) => string | null)) => void
  pickUp: (task: Item, by: CarryMode) => void
  putDown: () => void
  /** Put the task in hand under `parentId`, and let go of it. */
  moveTo: (parentId: string) => void
  /** The task a pick-up just put down, which takes focus when it lands. */
  landed: RefObject<string | null>
}

const Carry = createContext<CarryContext>({
  held: null,
  over: null,
  hover: () => undefined,
  pickUp: () => undefined,
  putDown: () => undefined,
  moveTo: () => undefined,
  landed: { current: null },
})

/** Whether the task in hand can go under `parent`: anywhere but where it is. */
const takes = (held: CarryContext['held'], parent: string): held is NonNullable<CarryContext['held']> =>
  held !== null && held.task.parentId !== parent

/**
 * A column that takes a carried task, drawn as one while there is one to take:
 * outlined while a task is in hand, lit while a drag is over it.
 *
 * The outline is an outline rather than a border so that showing it moves
 * nothing. The drag begins with this state changing, and a column that grew a
 * border would shift the page under the pointer mid-gesture. A drag from
 * outside the page carries no task, so no column answers it.
 */
function DropZone({
  parent,
  className = '',
  children,
}: {
  parent: string
  className?: string
  children: ReactNode
}) {
  const { held, over, hover, moveTo } = useContext(Carry)
  const open = takes(held, parent)
  const lit = open && over === parent

  const accept = (e: DragEvent) => {
    if (!open || held.by !== 'drag') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (over !== parent) hover(parent)
  }

  return (
    <div
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(e) => {
        // Leaving for one of its own children is not leaving.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        hover((current) => (current === parent ? null : current))
      }}
      onDrop={(e) => {
        if (!open) return
        e.preventDefault()
        moveTo(parent)
      }}
      className={`rounded-xl outline-offset-4 ${
        lit
          ? 'bg-surface/60 outline-2 outline-deep'
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
 * Where a picked-up task can be put down: a button at the head of every column
 * that would take it. Only for a pick-up — a drag has the column itself.
 */
function MoveHere({ parent, name }: { parent: string; name: string }) {
  const { held, moveTo } = useContext(Carry)
  if (!takes(held, parent) || held.by !== 'pick') return null
  return (
    <button
      type="button"
      onClick={() => moveTo(parent)}
      aria-label={`Move ${held.task.title} to ${name}`}
      className="mb-2 w-full rounded-lg border border-dashed border-deep/70 px-3 py-2 text-left text-xs text-deep transition hover:bg-surface-raised"
    >
      Move here
    </button>
  )
}

/**
 * One open task: tick it, rename it, put it under one of today's intentions,
 * carry it to any other column, drop it, or delete it.
 *
 * The whole row drags, which is what a card on a board invites; the grip is
 * where it says so, and the button that picks it up without a pointer. A row
 * being renamed does not drag, so that selecting its text selects text.
 *
 * Drop and delete are different on purpose. Dropping is deciding not to do
 * it, and it stays in the finished list as a decision; deleting is a mistake
 * being taken back, and leaves only a tombstone the page never shows.
 */
function TaskRow({
  task,
  intentions,
  intentionId,
  onLink,
}: {
  task: Item
  intentions: readonly Intention[]
  intentionId: string | null
  onLink: (intentionId: string | null) => void
}) {
  const completeItem = useTasks((s) => s.completeItem)
  const renameItem = useTasks((s) => s.renameItem)
  const dropItem = useTasks((s) => s.dropItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { held, pickUp, putDown, landed } = useContext(Carry)
  const picked = held?.task.id === task.id && held.by === 'pick'

  // A row mounts afresh in the column it was moved to; the one a pick-up just
  // put down takes focus there, so the keyboard ends where the task did.
  const grip = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (landed.current !== task.id) return
    landed.current = null
    grip.current?.focus()
  }, [landed, task.id])

  return (
    <li
      draggable={renaming === null}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        // Firefox starts no drag without data, and a title is what a drag
        // carried out of the page would sensibly drop as.
        e.dataTransfer.setData('text/plain', task.title)
        pickUp(task, 'drag')
      }}
      onDragEnd={putDown}
      className={`rounded-lg border px-3 py-2 ${
        picked ? 'border-dashed border-deep/70 bg-surface/60' : 'border-muted/70'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          ref={grip}
          type="button"
          onClick={() => (picked ? putDown() : pickUp(task, 'pick'))}
          aria-label={`Move ${task.title}`}
          aria-pressed={picked}
          title="Drag to move, or click to pick up"
          className={`-ml-1.5 mt-0.5 shrink-0 cursor-grab rounded px-0.5 py-0.5 transition hover:text-bright active:cursor-grabbing ${
            picked ? 'text-deep' : 'text-muted'
          }`}
        >
          <GripGlyph />
        </button>
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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-9 text-xs">
        {intentions.length > 0 && (
          <InlineSelect
            label={`Today's intention for ${task.title}`}
            prefix="Intention:"
            value={intentionId ?? ''}
            onChange={(value) => onLink(value === '' ? null : value)}
            options={[
              { value: '', name: '—' },
              ...intentions.map((i) => ({ value: i.id, name: i.title })),
            ]}
          />
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
