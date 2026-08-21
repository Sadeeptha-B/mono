# Mono — context handover

Authoritative description of the codebase as it stands. Written for someone (or
some agent) picking this up cold. It covers what exists, why it is shaped this
way, and — most importantly — the decisions that were made deliberately and
should not be quietly undone.

Verified state at time of writing: `tsc -b` clean under strict mode, **110 unit
tests** (3 files) and **11 Playwright e2e tests** passing, production build emits
a service worker with 12 precached entries.

---

## 1. What Mono is

A personal focus companion. It shows the clock, learns the shape of your day,
fills the free time with focus blocks, and asks you to name a single purpose
before each one. Original spec is [requirements.md](requirements.md); it has
been extended in conversation and the extensions are recorded in §7.

Single user, single device, no backend, no accounts. Local-first PWA.

## 2. Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 110 unit tests (vitest)
npm run test:e2e   # 11 e2e tests (playwright; builds + previews first)
npm run build      # tsc -b && vite build
npm run typecheck
node scripts/gen-icons.mjs   # regenerate PWA icons from inline SVG
```

Windows dev box, Node 26, npm 11. No lockfile committed decisions of note.
Not currently a git repository.

## 3. The two invariants

Everything else is negotiable. These are not.

### 3.1 The plan is a pure function, not stored state

`derivePlan()` in [src/domain/planner.ts](src/domain/planner.ts) recomputes the
entire future on every call from:

```ts
derivePlan({ now, settings, regions, commitments, history, active, overrides }) → Timeline
```

There is no stored schedule. A break taken, a commitment added, a block
abandoned, the clock advancing — all of it is handled by calling this again.
This is why the timer and the calendar can never disagree: they render the same
derived structure.

Consequences to preserve:
- `derivePlan` never reads the clock (`now` is a parameter) and never generates
  random ids. Planned-block ids are **derived from position**
  (`planned-${kind}-${cursor}`) specifically so re-deriving is idempotent and
  React keys stay stable. Do not switch these to `crypto.randomUUID()`.
- There is a property test asserting `derivePlan(i)` deep-equals `derivePlan(i)`.

### 3.2 Timers are absolute timestamps, never accumulated ticks

Every segment carries an absolute `endsAt`. The UI renders `endsAt - Date.now()`.
The one-second tick in [src/hooks/useNow.ts](src/hooks/useNow.ts) exists *only*
to trigger a re-render.

A throttled, delayed, or entirely skipped tick therefore makes the display
briefly stale but never wrong. Never introduce a `remaining -= 1` counter.

## 4. Layout

```
src/domain/     Pure. No clock, no storage, no React. All the interesting logic.
  types.ts        Vocabulary. Ms everywhere; wall-clock strings only in settings.
  time.ts         The wall-clock ↔ epoch boundary. Region resolution. Formatters.
  planner.ts      derivePlan + bestFill + interval algebra + breakCost.
  events.ts       Event union + reduce (fold) + replay. SessionState lives here.
  machine.ts      Phase machine: (phase, session, action) → (phase, events[]).

src/store/
  session.ts      The ONLY place that reads the clock, makes ids, or persists.
  schema.ts       Reading data Mono did not write: old blobs, imported files.

src/hooks/
  useNow.ts             One shared 1s ticker (useSyncExternalStore).
  useReconciliation.ts  Block completion + away detection + day rollover.
  useNotifications.ts   Gesture-gated audio/permissions, chime, notifications.

src/components/
  stage/          In-place prompts. The left panel's changing content.
  Guide/          The user guide. A route, not a dialog.
  Timeline/       DayCalendar (time axis) + SegmentEditor (dialogs).
  Companion/      The one-line character.
  ui.tsx          Shared buttons + field/label classes + StagePrompt.
  prompts/Dialog.tsx  Radix dialog shell (settings + timeline editors only).

