# Ambient rooms and companion interactivity: continuation context

Status snapshot: 2026-09-04  
Repository: `mono`  
Branch: `main`  
Base `HEAD`: `c723264`  
Implementation state: present in the working tree, not represented by the base commit
Verification state: review-hardened; typecheck, unit, E2E, build and visual QA pass

This document is the handover for Mono's ambient-interactivity track. It is
written for the next engineer or agent who needs to extend, review or release
the work without reconstructing its product logic from a diff.

Read [../CLAUDE.md](../CLAUDE.md) and [decisions.md](decisions.md) first. The
repository is intentionally local-first and event-sourced, the future plan is
always derived, and timers always use absolute timestamps. Those constraints
continue to govern this track.

## Executive summary

The track adds five related capabilities:

1. Four curated dark focus rooms with coordinated semantic palettes.
2. Locally generated Brown, Pink and Rain ambience with explicit opt-in.
3. A larger room-and-cat scene that grows from the current day's completed work.
4. A chronological trail, factual transition milestones and temporary focus-tap previews.
5. A reproducible end-of-day postcard derived from the same event history.

A later UX pass placed room and ambience choices directly in a `Room` dropdown
in the application and guide headers rather than adding them to general
Settings. It also replaced textual ambience controls with speaker icons,
enlarged the full companion and made focus-time taps preview the room's
evolution. Subsequent review passes consolidated derived ownership, removed
geometry and type mirrors, hardened continuous-volume commits, and added
regressions around the day-end/setup seam.

The feature is implemented without accounts, network audio, new runtime
dependencies, analytics, points, global streaks, stored unlocks, saved
companion levels or postcard dismissal state. Room and audio preferences are
persisted; progress and interaction previews are not.

## Current working-tree warning

The track is not isolated in a clean commit. The working tree contains modified
and new files, including `README.md` and `docs/decisions.md`, which already had
changes that had to be preserved and extended. Do not reset, replace or
wholesale regenerate these files. Inspect the diff before editing.

The track's principal new files are:

- `src/ambient/audio.ts`
- `src/ambient/ambient.test.ts`
- `src/ambient/rooms.ts`
- `src/ambient/scene.ts`
- `src/ambient/scene.test.ts`
- `src/ambient/theme.ts`
- `src/ambient/useAmbience.ts`
- `src/ambient/AmbienceButton.tsx`
- `src/ambient/RoomControls.tsx`
- `src/ambient/RoomMenu.tsx`
- `src/domain/dayProgress.ts`
- `src/domain/dayProgress.test.ts`

The main modified integration points are:

- `src/app/App.tsx`
- `src/domain/types.ts`
- `src/store/schema.ts`
- `src/components/Companion/Companion.tsx`
- `src/components/Companion/PixelCat.tsx`
- `src/components/Companion/cat.ts`
- `src/components/Companion/utterances.ts`
- `src/components/stage/Stage.tsx`
- `src/components/stage/IdlePanel.tsx`
- `src/components/stage/stages.ts`
- `src/components/stage/stages.test.ts`
- `src/components/Guide/GuidePage.tsx`
- `src/pip/MiniWindow.tsx`
- `src/pip/MiniPanels.tsx`
- `src/pip/styles.ts`
- `src/pip/useMiniWindow.ts`
- `src/hooks/useNotifications.ts`
- `src/index.css`
- `src/main.tsx`
- `scripts/preview-companion.ts`
- `e2e/focus-session.spec.ts`

Generated `companion-preview.png` and `companion-preview.svg` are intentionally
ignored by Git.

## Product principles and invariants

These are requirements, not implementation accidents.

### Local-first and quiet by default

- Ambient audio defaults to `off`, including for old event logs.
- No room selection may implicitly enable sound.
- Sounds are synthesized with Web Audio. There are no tracks, downloads,
  streaming integrations or network requests.
- The feature adds no account, telemetry or cross-device state.

### Persist preferences, derive progress

- `roomId`, `ambience` and `ambienceVolume` are persisted through the existing
  `settings/changed` event.
- Scene tier, trail, milestone, postcard and cat markings are projections of
  today's history. They are never events.
- The pending active block is provisionally included only during
  `blockComplete`, matching the existing `vitalsFor` rule.
- Abandonment adds an honest gap but never subtracts completed progress.
- Midnight is the reset boundary because projections filter by the day on
  which a segment started. No explicit companion reset is stored.

### Protect the middle of a focus block

- The companion may be lively at phase boundaries but remains restrained while
  focus is running.
