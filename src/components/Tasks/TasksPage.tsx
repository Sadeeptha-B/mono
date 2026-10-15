/**
 * The backlog, as a page.
 *
 * A page rather than a panel on the day, for the guide's reason: this is
 * somewhere you go and stay a while, and the stage is for one question at a
 * time. The day only ever sees today's tasks and the tasks a block is for;
 * filing, renaming and tidying the backlog happens here, away from the timer.
 * `App` swaps this page in for the day while its own hooks — the session, its
 * timers and reconciliation — stay mounted, so a block keeps running while
 * you are here, and the header says what the timer would be saying. The page
 * itself is mounted afresh on each visit, and its own state goes when you
 * leave: the view chosen, today's list open or not and its drafts. A board
 * field being written is kept by the click that took you away, as any click
 * elsewhere keeps it (`useLeave`); beyond that, only what is saved — the
 * board's folds — or held above the routes outlasts a trip to the day.
 *
 * The page is the board. Today's list — the tasks chosen for the day,
 * gathered under the intentions some of them are carried into, the same list
 * as on the opening question — waits behind a button in the corner
 * (`TodayPopup`), and what was put down for later is on the timeline page,
 * filed from there. Both were sections above the board, and pushed the areas
 * down the page they are the subject of.
 *
 * **Areas** are the backlog itself, one band
 * each, drawn as a board rather than as a general-purpose tree, because three
 * levels is the whole depth the model allows. A rule splits every band in two.
 * Down the left is what the area is made of: its name, one card per epic, and
 * its inbox last, the open tasks that sit directly under it. On the right, level
 * with each of those, is what it holds — beside an epic, one column per outcome
 * with that outcome's tasks beneath it, then a column of the tasks that sit
 * straight under the epic; beside the inbox, its tasks. The area's own actions
 * sit level with its name. Columns wrap rather than scroll, so a wide epic
 * grows downwards and the page never scrolls sideways; below `md` the two
 * halves of each row stack, the board indented under its card. The page is
 * every view's width (`APP_WIDTH`) rather than wider, so moving to it moves
 * nothing; its columns are narrow enough that a row holds four outcomes at
 * that width. An outcome scrolled sideways out of sight is one nobody reads,
 * and a drag between columns would hang on the browser scrolling a box inside
 * a box sideways for it, which it does unreliably.
 *
 * The board is the work; everything put away is the backlog's other view
 * (`PutAwayView`), behind a switch beside the page's title (`BacklogSwitch`). A
 * column keeps only what was finished in it today, crossed out under its open
 * tasks. And an epic or outcome folds down to its card by the caret on it,
 * which the page remembers, so a long backlog can be read as its places.
 *
 * Epics and outcomes are finished by hand, archived, or deleted; areas, which
 * never finish, are archived or deleted. Finishing and archiving never touch
 * what is inside; the subtree leaves the page and All Tasks together
 * because its chain is no longer active, and returns unchanged when the epic
 * or area is reopened or restored — see `isInActiveTree`. Deleting takes the
 * subtree too, the same way and for good (`isGone`), so it asks first, naming
 * how much will go with it.
 *
 * A task moves by being carried (`carry.tsx`): dragged by its row to any other
 * column, or, from the keyboard or a touch screen, picked up with the grip on
 * its row and put down with the `Move here` that every other column then
 * offers. Only open tasks are carried, and every column on the page takes one,
 * because every column is a place a task can live. Today's list carries its
 * own tasks between intentions the same way, with its own targets but the
 * board's hand, so picking up on one puts down the other: a task on the
 * board is not dragged into Today, it is chosen with the sun on its row.
 *
 * The same hand puts the board in order. A task let go between two rows of a
 * column lands there, in its own column or another; an outcome's card dragged
 * along its epic's row of outcomes, an epic's card up or down its area, or an
 * area's name up or down the page, lands between the two it is let go
 * between, and never under another parent. From the keyboard a task steps
 * through its column with the arrow keys on its grip, and a card or an area
 * with its own move icons, among its others; see `useDropList` for how a
 * drag works out where it would land.
 *
 * The tasks straight under an epic are a column beside its outcomes with no
 * card, and with nothing at its head they read as one more outcome — a task
 * written into the epic was taken for an outcome that had appeared to the
 * right of `Add outcome`. So the column is headed `Tasks`, small
 * and quiet, as a card's own `Outcome` is.
 *
 * Every edit here is a backlog edit — the task store writes the one record it
 * changed — except choosing a task for today, grouping it under an intention,
 * or marking an intention done, which are facts about today and go to the log
 * like the intentions themselves. A task that is dropped or done stays
 * today's, and today's list shows it crossed out or stops drawing it.
 *
 * Actions are icons (`IconButton`): today, rename, done, drop, archive,
 * reopen, restore, delete. An epic's or outcome's card carries a sun too,
 * which chooses everything open in it for today at once (`PlaceSun`). A column
 * is narrow, and as words they took more of a row than the title they acted
 * on. Each says in its accessible name what it
 * acts on and shows its verb on hover. They show only on hover or with focus
 * in their row or card, and always on a touch screen (`revealOnHover`), as in
 * All Tasks: at rest the board reads as its titles. What says something rather
 * than offering it stays — the grip, the checkbox, and the sun of a task
 * chosen for today. The words left are answers to a question — a delete asking
 * about what is inside — and the `Save` on a rename in today's list, which is
 * shared with the stage. The board's add and rename fields have none: leaving
 * one keeps what was typed in it
 * (`useLeave`), and a task, outcome or epic is added as an empty card drawn
 * where it will stand.
 */

