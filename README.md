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

Two more documents, for anyone picking this up:

- **[docs/decisions.md](docs/decisions.md)** — the calls that were made
  deliberately and the traps that have already cost an afternoon. Read it
  before changing something that looks odd; several things are odd on purpose.
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
src/components/  the two panels, the stage prompts, the guide, the companion
```

The UI is two panels. The **stage** on the left is the one thing that changes
with the session phase — every question Mono asks happens there, in the space
the timer occupies, not in a modal over the top of it. The **calendar** on the
right lays the same derived timeline out against real hours, so a 45-minute
block looks like 45 minutes and the gaps read as gaps.

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
and the guide's header shows the timer while it does. A decision like "do you
need a break?" is only answerable while you can see the rest of the day, so it
never gets covered up.

Session state is a fold over an append-only event log
([src/domain/events.ts](src/domain/events.ts)). Only the log is persisted; the
rest is rebuilt from it on load. It is also the raw material for history —
completed blocks, the purpose each one was given, and what the companion knows
about how the day has gone.

## Behaviour worth knowing

- **Blocks are `deep` (45m) and `short` (20m).** Free time is filled by
  enumerating every combination that fits and ranking it. The default,
  `prefer-deep`, takes one deep block over a free hour rather than shredding it
  into three short ones. `maximise-focus` in settings does the opposite; it wins
  on raw minutes, usually by never scheduling a deep block at all.
- **Working hours are the positive space.** Mono plans inside declared work
  regions and nowhere else, and the end of the last region is the planning
  horizon. An unstructured evening is simply a gap between two regions:
  planning stops before it and resumes after. With no regions there is no plan
  — an empty day rather than a guess.
- **Margin is always rounded down.** A 50-minute gap holds one block and five
  dead minutes, never more.
- **Breaks are never planned for you.** The timeline shows the maximum focus the
  day can hold, so taking a break is a visible trade — the duration prompt tells
  you what it costs before you commit.
- **A pinned break and a commitment never share a minute**, and the rule is
  kept from both ends. Adding or moving a commitment clears the breaks it
  swallows — a pin inside its span, the time either side counted, would be
  merged into the meeting and drawn as rest nobody gets — and only those. Pins
  elsewhere in the day stay, because the day changing shape around a break you
  can still take is a reason to let you move it, not to delete it. From the
  other end, a break cannot be pinned or dragged across a commitment: the
  composer names the one in the way and the reducer refuses the event, so a log
  replays to the same day whichever order it was written in.
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
  other — the stage carousel moves between them freely and `Start the day`
  finishes from either — but the carousel never skips ahead to naming a block.
  Finishing appends `day/shaped`, a record of having been *asked*: an empty day
  is a real answer, and confirming an unedited shape deliberately writes no
  region override, so the day stays derived from the default.
- **The calendar follows the hours question as it is typed.** The draft is fed
  straight to `derivePlan` rather than stored anywhere, so adding an evening
  stretch redraws the evening beside you; nothing is written until the question
  is finished, and an untouched draft is never written at all. Opening the
  calendar's own `Hours` drops the draft, because that editor now owns the
  answer.
- **Both questions stay reachable between blocks.** The strip goes back to them
  whenever nothing is running, and `Back to the day` returns; `day/shaped` is
  not appended a second time, because coming back to change an answer is not
  being asked again. While a block runs the strip is an indicator only. Only one
  editor of today's hours is ever on screen — opening the stage's question
  closes the calendar's `Hours`, and opening `Hours` takes the question off the
  stage — because each holds its own draft and the second save would silently
  win.
- **A commitment can cost time either side of itself.** `prepMin` and
  `recoverMin` cover getting ready, travelling and settling back in — a 4pm swim
  is an hour long and occupies 3:30 to 5:20. The planner keeps the whole span
  clear; the calendar draws the travel as its own entries so the commitment
  still shows its real length. Both are optional, so logs written before they
  existed replay unchanged. Read them through `commitmentSpan`. The fold that
  hides the pair goes both ways, and closing it zeroes them: a margin shapes the
  plan whether or not its field is on screen, so hiding one would be keeping
  time clear with nothing on the form to say why.
- **Commitments** after the opening question are added from the calendar header
  (`+ Commitment`). Both surfaces resolve a wall-clock time against today's
  calendar at the edge; the domain only ever sees epoch milliseconds. A
  commitment outside every work region still shows on the calendar, but it does
  not extend the horizon. A commitment stops shaping the plan when its span
  ends and stays drawn, dimmed, where it was — the axis is the day as it
  happened as well as the day as planned.
- **The two things you wrote can be rewritten.** A pinned break and a commitment
  each carry a `✎` on their block, which reopens the composer that made them,
  seeded from what they say now. The opening question's list carries the same
  pair on every row, and lists them in the order the day happens rather than the
  order they were named. Editing keeps the id, so the plan re-derives
  around the same thing moved rather than around a new one. Nothing else on the
  axis is editable: a focus block is output, and the way to move it is to change
  the hours or the commitments it was planned around.
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

## The companion

A pixel cat on a strip of ground, in the corner of the stage. It changes with
what Mono is doing, and during a block it walks its ground from left to right as
the time passes — so it is the progress indicator as well as the character.

Its art is authored as text, one character per pixel, in
[src/components/Companion/frames.ts](src/components/Companion/frames.ts). What
it knows about the day is a fold over the same history the timeline is drawn
from, so there is no companion state to store or migrate. The app icons are
generated from the same frames, which is why the tab icon is the same animal.

The rule it keeps: lively at the seams of a block, dull in the middle of one. It
reacts, it never interrupts, and it stops moving entirely under
`prefers-reduced-motion`.

```bash
npm run companion   # a contact sheet of every frame, as a PNG
npm run icons       # regenerate the favicon and PWA icons from those frames
```

## Limitations

Background notifications are best-effort. Without a push server a notification
fired from a frozen tab can be delayed or dropped; the guarantee is the
reconcile-on-wake path, not the notification.

## Verifying the timer by hand

Two things the tests cannot cover:

1. Start a block, background the tab for five minutes, come back. The remaining
   time must be correct and no block silently completed.
2. Start a block and sleep the machine across its end. You should get the
   "You were away" prompt with the right elapsed span.
