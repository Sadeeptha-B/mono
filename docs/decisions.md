# Decisions

What this file is: the reasoning that is **not recoverable from the source**.
Calls that were made deliberately, several after being built the other way;
traps that have already cost someone an afternoon; and things left unbuilt on
purpose. It is short enough to read the section you are about to work in.

What this file is not: a current description of the codebase, or a history.
Local facts belong beside their code, and stable cross-file operating contracts
belong in a focused document such as `extension.md`. Nothing here should state
a fact a command could answer — no test counts, file inventories, or line
totals. Those rot within a week and then actively mislead.

**This file is edited in place.** When a decision changes, rewrite its row so
that it states the current call and why. Keep a short note of what it replaced
only when the old answer is the one a newcomer would reach for. The narrative
of a change belongs in its commit message or pull request. The dated log that
used to grow at the bottom of this file was frozen on 2026-10-06 and moved to
[`archive/decisions-log-2026.md`](archive/decisions-log-2026.md); search it
when you need to know how a decision got here, and never treat it as current.

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
4. **This file.** Cross-file reasoning, traps, and rejected alternatives, kept
   current. It explains why the code is shaped this way; it does not restate
   how.
5. **`README.md`.** What Mono is, how to run it, how the pieces fit together,
   what it cannot do. Orientation for a person arriving, not a specification:
   the in-app guide quotes live settings, which makes it the one description of
   behaviour that cannot disagree with the app.
6. **`CLAUDE.md`.** The repository map, global invariants, and routing pointers
   an agent must see before it knows where to look.

`manual-qa.md` separately owns checks that require real platform behavior, and
`requirements.md` preserves the original brief as history.

### Recording a decision

Add or rewrite a row in the section it belongs to: the decision in a few words,
then why in one to three sentences. If it needs more than that, the extra is
almost always one file's business and belongs in that file's docblock. A trap
gets a short paragraph under *Traps*: the symptom, the cause, and the rule.

Review rounds on an unmerged branch revise the rows the branch already wrote.
They do not add a row per round. Five successive paragraphs about one delete
rule is how the old log reached three thousand lines.

### Track documents are scaffolding, not artifacts

A change large enough to need a working surface should get one, in `docs/wip/`,
which is untracked. It may hold every kind of thing this file bans — file
inventories, test counts, a base commit, a verification table — because that is
exactly what it is for while the work is in flight.

It is normally **dissolved rather than merged**. Each durable paragraph moves to
its owning docblock, test, operational document, a row here, or the bin. A
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
- Asking what an unsaved answer would mean is a *call*. The hours question
  previews on the calendar as it is typed by passing the draft in as the day's
  regions, and discards it by not calling again.
- Only what the user wrote can be edited. Planned blocks are output, and an edit
  to the output of a pure function has nowhere to be stored; the way to move a
  block is to change the hours or commitments it was planned around.

The same rule covers the companion, the room, the trail and the end-of-day
postcard: what they know about the day is a fold over the history, not state of
their own. There is nothing to persist, nothing to migrate, and nothing that
can survive a day it should not have.

### 2. Timers are absolute timestamps, never accumulated ticks

Every segment carries absolute `startedAt` and `endsAt` timestamps. The UI
renders `endsAt - Date.now()` or `Date.now() - startedAt`. The one-second tick
exists *only* to trigger a re-render. A throttled, delayed or entirely skipped
tick therefore makes the display briefly stale but never wrong.

Never introduce a `remaining -= 1` counter.

This is also what lets other things lean on time safely. The mini window can
lend the ticker a second, unthrottled interval because extra tick sources can
only make a clock fresher, never wrong. The extension is handed one absolute
`endsAt` rather than a duration, so it never needs Mono to stay open.

---

## Settled decisions

### Planning

| Decision | Why |
|---|---|
| `prefer-deep` is the planner default | `maximise-focus` wins on raw minutes by almost never scheduling a deep block — 20 divides more finely than 45, so a two-hour afternoon becomes six short blocks. Built the other way first, then changed. |
| Breaks are **never** auto-planned | The timeline shows the maximum focus the day could hold, which is what makes taking a break a visible trade. `breakCost()` prices it live in the prompt. |
| A pinned break and a commitment never share a minute | Adding or moving a commitment drops only the pins its span, margins included, lands on; laying a pin across a commitment is refused, and the composer says why. Both halves live in the reducer, so a log replays to the same day in either order, imports included. It replaced a rule that cleared every future pin, which deleted a four o'clock walk for a nine o'clock standup. |
| Margin always rounds down | Fifty minutes holds one block and five dead minutes, never more. |
| Work regions (positive space) replaced a single `dayEndsAt` | One end-time could not describe an unstructured evening with work after it, and once the clock passed it, it silently fell back to midnight. |
| Regions are a recurring default plus a per-day override | Today's regions are **derived, not seeded**, so changing the default reshapes every uncustomised day immediately. Saving an untouched draft therefore writes nothing (`hoursToSave` returns `null`); stamping one would silently detach the day from the default. |
| Recurring commitments are derived per day, like regions | A series is a rule in the log, and each day's occurrence of it is computed by `commitmentsFor`, never written into the day. Seeding copies at midnight would be a stored schedule: editing the series would leave every copy already written telling the old story. Occurrence ids are the series id and the day, so re-deriving is idempotent. |
| A day overrules its occurrence by id, and only that day | Editing today's gives the day its own copy under the occurrence's id, which `commitmentsFor` then prefers; removing it records a skip. Both go at midnight. An edit that leaves the occurrence saying what it said makes no copy: the day's editors send the whole draft back on `Done`, and detaching on that silently cut today off from the series. The reducer compares, so replay holds the rule too. "This and following" edits were left out: they need a series split, and changing the series on its page already means "from now on". |
| Changing or ending a series never rewrites what has begun | Before a series changes, today's occurrence becomes the day's own copy if its span, getting ready included, has started. Otherwise moving the standup to ten would move this morning's nine o'clock after it happened, and ending a series would take it off a calendar that says what the day was. One still ahead today follows the change. |
| Series live in the session log, not IndexedDB | The reducer's pin rules and the first plan need them synchronously at boot, which is the log's guarantee (see *Traps*). There are a handful, edited rarely, so they are settings-like rather than backlog-like, and export carries them for free. The cost is that the reducer now resolves a local day from an event's `at`: replay is deterministic on one device, and a log replayed in another time zone could place an occurrence differently. |
| Usual hours and recurring commitments share the routine page, out of Settings | Both are a recurring default each day derives its own answer from and can override for itself, so they are one subject: what an ordinary day looks like. Settings keeps preferences about how Mono behaves, and says where the hours went. A tab for it in the header was declined: it is set up once and changed rarely, so it is linked from where wanting it happens — the hours and commitments questions, their calendar editors, and Settings (`RoutineLink`). |
| Series are written only on the routine page | The day's forms edit one day and link to the page. A Repeats choice on the day's form was a second place to author a series, and the one where "for today" and "every day" are easiest to confuse. |
| One shape for all days | No weekday/weekend split. Per-day edits cover the exceptions. |
| Regions never wrap past midnight | The plan is scoped to a calendar day. A late stretch ends at 23:59; overnight regions would complicate the whole model. |
| A commitment outside every region shows but does not extend the horizon | It is a fact about the day, not permission to plan in it. |
| A commitment's preparation and recovery are entries of their own | The commitment keeps its own length on the calendar, so Mono never says you are in the meeting while you are in the car. `commitmentSpan` is what planning holds clear, and it owns the `?? 0` because replay does not pass through the import sanitiser. |
| The timeline is one calendar day; the log keeps everything | History is the journal and is never truncated. What is *drawn* is today, by one shared predicate (`onSameDay`) so the calendar and the companion cannot disagree. A span reaching across midnight is clipped where it is drawn, never in the entry, so labels stay true. |
| Midnight reset never fires mid-block | `checkDayRollover` returns early while something is running. |

