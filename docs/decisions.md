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
| Prompts are inline on the stage, not modals | "Do you need a break?" is only answerable while you can see the rest of the day. Dialogs are reserved for genuine asides: settings, and the calendar's own editors. **The exemption for the calendar's editors was dropped on 2026-08-22 — see the log.** Settings is now the only dialog. |
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
field clearing on every keystroke. Reading `now` during *render* is fine;
writing it into state on a tick is not. There is a regression test that types
with the real clock running.

The fix used to be `useSeedOnOpen`, a hook that seeded a permanently-mounted
dialog once per open and read the clock through a ref. It is gone: the forms
mount when they open now, so they seed from a lazy `useState` initialiser and
the hazard cannot arise. Anything that goes back to an `open` prop on a mounted
form brings the hazard back with it.

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

**Forms that never used to coexist now do.** While the editors were dialogs,
only one could be on screen, so identical labels in two of them were harmless.
Inline, the day's opening question, the calendar's composer and the settings
panel can all be mounted at once. Two consequences, both structural rather than
worked around in the tests: `RegionShapeEditor` takes a `label`, so today's
hours are `Today's hours 1 start` while the recurring shape stays
`Working hours 1 start`; and `CommitmentFields` takes an `idPrefix`, because two
`id="commitment-title"` inputs point every second label at the first field.

**"Today" is a substring of "Are these your hours today?"** — one of the two
headings the app opens with, and `getByRole('heading', { name: 'Today' })` is the
readiness gate in `openMono`, load-bearing for every single e2e test. It needs
`{ exact: true }`. So does `Settings`, which the guide's own contents list
matches with "Settings, one by one".

**The stage carousel duplicates the setup panel's own navigation.** Both the
dot and the ghost button go to the other opening question, so both carry the
same accessible name — correct for a reader, ambiguous for a locator. The e2e
helper scopes to `role=navigation` named "Stages of the day". Do not "fix" the
duplicate names by making one of them vaguer.

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

**2026-08-22 — The last of the modals, and a day that asks about its hours.**
Three changes that turned out to be one.

*The calendar's editors are no longer dialogs.* The settled row above says
prompts are inline "because 'do you need a break?' is only answerable while you
can see the rest of the day", and then exempts "the calendar's own editors".
That exemption does not survive being read next to its own justification.
`Hours`, `+ Break` and `+ Commitment` are edits *to* the timeline, and `Dialog`
centres a 30rem card over an `ink/80` backdrop with a blur — it hid precisely
the thing needed to answer "when?". They expand under the calendar's heading
now, and the hour axis, which already scrolled, simply gets shorter. Settings is
the only dialog left, and is the one thing here that really is an aside.

A pleasant side effect: `useSeedOnOpen` is gone. It existed because a dialog
stays mounted behind an `open` prop, so seeding a form from `now` re-ran every
second and read, while typing, as the field clearing itself. A composer that
mounts when it opens seeds from a lazy initialiser and cannot have the problem.
The regression test still types with the real clock running, and now covers the
opening question and the composer rather than the stage and a dialog.

*The day asks for its hours before it asks for anything else.* It never did,
which was backwards: working hours are the only time Mono may plan in, so every
block it offers is downstream of them, and they were reachable only through a
`text-xs` button in a 22rem column. Two steps rather than one form, because
every other panel on the stage asks exactly one thing. Step one is pre-filled
from the recurring shape, so an ordinary morning is a glance and one click.

*`day/shaped`, and the bug it turned up.* The opening prompt used to be gated on
`hasCommitments`, which is not the same question as "have we asked yet" — a day
with nothing fixed in it answered by having nothing to say, and got asked
forever, so it could never reach the start control at all. There was no skip.
The marker is a real event rather than a stamped `regionOverrides`, which was
the cheaper option: stamping would have detached *every* day from the recurring
default, and "today's regions are derived, not seeded" is the whole reason
changing the default shape reshapes an uncustomised day. Confirming an unedited
shape therefore writes nothing. It also gives "Nothing fixed today" somewhere to
be recorded.