src/pwa/registerServiceWorker.ts   Defers SW updates until idle.
e2e/focus-session.spec.ts          All 8 e2e tests.
```

Roughly 5,450 lines including tests; ~1,100 of that is the pure domain and
~1,050 is domain tests.

## 5. Domain model

### 5.1 Core types ([types.ts](src/domain/types.ts))

```ts
type Ms = number                                    // epoch milliseconds, always
type BlockKind = 'deep' | 'short' | 'reflect'
type PlannerPolicy = 'prefer-deep' | 'maximise-focus'

type DefaultRegion = { start: string; end: string } // "09:00" — recurring shape
type WorkRegion    = { id; startsAt: Ms; endsAt: Ms }// resolved onto a day
type Commitment    = { id; title; startsAt: Ms; durationMin }
type PlannedBreak  = { id; startsAt: Ms; durationMin }

type Settings = {
  deepMinutes: 45, shortMinutes: 20, reflectMinutes: 5,
  defaultRegions: [{ start: '09:00', end: '18:00' }],
  plannerPolicy: 'prefer-deep',
  notificationsEnabled: false, soundEnabled: true,
}
```

`Timeline` = `{ now, horizon, regions: Interval[], entries: TimelineEntry[] }`.

`TimelineEntry` is a discriminated union: `past | active | planned-block |
planned-break | commitment | margin`.

### 5.2 The planner algorithm

1. `planFrom = active ? max(now, active.endsAt) : now`. A running block is never
   re-planned; it owns its slot.
2. `workRegions = mergeIntervals(regions)` — the **positive space**.
3. `horizon = last region's end ?? now`. No regions ⇒ empty plan, not a guess.
4. `busy = mergeIntervals(upcoming commitments ∪ upcoming pinned breaks)`.
5. For each region: `subtractIntervals(region ∩ [planFrom, ∞), busy)` → free
   segments, each filled independently.
6. Sort all entries chronologically.

**Segment fill (`bestFill`) is not greedy.** It enumerates every
`(deepCount, shortCount)` pair that fits and ranks by policy:

| segment | `prefer-deep` (default) | `maximise-focus` |
|---|---|---|
| 50 min | 1 deep, 5 dead | 1 deep, 5 dead |
| 60 min | 1 deep, **15 dead** | 3 short, 0 dead |
| 120 min | 2 deep + 1 short, 10 dead | **6 short**, 0 dead |

The search space is `available / deepMinutes` — single digits. `bestFill` guards
against zero/negative durations so bad settings cannot hang it.

**Why `prefer-deep` is the default:** `maximise-focus` wins on raw minutes but
does so by almost never scheduling a deep block, because 20 divides more finely
than 45. A two-hour afternoon becomes six short blocks. That defeats the app's
premise and contradicts the requirements ("large if time is sufficient").
This was changed *after* being implemented the other way. Do not flip it back.

**Property-tested invariants** (fast-check, in
[planner.test.ts](src/domain/planner.test.ts)):
- Never plans before `now` or beyond the horizon.
- Never plans a block outside a work region.
- Never overlaps a planned block with a break or a commitment.
- Never overlaps two planned blocks.
- Every margin gap is strictly shorter than the shortest block.
- Deterministic and idempotent for fixed `now`.
- Entries are chronologically ordered; no entry ends before it starts.

Note: commitments *may* legitimately overlap each other (double-booking). An
earlier, stricter invariant asserting otherwise was wrong and was relaxed.

### 5.3 Event log ([events.ts](src/domain/events.ts))

`SessionState` is a fold over an append-only `MonoEvent[]`. Only the log is
persisted; everything else is rebuilt from it.

```ts
type SessionState = {
  settings, commitments[], history[],   // history is immutable, forever
  active: ActiveSegment | null,          // at most one running segment
  overrides: PlannedBreak[],             // user-pinned future breaks
  regionOverrides: WorkRegion[] | null,  // null = follow the default shape
  dayKey: string | null,
}
```

Events: `settings/changed`, `commitment/added|updated|removed`, `region/set`,
`break/planned|removed|started|ended`, `block/started|purposeSet|completed|abandoned`,
`away/recorded`, `day/reset`.

Notable reducer behaviour:
- `commitment/added` and `commitment/updated` **clear every not-yet-started
  break**. Deliberate and blunt; the UI warns about it. Breaks already under way
  are untouched.