### The opening questions

| Decision | Why |
|---|---|
| Commitments, then hours, then today's tasks | What is already fixed is the part of the day you cannot move, so it decides how much is left to declare; what the day is for depends on both. The order is "ask first whatever changes the other answers". Hours-first shipped and was reversed the same day. |
| A carousel, not a wizard | No question gates another and `Start the day` finishes from any of them. Their drafts live in the component that stays mounted across the switch, so changing your mind about the order loses nothing. |
| `day/shaped` is an event; coming back is not | Having been asked is a fact about the day. Changing an answer later is not being asked again, so revisiting is UI state in `App` and appends nothing. Gating on `hasCommitments` instead asked an empty day forever. |
| The first time through, the day needs hours and one task; commitments may be empty | A day with nothing fixed is ordinary. A day with no working hours cannot be planned, and a day with nothing meant is not one Mono can help with. A task rather than an intention, because an intention is an optional name for some of the tasks. Only tasks still drawn count: one chosen and then deleted is not something the day is for. Coming back later gates nothing: clearing every hour or task mid-afternoon is a decision, and trapping someone behind a disabled button on a day already under way would be the worse bug. |
| Today's timer is not a block | A block is recorded, costs plan time, arms site blocking and runs only in working hours, and this question is usually asked before they start. It is two instants in `App`, never logged. |
| The questions are reachable only while idle | The strip never offers a way past naming a block. Naming the block is the product. |
| Setup outranks the out-of-hours panel | Opening Mono at 08:30 against a 09:00 start is the commonest time to be here, and being told you are outside hours by an app that has not asked for them is a closed loop. |

### Editing the day

| Decision | Why |
|---|---|
| An edit is a patch on the same id | Remove-then-add changes the React key so the entry blinks rather than moves, loses the fact that a meeting *moved*, and leaves an instant where the day is derived without it. Patches may not carry an entity id: the reducer spreads them, so one could rename an entity and orphan every later event. |
| An editor holds an id, not a copy | It looks its subject up in the store on every render. A copy would be a second answer to what the thing is; the timeline entry would be a wrong one, since the planner clips a break already under way. An editor whose subject vanishes closes, before paint. |
| One editor of a single value on screen | Two drafts of today's hours is a race with a human in it — whichever saves second silently wins. Commitment forms are exempt because they append rather than overwrite. |
| A draft exists only once someone has typed in it | A seeded copy is a photograph the day can change under. Untouched, a form renders what the store says now; whether a fold is open is derived from what is in the draft. An edit nobody has changed is not an edit, and folds away (`draftsMatch`). |
| Replacing the session is announced, not inferred | The store bumps `generation` at the midnight reset and on import, and nowhere else. Day-specific React state resets on it or is keyed by it, and so does any draft of something the log holds: the routine page is keyed by it, because an import restores series under the ids an open editor is already pointing at. Three earlier fixes inferred replacement from signals that only correlated with it, and each missed a case. State that can be derived each render beats state that has to be reset at all. The backlog announces its own replacements the same way (`replaced` in the task store: an import here, or one taken from another tab), and the surfaces holding drafts of its records by id — the tasks page's board and Later, All Tasks — are keyed by it. A rename kept across an import that brought the same id back was saved over what was imported. What an `Add …` field on the tasks page holds names no record, so the page holds it above that key, by the field (`AddFields`): keying the whole board let those go too, including a line refused while the import landed, which the refusal had promised to keep. All Tasks is the exception, deliberately: it is a question's column, gone when the question closes, and an import in its own tab already clears all of it through `generation`, so a replacement from another tab clears all of it too, a task half written included. |

### The session

| Decision | Why |
|---|---|
| Abandon, but **no pause** | A paused timer means `endsAt` is no longer a fixed instant, and that is where timer bugs come from. Ending early and starting again is the honest version of the same thing. |
| Never auto-complete after being away | Banking a block the user spent at lunch would poison the history, and the history is the point. On resolution the block is credited at `endsAt`, not at `now`, and the unaccounted stretch is recorded so the day still adds up. |
| Not knowing yet is a timer on the purpose prompt, not a block | The play button by the question gives it a few minutes, like today's question's: part of the phase, never the log, no plan time, no site blocking, and the block starts when it is named. It replaced the priorities block, which recorded not knowing as a block of its own, with a stage of its own — a whole extra path through the day for a pause before answering. Priorities blocks in older logs are still read and drawn. The companion's thinking pose now marks the timer running. |
| Phase is not persisted | It is which prompt is open. A running *segment* must survive a reload, and does; a stale question must not. |
| Every prompt is inline; Settings is the only dialog | "Do you need a break?" is only answerable while you can see the rest of the day. The calendar's own editors expand in place for the same reason. Settings is the one genuine aside. |
| Outside working hours, Mono says so | It names the next stretch and refuses to offer a block. The escape hatch is changing the declared hours, so working anyway means saying so. |
| A running block's tasks change from All Tasks, and nowhere else | Work turns out bigger or smaller than it was named, and starting a block again to say so would bank a short block for nothing. So while a block runs All Tasks ticks for it: a task ticked is taken on, and chosen for today; one unticked is let go and stays today's. A task written there is not ticked, unlike while choosing: what turns up in a block is usually not for that block, and writing it down should not attribute it to one. The box that would leave the block with none stays ticked and says why when pointed at, in Mono's own card (`HoverNote`), rather than doing nothing silently. They are events on the block (`block/taskAdded`, `block/taskRemoved`, schema v9), so history records what it ended with and replay agrees. Not the stage or the pop-out: there a block's tasks are ticked *done*, the one gesture a glance should offer, and a checkbox meaning two things in two places is the confusion this keeps out. The purpose stays the sentence the block started with. |
| Every focus block is for at least one task, enforced in the machine | `setPurpose` refuses an empty task list or a blank purpose, so a stale click cannot get round the prompt; while it runs, a removal that would leave it with none is refused whole, by the machine and again by the reducer. Not knowing yet is the prompt's own timer, not a way round it. A block's intentions are derived from today's grouping, never stored. |
| Purpose stays its own primitive, and stays required | It is the block's one sentence and what the blocked-site page shows. It starts as the tasks' titles and belongs to the user once edited. It was kept when intentions became optional: an intention groups a day's tasks, while the purpose is what a running block is for, and the extension and the timer both carry it. |
| Ticking a task is the backlog's write; finishing a block is the block's | A task can be finished in a block cut short, and a block can run its length without finishing anything. Neither writes the other. |
| "A block is running" has one definition | `isBlockRunning` in `machine.ts` serves ambience and site blocking alike. At `blockComplete` and `reconciling` the segment is still `active`, so anything reading `active` alone keeps a sound playing or a site blocked after the block is over. |
| The timer face is transient UI state | Remaining or elapsed is a view choice, so it is not in the log and returns to countdown on reload. Remaining rounds up and elapsed rounds down, so neither claims a second early. |
| A block's logs and urges are events on the block | They are things the user said about that block, so they belong in the journal, and they ride on its segment into history so the calendar and anything that reads the day back see one record rather than a block and a list beside it. Written only while `focusing`: at `blockComplete` the segment is still active, but nobody is sitting in the block. Urges are instants, not a number, so the calendar can place them and the count is a fold. In code it is a `BlockLog` too: it was a `BlockNote` once, to keep the word apart from the event log, and two words for one thing cost more than the clash; where both are meant, the event log is called that. |
| A log can be corrected afterwards; only the last urge can be taken back | A mistype is often first seen on the calendar, so a log can be edited or deleted in a block long over. The correction is its own event and the history is still a fold over the log, as with an intention renamed; an edit keeps the minute the log was written. An urge is a tap, and a mis-tap is noticed at once. Delete takes a log off the block, not out of the journal: the words stay in the stored events and in an export, as everything that happened does, and the guide says so. Erasing them would mean rewriting the log. |
| Urges are counted, not scored | An urge is a moment the task pulled the other way, counted whether or not it was followed; "distraction" names the thing that won. "Diversion" and "stray" were tried and given back for the plainer word. Nothing reads the count — not the cat, the room, the trail or the postcard. A number something rewarded you for keeping low would be a reason not to count honestly, which is the whole of what counting is for. The same line as *no points* below. |
| A running block's stage is two columns under the purpose | What the block is for on the left — its tasks, with `✎ Log` beneath them — and how it is going on the right — its logs, with the urge counter beneath them. The two controls share a row of the same grid, so they stand level however long either list is. End early is a quiet word level with the block's name, as it is a word in the mini window's footer. One column of tasks, logs and controls read as one list. |
| A refused save is caught and said out loud | It is the one failure that costs something you cannot see. The warning stays in both headers until a save lands and leads to Export, the only rescue. The session's whole log goes out on every save, so any success catches up; the backlog writes per record, so its health is tracked separately. |
| No cap on the event log | A heavy day is a few kilobytes and the log is the one thing that cannot be rebuilt. Truncating it to make room would cost more than it saves. |