- Focus-time tapping is an explicit, brief preview. It does not create a reward
  loop, event, unlock or persistent collection.
- Reduced-motion preferences remove decorative animation while preserving
  earned details and user-requested static preview states.

### One session, two render surfaces

- The main application and Document Picture-in-Picture window are part of one
  React tree. The mini-window is a portal, not a second application root.
- Both surfaces receive the same store, ticker, active segment, day projection,
  room and ambience controls.
- Transient renderer interactions such as gaze, pet animation and focus-tier
  preview remain local to each `PixelCat` instance. Tapping the main cat does
  not animate the mini cat. Persisted and derived factual state remains shared.
- Do not add another reconciler, audio owner or timer to the mini-window.

### Existing timer and planning invariants still apply

- Never store a planned schedule.
- Never accumulate timer ticks; render `endsAt - now`.
- Do not add the one-second `now` value to effects that would run every tick.
- Preserve the existing deferred-midnight behavior while a segment is active.

## 1. Curated focus rooms

The supported identifiers are:

```ts
type RoomId = 'mono' | 'ember' | 'tide' | 'moss'
```

`src/ambient/rooms.ts` is the canonical metadata source for labels, descriptions,
menu indicators, semantic palettes and suggested ambience.

| Room | Character | Menu indicator | Suggested ambience |
| --- | --- | --- | --- |
| Mono | Near-black, neutral, familiar | neutral body grey | Brown noise |
| Ember | Warm charcoal and lamplight | ember orange | Pink noise |
| Tide | Cool blue-black and rain light | tide blue | Rain |
| Moss | Deep green and natural softness | moss green | Brown noise |

Every palette provides the same twelve semantic tokens: `ink`, `surface`,
`raised`, `line`, `muted`, `body`, `bright`, `deep`, `short`, `reflect`, `rest`
and `commit`. Existing UI utilities and SVG fills consume semantic tokens, not
room names. Timeline segments retain textual labels, so color remains
supplementary.

The cat's fur, shade, eyes and paper remain fixed. Only its semantic accent
(ears, nose, tail and ground) follows the current phase and room.

### Applying a room

- `src/main.tsx` reads the synchronously rehydrated Zustand store and calls
  `applyRoomTheme` before the first React paint. This prevents an Ember, Tide or
  Moss session flashing Mono first.
- `applyRoomTheme` sets `data-room` on the document root and updates
  `<meta name="theme-color">` when present. It does not write an inline body
  colour that would permanently outrank the real stylesheet.
- `App` repeats this in a layout effect when `roomId` changes. An open PiP
  document goes through `paint`, which composes `applyRoomTheme` with the
  inline fallback a possibly stylesheet-less document needs.
- `src/index.css` holds the actual CSS custom-property overrides for Ember,
  Tide and Moss; Mono is the `@theme` default.
- The PWA manifest remains static rather than changing with the room. Its
  current background and theme color is `#0b0b0f`, while Mono's runtime `ink`
  is `#08080b`. Treat that inherited mismatch as known state if exact manifest
  parity becomes a release requirement.

There is intentional duplication between the palette values in `rooms.ts` and
`index.css`. `rooms.ts` serves JavaScript, fallbacks and visual QA; CSS needs
literal custom-property declarations for Tailwind. Update both when changing a
palette. Tests parse the authored stylesheet and require every named room block
to equal its metadata palette, and require the `@theme` defaults to equal Mono.
The test locates `index.css` relative to its own module rather than Vitest's
working directory, ignores selectors mentioned in comments, and scans balanced
braces so a nested rule cannot silently truncate a room block.

## 2. Header Room menu

Room and ambient sound controls live in a header dropdown, not in
`SettingsPanel`.

- The main day header and Guide header each mount `RoomMenu` with a unique ID
  prefix.
- The button reads `Room · <name>` at `sm` and above and shortens to `Room` on
  very narrow screens.
- The panel is labeled `Room and ambient sound` and contains room, sound and
  volume controls.
- Each room entry has a distinct palette-derived circular indicator.
- Room and sound choices are separate radio groups.
- Escape closes the menu and returns focus to its trigger. A pointer press
  outside closes it. Selecting an option leaves it open so the user can finish
  adjusting the room, sound and volume together.
- The menu is a non-modal popover-style `role="dialog"`; it is not focus-trapped.
- The volume percentage is outside the range's label and linked with
  `aria-labelledby`, so its accessible name remains `Volume` while the value
  changes.