Consequently the setup now outranks the out-of-hours panel, which used to
outrank everything. Opening Mono at 08:30 against a 09:00 start is the commonest
time to be looking at this, and being told "outside working hours" by the app
that has not yet asked where those hours are is a closed loop. The panel folds
the clock in as context instead — "It's 8:30 — your day starts at 9:00" — and
the out-of-hours escape hatch now opens the calendar's editor rather than a
dialog, so there is one hours editor reached from two places instead of two.

*Settings opens from the guide.* It always should have: the guide explains each
setting using its live value, so it is the page you are most likely to be
reading when you want to change one, and it was the one place you could not.
`App` renders the panel on both routes; the route swap only changes the view.

**2026-08-22 — Commitments first, the stage carousel, and the time around a
commitment.** Three more, from the same session.

*The opening questions swapped order.* Commitments now come before hours. What
is already fixed is the part of the day you do not control, and it decides how
much of the day is left to declare — asking "when are you working?" first meant
asking it again the moment the user remembered the school run. Note this
reverses the order shipped earlier the same day, which had hours first on the
grounds that they are the more fundamental input. Both are true; the ordering
argument that wins is the one about which answer changes the other.

*They are no longer a sequence.* Two questions with a Next button is a wizard,
and a wizard for two questions is ceremony. `StageCarousel` moves between them
in either direction, and `Start the day` finishes from whichever one is on
screen. The consequence worth knowing: **the drafts moved up into
`DaySetupPanel`**, because it is the component that stays mounted across the
switch. Putting them in the two panels would lose whatever was typed the moment
you changed your mind about which question to answer first, and there is an e2e
test holding that shut.

The same strip stays on screen for the rest of the day as an indicator, which is
why it names the session phases too. It deliberately cannot navigate to them.
Being able to click past "One thing" would skip naming the block, and naming the
block is the entire product. The dots carry `aria-label` and `title` and no text
content at all — visually-hidden labels would collide with the timer's own
words, since "Break" is both a stage and what the timer says during one, and
that would make every text query on the stage ambiguous.

*Two follow-ups from review, both about state that outlived the thing it
described.*

Saving the calendar's hours editor **without editing anything** used to write
the draft back regardless, which stamped a per-day override that changed not one
minute of the day — and silently detached it from the recurring shape, so a
later edit to the default in settings no longer reached it. The setup panel
already guarded against this and the composer did not, which is the giveaway:
one rule, two implementations. There is now one, `hoursToSave`, and it returns
`null` for an untouched draft. Both e2e halves are covered — an unchanged save
must still follow the default, and a real edit must still override.

**Day-specific UI state is reset by the session's `generation`.** Three rounds of
review on one bug, and the first two fixes were aimed at signals that only
correlated with it.

`setupStage` — which of the two opening questions is on screen — **survived the
midnight reset**. The store resets `phase` in `checkDayRollover` and clears the
day's answers, but that state lives in `App`, so a tab left open overnight
reopened on whichever question was last looked at rather than on commitments,
which is the whole point of the order. It is adjusted during render against the
previous `dayShaped`, the way `MinutesField` does it, rather than in an effect
that would paint yesterday's question for a frame first. The general lesson is
worth more than the fix: anything that mirrors "where the user is in the day"
has to be reset by the day reset, and the reset lives in the store while some of
that state does not.

It took three rounds of review to get this right, and the first two answers were
both *signals inferred from symptoms*. Worth recording the failures, because the
shape of them is the lesson.

Attempt one watched `shapedAt` going from set to null. Wrong in the case that
matters most: a day nobody answered rolls over with `shapedAt` null on *both*
sides, so the flag never moves. Attempt two watched `dayKey`, which fixed that
and also caught the larger version of the same bug — **the calendar's composers
hold day-specific drafts too**, seeded at mount, and nothing closed them at the
rollover. An hours draft edited at 23:59 could be saved at 00:01 onto a day it
was never about; the break and commitment composers resolve their wall-clock
times against whatever `now` is when you press the button, so they would have
booked yesterday's plan into today. But `dayKey` does not move when an import
lands on the *same* day, so a same-day import into an unanswered day still left
the old drafts on screen.

