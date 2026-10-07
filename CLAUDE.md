# Mono

A local-first PWA that plans a working day into focus blocks and asks you to
name a single purpose before each one. Single user, one device, no backend.

## Read this first

Start with the opening docblock of a file before editing it. It owns local
purpose, ordering constraints, and failure details; tests own executable
invariants.

Use **[docs/extension.md](docs/extension.md)** for the extension's current
cross-file protocol, authority, recovery, and permission model. Use
**[docs/decisions.md](docs/decisions.md)** for why things are the way they are:
settled decisions by subsystem, traps, and what was deliberately not built. It
is kept current, so read the sections that touch your change. Its frozen
history is `docs/archive/decisions-log-2026.md`; search that only to learn how
a decision got where it is, and never treat it as current.

`docs/requirements.md` is the original brief, kept as history.
`docs/manual-qa.md` owns checks that need real browser facilities. Work through
the relevant section when a change crosses one of those boundaries.

The documentation ownership rules are settled at the top of
`docs/decisions.md`. A large change may keep an untracked working document in
`docs/wip/`; normally dissolve it when the change lands. Promote only stable,
trimmed cross-file material whose subsystem genuinely needs an operational
reference. Never treat a WIP document as authoritative.

## The two invariants

Both are explained in `docs/decisions.md`. Neither is negotiable.

1. **The plan is a pure function, not stored state.** `derivePlan()` recomputes
   the whole future on every call. Never add a stored schedule, never let it
   read the clock, never give planned entries random ids.
2. **Timers are absolute timestamps, never accumulated ticks.** Segments carry
   `startedAt` and `endsAt`; the UI derives either time remaining or time
   elapsed from those timestamps and `Date.now()`. Never write `remaining -= 1`.

## Layout

```
src/domain/      pure. no clock, no storage, no React. the interesting logic.
src/store/       the only place that reads the clock, makes ids, or persists (log + backlog).
src/hooks/       the shared ticker, reconciliation, notifications.
src/ambient/     rooms, procedural audio, theme, controls, shared scene geometry.
src/components/  the two panels, the stage prompts, the guide, the tasks and routine pages, the companion.
src/pip/         the always-on-top mini window: lifecycle, styles, its panels.
src/contract/    the wire type the browser extension shares. pure, both sides.
src/blocking/    publishes what the session is doing. no extension knowledge.
extension/       the Chromium site blocker. never imports React or the store.
scripts/         generators: app icons, and visual QA for the companion environment.
e2e/             Playwright.
```

## Commands

```bash
npm run dev        # http://localhost:5173
npm test           # vitest
npm run test:e2e:dev -- [filters] # playwright against Vite; accepts file/grep filters
npm run test:e2e   # playwright; builds and previews first
npm run typecheck
npm run build
npm run icons      # regenerate favicon + PWA icons from the companion's frames
npm run companion  # room, progression, interaction and companion visual QA sheet
npm run build:ext  # production/store extension, into dist-extension/
npm run build:ext:dev # extension with localhost origins for manual development
```

## Working here

- **Match the surrounding prose.** Comments in this codebase explain *why*, at
  length, in full sentences. A one-line `// set the thing` is out of place.
- **`now` ticks every second.** Never seed or reset state from an effect that
  depends on it — reading it during render is fine, writing it into state on a
  tick is not. Effects that only watch the clock, like reconciliation, guard
  themselves so a transition fires once.
- **Strict TypeScript**, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`. That explains the spread-conditionals and the `!`
  on array access.
- **Tailwind v4 with no config file.** The theme is an `@theme` block in
  `src/index.css`.
- **The user guide quotes live settings**, so it can never disagree with the
  app. Build its section tree from one `Settings` snapshot rather than a second
  list of individual fields. Update it when behaviour changes — but leave the
  companion's small delights undocumented on purpose.
- **Colour has one source.** `src/ambient/palette.ts` builds every room's
  twelve tokens from one lightness ramp and a per-room hue and chroma, in
  OKLCH. Every room shares the ramp: a room is a hue, never a brightness. Runtime theming, room metadata, PWA metadata and generated art read it
  directly. Only Mono's `@theme` literals in `index.css` are duplicated because
  Tailwind needs build-time token declarations; a test keeps that small mirror
  exact. Never hand-pick a hex. Run `npm run icons` after changing Mono's ink or
  amber; a test compares the favicon with the generator. `ROOM_IDS` in
  `src/domain/types.ts` is the only ordered list of rooms.
- **Companion sprite art is text**, one character per pixel. Room and trail
  geometry is shared DOM-free data in `src/ambient/scene.ts`, rendered as SVG
  by the app and directly by the contact-sheet generator. Keep scene/trail
  types in their owning modules, and keep the floor aligned with the authored
  sprite: `scene.test.ts` enforces `GROUND_Y = SPRITE_TOP + SPRITE_H` without
  coupling the DOM-free module to the component. Run `npm run companion` and
  inspect the PNG across every room and growth tier; pixel art and scene
  layering are unreadable as source.
- **Read [docs/extension.md](docs/extension.md) before changing the extension.**
  It owns the current cross-file protocol, authority, failure, permission, and
  verification model. Source docblocks own local ordering constraints;
  `docs/decisions.md` holds the reasons behind it, not the operating manual.
- **Test extension behavior at its real boundaries.** Extend the behavioral
  worker harness and its failure injection rather than replacing Chrome with
  loose spies. Installed DNR, permission, alarm, and document-targeting behavior
  still requires the real-browser checks in `docs/manual-qa.md`.
- **Before finishing:** always run `npm run typecheck` and `npm test`. For any
  change a user could see, also run the Playwright specs it touches through
  `npm run test:e2e:dev -- [filters]`. CI runs the complete production-backed
  `npm run test:e2e` on every pull request and before every deployment, so
  that is where cross-cutting session, storage, and clock behavior gets its
  full browser pass. Run `npm run test:e2e` locally only for what the dev
  server cannot show — build, PWA, service-worker, or lazy-loading changes,
  changes to the Playwright configs or `e2e/support/` — and before a release.
  If a future reader would be puzzled by a call you made, add or rewrite its
  row in `docs/decisions.md` (the rules are at its top) and put the narrative
  in the commit message.
- **Where a new test goes.** A domain rule and its variations belong in a
  unit test beside the domain code; a browser test proves the rule is wired
  to the screen, once per user-visible behavior, not once per case.
