/**
 * The third opening question: what is today for?
 *
 * Asked last because it is the one answer that depends on the other two —
 * what you mean to do with a day is only honest once you know how much of it
 * is yours — and the question says how much that is.
 *
 * It carries its own timer. Unlike a commitment, an intention is always there
 * to be found: a day with nothing fixed in it is ordinary, a day with nothing
 * meant by it is not. What can go wrong instead is the opposite of the empty
 * answer, which is sitting here for half an hour polishing a list. So the
 * question gives itself a few minutes, starts counting the first time it is
 * asked, and at zero stops and asks whether you want longer. It never finishes
 * the setup for you, and it records nothing.
 *
 * That is why it is a timer on the question rather than a priorities block,
 * which was the other way to build it. A block is recorded, costs plan time and
 * arms site blocking, and it can only run inside working hours — while this
 * question is most often asked at half past eight, before they start. The
 * timer's instants live in `App`, beside which question is on screen, and the
 * face is derived from them and `now` like every other timer here.
 *
 * With the pop-out open, the question and its clock show there too
 * (`MiniIntentions`), and the play button works from either place. Deciding
 * what a day is for is evaluative work that drifts, and an always-on-top clock
 * keeps the few minutes in view; the intentions themselves are still written
 * here.
 *
 * The drafts are not here. They live in `DaySetupPanel`, which stays mounted
 * while the user moves between the questions, for the reason its own header
 * gives: nothing typed is lost by changing your mind about which question to
 * answer first.
 *
 * Once something is named, the field for the next one folds behind its `Add
 * intention` heading (`AddFold`), the tasks page's add fields again: a list of
 * the day's intentions with an empty form under it read as a form still
 * waiting to be filled in. Whether it is open is mostly derived — always while
 * there is nothing named, while one is being edited, or while a draft holds a
 * title or chosen tasks, so a draft carried across the other questions is never
 * folded out of sight. Enter keeps the intention and stays open for the next, because
 * intentions come in runs; `Done` keeps it and folds.
 *
 * An intention is given its tasks as it is written, chosen from the whole
 * backlog or written there and then (`IntentionFields`, shared with the tasks
 * page, which saves the same way). Choosing tasks links them to the intention
 * in the day's log; a task belongs to one intention a day, so choosing one
 * already under another moves it. Each intention in the list shows its tasks
 * under the places they live in (`GroupedTasks`), which is also what says
 * what it is related to — both areas, when its tasks come from two.
 *
 * The ring in front of each marks it done, by hand (`IntentionDoneToggle`).
 */

import { useRef, useState } from 'react'

import { unlockAudio } from '@/ambient/audio'
import { GroupedTasks } from '../GroupedTasks'
import { QuestionClock } from '../QuestionClock'
import {
  IntentionDoneToggle,
  IntentionFields,
  useIntentionBacklog,
  useSaveIntention,
} from '../IntentionFields'
import { AddFold, EditGlyph, GhostButton, StagePrompt } from '../ui'
import { emptyIntentionDraft, type IntentionDraft } from '@/domain/intentions'
import { formatDuration } from '@/domain/time'
import type { TaskTreeNode } from '@/domain/tasks'
import type { Intention, IntentionPatch, Ms } from '@/domain/types'

export { emptyIntentionDraft, type IntentionDraft }

/** The two instants the intentions timer runs between. */
export type IntentionTimer = { startedAt: Ms; endsAt: Ms }

