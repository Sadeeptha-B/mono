/**
 * Today's tasks, gathered under the intentions some of them are given, and the
 * field that names a new intention.
 *
 * Shared by the opening question, the tasks page, and All Tasks' column while
 * the purpose prompt is open (`AllTasksPane`), which all say what today is,
 * so they read it from the session themselves rather than each being handed
 * it.
 *
 * The intentions come first, right under the field that names them, then the
 * tasks under none. Each intention is a place a task can be carried to —
 * dragged by its row, or picked up with its grip and put down with `Move here`
 * (`carry.tsx`) — and the list after them is the place for a task under none,
 * which is where every task starts. It carries no heading of its own: it is
 * simply today, and the intentions above are what is apart from it. An empty
 * intention is one line, its hint beside its name, so naming one before any
 * task is dragged adds a row rather than a block. An intention is named by
 * title alone and filled by carrying tasks in: written title first, with
 * nothing scoped yet, it came out as the name of an epic the backlog already
 * had, while carrying today's own tasks into a name asks it to describe
 * something already chosen.
 *
 * The carrying is `TodayCarry`'s, which the caller puts around this list and
 * anything else that can hand it a task. Beside All Tasks that is the backlog
 * too: a task dragged from there into an intention is chosen for today and
 * grouped in one move, and dropped on today's own list it is only chosen.
 *
 * A new intention is asked for with `+ Intention` level with the list's
 * heading, as `+ Task` sits in a place's menu in the backlog, and written right
 * under the button that asked for it: an empty intention, dashed, at the head
 * of the list, its name a bare field with a ✓ and a ×. Kept, it takes its
 * place after the others. A day needs no intention, so nothing about one
 * stands on the question until it is asked for. Enter keeps it and leaves an
 * empty one for the next, ✓ keeps it and closes, and × or Escape close without
 * keeping anything, handing focus back to `+ Intention`. An intention is drawn
 * as a level of the same tree as the places, with only a fine border to mark
 * it, rather than as one more kind of box.
 *
 * Every task sits under the places it lives in (`GroupedTasks`), each place
 * said once, so an intention gathering tasks from two areas shows both. Tasks
 * finished today stay, crossed out after the open ones of their place, because
 * the list is also the day's progress; they are not carried, since there is
 * nothing left to plan about them. A task taken out with its × leaves today
 * and its intention, and stays in the backlog.
 *
 * Deleting an intention leaves its tasks today, under none: removing a name is
 * not deciding against the work it named. Marking one done is the ring in
 * front of it (`IntentionDoneToggle`), by hand, and touches no task.
 *
 * Both drafts — the new intention's title and a rename — are held by the
 * caller, as the opening question holds its other drafts, so moving between
 * the questions loses nothing: that question draws this list only while it is
 * on screen. A rename held here went with the list, and came back as the old
 * name. `useIntentionRename` holds one, and closes it before paint if its
 * intention goes — the rule every editor in Mono keeps.
 */

import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  Carry,
  CarryGrip,
  CarryStatus,
  DropZone,
  MoveHere,
  useCarriedRow,
  useCarryState,
  type CarryHand,
  type CarryMode,
} from './carry'
import { GroupedTasks } from './GroupedTasks'
import { DeleteIcon, DoneRingIcon } from './icons'
import { useTodayBacklog } from './useTodayBacklog'
import { EditGlyph, IconButton, KeepField, RenameField } from './ui'
import type { Item } from '@/domain/tasks'
import { isToday, tasksOfIntention, ungroupedToday } from '@/domain/today'
import type { Intention } from '@/domain/types'
import { useSession } from '@/store/session'

/** The place a task under no intention is carried to. Never an intention's id. */
const NOT_GROUPED = ':not-grouped'

/** An intention being renamed, and the name typed so far. */
export type IntentionRename = { id: string; title: string }

/**
 * A rename of one of today's intentions, for whichever component outlives
 * `TodayList` on its surface. Let go for good, during render, once its
 * intention has gone; a new session's drafts go with the remount every host
 * already keys on the generation.
 */
export function useIntentionRename() {
  const intentions = useSession((s) => s.session.intentions)
  const [renaming, setRenaming] = useState<IntentionRename | null>(null)
  if (renaming && !intentions.some((i) => i.id === renaming.id)) setRenaming(null)
  return [renaming, setRenaming] as const
}

