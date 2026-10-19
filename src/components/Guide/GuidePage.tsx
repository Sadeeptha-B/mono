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
 * follow a day from setup through focus and rest. Each subject has one home;
 * practical instructions belong here, while design rationale stays in the
 * repository documentation. The later sections are there to return to when
 * someone wants to organise tasks, set a routine or adjust their surroundings.
 */

import { useMemo, type ReactNode } from 'react'

import { APP_WIDTH, AppBar } from '../AppHeader'
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
        <div className={`mx-auto ${APP_WIDTH} px-4 py-8 sm:px-6 sm:py-10`}>
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
            Open <Em>Today</Em> to see your timer and calendar. On a small screen,
            the calendar sits below the timer. A new day begins with three questions:
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
              asks="Choose when you want to work today. You can add separate stretches, such as a morning and an afternoon. Moving a start time moves the whole stretch. The calendar previews your changes."
              choices={[
                ['Hours', 'Changes here apply to today. Set your usual hours on Routine, linked from this question and Settings.'],
              ]}
            />
            <Step
              name="3. Choose your tasks"
              asks="All Tasks opens beside the question. Search your backlog and tick what you want to work on, or use + Task in a place's ⋯ menu to write something new."
              choices={[
                ['Start the day', 'Choose at least one task, then press this when you are ready.'],
              ]}
            />
          </div>
          <P>
            Use <Em>Back</Em>, <Em>Next</Em> or the dots under the questions to move
            between them. Between blocks, the dots let you revisit your answers;
            {' '}<Em>Focus</Em> brings you back to the next block.
          </P>
          <P>
            The tasks question gives you {intending} minutes to decide. At zero the
            timer stops and offers another round. You start the day yourself when
            you are ready.
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
            mark your working hours, and the bright line marks now. Each entry takes
            up its actual length; spare time between blocks stays open.
          </P>
          <P>
            Use <Em>Hours</Em>, <Em>Commitment</Em> and <Em>Break</Em> above the
            calendar to adjust your day. Commitments and breaks have edit and
            remove controls, and you can drag either to a new time, even after
            it has ended. Focus blocks adjust automatically as the day changes.
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
            Press <Em>Start block</Em> to choose at least one task from{' '}
            <Em>All Tasks</Em>. You can also choose a whole intention from today's
            list below it. A task chosen from outside today's list joins it.
          </P>
          <P>
            Give the block a purpose: one sentence about what you want to do in this
            stretch, such as <Em>Draft the opening of the proposal</Em>. Mono suggests
            a name from your tasks; keep it or rewrite it. Press <Em>Start</Em> to
            begin the full block. If you need time to decide, the play button beside
            the question gives you {reflect} minutes.
          </P>
          <P>
            While you work, your purpose and tasks stay under the timer. Click the
            timer to switch between time remaining and time spent. Tick tasks done
            as you finish them. Completing a task and completing a block are separate:
            a block can be useful even when the task needs more time.
          </P>
          <div className="mt-4 space-y-3">
            <Setting name="Log">
              Write a line about how the block is going. Enter saves it. Logs appear
              as marks on the calendar; point at one to read, edit or delete it.
              Deleted logs remain in the saved journal and exports.
            </Setting>
            <Setting name="Later">
              Capture an idea, question or tangent to come back to. Enter saves it
              to Later on the Timeline page.
            </Setting>
            <Setting name="Urges">
              Press + when you notice an urge to leave the task, whether you follow
              it or stay. The count is a way to notice distractions. Use − to undo a tap.
            </Setting>
          </div>
          <P>
            If your work changes, switch the calendar to <Em>All Tasks</Em> to add or
            remove tasks from the running block. It keeps at least one task, and
            your original purpose stays in place.
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
            Choose when you need a break. Pick its length, and Mono shows how it
            changes the blocks and focus minutes left today before you confirm.
            A break that fits into spare time may leave the plan unchanged.
          </P>
          <P>
            To reserve rest for later, use <Em>Break</Em> above the calendar. You can
            edit or move a planned break, but not onto a commitment. A commitment
            placed over a planned break moves the break to just after it. Once its
            time has passed, a planned break asks whether you took it.
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
            Drag tasks and headings to move or reorder them. With a keyboard, pick
            up a task using its dots, then choose <Em>Move here</Em> at its
            destination; <Em>Escape</Em> cancels. Hover an action icon to see its name,
            or open a row's <Em>⋯</Em> menu in All Tasks. Double-click a title to
            rename it. On the board, click away to keep what you typed;{' '}
            <Em>Escape</Em> cancels.
          </P>
          <P>
            The sun icon chooses a task for today or takes it out again. On an epic
            or outcome, it chooses all open tasks inside. Today's list opens from
            the sun button in the corner. Use <Em>+ Intention</Em> to give a group
            of today's tasks a shared aim, such as <Em>Get the proposal ready</Em>,
            then drag tasks into it. Mark the intention done when you feel that aim
            is met.
          </P>
          <P>
            Your backlog carries on across days. Tomorrow, <Em>From last time</Em>
            offers unfinished tasks for you to choose again. Use <Em>Drop</Em> for
            work you have decided to let go. Finish or archive an epic or outcome to
            put it away with its contents. Everything put away is under{' '}
            <Em>Put away</Em> beside the page's title, where it can be reopened; a
            task ticked today stays crossed out where it was. Outcomes start folded;
            open or fold one, or an epic, with the arrow on its card. Deleting an
            area, epic or outcome deletes everything inside it.
          </P>
          <P>
            Thoughts captured in <Em>Later</Em>, from the arrow icon in any page's
            header, wait on the <Em>Timeline</Em> page. Use <Em>File into…</Em> on
            one to turn it into a task in an area, epic or outcome, <Em>Let go</Em>{' '}
            to put it aside, or <Em>Delete</Em> to remove it.
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
            Open <Em>Routine</Em> from Settings or the day's hours and commitments
            questions. Set your usual working hours and add commitments that repeat,
            such as a weekday standup or a weekly class. Your usual hours are
            currently {usualHours}.
          </P>
          <P>
            For each commitment, choose how often it repeats and check the upcoming
            dates shown in the form. It appears on each matching day's calendar.
            Editing or removing it on Today changes just that occurrence. Edit the
            series on Routine to change future occurrences; ones already underway
            or changed individually keep their details.
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
            your other apps. It is available in supported Chromium browsers, such as
            Chrome and Edge; the button appears when your browser supports it.
          </P>
          <P>
            Keep working with the timer and purpose in view. You can tick tasks done,
            write a log, capture something for Later and count urges there too.
            Point at the purpose to see your tasks, or at a mark on the block's strip
            to read a log. Between blocks, you can continue or take a break.
          </P>
          <P>
            Use <Em>Open Mono</Em> when you need the calendar or want to choose tasks.
            Resize the window to suit you; <Em>Reset size</Em> restores its compact
            size. Closing it leaves the session running in the tab.
          </P>
          <P>
            Settings lets you choose whether it opens when a block starts or when
            you start a timer to decide on tasks or a purpose.
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
            as cut short and adjusts the rest of the day. Blocks run continuously;
            to return later, start a new one. Tasks you finished stay done.
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
            A new day starts with your routine and a fresh choice of tasks. If a
            block or break runs past midnight, the reset waits until it ends.
            Your history is kept.
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
            Choose brown noise, pink noise, rain or the room's suggested sound.
            You hear a short preview when you choose it; during focus, it fades in
            and then fades away for breaks and questions. The timer's speaker
            temporarily mutes ambience. The completion chime has its own setting.
          </P>
          <P>
            In <Em>Settings</Em>, adjust block lengths and the two decision timers,
            choose how to fill free time, and turn the completion chime or background
            notifications on or off. Notifications can arrive late when the tab is
            hidden, so check Mono when you return.
          </P>
          <P>
            The cat walks across its room as your block progresses. The room grows
            with the focus you complete today, and at the end of working hours you
            get a small postcard of your day. Tomorrow begins with a fresh room.
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
            Mono saves your tasks, Later notes, settings and history in this browser.
            You can use it without an account. Your data stays on this device;
            moving to another browser or device takes an export and import.
          </P>
          <P>
            Use <Em>Export</Em> in Settings to download a backup. <Em>Import</Em>
            restores a Mono backup, replacing your current day, settings and tasks
            with the file's contents. Export first if you want to keep your current data.
          </P>
          <Note>
            If the header says <Em>Not saving</Em>, export before closing or reloading
            the tab. The browser has stopped saving changes, and the export keeps
            a copy of what is on screen.
          </Note>
        </>
      ),
    },
  ]
}