Three attempts, three different cases missed, all for the same reason: the UI
was trying to deduce "the session was replaced" from things that merely
correlate with it. So the store says it outright. **`generation` is a counter
bumped at the two places that replace the session** — the midnight reset and an
import — and nothing else. There is no fourth signal to go looking for, because
this one is the fact rather than a shadow of it.

Two mechanisms hang off it. `App` resets its own day-specific state when the
generation moves (which opening question is showing, which calendar editor is
expanded — closing that one unmounts all three composers and takes their drafts
with them). And `Stage` is **keyed** by it, which re-seeds every draft its
panels hold: the setup panel's two forms, the purpose being typed, the break
length chosen. Remounting is safe there precisely because neither discontinuity
can happen mid-segment — `checkDayRollover` returns early while something is
running, and an import lands idle — so there is no timer in that subtree to
interrupt.

**The other half is that an untouched draft should not exist at all.** A seeded
copy of the day's hours is a photograph, and the day can change underneath it
without any discontinuity: edit the recurring shape in settings while the
opening question is open, and the panel keeps showing the old one — then saves
it back as an override, silently undoing the edit. `useHoursDraft` holds `null`
until the user actually types, and `null` renders whatever the day currently
says, re-read every render. Only a draft someone is in the middle of typing is
held, and that one is deliberately *not* disturbed by a settings change; it is
cleared by the generation, like everything else.

Both halves have e2e coverage, including the control cases — an edited draft
must survive a settings change, and a real edit must still override the day.

The rule, generalised: **if a piece of state describes the current session,
something has to notice when that session is replaced — and it should be told,
not left to infer it.** For the store that is `day/reset`; for React state it is
`generation`, compared during render or used as a `key`; and state that can be
derived from the store on every render is better than state that has to be
reset at all.

While in there: `Start the day` is disabled when the draft resolves to no
working hours at all, which is correct — Mono plans inside them and nowhere
else — but it said nothing about why, on a panel where the hours are behind the
other question. It explains itself now.

*Commitments gained `prepMin` and `recoverMin`.* A four o'clock swim is an hour
in the pool and two hours out of the day: getting changed and getting there
beforehand, getting back afterwards. Mono knew about the hour and offered a deep
block at twenty to four.

Three decisions inside that one. The blocked interval is `commitmentSpan`, and
it is what `busy` and the still-ahead-of-us filter both use, so the planner
needed no other change — but the **timeline entry for the commitment keeps the
commitment's own length**, with the margins emitted as their own
`commitment-margin` entries. Merging them into one long entry would have been
less code and would say the user is in the meeting while they are in the car.
And both fields are **optional**, because logs written before today do not have
them and `onRehydrateStorage` replays events raw, without going through the
import sanitiser — so the `?? 0` has to live somewhere every reader passes,
which is `commitmentSpan`. `sanitiseMarginMinutes` returns three values rather
than two for the same reason: absent is normal, present-and-broken is not, and
zero is a perfectly good answer where a zero-length commitment would not be.

**2026-08-22 (later) — The opening questions stop being a one-way door.**

*They can be re-opened, and the strip is how.* Shaping the day used to close
them for good: `day/shaped` flipped the panel out of existence and the two dots
went inert with it. There is nothing behind that. What is already fixed today
and which hours are yours are ordinary facts about a day, and they keep
changing — a four o'clock meeting lands at eleven, an evening opens up. The
gate that matters is the one after "One thing", and it is untouched: naming the
block is the product, so the strip still refuses to skip ahead, and while a
block is running it offers nothing at all. `setupReachable` is `phase.name ===
'idle'`, which is a stronger rule than "not yet shaped" and a weaker one than
"never again".