### Tasks and the backlog

| Decision | Why |
|---|---|
| The backlog lives in IndexedDB, not in the log | The log is a day's journal replayed on every boot; a backlog is long-lived state edited in place. IndexedDB because it grows without bound and is written a record at a time. The session log stays in `localStorage`, whose synchronous rehydration is load-bearing (see *Traps*). |
| Shaped for sync, without sync | Client ids, `updatedAt` on every record, tombstones, and references by id. A record that simply vanished could not tell another copy it was deleted rather than never seen. |
| The middle of the hierarchy is optional | A task may sit straight under an area; those tasks are its inbox, which is a view rather than a container. |
| Epics and outcomes are finished by hand, and closing one writes nothing inside | Done, dropped and archived hide a subtree by ancestry. The tasks keep their own status, so reopening brings each back exactly as it was. Archive is a field beside status, stamped on the top of the subtree only. |
| A delete writes one tombstone, and is final | The subtree goes by ancestry (`isGone`). A tombstone outranks any live copy whatever their versions; nothing gone can be edited, moved or added to, and the disk refuses a move out of a deleted subtree. This replaced cascading deletes, which raced other tabs' moves and renames and was rebuilt twice in a day before being removed. |
| One queue per tab; the disk arbitrates | Disk work and broadcasts heard run as jobs in order, so the generation only changes inside a job and is checked once. Every place copies meet uses `outranks`. A version is the later of now and one past what it replaces, and is bounded so every version written can be read back. |
| Replacing the backlog is all or nothing | With a working database: disk first, then memory, then broadcast, and if the disk refuses, nothing has changed — the day is not replaced either. Edits are refused while one is in flight, backups run one at a time, export waits for hydration, and a file whose records do not fit together is refused whole. It is not one transaction across both stores: with no usable database the import lands in memory with the warning held up, and the day log saved afterwards can still be refused like any session write. The order and its edges are in `backup.ts` and `tasks.ts`. This replaced an "owed import" design in which every new code path needed its own guard. |
| No Web Lock around disk work | The database's own checks have to hold for browsers without locks anyway, and a lock removed no guard. `schedule()` is where one would go. |
| Two tabs are supported only with `BroadcastChannel` | Without it a tab shows what it loaded until reloaded. The disk still refuses anything that would undo a delete or overwrite a newer copy. |
| A task moves by the browser's own drag and drop, with a pick-up beside it | Motion's drag follows the pointer but knows nothing about what it is over, so drop targets, hit-testing and edge scrolling would all have been hand-written, and its drag features loaded for one page. The native drag has those and is poor on touch and without a pointer, which the grip's pick-up and `Move here` cover. Both share one carry state, so they agree on which columns take a task. It replaced a select of every place in each row. Today's list carries tasks between intentions with the same gesture (`carry.tsx`); each surface says only which places take a task and what putting it down writes. Where two surfaces share a page they share one hand (`useCarryHand`): their status bars stood in one place, and a second pick-up hid the first one's controls. |
| A day is answered with tasks; intentions are optional names for some of them | Intentions were written first, title then tasks, and a title written before anything was scoped came out as the name of an epic or outcome the backlog already had. So the day chooses its tasks, and an intention is a name given afterwards to some of them, narrower than an outcome or wider than an epic as the day needs. A vague day writes a vague task, which is cheap and files itself in an area's inbox. |
| Today is a map in the log, not a field on the task | `today` maps each chosen task to its intention or `null`, so membership and grouping cannot disagree. It is a decision about one day, like the rest of the log: it resets at midnight with nothing to clear and replays like everything else. A `plannedFor` date on the task would be a stored schedule on long-lived records, needing a sweep at rollover and reconciling across tabs. Linking a task chooses it; unlinking leaves it chosen; removing an intention leaves its tasks today, under none. |
| A task ticked for a block joins today as it is ticked | The block is the day doing it. Unticking, or `Not yet`, leaves it today's, as unlinking from an intention does, so a row never vanishes from under the box just unticked; × in today's list takes it out, and off the block with it. The reducer also adds a block's tasks to today on `block/started`, so a replayed log draws the same today. |
| Carry-over is part of the fold | `day/reset` keeps the tasks today chose as `lastDay`, and the next day offers those still open and not chosen again. Offered, never added: yesterday's list is the commonest thing to change your mind about overnight. Ignored suggestions expire at the next reset after a day that chose something, so there is nothing to dismiss and nothing stored beside the log. A day that chose nothing keeps the last one's: a tab left open over a weekend turns over at every midnight, and replacing `lastDay` with an empty Saturday lost Friday's leftovers before Monday. |
| Tasks are chosen from All Tasks, which also keeps the backlog | `TaskBrowser` draws the backlog as its tree, with a search and today's finished tasks crossed out. Since the whole backlog is on screen while choosing, every row has a `⋯` with its actions, so it can be put right without a trip to the tasks page; an area is never deleted there, since that takes a whole part of a life at once. It replaced `TaskTreePicker`, a dropdown whose placing, flipping and closing were most of a file. |
| Today's surfaces read the day from the session store | `TodayList`, `TodayCarry`, `AllTasksPane`, the purpose prompt and `useTodayBacklog` read `today` and `intentions` themselves, because the same list is drawn on the stage, in the column and on the tasks page, and three hosts handing it down drifted. What `App` owns and nothing persists — the block's ticks, the column's view, the question timers, drafts — still goes down as props. The backlog's per-snapshot reading for today is built once and shared (`useTodayBacklog`), as the backlog's own index is. |
| An epic or outcome is ticked, and carried, whole | Ticking a task at a time made choosing an outcome's worth of work a run of clicks, and grouping it a run of drags. A box on an epic's or outcome's row in All Tasks ticks every open task beneath it, for today or for the block, and is mixed while only some are; on the tasks page the card's sun does the same for today, saying how much is chosen while only some is; its row dragged onto an intention chooses and groups all of them. In today's own list a place's heading carries what it heads in that group, and no more, so grouping what the day chose never chooses more; it has a grip for the keyboard, as a task's row does. All of it is still one event per task, appended together (`linkTasks`, `addAllToToday`), so the log's shape and replay are unchanged and nothing downstream learns that places were ticked. An area has no box and is not carried: that is a whole part of a life at once. |
| Grouping is done by carrying tasks into an intention | An intention is written by title alone and filled by dragging tasks in, or by the grip and `Move here`, the tasks page's own gesture; a task dragged from All Tasks onto one is chosen and grouped at once. It replaced an intention form with its own task picker, a second way of choosing tasks, title first. The tasks page's per-row intention select went the same way: a row there has a sun that chooses it for today, and grouping happens where the groups are. |
| The purpose prompt asks for the purpose, then lists only what is ticked | Under a list of tasks the purpose read as an afterthought, and by the time a block is named the day's tasks are already chosen. Ticking is done in All Tasks, and today's own list sits under it in the column, where intentions are kept: listing today's tasks on the prompt as well put a second set of checkboxes beside the tree's. The purpose still names an outcome when all of it is ticked. |
| An intention is finished by hand, and stays listed | Whether the day got what it wanted from an intention is the user's call: tasks can run out with it unmet, or it can be met with tasks left. It is a `done` on the intention, patched like a rename, touching no task; a done one keeps its place, crossed out, so nothing moves under the pointer that ticked it. |
| Today's lists and the backlog browser show today's done tasks, crossed out | Progress belongs where the next choice is made. Only today's (`doneAt` on the session's day), because every task ever ticked would bury the open ones; they are drawn, never choosable or carried. Today's lists are cut from the same tree (`groupTasks` over `taskTreeWithDone`). Names wrap in the browser rather than truncating. |
| The backlog is ordered by a number between neighbours, renumbered only when there is no room | A reorder writes the moved record alone, at an order halfway between its new neighbours, so it is one versioned write like any other edit and cannot undo another tab's edit to a sibling. Equal orders, or a gap halved past what a number holds, renumber every sibling from zero (`placeAmong`), which also repairs ties that otherwise draw in whatever order the disk reads them. Orders are compared over all live siblings, not the list on screen, so a done task between two open ones changes nothing. A renumbering is one decision in several records, so the disk judges it whole (`Renumbering`): judged a record at a time, a sibling another tab had just written was refused while the rest landed, and the siblings came out in an order nobody asked for. Refused, nothing moves: every member goes back to where the disk has it, or where it stood before when the disk has never had it, and keeps any other edit still owed to it. A drop or move made among the same siblings while it was on its way goes back too, since it was worked out from orders that never landed, and goes back to where the disk has it, read once the write has committed, since another tab may have moved it meanwhile; so every edit that moves a record is owed as a placement, a single drop included. Taken back rather than worked out again, which would mean keeping each drop as an intention to replay: the refusal's rule is already that the drop did not happen. Members are named by id over one owed copy of each record (`owed.ts`), not held as copies of their own; held as copies, a refusal took a rename back with the order, and dropped a task the disk had not yet been given. Text keys that can always be split would avoid renumbering altogether, at the cost of migrating every stored order; not worth it for a case that needs ties or ~50 drops into one gap, and another tab writing a sibling in the same instant. |
| Reordering is dragged; the keyboard steps | A drag lands between rows wherever a list takes one (`useDropList`); a task may change column on the way, while an epic, outcome or area stays under its own parent. A pick-up offering `Move here` between every pair of rows would be most of the page, so the keyboard moves a row one step at a time: arrow keys on a task's grip, move icons on a card or an area, ↑ and ↓ in an All Tasks `⋯`. An arrow at the end of its list is disabled but kept, so the press that brought a row there keeps the focus. All Tasks holds its own carry for this inside today's, and a task's drag is in both, so it can still be let go on an intention. |
| An epic's own tasks are headed `Tasks` | The column sat beside the outcomes with no card, so it read as one more outcome: a task written into an epic from All Tasks was taken for an outcome that had appeared to the right of `Add outcome`. |
| Tasks-page actions are icons; put-away items are cards | Words took more of a narrow column than the titles they acted on, and a put-away title was cut to a few letters. Icons carry the target in their accessible name and the verb on hover. A put-away epic or outcome nests what it holds, read-only, since its card is where they come back from. |
| Projections share one index per snapshot | Rebuilding lookups per task took 25 seconds at ten thousand tasks, on pages that render every second. Pages memoise on the backlog, never on `now`. |
| Later is its own record in the backlog's store, not a task kind and not a log | It looks like a block's log while it is typed and is its opposite: about no block, pointing forward, outliving the day and waiting for a decision. In the event log it would be folded on every boot and reset at midnight; as a fourth item kind it would need an area before it could be written down — the question it is put down to avoid — and every list of tasks would step round it. So it is a third IndexedDB store beside areas and items, with their versions, tombstones and tab rules. |
| Filing a Later is one judgement on the disk, not two records | The task is what the Later became, so the Later is deleted as the task is made. Judged as two records, each on its own, one could land without the other: two tabs filing the same line each wrote a task, and a line filed into an area another tab had just deleted was used up making a task nobody could see. So a filing goes to the disk whole (`Filing`) and is refused whole when the disk's Later has moved past the copy it was filed from — deleted, let go or reworded in another tab, so the task would carry what the line no longer says — or when its destination is gone, judged over the disk as the write will leave it, so a destination arriving or moving in the same write is walked where it is going. Plain records are judged first and filings after them for that reason; a move is still judged by where the disk has it now. The tab that filed it takes the task back and gets the line back as the disk has it. It carries any edit made to its new task before it lands, so nothing about it is judged apart, and a renumbering that takes its task before it lands goes with it too: the task is written once, inside the filing, where it was put last. Room made for it among its new siblings, when their orders leave none where it was let go, goes as a renumbering judged whole, and the filing lands only if that does (`needsRoom`): its task's order was chosen for that room. Let go is kept and can be brought back, for the reason a dropped task is kept; delete is final. |
| Later keeps the block it came from, copied, and is never drawn on it | What the block was for is copied rather than looked up, since by the time a Later is read its day is long gone. The calendar shows what a block was, and a Later is what it set aside; the block only says how many it put down. Every field that puts a line down — the header, beside `✎ Log`, the tasks page — goes through `keepForLater`, so a line written during a block is marked with it wherever it was typed; the tasks page's field once called the store itself and kept lines without their block. |
| Which button is pressed decides log or Later, before a word is written | `✎ Log` and `⤴ Later` open the same field in the same place. Asking which it was afterwards would put a question at the moment the line was meant to be let go, and the two are different questions from the start: how is this going, or what is this pulling me towards. |
| Later shares the backlog's ids, and an import is checked for it | `backlogProblem` refuses a file in which a Later's id is used twice, or by an area or item: the disk keeps one record per id, and the tasks page finds what is carried by id across tasks and Later alike. Mono never writes such a file; finding one means it was edited, and the file is refused whole like any other that does not fit together. |
| A file without Later imports none | A file from before Later is taken as having nothing put down, rather than leaving what is here beside a backlog it was never part of. The rule with no special case, accepted because one user with few backups loses little by it. |

