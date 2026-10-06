/**
 * "One thing" — asked in place, where the timer will be.
 *
 * This deliberately is not a dialog. Naming the block is part of the work, not
 * an interruption to it, and a modal would blank out the very timeline that
 * tells you what the rest of the day looks like.
 *
 * Two answers: which tasks this block is for, and what it is for. They are
 * different questions. Tasks are the backlog's — "login form", "CSRF token" —
 * and a block takes at least one. The purpose is the block's own sentence
 * about these forty-five minutes, and it stays one sentence and stays
 * required: it is what the blocked-site page shows you, and what the timer
 * carries all block.
 *
 * The purpose field comes first because it is the point of the prompt: under
 * the lists it read as an afterthought to ticking boxes. It was moved below
 * them for a while, on the argument that a sentence written before the work is
 * chosen comes out as a category, and moved back: the tasks are already
 * chosen for the day by the time a block is named, so the sentence is about
 * them rather than ahead of them. It starts as the tasks' titles, filling in
 * above as they are ticked below, and stops following them the moment it is
 * edited. One well-scoped task is a good purpose for a block as it stands;
 * several joined with commas is a starting point the prompt asks you to
 * improve on, though nothing stops you accepting it.
 *
 * The tasks come from today first, in today's own order: the tasks under no
 * intention, then each intention with its tasks in a fine border, every task under the places it lives in (`GroupedTasks`),
 * each place said once, with a checkbox for this block. Tasks finished today
 * are there too, crossed out and not choosable, because the list is also the
 * day's progress. Below that, folded, the rest of the backlog under All Tasks
 * (`TaskBrowser`), where a task can be written there and then, marked done,
 * reopened, renamed or deleted. Something from outside today is a perfectly
 * good use of a block, and a prompt that offered only today's choices would
 * make them a fence; such a task joins today when the block starts, because
 * the block is the day doing it (`block/started`).
 *
 * Choosing here only ticks. Which intention a task is grouped under is the
 * day's business, settled on today's question or the tasks page; a prompt
 * that also grouped would be a second place to answer it, one block at a time.
 * The ring in front of an intention still marks it done, by hand, the same
 * ring as everywhere it is listed. A task chosen from outside today stays
 * listed once chosen, ticked or not, until the prompt closes: a row that
 * vanished when its box was unticked could not be ticked again with the
 * backlog folded, and an outcome there could never show as partly ticked.
 *
 * Not knowing what this block is for is answered on the question too: the
 * play button by the title gives the prompt a few minutes to decide in
 * (`QuestionClock`), as today's question has. It is part of the phase, not the
 * log — nothing is recorded, no plan time goes and no site is blocked, and the
 * block itself starts when it is named. It replaced the priorities block,
 * which recorded not knowing as a block of its own.
 *
 * A whole outcome can be ticked from its heading: every open task of it in
 * that list at once, shown as partly ticked when only some are. The purpose
 * names the outcome when all its open tasks are picked (`purposeParts`). It is
 * a shortcut for picking tasks, not a new thing a block can be for — the block
 * still records task ids, so nothing downstream of this prompt learns that
 * outcomes exist.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { unlockAudio } from '@/ambient/audio'
import { GroupedTasks } from '../GroupedTasks'
import { CheckIcon } from '../icons'
import { QuestionClock } from '../QuestionClock'
import { TaskBrowser } from '../TaskBrowser'
import { IntentionDoneToggle } from '../TodayList'
import { useTodayBacklog } from '../useTodayBacklog'
import { fieldClass, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import type { DecidingTimer } from '@/domain/machine'
import {
  defaultPurpose,
  purposeParts,
  PURPOSE_MAX_LENGTH,
  type TaskTreeNode,
} from '@/domain/tasks'
import { isToday, tasksOfIntention, ungroupedToday, type Today } from '@/domain/today'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import type { BlockKind, Intention, Ms } from '@/domain/types'

type Props = {
  now: Ms
  blockKind: BlockKind
  minutes: number
  /** How long the deciding timer gives itself. */
  reflectMinutes: number
  /** The deciding timer, once it has been asked for. */
  deciding: DecidingTimer | null
  onStartDeciding: () => void
  intentions: readonly Intention[]
  /** Today's tasks, each with its intention or none. */
  today: Today
  onSubmit: (purpose: string, taskIds: string[]) => void
  onCancel: () => void
}

