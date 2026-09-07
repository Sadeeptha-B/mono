# Mono

A local-first PWA that plans a working day into focus blocks and asks you to
name a single purpose before each one. Single user, one device, no backend.

## Read this first

Start with the opening docblock of a file before editing it. It owns local
purpose, ordering constraints, and failure details; tests own executable
invariants.

Use **[docs/extension.md](docs/extension.md)** for the extension's current
cross-file protocol, authority, recovery, and permission model. Use
**[docs/decisions.md](docs/decisions.md)** for historical reasoning and traps,
not as a snapshot of current implementation. Earlier decisions may have been
superseded by later entries. Search it by the relevant subsystem or term rather
than loading the append-only log as general context.

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
   `endsAt`; the UI renders `endsAt - Date.now()`. Never write
   `remaining -= 1`.

## Layout

```
src/domain/      pure. no clock, no storage, no React. the interesting logic.
src/store/       the only place that reads the clock, makes ids, or persists.
src/hooks/       the shared ticker, reconciliation, notifications.
src/ambient/     rooms, procedural audio, theme, controls, shared scene geometry.
src/components/  the two panels, the stage prompts, the guide, the companion.
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
- **`now` ticks every second.** Never put it in a `useEffect` dependency list —
  reading it during render is fine, writing it into state on a tick is not.
- **Strict TypeScript**, with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`. That explains the spread-conditionals and the `!`
  on array access.
- **Tailwind v4 with no config file.** The theme is an `@theme` block in
  `src/index.css`.
- **The user guide quotes live settings**, so it can never disagree with the
  app. Build its section tree from one `Settings` snapshot rather than a second
  list of individual fields. Update it when behaviour changes — but leave the
  companion's small delights undocumented on purpose.
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
  `docs/decisions.md` is history, not the operating manual.
- **Test extension behavior at its real boundaries.** Extend the behavioral
  worker harness and its failure injection rather than replacing Chrome with
  loose spies. Installed DNR, permission, alarm, and document-targeting behavior
  still requires the real-browser checks in `docs/manual-qa.md`.
- **Before finishing:** `npm run typecheck`, `npm test`, and `npm run test:e2e`
  if anything user-facing moved. Add a dated entry to the log at the bottom of
  `docs/decisions.md` for anything a future reader would be puzzled by.
