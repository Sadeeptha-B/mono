# Decisions

What this file is: the reasoning that is **not recoverable from the source**.
Calls that were made deliberately, several after being built the other way; and
traps that have already cost someone an afternoon.

What this file is not: a current description of the codebase. Local facts belong
beside their code and stable cross-file operating contracts belong in a focused
document such as `extension.md`. Nothing here should state a fact a command
could answer — no test counts, file inventories, or line totals. Those rot
within a week and then actively mislead.

Append to the log at the bottom rather than editing entries above. Earlier
entries can describe implementations that later entries replaced, so never use
one isolated entry as the current specification. "Changed after being built the
other way" is useful precisely because the history accumulates.

For an ordinary change, read the settled decisions and traps that apply, then
search the log by subsystem or term. The full chronological log is historical
evidence, not required onboarding context.

---

## Where documentation goes

Each fact has one owner. Link to that owner instead of keeping parallel copies.

1. **The docblock of the file it is about.** Anything whose scope is one file:
   what it is for, why it is shaped this way, what breaks if you change it,
   what was tried here and rejected. This is the default and it takes most of
   the traffic. It cannot drift, because moving the code moves the explanation
   with it.
2. **A test.** Where the fact is checkable, prefer an assertion to a paragraph.
   `scene.test.ts` pinning the floor to `SPRITE_TOP + SPRITE_H` is a
   cross-module invariant that would otherwise be a sentence nobody reads until
   after they had broken it.
3. **A focused operational document.** A subsystem may get one when agents need
   a stable cross-file contract that source and tests cannot express compactly.
   It owns the current model, not a file inventory, test count, work log, or
   duplicate commentary. `extension.md` is the current example; most features
   do not need an equivalent.
4. **This file.** Historical reasoning, traps, rejected alternatives, and the
   dated log. It explains why policy changed; it does not restate current code.
5. **`README.md`.** What Mono is, how to run it, how the pieces fit together,
   what it cannot do. Orientation for a person arriving, not a specification:
   the in-app guide quotes live settings, which makes it the one description of
   behaviour that cannot disagree with the app.
6. **`CLAUDE.md`.** The repository map, global invariants, and routing pointers
   an agent must see before it knows where to look.

`manual-qa.md` separately owns checks that require real platform behavior, and
`requirements.md` preserves the original brief as history.

### Track documents are scaffolding, not artifacts

A change large enough to need a working surface should get one, in `docs/wip/`,
which is untracked. It may hold every kind of thing this file bans — file
inventories, test counts, a base commit, a verification table — because that is
exactly what it is for while the work is in flight.

It is normally **dissolved rather than merged**. Each durable paragraph moves to
its owning docblock, test, operational document, decision entry, or the bin. A
subsystem document may be promoted deliberately, but only after removing
volatile status, inventories, counts, and duplicated implementation detail. A
track document that simply survives its track becomes the thing `HANDOVER.md`
was: authoritative-looking, half rotted, and read in preference to the source
because it is longer.

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

### Rooms and ambience

| Decision | Why |
|---|---|
| Silent until asked, including for logs written before sound existed | An app that starts making noise because you updated it has spent trust it did not earn. A missing setting folds to `off`, so an old install is quiet and a room choice never implies a sound. |
| Sound is synthesised locally, never streamed or bundled | Brown, pink and rain are a few lines of Web Audio. A track would mean a file to ship or a host to depend on, and Mono would stop being a thing that works with the network off. |
| Preferences are persisted; progress is derived | `roomId`, `ambience` and `ambienceVolume` are a settings patch like any other. The scene tier, trail, milestones and postcard are projections of the same history the timeline is drawn from. Storing either of the latter would put a saved number beside the log it came from, and the day would eventually be told two ways. |
| The rooms are four curated palettes, not a colour picker | Every room has to keep twelve semantic tokens legible against pixel art at four growth tiers. That is a design decision each time, and it is checked by eye through `npm run companion`. An arbitrary colour is a promise the contact sheet cannot keep. |
| Room and sound live in a header menu, not in Settings | They are chosen by looking and listening, so the control belongs where the result is visible. Putting them in both places would have created a second copy to keep in step; they were never added to Settings, so there is nothing to reconcile. |
| The session mute is not an event | It resets on reload and never reaches the log. The log is the day's journal and how loud the room was is not part of what the day was — see `useAmbience.ts` for the boundary it does and does not govern. |
| The companion's growth is the same history, told as a room | Tiers at one, three and six completed blocks, and a trail that keeps the order things happened in. It is not a score: nothing is spent, nothing carries to tomorrow, and an abandoned block adds an honest gap rather than taking a mark away. |
| The focus tap is a tour, not a reward | Tapping during a block steps through how the room *can* grow and then puts it back. It writes no event and unlocks nothing, which is what keeps it from becoming a reason to tap instead of work. |

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

**A room id lives in four places and only three of them fail loudly.**
`RoomId` in `domain/types.ts`, `ROOMS` in `ambient/rooms.ts`, the twelve tokens
in `index.css`, and a hardcoded id list in `sanitiseSettingsPatch`. The first
three are caught by the compiler or by the test that parses the stylesheet
against the palette metadata. The fourth is not: an id the sanitiser does not
recognise makes an imported settings event look malformed, so the whole patch is
dropped and the user lands silently back on Mono. The playbook at the top of
`rooms.ts` lists all four for this reason.

**The palette duplication between `rooms.ts` and `index.css` is deliberate.**
JavaScript needs the values for swatches, the PiP fallback and the Node contact
sheet; Tailwind needs literal custom properties in a stylesheet. Neither can be
generated from the other at the point it is needed, so they are kept honest by a
test that parses the authored CSS and requires every room block to equal its
metadata. Change one and the test will tell you about the other.

**The focus-tap preview can show a *lower* tier than the day has earned.**
Tapping during a block starts one tier past the factual one and wraps from three
back to one, so a tier-3 afternoon briefly displays a tier-1 room and fewer cat
markings. This looks exactly like a bug and is not one: the tap is a tour of how
the room grows, the state belongs to `PixelCat` rather than to the projection,
and it expires back to the truth. Anything that "fixes" it by clamping to the
earned tier removes the point of the interaction on the days most likely to use
it.

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
- **No light theme, and no custom room colours.** See the rooms decision above.
- **No external audio.** No Spotify, no Apple Music, no downloadable tracks, no
  streamed anything. Ambience is synthesised or it does not exist.
- **No points, levels, currencies, unlock checklists or room collections.** The
  room grows within a day and starts again tomorrow. Anything that accumulated
  across days would make the pressure to keep it the reason to use the app.
- **No global streaks.** The streak inside a day is a fact about the day. A
  streak across days is a debt.
- **No shareable or downloadable postcard.** It is a card at the end of your own
  day, not something to publish.
- **No analytics, and no accounts.** Unchanged since the first line of this file.
- **No second always-on-top window.** Document picture-in-picture gives one per
  document and no way to place it; the feature is designed around that rather
  than against it.
- **No blocking outside a running block.** The extension arms while a block runs
  and at no other time. An always-on focus mode is a different product, and it
  would destroy the thing that makes taking a break a visible trade.
- **No shipped blocklist.** No categories, no curated set of "distracting"
  sites. That is a judgement about someone's life that Mono has not earned, and
  it would be wrong for anyone whose work happens on one of them.
- **No keyword or content blocking.** It would have to read the page, which
  needs host permissions, which puts the extension in a permission class a focus
  timer has no business being in.
- **No plan derivation in the extension.** It is handed a conclusion with an
  expiry, never the inputs. Two processes running `derivePlan` are two schedules
  that can disagree.
- **No UI in Mono for the extension.** The app publishes an intent and never
  learns whether anything heard it. The same reasoning as the pop-out button
  rendering nothing where the API is absent, one step further along: here there
  is not even a capability to detect.
- **No browsing data in the event log**, if and when tracking is built. The log
  is the day's journal of decisions the user made, and where you went is
  observed rather than decided — the same boundary the session mute sits on.

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

**2026-09-03 — The opening question stops talking to itself.**

Three complaints, one shape between them: the day's first questions held
answers the rest of the app could not see.

*Today's hours are previewed rather than hidden.* The hours draft lived in
`DaySetupPanel`, and the calendar — eighteen inches of the screen given over to
drawing exactly what those hours mean — heard nothing about it until `Start the
day`. You declared an evening stretch and the evening stayed empty. The draft
now lives in `App` and is passed to `derivePlan` as the day's regions, so the
timeline is redrawn from it on the keystroke. That is not a special case bolted
on: the plan is a pure function of its input, so asking what an unsaved answer
would mean is a *call*, and the answer is discarded by not calling again. There
is still exactly one write, at `finishSetup`, still through `hoursToSave`, so an
untouched draft still never stamps a per-day override.

Lifting it out of the panel cost three resets, and each one is a bug that would
otherwise be reported later. The session `generation` no longer clears it by
remounting — the panel is keyed on it, `App` is not — so it is cleared by hand
beside the other discontinuity state; hours typed at 23:59 must not preview onto
the new day. Opening the calendar's `Hours` composer clears it too, and now does
so whichever question is on screen. That last one is a race that predates the
preview: the panel kept its hours draft while sitting on the *commitments*
question, so the composer could save four o'clock and a later `Start the day`
would write ten o'clock over it. It was invisible before and would have been
lurid afterwards, with the timeline drawing the loser.

*The fold on the time either side goes both ways, and closing it clears the
numbers.* One-way was an oversight, but hiding-without-clearing would have been
worse than the oversight. A margin shapes the plan whether or not its field is
on screen: a fold that merely hid half an hour of travel would leave Mono
holding 3:30 to 4:00 clear with nothing on the form to say why. So folding it
away *means* "this costs nothing either side" — which is also the only reading
under which the row's `1h 00m + 50m around` stays true. The same rule the other
way round is why `readCommitmentEdit` exists.

*The commitment list is sorted by time and carries a `✎`.* It was in insertion
order, which is the order you happened to remember things in — a 9am standup
named after a 4pm swim sat below it. Sorting is done in the view, not in the
log: the order commitments were written down in is a fact about the log and
nothing to do with how the day reads. The row's `✎` seeds the panel's own form
from the commitment and turns `Add` into `Save`, holding an id rather than a
copy for the reason the calendar's composers do — the list re-renders every
second — and clearing itself during render when that id stops resolving, which
is `DayCalendar`'s `orphaned` rule at a smaller scale. Reordering by hand was
considered and rejected: these things are pinned to a clock, so a list order the
user could drag would be a second, disagreeing answer to when the day happens.

**2026-09-03 — One breakpoint decides who scrolls.**

The two panels were both pinned to the viewport with a scroller inside them.
That is right beside each other and wrong stacked: on a phone the stage and the
calendar became two short boxes, each with its own scrollbar, inside a page that
did not move — three scroll surfaces where a phone offers one gesture, and the
calendar's share of the screen was a few hours of a nine hour day.

So the pinning is now a `lg:` decision and nothing else is. Above the
breakpoint — where the columns are side by side, which is the same breakpoint
the grid already used — everything is exactly as it was: `h-dvh`, `min-h-0`,
`overflow-y-auto`, the timer staying put while the day scrolls beside it. Below
it, none of those apply: both panels are as tall as what they hold and the
document scrolls. `App`, `DayCalendar` and `GuidePage` each carry the same
split, and that is the whole of the change — there is no mobile layout, only the
absence of a pin.

Two things fell out of it worth naming. The calendar's scroll-to-now on mount
needed no branch: an element that does not overflow ignores `scrollTop`, and
opening at the top of the page — where the stage is — is the right answer on a
phone anyway. The guide's header did need one: pinned it never moved, and
stacked it would have scrolled away with the timer it carries, so it is
`sticky top-0` below `lg` and static above, with the sections' `scroll-mt`
raised to clear it when the contents list jumps to one.

