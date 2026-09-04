# Mono

A companion to help you focus and get stuff done during the day. It learns the
shape of your day, fills the free time with focus blocks, and asks you to name
one thing each block is for.

Local-first: everything lives in your browser. No account, no server, no sync.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + property tests
npm run test:e2e   # Playwright, builds and previews first
npm run build      # production bundle + service worker
```

Three more documents, for anyone picking this up:

- **[docs/decisions.md](docs/decisions.md)** — the calls that were made
  deliberately and the traps that have already cost an afternoon. Read it
  before changing something that looks odd; several things are odd on purpose.
  It also settles where new documentation goes.
- **[docs/manual-qa.md](docs/manual-qa.md)** — what has to be checked by hand,
  because no test can hear audio or open a real always-on-top window.
- **[CLAUDE.md](CLAUDE.md)** — the short orientation, auto-loaded by agents.

Everything descriptive lives in the source. Every file worth reading opens with
a docblock explaining what it is for.

## How it fits together

Two decisions explain most of the code.

**The plan is a pure function, not stored state.** `derivePlan()` in
[src/domain/planner.ts](src/domain/planner.ts) recomputes the entire future from
`(now, regions, commitments, settings, history, overrides)`. Nothing mutates a
schedule; every deviation — a break taken, a commitment added, a block abandoned
— just re-derives. The timer and the timeline render the same derived structure,
so they cannot disagree.

**Timers are absolute timestamps, never accumulated ticks.** Every segment
carries an absolute `endsAt`, and the UI renders `endsAt - Date.now()`. The
one-second tick in [src/hooks/useNow.ts](src/hooks/useNow.ts) exists only to
trigger a re-render, so a throttled or skipped tick makes the display briefly
stale but never wrong.

```
src/domain/      pure: types, event log, planner, state machine, time, vitals
src/store/       the only place that reads the clock, makes ids, persists
src/hooks/       the ticker, reconciliation, notifications
src/ambient/     rooms, procedural sound, theme, controls, shared scene geometry
src/components/  the two panels, the stage prompts, the guide, the companion
src/pip/         the always-on-top mini window
```

The UI is two panels. The **stage** on the left is the one thing that changes
with the session phase — every question Mono asks happens there, in the space
the timer occupies, not in a modal over the top of it. The **calendar** on the
right lays the same derived timeline out against real hours, so a 45-minute
block looks like 45 minutes and the gaps read as gaps.

There is a third surface, and it is deliberately somewhere else. **Pop out**
opens the timer as an always-on-top window — Chromium's document
picture-in-picture — that stays above whatever you switched to. It is a
reduction of the stage rather than a mirror of the app: it shows the phase, the
countdown, the purpose, the cat, and the controls for whatever Mono is currently
asking. The one question it declines is the day's shape, which needs the
calendar beside it; that one it hands back to the tab.

It arrives on its own when a block starts, which is a setting and is on by
default: a block is time you spend somewhere else, and an ambient timer is what
makes that time read as a block rather than an unmarked stretch of afternoon.
That start is also the only moment it *can* arrive — a browser grants a window
in answer to a click and at no other time — so Mono cannot pop it up when you
minimise the tab, and does not pretend to.

Both panels edit themselves in place. The calendar's `Hours`, `+ Break` and
`+ Commitment` expand under its own heading rather than opening a window over
the page — every one of them asks a question about the day, and the day is
drawn directly below the answer. **Settings is the only dialog left**, because
it is the only genuine aside. It is sized to the viewport rather than to its
content — the title stays put and the body scrolls — and it closes three ways:
the ×, escape, or a click on the backdrop.

One breakpoint decides who scrolls. From `lg` up the app owns the viewport: the
two columns sit side by side and each scrolls inside itself, so the timer stays
put while you move around the day beside it. Below it the columns stack, and
pinning the height there would mean two short boxes with their own scrollbars
inside a page that does not move — so nothing is pinned, both panels are as tall
as what they hold, and the document scrolls. Every `lg:` in `App`, `DayCalendar`
and `GuidePage` is that one decision.

The **guide** is the exception that proves the rule: it is read rather than
answered, so it is a page at `#/guide` rather than a dialog. `App` swaps the
view without unmounting anything, so a block keeps running while you read it,
and the guide's header shows the timer while it does. Its examples are built
from the current settings, so changing a duration changes the explanation too.
A decision like "do you need a break?" is only answerable while you can see the
rest of the day, so it never gets covered up.

Session state is a fold over an append-only event log
([src/domain/events.ts](src/domain/events.ts)). Only the log is persisted; the
rest is rebuilt from it on load. It is also the raw material for history —
completed blocks, the purpose each one was given, and what the companion knows
about how the day has gone.

## Behaviour worth knowing

The full description of how Mono behaves is the guide at `#/guide`, and it is
built from the current settings — change a duration and the explanation changes
with it. That is the copy to trust. These are the rules everything else is
shaped around:

- **Blocks are `deep` (45m) and `short` (20m).** Free time is filled by
  enumerating every combination that fits and ranking it. The default,
  `prefer-deep`, takes one deep block over a free hour rather than shredding it
  into three short ones. `maximise-focus` in settings does the opposite; it wins
  on raw minutes, usually by never scheduling a deep block at all.