export function PurposePanel({
  now,
  blockKind,
  minutes,
  reflectMinutes,
  deciding,
  onStartDeciding,
  intentions,
  today,
  onSubmit,
  onCancel,
}: Props) {
  const items = useTasks((s) => s.items)
  const allAreas = useTasks((s) => s.areas)
  const addItem = useTasks((s) => s.addItem)
  const renameItem = useTasks((s) => s.renameItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const completeItem = useTasks((s) => s.completeItem)
  const reopenItem = useTasks((s) => s.reopenItem)
  const updateIntention = useSession((s) => s.updateIntention)
  // Only tasks whose epic, outcome and area are all still in play, per backlog
  // snapshot rather than per tick — this panel renders every second.
  const backlog = useTodayBacklog(today)

  // What the user ticked. Not what the block is for: see `selected` below.
  const [ticked, setTicked] = useState<string[]>([])
  // `null` while the purpose is still following the tasks; text once edited.
  const [ownPurpose, setOwnPurpose] = useState<string | null>(null)
  // Everything chosen from outside today on this prompt, which stays listed
  // whether or not it is still ticked — see the header.
  const [kept, setKept] = useState<string[]>([])

  // The ticks that still name a task in play. A task can leave from under a
  // tick — deleted or finished in another tab, its epic archived — and its
  // checkbox goes with it; the tick must too, or Start would stay enabled for a
  // block recording a task nobody can see. Derived rather than pruned, so the
  // purpose, Start and the submission all read the same answer.
  const selected = useMemo(() => {
    const live = new Set(backlog.offered)
    return ticked.filter((id) => live.has(id))
  }, [ticked, backlog.offered])
  const purpose = ownPurpose ?? defaultPurpose(purposeParts(selected, items, allAreas))
  const trimmed = purpose.trim()

  const isPicked = (id: string) => selected.includes(id)
  const tick = (ids: readonly string[], on: boolean) =>
    setTicked((current) =>
      on
        ? [...current, ...ids.filter((id) => !current.includes(id))]
        : current.filter((id) => !ids.includes(id)),
    )

  // The backlog's handlers, stable across the tick so the browser passes it by.
  // A task ticked there is kept listed above, under `Also for this block`.
  const tickOne = useCallback((taskId: string, on: boolean) => {
    setTicked((current) =>
      on
        ? current.includes(taskId)
          ? current
          : [...current, taskId]
        : current.filter((id) => id !== taskId),
    )
    if (on) setKept((current) => (current.includes(taskId) ? current : [...current, taskId]))
  }, [])
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

  // Today, grouped per change to the day or the backlog rather than per tick.
  const group = backlog.group
  const todayGroups = useMemo(
    () => ({
      byIntention: intentions.map((i) => ({
        intention: i,
        groups: group(tasksOfIntention(i.id, today)),
      })),
      none: group(ungroupedToday(today)),
    }),
    [intentions, today, group],
  )

  // What was chosen here from outside today, still in play and still outside,
  // grouped per change rather than per tick: grouping walks the tree.
  const offered = backlog.offered
  const outsideGroups = useMemo(() => {
    const live = new Set(offered)
    const ids = [...new Set([...kept, ...selected])].filter(
      (id) => !isToday(today, id) && live.has(id),
    )
    return group(ids)
  }, [kept, selected, today, offered, group])
  const nothingToday = backlog.chosen.length === 0

  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed && selected.length > 0) onSubmit(trimmed, selected)
      }}
    >
      <StagePrompt
        eyebrow={`${minutes} minute ${blockKind === 'deep' ? 'deep' : 'short'} block`}
        // The stage is still called "One thing" everywhere it is named; only
        // the heading asks the question in full.
        title="Your purpose for this block"
        detail="What is this block for, and which tasks come under it?"
        aside={
          <QuestionClock
            now={now}
            timer={deciding}
            minutes={reflectMinutes}
            onStart={() => {
              // A gesture, so the chime at zero can be heard.
              void unlockAudio()
              onStartDeciding()
            }}
            timeLeftLabel="Time left to decide"
            hint="Left to work out what this block is for"
          />
        }
      />

      <input
        value={purpose}
        onChange={(e) => setOwnPurpose(e.target.value)}
        placeholder="My goal for this block"
        aria-label="Purpose for this block"
        maxLength={PURPOSE_MAX_LENGTH}
        className={`${fieldClass} mb-5 py-3 text-lg`}
      />

      {!backlog.hydrated ? (
        <p className="text-sm text-muted">Loading your tasks…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {nothingToday ? (
            <p className="text-sm text-muted">
              Nothing is chosen for today yet. Find this block&apos;s tasks in the backlog below.
            </p>
          ) : (
            <Section title="Today's tasks">
              {/* In today's own order: the tasks under no intention first, with
                  no heading of their own because they are simply today, then
                  each intention. */}
              {todayGroups.none.length > 0 && (
                <TaskList
                  label={intentions.length > 0 ? 'Not grouped' : 'Chosen today'}
                  groups={todayGroups.none}
                  isPicked={isPicked}
                  onTick={tick}
                />
              )}
              {todayGroups.byIntention.map(({ intention, groups }) => (
                <IntentionTasks
                  key={intention.id}
                  intention={intention}
                  groups={groups}
                  isPicked={isPicked}
                  onTick={tick}
                  onToggleDone={() =>
                    updateIntention(intention.id, { done: intention.done !== true })
                  }
                />
              ))}
            </Section>
          )}

          {outsideGroups.length > 0 && (
            <Section title="Also for this block">
              <TaskList
                label="Also for this block"
                groups={outsideGroups}
                isPicked={isPicked}
                onTick={tick}
              />
            </Section>
          )}

          <BacklogFold openAtFirst={nothingToday}>
            <TaskBrowser
              label="Tasks for this block"
              tree={backlog.pickerTree}
              selected={selected}
              onToggle={tickOne}
              onAdd={write}
              onRename={renameItem}
              onDelete={deleteItem}
              onComplete={completeItem}
              onReopen={reopenItem}
              elsewhere={under}
            />
          </BacklogFold>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={!trimmed || selected.length === 0}>
          Start
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Not yet
        </GhostButton>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Stuck? Press play by the question for {reflectMinutes} minutes to work out what
        matters first.
      </p>
    </form>
  )
}

