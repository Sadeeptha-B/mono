/**
 * The mini window's panels: the stage's questions, at a quarter of the size.
 *
 * These are their own components rather than the stage's with a `compact` prop.
 * Every panel in `components/stage/` opens `max-w-md` — 448 pixels, wider than
 * this entire window — and `BreakDurationPanel` alone is five chips, a reserved
 * cost paragraph and two buttons stacked down the page. Squeezing that would
 * mean a `compact` branch in each of six files and a `Stage` signature that
 * already carries forty props, half of which mean nothing out here.
 *
 * What *is* shared is what would quietly diverge into two applications: the
 * button and field styles, the time formatting, and — in `breakCost` — the
 * lengths a break may be and the sentence that prices one. Those last two were
 * copied first and had already drifted by the time anyone looked: two arrays of
 * durations waiting to be edited singly, and two wordings of the free-break
 * case.
 *
 * The short labels are the deliberate exception. `Start break`, `Not yet`,
 * `Keep going` are typed out in both files, because a word read at a glance is
 * worse for being looked up, and because the two are allowed to differ where
 * room forces it — the stage has space for `Keep going (deep)` and this does
 * not. A shared constant would have to pick one of those and be wrong somewhere.
 */

import { useState, type ReactNode } from 'react'

import {
  BREAK_DURATIONS,
  DEFAULT_BREAK_MINUTES,
  describeBreakCost,
  FREE_BREAK,
} from '@/components/breakCost'
import { BlockTasks } from '@/components/BlockTasks'
import { QuestionClock } from '@/components/QuestionClock'
import { useTodayBacklog } from '@/components/useTodayBacklog'
import { GhostButton, PrimaryButton } from '@/components/ui'
import { timerFace } from '@/components/timerFace'
import { formatClock, formatDuration, type TimerMode } from '@/domain/time'
import type {
  ActiveSegment,
  BlockKind,
  Commitment,
  Intention,
  Ms,
  WorkRegion,
} from '@/domain/types'
import type { SetupStageId } from '@/components/stage/stages'
import type { DayProgress } from '@/domain/dayProgress'

/**
 * The heading above a question, sized for a window this small, with the same
 * room level with the title that the stage's `StagePrompt` keeps for a timer on
 * the question.
 */
export function MiniPrompt({
  eyebrow,
  title,
  detail,
  aside,
}: {
  eyebrow: string
  title: string
  detail?: string
  aside?: ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-widest text-muted uppercase">
        {eyebrow}
      </div>
      <div className="mt-0.5 flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-xl leading-tight font-light text-bright">{title}</h2>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {detail && <p className="mt-1 text-xs leading-snug text-muted">{detail}</p>}
    </div>
  )
}

/** Buttons along the bottom of a panel, wrapping rather than overflowing. */
const Row = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
)

/**
 * The timer, which is the reason the window exists.
 *
 * Both faces read absolute timestamps, never an accumulated counter, so a
 * tick this window misses makes either briefly stale and never wrong.
 */