### The mini window

| Decision | Why |
|---|---|
| It is not a modal | A modal covers the day while asking about it. This window is for the minutes when the day is not on screen at all. It still answers nothing that needs the calendar or the backlog beside it — hours, commitments, today's tasks, a block's tasks — and shows where those answers stand before handing them back to the tab. |
| A portal, not a second React root | `useReconciliation` and `useBlockEndAlerts` dispatch without a user, guarded by per-instance refs. A second root is one careless import from banking a block twice; a portal makes that impossible to write. |
| It lends the ticker its own timer | A hidden tab is throttled to about a tick a minute; an always-on-top window is not. Safe only because of the second invariant. |
| It opens from the click that starts the timer, on by default | Requesting a window needs a user gesture, and minimising the tab is not one. Chrome's automatic picture-in-picture is gated on the page capturing camera or microphone or playing audible media, which a timer that is silent by default cannot count on — and holding a microphone open to qualify is refused outright. Starting the timer is the last gesture before the user leaves, so that is the reliable moment. Not at `startBlock`, which would steal focus from the purpose field. In the handler, never in an effect watching the phase. |
| One window, and the user chooses the monitor | Asking for a second window closes the first. Mono never sets `preferInitialWindowPlacement`, so Chrome puts the window back wherever it was last dragged. The size passed is an opening hint; `Reset size` is offered outside a preferred range rather than fighting the user's drag. |
| It follows the stage exactly, timers included | It used to follow `dayShaped` and offer the next block while the tab was back on the hours, on the argument that a question shown out here was only a sign pointing at the tab. Once each question came out with its answer so far, and the two timed ones with their clocks, two windows disagreeing about where the day is became the worse failure. Deciding what the day or a block is for is evaluative work that drifts, and an always-on-top clock is what keeps it in view. |
| A question's timer opens it too, behind its own setting | The click that starts the timer is the only gesture there is, as for a block. Unlike a block starting, the user is still answering in the tab, and a window arriving can take the focus off the field, so it is a separate switch from `popOutOnStart`. Today's timer starts itself during render, so the click that shows that question asks instead. |
| Panels of its own; shared choices, duplicated captions | Break lengths and what a break costs are product decisions and are shared (`breakCost.ts`). Short labels are read at a glance and may differ where room forces it. |
| Hidden no longer means unseen | With the window open, notifications decline, and the service worker will not reload, since a reload takes the window away with no gesture left to restore it. |
| The log is closed until asked for | Always open, a field read as something the block was waiting for, and in the mini window it was most of what there was to look at. `✎ Log` opens it in its own place, so neither surface grows, and it closes once a line is kept or let go. Whether it is open lives with the block's controls, so the next block starts closed. |
| It takes a log, puts things down for later and counts urges while a block runs, but lists nothing standing | The always-on-top window is the one in view while the work is somewhere else, which is when a line gets written, a tangent turns up or an urge is noticed. A list of what was written, always on top, would be a list of reasons to look at it; it says how many and leaves the lists to the stage, the calendar and the tasks page. It opens taller to hold the field. The block's tasks open from its purpose on hover or focus, in Mono's own card (`hoverCard.ts`), as a log opens from its mark: which tasks the sentence stands for is what a glance at it most often asks, and pointing at it is asking. The browser's tooltip was not used, being late, plain text, and unreachable by the pointer. |
| It draws the running block as a strip across the window, as the calendar draws it | A countdown says how much is left; the calendar's block says how much is gone, of how long, and where in it you wrote or wanted to leave, which is the sense of time this window exists for. It is the calendar's own drawing (`SegmentGlance` over `styleFor` and `Marks`) laid on its side, with its clock times outside its two ends. Its marks open on hover as the calendar's do: one log under the pointer is not the list this window declines to hold. A card opens where the window has room for it, above or below the strip, narrowed and moved along it if it must be, and still over its mark. It was first drawn upright under the cat, which made the window two crowded columns. |
| While something runs the window reads in bands, and End early is a word in the footer | Timer and cat, then the strip, then ✎ Log and the urge counter on one row, then the footer: each band the width of the window, at 470×240. End early is the rarest thing done here and the one that cannot be taken back, so it is a quiet word beside the blocks still ahead rather than a button among the controls; on a break the same place says Back to work. Open Mono stands before it, the same kind of word, bringing the tab forward on the day: the way back to All Tasks and today's list while something runs. |
| No API, no control and no setting | A permanently dead control is the app apologising for the user's choice of browser. |