The state that carries it is `revisitingSetup`, in `App` beside `setupStage`,
and it is deliberately *not* an event. `day/shaped` records having been asked,
once; coming back to change an answer is not being asked a second time, so
`finishSetup` appends nothing when the day is already shaped and the panel says
`Back to the day` rather than `Start the day`. It is day-specific UI state, so
it is reset by the session `generation` like everything else up there — see the
rule at the end of the previous entry.

One consequence worth stating: `Start the day` is disabled with no working
hours because a day Mono cannot plan in is not a finished answer, but on the
way *back* that guard is dropped. Deleting every stretch at two in the
afternoon is a decision, not an unfinished form, and the calendar's own hours
editor has always allowed exactly that. Trapping someone behind a disabled
button on a day they have already started would be the worse bug.

*One editor of today's hours, ever.* The stage's hours question and the
calendar's `Hours` composer ask the identical question and each holds its own
draft, so both open at once is a race with a human in it: type in one, type in
the other, and whichever you save second silently overwrites the first, with no
sign that anything was lost. Settings has followed the "only one of it" rule
since it started closing the composer on open; the opening question was simply
never included, and it could always be on screen at the same time — this change
only made it likelier. Now it is symmetric. Going to the question on the stage
closes the composer; opening the composer takes the question off the stage —
back to the day when it was re-opened, and to the *other* opening question when
the day is not shaped yet and the panel cannot close. Both directions have e2e
coverage.

The commitment forms deliberately do not get the same treatment. Two of them
can be on screen and it is not the same situation: they append, they do not
overwrite, so the worst case is two commitments where you wanted two
commitments. The rule is about editors of a single value, not about duplicate
affordances.

*The strip reads at a glance now.* The dots were `bg-muted` for the navigable
ones and `bg-line` for the rest, which is a hairline colour on a near-black
surface — invisible in daylight, and the indicator half of the strip only works
if you can see it. They are `body/85` and `muted/80` at 7px, with the seam
between setup and session at `muted/50`. The odd number is deliberate: 8px read
as a row of buttons under the timer, which is exactly what the strip must not
become. It is the second-quietest thing on the stage, and only the companion is
allowed to be quieter.

And the names come off `title`. The browser's tooltip waits about a second
before it appears, which is far too slow for a strip whose whole design is that
you hover it to read it. The replacement is the `stage-dot` utility in
`index.css`: `content: attr(data-label)` on an `::after`, shown on hover and on
`:focus-visible`. The pseudo-element is the point rather than an implementation
detail — the previous entry records why these dots carry no text content at
all, and a real element containing the word "Break" would put a second answer
in front of every text query on the stage. `attr()` content is visible to the
eye and absent from the DOM, which is the only arrangement that satisfies both
constraints.


**2026-08-22 (later still) — Breaks and commitments can be edited, not just
added and deleted.**

*Editing is a patch on the same id, never a delete followed by an add.* The
event log already had `commitment/updated` sitting unused; `break/updated` is
its twin, and both merge a patch into the entry with that id. Remove-then-add
would have been two lines of store code and wrong in three ways: the id changes,
so the timeline entry drawn from it gets a new React key and the block visibly
blinks out and back rather than moving; the log stops being able to say that a
meeting *moved*, which is the fact a history view would want; and there is an
instant between the two events where the day is derived without it. A patch has
none of that, and `replay` over an old log is untouched — an event type that did
not exist yesterday cannot appear in yesterday's log, so `SCHEMA_VERSION` stays
where it is.

*A merged patch has one trap, and it is the margins.* `readCommitment` omits a
zero `prepMin` deliberately — the previous entry explains why a commitment with
no travel should look exactly like one written before margins existed. Merge
that result onto an existing commitment and deleting a half hour of travel does
nothing at all: the field is absent from the patch, so the old value survives,
and the form insists it is gone while the planner keeps the time clear.
`readCommitmentEdit` is the same read with `{ prepMin: 0, recoverMin: 0 }`
spread underneath it, and the difference between the two functions is the whole
reason there are two.