/**
 * Carrying tasks into today's intentions, for `TodayList` and whatever is
 * drawn beside it inside this provider.
 *
 * Any open task in play can be carried, chosen for today or not. Into an
 * intention, it is grouped there, and chosen if it was not (`linkTask` implies
 * choosing); onto `Not grouped`, a task of today's leaves its intention and one
 * from the backlog is simply chosen. A task already where it is dropped is not
 * taken. One finished or gone while held is put down (see `carry.tsx`), and so
 * is a pick-up whose task leaves today: it was picked up from today's row,
 * which has gone.
 *
 * A carry also ends with what it was begun in, which is not always this
 * provider's own mount. `App` holds it around both columns for as long as the
 * app is open, while the places a task goes are drawn only while a question
 * chooses tasks; held past that, the status bar kept asking for a `Move here`
 * nowhere on screen, into the block. So the caller names what the carry
 * belongs to as `scope` — `App` the question and the session — and a change
 * puts down whatever is in hand. A provider remounted with what it serves
 * needs none.
 */
export function TodayCarry({
  children,
  hand,
  scope,
}: {
  children: ReactNode
  hand?: CarryHand
  scope?: string
}) {
  const backlog = useTodayBacklog()
  const today = useSession((s) => s.session.today)
  const linkTask = useSession((s) => s.linkTask)
  const addToToday = useSession((s) => s.addToToday)

  const taskById = backlog.task
  const find = useCallback(
    (taskId: string, by: CarryMode) => {
      const task = taskById(taskId)
      // Only today's rows have a grip; a drag may come from All Tasks.
      const inPlace = by === 'drag' || isToday(today, taskId)
      return task?.status === 'open' && inPlace ? task : undefined
    },
    [taskById, today],
  )
  const takes = useCallback(
    (task: Item, target: string) =>
      !isToday(today, task.id) || (today[task.id] ?? NOT_GROUPED) !== target,
    [today],
  )
  const move = useCallback(
    (task: Item, target: string) => {
      if (target !== NOT_GROUPED) linkTask(task.id, target)
      else if (isToday(today, task.id)) linkTask(task.id, null)
      else addToToday(task.id)
    },
    [today, linkTask, addToToday],
  )
  const carry = useCarryState({ find, takes, move, hand })
  // Adjusted during render, so the stale bar is never painted.
  const [seenScope, setSeenScope] = useState(scope)
  if (seenScope !== scope) {
    setSeenScope(scope)
    carry.putDown()
  }

  return (
    <Carry.Provider value={carry}>
      {children}
      <CarryStatus />
    </Carry.Provider>
  )
}

