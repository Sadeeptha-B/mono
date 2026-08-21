# Mono

A companion to help you focus and get stuff done during the day. See
[requirements.md](requirements.md) for what it is meant to do.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # domain unit + property tests
npm run test:e2e   # Playwright, builds and previews first
npm run build      # production bundle + service worker
```

## How it fits together

Two decisions explain most of the code.

**The plan is a pure function, not stored state.** `derivePlan()` in
[src/domain/planner.ts](src/domain/planner.ts) recomputes the entire future from
`(now, regions, commitments, settings, history, overrides)`. Nothing mutates a schedule;
every deviation — a break taken, a commitment added, a block abandoned — just
re-derives. The timer and the timeline render the same derived structure, so
they cannot disagree.

**Timers are absolute timestamps, never accumulated ticks.** Every segment
carries an absolute `endsAt`, and the UI renders `endsAt - Date.now()`. The
one-second tick in [src/hooks/useNow.ts](src/hooks/useNow.ts) exists only to
trigger a re-render, so a throttled or skipped tick makes the display briefly
stale but never wrong.

```
src/domain/            pure: types, event log, planner, state machine, time
src/store/             the only place that reads the clock, makes ids, persists
src/hooks/             the ticker, reconciliation, notifications
src/components/stage/  the in-place prompts (purpose, break, reconcile)
src/components/Timeline/  the day on a time axis
src/components/Guide/  the user guide, at #/guide
```

The UI is two panels. The **stage** on the left is the one thing that changes
with the session phase — every question Mono asks happens there, in the space
the timer occupies, not in a modal over the top of it. The **calendar** on the
right lays the same derived timeline out against real hours, so a 45-minute
block looks like 45 minutes and the gaps read as gaps.

Dialogs are reserved for genuine asides: settings, and editing the timeline
from its own header. They are sized to the viewport rather than to their
content — the title stays put and the body scrolls, using the app's own
scrollbar rather than the browser's — and they close three ways: the ×, escape,
or a click on the backdrop.

The **guide** is the exception that proves the rule: it is read rather than
answered, so it is a page at `#/guide` rather than a dialog. `App` swaps the
view without unmounting anything, so a block keeps running while you read it,
and the guide's header shows the timer while it does. A decision like "do you need a break?" is only answerable
while you can see the rest of the day, so it never gets covered up.

Session state is a fold over an append-only event log
([src/domain/events.ts](src/domain/events.ts)). Only the log is persisted; the
rest is rebuilt from it on load. It is also the raw material for history —
completed blocks and the purpose each one was given.

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
- **Adding a commitment clears every future break**, deliberately, and says so.
- **Blocks can be abandoned but not paused.** A paused timer means `endsAt` is
  no longer a fixed instant, which is where timer bugs come from.
- **Coming back after being away never auto-completes a block.** If the app was
  frozen, the machine slept, or the tab was simply closed across a block
  boundary, it asks what happened and records the unaccounted stretch, so the
  day still adds up.
- **The plan resets at midnight**, but never mid-block, and history is kept.
- **Commitments** are asked for on the stage when the day has no shape yet, and
  added from the calendar header (`+ Commitment`) after that. Both resolve a
  wall-clock time against today's calendar at the edge; the domain only ever
  sees epoch milliseconds. A commitment outside every work region still shows on
  the calendar, but it does not extend the horizon.
- **Outside working hours Mono says so** and names the next stretch, rather than
  offering a block in time you declared unstructured. The way to work anyway is
  to change the hours.

## Working hours

Settings holds the recurring daily shape — a list of stretches, `09:00-18:00` by
default. Every day starts seeded from it. Editing a day's hours from the
calendar (`Hours`) overrides that day only; the midnight reset drops the
override so tomorrow starts from the default again.

This replaced a single `dayEndsAt` setting, which could only say when the day
stopped. It could not describe an unstructured evening with work after it, and
once the clock passed it, it silently fell back to midnight.

Regions do not wrap past midnight — the plan is scoped to a calendar day, so a
late stretch ends at 23:59 rather than running into tomorrow.

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
