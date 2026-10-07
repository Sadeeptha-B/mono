/**
 * The third opening question: what are you working on today?
 *
 * Asked last because it is the one answer that depends on the other two —
 * what you mean to do with a day is only honest once you know how much of it
 * is yours — and the question says how much that is.
 *
 * It is answered with tasks. It used to be answered with intentions, each a
 * title with tasks chosen under it, and a title written first, before anything
 * was scoped, came out as the name of an epic or outcome the backlog already
 * had. So the order is inverted: choose the tasks, and then, if it helps, give
 * some of them a name. A day that only knows its rough shape writes a task
 * that says so — "look into the billing double charge" — which is cheap, files
 * itself in an area's inbox, and is exactly what an intention was, without the
 * copy of an epic.
 *
 * The stage holds the answer and nothing else:
 *
 * - **Today's tasks** (`TodayList`): the intentions, then what is chosen
 *   under none, with `+ Intention` level with the heading.
 * - **From last time**: what the last working day chose and did not finish,
 *   offered with a `+` each and never added by itself (`carriedOver`).
 *   Yesterday's list is the commonest thing to have changed your mind about
 *   overnight.
 *
 * Where the tasks come from is All Tasks, the whole backlog, which the column
 * beside the stage shows instead of the day while this question is open
 * (`AllTasksPane`): a tick chooses a task for today, `+ Task` in a place's `⋯`
 * writes one, and a row dragged onto an intention here is chosen and grouped in
 * one move. The stage keeps only the answer.
 *
 * Every choice is written to the day's log as it is made, as linking a task to
 * an intention always was; only the intention's title being typed is a draft,
 * and it lives in `DaySetupPanel`, which stays mounted while the user moves
 * between the questions.
 *
 * It carries its own timer. Unlike a commitment, something to do is always
 * there to be found: a day with nothing fixed in it is ordinary, a day with
 * nothing meant by it is not. What can go wrong instead is the opposite of the
 * empty answer, which is sitting here for half an hour grooming a backlog. So
 * the question gives itself a few minutes, starts counting the first time it
 * is asked, and at zero stops and asks whether you want longer. It never
 * finishes the setup for you, and it records nothing.
 *
 * That is why it is a timer on the question rather than a priorities block,
 * which was the other way to build it. A block is recorded, costs plan time and
 * arms site blocking, and it can only run inside working hours — while this
 * question is most often asked at half past eight, before they start. The
 * timer's instants live in `App`, beside which question is on screen, and the
 * face is derived from them and `now` like every other timer here.
 *
 * With the pop-out open, the question and its clock show there too
 * (`MiniSetup`), and the play button works from either place. Deciding what a
 * day is for is evaluative work that drifts, and an always-on-top clock keeps
 * the few minutes in view; the tasks themselves are still chosen here.
 */

import { useMemo } from 'react'

import { unlockAudio } from '@/ambient/audio'
import { GroupedTasks } from '../GroupedTasks'
import { QuestionClock } from '../QuestionClock'
import { TodayList, type IntentionRename } from '../TodayList'
import { useTodayBacklog } from '../useTodayBacklog'
import { StagePrompt } from '../ui'
import { formatDuration } from '@/domain/time'
import type { TaskTreeNode } from '@/domain/tasks'
import type { Ms } from '@/domain/types'
import { useSession } from '@/store/session'

/** The two instants today's timer runs between. */
export type TodayTimer = { startedAt: Ms; endsAt: Ms }

export function TodayPanel({
  now,
  eyebrow,
  timer,
  minutes,
  onStartTimer,
  planned,
  newIntention,
  onNewIntention,
  renaming,
  onRenaming,
}: {
  now: Ms
  eyebrow: string
  /** Null until it has been started, which on a re-visit is only by hand. */
  timer: TodayTimer | null
  /** The setting, for the label on the button that starts another round. */
  minutes: number
  onStartTimer: () => void
  /** What the day can still hold, as context for what to choose. */
  planned: { blocks: number; minutes: number }
  /** The new intention's title while its field is open, held across the switch. */
  newIntention: string | null
  onNewIntention: (title: string | null) => void
  /** An intention being renamed, held across the switch for the same reason. */
  renaming: IntentionRename | null
  onRenaming: (rename: IntentionRename | null) => void
}) {
  const backlog = useTodayBacklog()
  const addToToday = useSession((s) => s.addToToday)
  // Per change to the day or the backlog, not per tick: grouping walks the tree.
  const group = backlog.group
  const carried = useMemo(() => group(backlog.carried), [group, backlog.carried])

  return (
    <>
      <StagePrompt
        eyebrow={eyebrow}
        title="What are you working on today?"
        detail={capacityDetail(planned)}
        aside={
          <QuestionClock
            now={now}
            timer={timer}
            minutes={minutes}
            onStart={() => {
              void unlockAudio()
              onStartTimer()
            }}
            timeLeftLabel="Time left to choose today's tasks"
            hint="Left to choose what today is for"
          />
        }
      />

      {!backlog.hydrated ? (
        <p className="text-sm text-muted">Loading your tasks…</p>
      ) : (
        // Clear of the question's own lines: the list is the answer, and
        // pressed up under the capacity line it read as more of it.
        <div className="mt-6 flex flex-col gap-8">
          <section aria-label="Today">
            <TodayList
              // Not "Today": the calendar beside the stage is headed that, and
              // an app-loaded check looks for one heading of that name.
              heading="Today's tasks"
              newIntention={newIntention}
              onNewIntention={onNewIntention}
              renaming={renaming}
              onRenaming={onRenaming}
              empty="Pick tasks from All Tasks, or add your own there."
            />
          </section>

          {backlog.carried.length > 0 && (
            <CarriedOver
              groups={carried}
              count={backlog.carried.length}
              onAdd={(ids) => ids.forEach((id) => addToToday(id))}
              ids={backlog.carried}
            />
          )}
        </div>
      )}
    </>
  )
}

/**
 * What the last working day chose and did not finish, folded, each with a `+`
 * that chooses it for today, and one that takes them all. Folded because it is
 * a reminder rather than an answer: the day is under no obligation to repeat
 * the one before it.
 */
function CarriedOver({
  groups,
  count,
  ids,
  onAdd,
}: {
  groups: readonly TaskTreeNode[]
  count: number
  ids: readonly string[]
  onAdd: (taskIds: readonly string[]) => void
}) {
  return (
    <details>
      <summary
        className="cursor-pointer text-xs font-medium tracking-wide text-muted uppercase hover:text-body"
      >
        From last time ({count})
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <GroupedTasks
          label="Unfinished from last time"
          groups={groups}
          renderTask={(task) => (
            <div className="flex items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() => onAdd([task.id])}
                aria-label={`Add ${task.title} to today`}
                title="Add to today"
                className="shrink-0 px-0.5 leading-5 text-muted transition hover:text-bright"
              >
                +
              </button>
              <span className="min-w-0 flex-1 text-body wrap-break-word">{task.title}</span>
            </div>
          )}
        />
        {count > 1 && (
          <button
            type="button"
            onClick={() => onAdd(ids)}
            className="self-start text-xs text-muted underline-offset-4 transition hover:text-bright hover:underline"
          >
            Add all {count}
          </button>
        )}
      </div>
    </details>
  )
}

function capacityDetail(planned: { blocks: number; minutes: number }): string {
  if (planned.blocks === 0) {
    return 'There is no focus time left in the plan, so keep it short.'
  }
  return `The plan has room for ${planned.blocks} block${
    planned.blocks === 1 ? '' : 's'
  } — ${formatDuration(planned.minutes * 60_000)} of focus.`
}