- `region/set` replaces the whole day's shape at once rather than patching
  individual regions — editing one edge frequently has to split or merge
  neighbours, and one authoritative list makes that trivial.
- `block/started` and `break/started` close any open segment first, so a
  malformed replayed log cannot strand one.
- `day/reset` keeps history forever, drops commitments already past, clears
  pinned breaks, and sets `regionOverrides` back to `null`.

### 5.4 State machine ([machine.ts](src/domain/machine.ts))

`transition(phase, session, action, deps) → { phase, events[] }`. Pure: `at`
rides on every action, `deps.newId` is injected.

```
idle ──startBlock──▶ definingPurpose ──setPurpose──▶ focusing
                          │                              │
                    cannotDecide                   timerElapsed
                          ▼                              ▼
                   reflecting (5m) ──────▶        blockComplete
                                                  │           │
                                             skipBreak    takeBreak
                                                  │           ▼
                                                  │      choosingBreak
                                                  ▼           ▼
                                          definingPurpose   onBreak ──▶ idle
```

- `awayDetected` outranks every phase and jumps to `reconciling`.
- `focusing` also accepts `abandonBlock`. There is **no pause** — see §7.
- `reflecting` is a real `reflect` block: it consumes plan time and lands in
  history like anything else, not a special case outside the model.
- **Phase is deliberately not persisted.** It is which prompt is open, and a
  reload should not resurrect a stale one. A *running segment* must survive
  though, so `phaseForActive()` in the store rebuilds `focusing` / `reflecting` /
  `onBreak` from the replayed log. This was a real bug (reload mid-block offered
  "Start block") caught by an e2e test.

## 6. Timer correctness

This is the subtle part. [useReconciliation.ts](src/hooks/useReconciliation.ts).

**Block completion is detected three ways and none is trusted alone:**
1. A `setTimeout` armed for `endsAt`.
2. The wake events (`visibilitychange`, `focus`) in `useNow`'s subscribe.
3. A check on every tick.

An `elapsedFor` ref keyed on `active.id` makes whichever fires second a no-op.

**Away detection.** `AWAY_THRESHOLD_MS = 90_000` — just above the ~1 tick/minute
that browsers throttle background tabs to. A gap larger than that, *or a
backwards clock jump* (NTP correction, timezone change), means elapsed time is
untrustworthy.

**Away is detected two ways, because there are two ways to miss the boundary.**
A gap between ticks catches a frozen tab or a sleeping machine. A *fresh mount*
has no previous tick to compare against, so it instead asks whether the running
segment is already more than `AWAY_THRESHOLD_MS` overdue: if it were, we could
not have been watching, because watching would have caught the boundary within
a tick. That second test is what makes closing the tab cost the same as sleeping
the machine — without it, reopening hours later banked the block as completed.

**The rule that matters: never silently auto-complete.** If we were away across a
block boundary, the user is asked. Banking a 45-minute block they spent at lunch
would poison the history, and the history is the point. On resolution the block
is credited at `active.endsAt` — *not* at `now` — and the unaccounted stretch is
recorded as an `away` segment so the day still adds up.

**Honest limitation:** without a push server, a notification fired from a frozen
tab can be delayed or dropped. The reconcile-on-wake path is the guarantee, not
the notification. The settings panel says so; keep it saying so.

## 7. Settled decisions — do not relitigate

Each of these was decided explicitly, several after being built the other way.