Settings owns completion-chime, notification, planner, duration, working-hours,
mini-window and import/export preferences. Room/audio controls were never added
there, so the header menu has no second copy to keep synchronized.

The Guide quotes all live settings. Its large section tree is memoized from one
`Settings` snapshot, not a parallel list of individual values; a settings
change replaces the snapshot and rebuilds every quote together, while the
one-second header timer reuses the existing tree. E2E coverage changes a
duration through Settings and verifies the Guide prose updates in place.

## 3. Procedural ambience

The stored selection is:

```ts
type AmbienceSelection = 'off' | 'room' | 'brown' | 'pink' | 'rain'
```

Defaults are:

```ts
roomId: 'mono'
ambience: 'off'
ambienceVolume: 0.35
```

`room` resolves dynamically through the current room's suggestion. A direct
Brown, Pink or Rain selection remains that sound when the room changes.

### Playback intent

Ambience is wanted only when:

- the active segment is a block, and
- the phase is `focusing` or `reflecting`.

It is not wanted during idle, purpose entry, completion decisions, break
selection, breaks, reconciliation or any state with no active block. Phase and
active-segment state are the authority; UI visibility does not drive sound.

### Audio ownership

`src/ambient/audio.ts` is a module-level singleton engine:

- It creates one `AudioContext` only from a user gesture.
- Completion chimes and ambience share the context but use separate gain buses.
- Muting ambience cannot mute the chime.
- A module-level desired intent can exist while the context is locked; the
  next explicit resume gesture reconciles it.
- A `useSyncExternalStore` snapshot exposes `locked`, `running` or `suspended`
  to React without making React own the audio graph.

`useAmbience` is mounted once in `App`, above both render surfaces. It owns the
session-only `muted` boolean. That state survives consecutive blocks while the
tab lives, is shared by the main and mini controls, resets on reload and is
never appended to the event log.

### Synthesis and gain behavior

- Brown, Pink and Rain use deterministic eight-second stereo buffers, cached
  once per kind after first synthesis so crossfades do not regenerate noise on
  the main thread.
- Seeds are fixed per sound kind; synthesis does not consume application
  randomness.
- Buffer tails blend toward the first sample to reduce loop discontinuities.
- Brown and Pink use low-pass filters; Rain uses a high-pass filter.
- UI volume `v` in `[0, 1]` maps to `v² × 0.35` gain. At 50%, gain is `0.0875`.
- Range movement updates the live gain and local percentage, then is appended
  to the settings journal once on pointer release, blur or Room-menu teardown,
  not once per drag step. Teardown covers an outside press removing a
  keyboard-adjusted range before the browser can dispatch blur.
- A sound selected while the range has an uncommitted draft previews at that
  live volume rather than the last journaled value.
- Gain automation uses a `0.0001` floor for exponential ramps.

Current transition timings are:

| Transition | Duration |
| --- | ---: |
| Off to ambience | 1.5 s |
| Ambience to off | 0.8 s |
| Sound-kind change | 0.25 s |
| Mute, resume or same-kind volume reconciliation | 0.15 s |
| Idle selection preview | 6 s total; 0.25 s entry and 0.8 s retirement |

Choosing a sound while idle explicitly unlocks audio and previews it. Choosing
one during a live focus block updates the live intent. Choosing Off stops the
preview/live ambience. Changing rooms while `Room sound` is active causes the
resolved kind to change and crossfade reactively.

Session mute governs derived live-block ambience, not an explicit idle sound
selection. Choosing a sound in the Room menu is the gesture asking to hear its
six-second preview, even if the preceding running block had been muted. This is
intentional; do not make preview audibility depend on a mute control that is not
available while idle.

### Browser gesture and restored sessions

`unlockOnGesture` now unlocks the shared audio engine from the same Start click
that requests notification permission. `playChime` does not create a context by
itself.

After reloading a running block, intent exists but the browser context is
locked. The visible ambience button therefore presents its accessible action
as `Resume ambience`; clicking it supplies the required gesture. Do not attempt
autoplay workarounds.

### Timer controls

`AmbienceButton` is an icon-only 42×42 button:

- sound waves mean ambience is running;
- a crossed speaker means it is muted or the context needs resuming;
- `aria-label` and `title` remain `Mute ambience` or `Resume ambience`.

It appears beside `End early` in both timer surfaces only when a non-Off sound
is resolved and a focus/priorities block is actively running. It is absent for
breaks and idle states.

## 4. Evolving companion scene

The full companion renderer uses one 48×24 SVG. Scenery, ground, trail and cat
are deliberately in the same SVG so theme, scaling, progress and motion rules
cannot drift between layers.