- **Working hours are the positive space.** Mono plans inside declared work
  regions and nowhere else, and the end of the last region is the planning
  horizon. An unstructured evening is simply a gap between two regions. With no
  regions there is no plan — an empty day rather than a guess.
- **Margin is always rounded down.** A 50-minute gap holds one block and five
  dead minutes, never more.
- **Breaks are never planned for you.** The timeline shows the maximum focus the
  day can hold, so taking a break is a visible trade — the duration prompt tells
  you what it costs before you commit.
- **A pinned break and a commitment never share a minute**, and the rule is kept
  from both ends: adding a commitment clears the breaks it swallows, and a break
  cannot be dragged across one. A log therefore replays to the same day whichever
  order it was written in.
- **Blocks can be abandoned but not paused.** A paused timer means `endsAt` is
  no longer a fixed instant, which is where timer bugs come from.
- **Coming back after being away never auto-completes a block.** If the app was
  frozen, the machine slept, or the tab was simply closed across a block
  boundary, it asks what happened and records the unaccounted stretch, so the
  day still adds up.
- **The plan resets at midnight**, but never mid-block, and history is kept.
- **The day opens with two questions** on the stage: what is already fixed, then
  today's hours. Commitments come first because they are the part of the day you
  cannot move, so they decide how much is left to declare. Neither gates the
  other, both stay reachable between blocks, and the calendar follows the hours
  question as it is typed.
- **Outside working hours Mono says so** and names the next stretch, rather than
  offering a block in time you declared unstructured. The way to work anyway is
  to change the hours.

## Working hours

Settings holds the recurring daily shape — a list of stretches, `09:00-18:00` by
default. Every day starts seeded from it. Editing a day's hours — from the
opening question, or from the calendar's `Hours` afterwards — overrides that day
only; the midnight reset drops the override so tomorrow starts from the default
again.

Regions do not wrap past midnight — the plan is scoped to a calendar day, so a
late stretch ends at 23:59 rather than running into tomorrow.

## Rooms, ambience and the companion

The header's `Room` menu offers four curated dark rooms: Mono, Ember, Tide and
Moss, with a palette swatch beside each choice. A room is one coordinated
palette and pixel environment rather than a loose accent picker, and it follows
the timer into the always-on-top window. Mono remains the default, so an
existing browser opens exactly where it left off.

Ambient sound is off until it is explicitly chosen. Brown noise, pink noise
and rain are synthesised locally with Web Audio; there are no streamed tracks
or audio files. `Room sound` follows the current room's suggestion. It fades in
only while a focus or priorities block is running and fades away for prompts
and breaks. The timer's speaker icon controls a tab-local mute that is separate
from the block-end chime. That mute governs automatic block ambience; choosing
a sound while idle is an explicit request to hear its six-second preview.

A pixel cat in a small room, in the corner of the stage. It changes with what
Mono is doing, and during a block it walks the room from left to right as the
time passes — so it is the progress indicator as well as the character.

The cat sprite is authored as text, one character per pixel, in
[src/components/Companion/frames.ts](src/components/Companion/frames.ts); the
small room and trail are SVG rendered from shared, DOM-free geometry in
[src/ambient/scene.ts](src/ambient/scene.ts), so the app and visual-QA sheet
cannot drift. What it knows about the day is a fold over the same history the
timeline is drawn from, so there is no companion state to store or migrate. The
app icons are generated from the same frames, which is why the tab icon is the
same animal.

The room around it grows at one, three and six completed focus blocks, while a
small trail keeps the sequence of focus, reflection, rest and honest gaps. Both
are derived from today's history and reset at midnight; neither adds stored
game state or takes anything away after an abandoned block. After the final
working region, the same facts become the `Day done` postcard.

The rule it keeps: lively at the seams of a block, dull in the middle of one. It
reacts, it never interrupts, and it stops moving entirely under
`prefers-reduced-motion`. The companion has a few small interactions left for
the user to discover; none writes progress or changes what the day earned.

```bash
npm run companion   # visual QA sheet for rooms, progression and companion frames
npm run icons       # regenerate the favicon and PWA icons from those frames
```

## Limitations

If the browser refuses to save — a full quota, or site data blocked — Mono says
so in the header and keeps running on the session it has in memory. The log is
the one thing here that cannot be rebuilt from anything else, so the warning
leads to Export rather than to a retry. There is no cap on the log: a heavy day
is a few kilobytes, and truncating the journal to make room would cost more than
it saves.

Background notifications are best-effort. Without a push server a notification
fired from a frozen tab can be delayed or dropped; the guarantee is the
reconcile-on-wake path, not the notification.

## Verifying by hand

Some of this cannot be tested. A browser test cannot hear a loop seam, and
Playwright is never given a real picture-in-picture window — the e2e specs stand
it in with an iframe. [docs/manual-qa.md](docs/manual-qa.md) is the list of
checks that close that gap: the timer across sleep, the pop-out across monitors,
every ambient sound, reduced motion, and the end-of-day card.