The clock and the companion were within a few pixels of not fitting on a 360px
line, and both give ground rather than one of them wrapping under the other.
The commitment row gave up trying to fit on one line at all: the cost moved
under the title, because on one line they compete for the same pixels and the
title is the half that was losing — `4:00 PM  S…  1h 00m + 50m around` names the
wrong thing about a commitment.

Not done, and deliberately. `HOUR_PX` stays at 96 on every screen: a shorter
hour would fit more of the day on a phone, but a 45-minute block looking like 45
minutes is the reason the calendar is drawn against an axis at all, and the
empty morning above `now` is the day, not padding. The settings dialog keeps its
own scroller, because a dialog sized to the viewport is what a dialog is.

**2026-09-03 — The hours row asks its container, not the viewport.**

Settings on a 360px phone read `09:00 A` / `06:00 PI`. A `time` input draws its
own text and its own icon, so below about 123px at this padding Chrome clips it
— no wrap, no ellipsis, nothing in the DOM to notice. The fields were shrinking
past that because the row hands them `flex-1 min-w-0`, which is what stops the
fieldset overflowing its column and is therefore not the thing to remove.

The fix is a container query rather than a breakpoint, and that is the whole
point of the entry. `RegionShapeEditor` appears on three surfaces that are
different widths at the *same* viewport: a 30rem dialog capped by the screen, a
22rem calendar column, and whatever the stage leaves. A `sm:` rule would tighten
the row on a phone and leave the dialog on a desktop — one of the two that
actually overflows — untouched. What matters is how much room this fieldset has,
so `@container` is what it asks.

Two steps. Below `@xs` the row trims: the word "to" goes (both fields carry
their own label, and two clock fields side by side already read as a range), the
gaps and the × close up, and the fields' own padding comes in — which lowers the
clipping floor as well as raising the room. That is enough at 360. Below `@2xs`
— settings on a 320px screen — trimming has run out, so the pair stops being a
row: the two fields stack and the × stays beside them, centred on the pair. The
wrapper div that makes that possible is the only markup this cost.

The dialog's own padding steps down on a narrow screen too, for the same reason
the page's does, and it is worth eight of the pixels above.

The regression test is arithmetic, because there is nothing else to assert on: it
measures what a `time` input needs at this font, then checks what settings and
the opening question actually give one, at 320, 360 and 768.

**2026-09-03 — The guide is ten sections, and the two-minute version is not one
of them.**

Nothing was wrong with the prose. The shape was wrong. *Give the day a shape*
had grown to 826 words — a third of the page, four times the next longest
section — because everything that arrived over six months arrived there: the
opening questions, working hours, commitments, margins, how to read the axis,
how to edit what is on it, and a digression about breaks the reader had not been
introduced to yet. A heading that promises one subject and delivers seven is not
a long section, it is two sections that never separated.

So it split. *Give the day a shape* keeps the day's own questions and what they
mean; *Reading the calendar* takes the axis, its two controls and its three
in-place editors. And a new *Two panels, one day* goes in front of both, because
the guide talked about "the timer" and "the calendar" for two thousand words
without ever saying that Mono is two panels — obvious from the app, invisible
from the page, and the sort of thing only a first-time reader notices.

The two-minute version moved out of section one and above the contents list. The
code comment beside it already said it was the most important paragraph for
someone arriving cold, which was an argument against it being four paragraphs
down. A reader who stops there has still been told how to use Mono; the sections
under it are a reference, one subject each.

Four facts were being told twice, and each is now told where it is needed:

- Editing hours changes today only, which was the last sentence of two adjacent
  paragraphs. The live-preview paragraph — added the same day and the cause of
  it — no longer restates it.
- The ✎ and × convention, explained three times. It is defined once, on the
  commitment list, which is where a reader meets it first, and the calendar
  section refers back to it — *the same pair, because they are the same two
  things: what you wrote down*.
- The rule that a pinned break and a meeting never share a minute, told at
  length under *Give the day a shape* and again under *Breaks*. It lives with
  breaks now, where a reader who is choosing an hour actually is.
- *Breaks are never planned for you*, which was a paragraph in *How the plan
  gets made* and the unstated premise of the section that prices them. It is now
  the first line of that section, where it does some work.

The page is about the same length. That was never the complaint.

**2026-09-03 — The fold is derived from the draft, not seeded from it.**

Review caught the `✎` on the opening question's commitment list carrying the bug
the two-way fold was built to prevent. `CommitmentFields` seeded "are the
margins showing?" from the draft once, with `useState`, and a seed runs once per
*mount*. The calendar's composer mounts per commitment — it is keyed on what it
is editing, which is what makes seeding safe there. The opening question's
fieldset does not, deliberately: its draft lives in the panel above so that it
survives the switch between the day's two questions.

So a form first opened on a new commitment sat collapsed, and pointing it at a
4pm swim with half an hour of travel kept that half hour hidden — inside a fold
whose whole meaning is "this costs nothing either side", with the thirty minutes
still keeping 3:30 clear on the calendar beside it. You could then rename the
swim and save, having been shown a form that disagreed with the plan.

Whether the pair is on screen is now a function of the draft: shown if either
margin is non-zero, or if the user asked for them over a draft that has none.
The `useState` that is left holds only that second case. It makes the rule
symmetrical with the one that was already there — closing the fold clears the
numbers, and a margin that exists opens it — and the two together say the thing
worth saying: *the fold and the plan can never disagree.* That is a property of
the state now rather than of who remembers to remount what.

The regression test opens the form fresh over an existing commitment — a
reload, which is the state that made the bug reachable — and was checked against
the old code before being kept: it fails on the seeded version at the line the
review pointed at.

**2026-09-03 — A region no longer holds the axis open over an empty morning.**

Reported as the timeline's entries not showing on a small screen, and they were
all there — correctly sized, correctly placed, six of them. What was not there
was any reason to scroll far enough to see them. `layout` took the top of the
axis from the earliest of `now`, the entries *and the work regions*, so a
nine-to-six day opened at two o'clock began the grid at nine: five hours of
ruled, empty rows above everything worth looking at.

Beside the stage that was invisible, because the column scrolls itself to `now`
on mount and nobody ever saw the padding it was scrolling past. Stacked under
the stage on a phone, where nothing scrolls itself and should not, it was the
entire first screenful of calendar — a heading that says Today over an empty
grid, for a day that is in fact full. The responsive change did not cause this;
it removed the thing that was hiding it.

So the range is held open by `now` and by entries, and not by regions. Only
genuinely empty hours go: a block banked this morning, a meeting already sat
through, a break taken, are all entries, and they reach back as far as they
need to. The region *starts* were in that calculation for a reason — without
them a morning band rendered at a negative offset — and that reason is now
handled where it belongs, by clipping each band to the hours actually on the
axis. Clipped rather than dropped, because the afternoon of a nine-to-six region
is still the canvas the plan is painted on.

One test moved with it. *A wide screen keeps the two columns and scrolls inside
them* asserted the calendar column overflows, which a two o'clock day no longer
does now that it is four hours instead of nine — the fix working, not the rule
changing. It opens at nine now, so the day is taller than the column and the
rule is what is being measured.

**2026-09-03 — The commitment form folds away once the day has something in it.**

The first question is a list with a form under it, and the form was always
there. Once anything is fixed, the answer to *what's already fixed today?* is
the list — four fields under it are the *next* answer, asked before the first
one has been read, and on a phone they were most of the panel. So arriving at
the question now shows what is there and offers `+ Another commitment`.

Three ways it opens, and only the first is the flag: the user asked for it,
something is being edited, or the list is empty. The last two are derived for
the reason the margins fold was derived a few hours earlier — a form pointed at
a commitment must be visible whatever the flag says, and a question whose list
has just been emptied must not collapse to a lone button over the space where
the answer was. Nothing has to notice the removal; `formOpen` simply reads
`inOrder.length === 0`.

Arriving is what resets it, not adding. Submitting leaves the form open and
cleared — the commonest thing after writing one of these down is writing
another, and folding it away under the hand that just used it charges a click
for the second — while coming back to the question from the other one, or from
the day, asks it fresh. (*Asks it fresh* was too broad as first written; the
entry below draws the line it was missing.) Opening it also re-seeds the time, because the panel can
sit on this question for hours and "the next round half hour" is a good default
at the moment you ask and a puzzle two hours later.

**2026-09-03 — The timeline is one calendar day; the log is still everything.**

Reported as the calendar showing other days' commitments and breaks, and as the
axis opening on an event from days ago — worse on a phone, where nothing scrolls
itself to now. The cause is one line that was never there: `derivePlan` turned
every segment in `history` into a `past` entry, and `history` is kept forever on
purpose. `day/reset` says so in as many words — *history survives forever, it is
the journal* — and that is right. The reset was not the bug. The drawing was.

`vitals` had the correct rule the whole time, and its comment even asserted the
half that was false: a segment belongs to the day it started, *"which is also
the day it is drawn on"*. It was not. So the predicate is now shared —
`onSameDay` in `time.ts`, one definition — and the cat and the calendar cannot
disagree about what today holds.

Commitments and pinned breaks are scoped by the same rule rather than a second
one, though `day/reset` already clears them. That matters in the window where
the reset has not run yet, and there are two: the first frame after a reload,
because the rollover runs from an effect and the first paint happens before it;
and the stretch where a block left running across midnight defers the rollover
on purpose. Both used to paint a multi-day axis for a frame or a minute — which
is exactly the reported "first load starts at the oldest event, a refresh scrolls
to now": the mount scroll measured itself against a range that then changed
under it. Scoped, the axis is right on the first paint and the scroll lands
where it should.

`active` is exempt and has to be: a block still running belongs on the axis
whatever day it was named on, and it is the only reason the rollover ever waits.

**On truncation, since it came up.** There is no cap on the event log and there
should not be one yet. A heavy day is a few kilobytes of JSON, so the browser's
usual five megabytes is years of daily use away, and the log is the one thing in
Mono that cannot be rebuilt from anything else. The risk worth writing down is
not the size, it is the failure mode — see the entry below, which corrects
this paragraph as first written. It said persist *swallows* a
`QuotaExceededError`. It does not.

**2026-09-03 — A refused write is caught, recorded and said out loud.**

The paragraph above, written earlier today, had the mechanism wrong, and the
truth is worse than what it claimed. Zustand's persist wraps the store like
this:

```js
api.setState = (state, replace) => { savedSetState(state, replace); return setItem() }
```

Nothing around the write. So a `QuotaExceededError` does not get swallowed — it
is thrown out of the *store action*, which means out of the click handler that
called it, with the memory update already applied. `finishSetup` would shape the
day and then never run the three lines after it: pressing `Start the day` would
answer the question and stay on it, with an error in the console and nothing on
screen to explain any of it. Silent would have been kinder.

`guardedStorage` now wraps all three storage calls. A refused write is caught,
so the gesture completes on a session that is correct in memory, and the refusal
is recorded in `useStorageHealth` — a store of its own, because recording a
failed save in the session store would attempt another save to record it.
Reading is wrapped too: a browser with site data blocked throws on `getItem`
before it ever gets to a write, and Mono should start empty rather than not
start.

Being recorded is not the point, though. Being *said* is. This is the one
failure in Mono worth interrupting for, because it is the only one that costs
something you cannot see on the screen, so the warning has a permanent place in
both headers until it clears, and it leads to Settings — where the explanation
sits against the Export button, which is the only thing that can rescue the day.
A success clears it: the whole log goes out on every save, so a write that lands
has caught up on everything the refused ones missed.

**2026-09-03 — The `.editorconfig` was inert, and it cost 700 lines of diff.**