Room shell, tiered scenery, milestone pixels and trail shapes are DOM-free data
in `src/ambient/scene.ts`. `PixelCat` renders that data as SVG; the Node visual-QA
script paints the same shapes directly. There is no second coordinate table to
keep synchronized. `SceneTier` also comes from this module, while `TrailKind`
comes from `dayProgress.ts`; the preview script imports both as type-only
dependencies rather than redeclaring them.

The floor is intentionally `SPRITE_TOP + SPRITE_H`. `scene.ts` stays independent
of component frame values so it remains trivial for the Node script to load,
and `scene.test.ts` enforces the cross-module invariant. Changing the authored
sprite height without moving the floor therefore fails before the cat's feet,
room shell and trail can detach from one another.

The default full-scene sizing is:

- compact/mobile: `112 × 64` CSS pixels;
- `sm`: `224 × 112`;
- `lg`: `256 × 128`;
- mini-window: `112 × 64`.

The application header keeps the existing `44 × 28` head-only crop. Crop top is
derived from each pose's face anchor so lower resting/away poses remain visible.

### Room growth

`sceneTier` uses completed, non-reflection focus blocks:

| Completed focus blocks | Scene tier |
| ---: | ---: |
| 0 | 0 |
| 1–2 | 1 |
| 3–5 | 2 |
| 6+ | 3 |

Room-specific earned details are:

| Room | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Mono | lamp and glow | first stars | constellation |
| Ember | hearth glow | mug and steam on the right desk | books beside the mug |
| Tide | raindrops | window reflection | distant lights |
| Moss | sprout | leaves | flower |

Cat markings are a related but separate projection: first markings at three
completed blocks, fuller markings at six. The helper is `markTierFor` in
`cat.ts`.

### Motion

- A running block moves the cat across the ground according to absolute
  `startedAt`/`endsAt` progress.
- Breaks do not make the cat walk.
- Mood loops define slow blinks and phase-boundary reactions.
- Ember glow and Tide rain have subtle active motion.
- `prefers-reduced-motion` disables step timers, gaze movement, lift, walking
  transition and decorative CSS animation. Earned scenery stays visible.
- Infinite Motion transitions are created only when animation is active;
  reduced-motion and inactive scenery do not retain no-op repeat loops.

`RoomScene` and `Trail` are memoized because their inputs are stable while the
cat's block progress ticks every second. The cat is deliberately foreground:
it crosses in front of some room objects as it walks. Scenery is distributed
across the widened room so the common idle/postcard state remains legible; a
vertical redesign that moved every object above the cat was reviewed and
rejected as a larger change to the rooms' character.

## 5. Focus-tap preview

During `focusing`, the interactive cat button is labeled approximately
`Encourage Mono and preview the room. Mono is focusing…`.

Each tap:

- plays a short happy/squint acknowledgement with no hop or heart;
- advances a local temporary scene tier;
- maps tier 1/2/3 to cat marking tier 0/1/2;
- restarts a 1.4-second reset timer.

The first preview starts one tier after the factual tier and wraps from tier 3
back to tier 1, so repeated taps always demonstrate the full evolution. This
means a tier-2 or tier-3 day can temporarily show an earlier room and fewer cat
markings. That visible regression is intentional: the tap is an interactive
tour, not a claim that the earned state changed. When the timer expires or the
mood changes, the renderer returns to the factual scene and marking tiers
derived from history.

The preview state belongs to `PixelCat`, not the store or `dayProgressFor`.
This is important: it is a demonstration, not earned progress. Under reduced
motion the selected tier and first reaction frame still appear statically
because the user explicitly requested them.

Outside focus, tapping retains the existing mood-specific pet response. Gaze
tracking is disabled during focus and away states.

## 6. Same-day progress and trail

`dayProgressFor(history, now, pending?)` is a pure domain projection returning:

- completed focus block count;
- deep/short split;
- completed focus minutes;
- completed timed-break count and minutes;
- scene tier;
- chronological trail entries;
- a milestone for a pending completion, if any;
- purpose and duration of the longest completed focus block with a nonblank
  purpose.

Durations are clamped nonnegative and exposed as whole minutes rounded down.
Reflection blocks do not count as focus; they do appear in the trail.
`isBankedFocus` in `vitals.ts` is the single predicate for completed deep/short
focus classification and is reused by `dayProgress.ts`. Companion markings use
`dayProgress.blocks`; the separate vitals fold remains because utterances also
need focus minutes and the current run length.