### The companion

| Decision | Why |
|---|---|
| A pixel sprite replaced the one-line character | The line could only ever be a gesture: every expression was derived from a neck point and a tilt angle, so making it cheerful meant trigonometry, and the safe move was always to keep it minimal. That is the wrong instinct here — the problem this app solves is that the user leaves to find something more interesting. A companion worth glancing at is a feature. |
| Lively at the seams of a block, dull in the middle of one | This is the rule that lets the companion be interesting without becoming the problem in a costume. The focusing pose holds one frame for thirteen seconds. Petting it during a block buys a brief reaction and a preview of the room that expires on its own, and nothing that lasts. Whatever the character grows into, it keeps this. |
| Fur colour is fixed; only the accent moves | Tinting the whole animal per phase looked like seven different cats. Ears, nose, tail and ground carry the state instead. |
| Art is authored as text, one character per pixel | A new pose is drawn rather than derived. This is the whole reason for leaving the parametric character behind. |
| Markings only ever accumulate | The reset is midnight, not a mistake. A cat that visibly downgrades when you abandon a block would be a punishment dressed as a pet. |
| Neither a break nor a priorities block from an older log ends a streak | Both are things the app actively wants you to do. A counter that punished them would argue with the rest of the product. |
| Utterances are derived from the numbers, not drawn from a phrase pool | A pool would need a seed to stop it churning on the tick, and it would be the one part of Mono that talks for the sake of talking. Everything else here states a fact and stops. |
| One-time facts speak before repeatable ones | A remark about a return can come back; ninety minutes, three in a row and the first deep block can each become true only once. Each transition remark is capped at one a day. |
| The icons are generated from the companion's own frames | So the app icon cannot quietly stop being a picture of the thing in the corner of the app. |
| Scene geometry is shared, DOM-free data | The app and the contact-sheet generator both draw from `scene.ts`. A mirrored copy once reproduced a misplaced shelf faithfully instead of exposing it. |

### Rooms and ambience