Worth writing down because the symptom looked like a code review problem and was
not. `CommitmentFields.tsx` came back with 323 changed lines for a three-line
edit, and `SegmentEditor.tsx` with 407 for another three: an editor had
reindented both files from two spaces to four, in their entirety.

The cause was a `.editorconfig` containing exactly one line — `indent_size = 2`
— with no section header. EditorConfig properties belong to a section, and a
property before the first `[…]` belongs to nothing, so every implementation
ignores it. The file existed, said the right number, and had no effect at all;
the editor fell back to its own default of four.

Both files are restored from the committed version with the real edits
reapplied, and the config now has `root = true` and a `[*]` section that
actually applies. `end_of_line` is deliberately left out: the working copy is
CRLF, the repo is LF, `core.autocrlf` is what crosses between them, and naming an
ending here would fight it and churn every file on the next checkout.

The general form of this, for next time: when a diff is mostly whitespace,
`git diff -w --stat` beside `git diff --stat` says so immediately, and the gap
between the two numbers is the size of the problem.

**2026-09-03 — An edit nobody has changed is not an edit.**

Review, on the fold that arrives closed: `editing` survived the trip to the
other question, so coming back could reopen a form instead of showing the list.
True, and the entry above did say the question is asked fresh on arrival.

But the fix it suggested — clear `editing` on the way out — collides with this
panel's oldest rule, the one its docblock opens with: nothing typed is lost by
changing your mind about which question to answer first. Clearing an edit
somebody had begun to write loses work, silently, for a fold. Both rules are
right, and the line between them is not *whether* a form is open but whether
anybody has written in it:

- **Opened and left alone.** The ✎ seeds the form from the row. Walk away and
  the draft still says exactly what the commitment says, so there is nothing in
  it to lose and nothing to come back to. It folds away.
- **Opened and changed.** Now the draft and the commitment disagree, and the
  difference is the user's. It stays, on the row it belongs to, with the row
  still lit and the button still reading *Save commitment*.

`draftsMatch` is the whole of the distinction, and it lives beside
`draftFromCommitment` because that is the function it is comparing against.

The same reasoning found a second hole the review did not mention, in the
opposite direction. The fold can now close over a half-written *new*
commitment, and `openForm` re-seeded the draft on the way open — so typing
`Dentist`, glancing at the hours and coming back lost it to a fresh form. The
re-seed happens only over a draft with no title in it now. A stale default half
hour is worth refreshing; a commitment somebody had started to describe is not
worth overwriting to do it.

**2026-09-03 — Midnight is the wall, at both ends of the axis.**

The other half of the same review, and a real hole in *the timeline is one
calendar day*. The planner scopes by when a thing **starts**, which is the right
question to ask of a commitment and leaves the two ways a *span* can reach out
of the day it started in. A meeting at ten past midnight with half an hour of
getting ready begins at twenty to twelve the night before; `layout` takes the
top of the axis from the earliest entry start, so that one margin dragged the
whole grid back across the night. A late commitment with travel after it, or a
break pinned at ten to midnight, reaches the other way.

Neither is a thing to refuse. A flight at 00:10 really does need you moving at
23:40, and Mono's job is to hold the time, not to have opinions about the hour.
So the day simply stops where the day stops: `layout` clamps its range to
`dayBounds(now)` and clips each entry to what is left, the same treatment the
region bands already get.

The clipping is on the drawing and not on the entry, which is the part worth
keeping straight. `startsAt` and `endsAt` still say what the commitment really
is — the block's own label reads *Getting ready · 11:40 PM · 30m* while being
drawn from midnight — so the axis can be honest about the part it can show
without the timeline lying about the part it cannot. An entry with nothing
inside the day is not drawn at all, which is a box of no height rather than a
fact being withheld.

Lanes are still assigned on the real spans, before the clip. Two entries that
overlap only outside the visible day still get a column each, because they do
overlap; the alternative is a lane count that changes at midnight.

**2026-09-03 — A second window, which is not a second modal.**

Mono has spent three separate rounds taking overlay surfaces *out*: the break
prompt, the away prompt, and finally the calendar's own editors, all on one
argument — a decision about the day is unanswerable with the day covered up. So
opening a floating window deserves the obvious objection, and the answer is that
it is the opposite case rather than an exception to that one.

A modal covers the day while asking about it. This window exists for the minutes
when the day is *not on screen at all* — you switched to the editor the block
was named for, and Mono went behind it. Nothing is being hidden by the mini
window, because at that moment nothing was visible. The rule survives intact,
and it survives literally: the one question the window declines is the day's
shape, because hours and commitments really are unanswerable without the
calendar, and there is no calendar in four hundred pixels. `miniViewFor` returns
`unshaped` and points back at the tab.

The corollary is `dayShaped`, not `setupOpen`. The stage re-opens the opening
questions whenever the user goes back to them, which is where the *user* is
looking rather than a fact about the day. Following that out here would turn the
mini window into a sign pointing at the window they are already reading, for as
long as they read it.

*A portal, not a second root.* Both work — React 19 attaches its delegated
listeners to any portal container, including one in a foreign document, and
builds DOM nodes from that container's `ownerDocument`. The reason to prefer one
tree is not rendering, it is the hooks. `useReconciliation` and
`useBlockEndAlerts` are the only things in Mono that dispatch without a user,
and their once-only guards are per-hook-instance refs. A second root is one
careless import away from mounting a second copy and banking a block twice. A
portal makes that impossible to write rather than merely unwise, and it comes
with the store subscription, the ticker and the reconciler already shared.

*The window lends the ticker its timer.* This is the part that decides whether
the feature is worth having. `useNow` runs one interval on the opener, and a
hidden tab has its timers throttled to roughly one a minute — which is fine for
a page nobody is watching, and useless for a window whose entire purpose is to
be watched while the tab is hidden. So an open mini window adds its own
`setInterval` for as long as it lives, and a picture-in-picture window is always
on top and therefore never throttled.

Note what makes that safe to do at all: the second invariant. The tick has only
ever triggered a re-render, and every countdown is still `endsAt - now`, so
adding, dropping or duplicating tick sources cannot make a clock wrong — only
stale. A design where the tick advanced a counter could not have borrowed a
timer from anywhere. `tick()` also grew a same-second guard while this was being
done, which makes extra sources free: two intervals out of phase, plus the wake
listeners on top, still cost exactly one render per second. Nothing here reads
below a second, so the skipped update would have painted the identical screen.

*Two consequences that are easy to miss.* A notification fires when the tab is
hidden — and with the window open, hidden no longer means unseen, so `notify`
now declines. The chime is deliberately left alone: it is audible from another
room, which is exactly what a visible window is not. And the service worker's
"never reload during a block" rule now also covers "never reload while the
window is open", which is the stronger case of the two: a block interrupted by a
reload can be started again, whereas picture-in-picture can only be opened from
a user gesture, so a reload takes the window off the desktop with nothing the
app can do to put it back.

*Panels of its own rather than a `compact` prop.* Every panel in `stage/` opens
`max-w-md` — 448 pixels, wider than the whole window — and `BreakDurationPanel`
alone is five chips, a reserved cost paragraph and two buttons. Threading a flag
through six files to reach a `Stage` signature already carrying forty props,
half of which mean nothing out here, buys a duplication problem in exchange for
a layout one. What is shared is the part that would actually drift if copied:
the buttons, the field, the formatting and the words. A control called *Keep
going* on the stage and *Continue* in the window would be two applications.

*Verified by hand, and the specs say why.* Playwright is never given a real
picture-in-picture window. The default run uses `chrome-headless-shell`, which
has no browser-window layer to put one in, and Playwright only promotes CDP
targets of type `page`, so even headed the window is attached and dropped rather
than handed over. The three specs therefore stand it in with a same-origin
iframe, which has the shape that matters — a different document, one shared
realm — and covers the portal, the stylesheet copy, and a click in one document
moving the session in the other. What it cannot cover is the window floating
above other applications and its timers outliving a backgrounded tab, and those
are items 3 to 5 of README's by-hand list. One thing the first run of those
specs settled: Chromium under Playwright *does* expose
`documentPictureInPicture`, it simply cannot produce a window from it. So the
absent case has to be arranged with an init script, the same way the storage
spec arranges a browser that refuses to save.

*The one thing the stylesheet copy is not.* It reads like housekeeping and it is
load-bearing. A picture-in-picture window is a blank document, so without it
there are no Tailwind utilities and, worse, no `@theme` custom properties — and
the cat's ears, nose, tail and the ground it walks on are all `var(--color-…)`
fills. Uncopied, the companion renders as a cream silhouette with black holes
where its face should be. The nodes are copied rather than the sheets adopted
because the font sheet is cross-origin: reading its rules throws, so it would
need a `<link>` fallback anyway, at which point the link is the entire
mechanism.

**2026-09-03 (later) — The order of the four lines that open a window.**

Review of the entry above, on the lifecycle. Three things, and the first two are
the same mistake seen from opposite ends: an `await` in the middle of setting a
window up.

*The listener has to go on before anything is waited for.* Opening did the
stylesheet copy and only then attached `pagehide`, which reads harmlessly and is
not. The window is on the user's desktop from the moment `requestWindow`
resolves, with its own close control, and everything after that point is a
window that can go away underneath us. A close arriving during the style copy
was heard by nobody: the continuation then appended a container to a discarded
document, started a timer against it, and set the state that says a window is
open. The header would offer to close a window that was not there. So the
listener goes on first, and the continuation checks on the far side of the await
whether the thing it is about to furnish still exists.

*Waiting for a sheet is not the same as waiting for an answer.* The copy
resolved on `load` or `error` for every sheet, which the docblock described as
not blocking on a sheet that will not load — true for one that fails and false
for one that never replies at all. The font is fetched across the network, so a
captive portal was enough to leave an empty window sitting there for as long as
the connection stayed ambiguous. It now gives up after two seconds and shows the
window plain, which is what the docblock had been claiming all along.

That made `paint` load-bearing in a way it had not been. It set the background
so there was no white flash; a document with no stylesheet also draws its text
black, and black on ink is not badly styled, it is invisible. It sets the
colour and the font as well now, so the plain window is a window rather than an
empty one.

*Closing before tidying up, which looks backwards.* `close` ran `forget` and then
shut the window. But `forget` re-checks whether a held-back service worker
update can be let through, and that check asks the browser whether a mini window
is open — so asked in that order it always answered "still open" and the update
sat until some later dispatch happened to ask again. The window goes first now.
It costs a `pagehide` that may arrive before the listener comes off, and that is
free because `forget` is idempotent.

One consequence worth naming: the disposer for the borrowed ticker now runs
against a window that is definitely closed, where before it ran against one that
was still open. A closed window need not still have a `document` to take a
listener off, so it checks. That one is precautionary and says so in the code —
the specs stand a mini window up with an iframe, and a detached iframe keeps its
document, so nothing here can demonstrate it either way.

**2026-09-03 (later still) — Two panels may differ in layout, not in what they offer.**

The mini panels were written with a docblock claiming that what they shared with
the stage was "the button styles, the field style, the time formatting, and the
words". The first three were true. The words were not, and the review that
noticed it was right: the break lengths were two copies of one array, and the
free-break sentence had *already* drifted inside a single commit — "This fits in
time that wasn't going to hold a block anyway" on the stage against "Lands in
time that wasn't going to hold a block" in the window. Nobody decided that. It
is what copying looks like a week later, arriving early.

The line drawn, in `components/breakCost.ts`, is between a choice and a caption.
What a break may cost and which lengths are on offer are *decisions about the
product*: a fifth duration added to one picker and not the other means Mono
offers different breaks depending on which window you are looking at, which is
not a layout difference. Those are shared. The cost is shared as its parts
rather than as a finished sentence, because each panel lifts the number out with
its own emphasis and a formatter that returned one string would have to own the
markup to do it.