| Decision | Why |
|---|---|
| `prefer-deep` planner default | `maximise-focus` degenerates to all-short-blocks (§5.2) |
| Breaks are **never** auto-planned | The timeline shows maximum available focus, so a break is a visible trade. `breakCost()` prices it live in the prompt. |
| Adding a commitment clears all future breaks | User's explicit call, "for simplicity". Scoped to not-yet-started breaks; a toast says so. |
| Abandon, but **no pause** | A paused timer means `endsAt` is no longer a fixed instant. That is where timer bugs come from. |
| Never auto-complete after being away | See §6. |
| Prompts are **inline on the stage**, not modals | "Do you need a break?" is only answerable while you can see the rest of the day. Dialogs are reserved for genuine asides: settings, and the calendar's own editors. |
| Work regions (positive) replaced `dayEndsAt` | A single end-time could not express an unstructured evening with work after it, and once the clock passed it, it silently fell back to midnight. Regions define where planning may happen; a gap is simply unplanned. |
| Regions: recurring default + per-day override | `settings.defaultRegions` is the shape; `session.regionOverrides` is `null` until a day is customised. Today's regions are **derived, not seeded**, so changing the default reshapes every uncustomised day immediately. |
| One shape for all days | No weekday/weekend split. Per-day edits cover exceptions. |
| Outside working hours, Mono says so | It names the next stretch and refuses to offer a block. The escape hatch changes the declared hours, so working anyway means saying so. |
| Midnight reset never mid-block | `checkDayRollover` returns early while `session.active` is non-null. |
| Commitment outside every region | Shows on the calendar, does **not** extend the horizon. |
| Margin always rounds down | 50 minutes holds one block and five dead minutes, never more. |

## 8. Traps

Things that have already bitten, or will.

**`now` ticks every second — never put it in a `useEffect` dependency list.**
This caused a real bug: the commitment form reset itself once a second, which
reads while typing as the field clearing on every keystroke. The fix is
`useSeedOnOpen` in [SegmentEditor.tsx](src/components/Timeline/SegmentEditor.tsx),
which seeds on open only and reads the current time through a ref. There is a
regression test that types with the real clock running. Reading `now` during
*render* is fine; writing it into state on a tick is not.

**Playwright `clock.install()` keeps ticking.** You must also call
`clock.pauseAt(time)` or block arithmetic drifts by a few hundred milliseconds —
enough to turn a 180-minute runway into 179.9 and cost a whole deep block. This
produced a confusing "planner bug" that was not one.

**Playwright locators are substring and case-insensitive by default.** Every one
of these has already caused a strict-mode violation here:

| Query | Also matches |
|---|---|
| `getByLabel('At')` | "Wh**at**" |
| `getByRole('button', { name: '5m' })` | "1**5m**" |
| `getByText('2 PM')` | "1**2 PM**" |
| `getByRole('button', { name: 'Hours' })` | "Change today's **hours**" |

Use `{ exact: true }` liberally. Scope with `stage(page)` (`role=main`) vs
`calendar(page)` (`role=complementary`) — the same text often appears in both.

**Calendar blocks are found by `title`**, e.g. `Deep · 2:00 PM · 45m`. The e2e
helper `blocksOf(page, 'Deep')` relies on this format. Changing the title
attribute breaks tests.

**`exactOptionalPropertyTypes` is on.** That is why you see
`...(detail === undefined ? {} : { detail })` rather than `detail`. Also
`noUncheckedIndexedAccess`, hence the `!` and `?.` on array access.

**Tailwind v4, no config file.** The theme lives in an `@theme` block in
[src/index.css](src/index.css). There is no `tailwind.config.js`.

**Service worker updates are deferred until idle**
([registerServiceWorker.ts](src/pwa/registerServiceWorker.ts)) — reloading
mid-block would destroy a focus session. It subscribes to the store and flushes
when `active === null && phase === 'idle'`.

**Regions do not wrap past midnight.** `regionsForDay` drops any region whose
end is not after its start. A late stretch ends at 23:59. Supporting overnight
regions would complicate the whole day-scoped model.

**Zustand's `persist` rehydrates synchronously, during module evaluation.**
With a sync storage the "thenable" it wraps `getItem` in runs immediately, so
`migrate` and `onRehydrateStorage` execute at the `create(...)` call — before
any `const` declared *below* it in the same file exists. `migrate` used to call
a `const` helper from the bottom of `session.ts`, hit its temporal dead zone,
and zustand's hydrate path swallowed the ReferenceError: the store silently kept
its initial state, so a v1 log was wiped rather than migrated, and the only
symptom was an empty app. Anything reachable from those two hooks now lives in
`schema.ts`, where it is a module import and cannot be in a dead zone. If you
add a helper for them, do not declare it after the store.

