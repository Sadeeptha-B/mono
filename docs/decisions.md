# Decisions

What this file is: the reasoning that is **not recoverable from the source**.
Calls that were made deliberately, several after being built the other way; and
traps that have already cost someone an afternoon.

What this file is not: a description of the codebase. Every file worth reading
opens with a docblock explaining what it is for and why it is shaped that way,
and those cannot drift because they sit next to the code. Nothing here should
duplicate them, and nothing here should state a fact a command could answer —
no test counts, no file inventories, no line totals. Those rot within a week
and then actively mislead.

Append to the log at the bottom rather than editing entries above. "Changed
after being built the other way" is the most useful sentence in this document
and it only survives if entries accumulate.

---

## The two invariants

Everything else is negotiable. These are not.

### 1. The plan is a pure function, not stored state

`derivePlan()` recomputes the entire future on every call. There is no stored
schedule. A break taken, a commitment added, a block abandoned, the clock
advancing — all of it is handled by calling it again. This is why the timer and
the calendar can never disagree: they render the same derived structure.

Consequences to preserve:

- It never reads the clock (`now` is a parameter) and never generates random
  ids. Planned-block ids are **derived from position** so that re-deriving is
  idempotent and React keys stay stable. Do not switch them to
  `crypto.randomUUID()`.
- A property test asserts `derivePlan(i)` deep-equals `derivePlan(i)`.

The same rule now covers the companion: what the cat knows about the day is a
fold over the history, not state of its own. There is nothing to persist,
nothing to migrate, and nothing that can survive a day it should not have.

### 2. Timers are absolute timestamps, never accumulated ticks

Every segment carries an absolute `endsAt`, and the UI renders
`endsAt - Date.now()`. The one-second tick exists *only* to trigger a
re-render. A throttled, delayed or entirely skipped tick therefore makes the
display briefly stale but never wrong.

Never introduce a `remaining -= 1` counter.

---

## Settled decisions

### Planning

| Decision | Why |
|---|---|
| `prefer-deep` is the planner default | `maximise-focus` wins on raw minutes by almost never scheduling a deep block — 20 divides more finely than 45, so a two-hour afternoon becomes six short blocks. Built the other way first, then changed. |
| Breaks are **never** auto-planned | The timeline shows the maximum focus the day could hold, which is what makes taking a break a visible trade. `breakCost()` prices it live in the prompt. |
| Adding a commitment clears all future breaks | Deliberately blunt; the UI says so. Scoped to not-yet-started breaks. |
| Margin always rounds down | Fifty minutes holds one block and five dead minutes, never more. |
| Work regions (positive space) replaced a single `dayEndsAt` | One end-time could not describe an unstructured evening with work after it, and once the clock passed it, it silently fell back to midnight. |
| Regions are a recurring default plus a per-day override | Today's regions are **derived, not seeded**, so changing the default reshapes every uncustomised day immediately. |
| One shape for all days | No weekday/weekend split. Per-day edits cover the exceptions. |
| Regions never wrap past midnight | The plan is scoped to a calendar day. A late stretch ends at 23:59; overnight regions would complicate the whole model. |
| A commitment outside every region shows but does not extend the horizon | It is a fact about the day, not permission to plan in it. |
| Midnight reset never fires mid-block | `checkDayRollover` returns early while something is running. |

### The session

| Decision | Why |
|---|---|
| Abandon, but **no pause** | A paused timer means `endsAt` is no longer a fixed instant, and that is where timer bugs come from. Ending early and starting again is the honest version of the same thing. |
| Never auto-complete after being away | Banking a block the user spent at lunch would poison the history, and the history is the point. On resolution the block is credited at `endsAt`, not at `now`, and the unaccounted stretch is recorded so the day still adds up. |
| The priorities timer is a real block | It consumes plan time and lands in history like anything else, rather than being a special case outside the model. Not being able to name a purpose is worth knowing. |
| Phase is not persisted | It is which prompt is open. A running *segment* must survive a reload, and does; a stale question must not. |
| Prompts are inline on the stage, not modals | "Do you need a break?" is only answerable while you can see the rest of the day. Dialogs are reserved for genuine asides: settings, and the calendar's own editors. |
| Outside working hours, Mono says so | It names the next stretch and refuses to offer a block. The escape hatch is changing the declared hours, so working anyway means saying so. |

### The companion

