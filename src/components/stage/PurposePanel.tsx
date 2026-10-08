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
 * a list of tasks it reads as an afterthought to ticking boxes, and by the
 * time a block is named the day's tasks are already chosen, so the sentence is
 * about them rather than ahead of them. It starts as the tasks' titles,
 * filling in as they are ticked, and stops following them the moment it is
 * edited. One well-scoped task is a good purpose for a block as it stands;
 * several joined with commas is a starting point the prompt asks you to
 * improve on, though nothing stops you accepting it.
 *
 * Under it is the block's answer so far: the tasks ticked for it, and only
 * those, each under the places it lives in (`GroupedTasks`), grouped by the
 * intention it is under today where it has one, each with an × that takes it
 * off the block. Ticking is done in All Tasks, in the column beside the stage
 * (`AllTasksPane`), and both read the one selection `App` holds (`BlockPick`).
 * Listing every one of today's tasks here as well would put a second set of
 * checkboxes beside the tree's. A tick chooses the task for today too, because
 * the block is the day doing it.
 *
 * Intentions are shown here, crossed out once done, but kept in the column,
 * where today's own list (`TodayList`) sits under All Tasks: a block is often
 * where the day's grouping turns out wrong, and a list here that both picked
 * and grouped would ask two questions in one place.
 *
 * Not knowing what this block is for is answered on the question too: the
 * play button by the title gives the prompt a few minutes to decide in
 * (`QuestionClock`), as today's question has. It is part of the phase, not the
 * log — nothing is recorded, no plan time goes and no site is blocked, and the
 * block itself starts when it is named. It replaced the priorities block,
 * which recorded not knowing as a block of its own.
 *
 * The purpose names an outcome when every open task of it is ticked
 * (`purposeParts`). The block still records task ids, so nothing downstream
 * of this prompt learns that outcomes exist. Taking all of an outcome, or an
 * epic, at once is the box on its row in All Tasks; there used to be one on an
 * outcome's heading here, which went with the unticked rows it chose among.
 */

import { useId, useMemo, useState, type ReactNode } from 'react'

import { unlockAudio } from '@/ambient/audio'
import { GroupedTasks } from '../GroupedTasks'
import { QuestionClock } from '../QuestionClock'
import { useTodayBacklog } from '../useTodayBacklog'
import { fieldClass, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import type { DecidingTimer } from '@/domain/machine'
import {
  defaultPurpose,
  purposeParts,
  PURPOSE_MAX_LENGTH,
  type TaskTreeNode,
} from '@/domain/tasks'
import { tasksOfIntention, ungroupedToday } from '@/domain/today'
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
  /** What is ticked for this block and still in play, held by `App` — see `blockPick.ts`. */
  selected: readonly string[]
  onTick: (taskId: string, on: boolean) => void
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
  selected,
  onTick,
  onSubmit,
  onCancel,
}: Props) {
  const items = useTasks((s) => s.items)
  const allAreas = useTasks((s) => s.areas)
  const intentions = useSession((s) => s.session.intentions)
  const today = useSession((s) => s.session.today)
  const backlog = useTodayBacklog()

  // `null` while the purpose is still following the tasks; text once edited.
  const [ownPurpose, setOwnPurpose] = useState<string | null>(null)

  const purpose = ownPurpose ?? defaultPurpose(purposeParts(selected, items, allAreas))
  const trimmed = purpose.trim()

  const untick = (taskId: string) => onTick(taskId, false)

  // What is ticked, grouped as today groups it, per change rather than per
  // tick: grouping walks the tree. An intention with nothing ticked is left out.
  const group = backlog.group
  const chosen = useMemo(() => {
    const ticked = new Set(selected)
    return {
      byIntention: intentions
        .map((i) => ({
          intention: i,
          groups: group(tasksOfIntention(i.id, today).filter((id) => ticked.has(id))),
        }))
        .filter(({ groups }) => groups.length > 0),
      none: group(ungroupedToday(today).filter((id) => ticked.has(id))),
    }
  }, [selected, intentions, today, group])

  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed && selected.length > 0) onSubmit(trimmed, [...selected])
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
        <Section title="Tasks for this block">
          {selected.length === 0 ? (
            <p className="text-sm text-muted">Tick tasks in All Tasks to add them here.</p>
          ) : (
            <>
              {/* In the order today's question draws them: each intention,
                  then the tasks under none. */}
              {chosen.byIntention.map(({ intention, groups }) => (
                <IntentionTasks
                  key={intention.id}
                  intention={intention}
                  groups={groups}
                  onUntick={untick}
                />
              ))}
              {chosen.none.length > 0 && (
                <ChosenList
                  label={intentions.length > 0 ? 'Not grouped' : 'Chosen for this block'}
                  groups={chosen.none}
                  onUntick={untick}
                />
              )}
            </>
          )}
        </Section>
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
        Not sure yet? Press play by the question for {reflectMinutes} minutes to decide.
      </p>
    </form>
  )
}

const headingClass = 'text-xs font-medium tracking-wide text-muted uppercase'

/** The block's tasks under their heading, with a faint rule under it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className={`${headingClass} border-b border-muted/40 pb-1.5`}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * An intention under its title, with the block's tasks under it in the list's
 * usual grouping. Shown, not kept: it is renamed and marked done in the
 * column beside. One marked done is crossed out and quieter; its tasks can
 * still be ticked for a block, since leftovers are still work.
 */
function IntentionTasks({
  intention,
  groups,
  onUntick,
}: {
  intention: Intention
  groups: readonly TaskTreeNode[]
  onUntick: (taskId: string) => void
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
      <div
        id={headingId}
        className={`mb-1 min-w-0 truncate text-sm ${done ? 'text-muted line-through' : 'text-bright'}`}
      >
        {title}
        {done && <span className="sr-only">, done</span>}
      </div>
      <ChosenList label={title} groups={groups} onUntick={onUntick} />
    </div>
  )
}

/** The block's tasks under their places, each with an × that takes it off the block. */
function ChosenList({
  label,
  groups,
  onUntick,
}: {
  label: string
  groups: readonly TaskTreeNode[]
  onUntick: (taskId: string) => void
}) {
  return (
    <GroupedTasks
      label={label}
      groups={groups}
      renderTask={(task) => (
        <span className="flex items-baseline gap-2 text-sm text-body">
          <span className="min-w-0 flex-1 wrap-break-word">{task.title}</span>
          {/* Off the block, not out of today. */}
          <button
            type="button"
            onClick={() => onUntick(task.id)}
            aria-label={`Take ${task.title} off this block`}
            title="Not for this block"
            className="shrink-0 px-1 text-muted transition hover:text-bright"
          >
            ×
          </button>
        </span>
      )}
    />
  )
}