export function TodayList({
  newIntention,
  onNewIntention,
  renaming,
  onRenaming,
  empty,
  heading,
}: {
  /** The new intention's title while its field is open, or null while folded. */
  newIntention: string | null
  onNewIntention: (title: string | null) => void
  /** The rename in progress, from `useIntentionRename`. */
  renaming: IntentionRename | null
  onRenaming: (rename: IntentionRename | null) => void
  /** What an empty day says, which depends on where the ways in are. */
  empty: string
  /**
   * The list's heading, with `+ Intention` level with it: text for the
   * stage's own small heading, or the caller's heading element where the page
   * already styles its sections.
   */
  heading: ReactNode
}) {
  const backlog = useTodayBacklog()
  const today = useSession((s) => s.session.today)
  const intentions = useSession((s) => s.session.intentions)
  const removeFromToday = useSession((s) => s.removeFromToday)
  const addIntention = useSession((s) => s.addIntention)
  const updateIntention = useSession((s) => s.updateIntention)
  const removeIntention = useSession((s) => s.removeIntention)
  const { held } = useContext(Carry)

  // Grouped per change to the day or the backlog, not per tick.
  const group = backlog.group
  const groups = useMemo(
    () => ({
      byIntention: new Map(intentions.map((i) => [i.id, group(tasksOfIntention(i.id, today))])),
      none: group(ungroupedToday(today)),
    }),
    [intentions, today, group],
  )

  const opener = useRef<HTMLButtonElement>(null)
  /** Close the new intention without keeping it, and hand focus back. */
  const closeNew = () => {
    onNewIntention(null)
    opener.current?.focus()
  }
  /** Keep the intention typed: Enter leaves an empty one for the next, ✓ closes. */
  const addNamed = (then: 'next' | 'done') => {
    const title = newIntention?.trim() ?? ''
    if (title !== '') addIntention({ title })
    if (then === 'next') onNewIntention('')
    else closeNew()
  }

  const renderTask = (task: Item) => (
    <TodayTaskRow task={task} onRemove={() => removeFromToday(task.id)} />
  )
  const nothingChosen = backlog.chosen.length === 0

  const addButton = (
    <button
      ref={opener}
      type="button"
      onClick={() => onNewIntention(newIntention ?? '')}
      aria-label="Add intention"
      className="shrink-0 text-[13px] text-muted transition hover:text-bright"
    >
      + Intention
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        {typeof heading === 'string' ? (
          <h3 className="text-[13px] font-medium tracking-wide text-muted uppercase">{heading}</h3>
        ) : (
          heading
        )}
        {addButton}
      </div>

      {newIntention !== null && (
        <NewIntention
          value={newIntention}
          onChange={onNewIntention}
          onEnter={() => addNamed('next')}
          onKeep={() => addNamed('done')}
          onCancel={closeNew}
        />
      )}

      {intentions.map((intention) => {
        const tasks = groups.byIntention.get(intention.id) ?? []
        const done = intention.done === true
        return (
          <DropZone key={intention.id} target={intention.id} className="min-w-0">
            {/* A level of the same tree as the places: its name as a heading,
                what it holds beneath, and only a fine border to say it is an
                intention rather than somewhere the tasks live. */}
            <section
              aria-label={`Intention: ${intention.title}`}
              className={`rounded-md border border-line px-2 py-1.5 ${done ? 'opacity-70' : ''}`}
            >
              {renaming?.id === intention.id ? (
                <RenameField
                  label={`Rename intention ${intention.title}`}
                  value={renaming.title}
                  onChange={(title) => onRenaming({ id: intention.id, title })}
                  onSave={() => {
                    updateIntention(intention.id, { title: renaming.title.trim() })
                    onRenaming(null)
                  }}
                  onCancel={() => onRenaming(null)}
                  textClass="text-[15px]"
                />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <IntentionDoneToggle
                    intention={intention}
                    onToggle={() => updateIntention(intention.id, { done: !done })}
                  />
                  <h3
                    className={`min-w-0 flex-1 text-[15px] wrap-break-word ${
                      done ? 'text-muted line-through' : 'text-bright'
                    }`}
                  >
                    {intention.title}
                    {/* Empty, the hint sits beside the name rather than on a
                        line of its own, so an empty intention is one line. */}
                    {tasks.length === 0 && (
                      <span className="ml-2 text-xs text-muted no-underline">drag tasks here</span>
                    )}
                  </h3>
                  <IconButton
                    onClick={() => onRenaming({ id: intention.id, title: intention.title })}
                    label={`Rename intention ${intention.title}`}
                    hint="Rename"
                    className="-my-1"
                  >
                    <EditGlyph />
                  </IconButton>
                  {/* At once: its tasks stay today's, under none. */}
                  <IconButton
                    danger
                    onClick={() => removeIntention(intention.id)}
                    label={`Delete intention ${intention.title}`}
                    hint="Delete"
                    className="-my-1 -mr-1.5"
                  >
                    <DeleteIcon />
                  </IconButton>
                </div>
              )}
              {/* Under the title rather than the ring, without a guide line of
                  its own: the border already says what the places inside are
                  under, and a line there was one more beside theirs. */}
              {(tasks.length > 0 || held?.by === 'pick') && (
                <div className="mt-1 pl-5">
                  <MoveHere target={intention.id} name={intention.title} />
                  {tasks.length > 0 && (
                    <GroupedTasks
                      label={`Tasks for ${intention.title}`}
                      groups={tasks}
                      renderTask={renderTask}
                      gutter="wide"
                      placeText="text-sm"
                    />
                  )}
                </div>
              )}
            </section>
          </DropZone>
        )
      })}

      {nothingChosen && <p className="text-sm text-muted">{empty}</p>}

      {/* Under no intention: today itself, so it carries no heading. Shown
          while it holds something, or while something could be dropped on it:
          a task of today's leaving its intention, or one from the backlog being
          chosen. */}
      {(groups.none.length > 0 ||
        (held !== null && (intentions.length > 0 || !isToday(today, held.task.id)))) && (
        <DropZone target={NOT_GROUPED} className="min-w-0">
          <section aria-label={intentions.length > 0 ? 'Not grouped' : 'Chosen today'}>
            <MoveHere target={NOT_GROUPED} name="no intention" />
            {groups.none.length > 0 ? (
              <GroupedTasks
                label={intentions.length > 0 ? 'Tasks not grouped' : 'Tasks chosen today'}
                groups={groups.none}
                renderTask={renderTask}
                gutter="wide"
                placeText="text-sm"
              />
            ) : (
              <p className="py-1 text-xs text-muted">Drop here to keep it under no intention.</p>
            )}
          </section>
        </DropZone>
      )}
    </div>
  )
}