Short labels are deliberately left duplicated, which is the part that would look
like an oversight without this paragraph. `Start break`, `Not yet` and `Keep
going` are read at a glance, and a constant makes a word worse by making it
something to look up. They are also allowed to differ where room forces it — the
stage says `Keep going (deep)` and four hundred pixels do not — so a shared
constant would have to pick one and be wrong in the other place. The test that
protects the real risk is on the description, not on the captions.

**2026-09-04 — The window cannot follow you, so it leaves with you.**

The question that prompted this: if the main window is minimised, can the mini
window be made to appear? The answer is no, and it is worth writing down
properly, because it is the sort of thing that looks like a missing feature
forever unless somebody records that it was looked into.

Detecting the minimise is nothing — `visibilitychange` fires with a
`visibilityState` of `hidden`. It is the other half that is closed. Requesting a
picture-in-picture window needs *transient activation*: it has to be invoked in
answer to a click or a key press, and it throws `NotAllowedError` otherwise.
Clicking your operating system's minimise button is not activation inside the
page, and by the time the visibility event arrives there is none left to spend.
An auto-open on minimise would not be unreliable; it would fail every single
time, and fail into the `catch` that already treats a refusal as an ordinary
answer, so it would look like nothing happening at all.

There is one sanctioned way to enter picture-in-picture without a gesture, and
Mono is not allowed through it. Chrome's automatic picture-in-picture runs a
`mediaSession` handler for `enterpictureinpicture` on visibility change, and a
page is only eligible for it while **actively capturing camera or microphone
through `getUserMedia`**. It was built for video calls. Mono would have to hold
a microphone open — a permission prompt, an operating system recording
indicator, and a claim on the user's privacy that a focus timer has no business
making — in order to get a countdown to appear. That is not a trade, it is a
disguise, so the answer is simply no.

*What replaced it, and the decision it reverses.* The entry above lists "no
auto-open" among the things deliberately not built, on two grounds: that it
cannot be done, and that a focus app opening a window at you is the wrong
instinct. The first is now confirmed for the case it was written about and is
not going to change. The second was overruled, by the app's own argument: a
block is time you deliberately spend somewhere other than here, and a timer that
is ambiently present is a good part of what makes that time read as a block
rather than as an unmarked stretch of afternoon. So `popOutOnStart` exists, and
it defaults on.

The moment matters more than the setting does. The window is opened from the
click that starts the timer — `setPurpose`, and `cannotDecide` for the
priorities block — and not from `startBlock`, which only opens the naming
prompt. A window arriving at `startBlock` takes the focus off the field the user
is still typing their purpose into, which is the one field in the app that
matters most. Starting the timer is the last gesture before they leave, which
makes it both the right moment and, thanks to the paragraph above, the only one.

There is deliberately no effect watching the phase for this. One would work
today — activation outlives a render, comfortably — but "works because the grant
has not expired yet" is a thing that breaks quietly on a slow frame a year from
now, and the call belongs in the handler where the gesture actually is.

The setting needs no schema bump. A `settings/updated` patch that was never
appended cannot be replayed, so every log written before today folds to the
default, which is what an old day should get. `sanitiseSettingsPatch` gained a
branch so an imported file can carry the field.

One accepted roughness: closing the window mid-block does not stop the next
block from opening another. That is what "ambient" means, and the escape is the
setting rather than a per-block memory of having been dismissed — which would be
a second, invisible setting that only some days have.

**2026-09-04 (later) — Asking for a window twice takes the first one away.**

A comment in `useMiniWindow` said that the API allows one window per document
"and says so by rejecting". That is not what it does. The request algorithm's
step 8 reads: *let win be this's last-opened window; if win is not null and
win's closed attribute is false, then close win's navigable.* A second request
does not fail — it **closes the window the user is looking at** and hands back a
replacement.

Worth recording twice over. The behaviour itself is surprising, and a comment
asserting the opposite is the kind of thing that gets a guard deleted by
somebody tidying up a check the browser was supposed to be making anyway. The
guard was doing real work and was described as belt-and-braces.

It was also only half a guard. `documentPictureInPicture.window` is null until a
request resolves, so the stretch between asking and being answered was
unprotected, and nothing else can observe it. That gap stopped being theoretical
when a block starting began opening a window on its own: press `Pop out` and
then `Start` quickly, or simply double-click `Pop out` — which goes on reading
`Pop out` until the first window lands — and two requests go out, the second
destroying the window the first produced. Both continuations would then write
the same `teardown` ref, so one window's closing would run the other's cleanup
and leave a borrowed ticker running against a document nobody can see. There is
now an `opening` ref alongside the `api.window` check, cleared when the request
settles rather than when the setting-up finishes, because by then the window
exists and the other guard has taken over.

The race is not reachable from the specs — it lives inside one microtask — so
there is no test for it, and that is worth saying plainly rather than implying
coverage that does not exist. What the specs did gain is a stub that behaves
like the real algorithm: it closes the open window and replaces it, where before
it refused. A stub that refuses is a browser that does not exist, and the guard
would have been tested against it.

*Where the two-second escape hatch lives.* The stylesheet deadline was scheduled
on the opener's clock. The case it exists for is a sheet that never answers, and
the way the user gets there is the workflow that now opens windows for them:
the block starts, the window appears, and they go straight to the work — leaving
the opener hidden and its timers throttled, taking the escape hatch down with
them in the one situation it was written for. It runs on the mini window's own
timer now, which is never throttled, for the same reason and by the same
argument as the borrowed ticker.

Rendering the window immediately and letting the styles arrive afterwards was
the other way to fix it, and was not taken. `paint` does make an unstyled
document legible, but it is a safety net for the pathological case, and routing
every user through an unstyled frame in the common case to avoid a rare one is
the wrong way round.

*The setting is absent where the button is absent.* A browser with no Document
Picture-in-Picture showed no `Pop out` control and a `Pop the timer out when a
block starts` checkbox, on by default, that could never do anything. The header
control's reasoning already covers this — a permanently dead control explaining
itself is the app apologising for the user's choice of browser — and it applies
to a settings row at least as well. The stored value stays whatever it is; it is
the row that goes.

**2026-09-04 (later still) — One window, and the monitor is the user's to choose.**

Asked whether there could be a mini window per monitor. There cannot, and the
reason is the same sentence that produced the guard two entries above: step 8 of
the request algorithm closes the last-opened window before opening a
replacement. One document gets one window, and asking for a second is how you
lose the first. Chrome's own documentation puts a ceiling above that as well —
a site may have one open at a time, and the user agent may restrict how many
exist globally.

There is also nowhere to put a second one if it existed. `requestWindow` takes a
width, a height, and two booleans; nothing names a screen or a coordinate. The
Window Management API can place a window on a chosen display, but only an
ordinary `window.open` popup, and an ordinary popup is not always on top — which
is the entire property this feature is made of. Trading the one thing it is for
the ability to have two of them is not a trade.

The multi-tab route fails twice over before it starts: the global limit may
refuse it outright, and two tabs of Mono are two independent sessions writing
the same log to the same storage key. The store has no cross-tab
synchronisation and was never meant to; adding it to put a clock on a second
monitor would be a rewrite of the persistence layer paying for a decoration.

*What actually serves it.* Chromium reuses the previous mini window's position
and size unless the site sets `preferInitialWindowPlacement`. Mono does not set
it, and now deliberately does not: drag the window onto whichever monitor you
want it on, once, and every open after that — including the automatic one at the
start of every block — puts it back there. The `SIZE` passed to `requestWindow`
is the opening hint for a user who has never placed one, not a size reasserted
over their choice.

That is worth knowing before anybody decides to "fix" the size hint, and it is
item 5 of README's by-hand list, because no test here can see a real window.

**2026-09-04 - Focus rooms, sound that knows when to stop, and a day-built scene.**

Mono gained four curated dark rooms rather than a colour picker. A room owns a
coordinated semantic palette, a small pixel environment and a suggested sound;
the sound remains an override and defaults to off. That last part is the
compatibility boundary: upgrading a focus timer must never make a previously
silent browser begin playing noise on its next block. `Room sound` is the
explicit opt-in that follows the room thereafter.

The chime and ambience share one gesture-unlocked `AudioContext` but not one
gain bus. A temporary ambience mute therefore cannot swallow the completion
cue. Playback is an intent derived from the same active segment and phase the
timer renders: focus and priorities ask for sound, every prompt, break,
abandonment and reconciliation asks for silence. Restoring a running block
after reload leaves that intent waiting behind `Resume ambience`, because the
browser's autoplay boundary is a fact to expose rather than evade.

The room, trail, milestones and end-of-day postcard add no events. They are a
pure fold over today's existing history, including the provisional block held
open at `blockComplete`, exactly as the cat's vitals already were. Decorations
only accumulate until midnight and an abandoned block becomes an honest gap;
nothing downgrades the companion's factual state. A user-invoked preview may
temporarily visit an earlier tier; that is a tour of the interaction, not an
earned-state change. The postcard is the existing `Day done`
state reading the day back, not a stored award, dismissible overlay or history
screen.

**2026-09-04 (ambient UX pass) - The room belongs at hand, and focus previews stay temporary.**

Room and ambience choices were placed in one header dropdown, shared by the day
and guide headers, rather than being added to the general Settings dialog. Each room entry carries a
small swatch of its semantic focus colour, making the four environments easier
to scan without turning the header itself into a theme picker. The room choice
still changes visuals only; choosing sound remains a separate explicit action.

The running timer now uses one accessible speaker button instead of spending
horizontal space on `Mute ambience` and `Resume ambience` text. Its label and
title retain those exact actions for assistive technology and tooltips, and the
main and mini surfaces still operate the same session-only mute state.

The full companion scene is larger on desktop and in the pop-out while retaining
its original small-screen footprint. A focus-time tap now cycles a short preview
through the three visual growth tiers, including the cat's markings, then restores
the factual tier derived from today's history after 1.4 seconds. The preview is
gesture-driven, creates no event and unlocks nothing; reduced motion shows the
same earned details and explicit preview frames without decorative animation.
At a high earned tier the cycle deliberately visits an earlier tier before it
returns; preventing that would turn a playful tour into a no-op on the days the
companion has grown furthest.

**2026-09-04 (companion visual QA) - Preview the environment, not only the sprite.**

The companion contact sheet had remained a 36x20 Mono-coloured ground strip
after the product moved to a 48x24 room. It now renders a room-evolution matrix
for all four palettes and all four tiers, representative phase poses, the three
focus-tap preview states, every trail mark, the aggregate mark, milestone
sparkle and all header crops. The PNG is deliberately broad rather than a set
of separate files: comparison across adjacent rooms and tiers is the review it
exists to make cheap.

The script imports the authored frame grids, canonical room metadata and a
DOM-free scene description, but does not import the React renderer. Pulling
`PixelCat` into plain Node would also pull Motion and browser assumptions into a
generator that is meant to remain one command away. Coordinates instead live
once in `src/ambient/scene.ts`: React turns them into SVG elements and the Node
script paints the same shapes with literal palette values. The earlier mirrored
copy was removed after a shelf and its objects moved independently and the
contact sheet faithfully reproduced the same mistake instead of exposing it.

**2026-09-04 (ambient review) — Continuous controls stop at the journal boundary, and one-time facts speak first.**

The Room menu's volume slider exposed a mismatch between a continuous browser
control and Mono's permanent event log. React receives an input event at every
drag step, but those intermediate thumb positions are not durable decisions.
The control now owns a local draft, updates the live gain directly, and appends
only the value left on pointer release, blur or menu teardown. Teardown matters:
an outside pointer press removes a focused slider before browsers dispatch
blur, so without that final boundary a keyboard-adjusted volume could remain in
the audio engine but not the journal. Sound previews read the same live draft.
Coalescing in the reducer was rejected because it would make event-history
mutation a general store behavior merely to serve one control.