const headingClass = 'mb-1.5 text-xs font-medium tracking-wide text-muted uppercase'

/**
 * A part of the prompt under its own heading, with a faint rule under it, so
 * the list says what it is: today's tasks, or what this block takes from
 * outside them.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className={`${headingClass} mb-0 border-b border-muted/40 pb-1.5`}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * The rest of the backlog, folded under All Tasks: a block usually comes from
 * today, and the whole tree drawn under it every time would make the prompt as
 * long as the backlog. Open from the start when today has nothing in it, since
 * then it is the only place to choose from. The browser is drawn only while
 * open.
 */
function BacklogFold({ openAtFirst, children }: { openAtFirst: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(openAtFirst)
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="min-w-0">
      <summary className={`${headingClass} cursor-pointer hover:text-body`}>All Tasks</summary>
      {open && <div className="mt-2 text-xs">{children}</div>}
    </details>
  )
}

/**
 * An intention under its title, with its tasks in the list's usual grouping.
 *
 * One marked done keeps its place and its tasks, crossed out and quieter: its
 * tasks can still be ticked for a block, since leftovers are still work, and
 * hiding them would leave a tick made before it was marked done invisible.
 */
function IntentionTasks({
  intention,
  groups,
  isPicked,
  onTick,
  onToggleDone,
}: {
  intention: Intention
  groups: readonly TaskTreeNode[]
  isPicked: (taskId: string) => boolean
  onTick: (taskIds: readonly string[], on: boolean) => void
  onToggleDone: () => void
}) {
  const headingId = useId()
  const { title } = intention
  const done = intention.done === true
  return (
    // The fine border today's question marks an intention with, so the two
    // read alike.
    <div
      role="group"
      aria-labelledby={headingId}
      className={`min-w-0 rounded-md border border-line px-2 py-1.5 ${done ? 'opacity-70' : ''}`}
    >
      <div className="mb-1 flex items-baseline gap-2 text-sm">
        <IntentionDoneToggle intention={intention} onToggle={onToggleDone} />
        <span
          id={headingId}
          className={`min-w-0 truncate ${done ? 'text-muted line-through' : 'text-bright'}`}
        >
          {title}
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="text-xs text-muted">No tasks under it yet.</p>
      ) : (
        <TaskList label={title} groups={groups} isPicked={isPicked} onTick={onTick} />
      )}
    </div>
  )
}