Trail language is:

| History fact | Trail mark |
| --- | --- |
| Completed deep block | large warm stone |
| Completed short block | small cool pebble |
| Completed reflection | purple lantern |
| Completed break | green tuft |
| Abandoned block | unlit gap |
| Away span | unlit gap |
| More than 32 facts | muted aggregate mark plus latest 31 |

The aggregate entry carries the number of earlier facts in its `count`, though
the current decorative renderer does not print that number.

Trail marks use the same 1.5-pixel pitch as the 32-entry cap and extend from
the left as the day grows. Sparse days therefore read as the beginning of one
chronological path rather than distributing a few unrelated marks across the
whole room. Marker size is the corresponding fixed 0.6 scale; `trailShapes`
expects the domain projection's maximum of 32 entries. The fixed scale is named
directly rather than presented as an adaptive clamp that never changed for a
valid, capped trail.

The projection consumes history in append order and retains the first longest
block because it replaces the candidate only on a strictly longer duration.
The postcard labels this as a block and prints its duration; it does not imply
that adjacent blocks are one uninterrupted stretch. This assumes the
event-derived history remains chronological, as it is today.

## 7. Transition milestones

Milestones are computed only for a provisionally completed pending focus block.
They are not stored. Priority is:

1. Crossing 90 completed focus minutes.
2. Crossing three completed focus blocks in the current run.
3. First completed deep block.
4. First completed focus block.
5. Recovery: the preceding consequential item is an abandoned focus block.
6. Return: the immediately preceding item is a completed break.

Recovery and return are reconstructed from earlier completions and each is
shown at most once per day. The four one-time facts come first because their
only crossing must not be permanently hidden by a transition that can recur.

Reconstruction replays milestone selection for earlier banked focus blocks and
is O(n²), deliberately bounded here to already-filtered current-day history and
memoized by App. A completion banked through away reconciliation can consume a
recovery or return remark even though no live completion seam displayed it;
that is the accepted consequence of deriving remarks rather than persisting
another event.

Breaks and completed reflection blocks are transparent for recovery/streak
logic. An away span is consequential and blocks recovery until a later
abandonment creates a new opportunity.

Fixed remarks are:

- `Back on the trail.`
- `Rest did its job.`
- `90 minutes banked.`
- `3 in a row.`
- `First deep block.`
- `First one today.`

`utteranceFor` gives the milestone remark precedence in the `complete` mood.
The scene draws a three-pixel milestone sparkle while the pending completion
state exists. It is a seam-local visual, not persisted animation state.

## 8. End-of-day postcard

The stage's outside-hours state becomes a postcard when:

- the phase is idle;
- the opening setup questions are closed;
- at least one work region exists;
- now is past the final region; and
- there is no later work region today.

`dayDoneFor` in `src/components/stage/stages.ts` owns this predicate. App uses
its result both to hide the ordinary companion and to tell Stage to show the
postcard; Stage does not reconstruct a second, slightly different answer.

The full card shows completed focus duration, block count, deep/short split,
break count and duration, one prominent completed room scene, full trail and
the purpose plus duration of the earliest longest completed focus block. The
ordinary stage companion is omitted in this state, so the same room is not
drawn twice. Blank purposes are ignored.

With no completed focus it says `Nothing banked today`; it is not styled as an
error or failure, and the redundant `0 blocks · 0 deep · 0 short` row is
omitted. `Change today's hours` remains available. Extending today's hours
causes normal planning state to replace the card immediately.

The companion and postcard use the shared `dayProgressLabel` helper for their
accessible block/minute summary, including singular forms such as `1 focus
block` and `1 focus minute`.

The mini-window shows a compact day-end line with block count and focus
duration. Neither surface stores postcard or dismissal state.

## 9. Picture-in-Picture behavior

The mini-window receives its room before becoming visible:

1. `useMiniWindow` requests the document PiP window only from a user gesture.
2. It installs the `pagehide` listener before awaiting any stylesheet.
3. `paint` sets `data-room`, background, body text color, font and margin as an
   inline fallback.
4. Stylesheets are cloned from the opener.
5. A two-second timeout uses the mini-window's own timer, avoiding hidden-tab
   throttling.
6. The React portal is mounted only after styles load/fail or the timeout wins.

An open PiP document is updated reactively when the room changes. The window
borrows its own timer for the shared `useNow` ticker, suppresses redundant
notifications while visible and delays service-worker replacement that would
destroy it.

