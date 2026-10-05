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
 * Two sections, in the order a morning uses them. **Today** is the day's
 * intentions and the tasks gathered under each — the grouping the day keeps,
 * and edits through the event log. **Areas** are the backlog itself: each has
 * its inbox, the open tasks that sit directly under it, and then its epics as
 * cards, each holding its own tasks and its outcomes, each outcome holding its
 * tasks. Three levels is the whole depth the model allows, so the page draws it
 * literally rather than as a general-purpose tree.
 *
 * Epics and outcomes are finished by hand, archived, or deleted. Finishing and
 * archiving never touch what is inside; the subtree leaves the page and the
 * task picker together because its chain is no longer active, and returns
 * unchanged when the epic is reopened or restored — see `isInActiveTree`.
 * Deleting is the one act that reaches into the subtree, and it asks first,
 * naming how much will go with it.
 *
 * Every edit here is a backlog edit — the task store writes the one record it
 * changed — except linking a task to an intention, which is a fact about today
 * and goes to the log like the intentions themselves. A task that is dropped
 * or done keeps its link for the day, and the page simply stops listing it as
 * open.
 */

import { useState, type ReactNode } from 'react'

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
  descendantsOf,
  isLive,
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
  const places = placesForTasks(items, allAreas)
  const inPlay = activeTasks(items, allAreas)
  const [newArea, setNewArea] = useState('')

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
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
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

              {areas.map((area) => (
                <AreaSection
                  key={area.id}
                  area={area}
                  places={places}
                  items={items}
                  intentions={intentions}
                  taskIntentions={taskIntentions}
                  onLink={linkTask}
                />
              ))}

              <Section title="Another area">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (addArea(newArea) !== null) setNewArea('')
                  }}
                >
                  <input
                    value={newArea}
                    onChange={(e) => setNewArea(e.target.value)}
                    placeholder="Health, Home, Side project"
                    aria-label="New area"
                    maxLength={60}
                    className={`${fieldClass} py-2 text-sm`}
                  />
                  <GhostButton type="submit" disabled={newArea.trim() === ''} className="shrink-0">
                    Add area
                  </GhostButton>
                </form>

                {archived.length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-muted hover:text-body">
                      Archived ({archived.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {archived.map((area) => (
                        <li key={area.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted">{area.name}</span>
                          <TextButton onClick={() => unarchiveArea(area.id)}>Restore</TextButton>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        {/* A rename puts a form where the heading was, and a form cannot sit
            inside a heading, so anything but text is rendered as given. */}
        {typeof title === 'string' ? (
          <h2 className="text-xs font-medium tracking-widest text-muted uppercase">{title}</h2>
        ) : (
          title
        )}
        {aside}
      </div>
      {children}
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

function AreaSection({ area, ...tree }: TreeProps & { area: Area }) {
  const renameArea = useTasks((s) => s.renameArea)
  const archiveArea = useTasks((s) => s.archiveArea)
  const [renaming, setRenaming] = useState<string | null>(null)

  const children = childrenOf(area.id, tree.items)
  const epics = children.filter((i) => i.kind === 'epic')
  const openEpics = epics.filter(isOpenContainer)
  const putAway = epics.filter((e) => !isOpenContainer(e))

  return (
    <Section
      title={
        renaming === null ? (
          area.name
        ) : (
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
        )
      }
      aside={
        renaming === null && (
          <div className="flex gap-3">
            <TextButton onClick={() => setRenaming(area.name)} label={`Rename ${area.name}`}>
              Rename
            </TextButton>
            <TextButton onClick={() => archiveArea(area.id)} label={`Archive ${area.name}`}>
              Archive
            </TextButton>
          </div>
        )
      }
    >
      <TaskList
        parent={area.id}
        name={area.name}
        listLabel={`${area.name} inbox`}
        empty="The inbox is empty."
        {...tree}
      />

      {openEpics.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          {openEpics.map((epic) => (
            <ContainerCard key={epic.id} item={epic} {...tree} />
          ))}
        </div>
      )}

      <AddForm
        label={`New epic in ${area.name}`}
        placeholder="A new epic"
        button="Add epic"
        onAdd={(title) => useTasks.getState().addItem({ kind: 'epic', title, parentId: area.id })}
      />

      <PutAway items={[...finishedTasks(children), ...putAway]} allItems={tree.items} />
    </Section>
  )
}

/**
 * An epic or an outcome: its open tasks, then (for an epic) its open outcomes,
 * then the forms that add to it, then what has been put away inside it.
 *
 * One component for both, because an outcome is an epic one level down with
 * the one difference that it cannot hold outcomes of its own.
 */
function ContainerCard({ item, ...tree }: TreeProps & { item: Item }) {
  const renameItem = useTasks((s) => s.renameItem)
  const completeItem = useTasks((s) => s.completeItem)
  const archiveItem = useTasks((s) => s.archiveItem)
  const [renaming, setRenaming] = useState<string | null>(null)

  const noun = item.kind === 'epic' ? 'Epic' : 'Outcome'
  const children = childrenOf(item.id, tree.items)
  const outcomes = children.filter((i) => i.kind === 'outcome')
  const openOutcomes = outcomes.filter(isOpenContainer)

  return (
    <section
      aria-label={`${noun}: ${item.title}`}
      className={`rounded-xl border px-4 py-3 ${
        item.kind === 'epic' ? 'border-muted/70 bg-surface/40' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[10px] font-medium tracking-widest text-muted uppercase">
          {noun}
        </span>
        {renaming === null ? (
          <>
            <h3 className="min-w-0 flex-1 truncate text-sm text-bright">{item.title}</h3>
            <button
              type="button"
              onClick={() => setRenaming(item.title)}
              aria-label={`Rename ${item.title}`}
              className="shrink-0 text-muted transition hover:text-bright"
            >
              <EditGlyph />
            </button>
            {/* Its own line on a phone, so the title keeps the width it needs. */}
            <div className="flex w-full flex-wrap gap-3 sm:w-auto">
              <TextButton onClick={() => completeItem(item.id)} label={`Mark ${item.title} done`}>
                Done
              </TextButton>
              <TextButton onClick={() => archiveItem(item.id)} label={`Archive ${item.title}`}>
                Archive
              </TextButton>
              <DeleteButton item={item} allItems={tree.items} />
            </div>
          </>
        ) : (
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
        )}
      </div>

      <div className="mt-2">
        <TaskList
          parent={item.id}
          name={item.title}
          listLabel={`${item.title} tasks`}
          empty={item.kind === 'epic' ? 'No tasks directly under this epic.' : 'No tasks yet.'}
          {...tree}
        />
      </div>

      {openOutcomes.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {openOutcomes.map((outcome) => (
            <ContainerCard key={outcome.id} item={outcome} {...tree} />
          ))}
        </div>
      )}

      {item.kind === 'epic' && (
        <AddForm
          label={`New outcome in ${item.title}`}
          placeholder="A new outcome"
          button="Add outcome"
          onAdd={(title) =>
            useTasks.getState().addItem({ kind: 'outcome', title, parentId: item.id })
          }
        />
      )}

      <PutAway
        items={[...finishedTasks(children), ...outcomes.filter((o) => !isOpenContainer(o))]}
        allItems={tree.items}
      />
    </section>
  )
}

/** The open tasks directly under one parent, and the form that adds one there. */
function TaskList({
  parent,
  name,
  listLabel,
  empty,
  ...tree
}: TreeProps & { parent: string; name: string; listLabel: string; empty: string }) {
  const open = childrenOf(parent, tree.items).filter(
    (i) => i.kind === 'task' && i.status === 'open',
  )

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
        label={`New task in ${name}`}
        placeholder={`Add a task to ${name}`}
        button="Add"
        onAdd={(title) => useTasks.getState().addItem({ kind: 'task', title, parentId: parent })}
      />
    </>
  )
}

function AddForm({
  label,
  placeholder,
  button,
  onAdd,
}: {
  label: string
  placeholder: string
  button: string
  /** Returns the new id, or null when the store refused it. */
  onAdd: (title: string) => string | null
}) {
  const [title, setTitle] = useState('')
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (onAdd(title) !== null) setTitle('')
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={120}
        className={`${fieldClass} py-2 text-sm`}
      />
      <GhostButton type="submit" disabled={title.trim() === ''} className="shrink-0">
        {button}
      </GhostButton>
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
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={false}
          onChange={() => completeItem(task.id)}
          aria-label={`${task.title} done`}
          className="accent-[var(--color-deep)]"
        />
        {renaming === null ? (
          <>
            <span className="min-w-0 flex-1 truncate text-sm text-bright">{task.title}</span>
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
          <InlineSelect
            label={`Where ${task.title} lives`}
            prefix="In"
            value={task.parentId}
            onChange={(value) => moveItem(task.id, value)}
            options={places.map((p) => ({ value: p.id, name: p.label }))}
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
 * Delete, asking first when there is more than the item itself to lose.
 *
 * Asked inline rather than in a dialog — Settings is the only dialog Mono has
 * — and only when it matters: an empty epic goes at once, an epic with tasks
 * says how many will go with it.
 */
function DeleteButton({ item, allItems }: { item: Item; allItems: readonly Item[] }) {
  const deleteItem = useTasks((s) => s.deleteItem)
  const [asking, setAsking] = useState(false)
  const inside = descendantsOf(item.id, allItems).filter(isLive).length

  if (!asking) {
    return (
      <TextButton
        onClick={() => (inside === 0 ? deleteItem(item.id) : setAsking(true))}
        label={`Delete ${item.title}`}
      >
        Delete
      </TextButton>
    )
  }
  return (
    <span role="group" aria-label={`Confirm deleting ${item.title}`} className="flex gap-2">
      <span className="text-xs text-commit">
        And the {inside} item{inside === 1 ? '' : 's'} inside?
      </span>
      <TextButton onClick={() => deleteItem(item.id)} label={`Delete ${item.title} and everything in it`}>
        Delete all
      </TextButton>
      <TextButton onClick={() => setAsking(false)}>Keep</TextButton>
    </span>
  )
}

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
              <DeleteButton item={item} allItems={allItems} />
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

const finishedTasks = (children: readonly Item[]): Item[] =>
  children.filter((i) => i.kind === 'task' && i.status !== 'open')

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
