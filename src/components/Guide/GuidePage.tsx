/**
 * The guide.
 *
 * A page rather than a dialog, because this is read rather than answered.
 * Dialogs in Mono are asides you dismiss; a document you scroll, come back to,
 * and might keep open in a second tab while you set your hours up is not an
 * aside. It gets its own route, a contents list, and a comfortable measure.
 *
 * The one thing a page costs is sight of the timer, so the header carries a
 * live strip whenever a block is running. Reading about focus should not quietly
 * cost you the block you are in.
 *
 * All durations come from live settings. A guide that disagrees with the app is
 * worse than no guide — which is also why Settings opens from this header. The
 * section below explains what each one does using its current value, so the
 * page you are reading is the natural place to change one, and reading it used
 * to mean going back to the day first.
 */

import { useMemo, type ReactNode } from 'react'

import { PixelCat } from '../Companion/PixelCat'
import { headerControlClass } from '../ui'
import { formatTimer } from '@/domain/time'
import { DAY_HASH } from '@/hooks/useRoute'
import { useSession } from '@/store/session'
import type { Phase } from '@/domain/machine'
import type { ActiveSegment, Ms, Settings } from '@/domain/types'

type Section = { id: string; title: string; body: ReactNode }

export function GuidePage({
  now,
  active,
  onOpenSettings,
}: {
  now: Ms
  active: ActiveSegment | null
  onOpenSettings: () => void
}) {
  const settings = useSession((s) => s.session.settings)
  const phase = useSession((s) => s.phase)

  const deep = settings.deepMinutes
  const short = settings.shortMinutes
  const reflect = settings.reflectMinutes
  const policy = settings.plannerPolicy

  // The page re-renders every second so the header strip can count down, and
  // this is several hundred elements of prose. Built once per settings change,
  // it is the same element tree on every tick, and React skips the subtree.
  const sections = useMemo(
    () => sectionsFor(deep, short, reflect, policy),
    [deep, short, reflect, policy],
  )

  const goTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  return (
    <div className="flex h-dvh flex-col bg-ink">
      <header className="shrink-0 border-b border-line px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {/* The live phase, not a fixed idle one. The header already keeps
                the timer in sight while you read; a cat sitting up politely
                beside a strip that says "Focusing 12:34" is the same creature
                telling you something different. */}
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

          <div className="flex items-center gap-3">
            {/* A page invites you to stay, so whatever the timer would be
                saying stays in sight — including when it is waiting on you. */}
            <HeaderStatus active={active} now={now} phase={phase} />
            <button type="button" onClick={onOpenSettings} className={headerControlClass}>
              Settings
            </button>
            <a href={DAY_HASH} className={headerControlClass}>
              Back to today
            </a>
          </div>
        </div>
      </header>

      <div className="mono-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-3xl font-light text-bright sm:text-4xl">How Mono works</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            A walk through the whole day — from declaring your hours to what happens when
            you sleep through a block.
          </p>

          <div className="mt-8 flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_13rem] lg:gap-12">
            <article className="max-w-2xl">
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="scroll-mt-6 border-t border-line pt-6 first:border-t-0 first:pt-0 [&:not(:first-child)]:mt-8"
                >
                  <h2 className="mb-3 text-xs font-medium tracking-widest text-muted uppercase">
                    {section.title}
                  </h2>
                  {section.body}
                </section>
              ))}

              <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-muted">
                Mono runs entirely in this browser. There is no account, no server and no
                sync — your history is yours, and Export in settings is how it travels.
              </p>
            </article>

            {/* Beside the text on a wide screen, above it on a narrow one — where
                it doubles as the shape of the document before you start reading. */}
            <nav className="order-first lg:order-none">
              <div className="lg:sticky lg:top-0">
                <div className="text-xs font-medium tracking-widest text-muted uppercase">
                  Contents
                </div>
                <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-1">
                  {sections.map((section, index) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => goTo(section.id)}
                        className="flex gap-2 text-left text-sm text-muted transition hover:text-bright"
                      >
                        <span className="tnum shrink-0 pt-0.5 text-xs text-muted/60">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{section.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * What the timer would be saying, in the header.
 *
 * A running block is the usual case, but Mono also *asks* things, and a
 * question the user cannot see is a question they will not answer — the guide
 * would quietly cost them the decision it was explaining. So a phase that is
 * waiting on an answer says so here, and outranks the countdown: when a block
 * has just ended, "Block done" is the truth and a timer counting past zero is
 * merely a number.
 */
const WAITING: Partial<Record<Phase['name'], string>> = {
  definingPurpose: 'Name the block',
  blockComplete: 'Block done',
  choosingBreak: 'How long a break?',
  reconciling: 'You were away',
}

function HeaderStatus({
  active,
  now,
  phase,
}: {
  active: ActiveSegment | null
  now: Ms
  phase: Phase
}) {
  const waiting = WAITING[phase.name]

  if (waiting !== undefined) {
    return (
      <Strip tone="text-bright" title="Back to the timer">
        <span className="tracking-widest uppercase">{waiting}</span>
        <span className="text-muted">answer on the timer</span>
      </Strip>
    )
  }

  if (!active) return null

  const remaining = active.endsAt - now
  const kind = active.kind === 'break' ? 'break' : active.blockKind

  return (
    <Strip tone={TONE[kind]} title="Back to the timer">
      <span className="tracking-widest uppercase">{RUNNING_LABEL[kind]}</span>
      <span className="tnum text-bright">
        {remaining < 0 ? `+${formatTimer(-remaining)}` : formatTimer(remaining)}
      </span>
    </Strip>
  )
}

const TONE = {
  deep: 'text-deep',
  short: 'text-short',
  reflect: 'text-reflect',
  break: 'text-rest',
} as const

const RUNNING_LABEL = {
  deep: 'Focusing',
  short: 'Focusing',
  reflect: 'Priorities',
  break: 'Break',
} as const

const Strip = ({
  tone,
  title,
  children,
}: {
  tone: string
  title: string
  children: ReactNode
}) => (
  <a
    href={DAY_HASH}
    title={title}
    className={`flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs transition hover:bg-surface-raised ${tone}`}
  >
    {children}
  </a>
)

/** The state machine, as the six things Mono can be asking. */
function Flow() {
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface/60 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
        <Chip tone="text-body">Ready</Chip>
        <Arrow />
        <Chip tone="text-bright">One thing</Chip>
        <Arrow />
        <Chip tone="text-deep">Focusing</Chip>
        <Arrow />
        <Chip tone="text-body">Block done</Chip>
        <Arrow />
        <Chip tone="text-rest">Break</Chip>
        <span className="text-muted">or back to</span>
        <Chip tone="text-bright">One thing</Chip>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-line pt-3 text-xs">
        <span className="text-muted">Stuck for a purpose?</span>
        <Arrow />
        <Chip tone="text-reflect">Priorities</Chip>
        <Arrow />
        <span className="text-muted">then back to</span>
        <Chip tone="text-bright">One thing</Chip>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-line pt-3 text-xs">
        <span className="text-muted">Away when a block ended?</span>
        <Arrow />
        <Chip tone="text-muted">You were away</Chip>
        <Arrow />
        <span className="text-muted">you say what happened</span>
      </div>
    </div>
  )
}

const Chip = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <span className={`rounded-md border border-line px-2 py-1 ${tone}`}>{children}</span>
)