| Decision | Why |
|---|---|
| A pixel sprite replaced the one-line character | The line could only ever be a gesture: every expression was derived from a neck point and a tilt angle, so making it cheerful meant trigonometry, and the safe move was always to keep it minimal. That is the wrong instinct here — the problem this app solves is that the user leaves to find something more interesting. A companion worth glancing at is a feature. |
| Lively at the seams of a block, dull in the middle of one | This is the rule that lets the companion be interesting without becoming the problem in a costume. The focusing pose holds one frame for thirteen seconds; petting it during a block buys one blink and nothing else. Whatever the character grows into, it keeps this. |
| Fur colour is fixed; only the accent moves | Tinting the whole animal per phase looked like seven different cats. Ears, nose, tail and ground carry the state instead. |
| Art is authored as text, one character per pixel | A new pose is drawn rather than derived. This is the whole reason for leaving the parametric character behind. |
| Markings only ever accumulate | The reset is midnight, not a mistake. A cat that visibly downgrades when you abandon a block would be a punishment dressed as a pet. |
| Neither a break nor the priorities timer ends a streak | Both are things the app actively wants you to do. A counter that punished them would argue with the rest of the product. |
| Utterances are derived from the numbers, not drawn from a phrase pool | A pool would need a seed to stop it churning on the tick, and it would be the one part of Mono that talks for the sake of talking. Everything else here states a fact and stops. |
| The icons are generated from the companion's own frames | So the app icon cannot quietly stop being a picture of the thing in the corner of the app. |

---

## Traps

Things that have already bitten.

**`now` ticks every second — never put it in a `useEffect` dependency list.**
The commitment form reset itself once a second, which reads while typing as the
field clearing on every keystroke. The fix is `useSeedOnOpen`, which seeds on
open only and reads the current time through a ref. Reading `now` during
*render* is fine; writing it into state on a tick is not. There is a regression
test that types with the real clock running.

**Zustand's `persist` rehydrates synchronously, during module evaluation.**
With a sync storage, `migrate` and `onRehydrateStorage` execute at the
`create(...)` call — before any `const` declared *below* it in the same file
exists. `migrate` used to call a helper from the bottom of `session.ts`, hit its
temporal dead zone, and zustand's hydrate path swallowed the ReferenceError: the
store silently kept its initial state, so a v1 log was wiped rather than
migrated, and the only symptom was an empty app. Anything reachable from those
two hooks lives in `schema.ts` now. Do not declare a new one after the store.

**Playwright's `clock.install()` keeps ticking.** You must also call
`clock.pauseAt(time)`, or block arithmetic drifts by a few hundred milliseconds
— enough to turn a 180-minute runway into 179.9 and cost a whole deep block.
This produced a convincing "planner bug" that was not one.

**A paused Playwright clock also freezes Motion.** The animation library's frame
loop runs off the faked timers, so animated values never settle: the companion's
walk sat at its starting transform through three fast-forwards and looked
broken. Anything asserting on an animated transform has to `clock.resume()` and
wait first. Nothing was wrong with the component.

**Seeding `localStorage` has to happen before the app's first run.** Setting it
after a `goto` loses to the app's own write, and then the day-rollover sees a
stale key and wipes the log — leaving exactly one `day/reset` event and a
mystery. Use `addInitScript`, and install the clock before navigating.

**Playwright locators are substring and case-insensitive by default.** Every one
of these has already caused a strict-mode violation here:

| Query | Also matches |
|---|---|
| `getByLabel('At')` | "Wh**at**" |
| `getByRole('button', { name: '5m' })` | "1**5m**" |
| `getByText('2 PM')` | "1**2 PM**" |
| `getByRole('button', { name: 'Hours' })` | "Change today's **hours**" |

Use `{ exact: true }` liberally, and scope with `role=main` (the stage) versus
`role=complementary` (the calendar) — the same text often appears in both.

**Calendar blocks are found by their `title`**, in the shape
`Deep · 2:00 PM · 45m`. Changing that attribute breaks the e2e helpers.

**A finished block is not in the log until the user answers.** `timerElapsed`
moves `focusing` to `blockComplete` and appends *nothing* — the block stays
open through the "break or keep going?" prompt so that walking away from it
cannot silently bank it. That is deliberate and has its own test. The cost is
that anything reading the day back during that prompt sees one block fewer than
the user does: the companion congratulated you on the block before last, and
told you "that makes 0 today" on the first block of a day. `vitalsFor` takes
the open segment as an argument for exactly this reason. Anything else that
learns to read the history back will hit the same edge.

