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
 * and edits through the event log. **Areas** are the backlog itself, each with
 * its inbox: the open tasks that sit directly under it. This round's page goes
 * no deeper than that. Epics and outcomes exist in the model and in storage,
 * and a task under one is still picked from the purpose prompt, but filing
 * into them waits for their own page.
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
import { EditGlyph, fieldClass, GhostButton, headerControlClass } from '../ui'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { DAY_HASH } from '@/hooks/useRoute'
import { RoomMenu } from '@/ambient/RoomMenu'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import { activeAreas, childrenOf, isLive, type Area, type Item } from '@/domain/tasks'
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
                        tasks={items.filter(
                          (t) =>
                            isLive(t) &&
                            t.kind === 'task' &&
                            t.status === 'open' &&
                            taskIntentions[t.id] === intention.id,
                        )}
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
                  areas={areas}
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
  onUnlink,
}: {
  intention: Intention
  tasks: readonly Item[]
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
              <span className="min-w-0 truncate text-body">{task.title}</span>
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

function AreaSection({
  area,
  areas,
  items,
  intentions,
  taskIntentions,
  onLink,
}: {
  area: Area
  areas: readonly Area[]
  items: readonly Item[]
  intentions: readonly Intention[]
  taskIntentions: Readonly<Record<string, string>>
  onLink: (taskId: string, intentionId: string | null) => void
}) {
  const addTask = useTasks((s) => s.addTask)
  const renameArea = useTasks((s) => s.renameArea)
  const archiveArea = useTasks((s) => s.archiveArea)
  const [title, setTitle] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)

  const direct = childrenOf(area.id, items).filter((i) => i.kind === 'task')
  const open = direct.filter((t) => t.status === 'open')
  const finished = direct.filter((t) => t.status !== 'open')

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
      {open.length === 0 ? (
        <p className="text-sm text-muted">The inbox is empty.</p>
      ) : (
        <ul aria-label={`${area.name} inbox`} className="flex flex-col gap-2">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              area={area}
              areas={areas}
              intentions={intentions}
              intentionId={taskIntentions[task.id] ?? null}
              onLink={(id) => onLink(task.id, id)}
            />
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (addTask({ title, parentId: area.id }) !== null) setTitle('')
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`Add a task to ${area.name}`}
          aria-label={`New task in ${area.name}`}
          maxLength={120}
          className={`${fieldClass} py-2 text-sm`}
        />
        <GhostButton type="submit" disabled={title.trim() === ''} className="shrink-0">
          Add
        </GhostButton>
      </form>

      {finished.length > 0 && <Finished tasks={finished} />}
    </Section>
  )
}

/**
 * One open task: tick it, rename it, put it under one of today's intentions,
 * move it to another area, drop it, or delete it.
 *
 * Drop and delete are different on purpose. Dropping is deciding not to do
 * it, and it stays in the finished list as a decision; deleting is a mistake
 * being taken back, and leaves only a tombstone the page never shows.
 */
function TaskRow({
  task,
  area,
  areas,
  intentions,
  intentionId,
  onLink,
}: {
  task: Item
  area: Area
  areas: readonly Area[]
  intentions: readonly Intention[]
  intentionId: string | null
  onLink: (intentionId: string | null) => void
}) {
  const completeTask = useTasks((s) => s.completeTask)
  const renameTask = useTasks((s) => s.renameTask)
  const moveTask = useTasks((s) => s.moveTask)
  const dropTask = useTasks((s) => s.dropTask)
  const deleteTask = useTasks((s) => s.deleteTask)
  const [renaming, setRenaming] = useState<string | null>(null)

  return (
    <li className="rounded-lg border border-muted/70 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={false}
          onChange={() => completeTask(task.id)}
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
              renameTask(task.id, renaming)
              setRenaming(null)
            }}
            onCancel={() => setRenaming(null)}
          />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6 text-xs">
        {intentions.length > 0 && (
          <Select
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
        {areas.length > 1 && (
          <Select
            label={`Area for ${task.title}`}
            prefix="In"
            value={area.id}
            onChange={(value) => moveTask(task.id, value)}
            options={areas.map((a) => ({ value: a.id, name: a.name }))}
          />
        )}
        <span className="ml-auto flex gap-3">
          <TextButton onClick={() => dropTask(task.id)} label={`Drop ${task.title}`}>
            Drop
          </TextButton>
          <TextButton onClick={() => deleteTask(task.id)} label={`Delete ${task.title}`}>
            Delete
          </TextButton>
        </span>
      </div>
    </li>
  )
}

/** Done and dropped tasks, folded away, each able to come back. */
function Finished({ tasks }: { tasks: readonly Item[] }) {
  const reopenTask = useTasks((s) => s.reopenTask)
  const deleteTask = useTasks((s) => s.deleteTask)

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-muted hover:text-body">
        Done and dropped ({tasks.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0 text-xs text-muted">
              {task.status === 'done' ? 'Done' : 'Dropped'}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${task.status === 'done' ? 'text-muted line-through' : 'text-muted'}`}
            >
              {task.title}
            </span>
            <TextButton onClick={() => reopenTask(task.id)} label={`Reopen ${task.title}`}>
              Reopen
            </TextButton>
            <TextButton onClick={() => deleteTask(task.id)} label={`Delete ${task.title}`}>
              Delete
            </TextButton>
          </li>
        ))}
      </ul>
    </details>
  )
}

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

/** A native select, which is the right control for a short list in a dense row. */
function Select({
  label,
  prefix,
  value,
  onChange,
  options,
}: {
  label: string
  prefix: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; name: string }[]
}) {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-muted">
      <span>{prefix}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="max-w-[11rem] min-w-0 truncate rounded-md border border-muted/70 bg-ink px-1.5 py-0.5 text-body focus:border-deep focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
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