Recovery and return remarks had the opposite problem: they were derived from a
repeatable transition yet outranked facts that can cross only once. The
projection now reconstructs whether each transition remark has already been
shown today, caps each at one, and gives 90 minutes, three in a row, the first
deep block and the first block priority. A break before the 90-minute block can
therefore still be acknowledged on a later return; it can no longer erase the
only moment at which 90 minutes became true.

The session mute continues to govern live focus ambience, not an explicit idle
sound preview. Choosing a named sound is the gesture asking to hear it, including
when a previous running block was muted; completion chimes remain independent.

The day-end card now owns the only full scene in the main stage and names its
superlative honestly as the longest completed block, with its duration beside
the purpose. Consecutive blocks are not silently aggregated into a “stretch”:
they can have different purposes and can be separated by decisions Mono does not
record as uninterrupted work.

The completed-day predicate is also owned once. It includes the transient fact
that the opening questions are closed, then feeds both Stage's postcard branch
and App's decision to omit the ordinary companion. Reopening setup at the end
of the day can therefore never hide the cat while also replacing the postcard.

**2026-09-04 (ambient contract pass) — Sparse trails grow in place, and shared seams are executable.**

A trail is a sequence accumulating through the day, not a chart whose few
entries must fill its entire width. Marks therefore advance from the left at a
fixed 1.5-pixel pitch and a fixed 0.6 horizontal scale. The valid projection is
capped at 32 entries, so an adaptive scale expression never changed on a
reachable input and only disguised the visual rule. Overflow aggregation still
preserves the most recent 31 facts.

The shared scene module remains DOM-free and does not import the companion's
frame implementation, which keeps the plain Node contact-sheet command cheap.
The otherwise invisible seam is executable instead: a focused test asserts
that the floor is `SPRITE_TOP + SPRITE_H`. The generator imports `SceneTier`
and `TrailKind` from their owning modules as type-only dependencies, so neither
its geometry nor its vocabulary is a second source of truth.

The Guide follows the same ownership rule at a different scale. Its memoized
section tree accepts one live `Settings` snapshot rather than that object plus
a second list of selected fields. A settings change therefore rebuilds every
example together, while the one-second timer can re-render the header without
rebuilding static prose.

**2026-09-04 — The ambient track's handover document was dissolved.**

`docs/ambient-interactivity-context.md` was 926 lines written to carry the
ambient work while it was in flight, and it was the right thing to have at the
time. What it had become by the end was the thing `HANDOVER.md` was in August:
a status snapshot, a base commit, two file inventories, a test count, a
last-verified table and a 22-row ownership map that `grep` answers — sitting
next to 900 lines of real reasoning, and authoritative-looking enough to be read
in preference to the source.

Rather than refresh it, it was routed and deleted. The file-local reasoning went
into docblocks: why `theme.ts` refuses to write an inline body colour, what the
session mute in `useAmbience.ts` does and does not govern, why `RoomMenu` is a
popover that stays open when you choose something, why `AmbienceButton`
disappears rather than greying out. The playbooks went to the file you would
start editing — adding a room is documented at the top of `rooms.ts`, adding a
sound at the top of `audio.ts` — because that is where you are standing when you
need them. The trail's visual vocabulary went to `trailShapes`, which is the
only place it is not legible from the coordinates. Cross-file reasoning became a
`Rooms and ambience` table above, three traps, and eight more entries under
*Deliberately not built*. The manual checks became `docs/manual-qa.md`, which
also absorbed the README's hand-verification list. Everything derivable was
binned rather than moved.

The general rule this produced is at the top of this file: five tiers, and a
track document is scaffolding that lives in an untracked `docs/wip/` and is
dissolved when the work lands. That is what makes it safe for one to hold file
lists and test counts — it never outlives the moment they were true.

The README lost a third of its length in the same pass. Its *Behaviour worth
knowing* list had grown into a second copy of a specification whose live version
is the in-app guide, and the guide is built from current settings and therefore
cannot disagree with the app. The load-bearing rules stayed; the detail now has
one home instead of two.

**2026-09-04 — CI builds once, and the e2e suite tests the bundle that ships.**

The deploy pipeline was three jobs — build, then test, then deploy — and took
upwards of ten minutes to do about ninety seconds of work. `tsc -b` and the
bundle are around thirty seconds on a Linux runner, the 334 unit tests are
eight, and the 64 Playwright specs run against a paused clock in well under a
minute. Everything else was overhead, and nearly all of it was structural.

`test` declared `needs: build`, which bought nothing: the test job checked the
repository out again, installed again, and then built the app a *second* time,
because Playwright's `webServer.command` was `npm run build && vite preview`.
The dist the build job had just produced was uploaded to Pages and never seen
by a test. Two runners, two installs, two builds, strictly in series, so that
the thing being verified was a different build from the thing being deployed.

So the two collapsed into one `verify` job. It builds once, runs the unit tests,
and points Playwright at that same dist — which is faster and also a stronger
check, since the suite now exercises the artifact that is about to go live
rather than a rebuild that merely shares its commit. `deploy` still stands
alone, because `actions/deploy-pages` needs the `github-pages` environment.

That leaves `playwright.config.ts` needing to know who built the app, which is
the one odd-looking thing here: its `webServer.command` previews only under
`CI` and still builds first everywhere else. `npm run test:e2e` is documented in
three places as self-contained, and it stays that way for a human running it
locally; CI is the only caller that has already done the work.

Chromium is now restored from `~/.cache/ms-playwright` rather than downloaded
each run, keyed on the whole lockfile. A cache hit still runs
`playwright install-deps`, because the system libraries live on the runner
image and not in the cache — that is apt with nothing to fetch, not a second
download. Playwright also gets four workers in CI: the specs are independent and
spend their time waiting on a browser, so half of a four-core runner was sitting
idle under the 50% default.

The trap, for anyone tempted to trim `npm ci` further: **do not add
`--omit=optional`.** Rollup ships its platform binaries as optional
dependencies, so omitting them does not skip `sharp`, it breaks `vite build`.

**2026-09-04 — The bundle was one 534 KB chunk, and about a fifth of it was a cat.**

Vite had been warning about the chunk for a while. Read with a source map, the
warning turned out to be specific rather than general: 120 KB of it was Motion,
imported by exactly one file, `PixelCat.tsx`, which animates x, y, width and
opacity on a duration and nothing else. The `motion` proxy is a component that
might do anything, so importing it brings layout projection and drag handling
whether or not anything drags. `m` behind a `LazyMotion` boundary with the
`domAnimation` feature set is the same four animations for 74 KB.

Be precise about what that feature set is, because it is easy to be wrong in
the expensive direction: `domAnimation` is animation and exit *plus* the hover,
tap, focus and in-view gestures. Only drag and layout projection are outside
it, and `domMax` is exactly those two added. So a future hover or tap on the
cat needs no bundle change at all, and only a drag would — while reaching back
for `motion` is never the answer either way.

That boundary is in `main.tsx`, wrapping the whole app, and it belongs there
rather than around the cat for a reason that is only visible in Motion's
source. Handed a feature set directly — as opposed to a function returning one
— `LazyMotion` merges it into Motion's *global* feature definitions during
render, allocating a fresh object and a fresh context value each time. Inside
`PixelCat` that ran once per cat per second, because the ticker re-renders
every cat on screen and there are several. At the root it is a child of
nothing that re-renders, so it happens once for the life of the tab. The mini
window is covered by the same boundary: it is a portal rather than a second
React root, so it is inside that tree even though it is in another document.

The guide came out next: 28 KB of prose parsed on every cold open in order to
render a timer. React and Motion are then split out by hand in
`vite.config.ts`, which is a *caching* decision and not a size one: Mono is a
precached PWA, so an ordinary release used to make the service worker refetch a
file with React inside it, and now refetches the app chunk alone.

**Settings was deferred too, for about an hour, and bringing it back is the
more useful half of this entry.** It looked like the better saving — the whole
of Radix's dialog, focus scope, scroll lock and dismissable layer, 46 KB to
render nothing most of the time. What that missed is what is *inside* it.
`Export` lives in settings, and Export is where the storage warning sends you
when the browser has stopped saving and the day exists only in this tab. So
deferring it put Mono's one rescue for its one unrecoverable failure behind a
network fetch that can fail, and if both failed together there was no copy left
to rescue anything with. The fallback card written for that case made it worse
before it made it better: it told the user their work was saved and offered a
reload, which in that exact state is the click that deletes the day.

There is no wording that fixes that, because the missing thing is the export
itself. The rule is the one in the docblock: **a dialog that has to work when
everything else is going wrong is not a candidate for lazy loading, whatever it
weighs.** The 16 KB gzipped it costs is the cheapest thing in this entry.

It also took a hand-rolled modal with it, which `Dialog`'s own docblock had
already argued against — focus trapping, escape handling, scroll locking and
the aria wiring are easy to get subtly wrong, and the fallback got all four
wrong: focus stayed on the covered button behind it, escape did nothing, and
tab walked into the inert page. Radix is back to doing that job.

The critical path went from 534 KB to 460 KB, 166 KB to 144 KB gzipped, and the
total shipped fell by the 46 KB that Motion stopped sending. The bundle is
`react`, `motion`, the app, and the guide arriving after the first paint.

**The trap, and it cost an afternoon: `React.lazy` does not work under a paused
clock.** The obvious way to defer those two views is `lazy()` behind a
`<Suspense>`, and it works perfectly in a browser and fails in thirteen e2e
specs. React throttles the reveal of suspended content — the delay that stops a
fallback flashing — on a `setTimeout`, and `openMono` calls
`page.clock.pauseAt`, so that timeout never fires and the content never
commits. The dialog opens and nothing appears, with no error anywhere.
Preloading the module first does not help: `lazy` still suspends for the first
render either way.

So `App` holds the guide in ordinary state, filled by a `useEffect` that
imports it. It is smaller than the Suspense version rather than a workaround
for one: an effect runs after paint, which is the whole of what the split is
for, and once it is fetched unconditionally a moment after load there is no
fallback left for a boundary to show. The rule to take from it is that anything
routed through Suspense has to be checked against the specs, because the specs
pause time and Suspense is the one part of React that is built on time passing.

**Each, separately.** While there were two of these they were briefly loaded
together under one `Promise.all`, which quietly made two independent views into
one failure: blocking the guide's chunk and nothing else left Settings doing
nothing at all when clicked, with an unhandled rejection as the only trace. One
`useDeferred` call per view was the fix, and the shape survives now that there
is only one — a second deferred view must not be added back into a combinator
with the first.

**And the second trap: a failed dynamic import cannot be retried.** The obvious
recovery is to import again on the next click, and it can never work — a module
that failed is remembered as failed in the browser's module map, so the second
`import()` of the same specifier returns the same rejection without going near
the network. Measured, not assumed: the retry produced zero further requests,
while the same URL with a query string appended fetched and resolved normally.
Only a new document clears it, so the honest offer is a reload — but only when a
reload is free. `GuideDidNotLoad` in `App.tsx` asks the storage question first:
with the log on disk it offers the reload, and with the browser refusing to save
it offers the export instead and does not mention reloading at all. Those are
the same click and one of them is the whole day.

Both halves of that are pinned in `e2e/focus-session.spec.ts`, under *a guide
that never arrives*, which blocks the chunk at the network and asserts each
branch. A data-safety rule that only exists in a docblock is one refactor away
from being an ordinary reload button again.

**2026-09-04 — Site blocking, in a browser extension that is told one number.**
Mono could ask you to name a purpose and could time the block, and could do
nothing whatever about the tab you open out of habit two minutes in. Fixing that
needs a browser extension, which means a second process, which is where this
could have gone badly.