*The composer knows an id, not a commitment.* `Composer` went from a bare
`'hours' | 'break' | 'commitment'` to that plus which entry is being edited, and
the entry is carried as an id that `DayCalendar` looks up against the store on
every render. A copy taken when the form opened would be a second answer to what
that commitment is, diverging from the first the moment anything else touched
it. The lookup also has to go to the store rather than to the timeline entry
that was clicked: the planner clips a pinned break that is already under way to
what is *left* of it, so a form seeded from the entry would silently shorten the
break it claimed to be editing. Both halves — the form's contents and what
saving it does — read that one lookup, so an id pointing at something no longer
on the day is simply a new one rather than a save into nowhere.

*A named control, not a clickable block.* The block was briefly the button, on
the reasoning that clicking the drawing of a thing to change it is what every
calendar teaches. It is also what makes the axis unusable as a picture: the
calendar is a thing you point at while you think about your afternoon, and a
bare surface that silently means "open a form" is an affordance you discover by
accident. So the `✎` sits beside the `×`, both hidden until the pointer or the
keyboard arrives — and the pencil is mirrored in CSS, because every pencil
Unicode has points to the lower right (U+270E is *named* LOWER RIGHT PENCIL)
and the one that points the other way, U+1F589, is missing from enough system
fonts to render as an empty box. `EditGlyph` in `ui.tsx` is where that lives,
as a component rather than a character typed twice, because the guide quotes
this control and the calendar draws it — `group-hover` and `group-focus-within` together, because the
keyboard route has to reveal them too. They are siblings rather than nested, for
the ordinary reason that a button inside a button is invalid markup that
browsers resolve differently from one another. Blocks shorter than
`LABEL_MIN_PX` carry neither, which was already true of the `×`: at twenty
pixels there is room for the label or the controls, and the label is the one
that says what you would be changing.

*Only the two things you wrote.* A commitment's prep and recovery margins open
the commitment, because they are part of it rather than entries in their own
right — and whether they are still worth opening is asked of the whole span, so
the getting-ready half stays live while the meeting it belongs to is still
ahead. Focus blocks and margins open nothing. They are the output of
`derivePlan`, and an edit to the output of a pure function has nowhere to be
stored; the way to move a block is to change the hours or the commitments it was
planned around, which is the first invariant restated as an interaction.

*Editing a commitment clears pinned breaks, exactly as adding one does.* A
meeting pushed an hour later takes the runway with it, so the rest points either
side of it were answers to a question that is no longer being asked. The
composer says so in the same sentence it always did, with one word changed.
Removing the entry an editor is open on closes that editor, in `DayCalendar`
rather than `App`: the `✎` and the `×` are two halves of one gesture — you
opened it to decide, and "it should not be there at all" is one of the answers.

**2026-08-23 — Two things a pinned break should survive, and one that was never
wrong.**

*Taking a break stopped deleting the rest of them.* `break/ended` shared
`onlyBreakInProgress` with the commitment events, and that filter keeps only a
break actually under way — so ending an ad-hoc break at three deleted the walk
pinned for five, silently, and the comment beside the call said it dropped "any
pinned break it was fulfilling", which is what it was meant to do and not what
it did. The filter is right where it is used for commitments: adding or moving
one moves the whole runway, every pin on it is an answer to a question that has
changed, and the composer says so before you add one. Taking a break is not
that. `pinsStillAhead` keeps every pin with time left in it when the break
ended: a break run to the end of the pin it fulfilled spends it, spent pins are
tidied away as before, and the rest of the day is left alone. Ending a break
early leaves the remainder of that reservation standing, which is what the old
filter did too.

The filter is deliberately a **superset** of the one it replaced, and the first
version was not — it kept pins *starting* after the break, which quietly changed
a second case nobody asked about: fifteen minutes taken inside a two-hour
reservation dropped the whole reservation, where `onlyBreakInProgress` had kept
it. Measuring the change against "which pins used to survive?" is what caught
it, and it is the right question for any filter that deletes user intent — a fix
that removes something *else* is not a fix. Locked by `leaves what is left of a
longer pin it happened inside`.

