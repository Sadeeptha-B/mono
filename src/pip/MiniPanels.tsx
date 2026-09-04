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

import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  BREAK_DURATIONS,
  DEFAULT_BREAK_MINUTES,
  describeBreakCost,
  FREE_BREAK,
} from '@/components/breakCost'
import { fieldClass, GhostButton, PrimaryButton } from '@/components/ui'
import { formatClock, formatDuration, formatTimer } from '@/domain/time'
import type { ActiveSegment, BlockKind, Ms } from '@/domain/types'
import type { DayProgress } from '@/domain/dayProgress'

/** The heading above a question, sized for a window this small. */
export function MiniPrompt({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-widest text-muted uppercase">
        {eyebrow}
      </div>
      <h2 className="mt-0.5 text-xl leading-tight font-light text-bright">{title}</h2>
      {detail && <p className="mt-1 text-xs leading-snug text-muted">{detail}</p>}
    </div>
  )
}

/** Buttons along the bottom of a panel, wrapping rather than overflowing. */
const Row = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
)

/**
 * The countdown, which is the reason the window exists.
 *
 * `endsAt - now` like every other clock in Mono, never an accumulated counter,
 * so a tick this window misses makes it briefly stale and never wrong.
 */
export function MiniTimer({ now, active }: { now: Ms; active: ActiveSegment | null }) {
  if (!active) return <div className="tnum text-4xl font-light text-line">--:--</div>

  const remaining = active.endsAt - now
  const overrun = remaining < 0
  const label = active.kind === 'break' ? 'Break' : (KIND_LABEL[active.blockKind] ?? 'Block')

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-[10px] font-medium tracking-widest uppercase ${TONE[active.kind === 'break' ? 'break' : active.blockKind]}`}
        >
          {label}
        </span>
        {overrun && (
          <span className="text-[10px] text-commit">over by {formatTimer(-remaining)}</span>
        )}
      </div>

      {/* No live region, for the same reason the stage's timer has none: a
          polite one queues an announcement per second and would read out the
          whole block. */}
      <div
        className={`tnum text-4xl leading-none font-light ${overrun ? 'text-commit' : 'text-bright'}`}
      >
        {formatTimer(Math.abs(remaining))}
      </div>

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

/**
 * The day has never been shaped, and this window is not where that is done.
 *
 * Hours and commitments are only answerable with the day drawn beside them —
 * the reason Mono has no modals — and there is no calendar here. So it says so
 * and points back, rather than offering a form that could not show its own
 * consequences. Chromium puts a back-to-tab button on this window's own title
 * bar; the button here is the same journey, said in Mono's words.
 */
export function MiniUnshaped({ onOpenTab }: { onOpenTab: () => void }) {
  return (
    <div>
      <MiniPrompt
        eyebrow="Not started"
        title="Give the day a shape"
        detail="What's fixed today, and which hours are yours. Both need the calendar beside them."
      />
      <Row>
        <PrimaryButton type="button" onClick={onOpenTab}>
          Open Mono
        </PrimaryButton>
      </Row>
    </div>
  )
}

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
 * "One thing", out here.
 *
 * The field does not take focus on mount unless this window already has it.
 * Both windows mount their own copy of this question at the same instant, and
 * `focus()` on an element in an unfocused window can raise that window — so an
 * ungated call would fight the other copy for the desktop, and the loser is
 * whoever the user was actually typing in.
 */
export function MiniPurpose({
  blockKind,
  minutes,
  onSubmit,
  onCannotDecide,
  onCancel,
}: {
  blockKind: BlockKind
  minutes: number
  onSubmit: (purpose: string) => void
  onCannotDecide: () => void
  onCancel: () => void
}) {
  const [purpose, setPurpose] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (input.current?.ownerDocument.hasFocus()) input.current.focus()
  }, [])

  const trimmed = purpose.trim()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <MiniPrompt
        eyebrow={`${minutes} minute ${blockKind === 'deep' ? 'deep' : 'short'} block`}
        title="One thing"
      />
      <input
        ref={input}
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        placeholder="Finish the planner tests"
        // Named apart from the stage's field on purpose: the two are on screen
        // together whenever this window is open, and one accessible name for
        // two controls is ambiguous to anything reading the page.
        aria-label="Purpose for this block (mini window)"
        maxLength={120}
        className={`${fieldClass} mt-2 py-2 text-sm`}
      />
      <Row>
        <PrimaryButton type="submit" disabled={!trimmed}>
          Start
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Not yet
        </GhostButton>
        <button
          type="button"
          onClick={onCannotDecide}
          className="ml-auto text-xs text-muted underline-offset-4 transition hover:text-body hover:underline"
        >
          I can't pick one
        </button>
      </Row>
    </form>
  )
}

export function MiniDone({
  nextBlockKind,
  onTakeBreak,
  onSkipBreak,
}: {
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
                : 'border-line text-body hover:bg-surface-raised hover:text-bright',
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
  onResolve: (outcome: 'completed' | 'abandoned') => void
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
