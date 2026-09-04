# Mono

A local-first PWA that plans a working day into focus blocks and asks you to
name a single purpose before each one. Single user, one device, no backend.

## Read this first

**Every file worth touching opens with a docblock** saying what it is for and
why it is shaped that way. Read it before editing the file. Those comments are
the real documentation — they sit next to the code and cannot drift.

**[docs/decisions.md](docs/decisions.md) is the other half**: the reasoning that
is not recoverable from the source. Calls made deliberately, several of them
after being built the other way, plus the traps that have already cost an
afternoon. Check it before "improving" something that looks odd — several things
here look odd on purpose.

`docs/requirements.md` is the original brief, kept as history.

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
src/components/  the two panels, the stage prompts, the guide, the companion.
src/pip/         the always-on-top mini window: lifecycle, styles, its panels.
scripts/         generators: app icons, and a contact sheet of companion frames.
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
npm run companion  # contact sheet of every companion frame, as a PNG
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
  app. Keep it that way when you change a duration or a behaviour, and update
  it when behaviour changes — but leave the companion's small delights
  undocumented on purpose.
- **Companion art is text**, one character per pixel. Run `npm run companion`
  and look at the PNG; pixel art is unreadable as source.
- **Before finishing:** `npm run typecheck`, `npm test`, and `npm run test:e2e`
  if anything user-facing moved. Add a dated entry to the log at the bottom of
  `docs/decisions.md` for anything a future reader would be puzzled by.