Worth noting what is *not* affected: the break you actually took is history the
moment it ends, and the calendar draws every history segment, so an ad-hoc
break is on the timeline after the fact at the length it really ran. The pins
are a different object — a future intention — which is why deleting them was so
quiet.

*An open calendar editor closes when "You were away" arrives.* `stageFor`
returns `null` for `reconciling` and the strip hides itself, because that panel
is an interruption rather than a stage and nothing is recorded until it is
answered. The calendar's composers were the one part of the UI not following
that rule, and an expanded editor beside that prompt is somewhere else for the
answering click to land. `App` closes it on the *transition* into the phase,
not on the phase itself: the latter would shut a composer the user deliberately
opened during one, half a frame after they pressed the button, and the header
toggles would look broken. Same render-time adjustment as the `generation`
reset above it.

*The narrow-screen worry was wrong, and the real one is different.* The claim
was that below `lg` the calendar stacks under the stage, so an editor opened
from the stage expands off the bottom of the screen — and the fix would be to
scroll the column into view. It was written and then measured, which is the
right order to find out it does nothing: the shell is `h-dvh`, so the grid
divides that height between the two panels rather than letting the page grow.
At 390×844 the calendar sits at y=481 with the composer fully visible. There is
no scroll to do, because nothing scrolls.

What measuring *did* find is a real defect at short viewports, which is a
different bug: the column is squeezed rather than pushed. At 640×420 — a phone
in landscape — the calendar column is 119px tall, the composer is `shrink-0`,
and its time fields render below the fold of a page that cannot scroll. Not
fixed here, because the fix is a layout call rather than a patch: either the
page scrolls below `lg` (`min-h-dvh lg:h-dvh`, at which point the calendar
becomes full-length on a phone and scrolling *into view* finally means
something), or the composer gets to shrink and scroll inside the column. Both
change how Mono looks on a phone, so both want deciding rather than defaulting.

**2026-08-23 (later) — A finished commitment stays on the axis.**

One filter was doing two jobs. `upcomingCommitments` decided what shapes the
plan *and* what gets drawn, so a meeting disappeared off the calendar the
instant its last minute — its recovery margin included — passed. The comment
next to it said the ones behind us are "history's business", which sounded
right and was not: `history` is blocks, breaks and away stretches, a commitment
never becomes one of those, and so nothing else was ever going to draw it. The
day drew every block you ran and every break you took, and silently dropped the
two hours you spent in a meeting — the very thing the blocks either side of it
were arranged around.

Now every commitment is drawn and only the upcoming ones enter `busy`. The two
lists say different things and there is no reason for them to be the same list.
Note the filter on `busy` is, strictly, unnecessary — free stretches begin at
`planFrom` and `subtractIntervals` skips anything ending before its cursor, so
a past span could go in harmlessly. It is kept because "only what is ahead of
us shapes the plan" is a rule worth being able to read in the code rather than
deduce from an interaction two functions away.

Nothing in the UI needed changing, which is the tell that this was a bug rather
than a missing feature: `Block` already dims an entry whose `endsAt` has passed,
already hides `×` on one, and `editorFor` already refuses an editor once
`commitmentSpan(...).end <= now`. All three were written for a case the planner
never produced. The test that had locked the old behaviour — `ignores
commitments that are already over` — was itself the bug, written from the
planner's point of view rather than the calendar's, and now reads
`plans past commitments as though they were not there — but draws them`.

**2026-08-23 (later still) — Commitments stop clearing the whole afternoon, and
an orphaned editor closes.**

*The blunt rule was reversed on its own evidence.* `commitment/added` and
`commitment/updated` deleted every pinned break still to come. The argument for
it is in the entry above and it is a good one as far as it goes: a commitment
moves the walls of the runway, so a pin placed against the old shape is an
answer to a question that has changed. What that argument does not survive is
an example — add a nine o'clock standup and the walk you pinned for four
disappears, having nothing whatever to do with the standup.