| Decision | Why |
|---|---|
| Silent until asked, including for logs written before sound existed | An app that starts making noise because you updated it has spent trust it did not earn. A missing setting folds to `off`, so an old install is quiet and a room choice never implies a sound. |
| Sound is synthesised locally, never streamed or bundled | Brown, pink and rain are a few lines of Web Audio. A track would mean a file to ship or a host to depend on, and Mono would stop being a thing that works with the network off. |
| Preferences are persisted; progress is derived | `roomId`, `ambience` and `ambienceVolume` are a settings patch like any other. The scene tier, trail, milestones and postcard are projections of the same history the timeline is drawn from. Storing either of the latter would put a saved number beside the log it came from, and the day would eventually be told two ways. |
| The rooms are four curated palettes, not a colour picker | Every room has to keep twelve semantic tokens legible against pixel art at four growth tiers. That is a design decision each time, and it is checked by eye through `npm run companion`. An arbitrary colour is a promise the contact sheet cannot keep. |
| A room is a hue, not a brightness | Every room sits on one lightness ramp and differs only in hue and chroma. Lifting a room's walls carried every token up with them and read as louder rather than warmer. Equal restraint takes unequal chroma: blue reads as merely dark, so Tide carries more of its hue than Hearth or Fern. |
| Room and sound live in a header menu, not in Settings | They are chosen by looking and listening, so the control belongs where the result is visible. Putting them in both places would have created a second copy to keep in step. |
| The session mute is not an event | It resets on reload and never reaches the log. The log is the day's journal and how loud the room was is not part of what the day was. |
| A continuous control journals only where it comes to rest | The volume slider updates the live gain on every step and appends one event on release, blur or teardown. Coalescing in the reducer was rejected: it would make rewriting history a general store behavior to serve one control. |
| The chime and ambience share an audio context but not a gain bus | A muted room cannot swallow the end-of-block cue. |
| The browser's autoplay boundary is exposed, not evaded | A block restored after a reload waits behind `Resume ambience` until a gesture. |
| The companion's growth is the same history, told as a room | Tiers at one, three and six completed blocks, and a trail that keeps the order things happened in. It is not a score: nothing is spent, nothing carries to tomorrow, and an abandoned block adds an honest gap rather than taking a mark away. |
| The focus tap is a tour, not a reward | Tapping during a block steps through how the room *can* grow and then puts it back. It writes no event and unlocks nothing, which is what keeps it from becoming a reason to tap instead of work. |

### Layout

| Decision | Why |
|---|---|
| The header is places on the left and tools as icons on the right | Six labelled buttons — room, pop-out, three pages and Settings — put places and actions in one undifferentiated row, which wrapped on a phone. Today and Tasks, the two views a day moves between, are a switch beside the mark; Later, the room (its own swatch), the pop-out, the guide and Settings are icons that keep their names as accessible names and hover titles. Later comes first, nearest what you are doing, being the one reached for in the middle of something else; it carries no count, which would be a reason to look at it. The room menu and Later share one popover's dismissal and placement (`useHeaderPopover`): Escape, a pointer pressed outside, or the focus moving elsewhere on the page puts one away. Leaving by focus is the keyboard's press outside; without it, Tab to the next tool and Enter opened a second panel over the first. One rule for leaving, rather than the panels tracking each other. Below `sm` the gaps close up so the row still fits a phone with five tools; a real phone draws four, having no picture-in-picture. `Not saving` and a page's timer strip stay words, because they are rare and matter when they appear. One `AppHeader` draws it on every view. |
| One breakpoint decides who scrolls | From `lg` up the columns are pinned and scroll inside themselves; below it nothing is pinned and the document scrolls. Two short boxes with their own scrollbars inside a page that does not move is three scroll surfaces where a phone offers one gesture. |
| An hour is the same height on every screen | A 45-minute block looking like 45 minutes is the reason the calendar is drawn against an axis at all. |
| A block's logs and urges are drawn at their minutes, and a log is read from its own mark | Urges are dots in the block's tone and logs are small bright bars, in one column down its right edge; ticks and dots on opposite edges read as damage to the border. Pointing at a bar opens that one log, with its edit and delete. Logs are pushed apart only as far as pointing at each needs, and where a short block cannot hold them that far apart the nearest neighbours share a mark, drawn as a small stack, whose card lists them (`stackRuns`): more spacing cannot help a block that is full, and letting marks overlap buried a log under the next. Urges are not spaced at all — nothing is done with a past urge — so they sit at their own minutes, under the logs. The layers are fixed — urges, then logs' targets, then open cards — so pointing at an urge never lifts it over a log beside it. A card's side and size are worked out from the room in what it is seen through (`placeCard`), rather than fixed: a crowded lane, a short window or a scroll cut fixed ones off. They are worked out again for as long as it is open, however it was opened — pointer, keyboard or an edit — since its block can move under it. An edit under way belongs to the block's marks by log id (`useLogDrafts`), not to the mark drawing the log, since a neighbour written or deleted redraws a log on a new mark; and a block keeps one key on the calendar whether running or over, so ending it does not redraw it either. A single chip for a crowded block was rejected for losing every position, and growing a crowded block for breaking an hour's height. A block cut at midnight carries on each day only what was written on that day's side (`drawnWithin`). Inside, the block prints the tasks it was for, not its logs, and clips them at its height. A card or panel of the block's whole log was designed first and dropped: on a long block it is a wall of text standing on the day it annotates. It relies on hover, which is acceptable because Mono is used at a desk. |
| A component used on surfaces of different widths asks its container | `RegionShapeEditor` sits in a dialog, the calendar column and the stage at the same viewport width. A breakpoint would fix one of them and miss the others. |
| Native time and number fields are framed, not padded, and stack on phones | iOS Safari's own controls ignore the box they are given (see *Traps*). A physical device is the authority; Chromium cannot reproduce the failure. |
| The calendar's column trades the day for All Tasks while a question chooses tasks, and offers to while a block runs | While today's question or the purpose prompt is open the column opens on All Tasks, with a switch in its header back to the day; the hours and commitments questions never switch, since they are answered against the calendar. While a block runs the same switch is there but the column opens on the day, which is drawing the block: All Tasks is for writing down a task that turned up and putting today's list right without leaving the block, and a tick there takes the task on in the block or lets it go (see *The session*). This reversed "no filing a task from inside a running block", which sent everything to Later; Later is still the one-line way, and the backlog is now one press away rather than one block away. It keeps the stage to the answer, gives the backlog the column's height with no box scrolling inside the page, and puts the list being chosen from beside the list being built, so a task is dragged across rather than up. That is why `App` holds the drag (`TodayCarry`) and the block's ticks (`BlockPick`) around and above both columns, the drag scoped to the question so that it ends when the places it goes are no longer drawn. The switch hides the other view rather than unmounting it, because each holds drafts — a task being written, an hour being changed — that a conditional threw away. |

### The guide

| Decision | Why |
|---|---|
| It quotes live settings | It is built from one `Settings` snapshot, so it cannot disagree with the app, and a settings change rebuilds every example together. |
| One subject per section, and each fact told once | A section had grown to a third of the page because everything new arrived there. Facts told twice drift apart. |

### The extension

The current model is in [`extension.md`](extension.md), and where a row below
and that contract seem to differ, the contract wins. These are the reasons
behind its shape.