const Arrow = () => (
  <span aria-hidden className="text-muted">
    →
  </span>
)

const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 text-sm leading-relaxed text-body first:mt-0">{children}</p>
)

const Em = ({ children }: { children: ReactNode }) => (
  <span className="text-bright">{children}</span>
)

// Set apart by the box, not by being dimmer — the two-minute version is the
// most important paragraph on the page for someone arriving cold.
const Note = ({ children }: { children: ReactNode }) => (
  <p className="mt-4 rounded-lg border border-line bg-surface/60 px-4 py-3 text-xs leading-relaxed text-body">
    {children}
  </p>
)

function Card({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className={`text-sm ${tone}`}>{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-body">{children}</p>
    </div>
  )
}

/** One state: what it asks, and what each answer actually does. */
function Step({
  name,
  asks,
  choices,
}: {
  name: string
  asks: string
  choices: [string, string][]
}) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="text-sm text-bright">{name}</div>
      <p className="mt-1 text-xs leading-relaxed text-body">{asks}</p>
      <dl className="mt-2.5 space-y-1.5">
        {choices.map(([label, effect]) => (
          <div key={label} className="text-xs leading-relaxed">
            <dt className="inline text-bright">{label}</dt>
            <dd className="inline text-body"> — {effect}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Setting({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-sm text-bright">{name}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-body">{children}</p>
    </div>
  )
}

/**
 * Every section of the guide, in order.
 *
 * The durations are threaded through rather than read from the store here: a
 * guide that quotes 45 minutes while settings say 30 is worse than no guide,
 * and passing them in makes that impossible to forget.
 */
function sectionsFor(
  deep: number,
  short: number,
  reflect: number,
  policy: Settings['plannerPolicy'],
): Section[] {
  return [
    {
      id: 'idea',
      title: 'The idea',
      body: (
        <>
          <P>
            Mono keeps one question in front of you: <Em>what is this block for?</Em>{' '}
            Everything else exists to make that question easy to answer and hard to
            skip. You say when you are willing to work and what is already fixed in your
            day; Mono fills what is left with focus blocks and asks for a purpose before
            each one.
          </P>
          <P>
            It plans nowhere except inside the hours you declare, it never starts a
            block without a purpose, and it never records time you did not spend.
          </P>
          <Note>
            <Em>The two-minute version.</Em> Declare your working hours. Name what is
            already fixed today. Mono fills the gaps with {deep}-minute deep blocks and{' '}
            {short}-minute short ones. Press start, name the one thing the block is for,
            work until the timer ends, then decide between a break and the next block.
            Everything after this is detail.
          </Note>
        </>
      ),
    },
    {
      id: 'shape',
      title: 'Give the day a shape',
      body: (
        <>
          <P>
            Every day opens with two questions on the timer.{' '}
            <Em>What's already fixed today?</Em> comes first, because what you cannot
            move decides how much of the day is left to spend. Then{' '}
            <Em>are these your hours today?</Em>, pre-filled with your usual shape — a
            glance on an ordinary morning.
          </P>
          <P>
            Neither one gates the other. The dots under the timer move between them in
            either order, nothing you have typed is lost by switching, and{' '}
            <Em>Start the day</Em> finishes from whichever you are looking at. With
            nothing fixed today, that is the whole of it: press it and Mono plans your
            hours end to end. Those same dots keep working afterwards as a map of where
            in the day you are — hover one to see what it is. They never skip ahead,
            though: naming a block is not something you can click past.
          </P>
          <P>
            <Em>Working hours</Em> are the only time Mono is allowed to plan in.
            Settings holds the recurring shape every day starts from — 09:00–18:00
            unless you change it. The opening question and <Em>Hours</Em> on the
            calendar both change today only; tomorrow starts from the default again,
            and confirming the shape unchanged leaves today following it.
          </P>
          <P>
            Hours are a list of stretches rather than a single end time, so an
            unstructured evening is simply a gap between two of them. Mono stops
            planning before the gap and picks up after it. With no hours at all there is
            no plan — an empty day rather than a guess.
          </P>
          <P>
            <Em>Commitments</Em> are the things already fixed: a meeting, a call, the
            school run. After the opening question, use <Em>+ Commitment</Em> on the
            calendar. Mono fills the runway up to one and resumes afterwards.
          </P>
          <P>
            A commitment can also cost time either side of itself, under{' '}
            <Em>+ Time either side</Em>. A four o'clock swim is an hour in the pool, half
            an hour getting changed and getting there, and twenty minutes getting back —
            so it really occupies half past three to twenty past five, and a block
            offered at twenty to four is a block you were never going to be at your desk
            for. Mono keeps that whole span clear and draws the travel beside the
            commitment rather than inside it, so the calendar still says how long you
            were actually swimming.
          </P>
          <P>
            <Em>Hours</Em>, <Em>+ Break</Em> and <Em>+ Commitment</Em> open in place,
            just under the calendar's heading, rather than in a window over the top of
            it. Every one of them asks a question about the day — when, and what does it
            displace — and the day is drawn directly below the answer.
          </P>
          <Note>
            Adding a commitment clears every break you had pinned for later. The shape
            of the day just changed, so those rest points were answers to a different
            question. Pin them again wherever they still make sense.
          </Note>
          <P>
            On the calendar, lit bands are your working hours and everything outside them
            is time Mono will not touch. Blocks are drawn at their real length, so
            forty-five minutes looks like forty-five minutes and a gap reads as a gap.
            The bright line is now, past entries are dimmed, and the <Em>×</Em> on a
            break or a commitment removes it.
          </P>
        </>
      ),
    },
    {
      id: 'plan',
      title: 'How the plan gets made',
      body: (
        <>
          <P>
            There are two sizes of block: <Em>deep</Em> at {deep} minutes and{' '}
            <Em>short</Em> at {short}. For each free stretch, Mono tries every
            combination of the two that fits and picks between them by the policy in
            settings.
          </P>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Card title="Prefer deep blocks" tone="text-deep">
              The default. Longest blocks first, even when that leaves dead time. A free
              hour becomes one {deep}-minute block and some spare, not three short ones.
            </Card>
            <Card title="Fill the most time" tone="text-short">
              Packs in the most focus minutes. It wins on raw minutes by choosing short
              blocks almost every time — which is the opposite of depth.
            </Card>
          </div>
          <P>
            Leftovers always round <Em>down</Em>. A fifty-minute gap holds one{' '}
            {deep}-minute block and some dead minutes; Mono will not stretch a block to
            fill a space.
          </P>
          <P>
            <Em>Breaks are never planned for you.</Em> The timeline always shows the most
            focus the day could hold, which is what makes taking a break a visible trade
            rather than a hidden one.
          </P>
          <Note>
            None of this is a stored schedule. The entire future is recomputed from your
            hours, commitments and history whenever anything changes — so there is never
            a plan to tidy up after a day goes sideways. It has already caught up.
          </Note>
        </>
      ),
    },
    {
      id: 'block',
      title: 'A block, start to finish',
      body: (
        <>
          <P>
            Mono moves through a small number of states, and each one asks exactly one
            thing. This is the whole of it:
          </P>

          <Flow />

          <div className="mt-4 space-y-3">
            <Step
              name="Ready"
              asks="Nothing is running. The next block in the plan is offered."
              choices={[
                [
                  'Start block',
                  'Goes to the purpose prompt. The timer has not started yet.',
                ],
              ]}
            />
            <Step
              name="One thing"
              asks="What is this block for? One purpose, not a list. Naming it is the point — you are deciding what the next stretch is worth."
              choices={[
                [
                  'Start',
                  'The block begins now and runs its full length. The clock starts here, not when the prompt opened, so time spent deciding is not charged to the block.',
                ],
                ['Not yet', 'Backs out. Nothing is recorded.'],
                [
                  "I can't pick one",
                  `Gives you ${reflect} minutes to work out what actually matters. It is recorded like any other block — not being able to name a purpose is itself worth knowing — and afterwards you land back on this question with a deep block suggested.`,
                ],
              ]}
            />
            <Step
              name="Focusing"
              asks="The timer counts down and your purpose sits under it. This is the one state Mono has nothing to say in."
              choices={[
                [
                  'End early',
                  'Ends the block now and records it as cut short. Honest, and permanent — there is no pause.',
                ],
              ]}
            />
            <Step
              name="Block done"
              asks="The timer reached zero. Mono chimes if sound is on, and asks the only question that matters here."
              choices={[
                [
                  'Keep going',
                  'Straight into the next block — which means straight back to naming it.',
                ],
                [
                  'Take a break',
                  'Opens the duration picker, with the cost shown before you commit.',
                ],
              ]}
            />
            <Step
              name="On a break"
              asks="A break runs on a timer like anything else and lands in your history as a break."
              choices={[['Back to work', 'Ends the break early and returns you to the plan.']]}
            />
            <Step
              name="You were away"
              asks="Mono came back to find a block that ended while it was not watching. It refuses to guess, so nothing is recorded until you answer."
              choices={[
                ['Finished it', 'Banks the block, credited at the time it was due to end.'],
                ["Didn't finish it", 'Records it as cut short.'],
              ]}
            />
          </div>

          <Note>
            There is deliberately no pause button. A paused timer means the end of the
            block is no longer a fixed instant, and that is where timers start drifting,
            double-counting, or resurrecting themselves. Ending early and starting again
            is the honest version of the same thing.
          </Note>
        </>
      ),
    },
    {
      id: 'breaks',
      title: 'Breaks, and what they cost',
      body: (
        <>
          <P>
            When you take a break, Mono prices it first: it re-derives the rest of the
            day with the break in place and tells you what disappeared. "Costs you 1
            block and 15 focus minutes" is a statement about your afternoon, not a
            warning label.
          </P>
          <P>
            Some breaks are free. A rest that lands in time which was never going to hold
            a block costs nothing, and Mono says so — that is usually the best moment to
            take one.
          </P>
          <P>
            You can also pin a break in advance with <Em>+ Break</Em> on the calendar,
            for rest you already know you will need. The plan works around it exactly
            like a commitment.
          </P>
        </>
      ),
    },
    {
      id: 'interrupted',
      title: 'When the day does not cooperate',
      body: (
        <>
          <P>
            <Em>You get pulled away mid-block.</Em> Use End early. It goes into history
            as cut short, and the plan re-derives from where you actually are.
          </P>
          <P>
            <Em>The machine sleeps, or you close the tab, and a block ends without you.</Em>{' '}
            On your return Mono asks what happened rather than banking the block. The
            stretch it cannot account for is recorded as unaccounted time, so the day
            still adds up honestly. Closing the tab costs exactly what sleeping the
            machine costs: a question, not a guess.
          </P>
          <P>
            <Em>It is outside your working hours.</Em> Mono says so and names when the
            next stretch opens, rather than offering a block in time you declared
            unstructured. To work anyway, change the hours — working outside them means
            saying so.
          </P>
          <P>
            <Em>Midnight.</Em> The plan resets and the day starts fresh from your default
            hours, but never mid-block: if something is running, the reset waits. History
            is kept forever.
          </P>
        </>
      ),
    },
    {
      id: 'settings',
      title: 'Settings, one by one',
      body: (
        <div className="mt-1 space-y-3">
          <Setting name="Deep block / Short block">
            The two block lengths, currently {deep} and {short} minutes. Everything the
            planner does follows from these two numbers.
          </Setting>
          <Setting name="Priorities timer">
            How long "I can't pick one" gives you. Currently {reflect} minutes.
          </Setting>
          <Setting name="Working hours">
            The recurring shape every day starts from. Editing a single day from the
            calendar does not touch this.
          </Setting>
          <Setting name="How to fill free time">
            The ranking policy described above. Currently{' '}
            {policy === 'prefer-deep' ? 'prefer deep blocks' : 'fill the most time'}
            .
          </Setting>
          <Setting name="Chime when a block ends">
            A short two-tone chime. Browsers only allow sound after you have interacted
            with the page, so it unlocks on your first Start.
          </Setting>
          <Setting name="Notify me when the tab is hidden">
            A notification when a block ends while you are looking elsewhere.
            Best-effort: browsers throttle hidden tabs, so one can arrive late or not at
            all. The guarantee is that Mono reconciles properly when you come back — not
            the notification.
          </Setting>
          <Setting name="Export / Import">
            Your whole history as a JSON file. Everything lives in this browser and
            nothing is sent anywhere, so this is also how you move to another machine.
          </Setting>
        </div>
      ),
    },
    {
      id: 'companion',
      title: 'The cat in the corner',
      body: (
        <>
          <P>
            The companion is a cat, and it reacts to what Mono is doing without ever
            interrupting you. During a block it walks its strip of ground from left to
            right as the time passes, so where it is standing is roughly how far into the
            block you are — it is the progress indicator as well as the character. It
            also keeps hold of the note you wrote when you named the block.
          </P>
          <P>
            When nothing is running it says what the day has banked so far. That is the
            one number the rest of the screen does not show you: the footer under the
            timer counts the focus still <Em>ahead</Em> of you, and the cat counts what is
            behind. Nothing it says is stored anywhere — it is read back off the same
            history the timeline is drawn from, so it resets at midnight with everything
            else.
          </P>
          <P>
            It is liveliest at the edges of a block and almost perfectly still in the
            middle of one, on purpose, and it stops moving altogether if your system asks
            for reduced motion. It also does not look quite the same at the end of a good
            day as it did at the start of one — that part you can find out for yourself.
          </P>
        </>
      ),
    },
  ]
}