`pinsClearOf` drops only the pins that overlap the commitment's span, margins
included. That is the case where deletion is the *only* honest outcome: the
planner merges an overlapping pin into one busy interval with the commitment,
so keeping it would draw rest as part of the meeting and give it to nobody.
Everywhere else, the day changing shape under a break you can still take is a
reason to let you move it, not to move it for you by deleting it. Same shape as
the `break/ended` fix earlier today, same reasoning, and it makes three filters
in `events.ts` that all now say "drop what genuinely cannot stand, keep the
rest".

For an edit it measures against where the meeting *ends up*, not where it was:
that is the shape the day now has, and a pin in the slot it just vacated is
honourable again. `commitment/updated` therefore has to merge the patch before
it can ask, which is also why an id that is not there now returns early — it
changes nothing, so it clears nothing.

`onlyBreakInProgress` is gone, having had both callers taken off it.

*An editor whose subject vanished now closes.* `DayCalendar` already did this
for the `×`; the same thing arriving from elsewhere — the pin spent by a break
ending, or cleared by a commitment that covers it — left the composer open,
where it silently became an *add* form: same fields, same values, different
meaning, and the header toggle still reading unpressed. Now `orphaned` closes
it. It has to be an effect rather than a check during render, because the state
belongs to `App` and a child may not set a parent's state while rendering.

Worth saying what was rejected. Keeping the form alive and re-labelling it
("this break was cleared — save to pin it again") preserves what was typed and
was tempting, but it needs the composer to explain a state it cannot see the
cause of, and the fix above makes that state rare enough not to be worth a
paragraph of UI. And *preventing* the clear while an editor is open was never
on: the store would have to know what the calendar has expanded, which is the
layering this app is built to avoid.

**2026-09-03 — The pin-and-commitment rule is kept from both ends.**

The entry above made `pinsClearOf` drop only the pins a commitment lands on top
of, which was right, and left the rule half built. Nothing stopped the pin
arriving second. `+ Break` at ten past five against a five o'clock meeting was
accepted, stored and drawn straight through the middle of it — the exact state
`pinsClearOf` exists to delete, reached by walking around it. The next touch of
that commitment then cleaned it up in silence: `commitment/updated` runs the
filter whatever the patch says, so *renaming* a meeting deleted a break.

`break/planned` and `break/updated` now refuse an event that would lay a pin
across a commitment span. The two filters together say something neither could
say alone: **no pinned break ever overlaps a commitment.** It holds under replay
in either order — pin first and the commitment clears it, meeting first and the
pin is refused — which is the point, because a log also arrives from an import,
and from a version of Mono written before either half of the rule existed.

Refused rather than stored and corrected, because there is nothing to correct it
to. A *move* is declined and the break stays where it was: aiming at a bad time
is a reason to decline the move and no reason at all to lose the break.

The visible half is `BreakComposer`, which now takes today's commitments and
says *That runs into Daily standup* with the button disabled. The rule belongs
in the reducer, where an imported log meets it too; the explanation belongs in
the form, where the person choosing a time is. A refusal the user has to infer
from a form that closed and did nothing is not an answer. `breakSpan` and
`overlaps` moved to `types.ts` so the reducer, the planner and the composer all
ask the question the same way — `toBreakInterval` in the planner was the same
function under another name, and is gone.

One casualty worth naming. The test *measures against where the meeting ends up,
not where it was* used to prove that moving a meeting off a pin inside it
brought that pin back. There is no such pin to bring back any more, so the test
now proves the same thing from the only direction still reachable: a break clear
of the swim at four, swallowed by it at two. The sentence in the entry above
about a vacated slot being "honourable again" describes a case that can no
longer be built.

*An orphaned editor closes once rather than three times.* `DayCalendar` had a
close beside the ×, and nothing beside the other two ways an editor's subject
can vanish — which is how that bug got in. `orphaned` asks about the state, the
lookup having failed, rather than about the gesture that caused it, and the ×
closes nothing itself now. `useLayoutEffect` rather than `useEffect`: the
composers are keyed on what they are editing, so a passive effect lets through
one painted frame of the form remounted empty as an *add*, which is precisely
the thing being prevented.