| Decision | Why |
|---|---|
| It lives in this repository | The two halves share one type, `BlockingIntent`. Across two repositories a change to it compiles on both sides and fails in a user's browser; here it is a compile error. |
| It is told one absolute end, and there is no heartbeat | With a heartbeat, a missing message is indistinguishable from a dead app, and every way of resolving that is either "block forever" or "unblock whenever the tab is slow". |
| Session rules, not dynamic ones | Dynamic rules survive a crash, which would leave a site blocked with nothing running that knows why. Losing state is the safe direction; restoring it is a deliberate check against the clock. |
| `redirect` where permitted, `block` otherwise | The interstitial repeats the purpose the user typed, which is the only argument a blocker has any business making. A redirect needs host permission, requested one site at a time from the click that adds it; requesting every site up front is the loudest warning Chrome shows. The interstitial being probeable by any site is a cost accepted knowingly. |
| No `tabs` permission | It would trade the URL of every open tab for one convenience. Content scripts announce their own tab instead. |
| The escape hatch ends the block through Mono | Lifting the rules would leave a block counting that nobody sat through, so the normal path is Mono's own abandon. When the publisher cannot be reached, the worker tears the rules down at once and leaves the journal to a request recovered by the next Mono page: a failed page load must not hold the user's browser hostage. There is no timed pass, for the same reason there is no pause. |
| Authority is a lease naming its block and document | Two tabs hold independent sessions, so an anonymous stop is honoured from the document that armed the block — or when no usable lease exists, which is deliberate recovery after a browser restart, an extension reload or update, or a handover that did not finish. A document id rather than a tab id, because a reload keeps the tab and loses the session. |
| Writes are ordered by the failure you would rather have | Arming writes the record and secures the alarm before installing any rule. Disarming writes the empty record, then removes the rules, and only then clears the alarm and the session housekeeping. A half-finished sequence must leave nobody blocked with nothing intending to stop it. |
| Its tests run the real worker against a behavioral fake | Every bug here is state that outlives a call. The fake models Chrome, including refusing a chosen write (`failNext`), because mutation testing cannot catch a wrong order. A fake kinder than Chrome makes the code look better than it is. |

### Building, testing and CI

| Decision | Why |
|---|---|
| CI builds once, and the browser suite tests the bundle that ships | One `verify` job builds, tests, and hands the same `dist` to Pages. Separate jobs each paid for their own install and a second build, and tested something other than what was deployed. |
| CI verifies every pull request; the local routine stays narrow | The full production browser suite runs in CI on each PR. Locally it is reserved for what the dev server cannot show — build, PWA, service worker, lazy loading, the test harness — and releases. When CI only ran on `main`, failures were found by the deploy. |
| The browser suite has a development path and a production path | `test:e2e:dev` reuses a Vite server for fast, filtered runs; `test:e2e` builds and previews. Both share every browser setting and assertion. |
| Unit tests for rules, browser tests for wiring | A domain rule and its variations are unit-tested beside the domain code; a browser test proves the rule reaches the screen, once per user-visible behavior. Vitest defaults to Node; files that need browser globals opt into jsdom. |
| React and Motion are split into chunks by hand | A caching decision, not a size one. Mono is a precached PWA, so an ordinary release refetches the app chunk alone rather than a file with React inside it. |
| Motion loads `domAnimation` through one `LazyMotion` at the root | It is the animations and gestures the app uses, without drag and layout projection. Given a feature set inside `PixelCat`, it reallocated a context value per cat per second. |
| A view needed when things are failing is never lazy-loaded | Settings holds Export, the rescue for the one unrecoverable failure. Deferred, it sat behind a fetch that can fail in exactly that state. |

---

## Traps

Things that have already bitten.

**`now` ticks every second — never seed or reset state from an effect that
depends on it.** The commitment form reset itself once a second, which reads
while typing as the field clearing on every keystroke. Reading `now` during
*render* is fine; writing it into state on a tick is not. There is a regression
test that types with the real clock running. Forms mount when they open and
seed from a lazy `useState` initialiser; anything that goes back to an `open`
prop on a mounted form brings the hazard back. The legitimate exception is an
effect whose job is to watch the clock — `useReconciliation` checks every tick
for a block boundary — and it guards itself so that a transition fires once.

**A finite number is not an instant.** `1e20` passes `Number.isFinite`, makes an
invalid `Date`, and `format` throws on it. Replay reads days from event times, so
one such event in storage threw out of rehydration and left an empty session.
Every instant that crosses the schema boundary — an event's `at` and the times
inside it, and the backlog's — goes through `isInstant` in `time.ts`.

**Zustand's `persist` rehydrates synchronously, during module evaluation.**
With a sync storage, `migrate` and `onRehydrateStorage` execute at the
`create(...)` call — before any `const` declared *below* it in the same file
exists. `migrate` used to call a helper from the bottom of `session.ts`, hit its
temporal dead zone, and zustand's hydrate path swallowed the ReferenceError: the
store silently kept its initial state, so a v1 log was wiped rather than
migrated, and the only symptom was an empty app. Anything reachable from those
two hooks lives in `schema.ts` now. Do not declare a new one after the store.

**That synchronous rehydration is load-bearing.** The blocking publisher sends
its first intent before React renders, and after a reload the extension may
have no lease to judge it by. Because `localStorage` restores a running block
synchronously, that first intent is the block rather than an anonymous idle
that would unblock everything. Moving the session log to asynchronous storage
means gating publishing on hydration first.

**`persist` does not swallow a refused write; it throws out of the action.** It
wraps `setState` with nothing around the save, so a `QuotaExceededError` leaves
memory updated and the rest of the click handler unrun. `guardedStorage` is the
catch. Anything else that persists needs the same treatment.

**A finished block is not in the log until the user answers.** `timerElapsed`
moves `focusing` to `blockComplete` and appends *nothing* — the block stays
open through the "break or keep going?" prompt so that walking away from it
cannot silently bank it. That is deliberate and has its own test. The cost is
that anything reading the day back during that prompt sees one block fewer than
the user does: the companion congratulated you on the block before last, and
told you "that makes 0 today" on the first block of a day. `vitalsFor` takes
the open segment as an argument for exactly this reason. Anything else that
learns to read the history back will hit the same edge.

**`React.lazy` never reveals under a paused clock.** React throttles the reveal
of suspended content on a `setTimeout`, and every browser test pauses time, so
a lazy view simply never appears, with no error. Deferred views are loaded by an
effect into ordinary state (`useDeferred` in `App.tsx`), one call per view —
never combined under one `Promise.all`, which turned one failed chunk into two
dead views. Anything routed through Suspense has to be checked against the
specs. Browser-test traps of the same family are listed at the top of
`e2e/support/mono.ts`.

**Forms that never used to coexist now do.** While the editors were dialogs,
only one could be on screen, so identical labels in two of them were harmless.
Inline, the day's opening question, the calendar's composer and the settings
panel can all be mounted at once. `RegionShapeEditor` therefore takes a `label`,
so today's hours are `Hours 1 start` while the recurring shape stays
`Working hours 1 start` — one is a substring of the other, so specs name them
exactly; and `CommitmentFields` takes an `idPrefix`, because
two `id="commitment-title"` inputs point every second label at the first field.
The tasks page keeps the stage mounted while it is shown, so today's question
and the page's own Today section can both be in the document, with the same
`New intention` field: specs scope it to the stage or to the page, and neither
surface uses a fixed id.