/**
 * Tasks under their places, each with a checkbox for this block, and today's
 * finished ones crossed out. An outcome of more than one open task can be
 * taken whole from its heading.
 */
function TaskList({
  label,
  groups,
  isPicked,
  onTick,
}: {
  label: string
  groups: readonly TaskTreeNode[]
  isPicked: (taskId: string) => boolean
  onTick: (taskIds: readonly string[], on: boolean) => void
}) {
  return (
    <GroupedTasks
      label={label}
      groups={groups}
      renderTask={(task) =>
        task.status === 'done' ? (
          // Finished today: the day's progress, not a choice.
          <span className="flex items-baseline gap-2 text-sm text-muted">
            <CheckIcon className="w-[13px] translate-y-0.5 text-deep/80" />
            <span className="min-w-0 truncate line-through">{task.title}</span>
            <span className="sr-only">, done today</span>
          </span>
        ) : (
          <label className="flex cursor-pointer items-baseline gap-2 text-sm text-body hover:text-bright">
            <input
              type="checkbox"
              checked={isPicked(task.id)}
              onChange={() => onTick([task.id], !isPicked(task.id))}
              className="translate-y-0.5 accent-[var(--color-deep)]"
            />
            <span className="min-w-0 truncate">{task.title}</span>
          </label>
        )
      }
      renderPlace={(node, line) => {
        const ids = node.tasks.filter((t) => t.status === 'open').map((t) => t.id)
        if (node.kind !== 'outcome' || ids.length < 2) return line
        const picked = ids.filter(isPicked).length
        return (
          <WholeOutcome
            name={node.name}
            line={line}
            state={picked === 0 ? 'none' : picked === ids.length ? 'all' : 'some'}
            onToggle={() => onTick(ids, picked !== ids.length)}
          />
        )
      }}
    />
  )
}

/**
 * An outcome's heading as a checkbox for every task of it in the list.
 *
 * Three states, because an outcome is a set: none of its tasks picked, all of
 * them, or some. The browser's `indeterminate` is a property with no
 * attribute, so it is set from an effect on the one value it depends on.
 */
function WholeOutcome({
  name,
  line,
  state,
  onToggle,
}: {
  name: string
  line: string
  state: 'none' | 'some' | 'all'
  onToggle: () => void
}) {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (box.current) box.current.indeterminate = state === 'some'
  }, [state])

  return (
    <label className="flex cursor-pointer items-baseline gap-2 hover:text-bright">
      <input
        ref={box}
        type="checkbox"
        checked={state === 'all'}
        onChange={onToggle}
        aria-label={`All of ${name}`}
        {...(state === 'some' ? { 'aria-checked': 'mixed' as const } : {})}
        className="translate-y-0.5 accent-[var(--color-deep)]"
      />
      <span className="min-w-0 truncate">{line}</span>
    </label>
  )
}