It went in this repository, and the argument is narrow rather than
philosophical. The two halves share exactly one type, `BlockingIntent` in
`src/contract/blocking.ts`. Across two repositories a change to it compiles on
both sides and fails at runtime in a user's browser with blocking stuck on; in
one repository it is a red squiggle. Nothing else about the split needed
solving. `src/domain` was already pure, and `tsconfig.app.json` narrows `types`
to Vite and vitest, so `chrome.*` is not in scope in app code at all — a
compiler-enforced boundary that was already there by accident of good config.

**The extension is handed one absolute timestamp, and that is the whole design.**
It is the second invariant carried across a process boundary. The extension
never counts down, never polls, never asks for a heartbeat, and never needs the
tab that told it to still exist. Close the tab, sleep the machine, let Chrome
kill the service worker after its thirty seconds — blocking still ends at the
right instant, because it was never a duration. The alternative not built is a
heartbeat, and it is worth being explicit about why: with a heartbeat, the
absence of a message is indistinguishable from a dead app, and every way of
resolving that ambiguity is either "block forever" or "stop blocking whenever
the tab is briefly slow".

**Session rules rather than dynamic ones, which is the counter-intuitive half.**
Dynamic rules persist to disk and survive a crash. That sounds like the safer
choice and is the opposite: a crash mid-block would leave a stale rule blocking
sites indefinitely with nothing running that knows why, and the user's only
recourse is working out which extension is doing it. Session rules evaporate
when the browser closes, and `resume()` puts them back deliberately, from an
`endsAt` it has just checked against the clock. Losing the state is the safe
direction; restoring it is a decision taken once. The same asymmetry settles
every ambiguous path in the worker — a malformed message, an unknown contract
version, a timestamp outside the clamp all end in *no rules* rather than in
leaving the previous ones up. Failing to block costs one block. Blocking wrongly
costs the user, who uninstalls rather than debugs.

**`redirect` rather than `block`, and the cost that comes with it.** Blocking
hands the user Chrome's error page, which is a dead end that says nothing. The
interstitial repeats the sentence they typed half an hour ago, and that sentence
is the only argument this extension has any business making. The price is that
`blocked.html` has to be in `web_accessible_resources` for `<all_urls>` — a rule
cannot redirect a public request to a resource that is not web accessible, and
the target is fixed at rule-authoring time so `use_dynamic_url` is not
available. So any site can probe that URL and learn the extension is installed.
That is a real cost, accepted knowingly, and it would not be worth paying for
something like an ad blocker.

**Three permissions: `declarativeNetRequest`, `storage`, `alarms`.** No host
permissions and no `tabs`. The interstitial still has to reach the app to end a
block, and `tabs.query({ url })` would make that a one-liner in exchange for the
URL of every tab the user has open. Instead the content script announces its own
tab id and the worker keeps the list — fifteen lines in `state.ts`, with a stale
id costing one caught `sendMessage`. The precedent is the automatic
picture-in-picture refusal above: a focus timer does not get to make a claim on
your privacy in order to be slightly more convenient.

**The escape hatch ends the block rather than lifting the rules.** The worker
could simply drop its rules and let you through, and the app would never find
out — the block would keep running, the timer would keep counting, and the day
would record a block nobody sat through. So the interstitial's one button routes
back through the app and dispatches the same `abandonBlock` that End early does.
One vocabulary, one code path, and the `running: false` that follows disarms the
extension by itself. There is deliberately no timed pass: a five-minute
exemption is a pause under another name, and there is no pause.

**`wantsAmbience` became `isBlockRunning` and moved to `machine.ts`.** Blocking
wants precisely the predicate ambience already had — a *block*, in `focusing` or
`reflecting` — and the rows that matter are the false ones. At `blockComplete`
and `reconciling` the segment is still `active`, because `timerElapsed` appends
nothing and nothing is banked until the user answers, so anything reading
`active` alone would keep a sound playing and a website blocked after the block
was over. Two copies of that expression is how you end up with a break that is
silent but still blocked. `machine.test.ts` now walks all eight phases against a
block, a break and nothing, and asserts the two consumers still agree.

**What the e2e suite can and cannot reach here.** Playwright is never given the
extension: the default run uses `chrome-headless-shell`, which has no extension
layer at all. So `e2e/blocking-intent.spec.ts` records `window.postMessage`
through `addInitScript` and covers the half that is Mono's — the right intent,
with the right absolute end, at the right moments, including a reload mid-block
republishing the same instant and the ticker *not* republishing forty-five times
a minute. Everything past that message is ten numbered checks in
`docs/manual-qa.md`. The same bargain as the iframe standing in for
picture-in-picture, and worth writing down rather than rediscovering.

**Two things about the build that will bite.** `scripts/build-extension.ts` runs
Vite twice, because a content script declared in a manifest is a classic script
rather than a module and needs its own IIFE build written into the same
directory without erasing the first — `emptyOutDir` is true exactly once, and
getting that wrong produces a directory that loads as an extension and silently
does nothing. And `publicDir` is `false` on both builds: the root has to be the
repo for `@/` to resolve, and the default would quietly copy the app's PWA
manifest, `mono.svg` and every icon into the extension. The manifest itself is
generated from `extension/src/manifest.ts` rather than checked in, so the origins
the content script is injected into cannot drift from the origins the worker
will listen to. Those two lists disagreeing gives you a feature that is
completely dead and looks entirely fine.

**2026-09-05 — The extension blocked nothing, and five smaller ways it lied to
itself.** A review of the blocking extension before it had ever been loaded.
Six findings, all of them real, and the first invalidated the mechanism.

**`declarativeNetRequest` does not cover `redirect`.** It grants implicit access
to `allow`, `allowAllRequests` and `block`. A `redirect` rule additionally needs
host permission for the URL it acts on, and without it the rule installs,
matches nothing, and reports no error whatsoever. Every rule this extension
wrote was a redirect, so it would have shipped looking entirely correct and
blocking not one site. Nothing in the automated suite could have caught it: the
rule shape was right, and rule shape was all a test without a browser can see.

The fix keeps the interstitial without buying it at the usual price. Host access
is `optional_host_permissions` rather than `host_permissions`, so nothing is
requested at install, and it is asked for one site at a time from the click that
adds that site — the prompt names the site the user has just typed. A host
without permission still gets a `block` rule, so the promise is kept and only
the explanation is lost. `rulesForHosts` therefore takes the granted subset and
decides per host. Requesting `*://*/*` up front was the alternative and is the
one thing that would have made this worse: it is the loudest warning Chrome
shows, it is named in the Web Store's review guidance as a major cause of
extended review, and it would be false about an extension that reads no page.

What made the mistake possible is worth more than the fix. The permission was
verified against a summary that said the permission "provides implicit access to
rules", and the list of *which* rules was one clause further on. A capability
that fails silently deserves the primary source read twice.

**Delivery is not agreement, in two places.** The interstitial's End early
button set a boolean, and the content script consumed it on `hello` — at
`document_start`, before Mono has evaluated its own modules and therefore before
anything in the page is listening. The request was posted into an empty room and
the only record of it had already been destroyed. Separately, the worker treated
`tabs.sendMessage` resolving as confirmation and stopped at the first tab that
answered; with two tabs open that may be a background one, and the tab the user
is actually in is never told. Both are now the same thing: the request is
recorded against a **segment id**, survives until an intent says that segment
has stopped, is sent to every known tab, and is held by the bridge until the
page proves it is listening — the proof being the page's own first intent, since
`publishBlockingIntent` registers its listener and then immediately publishes.
The segment id also went into the contract, because a request that can arrive
late can arrive after the block it was arguing with has ended, and abandoning
the block the user started *next* is a worse failure than not abandoning at all.

**Every mutation is serialised now.** `arm`, `disarm` and `materialise` each
await several times, and message, alarm and permission events all started them
with a bare `void`. A start followed quickly by a stop could interleave so the
stop cleared the rules and the older start then installed the ones it had
already computed — blocked, with nothing running, and no path back but
uninstalling. A promise chain fixes it; there is nothing to contend for beyond
ordering.

**The alarm claim was simply wrong.** A docblock here said a one-shot `when`
escapes the thirty-second floor. It does not: Chrome will not fire an alarm
sooner than thirty seconds away whatever `when` says, and may delay it
arbitrarily beyond that. So expiry is documented as best-effort, and the alarm
is now a backstop rather than the mechanism — `readArmed` refuses an expired
record, and every question asked of the worker reconciles first, which makes the
interstitial reaching zero one of the moments the rules come down.

**Storage was the one input that skipped validation.** `readArmed` cast what it
found and checked only that `endsAt` was in the future, so a corrupt record or
one with a timestamp a year out would be re-armed without meeting the clamp
every incoming message meets. It now runs through `readBlockingIntent`, the same
guard against the same clock, which is possible because `ArmedBlock` was made
literally the running arm of `BlockingIntent` rather than a parallel shape. A
design that fails open cannot have a back door that fails closed.

**And the privacy claim was too broad.** The README said none of the permissions
can read a page. The three named permissions cannot, but `content_scripts`
grants access to Mono's own origins and Chrome shows them in the install prompt.
The narrower claim — no `tabs`, no navigation watching, so no browsing history —
is both true and still the interesting one.

**2026-09-06 — Identity, everywhere a message can arrive late.** A second review
pass on the blocking extension, again before it had been loaded once. Five
findings, all real, and four of them are the same mistake in different clothes:
*resolving "which block" at the moment a message is received rather than at the
moment it was sent.*

**A message that arrives late must say what it is about.** The interstitial's
button sent `{ kind: 'endBlockEarly' }` and the worker looked up whatever was
armed. But an interstitial is an ordinary page — it can sit in a background tab
across the end of the block that produced it and the start of the next one — so
pressing that button could end a block the user had just started and was not
looking at. It now carries the segment it *displayed*, captured once at load,
and the worker refuses a request naming anything but the armed one. The same
correction applied to the idle intent, which had no identity at all: two Mono
tabs hold two independent stores with nothing synchronising them, so a tab still
holding a finished block would eventually announce its end and disarm a block
another tab had genuinely started. `running: false` now carries
`stoppedSegmentId`, and a stop naming a block that is not the armed one is
ignored entirely.

The null case is worth stating because it looks like the same hole and is not.
`stoppedSegmentId: null` means "I was not tracking one", which is a freshly
loaded tab — and a freshly loaded tab is *authoritative*, because it rebuilt its
session from the same `localStorage` every other tab wrote to. An unqualified
stop is also what an unparseable message folds to, and that has to keep working:
refusing an idle nobody can qualify would be a way to stay blocked.

**Compatibility with nothing is not compatibility.** `segmentId` on the end
request was briefly optional, folding to "whatever is running", on the reasoning
that an older extension might not send it. No version of the extension has ever
shipped, so there is no older half — and the fallback was precisely the hole the
field existed to close. Required now, and a request without one is refused.

**A default argument rebuilt the critical bug as a convenience.** `rulesForHosts`
took `redirectable` with a default of `hosts`, so any future caller that forgot
the second argument would silently emit redirect rules for hosts nobody had
permission for. That is the exact failure the parameter was added to fix. The
argument is required. Relatedly, a comment claiming redirects consume a smaller
session-rule allowance was wrong: `MAX_NUMBER_OF_UNSAFE_SESSION_RULES` and
`MAX_NUMBER_OF_SESSION_RULES` are both 5,000. The 5,000-of-30,000 sub-quota is a
*dynamic* rule limit, and this extension uses no dynamic rules.