**Temporary state held by id is let go, not hidden.** A block's ticks, a
carried task and a rename each name a task by id and outlive the row that drew
them. Filtered out only while their task was away, each came back when it did
— a tick re-armed Start, a rename brought back its old draft — with nobody
having asked. So when the thing they need stops being true they are dropped for
good, during render, and the test is that need rather than whether the id is
still on screen: a done task is drawn but cannot be renamed, and a task picked
up from today's list has lost its row when it leaves today. Session-scoped
gestures also end at a new `generation`, and the backlog's at a new `replaced`. The same mistake runs the other way
too: state that lives with the component drawing it lasts as long as that
component, not as long as the gesture. A rename held by today's list went
when the opening question looked at another question, and a carry held around
both columns asked for a `Move here` into a running block. So such state is
held by whatever lasts exactly as long as the gesture, and a holder that
outlasts it is told when it ends (`TodayCarry`'s `scope`).

**A drag's `dragend` is lost when the drop moves its row.** A task dragged
to another place in All Tasks is held by two carries, the tree's and today's,
and only the one it is let go on puts itself down. The other waited for
`dragend`, which fires on the row the drag began from — by then unmounted
under its old place, so no handler heard it. That carry kept holding a drag
that was over, and offered somewhere to drop it. Every carry now lets go on
the document's `drop` (`useCarryState`); `dragend` is only for a drag let go
on nothing, whose row has not moved. Anything that cleans up after a drag
should not rely on its source still being there.

**Companion frame anchors fail silently.** Each pose hand-places where its face,
markings, note and heart go. Get one wrong and the eyes float on the background
or the markings hang off the flank — and the pose still looks deliberate enough
that nobody notices. Tests assert every anchor lands on solid fur; keep them
that way when adding a pose.

**The focus-tap preview can show a *lower* tier than the day has earned.**
Tapping during a block starts one tier past the factual one and wraps from three
back to one, so a tier-3 afternoon briefly displays a tier-1 room and fewer cat
markings. This looks exactly like a bug and is not one: the tap is a tour of how
the room grows, the state belongs to `PixelCat` rather than to the projection,
and it expires back to the truth. Anything that "fixes" it by clamping to the
earned tier removes the point of the interaction on the days most likely to use
it.

**Service worker updates are deferred until idle.** Reloading mid-block would
destroy a focus session, and reloading with the mini window open closes a
window that only a gesture can reopen. The registration subscribes to the store
and only flushes when neither is the case.

**iOS Safari's native controls ignore the box they are given.** Its time and
number inputs keep an intrinsic minimum width, so both the input and its grid
cell need an explicit zero minimum; and on iOS 26 a temporal input with both
padding and `width: 100%` miscalculates its width (WebKit bug 301648), so the
padding sits on a frame around it. None of this reproduces in Chromium's
responsive mode. Do not reach for `overflow-x: hidden` on a panel as a last
boundary either: it turns the other axis into a second scroll container.

**Do not add `--omit=optional` to `npm ci`.** Rollup ships its platform binaries
as optional dependencies, so omitting them does not skip `sharp`, it breaks
`vite build`.

**A diff that is mostly whitespace is a configuration bug.** An `.editorconfig`
property before any `[…]` section applies to nothing, and an editor reindented
two whole files to four spaces. `git diff -w --stat` beside `git diff --stat`
shows the gap at once. `end_of_line` is left out deliberately: `core.autocrlf`
crosses between the CRLF working copy and the LF repository.

**A record read back from IndexedDB is a clone.** Comparing a stored record
with the copy that was written by reference finds them different whenever
anything in it is nested, and every Later written during a block carries
where it came from. The disk's equality fallback compared fields with `===`,
so a saved line from a block differed from itself and could never be filed.
Records are compared as data (`sameValue` in `taskDb.ts`); anything new that
compares stored records needs the same.

**Perf note.** `App` re-renders every second and `derivePlan` runs on each tick.
Cheap at this scale and measurably fine, but it is the first place to look if
the calendar ever feels sluggish. `App` also subscribes to the whole store with
a bare `useSession()`; it re-renders every second anyway, so this costs nothing
today. Anything expensive that is keyed on the *day* rather than the second —
the companion's vitals, the backlog's projections — should stay keyed that way.

---

## Deliberately not built

- **No history or journal view.** The log captures everything one would need
  (completed and abandoned blocks, purposes, away spans) and `vitals` reads a slice
  of it back, but nothing presents the archive.
- **No cross-device sync.** JSON export/import is the escape hatch. The
  backlog is shaped so sync could be added later — client ids, `updatedAt` on
  every record, tombstones — but nothing talks to a server, and adding one
  reverses this entry and the one about accounts below.
- **No cross-tab synchronisation of the session.** Two tabs of Mono are two
  independent sessions writing one key. The backlog converges between tabs; the
  day does not, and the extension's lease exists because of it.
- **No weekday-aware default shape.**
- **No RRULE, and no "first Monday of the month".** Every N days, every N
  weeks on some weekdays, and every N months on a date say nearly everything a
  working day is fixed around. Each extra shape is a form field and a case the
  day has to be tested against; the nth weekday is the obvious next one.
- **No exceptions to a series on any day but today.** Skipping next Tuesday's
  swim would need a stored list of future days, which is the schedule the
  derivation avoids, and planning tomorrow is not built either. A series can be
  given an end date, or the day can be skipped when it comes.
- **No editing a block's purpose after it starts.** Its tasks can change, from
  All Tasks; the sentence it was started with stays. What it can take besides
  is a log about how it is going, which says nothing about what the block is
  for.
- **No due dates, priorities, estimates, tags or area colours on tasks.** Each
  is a field to keep current and a reason to open the tasks page instead of
  starting a block. Area colours would also be hand-picked hues outside the
  palette, which the rooms decision rules out.
- **No undelete.** A delete is final everywhere copies are reconciled, which is
  what lets one tombstone stand for its whole subtree. Importing an earlier
  backup is the one way back, deliberately: an import replaces the backlog
  rather than being reconciled with it.
- **No urge counted by the extension.** Opening a blocked site is an urge if
  anything is, but the blocked page can only ask Mono to end the block; it has
  no channel to report anything else, and adding one for a count would widen
  the protocol for a number nothing reads.
- **No order of its own for today, no planning tomorrow, no dismissing a
  suggestion.** Today's tasks are drawn under the places they live in, so an
  order of their own would be a second arrangement to keep; putting the
  backlog in order puts today's in order with it. Tomorrow would need
  a date on the task, which is the stored schedule today's map avoids. A
  carried-over suggestion expires at the next reset after a day that chooses
  something, so dismissing it would be a write that saves nobody anything.
- **No dragging from the backlog board into Today.** The board and today's list
  each put a task down only among their own places, sharing one hand so that
  only one holds a task at a time; the sun on a row is how a task is chosen.
- **No component tests.** Nothing mounts a component in vitest. Logic is tested
  there — the pure domain, the stores against a fake IndexedDB, the extension
  worker against a behavioral Chrome fake — and screens are tested in
  Playwright. A layer between the two would duplicate the browser suite's
  coverage without its fidelity.
- **No light theme, and no custom room colours.** See the rooms decisions above.
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
- **No second always-on-top window, and no pop-out on minimise.** Document
  picture-in-picture gives one window per document and no way to place it, and
  the paths that open one without a gesture need capture or audible playback
  that a quiet timer cannot rely on. The feature is designed around that rather
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
