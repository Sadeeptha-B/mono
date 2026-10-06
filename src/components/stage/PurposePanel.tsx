/**
 * "One thing" — asked in place, where the timer will be.
 *
 * This deliberately is not a dialog. Naming the block is part of the work, not
 * an interruption to it, and a modal would blank out the very timeline that
 * tells you what the rest of the day looks like.
 *
 * Two answers, purpose first: what this block is for, and which tasks come
 * under it. They are different questions. The purpose is the block's own
 * sentence about these forty-five minutes, and it stays one sentence: it is
 * what the blocked-site page shows you, and what the timer carries all block.
 * Tasks are the backlog's — "login form", "CSRF token" — and a block takes at
 * least one.
 *
 * The purpose field comes first because it is the point of the prompt, and
 * under the lists it read as an afterthought to ticking boxes. It still starts
 * as the tasks' titles, filling in above as they are ticked below, and stops
 * following them the moment it is edited. A list of titles joined with commas
 * is the least interesting thing this block could be called and the prompt's
 * whole job is to ask for something better, but nothing stops you accepting
 * it.
 *
 * The tasks come from one dropdown (`TaskTreePicker`) over the whole backlog,
 * where a task can also be written there and then, and below it one list, each
 * task with a checkbox for this block. Tasks under today's intentions are
 * listed under them, whether ticked yet or not, because those are the ones the
 * day was planned around; the rest of the list is what this prompt has chosen
 * from outside them, first, with no heading. Every task sits under the places
 * it lives in (`GroupedTasks`), each place said once. Something small from
 * outside today's intentions is a perfectly good use of the end of a block, and
 * a prompt that offered only the intentions would make them a fence.
 *
 * Choosing here only ticks. Which intention a task belongs to is the day's
 * business, settled on the intentions question or the tasks page; a prompt
 * that also linked would be a second place to answer it, one block at a time.
 * A task chosen from outside the intentions stays listed once chosen, ticked or
 * not, until the prompt closes: a row that vanished when its box was unticked
 * could not be ticked again, and an outcome there could never show as partly
 * ticked.
 *
 * An intention can be put right where it is listed: its ✎ opens the same
 * fields the intentions question and the tasks page write it with
 * (`IntentionFields`), in its place, and saving closes them again. Leaving for
 * the intentions question would cost the ticks and the purpose already
 * written here; a dropdown per intention would keep a form on screen that is
 * wanted once in a while.
 *
 * Not knowing what this block is for is answered on the question too: the
 * play button by the title gives the prompt a few minutes to decide in
 * (`QuestionClock`), as the intentions question has. It is part of the phase,
 * not the log — nothing is recorded, no plan time goes and no site is blocked,
 * and the block itself starts when it is named. It replaced the priorities
 * block, which recorded not knowing as a block of its own.
 *
 * A whole outcome can be ticked from its heading: every task of it in that
 * list at once, shown as partly ticked when only some are. The purpose names
 * the outcome when all its open tasks are picked (`purposeParts`). It is a
 * shortcut for picking tasks, not a new thing a block can be for — the block
 * still records task ids, so nothing downstream of this prompt learns that
 * outcomes exist.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { unlockAudio } from '@/ambient/audio'
import { GroupedTasks } from '../GroupedTasks'
import { IntentionFields, useIntentionBacklog, useSaveIntention } from '../IntentionFields'
import { QuestionClock } from '../QuestionClock'
import { TaskTreePicker } from '../TaskTreePicker'
import { AddFold, EditGlyph, fieldClass, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import type { IntentionDraft } from '@/domain/intentions'
import type { DecidingTimer } from '@/domain/machine'
import {
  defaultPurpose,
  purposeParts,
  PURPOSE_MAX_LENGTH,
  type TaskTreeNode,
} from '@/domain/tasks'
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
  /** Which of today's intentions each task belongs to. */
  taskIntentions: Readonly<Record<string, string>>
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
  taskIntentions,
  onSubmit,
  onCancel,
}: Props) {
  const items = useTasks((s) => s.items)
  const allAreas = useTasks((s) => s.areas)
  const addItem = useTasks((s) => s.addItem)
  const renameItem = useTasks((s) => s.renameItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  // Only tasks whose epic, outcome and area are all still in play, per backlog
  // snapshot rather than per tick — this panel renders every second.
  const backlog = useIntentionBacklog(taskIntentions)

  // What the user ticked. Not what the block is for: see `selected` below.
  const [ticked, setTicked] = useState<string[]>([])
  // `null` while the purpose is still following the tasks; text once edited.
  const [ownPurpose, setOwnPurpose] = useState<string | null>(null)
  // Everything chosen from outside the intentions on this prompt, which stays
  // listed whether or not it is still ticked — see the header.
  const [kept, setKept] = useState<string[]>([])
  // The intention being put right in place, if any — see the header.
  const [editing, setEditing] = useState<IntentionDraft | null>(null)
  const save = useSaveIntention({
    taskIntentions,
    onAdd: useSession((s) => s.addIntention),
    onUpdate: useSession((s) => s.updateIntention),
    onLinkTask: useSession((s) => s.linkTask),
  })

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

  /** The intention a task is under today, said beside it in the dropdown. */
  const under = (taskId: string) => {
    const id = taskIntentions[taskId]
    return id === undefined ? null : (intentions.find((i) => i.id === id)?.title ?? null)
  }

  // The head of the list: what was chosen here or ticked from outside every
  // intention, still in play and still outside them.
  const outside = [...new Set([...kept, ...selected])].filter(
    (id) => taskIntentions[id] === undefined && backlog.offered.includes(id),
  )

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
          <div className="text-xs">
            <TaskTreePicker
              label="Tasks for this block"
              prefix="Select tasks for this block"
              tree={backlog.tree}
              selected={selected}
              onChange={(next) => {
                setTicked(next)
                setKept((current) => [...current, ...next.filter((id) => !current.includes(id))])
              }}
              onAdd={(parentId, title) => addItem({ kind: 'task', title, parentId })}
              onRename={renameItem}
              onDelete={deleteItem}
              elsewhere={under}
            />
          </div>

          {outside.length > 0 && (
            <TaskList
              label="Tasks outside today's intentions"
              groups={backlog.group(outside)}
              isPicked={isPicked}
              onTick={tick}
            />
          )}

          {intentions.length > 0 && (
            <MyIntentions>
              {intentions.map((intention) =>
                editing?.editing === intention.id ? (
                  <IntentionEditor
                    key={intention.id}
                    draft={editing}
                    onDraft={setEditing}
                    intentions={intentions}
                    taskIntentions={taskIntentions}
                    onSave={() => {
                      if (save(editing) !== null) setEditing(null)
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <IntentionTasks
                    key={intention.id}
                    title={intention.title}
                    groups={backlog.group(backlog.tasksUnder(intention.id))}
                    isPicked={isPicked}
                    onTick={tick}
                    onEdit={() =>
                      setEditing({
                        title: intention.title,
                        taskIds: backlog.tasksUnder(intention.id),
                        editing: intention.id,
                      })
                    }
                  />
                ),
              )}
            </MyIntentions>
          )}
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
 * Today's intentions under one heading, so the list says what it is: the
 * tasks above it were chosen from outside them, the ones below are theirs.
 * The heading carries a faint rule: both halves are the same rows in the same
 * grouping, and a small caps label alone was easy to read past.
 */
function MyIntentions({ children }: { children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className={`${headingClass} mb-0 border-b border-muted/40 pb-1.5`}>
        My intentions
      </h3>
      {children}
    </section>
  )
}

/** An intention under its title, with its tasks in the list's usual grouping. */
function IntentionTasks({
  title,
  groups,
  isPicked,
  onTick,
  onEdit,
}: {
  title: string
  groups: readonly TaskTreeNode[]
  isPicked: (taskId: string) => boolean
  onTick: (taskIds: readonly string[], on: boolean) => void
  onEdit: () => void
}) {
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0">
      {/* On the title's baseline and at its size: the pencil is a character,
          and left to inherit it sat larger and off the line. */}
      <div className="mb-1 flex items-baseline gap-2 text-sm">
        <span id={headingId} className="min-w-0 truncate text-bright">
          {title}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit intention ${title}`}
          className="shrink-0 leading-none text-muted transition hover:text-bright"
        >
          <EditGlyph />
        </button>
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
 * An intention put right in place: the fields it is always written with, under
 * an `Edit intention` heading whose × leaves it as it was.
 *
 * Not a form of its own — it sits inside the prompt's, and HTML has no nested
 * forms — so Enter in the title is caught here and saves, rather than reaching
 * the prompt and starting the block.
 */
function IntentionEditor({
  draft,
  onDraft,
  intentions,
  taskIntentions,
  onSave,
  onCancel,
}: {
  draft: IntentionDraft
  onDraft: (draft: IntentionDraft) => void
  intentions: readonly Intention[]
  taskIntentions: Readonly<Record<string, string>>
  onSave: () => void
  onCancel: () => void
}) {
  const title = useRef<HTMLInputElement>(null)
  return (
    <AddFold
      title="Edit intention"
      open
      onOpen={() => undefined}
      onCancel={onCancel}
      cancelLabel={`Cancel editing ${draft.title || 'this intention'}`}
      className="text-sm text-body"
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.target !== title.current) return
          e.preventDefault()
          onSave()
        }}
      >
        <IntentionFields
          draft={draft}
          onDraft={onDraft}
          intentions={intentions}
          taskIntentions={taskIntentions}
          fieldRef={title}
          // Opened by a click asking for exactly this.
          autoFocus
          onEscape={onCancel}
        />
        <GhostButton
          type="button"
          disabled={draft.title.trim() === ''}
          onClick={onSave}
          className="mt-3 px-3 py-1.5 text-xs"
        >
          Done
        </GhostButton>
      </div>
    </AddFold>
  )
}

/**
 * Tasks under their places, each with a checkbox for this block. An outcome of
 * more than one task can be taken whole from its heading.
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
      renderTask={(task) => (
        <label className="flex cursor-pointer items-baseline gap-2 text-sm text-body hover:text-bright">
          <input
            type="checkbox"
            checked={isPicked(task.id)}
            onChange={() => onTick([task.id], !isPicked(task.id))}
            className="translate-y-0.5 accent-[var(--color-deep)]"
          />
          <span className="min-w-0 truncate">{task.title}</span>
        </label>
      )}
      renderPlace={(node, line) => {
        const ids = node.tasks.map((t) => t.id)
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