Document PiP permits one window per document and offers no screen-coordinate
API. Do not design this track around multiple always-on-top windows. Chromium
reuses the user's previous placement when Mono does not request a preferred
initial placement.

## 10. Visual QA generator

`npm run companion` now generates a 1264×2224 visual QA sheet in both PNG and
SVG form. The current sheet contains 37 full-scene checks and seven header
crops:

- all four rooms at tiers 0–3;
- corresponding cat markings;
- representative phase poses;
- purpose-note and progress states;
- milestone sparkle;
- three consecutive focus-tap previews;
- every trail semantic, an aggregate example and the 32-entry compression cap;
- normal and enlarged header crops.

The script imports authored frame grids, canonical room metadata and the pure
room/trail geometry from `src/ambient/scene.ts`. It does not import `PixelCat`,
because doing so would pull React, Motion and browser assumptions into a plain
Node generator. Both renderers therefore share coordinates without making the
generator depend on a DOM. Its `SceneTier` and `TrailKind` annotations are also
imported from their owning modules rather than maintained as local unions.

The generated files are review artifacts and are ignored by Git. Run the
command and inspect the PNG; successful generation alone cannot detect poor
contrast, overlap or a visually meaningless earned tier.

## Persistence and schema

The public settings additions are in `src/domain/types.ts`:

```ts
type RoomId = 'mono' | 'ember' | 'tide' | 'moss'
type AmbienceSelection = 'off' | 'room' | 'brown' | 'pink' | 'rain'

roomId: RoomId
ambience: AmbienceSelection
ambienceVolume: number // stored 0–1
```

The schema remains version 2. This is deliberate: old logs need no rewrite.
Missing settings fold through `DEFAULT_SETTINGS`, leaving old installs on Mono
and silent.

Import sanitization accepts only known room/sound identifiers and finite volume
values from 0 through 1. A malformed settings patch event is discarded rather
than partially trusted. Tests cover valid ambient settings and the missing-field
silent default. There is not yet a focused test for every malformed room/audio
variant; the sanitizer logic itself is present.

Do not persist session mute, scene tier, trail, milestones, tap previews or the
postcard. Doing so would create two authorities: the saved value and the event
history from which the value is already derivable.

## Runtime data flow

The central flow is:

```text
append-only events
      |
      v
replayed SessionState ---------------------> Settings
      |                                         |
      |                                         +--> data-room / CSS palette
      |                                         +--> ambience selection + volume
      |
      +--> history --> vitalsFor ----------> markings + factual utterance
      |
      +--> history --> dayProgressFor -----> scene tier / trail / milestone / postcard
      |
      +--> active segment + phase ---------> walk progress / ambience intent

App owns useAmbience and dayProgress
      |
      +--> main Stage + Companion
      +--> portal -> MiniWindow + Companion
```

App memoizes `dayProgressFor` by history, pending completion and local day key;
the one-second `now` tick is intentionally absent because the projection only
changes when the local calendar day changes. App also evaluates `dayDoneFor`
once and passes that answer to Stage, so postcard rendering and ordinary-cat
visibility cannot disagree while setup is open.

At `blockComplete`, both `vitalsFor` and `dayProgressFor` receive the still-open
active block as `pending`. They synthesize a completed block at `endsAt` for
display only. The event is still appended only when the user resolves the
completion prompt.

## File ownership map

| Concern | Authority |
| --- | --- |
| Room IDs, labels, palette metadata, suggested sound | `src/ambient/rooms.ts` |
| Room and trail geometry | `src/ambient/scene.ts` |
| Runtime CSS room tokens | `src/index.css` |
| Pre-paint and reactive document theme | `src/ambient/theme.ts`, `src/main.tsx`, `src/app/App.tsx` |
| Header room/audio UI | `src/ambient/RoomMenu.tsx`, `RoomControls.tsx` |
| Audio graph, synthesis, fades, preview and chime bus | `src/ambient/audio.ts` |
| Phase-derived sound intent and session mute | `src/ambient/useAmbience.ts` |
| Timer speaker button | `src/ambient/AmbienceButton.tsx` |
| Day counts, trail, scene tier, milestone, longest block | `src/domain/dayProgress.ts` |
| Completed-focus classification | `src/domain/vitals.ts` (`isBankedFocus`) |
| Cat mood, movement, marking thresholds | `src/components/Companion/cat.ts` |
| SVG rendering and transient tap preview | `src/components/Companion/PixelCat.tsx` |
| Completed-day/postcard predicate | `src/components/stage/stages.ts` |
| Shared day projection | `src/app/App.tsx` |
| Vitals-to-companion assembly | `src/components/Companion/Companion.tsx` |
| Milestone/factual seam copy | `src/components/Companion/utterances.ts` |
| Main postcard | `src/components/stage/IdlePanel.tsx` |
| Mini day-end summary and controls | `src/pip/MiniPanels.tsx`, `MiniWindow.tsx` |
| PiP room fallback and stylesheet loading | `src/pip/styles.ts`, `useMiniWindow.ts` |
| Persistence/import boundary | `src/domain/types.ts`, `src/store/schema.ts` |
| Visual review artifact | `scripts/preview-companion.ts` |
| Live Guide settings prose | `src/components/Guide/GuidePage.tsx` |