**Perf note:** `App` re-renders every second and `derivePlan` runs on each tick.
Cheap at this scale, and measurably fine, but it is the first place to look if
the calendar ever feels sluggish.

## 9. UI architecture

Two panels.

**The stage** (`role=main`, left) is the only thing that changes with phase.
[Stage.tsx](src/components/stage/Stage.tsx) switches on `phase.name` and renders
one of: `FirstCommitmentPanel`, `OutsideHoursPanel`, `ReadyPanel`,
`PurposePanel`, `FocusTimer`, `BlockCompletePanel`, `BreakDurationPanel`,
`ReconcilePanel`. Note that `!withinHours` short-circuits the idle branch before
anything else.

**The calendar** (`role=complementary`, right) is
[DayCalendar.tsx](src/components/Timeline/DayCalendar.tsx). Hour rows with
half-hour ticks, blocks absolutely positioned by real duration, work regions
drawn as lit background bands, a "now" marker, past entries dimmed.

- All geometry is **elapsed milliseconds** for both rows and offsets, which
  makes it DST-correct with no special handling — the axis just labels each
  elapsed hour with its wall-clock time.
- `margin` entries are deliberately **not drawn**: on a time axis an empty gap
  already reads as empty. The planner still computes them and tests assert them.
- Region bounds are included in the view range, otherwise a morning region
  renders at a negative offset once the day is under way.
- Overlaps get side-by-side lanes, counted **per overlapping cluster** so one
  collision late in the day does not narrow every block above it. This matters
  for the "commitment added during a running block" case.
- Auto-scrolls to `now` once on mount only — doing it every tick would yank the
  view while the user is scrolling.

**There are two views**, behind a hash check in
[useRoute.ts](src/hooks/useRoute.ts) rather than a router: the day, and the
guide at `#/guide`. `App` swaps what it *renders* after all its hooks have run,
so the ticker, reconciliation and alerts stay mounted and a block in flight
keeps running while the guide is open. The guide's header carries a live strip
for exactly that case — a page invites you to stay, so the timer has to come
with you. Header entries are real `<a href>`s so the guide opens in its own tab
and survives a reload.

**Dialogs** ([prompts/Dialog.tsx](src/components/prompts/Dialog.tsx)) are
bounded by the viewport, not by their content: the title is pinned, the body
scrolls, and a hairline appears at whichever edge has more content past it. The
three ways out — the ×, escape, and a click on the backdrop — all appear
together with `onDismiss`, which keeps the promise above: a dialog offers every
way out or none of them.

The backdrop click is an `onClick` on the overlay rather than Radix's
`onPointerDownOutside`, which in this version never fires for a modal dialog
(verified in the browser, not assumed). It is also the more precise mechanism:
a drag that begins inside the card and releases on the backdrop produces no
click on the overlay, so selecting text cannot close a dialog by accident.
Scrolling regions across the app use the `mono-scroll` utility from
[index.css](src/index.css) rather than the browser's default bar, which is a
bright slab against near-black.

**The companion** ([Companion/](src/components/Companion/)) is one continuous
SVG stroke: a body with a head on the end of it. Every mood uses an identical
path command structure — `M` plus four cubics, three of body and one of head —
so Motion can interpolate `d` directly with no morph library. The stroke
doubles as the progress indicator via `pathLength={1}` + `strokeDashoffset`, so
the character draws itself across the block. Hard constraint: it reacts, never
interrupts — motion drops to a ~9s breathe while focusing and stops entirely
under `prefers-reduced-motion`.

**The face is computed, not placed.** A mood declares two things — where the
neck ends and how far the head is tilted — and `pathFor`, `eyeFor` and
`browFor` derive the head's cubic, the eye and the brow from them. One head
shape serves all seven moods, moved and turned rather than redrawn, which is
what keeps it the same animal from state to state. Do not go back to authoring
face coordinates per mood: that is what the code used to do, and the eye in
`focusing` sat fourteen units clear of the head it belonged to.