export function IntentionsPanel({
  now,
  eyebrow,
  timer,
  minutes,
  onStartTimer,
  planned,
  intentions,
  taskIntentions,
  onLinkTask,
  draft,
  onDraft,
  onAdd,
  onUpdate,
  onRemove,
}: {
  now: Ms
  eyebrow: string
  /** Null until it has been started, which on a re-visit is only by hand. */
  timer: IntentionTimer | null
  /** The setting, for the label on the button that starts another round. */
  minutes: number
  onStartTimer: () => void
  /** What the day can still hold, as context for what to intend. */
  planned: { blocks: number; minutes: number }
  intentions: readonly Intention[]
  /** Which of today's intentions each task is under. */
  taskIntentions: Readonly<Record<string, string>>
  onLinkTask: (taskId: string, intentionId: string | null) => void
  draft: IntentionDraft
  onDraft: (draft: IntentionDraft) => void
  /** Returns the new intention's id, which its tasks are then linked to. */
  onAdd: (input: Omit<Intention, 'id'>) => string
  onUpdate: (id: string, patch: IntentionPatch) => void
  onRemove: (id: string) => void
}) {
  const title = draft.title.trim()

  const backlog = useIntentionBacklog(taskIntentions)
  const save = useSaveIntention({ taskIntentions, onAdd, onUpdate, onLinkTask })

  // Opened by hand; the rest of when the form shows is derived, see above.
  const [adding, setAdding] = useState(false)
  // A draft is anything written in it, tasks included: a task chosen before
  // the title is typed is work, and folding it away behind the heading on the
  // way back from another question would hide it.
  const formOpen =
    adding ||
    intentions.length === 0 ||
    draft.editing !== null ||
    draft.title !== '' ||
    draft.taskIds.length > 0
  // Folding is offered only where it would fold something: with nothing named
  // yet the form is the whole question.
  const foldable = intentions.length > 0 || draft.editing !== null
  const field = useRef<HTMLInputElement>(null)

  /** Fold, keeping the draft as `submit` left it. */
  const close = () => {
    setAdding(false)
  }
  /** Fold, throwing the draft away: the caret, the ×, Escape. */
  const fold = () => {
    close()
    onDraft(emptyIntentionDraft)
  }
  /** Keep what is typed. Enter stays open for the next; `Done` folds. */
  const submit = (then: 'next' | 'done') => {
    if (!title) return
    // A gesture, which is the only time a browser lets audio start. Without it
    // the chime at the end of this question could never be heard on a day's
    // first visit, because nothing before it has been clicked.
    void unlockAudio()
    save(draft)
    onDraft(emptyIntentionDraft)
    if (then === 'done') return close()
    // Open for the next one, with the cursor back in it.
    setAdding(true)
    field.current?.focus()
  }

  const startEditing = (intention: Intention) =>
    onDraft({
      title: intention.title,
      taskIds: backlog.tasksUnder(intention.id),
      editing: intention.id,
    })

  return (
    <>
      <StagePrompt
        eyebrow={eyebrow}
        title="What are your intentions for the day?"
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
            timeLeftLabel="Time left for intentions"
            hint="Left to name what today is for"
          />
        }
      />

      {intentions.length > 0 && (
        <ul aria-label="Intended today" className="mb-4 flex flex-col gap-1.5">
          {intentions.map((intention) => (
            <IntentionRow
              key={intention.id}
              intention={intention}
              groups={backlog.group(backlog.tasksUnder(intention.id))}
              editing={intention.id === draft.editing}
              onToggleDone={() => onUpdate(intention.id, { done: intention.done !== true })}
              onEdit={() => startEditing(intention)}
              onRemove={() => {
                if (draft.editing === intention.id) onDraft(emptyIntentionDraft)
                onRemove(intention.id)
              }}
            />
          ))}
        </ul>
      )}

      <AddFold
        title={draft.editing ? 'Edit intention' : 'Add intention'}
        open={formOpen}
        onOpen={() => setAdding(true)}
        onCancel={fold}
        cancelLabel={draft.editing ? 'Cancel editing' : 'Cancel new intention'}
        canFold={foldable}
        className="text-sm text-body"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit('next')
          }}
        >
          <IntentionFields
            draft={draft}
            onDraft={onDraft}
            intentions={intentions}
            taskIntentions={taskIntentions}
            fieldRef={field}
            // Mounted by a click asking for exactly this field.
            autoFocus={adding}
            {...(foldable ? { onEscape: fold } : {})}
            large
          />

          {/* With nothing typed it only folds, which is nothing to do
            while the field is the whole question. */}
          <GhostButton
            type="button"
            disabled={!title && !foldable}
            onClick={() => (title ? submit('done') : fold())}
            className="mt-4"
          >
            Done
          </GhostButton>
        </form>
      </AddFold>
    </>
  )
}

/**
 * One intention named today, with its tasks under the places they live in,
 * and the ring that marks it done. A done one stays in its place, crossed out,
 * its tasks still listed: they are still the day's, and reopening it is one
 * press away.
 */
function IntentionRow({
  intention,
  groups,
  editing,
  onToggleDone,
  onEdit,
  onRemove,
}: {
  intention: Intention
  groups: readonly TaskTreeNode[]
  editing: boolean
  onToggleDone: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const done = intention.done === true
  return (
    <li
      className={`flex items-baseline gap-3 rounded-lg border px-3 py-2 ${
        editing ? 'border-bright/60' : 'border-muted/70'
      }`}
    >
      <IntentionDoneToggle intention={intention} onToggle={onToggleDone} />
      <div className={`min-w-0 flex-1 ${done ? 'opacity-70' : ''}`}>
        <div className={`truncate text-sm ${done ? 'text-muted line-through' : 'text-bright'}`}>
          {intention.title}
        </div>
        {groups.length > 0 && (
          <GroupedTasks
            label={`Tasks for ${intention.title}`}
            groups={groups}
            className="mt-1.5"
            renderTask={(task) => (
              <span className="block truncate text-xs text-body">{task.title}</span>
            )}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${intention.title}`}
        className="shrink-0 text-muted transition hover:text-bright"
      >
        <EditGlyph />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${intention.title}`}
        className="shrink-0 text-muted transition hover:text-commit"
      >
        ×
      </button>
    </li>
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