export function MiniTimer({
  now,
  active,
  timerMode,
  onToggleTimerMode,
}: {
  now: Ms
  active: ActiveSegment | null
  timerMode: TimerMode
  onToggleTimerMode: () => void
}) {
  if (!active) return <div className="tnum text-4xl font-light text-line">--:--</div>

  const face = timerFace(active, now, timerMode)
  const label = active.kind === 'break' ? 'Break' : (KIND_LABEL[active.blockKind] ?? 'Block')

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[10px] font-medium tracking-widest uppercase ${TONE[active.kind === 'break' ? 'break' : active.blockKind]}`}
        >
          {label}
        </span>
        {face.overrun && (
          <span className="text-[10px] text-commit">over by {face.overBy}</span>
        )}
      </div>

      {/* Keep the focused button's name stable. The hidden sibling exposes the
          changing reading on demand without announcing every tick. */}
      <button
        type="button"
        onClick={onToggleTimerMode}
        aria-label={face.buttonLabel}
        className={`tnum cursor-pointer rounded-sm text-left text-4xl leading-none font-light hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright ${face.overrun ? 'text-commit' : 'text-bright'}`}
      >
        {face.reading}
      </button>
      <span className="sr-only">{face.reading}</span>
      <div className="mt-0.5 text-[10px] text-muted">{face.modeLabel}</div>

      {active.kind === 'block' && active.purpose && (
        <p className="mt-2 line-clamp-2 text-sm leading-snug text-body">{active.purpose}</p>
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  deep: 'Deep block',
  short: 'Short block',
  reflect: 'Priorities',
}

const TONE = {
  deep: 'text-deep',
  short: 'text-short',
  reflect: 'text-reflect',
  break: 'text-rest',
} as const

export function MiniOutsideHours({
  now,
  nextStart,
  progress,
}: {
  now: Ms
  nextStart: Ms | null
  progress: DayProgress
}) {
  return (
    <MiniPrompt
      eyebrow="Outside working hours"
      title={nextStart === null ? 'Day done' : `Back in ${formatDuration(nextStart - now)}`}
      detail={
        nextStart === null
          ? progress.blocks === 0
            ? 'Nothing banked today. The plan picks up tomorrow.'
            : `${progress.blocks} block${progress.blocks === 1 ? '' : 's'} · ${formatDuration(progress.focusMinutes * 60_000)} focused`
          : `Nothing scheduled until ${formatClock(nextStart)}.`
      }
    />
  )
}

export function MiniReady({
  blockKind,
  minutes,
  onStart,
}: {
  blockKind: BlockKind
  minutes: number
  onStart: (kind: BlockKind) => void
}) {
  return (
    <div>
      <MiniPrompt eyebrow="Nothing running" title={`Ready for ${minutes} minutes`} />
      <Row>
        <PrimaryButton type="button" onClick={() => onStart(blockKind)}>
          Start {blockKind === 'deep' ? 'deep' : 'short'} block
        </PrimaryButton>
      </Row>
    </div>
  )
}

export function MiniNothingFits() {
  return (
    <MiniPrompt
      eyebrow="Nothing running"
      title="No more blocks fit"
      detail="There isn't enough time before your next commitment."
    />
  )
}

/**
 * "One thing", out here — as far as it can be answered out here.
 *
 * Naming a block now starts with picking its tasks, from today's and the
 * backlog's, or writing one down. That is a list to browse and a form to
 * fill, and it needs the room the tab has; squeezed into this window it would be
 * the one panel you had to scroll to answer. So this says where the question is
 * and keeps the one answer that needs no list: not starting after all.
 *
 * The title is the question put plainly, with the length of the block in it,
 * rather than the stage's own name for it: this window is glanced at, and "One
 * thing" only means something to someone who has read the strip under the
 * stage.
 *
 * The prompt's deciding timer is here as well as in the tab, the same instants
 * on the same clock. Working out what a block is for is the stretch most likely
 * to drift into something else, and an always-on-top window is the one place a
 * clock stays in view while you go and look at what the answer depends on.
 *
 * Nothing in it takes focus. The tab has the field the user is about to type
 * in, and a focused control here could raise this window over it.
 */
export function MiniPickInTab({
  now,
  blockKind,
  minutes,
  deciding,
  decidingMinutes,
  onStartDeciding,
  onOpenTab,
  onCancel,
}: {
  now: Ms
  blockKind: BlockKind
  minutes: number
  deciding: { endsAt: Ms } | null
  /** The setting, for the label on the play button. */
  decidingMinutes: number
  onStartDeciding: () => void
  onOpenTab: () => void
  onCancel: () => void
}) {
  return (
    <div>
      <MiniPrompt
        eyebrow={blockKind === 'deep' ? 'Deep block' : 'Short block'}
        title={`Decide what the next ${minutes} minutes are for`}
        detail="Pick this block's tasks in the tab, where today's tasks are."
        aside={
          <QuestionClock
            now={now}
            timer={deciding}
            minutes={decidingMinutes}
            onStart={onStartDeciding}
            timeLeftLabel="Time left to decide"
            hint="Left to work out what this block is for"
          />
        }
      />
      <Row>
        <PrimaryButton type="button" onClick={onOpenTab}>
          Open Mono
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Not yet
        </GhostButton>
      </Row>
    </div>
  )
}

/**
 * The opening questions, out here as the stage is asking them.
 *
 * None of them is answered here. Hours and commitments need the calendar drawn
 * beside them, and today's tasks are chosen from the backlog, and this window
 * has room for neither. What it can do is say where the answer stands — what
 * is fixed, which hours, how much is chosen so far — so a glance at it agrees
 * with the tab, and offer the way back to the tab to change it.
 *
 * Today's question also brings its timer, which is the part worth keeping in
 * view: deciding what a day is for is evaluative work, and the way it goes
 * wrong is quietly turning into something else.
 *
 * The titles are the stage's own, so the two windows ask the same question in
 * the same words; today's is said as the purpose prompt's is out here, as
 * something to decide.
 */
export function MiniSetup({
  stage,
  revisiting,
  now,
  commitments,
  regions,
  intentions,
  timer,
  timerMinutes,
  onStartTimer,
  onOpenTab,
}: {
  stage: SetupStageId
  revisiting: boolean
  now: Ms
  commitments: readonly Commitment[]
  /** Today's hours as the calendar draws them, an unsaved draft included. */
  regions: readonly WorkRegion[]
  intentions: readonly Intention[]
  /** Today's question's timer. */
  timer: { endsAt: Ms } | null
  /** The setting, for the label on the play button. */
  timerMinutes: number
  onStartTimer: () => void
  onOpenTab: () => void
}) {
  const eyebrow = revisiting ? 'Changing today' : 'To begin'
  const chosen = useTodayBacklog().chosen.length

  return (
    <div>
      {stage === 'commitments' ? (
        <MiniPrompt
          eyebrow={eyebrow}
          title="What are your commitments for today?"
          detail={
            commitments.length === 0
              ? "Nothing fixed yet. Add anything you can't move in the tab."
              : `Fixed: ${[...commitments]
                  .sort((a, b) => a.startsAt - b.startsAt)
                  .map((c) => `${c.title} at ${formatClock(c.startsAt)}`)
                  .join(', ')}.`
          }
        />
      ) : stage === 'hours' ? (
        <MiniPrompt
          eyebrow={eyebrow}
          title="Are these your hours today?"
          detail={
            regions.length === 0
              ? 'No working hours yet. Mono plans only inside them.'
              : `${[...regions]
                  .sort((a, b) => a.startsAt - b.startsAt)
                  .map((r) => `${formatClock(r.startsAt)}–${formatClock(r.endsAt)}`)
                  .join(', ')}. Change them in the tab, beside the calendar.`
          }
        />
      ) : (
        <MiniPrompt
          eyebrow={eyebrow}
          title="Choose today's tasks"
          detail={todayDetail(chosen, intentions)}
          aside={
            <QuestionClock
              now={now}
              timer={timer}
              minutes={timerMinutes}
              onStart={onStartTimer}
              timeLeftLabel="Time left to choose today's tasks"
              hint="Left to choose what today is for"
            />
          }
        />
      )}
      <Row>
        <PrimaryButton type="button" onClick={onOpenTab}>
          Open Mono
        </PrimaryButton>
      </Row>
    </div>
  )
}

export function MiniDone({
  taskIds,
  nextBlockKind,
  onTakeBreak,
  onSkipBreak,
}: {
  /** Ticked here as on the stage: this is the moment to say what got done. */
  taskIds: readonly string[]
  nextBlockKind: BlockKind | null
  onTakeBreak: () => void
  onSkipBreak: (kind: BlockKind) => void
}) {
  return (
    <div>
      <MiniPrompt
        eyebrow="Block done"
        title={nextBlockKind === null ? 'That was the last one' : 'Need a break?'}
      />
      <BlockTasks taskIds={taskIds} compact />
      <Row>
        {nextBlockKind !== null && (
          <PrimaryButton type="button" onClick={() => onSkipBreak(nextBlockKind)}>
            Keep going
          </PrimaryButton>
        )}
        <GhostButton type="button" onClick={onTakeBreak}>
          Take a break
        </GhostButton>
      </Row>
    </div>
  )
}

/**
 * How long a break should be, priced as you pick.
 *
 * The cost is the one thing this panel could not do without. On the stage it is
 * read against the timeline drawn beside it; here there is no timeline, so the
 * sentence has to carry the whole trade on its own — which it does, because the
 * planner answers it in blocks and minutes rather than in a picture.
 */
export function MiniBreakLength({
  costOf,
  onConfirm,
  onCancel,
}: {
  costOf: (minutes: number) => { blocksLost: number; focusMinutesLost: number }
  onConfirm: (minutes: number) => void
  onCancel: () => void
}) {
  const [minutes, setMinutes] = useState(DEFAULT_BREAK_MINUTES)
  const cost = describeBreakCost(costOf(minutes))

  return (
    <div>
      <MiniPrompt eyebrow="Break" title="How long?" />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {BREAK_DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setMinutes(d)}
            aria-pressed={minutes === d}
            className={[
              'tnum rounded-lg border px-2.5 py-1.5 text-xs transition',
              minutes === d
                ? 'border-rest bg-rest/15 text-rest'
                : 'border-muted/70 text-body hover:bg-surface-raised hover:text-bright',
            ].join(' ')}
          >
            {d}m
          </button>
        ))}
      </div>

      <p aria-live="polite" className="mt-2 min-h-8 text-xs leading-snug text-muted">
        {cost.free ? (
          FREE_BREAK
        ) : (
          <>
            Costs you <span className="text-body">{cost.lost}</span>
            {cost.also && <> and {cost.also}</>}.
          </>
        )}
      </p>

      <Row>
        <PrimaryButton type="button" onClick={() => onConfirm(minutes)}>
          Start break
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Cancel
        </GhostButton>
      </Row>
    </div>
  )
}

/**
 * "You were away", asked here as well as on the stage.
 *
 * The stage's carousel hides itself during this one, because being away is an
 * interruption rather than a place in the day. This window shows it anyway:
 * nothing is recorded until the question is answered, and a question the user
 * cannot see is a question they will not answer.
 */
export function MiniAway({
  blockEndedAt,
  now,
  kind,
  onResolve,
}: {
  blockEndedAt: Ms
  now: Ms
  kind: 'block' | 'break'
  onResolve: (result: 'completed' | 'abandoned') => void
}) {
  const awayFor = formatDuration(now - blockEndedAt)

  return (
    <div>
      <MiniPrompt
        eyebrow="You were away"
        title={kind === 'break' ? 'Welcome back' : 'Did you finish it?'}
        detail={`Due to end at ${formatClock(blockEndedAt)} — about ${awayFor} ago.`}
      />
      <Row>
        {kind === 'break' ? (
          <PrimaryButton type="button" onClick={() => onResolve('completed')}>
            Back to work
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton type="button" onClick={() => onResolve('completed')}>
              Finished it
            </PrimaryButton>
            <GhostButton type="button" onClick={() => onResolve('abandoned')}>
              Didn't finish it
            </GhostButton>
          </>
        )}
      </Row>
    </div>
  )
}

/** Where today's answer stands, as a line: how many tasks, and under which names. */
function todayDetail(chosen: number, intentions: readonly Intention[]): string {
  if (chosen === 0) return 'Choose the tasks you are working on today in the tab.'
  const tasks = `${chosen} task${chosen === 1 ? '' : 's'} chosen so far`
  return intentions.length === 0
    ? `${tasks}.`
    : `${tasks}, grouped as ${intentions.map((i) => i.title).join(', ')}.`
}
