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
 * worse than no guide — which is also why Settings opens from this header.
 * Someone reading about block lengths or sound can adjust them here and see
 * the explanation update without leaving the page.
 *
 * A short introduction gives a new reader the basic loop, then the sections
 * follow a day from setup through focus and rest. Each subject has one home.
 * It is a walkthrough rather than a reference: what each part is for and how
 * to use it, leaving out what the interface teaches by being used and every
 * limit and edge case, while design rationale stays in the repository
 * documentation. The later sections are there to return to when someone
 * wants to organise tasks, set a routine or adjust their surroundings.
 */

import { useMemo, type ReactNode } from 'react'

import { APP_WIDTH, AppBar } from '../AppHeader'
import { CornerCard } from '../CornerCard'
import { HeaderStatus } from '../HeaderStatus'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import type { TimerMode } from '@/domain/time'
import { useSession } from '@/store/session'
import type { ActiveSegment, Ms, Settings } from '@/domain/types'
import { ambienceLabel, ROOMS } from '@/ambient/rooms'

type Section = { id: string; title: string; body: ReactNode }

export function GuidePage({
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
  /** The mini window, offered from here too — the header carries the timer. */
  mini: MiniWindowControls
}) {
  const settings = useSession((s) => s.session.settings)
  const phase = useSession((s) => s.phase)

  // The page re-renders every second so the header strip can show the time, and
  // this is several hundred elements of prose. Built once per settings change,
  // it is the same element tree on every tick, and React skips the subtree.
  const sections = useMemo(() => sectionsFor(settings), [settings])

  const goTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The bar every view shares (`AppBar`): pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <AppBar
        current="guide"
        phase={phase}
        mini={mini}
        onOpenSettings={onOpenSettings}
        status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
      />

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* Room at the foot for the corner's button (`CornerCard`). */}
        <div className={`mx-auto ${APP_WIDTH} px-4 pt-8 pb-32 sm:px-6 sm:pt-10`}>
          <h1 className="text-3xl font-light text-bright sm:text-4xl">How Mono works</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Make room for what matters, give each block a purpose, and take the day
            one stretch at a time.
          </p>

          {/* The basic loop comes before the contents so someone arriving for
              the first time can start using Mono after this paragraph. */}
          <div className="max-w-2xl">
            <Note>
              <Em>Start here.</Em> Add today's commitments, check your working hours,
              and choose a task. Mono fits focus blocks into the time available.
              Start a block, choose what to work on, and give it a purpose. Work until
              the timer ends, then take a break or choose your next block.
            </Note>
          </div>

          <div className="mt-8 flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_13rem] lg:gap-12">
            <article className="max-w-2xl">
              {/* A section jumped to rests a little under the top of what
                  scrolls; clearing the sticky bar on a narrow screen is the
                  bar's business (`AppBar`), since its height varies. */}
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
      <CornerCard />
    </div>
  )
}

/** A glance at the focus loop before the instructions for each step. */
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

// Set apart by the box, not by being dimmer — the introduction is the
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

/** One setup step, with the control a reader needs to answer it. */
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
 * The factory receives one settings snapshot rather than reaching into the
 * store. Every live quote is therefore rebuilt from the same object whenever
 * a setting changes, while the several-hundred-element tree remains stable on
 * the Guide's one-second timer renders.
 */