**Companion frame anchors fail silently.** Each pose hand-places where its face,
markings, note and heart go. Get one wrong and the eyes float on the background
or the markings hang off the flank — and the pose still looks deliberate enough
that nobody notices. Tests assert every anchor lands on solid fur; keep them
that way when adding a pose.

**`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are both on.**
That is why you see `...(detail === undefined ? {} : { detail })` rather than
`detail`, and `!` / `?.` on array access.

**Tailwind v4, no config file.** The theme lives in an `@theme` block in
`src/index.css`. There is no `tailwind.config.js`.

**Service worker updates are deferred until idle.** Reloading mid-block would
destroy a focus session, so the registration subscribes to the store and only
flushes when nothing is running.

**Perf note.** `App` re-renders every second and `derivePlan` runs on each tick.
Cheap at this scale and measurably fine, but it is the first place to look if
the calendar ever feels sluggish. `App` also subscribes to the whole store with
a bare `useSession()`; it re-renders every second anyway, so this costs nothing
today. Anything expensive that is keyed on the *day* rather than the second —
the companion's vitals, for one — should stay keyed that way.

---

## Deliberately not built

- **No history or journal view.** The log captures everything one would need
  (completed blocks, outcomes, purposes, away spans) and `vitals` reads a slice
  of it back, but nothing presents the archive.
- **No cross-device sync.** JSON export/import is the escape hatch.
- **No weekday-aware default shape.**
- **No editing a block's purpose after it starts.**
- **No component tests.** Testing is either pure-domain or full e2e. Nothing
  mounts a component in vitest.

---

## Log

Append here. Newest last.

**2026-08-21 — Bootstrap.** The domain (planner, event log, state machine,
time), the two-panel UI, persistence with a real v1→v2 migration, the guide as a
route, and the e2e suite. Git history starts here, so everything above this line
predates version control.

**2026-08-21 — Companion rewritten as a pixel cat.** `OneLine.tsx` and
`moods.ts` — the parametric one-stroke character — were replaced by a sprite
pipeline: art authored as text in `frames.ts`, composited by `sprite.ts`, posed
by `cat.ts`, rendered by `PixelCat.tsx`. The old files were kept unimported for
two rounds as an escape hatch, then deleted. The line's three good ideas were
carried over unchanged: the companion is the progress indicator, it reacts but
never interrupts, and one creature serves both mounts.

**2026-08-21 — The companion learned the day.** Seven poses covering every
phase; petting and pointer-following gaze; `domain/vitals.ts` folding the
history into blocks banked, focus minutes and a streak; earned markings; a
derived one-line remark at the seams; the note the cat holds during a block.
Favicon and PWA icons regenerated from the same frames.

**2026-08-21 — Documentation restructured.** `HANDOVER.md` was ~500 lines and
half of it had rotted: stale test counts, a stale file inventory, "not currently
a git repository", and four paragraphs instructing the reader to preserve
functions in a file nothing imported any more. The derivable half was deleted
rather than refreshed, the state-machine diagram and the fill-policy table moved
into the docblocks of the code they describe, and what remained became this
file. `CLAUDE.md` was added so an agent gets the map without being told to look
for it.

**2026-08-21 — Review pass on the companion.** Three fixes. The cat counted a
block late at the break prompt, because a finished block is deliberately not in
the log yet (now a trap above, and `vitalsFor` takes the open segment).
The cat walked during breaks, which contradicted both the guide and the
renderer's own comment — walking is how a *block* shows progress, and a cat
that is meant to be resting should not pace. And the header's head crop was
fixed at the top of the sprite, so the two poses whose head is lower — the
break sprawl and the asleep curl — rendered as an empty box with a sliver of
ear; the crop follows the face anchor now. The last one was live in the app
header the whole time and the review missed it, which is a fair argument for
looking at the thing as well as reading it.

A second pass then caught the tail of the same change: the contact sheet was
still drawing the old fixed crop, so the one tool you would use to check a new
pose's head was showing something the app no longer does. Both generator
scripts deliberately copy a little of `cat.ts` rather than import it — they
stay plain node scripts, runnable without a build — and that copy is now on its
second drift. It has cost a misleading picture twice and a wrong app zero
times, so the trade still holds; but when a script copies a constant, the copy
needs updating in the same commit as the original, not the next review.