**The declined-permission path had no way to heal.** A granted site redirects to
our interstitial, which pings the worker as its countdown hits zero — that is a
reconciliation trigger. A declined site gets a plain block and Chrome's own
error page, which cannot ask us anything. So with Mono closed and the alarm
delayed, that rule could sit there until some unrelated extension event, which
could be hours. The alarm now repeats every minute and stops itself on the first
firing that finds nothing armed. The contract is written down rather than
implied, in the README and in `manual-qa.md`: **nothing is ever blocked before a
block starts or after Mono says it ended, and clearing up after `endsAt` with
Mono closed is best-effort with a one-minute retry.** The QA item that asserted
"a few seconds is correct and a minute is not" was unenforceable — Chrome
documents no upper bound — and now asks the answerable question instead, which
is whether the rule clears at all.

**Two documentation claims had rotted within a day of being written.** The
manifest's opening comment still said `declarativeNetRequest` covers redirects,
directly above the corrected comment saying it does not. The README said
blocking "ends at exactly the right moment" immediately before describing
best-effort expiry. The precise version of the first claim is the interesting
one and now appears once; the second was split into the half that is exact (the
instant) and the half that is not (the tidying up).

**2026-09-06 (review follow-up) — A fresh tab is a snapshot, not an authority.**
The identity fix above is correct for a named stop and incomplete for
`stoppedSegmentId: null`. The claim that a reload is authoritative because it
reads shared `localStorage` ignored two properties Mono already supports: a
write can fail while the running session continues in memory, and an older tab
can overwrite the shared key from its independent store. A fresh tab can
therefore reconstruct idle while another tab genuinely has a block running.
An expired or otherwise invalid intent has the same hole, because the worker
currently folds validation failure into the same anonymous stop.

The repair should stay extension-local rather than turn this into a persistence
rewrite: remember `sender.documentId` for the accepted running block as a
browser-session lease, accept anonymous failure only from that owner (or with no
owner during startup recovery), and continue requiring segment identity for a
normal stop. Chrome supplies that document-lifetime UUID to content-script
messages; a tab id is useful for delivery but too broad for authority because a
reload keeps the tab and replaces the document. A running intent also needs
`startedAt` before the worker can reject an older tab's stale running snapshot
rather than letting last delivery win.
This is the narrower version of fail-open: fail open for the current authority;
ignore ambiguity from unrelated publishers. The active track document records
the state table and tests this still needs.

**An alarm period is a requested cadence, not a delivery bound.** The repeating
alarm is still useful after a transient reconciliation failure, but Chrome may
delay any occurrence by an arbitrary amount. Documentation now says it is
scheduled every minute rather than promising a retry arrives every minute, and
manual QA asserts the result once a reconciliation trigger reaches the worker
rather than inventing an elapsed-time ceiling the platform does not provide.

**2026-09-06 (later) — The publisher lease, and what "fail open" actually meant.**
Built the repair sketched in the entry above. A running intent now carries
`startedAt`, the worker records the `sender.documentId` that armed the current
block in `chrome.storage.session`, and the whole judgement lives in one pure
function — `decideIntent` in `extension/src/authority.ts` — that
`extension/src/background.ts` gathers facts for and obeys.

Three kinds of message, three different amounts of trust, and the split is the
whole idea. A **named stop** is self-scoping, not secret or authenticated: it can
only tear down the block it names, so it cannot touch a different block and any
Mono publisher may send one. A **running intent** can be ordered against what is
armed, so a block that began later wins and one that began earlier is a stale
tab talking about history. Everything else — an anonymous stop, and anything
that failed validation — is honoured only from the document that armed the
block, or when session storage holds no publisher claim.

That no-owner case is broader than browser startup. Chrome clears
`storage.session` when an extension is disabled, reloaded, or updated as well as
when the browser restarts, while the armed record in `storage.local` survives.
The first Mono page to speak after any of those transitions is therefore the
fail-open recovery evidence. A stored document id is an authority token, not a
liveness check: it can remain after its document closes, until the block is
disarmed or ownership moves to another accepted running intent.

The failure that made this necessary was not exotic. Mono tolerates a failed
`localStorage` write and carries on from memory, and two tabs hold independent
stores writing the same key, so a second tab reconstructing an empty day was an
ordinary event — and it used to disarm a block someone was sitting through. The
sharpest version needed no storage failure at all: a stale tab republishing a
block whose `endsAt` had passed was *correctly* rejected by validation, and the
rejection was then folded into an unconditional stop. Refusing to read a message
and concluding something from it are different things, and the worker was doing
both at once. `applyIntent` now receives `null` for an unreadable message rather
than an idle intent, precisely so the difference survives to the decision.

*Why a document and not a tab.* `sender.tab.id` survives a reload, which is
exactly wrong here: "the tab running the block failed to write, reloaded, and
came back knowing nothing" is half of the original failure, and with a tab id
that page is still the owner and still disarms. `sender.documentId` is a fresh
UUID per document, so a reloaded page has to earn its authority again. Chrome
has supplied it since 106 and the manifest floor is 120. Neither can be forged
from page script; both come from Chrome.

*What ignoring a stop costs*, given that this codebase is otherwise emphatic
that failing to clear rules is the expensive direction. `endsAt` makes an
expired arm recognisable to the worker; it does not make a DNR rule expire.
Rules come down when Mono sends the accepted stop or when a later reconciliation
observes the timestamp, and Chrome gives no wall-clock upper bound for alarm
delivery. The lease therefore trades an incorrect early unblock for a possibly
late unblock. That remains the right trade for unrelated publishers, but it is
not a hard safety guarantee, and it makes the alarm, startup, status, and message
reconciliation paths load-bearing rather than optional tidying.

*Ownership is written where messages are judged*, never by `arm`. `reconcile`
re-arms from a stored record on an alarm and on startup, and neither is a
publisher saying anything; an owner written there would be invented or erased
every time the alarm ticked. `disarm` drops the claim, because a claim on
nothing would otherwise let a document that armed something an hour ago keep
authority over whatever is armed next.

`startedAt` is required rather than optional, on the same reasoning that made
`endBlockEarly`'s `segmentId` required: no version of the extension has ever
shipped, so there is nothing older to be lenient towards. It is read off the
segment rather than generated at publish time — a token minted on each publish
would make every republish look like a newer block, which is the failure mode
inverted. A stored `armed` record written before this change no longer
validates, and is therefore cleared rather than resurrected, which is the
existing rule for a record a newer version cannot read.

**The worker is now tested, which it was not.** `extension/src/authority.test.ts`
is the state table, pure and browser-free. `extension/src/background.test.ts`
runs the real worker against `extension/src/chrome.fake.ts` — a small fake with
actual behaviour rather than recorded calls, because every bug here is about
state that outlives a call: rules left installed, an alarm that never stops, a
claim left behind. Tests drain the worker's serial queue by sending a second
message and awaiting its reply, since nothing in the worker is awaited by its
caller; `hello` is used for that rather than `getStatus`, because `getStatus`
reconciles before answering and would quietly perform the tidying up several of
those tests exist to check the worker did on its own.

**2026-09-06 (later still) — A lease names its block, and writes are ordered by
which failure you would rather have.**
Review of the publisher lease found the fix half-built, and two of the holes were
introduced by the fix itself. Both come from the same blind spot: every sequence
in the worker is several `await`s long, and it had been reasoned about as though
each one either happens completely or not at all.

*The lease now names its segment.* Arming a block and recording its publisher are
two writes. Storing a bare document id meant a failure of the second left the
*previous* block's owner in place — holding authority over a block it had never
heard of, and locking out the tab that had genuinely published it. That is the
original cross-tab failure rebuilt out of a partial write, and the comment
claiming it would leave "no owner" was simply wrong. A lease of
`{ segmentId, documentId, tabId }` cannot express it: a lease applies to the
block it names or to nothing, so a half-finished handover reads as no owner,
which is the direction to fail in. `applicableLease` is the single place that
rule lives, and the worker uses the same function to pick a tab. Nothing has to
be cleaned up in the right order any more, because a stale lease is inert rather
than wrong.

*The writes are ordered by their failure mode.* `arm` now secures the record and
the expiry alarm **before** installing any rule, because a rule installed with
no alarm behind it is a user blocked with nothing left that intends to stop
them; done the new way the same failure leaves an armed record and an alarm with
nothing installed, which blocks nobody. `disarm` removes the rules **before**
clearing the alarm, so a failed removal keeps the thing that will try again, and
tidies the lease away **last** — it had been second, which put an ordinary
storage write in front of the one operation that must happen and let a refused
write keep every rule installed.

*`startedAt` is held to the same standard as `endsAt`.* It was validated only as
"finite, and not after the end", which is thin for a field that decides which of
two publishers is believed: a start in the future outranks every block that has
actually happened and keeps that rank until the clock catches up. It must now be
no later than now plus a minute of clock skew, strictly before `endsAt`, and
within `MAX_BLOCK_MS` of it. The two clamps compose, so a block ending four
hours out can only have begun now. Republishing the *armed* segment additionally
has to agree with the stored record about both timestamps — they come off the
log and never change, so a "repeat" that disagrees is something claiming an
armed block's name for a longer span.

*The worker checks its alarm at start.* This is a deliberate, narrow exception to
this file's own rule against a top-level resume call. That rule is about rules:
session rules survive worker suspension, so re-materialising on every wake is
work for nothing, and that still stands. Alarms are different — their survival is
not something an extension may assume, Chrome's guidance is to check the ones you
depend on at worker start, and the alarm is the only thing that reconciles while
Mono is closed, so a missing one has no other repair path. Two reads when nothing
is armed.

*End early now brings the publisher's tab forward*, not whichever id sits first
in an insertion-ordered list. Every tab is still told — with two open, the first
to answer may be a background one — but the tab the user was working in is the
one that armed the block. Implemented by ordering the list rather than tracking a
second variable, which keeps the fallback honest when that tab has gone.

**And the thing to stop saying.** Several comments claimed that ignoring a stop
costs "an unblock a moment late", because `endsAt` bounds every arm. It does not.
No DNR rule understands `endsAt`; a rule comes down when something reconciles
against it, and the alarm that usually does is one Chrome may delay by an
arbitrary amount. The honest statement is that ignoring a stop trades a wrong
*early* unblock — the failure that makes people uninstall a blocker — for a
cleanup that may be late by an amount nothing here can bound, and that the only
hard bound is at the far end, where session rules do not survive the browser
closing. It is still the right trade. It is not a free one, and writing it down
as free is how the next person talks themselves into leaning on it.

Related: the no-lease state is not only browser startup. Chrome clears
`storage.session` on an extension reload, an update and a disable/enable too, and
each leaves a locally restored block that the first page to speak can disarm.
Deliberate, and now tested and in the by-hand list rather than assumed.

**Testing a write order needs a way to refuse a write.** Mutation testing cannot
reach any of the ordering fixes above: the code is correct either way and it is
the *order* that is wrong, so no mutant fails. `chrome.fake.ts` grew `failNext`,
which refuses one matching operation once, and the four half-finished sequences
are covered directly. Everything else this round was mutation-checked — eight
mutations, eight caught.

**2026-09-06 (last of the day) — Mono is not blockable, storage and DNR are two
writes, and orphan rules are somebody's job.**

*The blocklist could block Mono.* `sadeeptha-b.github.io` was an ordinary
hostname as far as anything here was concerned, and the exact entry was not even
the dangerous one — `requestDomains` matches subdomains, so `github.io` covers
Mono too, and blocking the whole of `github.io` is a perfectly reasonable thing
to want. The result had no way out from inside the browser: blocking ends by
asking Mono to abandon the block, so a blocked Mono is a blocked escape route.
The interstitial's button opens the app, the app is redirected back to the
interstitial, and the only exits left are waiting out a best-effort expiry or
quitting Chrome.