/**
 * One of today's tasks: the grip that carries it between intentions, its
 * title, and the × that takes it out of today. Finished today, it is crossed
 * out and stays where it is, with nothing to carry.
 *
 * The grip hangs in the gutter `GroupedTasks` leaves between its guide line
 * and its rows, so the title starts where a place's name beside it starts. In
 * line with the title it pushed every task a grip's width further in than the
 * places around it, and a task read as nested one level deeper than it was.
 */
function TodayTaskRow({ task, onRemove }: { task: Item; onRemove: () => void }) {
  const open = task.status === 'open'
  const { picked, dragProps } = useCarriedRow(task, open)
  return (
    <div
      {...(open ? dragProps : {})}
      className={`relative flex items-start gap-1.5 rounded-md text-[15px] ${
        picked ? 'bg-surface/60 outline-1 outline-deep/70 outline-dashed' : ''
      }`}
    >
      {open && <CarryGrip task={task} className="absolute top-1 -left-4" />}
      <span
        className={`min-w-0 flex-1 wrap-break-word ${open ? 'text-body' : 'text-muted line-through'}`}
      >
        {task.title}
        {!open && <span className="sr-only">, done today</span>}
      </span>
      {/* Out of today, not out of the backlog. */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Take ${task.title} out of today`}
        title="Not today"
        className="shrink-0 px-1 text-muted transition hover:text-bright"
      >
        ×
      </button>
    </div>
  )
}

/**
 * A new intention written where it will stand: dashed, its ring faint, its
 * name a bare field with a ✓ and a × (`KeepField`).
 */
function NewIntention({
  value,
  onChange,
  onEnter,
  onKeep,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5">
      <DoneRingIcon done={false} className="text-muted/50" />
      <KeepField
        value={value}
        onChange={onChange}
        onEnter={onEnter}
        onKeep={onKeep}
        onCancel={onCancel}
        placeholder="Name an intention, then drag tasks into it"
        label="New intention"
        keepLabel="Keep the new intention"
        cancelLabel="Cancel new intention"
        // Opened by a press asking for exactly this field.
        autoFocus
        inputClassName="min-w-0 flex-1 bg-transparent text-[15px] text-bright placeholder:text-muted/80 focus:outline-none"
      />
    </div>
  )
}

/**
 * The ring in front of an intention that marks it done, and reopens it.
 *
 * Offered wherever intentions are kept — the opening question, the column
 * beside the purpose prompt and the tasks page — because whether the day has
 * had what it wanted from an intention is the user's to say, at whichever of
 * them they notice it. Nothing decides it for them: not its tasks running out,
 * which can happen with the intention unmet, and not a block. It is one patch
 * on the intention and touches none of its tasks, so reopening it puts back
 * exactly what was there. A done intention stays where it was in the list,
 * crossed out, rather than moving under the pointer that just ticked it.
 */
function IntentionDoneToggle({
  intention,
  onToggle,
}: {
  intention: Intention
  onToggle: () => void
}) {
  const done = intention.done === true
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? `Reopen intention ${intention.title}` : `Mark intention ${intention.title} done`}
      title={done ? 'Reopen' : 'Mark done'}
      className={`inline-flex shrink-0 translate-y-0.5 items-center justify-center transition hover:text-bright ${
        done ? 'text-deep' : 'text-muted'
      }`}
    >
      <DoneRingIcon done={done} />
    </button>
  )
}