## Automated coverage and last verification

Current unit coverage includes:

- room-sound resolution and direct overrides;
- ambience intent by phase;
- squared and bounded volume gain;
- palette completeness, basic contrast and exact CSS/metadata parity;
- comment-safe, balanced CSS palette parsing independent of the test cwd;
- unique palette-derived menu indicators;
- floor/sprite alignment and sparse/capped trail geometry;
- day summary counts and durations;
- companion-summary singular/plural copy;
- earliest-longest-block tie behavior and duration;
- pending block accounting, milestone priority and once-per-day transitions;
- trail gaps and overflow aggregation;
- imported ambient settings and old-log silent defaults;
- planner property generators including the new settings;
- shared completed-day predicate, including setup outranking the postcard.

Current E2E coverage includes:

- Room-menu selection and four visible swatches;
- room persistence across reload;
- root and meta theme updates;
- PiP document room propagation through the iframe stand-in;
- silent default and ambient sound opt-in;
- shared main/mini mute state through icon controls;
- one journal entry per committed volume, including keyboard adjustment followed by outside dismissal;
- enlarged desktop companion width;
- focus-tap scene/mark tier sequence and reset;
- end-of-day postcard summary, single completed scene and setup-revisit restoration;
- Guide duration prose updating from one changed settings snapshot;
- the existing narrow/wide layout regression suite.

Last verified in this working tree or against the same runtime code:

| Command | Result |
| --- | --- |
| `npm run companion` | passed; 37 scene checks and 7 crops generated |
| `npm run typecheck` | passed after the review changes |
| `npm test` | 15 files, 334 tests passed |
| `npm run test:e2e` | 64 tests passed after the review changes |
| `npm run build` | passed after the review changes |
| `git diff --check` | clean |

The Vite build emits the existing warning that the main JavaScript chunk is
larger than 500 kB. No dependency was added by this track.

## Coverage gaps and manual verification still required

Do not infer more coverage than exists.

### Audio

There is no mocked-`AudioContext` unit suite asserting exact automation calls,
source retirement or buffer seam samples. Fade/crossfade durations are encoded
in `audio.ts` and described above, but are not directly unit-tested as command
sequences.

Real audio must still be checked in Chrome and Edge for:

- initial start after a gesture;
- all three loop seams;
- sound changes and crossfades;
- mute/resume from each surface;
- reload during an active block;
- background-tab behavior;
- sleep and reconciliation;
- break and abandonment shutdown;
- completion-chime independence;
- device-output changes and context suspension.

### Real Picture-in-Picture

Playwright uses an iframe stand-in. It does not prove real always-on-top window
behavior, stylesheet timing, cross-monitor placement or browser chrome.

Manually inspect all rooms in a real PiP window, including a deliberately slow
or failed stylesheet, resizing below the opening hint and reopening after moving
the window to another monitor.

### Accessibility and motion

The implementation honors `prefers-reduced-motion`, labels icon buttons and
keeps trail/scenery decorative, but no current E2E test emulates reduced motion.
The interactive companion's accessible summary currently reports focus blocks
and focus minutes; it does not enumerate breaks, gaps or aggregate trail count.
If the requirement becomes “complete day summary” for nonvisual users, extend
`progressLabel` rather than making every decorative marker individually
discoverable.

The Room dropdown is keyboard-reachable and Escape-aware, but it does not move
focus into the panel on open or trap focus. That is acceptable for the current
non-modal popover behavior; reassess if its semantics or complexity expands.

### Postcard

The current E2E check proves the final-region appearance, summary and longest
block duration. It does not explicitly test disappearance after extending hours
or all longest-block tie/blank permutations through the UI. The domain test
covers the earliest tie.

## Intentional non-goals

Do not add these incidentally while extending the track:

- light themes;
- arbitrary color pickers;
- Spotify, Apple Music or external track integrations;
- downloadable or shareable postcards;
- long-term room collections;
- persistent levels, points, currencies or unlock checklists;
- global streak pressure;
- analytics;
- accounts or synchronization;
- multiple PiP windows;
- pausable focus timers.

Any proposal to add one of these is a product-scope decision, not a small
continuation of the existing architecture.

## Safe extension playbooks

### Add or change a room

1. Update `RoomId` and `ROOMS` metadata.
2. Add/update all twelve CSS tokens in `index.css`.
3. Add import validation in `sanitiseSettingsPatch`.
4. Add/update scenery once in `src/ambient/scene.ts`.
5. Confirm both renderers understand any new shape field.
6. Add palette contrast, indicator and sound-resolution assertions.
7. Run `npm run companion` and compare all tiers visually.
8. Verify pre-paint, Guide, meta theme and real PiP fallback.

Do not tint the cat's fixed fur to make a room look more different. Room
identity belongs in surfaces, semantic accents and scenery.

### Add or change an ambience kind

1. Extend `AmbienceSelection` and, if procedural, `AmbienceKind`.
2. Update room suggestions and Room-menu labels.
3. Update import validation.
4. Define deterministic buffer synthesis and filter behavior in `audio.ts`.
5. Preserve separate chime and ambience buses.
6. Preserve explicit user-gesture creation/resume.
7. Test direct override versus `Room sound` resolution.
8. Listen to loop seams and crossfades on real devices.

Do not make room selection itself an audio opt-in.

### Change scene tiers or markings

1. Change the pure threshold in `dayProgressFor` or `markTierFor`.
2. Keep pending-block behavior aligned with `vitalsFor`.
3. Update the focus-tap preview mapping if tier counts change.
4. Update every room's shared scenery definition.
5. Add domain threshold tests and E2E completion/non-regression coverage.

Do not store the resulting tier.

### Add a milestone

1. Add the discriminant to `DayMilestone`.
2. Insert it at the deliberate priority position in `milestoneFor`.
3. Add one fixed factual remark.
4. Test collisions with every higher-priority milestone.
5. Keep it pending-completion-only and unstored.

Avoid generic praise pools or randomized copy; `utteranceFor` is intentionally
factual and deterministic.

### Change the trail

1. Update `TrailKind`/projection semantics in the domain.
2. Update the exhaustive shared geometry mapping if the visual language changes.
3. Add a representative visual-QA cell for a new semantic; importing the
   canonical union does not create that cell automatically.
4. Confirm the app and preview script still consume the same shapes.
5. Preserve chronological order, left-growing pitch and overflow behavior.
6. Decide explicitly whether the accessible summary must change.

Never remove an earned mark in response to later abandonment.

### Change audio ownership

Treat this as high risk. The current singleton prevents duplicate contexts,
voices and chimes across the main and mini surfaces. If ownership moves, prove:

- only one `AudioContext` exists;
- only one source voice is live per kind;
- main and mini controls remain synchronized;
- StrictMode cannot double-start audio;
- completion chimes remain independent;
- reload restoration remains gesture-gated.

## Suggested next work, if this track continues

In priority order:

1. Add a fake Web Audio harness around gain scheduling, voice replacement,
   preview expiry and deterministic buffers.
2. Add reduced-motion E2E coverage and verify explicit tap previews remain
   visible without animation.
3. Add E2E coverage for `Room sound` changing from room suggestion to direct
   override and for control absence during breaks/idle.
4. Add the postcard-hours-extension regression.
5. Decide whether the companion's accessible day summary should include break
   and gap information.
6. Keep the shared scene description DOM-free; do not pull React into the Node
   preview script when extending its shape vocabulary.
7. Reconcile the static manifest color with Mono's runtime ink if exact install
   splash parity matters.

## Definition of done for another ambient-interactivity change

- Product behavior remains silent unless the user has explicitly selected sound.
- Old logs still replay with safe defaults.
- No derived progress is persisted.
- Main and mini surfaces receive the same factual state.
- Autoplay restrictions are exposed rather than bypassed.
- Reduced motion retains information and removes decoration.
- Room palettes are complete and labeled content never relies on color alone.
- `PixelCat` and `preview-companion.ts` consume the shared scene geometry.
- README, Guide, file docblocks and the dated decision log remain current.
- `npm run companion` has been visually inspected.
- `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build` pass in
  proportion to the change.
- Real audio or real PiP changes receive manual browser verification; iframe and
  unit tests must not be represented as proof of those browser capabilities.