The division of labour is deliberate. The body carries posture; the face
carries feeling (eye aperture, brow angle and lift, blink rate). Expression
belongs in the face because that is where two degrees of brow outweigh twenty
of spine — and because the body is already spoken for by the progress dash.

## 10. Persistence

Zustand `persist`, `localStorage`, key `mono.session`, `SCHEMA_VERSION = 2`.

`partialize` stores only `{ events, dayKey }`. `onRehydrateStorage` replays the
log and rebuilds phase via `phaseForActive`.

**v1 → v2 migration is real, not a wipe.** A v1 `settings/changed` carrying
`dayEndsAt: '20:00'` is rewritten to
`defaultRegions: [{ start: '09:00', end: '20:00' }]`. Anything older or
unreadable is discarded rather than crashing on boot.

**Import runs the same migration, and then some.** [schema.ts](src/store/schema.ts)
owns everything about reading data Mono did not just write:

- The version stamp is honoured — an older file is migrated, a newer one is
  refused with a message rather than replayed into nonsense.
- Every event is sanitised field by field before `replay` sees it. `replay`
  walks a discriminated union, so a commitment with no `startsAt` is not a bad
  value, it is a crash in `derivePlan` later. An event that cannot be repaired
  is dropped rather than fatal — the user is recovering their history, and most
  of it beats an error message. That includes event *types* this build does not
  know: the `never` at the end of `sanitiseImportedEvent` makes forgetting to
  handle a new type a compile error, while the `return null` under it keeps a
  file from another build merely lossy instead of fatal.
- The day is normalised. A file exported yesterday carries yesterday's
  commitments, pinned breaks and one-off hours, and `checkDayRollover` reads a
  null day marker as a first run — so importing one used to make yesterday's
  shape today's. Import now runs the same `day/reset` midnight runs, under the
  same rule: never across a running segment. The same reasoning is why a
  migrated v1 blob infers its day from the log rather than handing back `null`.

## 11. Testing

- **Unit (vitest, jsdom):** 110 tests across `planner`, `machine`, `time`,
  `store/session` and `components/minutes`. The domain ones are pure and use
  fast-check for the property tests; the store ones boot the module against a
  seeded `localStorage` mock, which is the only way to reach the rehydration
  path. No component mounts.
- **E2E (Playwright, chromium):** 8 tests in
  [e2e/focus-session.spec.ts](e2e/focus-session.spec.ts). `webServer` builds and
  previews on :4173.

`page.clock` does real work in the e2e suite: `fastForward` fires the intervening
timers (an ordinary running block), while `setSystemTime` jumps *without* firing
them — which is exactly what a sleeping laptop looks like to the app. That is how
the reconcile path is tested.

E2E coverage: the full happy path with break costing, sleep-across-a-boundary
reconciliation, the 5-minute priorities timer, reload mid-block, the typing
regression, planning only inside working hours, resuming after an unstructured
gap, and "Day done" once hours are over.

**Manual checks the tests structurally cannot cover** (also in the README):
background the tab for five minutes mid-block and confirm the remaining time is
right; sleep the machine across a block boundary and confirm the reconcile
prompt appears with the correct span.

## 12. Loose ends

- There are **no component tests** — all testing is either pure-domain or full
  e2e. (`jsdom` is in use: it is the vitest environment. `@testing-library/react`
  was installed and unused, and has been removed; `@testing-library/jest-dom` is
  still wired into `src/test/setup.ts`.)
- `App` subscribes to the whole store with a bare `useSession()`, so every store
  change re-renders the shell. It re-renders every second anyway for the clock,
  so this costs nothing today; it is the first thing to slice if that ever stops
  being true.
- `derivePlan` still runs once per tick. `breakCost` no longer doubles it — the
  duration picker is priced against the timeline already on screen.

Not built, and never scoped:

- No history/journal view. The event log captures everything needed for one
  (completed blocks, outcomes, purposes, away spans) but nothing reads it back.
- No cross-device sync. JSON export/import is the escape hatch.
- No weekday-aware default shape.
- No editing of a block's purpose after it starts.
