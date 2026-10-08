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
 *
 * The two-minute version is not a section. It sits above the contents, because
 * a reader who stops after it has still been told how to use Mono, and because
 * the sections are a reference — ten of them, one subject each. That is the
 * shape the page settled into after one of them grew to a third of the whole:
 * everything about the day's opening questions *and* everything about reading
 * the calendar, under a heading that promised the first.
 */

import { useMemo, type ReactNode } from 'react'

import { AppHeader } from '../AppHeader'
import { HeaderStatus } from '../HeaderStatus'
import { EditGlyph } from '../ui'
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

  const deep = settings.deepMinutes
  const short = settings.shortMinutes

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
      {/* The same split as the day view: pinned and scrolling inside itself on
          a wide screen, an ordinary page on a narrow one. The header stays in
          sight either way — pinned it never moves, and stacked it sticks —
          because it carries the timer, and reading about focus should not
          quietly cost you the block you are in. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ink px-4 py-3 sm:px-6 lg:static">
        <div className="mx-auto max-w-5xl">
          {/* A page invites you to stay, so whatever the timer would be
              saying stays in sight — including when it is waiting on you. */}
          <AppHeader
            current="guide"
            phase={phase}
            mini={mini}
            onOpenSettings={onOpenSettings}
            status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
          />
        </div>
      </header>

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-3xl font-light text-bright sm:text-4xl">How Mono works</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            A walk through the whole day — from declaring your hours to what happens when
            you sleep through a block.
          </p>

          {/* The two-minute version sits above the contents rather than inside
              the first section. It is the most useful paragraph on the page for
              someone arriving cold, and a reader who stops after it has still
              been told how to use Mono. */}
          <div className="max-w-2xl">
            <Note>
              <Em>The two-minute version.</Em> Declare your working hours. Name what is
              already fixed today, and what today is for. Mono fills the gaps with{' '}
              {deep}-minute deep blocks and {short}-minute short ones. Press start, pick the
              tasks the block is for and name the one thing it is for, work until the timer
              ends, then decide between a break and the next block. Everything after this
              is detail.
            </Note>
          </div>

          <div className="mt-8 flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_13rem] lg:gap-12">
            <article className="max-w-2xl">
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="scroll-mt-20 border-t border-line pt-6 first:border-t-0 first:pt-0 lg:scroll-mt-6 [&:not(:first-child)]:mt-8"
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
  // Quoted rather than written down, like the block lengths: the guide says
  // what the routine page says today.
  const usualHours =
    settings.defaultRegions.length === 0
      ? 'no hours at all'
      : settings.defaultRegions.map((r) => `${r.start}–${r.end}`).join(' and ')
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
        </>
      ),
    },
    {
      id: 'panels',
      title: 'Two panels, one day',
      body: (
        <>
          <P>
            Mono is two panels showing the same day. The <Em>timer</Em> is where every
            question happens — what is fixed today, what this block is for, whether you
            want a break — one at a time, in the space the countdown occupies. The{' '}
            <Em>calendar</Em> beside it draws the whole day against real hours, so you
            can see what an answer costs before you give it. Nothing opens a window over
            the top of either, because a decision about the day is unanswerable with the
            day covered up. Settings is the one exception, and the only thing here you
            are not answering in the middle of something.
          </P>
          <P>
            Across the top, <Em>Today</Em> and <Em>Tasks</Em> are the two places a day
            moves between. The icons on the right are tools: the room's own colour opens
            the room and its sound, then the pop-out, this guide, and Settings — point at
            any of them for its name.
          </P>
          <P>
            The row of dots under the timer is where in the day you are — hover one to
            see what it is. On a narrow screen the calendar sits under the timer rather
            than beside it, and the page scrolls as one.
          </P>
        </>
      ),
    },
    {
      id: 'popout',
      title: 'The pop-out timer',
      body: (
        <>
          <P>
            <Em>Pop out</Em> in the header opens the timer as a small window that stays on
            top of everything else — your editor, your browser, whatever the block is
            actually for. It is the answer to the one thing the two panels cannot do: be
            useful once you have switched away from them.
          </P>
          <P>
            It is not a second copy of Mono. It shows what is running and when it ends,
            and it asks whatever Mono is currently asking — keep going or take a break,
            which of the block's tasks got done, how long, did you finish the one you
            slept through. When nothing
            is running it offers the next block, so the window is worth leaving open
            between blocks rather than only during them. Answer in either place; there is
            one session and both windows are looking at it.
          </P>
          <P>
            While a block runs it also has the log field, Later and the urge counter,
            since that is the window in view when any of them is wanted. It says how many
            logs you have written and lines you have put down for later rather than
            listing them; the stage and the calendar have the logs, and the Tasks page
            has the rest.
            Across the window, under the timer, is the block itself, drawn as the
            calendar draws it but on its side, with its start and end at either end:
            the line standing across it is now, so you can see how much is gone, and its
            marks are where you logged and felt the urge to leave. Point at a mark there
            too, to read it or put a log right. End early, or Back to work on a break,
            is the word at the start of the window's footer.
          </P>
          <P>
            You can resize the window. If it becomes awkwardly small or large, use{' '}
            <Em>Reset size</Em> in its footer to bring it back to its compact opening size.
          </P>
          <P>
            It is always on the same question as the stage, the opening ones included, but
            some it will not answer. Hours and commitments are questions about the whole
            day, and the whole day does not fit in a window that size; today's tasks and a
            block's are chosen from your backlog, which does not either. For those it
            shows where the answer stands — what is fixed, which hours, how many tasks you
            have chosen so far — and points you back to the tab, where the calendar and the backlog are.
            That is the same rule as everywhere else here, not an exception to it. The
            window keeps the answers that need neither — <Em>Not yet</Em>, and the few
            minutes to decide.
          </P>
          <P>
            Both questions that carry a timer show out here with it: what today is for,
            and what the next block is for. Working out either is the stretch most likely
            to drift into something else, so you can start the timer from the window and
            keep it in view while you think.
          </P>
          <P>
            You do not have to remember it. By default the window opens itself the moment
            a block starts running — the click that begins the timer is the last thing you
            do before you go off to the work, so it is the moment worth spending on
            getting the timer in front of you. It also opens when a question's timer
            starts: the first time you reach today's question, and from the play button
            by either question. <Em>Pop the timer out when a block starts</Em> and{' '}
            <Em>Pop the timer out when you take time to decide</Em> in settings turn those
            off, and the header button still opens one by hand.
          </P>
          <P>
            That start is also the one moment Mono can count on. A browser hands out a
            window in answer to a click, and its automatic route is kept for pages
            playing sound or using a camera or microphone — not a timer that is usually
            silent — so Mono will not pop the timer up when you minimise the tab, however
            much it might like to. The way to have it there is to let it arrive with the
            block.
          </P>
          <P>
            Close it from its own × or from the header, and it goes when the tab does. It
            needs a Chromium browser — Chrome, Edge, Arc, Brave — and the button is simply
            absent anywhere else.
          </P>
        </>
      ),
    },
    {
      id: 'shape',
      title: 'Give the day a shape',
      body: (
        <>
          <P>
            Every day opens with three questions on the timer.{' '}
            <Em>What are your commitments for today?</Em> comes first, because what you cannot
            move decides how much of the day is left to spend. Then{' '}
            <Em>are these your hours today?</Em>, pre-filled with your usual shape — a
            glance on an ordinary morning. Last, <Em>What are you working on today?</Em>,
            which is only honest once the other two have said how much of the day there
            is.
          </P>
          <P>
            None of them gates another. The dots move between them in any order,
            nothing you have typed is lost by switching, and <Em>Start the day</Em>{' '}
            finishes from whichever you are looking at. With nothing fixed today and the
            usual hours, one task is the whole of it. The questions stay answerable
            afterwards — between blocks the dots go back to any of them, because a
            meeting that appears at four is no different from one you knew about at
            nine, and <Em>Focus</Em> returns. They never skip ahead, though:
            naming a block is not something you can click past, and while one is running
            the questions are the calendar's to answer.
          </P>
          <P>
            Today is answered with tasks, and the day needs at least one before it
            starts, the first time it is asked. Nothing fixed is an ordinary day; nothing
            meant is not, and there is always something to write. While this question
            is open the calendar's column shows <Em>All Tasks</Em>, your whole backlog,
            which can be searched, and where <Em>+ Task</Em>, under a place's{' '}
            <Em>⋯</Em>, writes one into any area, epic or outcome and chooses it as it
            goes. Every row has a <Em>⋯</Em>, shown when you point at it: a task's marks
            it done, renames or deletes it, or reopens one finished today; a place's
            renames, finishes, archives or adds to it, so the backlog is kept without
            leaving the question. The switch at the top of the column turns it back to the day. If you only know the rough
            shape of the work, write a task that says so: <Em>look into the double
            charge</Em> is a perfectly good task to start a day with.
          </P>
          <P>
            Under <Em>Today's tasks</Em> your tasks are shown under the places they live
            in. If it helps, give some of them a name — ship the billing fix, the login
            pages — with <Em>+ Intention</Em> beside the heading, and carry tasks into it by
            dragging them, from today's list or straight from <Em>All Tasks</Em>, or by
            picking one up with the dots in front of it and choosing <Em>Move here</Em>.
            An intention can be narrower than an outcome or wider than an epic, whatever
            the day needs; a task belongs to one at most, and to none quite happily. The{' '}
            <Em>×</Em> on a task takes it out of today and leaves it in your backlog.
          </P>
          <P>
            Today lasts the day: at midnight it goes with the rest of the day's answers,
            and the tasks stay in your backlog. The next day's question offers what was
            left unfinished under <Em>From last time</Em>, each with a <Em>+</Em> to choose
            it again. Nothing comes across by itself, and what you do not take stops
            being offered once another day has chosen its own tasks.
          </P>
          <P>
            The question gives itself {intending} minutes, counting from the first time you
            see it, and keeps counting while you look at the other two. At zero it chimes
            if sound is on and simply stops, offering another round — it never starts the
            day for you, and nothing about it is recorded. Coming back to today's tasks
            later in the day starts no timer unless you ask for one, with the play button
            beside the question.
          </P>
          <P>
            <Em>Working hours</Em> are the only time Mono is allowed to plan in. The{' '}
            <Em>Routine</Em> page holds the shape every day starts from, currently{' '}
            {usualHours}; Settings, and the question itself, link to it. The opening question and <Em>Hours</Em> on the
            calendar both change today only; tomorrow starts from the default again,
            and confirming the shape unchanged leaves today following it.
          </P>
          <P>
            The calendar follows the question as you type it. Add an evening stretch and
            the evening fills in beside you, before you have pressed anything — the plan
            is worked out from scratch every time, so showing you what an answer would
            mean costs nothing. Nothing is written down until you finish the question.
          </P>
          <P>
            Hours are a list of stretches rather than a single end time, so an
            unstructured evening is simply a gap between two of them. Mono stops
            planning before the gap and picks up after it. With no hours at all there is
            no plan — an empty day rather than a guess.
          </P>
          <P>
            <Em>Commitments</Em> are the things already fixed: a meeting, a call, the
            school run. After the opening question, use <Em>Commitment</Em> on the
            calendar. Mono fills the runway up to one and resumes afterwards. Once the
            day has something in it the question shows that rather than an empty form —{' '}
            <Em>Add commitment</Em> opens one when you want it, and a day with
            nothing fixed yet skips straight to the fields. The
            opening question lists the ones you have named in the order they happen
            rather than the order you remembered them in, and every row carries the two
            controls Mono uses everywhere for something you wrote:{' '}
            <Em>
              <EditGlyph />
            </Em>{' '}
            reopens the form that made it, seeded with what it says now, and <Em>×</Em>{' '}
            removes it.
          </P>
          <P>
            A commitment can also cost time either side of itself, under{' '}
            <Em>+ Time either side</Em>. A four o'clock swim is an hour in the pool, half
            an hour getting changed and getting there, and twenty minutes getting back —
            so it really occupies half past three to twenty past five, and a block
            offered at twenty to four is a block you were never going to be at your desk
            for. Mono keeps that whole span clear and draws the travel beside the
            commitment rather than inside it, so the calendar still says how long you
            were actually swimming. Folding <Em>Time either side</Em> away again sets
            both back to nothing: they are minutes Mono holds clear for you, and it
            will not go on holding them out of sight.
          </P>
        </>
      ),
    },
    {
      id: 'recurring',
      title: 'Commitments that repeat',
      body: (
        <>
          <P>
            A standup every weekday, a swim on Tuesdays and Thursdays, a review on the
            first of the month: anything fixed on a schedule is written once, on the{' '}
            <Em>Routine</Em> page beside your usual hours, rather than every morning.
            The commitments question links to it, and so does Settings. It takes
            the same fields as any commitment, the time either side included, and then
            how often — every weekday, every few days, on chosen weekdays every week or
            every other week, or on a date every month or every few. A date a month does
            not have, like the 31st, falls on that month's last day. The form lists the
            next few dates as you write it, which is the quickest way to see a fortnightly
            rule anchored to the wrong week.
          </P>
          <P>
            Each day a series falls on shows it among that day's commitments, marked as
            recurring, without anything being added. Change it there and you change that
            day only: <Em>
              <EditGlyph />
            </Em>{' '}
            moves today's and leaves the series alone, and <Em>×</Em> skips today, with
            tomorrow's coming round as usual. Changing the series itself reaches every day
            still following it, today included — except a day you have already changed by
            hand, and except anything of it that has already begun, which stays where it
            happened. Deleting a series stops it for good, on the same terms.
          </P>
        </>
      ),
    },
    {
      id: 'calendar',
      title: 'Reading the calendar',
      body: (
        <>
          <P>
            Lit bands are your working hours; everything outside them is time Mono will
            not touch. Blocks are drawn at their real length, so forty-five minutes
            looks like forty-five minutes and a gap reads as a gap. The bright line is
            now, and past entries are dimmed rather than cleared — a meeting stays where
            it was after you have sat through it, like the blocks and breaks around it,
            so the axis reads back as the day you actually had.
          </P>
          <P>
            It draws one day, and it starts at the first thing there is to show. Open
            Mono at two and the axis starts at two: the morning of a nine-to-six day you
            were not using it in holds nothing, and drawing five empty hours above your
            afternoon says less than showing none. Anything that did happen up there
            keeps its place, because it is something rather than nothing.
          </P>
          <P>
            Yesterday is not up there either. Mono keeps every block you have ever run —
            that is what Export hands you — but the calendar is today, so the record of
            older days lives in the file rather than on the axis.
          </P>
          <P>
            A break or a commitment still ahead of you carries the same{' '}
            <Em>
              <EditGlyph />
            </Em>{' '}
            and <Em>×</Em> as the list on the opening question, because they are the same
            two things: what you wrote down. Focus blocks carry neither. They are worked
            out from your hours and your commitments, so the way to move one is to change
            what it was worked out from.
          </P>
          <P>
            A block names the tasks it was for, as many as its height has room for, and
            carries what you wrote in it at the minutes you wrote it, down its right edge:
            each urge a dot in the block's colour, each log a small bright bar. Point at a
            bar to read that log in full and to edit or delete it — the block can be long
            over. Where logs were written too close together for a short block to hold
            them apart, they share one bar, drawn as a small stack, and pointing at it
            shows each of them.
          </P>
          <P>
            <Em>Hours</Em>, <Em>Break</Em> and <Em>Commitment</Em> in the calendar's
            heading open in place, just below it. Every one of them asks a question
            about the day — when, and what does it displace — and the day is drawn
            directly below the answer.
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
              asks="What is this block for, and which tasks come under it? The purpose goes at the top and the tasks ticked for this block below it, under their intentions, each with an × to take it off again. Ticking is done beside it, in the calendar's column: All Tasks, the whole backlog, which can be searched, where a new task can be written into any area, epic or outcome, and where tasks can be marked done or reopened. Anything ticked there joins today's tasks as you tick it. Under All Tasks is today's own list, where intentions are kept as on the opening question. Tick at least one. The purpose starts as the tasks' titles, or an outcome's name when you took all of it, and is yours to rewrite — one sentence about this stretch, not a list. One well-chosen task is often a good purpose as it stands."
              choices={[
                [
                  'Start',
                  'The block begins now and runs its full length. The clock starts here, not when the prompt opened, so time spent deciding is not charged to the block. It needs a task and a purpose.',
                ],
                ['Not yet', 'Backs out. Nothing is recorded.'],
                [
                  'Play, by the question',
                  `Stuck? Gives the question ${reflect} minutes to work out what matters, and chimes when they are up. Nothing is recorded and no plan time goes: the block starts only when you name it.`,
                ],
                [
                  'The ring before an intention',
                  'Marks it done, or reopens it. Its tasks stay listed and can still be ticked.',
                ],
              ]}
            />
            <Step
              name="Focusing"
              asks="The timer shows time remaining by default. Click it to see time focused so far, and click again to switch back. Your choice carries into later blocks and breaks. End early sits at the far side, level with the block's name. Your purpose is under the timer, and under that two columns: the block's tasks on the left — tick one off the moment it is done — with ✎ Log and ⤴ Later beneath them, and its logs on the right, with the urge counter beneath them, level with ✎ Log."
              choices={[
                [
                  'Log',
                  'Opens a field to write a line into the block: how it is going, what got in the way, what just worked. Enter keeps it and closes the field; Escape or × closes it without. A log keeps the minute you wrote it, and can be edited or deleted from its ✎ and bin, here or later on the calendar. Deleting takes it off the block; the words stay in the journal Mono keeps, and in an export, as everything you have done does.',
                ],
                [
                  'Later',
                  'Opens a field for a line that is not about this block — an idea, a question, something to look into — so it can be put down and the block got back to. Enter keeps it and closes the field. It waits on the Tasks page with what this block was for beside it, and is never drawn on the block; the stage only says how many this block has put down.',
                ],
                [
                  'Urges',
                  'The + counts an urge to leave the task — the tab you nearly opened, the phone you nearly picked up — whether or not you acted on it. Counting is noticing, not a score: nothing else in Mono reads the number. The − takes back the last one, for a mis-tap.',
                ],
                [
                  'End early',
                  'Ends the block now and records it as cut short. Honest, and permanent — there is no pause. Anything you ticked stays done: a task can be finished in a block that was cut short.',
                ],
              ]}
            />
            <Step
              name="Block done"
              asks="The timer reached zero. Mono chimes if sound is on, shows the block's tasks for a last tick, and asks the only question that matters here."
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
              asks="A break runs on a timer like anything else. Click the timer to see elapsed break time. It lands in your history as a break."
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
      id: 'tasks',
      title: 'Tasks, Later, today and intentions',
      body: (
        <>
          <P>
            <Em>Tasks</Em> in the header opens your backlog: everything you mean to do,
            grouped by area of life — Work and Personal to begin with, and whatever else
            you add. A task sitting straight under an area is that area's inbox. There is
            nothing to triage and no filing required; a one-off like calling someone back
            can live there for good.
          </P>
          <P>
            When an area holds several separate obligations, give each an{' '}
            <Em>epic</Em> — Mono's login work, a house move — and break an epic into{' '}
            <Em>outcomes</Em>, the pieces that each need finishing: the login pages, the
            password reset. Tasks can sit at any of those levels, and move between them
            by being dragged to another column. Without a mouse, pick one up with the
            dots at the start of its row and choose <Em>Move here</Em> where it should
            go; <Em>Escape</Em> puts it back.
          </P>
          <P>
            Each area is drawn as a board. Its epics run down the left, and beside each
            one are its outcomes as columns, each with its tasks beneath it, then the
            tasks that sit straight under the epic. The inbox is last, with its tasks
            beside it.
          </P>
          <P>
            Each card and row carries its actions as small icons — rename, done, drop,
            archive, delete — and hovering one says which it is. You decide when an
            epic or outcome is finished — nothing completes itself because its tasks
            ran out. <Em>Done</Em> and <Em>Archive</Em> both put it away with
            everything inside, out of the page and out of the purpose prompt; the tasks
            inside are left exactly as they were, and <Em>Reopen</Em> or{' '}
            <Em>Restore</Em> brings them all back. <Em>Delete</Em> is the one that
            reaches inside: it deletes everything in the epic too, and asks first,
            saying how much that is. An area can be archived or deleted the same way,
            and deleting one takes everything in it.
          </P>
          <P>
            The backlog lasts. Today's tasks and intentions belong to a day, and a block
            to its stretch of it, but a task written in March is still there in May until you tick it,
            drop it or delete it. <Em>Drop</Em> is deciding not to do something, and it
            stays in the folded list as a decision; <Em>Delete</Em> is taking back a
            mistake. Both done and dropped tasks can be reopened. In that folded list a
            finished epic or outcome shows what it holds nested under it, each task as
            it was left. Wherever tasks are chosen, what you ticked today stays, crossed
            out under its place, so the next choice is made beside what is already done.
          </P>
          <P>
            Under <Em>Today</Em> the page shows today's tasks and intentions as the
            opening question does, and you can write, group and take them out there the
            same way. The sun on a task's row in the backlog chooses it for today, and
            takes it out again. The ring in front of an intention marks it done, there, on
            the opening question or beside the purpose prompt: that is yours to say, not
            something its tasks decide, and it stays listed, crossed out, until the day
            ends. A small thing from outside today is a fine way to use the end of a
            block, too: tick it in All Tasks and it joins today.
          </P>
          <P>
            <Em>Later</Em> is for what turns up while you are doing something else. The
            arrow in the header opens a field for it on every page, and stays open so a
            second thought can follow the first; while a block runs, ⤴ Later beside ✎ Log
            does the same. What you put down waits at the top of the Tasks page, oldest
            first, with what the block was for beside it if it came from one. Carry one
            into any column — drag it, or pick it up by its dots and choose{' '}
            <Em>Move here</Em> — and it becomes a task there and leaves Later. Rename it
            first if it was written in a hurry. <Em>Let go</Em> puts it in a folded list
            it can be brought back from, as a dropped task is kept; <Em>Delete</Em> is
            for good.
          </P>
          <P>
            Ticking a task done is the backlog's business, and finishing a block is the
            block's. Neither says anything about the other — a block can run its full
            length without finishing anything, and a task can be finished in a block you
            cut short.
          </P>
          <P>
            The backlog and Later are kept in this browser like everything else, in their
            own store beside the day's journal, and <Em>Export</Em> in settings carries
            all of it.
          </P>
        </>
      ),
    },
    {
      id: 'breaks',
      title: 'Breaks, and what they cost',
      body: (
        <>
          <P>
            <Em>Breaks are never planned for you.</Em> The timeline always shows the most
            focus the day could hold, which is what makes taking one a visible trade
            rather than a hidden one.
          </P>
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
            You can also pin a break in advance with <Em>Break</Em> on the calendar,
            for rest you already know you will need. The plan works around it exactly
            like a commitment, and like a commitment you can move it or change its
            length afterwards.
          </P>
          <Note>
            A pinned break and a meeting never share a minute, and Mono keeps that from
            both ends. A break will not be pinned across a meeting in the first place —
            the form names the commitment in the way and waits for a different hour, and
            moving an existing break onto one is declined the same way rather than
            losing it. Coming the other way, adding or moving a commitment clears any
            break pinned inside it, counting the time either side, because that is rest
            that would be drawn as part of the meeting and had by nobody. Every other
            break stays put: the shape of the day around them has changed, and whether
            that is still where you want to stop is yours to decide, not Mono's to
            assume.
          </Note>
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
      title: 'Room menu and settings',
      body: (
        <div className="mt-1 space-y-3">
          <Setting name="Deep block / Short block">
            The two block lengths, currently {deep} and {short} minutes. Everything the
            planner does follows from these two numbers.
          </Setting>
          <Setting name="Purpose timer">
            How long the play button on the purpose prompt gives you to decide. Currently{' '}
            {reflect} minutes.
          </Setting>
          <Setting name="Today timer">
            How long the question of what you are working on today runs before it stops
            and offers to go again. Currently {intending} minutes.
          </Setting>
          <Setting name="Routine">
            Linked from Settings rather than in it: the working hours every day
            starts from, currently {usualHours}, and the commitments that repeat. Editing a
            single day from the calendar does not touch either.
          </Setting>
          <Setting name="How to fill free time">
            The ranking policy described above. Currently{' '}
            {policy === 'prefer-deep' ? 'prefer deep blocks' : 'fill the most time'}
            .
          </Setting>
          <Setting name="Room menu: Focus room">
            The coordinated colour and companion environment. Currently{' '}
            {ROOMS[settings.roomId].label}. Changing it never turns sound on by itself.
          </Setting>
          <Setting name="Room menu: Ambient sound">
            Plays only during a focus block and fades away at its edges.
            Currently{' '}
            {settings.ambience === 'off'
              ? 'off'
              : settings.ambience === 'room'
                ? `the room sound — ${ambienceLabel(ROOMS[settings.roomId].suggestedAmbience)}`
                : ambienceLabel(settings.ambience)}
            {settings.ambience === 'off'
              ? '.'
              : ` at ${Math.round(settings.ambienceVolume * 100)}%.`}
            {' '}The speaker at the top of the Room menu turns it off, or back on to
            the room's own suggestion. The speaker icon on the timer mutes it
            temporarily and does not silence the completion chime.
          </Setting>
          <Setting name="Pop the timer out when a block starts">
            Opens the always-on-top window for you as a block begins, rather than leaving
            it to the header button. On unless you turn it off. It can only happen at that
            moment — a window is only ever granted in answer to a click.
          </Setting>
          <Setting name="Pop the timer out when you take time to decide">
            Opens the same window when a question's timer starts — today's question's,
            and the few minutes a block's purpose can take — so the time stays in view
            while you think. On unless you turn it off, and bound to a click in the same
            way: today's timer starts by itself when you first open that question, so the
            click that took you there is the one that brings the window.
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
            If Mono ever says <Em>Not saving</Em> in the header, this is the button it
            is pointing at: the browser has refused to write anything down, and the file
            is the only way out of that. An import replaces your tasks along with the
            day; if the browser will not save the tasks in a file, the import changes
            nothing and says so.
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
            interrupting you. During a block it walks its room from left to
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
            The room around it fills in from the day itself, and the small marks along
            the ground read back completed blocks, deliberate breaks and the gaps that
            did not go to plan. At the end of working hours the same facts become a
            compact postcard. None of this is another score to maintain or another
            piece of saved state: tomorrow begins with an empty room again.
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