import { useCallback, useMemo, useState } from 'react'

import { APP_WIDTH, AppBar } from '../AppHeader'
import { HeaderStatus } from '../HeaderStatus'
import {
  Carry,
  CarryStatus,
  useCarryHand,
  useCarryState,
  type CarryHand,
  type Slot,
} from '../carry'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'
import {
  activeAreas,
  activeTasks,
  isLive,
  openContainers,
  openTasksBeneath,
  openTasksUnder,
  putAwayIn,
  staysPut,
  taskTree,
  type Area,
  type Item,
} from '@/domain/tasks'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'
import { AreaList } from './Board'
import { PutAwayView, putAwayCount } from './PutAway'
import { TodayPopup } from './TodayPopup'
import { AddFields, AddForm, useAddFieldsValue } from './addFields'

/** How wide the page is: every view's width (`APP_WIDTH`), so the board keeps the bar's edges. */
const PAGE_WIDTH = APP_WIDTH

export function TasksPage({
  now,
  active,
  timerMode,
  onOpenSettings,
  mini,
}: {
  now: Ms
  active: ActiveSegment | null
  timerMode: TimerMode
  onOpenSettings: () => void
  mini: MiniWindowControls
}) {
  const phase = useSession((s) => s.phase)

  const hydrated = useTasks((s) => s.hydrated)
  const replaced = useTasks((s) => s.replaced)
  const addFields = useAddFieldsValue()
  // Shared by today's carry and the backlog's, so only one holds anything at a time.
  const hand = useCarryHand()

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The bar every view shares (`AppBar`): pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <AppBar
        current="tasks"
        phase={phase}
        mini={mini}
        onOpenSettings={onOpenSettings}
        status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
      />

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* As wide as the header, not the guide's reading measure: a band
            sets columns side by side, and the prose here is capped on its own.
            Room at the foot for the corner's Today button, so the last of the
            board can be scrolled out from under it. */}
        <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-8 pb-32 sm:px-6 sm:pt-10`}>
          {!hydrated ? (
            <>
              <h1 className="text-3xl font-light text-bright sm:text-4xl">Tasks</h1>
              <p className="mt-8 text-sm text-muted">Loading your tasks…</p>
            </>
          ) : (
            <AddFields.Provider value={addFields}>
              {/* Keyed by the backlog's own replacements (`Backlog`): it
                  outlives the day, so a midnight reset keeps what is typed in
                  it. Today's list is keyed by the day instead (`TodayPopup`). */}
              <Backlog key={replaced} hand={hand} />
              <TodayPopup hand={hand} />
            </AddFields.Provider>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * The page's title and the board, with the carry that moves tasks between
 * columns and puts the board in order.
 *
 * Keyed by the backlog's replacements (`replaced`), so an import — here, or
 * in another tab — starts it again. The drafts held in here name records by
 * id: a rename half typed, a task picked up. A replacement can bring back the
 * same id with different contents, and a rename kept across it would be saved
 * over what was imported, so they go with the backlog they were about, the
 * way the day's drafts go with the session's `generation`.
 *
 * What is typed into an `Add …` field names no record, and is not held in
 * here but by the page, above the key (`AddFields`). It outlasts the
 * replacement: a line refused while an import was landing — every edit is
 * refused then — is still in its field once the import has landed, to be
 * kept. Keying the whole of this let those go too, the one moment the
 * refusal had promised to keep them.
 */
function Backlog({ hand }: { hand: CarryHand }) {
  const today = useSession((s) => s.session.today)
  const allAreas = useTasks((s) => s.areas)
  const items = useTasks((s) => s.items)
  const day = useSession((s) => s.dayKey)
  const addArea = useTasks((s) => s.addArea)
  const moveItem = useTasks((s) => s.moveItem)
  const placeItem = useTasks((s) => s.placeItem)
  const placeArea = useTasks((s) => s.placeArea)

  const [view, setView] = useState<BacklogView>('open')
  // Per backlog snapshot, not per render: the header's timer re-renders this
  // page every second, and the backlog has not changed on most of those.
  const archived = useMemo(
    () => allAreas.filter((a) => isLive(a) && a.archivedAt !== undefined),
    [allAreas],
  )
  const areas = useMemo(() => activeAreas(allAreas), [allAreas])
  // What each area has put away, counted on the switch even while the board is showing.
  const byArea = useMemo(
    () => areas.map((area) => ({ area, entries: putAwayIn(area.id, items) })),
    [areas, items],
  )
  const inPlay = useMemo(() => activeTasks(items, allAreas), [items, allAreas])
  const inPlayById = useMemo(() => new Map(inPlay.map((t) => [t.id, t])), [inPlay])
  // What an epic's or outcome's sun chooses: every open task in play beneath it.
  const beneath = useMemo(() => openTasksBeneath(taskTree(items, allAreas)), [items, allAreas])
  // The areas, epics and outcomes the board draws, which are carried only to
  // be put in order among their own.
  const drawnPlaces = useMemo(() => {
    const byId = new Map<string, Item | CarriedArea>()
    for (const area of areas) {
      byId.set(area.id, { id: area.id, title: area.name, area })
      for (const epic of openContainers(area.id, 'epic', items)) {
        byId.set(epic.id, epic)
        for (const outcome of openContainers(epic.id, 'outcome', items)) byId.set(outcome.id, outcome)
      }
    }
    return byId
  }, [areas, items])

  // The board's carry: a task goes to any column but its own.
  const find = useCallback(
    ({ id }: { id: string }): Carried | undefined => inPlayById.get(id) ?? drawnPlaces.get(id),
    [inPlayById, drawnPlaces],
  )
  const takes = useCallback(
    (carried: Carried, parentId: string) =>
      !isArea(carried) && carried.kind === 'task' && carried.parentId !== parentId,
    [],
  )
  const move = useCallback(
    (carried: Carried, parentId: string) => {
      if (isArea(carried)) return
      moveItem(carried.id, parentId)
      return carried.id
    },
    [moveItem],
  )
  // Between two rows: a task lands there in any column, and an epic, an
  // outcome or an area only moves among its own siblings. A slot where it
  // already stands takes nothing, so no line is drawn where letting go would
  // change nothing.
  const fits = useCallback(
    (carried: Carried, { parent, kind, before }: Slot) => {
      if (isArea(carried)) return kind === 'area' && !staysPut(areas, carried.id, before)
      if (carried.kind !== kind) return false
      if (parent !== carried.parentId) return kind === 'task'
      const list =
        carried.kind === 'task'
          ? openTasksUnder(parent, items)
          : openContainers(parent, carried.kind, items)
      return !staysPut(list, carried.id, before)
    },
    [areas, items],
  )
  const place = useCallback(
    (carried: Carried, { parent, before }: Slot) => {
      if (isArea(carried)) return placeArea(carried.id, before)
      placeItem(carried.id, parent, before)
    },
    [placeArea, placeItem],
  )
  const carry = useCarryState({ find, takes, move, fits, place, hand })

  return (
    <Carry.Provider value={carry}>
      {/* The title and the switch share a line, so nothing stands between the
          page's name and the board it names. On a phone the switch wraps
          under the title, still above the intro. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="text-3xl font-light text-bright sm:text-4xl">Tasks</h1>
        <BacklogSwitch
          view={view}
          putAway={putAwayCount(byArea, archived)}
          onView={(next) => {
            // Nothing on the other view takes what is in hand.
            carry.putDown()
            setView(next)
          }}
        />
      </div>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
        Everything you mean to do, by area of life. A task sitting straight under an
        area is that area's inbox — file it deeper later, or never. Today's tasks and
        intentions open from the sun in the corner.
      </p>

      <section aria-label="Backlog">
        {view === 'open' ? (
          <>
            <AreaList areas={areas} items={items} today={today} beneath={beneath} day={day} />
            <div className="mt-6">
              <AddForm
                draftKey="area"
                opener="Add area"
                variant="area"
                label="New area"
                placeholder="Health, Home, Side project"
                maxLength={60}
                className="max-w-md"
                onAdd={addArea}
              />
            </div>
          </>
        ) : (
          <PutAwayView byArea={byArea} archivedAreas={archived} items={items} />
        )}
      </section>
      <CarryStatus />
    </Carry.Provider>
  )
}

/** The backlog's two views: the work on the board, or everything put away. */
type BacklogView = 'open' | 'putAway'

/**
 * The switch between the board and what is put away, as a pair of pressed
 * buttons beside the page's title — the calendar column's switch between the
 * day and All Tasks (`ColumnSwitch`), in the page's own heading. The count
 * says how much the other view holds without opening it.
 *
 * Held by `Backlog` rather than saved, so every visit to the page opens on
 * the work, as a reload or an import does: the page is the board, and what is
 * put away is looked up from it rather than somewhere the page is left. Turning
 * it over puts down whatever the board's carry holds, since nothing on the
 * other view would take it.
 */
function BacklogSwitch({
  view,
  putAway,
  onView,
}: {
  view: BacklogView
  putAway: number
  onView: (view: BacklogView) => void
}) {
  const option = (value: BacklogView, name: string, count?: number) => (
    <button
      type="button"
      onClick={() => onView(value)}
      aria-pressed={view === value}
      className={`rounded-md px-2 py-0.5 text-xs font-medium tracking-widest uppercase transition ${
        view === value ? 'bg-surface-raised text-bright' : 'text-muted hover:text-bright'
      }`}
    >
      {name}
      {count !== undefined && count > 0 && <span className="ml-1.5 text-muted">{count}</span>}
    </button>
  )
  return (
    <div role="group" aria-label="Show in the backlog" className="-mx-2 flex items-center gap-1">
      {option('open', 'Open')}
      {option('putAway', 'Put away', putAway)}
    </div>
  )
}

/**
 * An area as the board's carry holds it: carried by its name, as a task is by
 * its title, and only to be put in order.
 */
type CarriedArea = { id: string; title: string; area: Area }

/** Everything the board carries: a task, or a place to reorder. */
type Carried = Item | CarriedArea

const isArea = (carried: Carried): carried is CarriedArea => 'area' in carried