function sectionsFor(settings: Settings): Section[] {
  const {
    deepMinutes: deep,
    shortMinutes: short,
    reflectMinutes: reflect,
    intentionMinutes: intending,
    plannerPolicy: policy,
  } = settings
  const usualHours =
    settings.defaultRegions.length === 0
      ? 'no working hours set'
      : settings.defaultRegions.map((r) => `${r.start}–${r.end}`).join(' and ')
  const room = ROOMS[settings.roomId]
  const sound =
    settings.ambience === 'off'
      ? 'off'
      : ambienceLabel(settings.ambience === 'room' ? room.suggestedAmbience : settings.ambience)

  return [
    {
      id: 'shape',
      title: 'Set up today',
      body: (
        <>
          <P>
            Open <Em>Today</Em> to see your timer and calendar. A new day begins with
            three questions:
          </P>
          <div className="mt-4 space-y-3">
            <Step
              name="1. Add your commitments"
              asks="Put in anything with a fixed time: a meeting, an appointment, the school run."
              choices={[
                ['Time either side', 'Include time to prepare, travel or get back. Mono keeps that time clear too.'],
              ]}
            />
            <Step
              name="2. Check your hours"
              asks="Choose when you want to work today, in one stretch or several, such as a morning and an afternoon."
              choices={[
                ['Hours', 'Changes here apply to today. Set your usual hours on Routine.'],
              ]}
            />
            <Step
              name="3. Choose your tasks"
              asks="Tick what you want to work on in All Tasks, beside the question, or write something new with + Task."
              choices={[
                ['Start the day', 'Choose at least one task, then press this when you are ready.'],
              ]}
            />
          </div>
          <P>
            If you need time to decide, the tasks question has a {intending}-minute
            timer. Between blocks, the dots under the questions bring them back;
            {' '}<Em>Focus</Em> returns you to the next block.
          </P>
        </>
      ),
    },
    {
      id: 'calendar',
      title: 'Find your next block',
      body: (
        <>
          <P>
            Mono fits focus blocks inside your working hours, around commitments and
            breaks. The two block lengths, currently {deep} and {short} minutes, are
            called <Em>deep</Em> and <Em>short</Em>. You can change them in Settings.
          </P>
          <P>
            The calendar shows today's plan and what you have already done. Lit bands
            mark your working hours, and the bright line marks now.
          </P>
          <P>
            Use <Em>Hours</Em>, <Em>Commitment</Em> and <Em>Break</Em> above the
            calendar to change your day. Commitments and breaks can be edited, moved
            or removed, even after they have happened, and the blocks fit around them.
          </P>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Card title="Prefer deep blocks" tone="text-deep">
              Gives longer blocks priority, even if some time is left over.
            </Card>
            <Card title="Fill the most time" tone="text-short">
              Fits in the most focus minutes, often using more short blocks.
            </Card>
          </div>
          <P>
            Your current choice in Settings is{' '}
            <Em>{policy === 'prefer-deep' ? 'Prefer deep blocks' : 'Fill the most time'}</Em>.
          </P>
        </>
      ),
    },
    {
      id: 'block',
      title: 'A block, start to finish',
      body: (
        <>
          <Flow />
          <P>
            Press <Em>Start block</Em> and choose at least one task, from{' '}
            <Em>All Tasks</Em> or as a whole intention from today's list.
          </P>
          <P>
            Then give the block a purpose: one sentence about what you want to do in
            this stretch, such as <Em>Draft the opening of the proposal</Em>. Mono
            suggests one from your tasks. Press <Em>Start</Em> to begin. If you need
            time to decide, the play button beside the question gives you {reflect}{' '}
            minutes.
          </P>
          <P>
            While you work, your purpose and tasks stay under the timer. Click the
            timer to switch between time remaining and time spent. Tick tasks done
            as you finish them; a block can end with its tasks still open.
          </P>
          <div className="mt-4 space-y-3">
            <Setting name="Log">
              Write a line about how the block is going. Logs appear as marks on the
              calendar; point at one to read, edit or delete it. Deleted logs stay in
              exports.
            </Setting>
            <Setting name="Later">
              Put down an idea or tangent to come back to. It waits on the Timeline
              page.
            </Setting>
            <Setting name="Urges">
              Press + each time you feel the pull to leave the task, whether or not
              you follow it. − undoes a tap.
            </Setting>
          </div>
          <P>
            If your work changes, switch the calendar to <Em>All Tasks</Em> to add or
            remove the block's tasks.
          </P>
          <P>
            At <Em>Block done</Em>, tick anything you finished, then choose{' '}
            <Em>Keep going</Em> to name the next block or <Em>Take a break</Em> to rest.
          </P>
        </>
      ),
    },
    {
      id: 'breaks',
      title: 'Take a break',
      body: (
        <>
          <P>
            Take a break whenever you need one. Pick its length, and Mono shows what
            it costs the rest of the day before you confirm.
          </P>
          <P>
            To plan rest for later, use <Em>Break</Em> above the calendar. A
            commitment placed over a planned break moves the break to just after it.
            Once its time has passed, a planned break asks whether you took it.
          </P>
          <P>
            During a break, <Em>Back to work</Em> ends it early and returns you to
            the plan.
          </P>
        </>
      ),
    },
    {
      id: 'tasks',
      title: 'Organise your tasks',
      body: (
        <>
          <P>
            <Em>Tasks</Em> in the header opens your backlog. Start with areas such
            as Work and Personal. A task can live directly in an area's inbox.
            For larger projects, add an <Em>epic</Em>, such as a house move, and{' '}
            <Em>outcomes</Em> within it, such as finding a home or packing. Tasks
            can live at any of these levels.
          </P>
          <P>
            Drag tasks and headings to reorder or move them, and double-click a
            title to rename it.
          </P>
          <P>
            The sun icon adds a task to today, or every open task in an epic or
            outcome. The sun in the corner of every page opens today's list, where{' '}
            <Em>+ Intention</Em> gives a group of today's tasks a shared aim, such as{' '}
            <Em>Get the proposal ready</Em>. Beside it, <Em>Draft</Em> is a notepad
            for working out tasks before you add them.
          </P>
          <P>
            Your backlog carries on across days, and each morning{' '}
            <Em>From last time</Em> offers what was left unfinished. <Em>Drop</Em>{' '}
            lets a task go; finishing or archiving an epic or outcome puts it away
            with everything inside. All of it waits under <Em>Put away</Em>, beside
            the page's title, to be reopened. Deleting an area, epic or outcome
            deletes everything inside it.
          </P>
          <P>
            Notes put in <Em>Later</Em>, from the arrow in the header, wait on the{' '}
            <Em>Timeline</Em> page. <Em>File into…</Em> turns one into a task.
          </P>
        </>
      ),
    },
    {
      id: 'recurring',
      title: 'Set your routine',
      body: (
        <>
          <P>
            Open <Em>Routine</Em> from the circling arrows in the header. Set your
            usual working hours and add commitments that repeat,
            such as a weekday standup or a weekly class. Your usual hours are
            currently {usualHours}.
          </P>
          <P>
            Each one appears on the days it falls on. Changing it on Today changes
            that day only; changing it on Routine changes every day still following
            it.
          </P>
        </>
      ),
    },
    {
      id: 'popout',
      title: 'Keep the timer nearby',
      body: (
        <>
          <P>
            <Em>Pop out</Em> in the header opens a small timer window that stays above
            your other apps, in Chromium browsers such as Chrome and Edge.
          </P>
          <P>
            You can tick tasks done, write a log, put something in Later and count
            urges there, and between blocks, carry on or take a break. Use{' '}
            <Em>Open Mono</Em> for the calendar or to choose tasks. Settings chooses
            when it opens by itself.
          </P>
        </>
      ),
    },
    {
      id: 'interrupted',
      title: 'When plans change',
      body: (
        <>
          <P>
            <Em>Need to stop a block?</Em> Choose <Em>End early</Em>. Mono records it
            as cut short and replans the rest of the day. Blocks can't be paused;
            start a new one when you are back.
          </P>
          <P>
            <Em>Coming back after being away?</Em> If a block ended while the tab
            was closed or your device was asleep, Mono asks whether you finished it.
            Choose <Em>Finished it</Em> or <Em>Didn't finish it</Em> to continue.
          </P>
          <P>
            <Em>Working outside your hours?</Em> Update <Em>Hours</Em> on the
            calendar to make room for a block.
          </P>
          <P>
            Each new day starts from your routine and a fresh choice of tasks.
          </P>
        </>
      ),
    },
    {
      id: 'settings',
      title: 'Make yourself comfortable',
      body: (
        <>
          <P>
            Open <Em>Room</Em> from the colour swatch in the header to choose your
            surroundings and sound. Your current room is <Em>{room.label}</Em>.
            Ambient sound is{' '}
            <Em>{sound}{settings.ambience === 'off' ? '' : ` at ${Math.round(settings.ambienceVolume * 100)}%`}</Em>.
          </P>
          <P>
            Choose brown noise, pink noise, rain or the room's own sound. It plays
            during focus and fades away for breaks; the timer's speaker mutes it.
          </P>
          <P>
            In <Em>Settings</Em>, adjust block lengths and the two decision timers,
            choose how to fill free time, and turn the completion chime or background
            notifications on or off. Notifications can arrive late while the tab is
            hidden.
          </P>
          <P>
            The cat walks across its room as your block progresses. The room grows
            with the focus you complete today, and at the end of working hours you
            get a small postcard of your day.
          </P>
        </>
      ),
    },
    {
      id: 'data',
      title: 'Keep a copy of your day',
      body: (
        <>
          <P>
            Mono keeps everything in this browser, with no account. To move to
            another browser or device, export here and import there.
          </P>
          <P>
            <Em>Export</Em> in Settings downloads a backup. <Em>Import</Em> replaces
            everything here with a backup's contents, so export first if you want to
            keep what you have.
          </P>
          <Note>
            If the header says <Em>Not saving</Em>, the browser has stopped saving
            changes. Export before closing or reloading the tab.
          </Note>
        </>
      ),
    },
  ]
}