The fix is in the generated rules, not in validation. Every rule now carries
`excludedRequestDomains: MONO_HOSTS`, which Chrome gives precedence over
`requestDomains`, so it holds whatever ends up in storage — a corrupt list, a
parent domain, a record from a version that meant something else. `MONO_HOSTS`
is derived from `MONO_MATCHES` so it cannot drift. The popup additionally
refuses Mono's own hostname, because a rule carved out down to nothing is a line
in a list that does not do anything, and annotates a parent domain so that "I
blocked github.io and Mono still works" reads as intended rather than broken.
Neither of those popup behaviours is the guarantee; only the rule is.

*Storage and DNR are two writes and cannot be made one.* `setHosts` saved the
list and then installed it, and if the install was refused it neither retried
nor said so — and it had returned `true` from the listener without ever
replying, so the popup sat on a port that had already closed. Chrome applies a
rule update atomically, so a refusal leaves the *whole* previous set installed:
a site removed from the list goes on being blocked, from a row that is no longer
on screen. That is the wrong direction to fail in silently.

So `materialise` now schedules `mono.rulesRetry` when an update is refused and
clears it on the next successful one, and `setHosts` always answers with whether
the rules actually took. A second alarm is a real addition to a file that says
"one alarm, replaced rather than accumulated", and it earns its place: the
expiry alarm is scheduled for the *end* of a block, so it does not fire during
one, and a list can be edited with no block running at all. There was no other
path back.

*Orphan rules had nobody looking for them.* The start-up check added earlier
returned as soon as `readArmed` came back null, which reads an absent record as
"in order" rather than as "so why is anything installed?". Session rules outlive
worker suspension, so the worker routinely starts into a browser that is already
enforcing something, and a refused removal or a sequence that stopped halfway
leaves rules with nothing behind them — the exact failure this design refuses.
It is now an audit over all three: armed with no alarm, re-arm; nothing armed
with rules or an alarm still there, disarm; otherwise nothing. Three reads and no
writes in the ordinary case.

*"Self-authenticating" was the wrong word* for a named stop, and worth correcting
rather than leaving as a nice phrase. A segment id is not a secret and proves
nothing about who sent it. What naming the block does is bound what the message
can affect — it can only ever tear down the block it names, which is why it
needs no sender check. *Self-scoping.* The distinction matters because the wrong
word invites someone to lean on it as identity, which it is not.

*And a fidelity bug in the test double, found by a test that should have failed
and did not.* `firePermissionsChanged` fired the `onAdded` and `onRemoved`
listeners together, so the worker's handler ran twice — a refused rule update
was immediately retried by the second call and a genuine failure looked
self-healing. Chrome fires one or the other, never both. Split into
`firePermissionAdded` and `firePermissionRemoved`. Worth recording because the
failure mode of a fake is that it makes the code look better than it is, and the
only reason this surfaced was a test written to assert that a failure *persists*.

Twelve mutations run against the suite this round, including all of the previous
rounds' fixes; twelve caught.

**2026-09-06 (documentation pass) — What the track document is the only copy
of.**
Audited `README.md`, `CLAUDE.md`, `docs/decisions.md` and the track document in
`docs/wip/` against the extension as it now stands. Three things came out of it,
and only the third is interesting.

The README still closed its blocking section by saying the rules are "torn down
rather than kept when anything is unclear" — the unqualified rule, three
paragraphs after the same file correctly describes the scoped one. Fixed.

`CLAUDE.md` had drifted behind the code in ways that would cost an agent real
time: it described a single timestamp when there are now two with different
jobs, did not say that the lease names its segment, and did not mention the
start-up audit, the second alarm, or how to drive the worker's test harness.
All of that is now there, and it is there rather than in the track document on
purpose — see below.

**The real finding: `docs/wip/extension.md` is untracked, and it had become the
sole home of things that are not scaffolding.** The documentation model says a
working document is temporary and dissolved into docblocks, tests, this log and
the README when a track lands, and that nothing lasting should live there. That
rule was being followed for *reasoning* and quietly broken for *operations*: the
Chrome Web Store privacy answers, the release checklist, the reviewer
instructions and the manual-QA release gate exist nowhere else, and none of them
fits any of the tiers. They are not reasoning about a decision and they are not
one file's docblock; they are a runbook.

So the question the track has been deferring — promote it to a tracked
`docs/extension.md`, or dissolve it — is not a tidying preference. Dissolving it
as written means deleting the runbook. That is a documentation decision, it
belongs in this log rather than in a quiet `git add`, and it is recorded here
because writing it down only in the untracked document would be the same mistake
one level up.

Everything else in that document is now either duplicated into `CLAUDE.md` or
already beside the code, so the working tree could be lost today without losing
a rule.

**2026-09-06 (failure-boundary review) — Stored, applied and cleaned up are
three different facts.**

The popup and worker had collapsed two failures into one boolean. If
`storage.local.set` rejected, the popup still replaced its list and said the
change was saved even though nothing canonical had changed. If DNR succeeded
but clearing `mono.rulesRetry` rejected, the worker reported failure even though
Chrome had atomically installed exactly the requested rules. Deletion made the
first error worse by revoking host permission before it knew the removal was
stored; addition could leak the inverse permission after a refused write.

`setHosts` now reports persistence and projection separately. The popup commits
a row only after `stored: true`, persists deletions before revoking permission,
and compensates a newly granted permission when addition was not stored. A lost
message reply is deliberately a third state: the worker may have committed
before its port disappeared, so the popup re-reads canonical status before it
rolls back or removes anything.

The projection itself now has one success condition: the atomic DNR update
resolved. Clearing its retry alarm and dirty marker afterwards is best-effort;
failure leaves only harmless extra work. Desired-state writes set `rulesDirty`
in the same local-storage call, and only successful projection clears it. That
marker survives the case where both DNR and retry-alarm creation fail and makes
the next worker start converge even when the armed record and expiry alarm look
structurally healthy. The start-up path is therefore documented as an
interrupted-write and orphan audit, not as a comparison of all three complete
representations.

Chrome storage reads reject too, rather than resolving as empty. Projection
preparation now sits inside the same failure boundary as the DNR update, the
fake can refuse reads and alarm cleanup, and popup/interstitial status failures
produce an explicit unavailable state instead of an optimistic or blank one.
Stored host strings are normalised on read, and `storage.local` is restricted to
trusted extension contexts because the content-script bridge has no reason to
see the blocklist or current purpose.

**2026-09-06 (extension lifecycle follow-up) — An alarm is not evidence that a
rule survived.**

The dirty marker closes interrupted writes owned by the worker, but it does not
describe Chrome erasing session-scoped state outside such a write. Extension
reload and disable/enable cycles can leave the persistent armed record while
session rules and session storage disappear, and alarm survival is separately
not something the extension may assume. The start-up audit therefore reads
rule presence whenever a valid arm exists and re-arms if the expiry alarm is
absent, or if hosts are configured but no rules remain. An empty blocklist still
correctly projects to no rules. The audit remains read-only in the healthy case
and does not grow into byte-for-byte rule comparison.

Two smaller state leaks were closed at the same boundary. `disarm` now clears a
pending end request as best-effort housekeeping once its block is provably over,
beside the equally inert publisher lease. And the contract reader's accepted
block-kind table is a `Record<BlockKind, true>`, so adding a kind becomes a
compile error at the wire decision instead of silently disabling blocking for
that kind.

The remaining review items did not justify architectural churn. `reconcile`
still performs a full idempotent rewrite and now says so in its docblock rather
than being split into check/apply modes. The interstitial no longer creates an
interval after its first render has already found expiry, and the bridge catches
the synchronous invalid-context throw seen during extension reloads. Localhost
remains deliberately carved out by the single derived Mono-origin list. The
permission prompt can still destroy a popup on some Chrome platforms between
grant and persistence; reordering cannot preserve its user gesture, so that
platform behavior is an explicit real-browser release check rather than a
larger permission protocol.

**2026-09-06 (end-early failure boundary) — A dead publisher is not replaced by
the first tab that accepts a message.**

Mono tabs share persistence but not necessarily their in-memory session. If the
tab that armed a block closes, another already-open tab can accept the extension
message and still correctly refuse its segment because that tab never ran it.
Delivery and focus therefore cannot make that page the publisher by accident.

Closing the publisher now removes its tab id from the lease while retaining the
document claim. That distinction preserves the core promise that closing Mono
does not stop blocking: an unrelated idle tab remains unable to send an
authoritative anonymous stop. When the user subsequently makes the explicit,
self-scoped end request, an absent or unreachable publisher changes the policy.
The worker addresses the publisher by both tab and Chrome document id, so a
reload cannot turn a replacement document into successful delivery. If that
publisher is absent or unreachable, the worker tears DNR down immediately. It
retains the named pending request if it was persisted and only then opens a
fresh Mono page: rehydration can still record the abandonment, while a failed
page load cannot hold the user's browser hostage. If the pending write failed,
opening a page would instead let the still-running persisted block re-arm, so
the worker leaves the browser unblocked without manufacturing that recovery.

Session storage remains routing and housekeeping, never a prerequisite for a
named stop. `applyIntent` reads the lease only for anonymous or unreadable
messages that actually need publisher authority, and pending-request cleanup
runs after correctness-changing work. If persisting a new end request fails,
the worker attempts live delivery but removes the rules without waiting for an
acknowledgement it can no longer recover. If reading a lease fails when an
unqualified message actually needs it, the lease is treated as absent: session
metadata is not permission to keep blocking when authority cannot be resolved.

Stored tab ids are external data like every other storage value. They are now
normalised to unique, non-negative integers before `.includes` or `.filter` can
touch them. The popup copy was also corrected: blocking depends on a running
focus block, not on whether a Mono tab is open.

**2026-09-07 — The extension gets an operational document, not another copy of
its implementation.**

The extension's stable model had outgrown a README section, while accumulating
the same protocol detail in `CLAUDE.md`, this decision log, source docblocks, and
an ignored track document. That made the context discoverable only in the
original working tree and made drift more likely than omission.

`docs/extension.md` now owns the current cross-file boundary: invariants,
authority, storage and rule lifecycle, end-early recovery, permissions, and the
verification gate. The root agent document keeps only the repository-wide
invariants and a mandatory pointer. The README remains a product overview,
source docblocks retain local ordering facts, `docs/manual-qa.md` retains
installed-browser checks, and this file remains the historical explanation of
why policy changed. The WIP was used as source material rather than promoted
verbatim; volatile status, dated counts, release notes, and repeated local
implementation commentary do not belong in the permanent reference.
Store-submission prerequisites and the reviewer path were retained in the
operational document before the superseded WIP was deleted.

**2026-09-07 (review follow-up) — Delivery, focus, and permission coverage are
separate facts.**

A stale interstitial cannot end the newer block it does not name, but refusing
it still owes the user a route to Mono. Reconciliation is therefore
best-effort on that branch: a refused DNR update retains its repair evidence and
cannot consume the navigation that answers the click.

Conversely, document-targeted delivery resolving is already evidence that the
publisher received the request. A later tab or window focus failure does not
undo that fact and does not prove the tab died; opening a fresh page there made
a duplicate out of a presentation failure. Rules now fail open with the pending
request preserved, while fresh-page recovery remains exclusive to failed
delivery or missing routing.

Chrome host permissions form a coverage relation rather than one boolean per
row. A parent-domain grant can supply a child entry, so revoking the parent must
be followed by a canonical permission read for every survivor. The fake models
that same subsumption, and the popup shows permission state as unavailable if
the refresh itself fails rather than leaving a confident stale label.

Finally, the first intent after page load is itself an authority decision when
Chrome has cleared the publisher lease. Mono currently makes that safe because
its local-storage adapter rehydrates synchronously before publishing. The first
reload message is now asserted to be the restored running block; any future
asynchronous persistence must gate publishing on hydration instead of emitting
an anonymous idle first.
