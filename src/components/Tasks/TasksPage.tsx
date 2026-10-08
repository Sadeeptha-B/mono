/**
 * The backlog, as a page.
 *
 * A page rather than a panel on the day, for the guide's reason: this is
 * somewhere you go and stay a while, and the stage is for one question at a
 * time. The day only ever sees today's tasks and the tasks a block is for;
 * filing, renaming and tidying the backlog happens here, away from the timer.
 * `App` swaps the view without unmounting anything, so a block keeps running
 * while you are here, and the header says what the timer would be saying.
 *
 * Three parts, in the order a morning uses them. **Today** is the tasks chosen
 * for the day, gathered under the intentions some of them are carried into —
 * the same list as on the opening question (`TodayList`), kept in the event
 * log like everything else about the day. **Later** is what was put down to
 * come back to, waiting to be carried into the board as a task, let go or
 * deleted (`LaterSection`). **Areas** are the backlog itself, one band
 * each, drawn as a board rather than as a general-purpose tree, because three
 * levels is the whole depth the model allows. A rule splits every band in two.
 * Down the left is what the area is made of: its name, one card per epic, and
 * its inbox last, the open tasks that sit directly under it. On the right, level
 * with each of those, is what it holds — beside an epic, one column per outcome
 * with that outcome's tasks beneath it, then a column of the tasks that sit
 * straight under the epic; beside the inbox, its tasks. The area's own actions
 * sit level with its name. Columns wrap rather than scroll, so a wide epic
 * grows downwards and the page never scrolls sideways; below `md` the two
 * halves of each row stack, the board indented under its card.
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
 * because every column is a place a task can live. Something waiting in Later
 * is carried by the same hand into any column, and becomes a task there in
 * the one write that takes it out of Later (`fileLater`). Today's list carries its
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
 * which chooses everything open in it for today at once (`PlaceSun`). A column is narrow, and as words they took more of
 * a row than the title they acted on. Each says in its accessible name what it
 * acts on and shows its verb on hover. They show only on hover or with focus
 * in their row or card, and always on a touch screen (`revealOnHover`), as in
 * All Tasks: at rest the board reads as its titles. What says something rather
 * than offering it stays — the grip, the checkbox, and the sun of a task
 * chosen for today. The words left are answers to a question — a delete asking
 * about what is inside — and the fields' own `Done` and `Save`, which finish
 * what is being typed rather than act on a record.
 */

import { useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'

import { AppHeader } from '../AppHeader'
import { HeaderStatus } from '../HeaderStatus'
import {
  Carry,
  CarryStatus,
  useCarryHand,
  useCarryState,
  type CarryHand,
  type Slot,
} from '../carry'
import { TodayCarry, TodayList, useIntentionRename } from '../TodayList'
import { RestoreIcon } from '../icons'
import { IconButton, revealOnHover } from '../ui'
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
  staysPut,
  taskTree,
  type Area,
  type Item,
} from '@/domain/tasks'
import { letGoLater, waitingLater, type Later } from '@/domain/later'
import type { TimerMode } from '@/domain/time'
import type { ActiveSegment, Ms } from '@/domain/types'
import { AreaList } from './Board'
import { LaterSection } from './LaterSection'
import { AddFields, AddForm } from './addFields'

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
  const generation = useSession((s) => s.generation)

  const hydrated = useTasks((s) => s.hydrated)
  const replaced = useTasks((s) => s.replaced)
  const [addField, setAddField] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map())
  const draft = useCallback((key: string, update: (was: string | null) => string | null) => {
    setDrafts((all) => {
      const was = all.get(key) ?? null
      const next = update(was)
      if (next === was) return all
      const changed = new Map(all)
      if (next === null) changed.delete(key)
      else changed.set(key, next)
      return changed
    })
  }, [])
  // Stable across the timer's once-a-second render, so no field re-runs its
  // fold check for a tick.
  const addFields = useMemo(
    () => ({ current: addField, claim: setAddField, drafts, draft }),
    [addField, drafts, draft],
  )
  // Shared by today's carry and the backlog's, so only one holds anything at a time.
  const hand = useCarryHand()

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:h-dvh">
      {/* The guide's header, for the guide's reasons: pinned on a wide screen,
          sticky on a narrow one, and carrying the timer either way. */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-ink px-4 py-3 sm:px-6 lg:static">
        <div className="mx-auto max-w-5xl">
          {/* A page invites you to stay, so whatever the timer would be
              saying stays in sight — including when it is waiting on you. */}
          <AppHeader
            current="tasks"
            phase={phase}
            mini={mini}
            onOpenSettings={onOpenSettings}
            status={<HeaderStatus active={active} now={now} phase={phase} timerMode={timerMode} />}
          />
        </div>
      </header>

      <div className="mono-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* As wide as the header, not the guide's reading measure: a band
            sets columns side by side, and the prose here is capped on its own. */}
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="text-3xl font-light text-bright sm:text-4xl">Tasks</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
            Everything you mean to do, by area of life. A task sitting straight under an
            area is that area's inbox — file it deeper later, or never. What you put down
            for later waits above them until you decide what it is.
          </p>

          {!hydrated ? (
            <p className="mt-8 text-sm text-muted">Loading your tasks…</p>
          ) : (
            <AddFields.Provider value={addFields}>
              {/* Its heading is drawn by the list, so `+ Intention` sits level
                  with it. Keyed by the session's generation, as the stage is:
                  what is being typed about today belongs to one particular
                  day, and the midnight reset or an import must not carry it
                  into the next, nor a task half carried between intentions.
                  The backlog below is keyed by its own replacements instead
                  (`Backlog`): it outlives the day, so a midnight reset keeps
                  what is typed in it. */}
              <section aria-label="Today" className="mt-8 border-t border-line pt-6">
                <div className="max-w-3xl">
                  <TodaySection key={generation} hand={hand} />
                </div>
              </section>

              <Backlog key={replaced} hand={hand} />
            </AddFields.Provider>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * Later and the areas, with the carry that moves tasks between columns and
 * files what waits in Later into them.
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
  const addArea = useTasks((s) => s.addArea)
  const unarchiveArea = useTasks((s) => s.unarchiveArea)
  const moveItem = useTasks((s) => s.moveItem)
  const placeItem = useTasks((s) => s.placeItem)
  const placeArea = useTasks((s) => s.placeArea)
  const fileLater = useTasks((s) => s.fileLater)
  const allLater = useTasks((s) => s.later)

  const archived = allAreas.filter((a) => isLive(a) && a.archivedAt !== undefined)
  // Per backlog snapshot, not per render: the header's timer re-renders this
  // page every second, and the backlog has not changed on most of those.
  const areas = useMemo(() => activeAreas(allAreas), [allAreas])
  const inPlay = useMemo(() => activeTasks(items, allAreas), [items, allAreas])
  const inPlayById = useMemo(() => new Map(inPlay.map((t) => [t.id, t])), [inPlay])
  const waiting = useMemo(() => waitingLater(allLater), [allLater])
  const letGo = useMemo(() => letGoLater(allLater), [allLater])
  const waitingById = useMemo(() => new Map(waiting.map((l) => [l.id, l])), [waiting])
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

  // The board's carry: a task goes to any column but its own, and something
  // waiting in Later goes to any column at all, becoming a task there — which
  // is a new record, so it is the task's id the keyboard's focus follows.
  const find = useCallback(
    ({ id }: { id: string }): Carried | undefined =>
      inPlayById.get(id) ?? waitingById.get(id) ?? drawnPlaces.get(id),
    [inPlayById, waitingById, drawnPlaces],
  )
  const takes = useCallback(
    (carried: Carried, parentId: string) =>
      isItem(carried) ? carried.kind === 'task' && carried.parentId !== parentId : !isArea(carried),
    [],
  )
  const move = useCallback(
    (carried: Carried, parentId: string) => {
      if (isItem(carried)) {
        moveItem(carried.id, parentId)
        return carried.id
      }
      return isArea(carried) ? undefined : (fileLater(carried.id, parentId) ?? undefined)
    },
    [moveItem, fileLater],
  )
  // Between two rows: a task lands there in any column, what waits in Later
  // is filed there, and an epic, an outcome or an area only moves among its
  // own siblings. A slot where it already stands takes nothing, so no line is
  // drawn where letting go would change nothing.
  const fits = useCallback(
    (carried: Carried, { parent, kind, before }: Slot) => {
      if (isArea(carried)) return kind === 'area' && !staysPut(areas, carried.id, before)
      if (!isItem(carried)) return kind === 'task'
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
      if (!isItem(carried)) return fileLater(carried.id, parent, before) ?? undefined
      placeItem(carried.id, parent, before)
    },
    [placeArea, placeItem, fileLater],
  )
  const carry = useCarryState({ find, takes, move, fits, place, hand })

  return (
    <Carry.Provider value={carry}>
      {/* Inside the board's carry, since what waits here is carried
          into the board to become a task. */}
      <LaterSection waiting={waiting} letGo={letGo} />

      <AreaList areas={areas} items={items} today={today} beneath={beneath} />

      <div className="mt-6">
        <AddForm
          draftKey="area"
          opener="Add area"
          variant="prominent"
          label="New area"
          placeholder="Health, Home, Side project"
          maxLength={60}
          className="max-w-md"
          onAdd={addArea}
        />

        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted hover:text-body">
              Archived ({archived.length})
            </summary>
            <ul className="mt-2 flex max-w-md flex-col gap-1.5">
              {archived.map((area) => (
                <li key={area.id} className="group/row flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 wrap-break-word text-muted">{area.name}</span>
                  <IconButton
                    onClick={() => unarchiveArea(area.id)}
                    label={`Restore ${area.name}`}
                    hint="Restore"
                    className={revealOnHover}
                  >
                    <RestoreIcon />
                  </IconButton>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <CarryStatus />
    </Carry.Provider>
  )
}

/**
 * Today on this page: today's list with its intentions (`TodayList`). Tasks
 * are chosen with the sun on their rows below; carrying between intentions
 * has its own carry here, apart from the board's, sharing one hand with it.
 *
 * The intention field keeps the page's rule for add fields: opening it folds
 * any other that is empty, and opening another folds it while nothing has been
 * written in it.
 */
function TodaySection({ hand }: { hand: CarryHand }) {
  const [intention, setIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  const formId = useId()
  const { current, claim } = useContext(AddFields)
  // Another field was opened: fold this one if nothing has been written in it.
  useEffect(() => {
    if (current !== null && current !== formId) setIntention((t) => (t === '' ? null : t))
  }, [current, formId])

  return (
    <TodayCarry hand={hand}>
      <TodayList
        heading={
          <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Today</h2>
        }
        newIntention={intention}
        onNewIntention={(next) => {
          if (intention === null && next !== null) claim(formId)
          if (next === null && current === formId) claim(null)
          setIntention(next)
        }}
        renaming={renaming}
        onRenaming={setRenaming}
        empty="Nothing chosen for today yet. Choose a task with the sun on its row below."
      />
    </TodayCarry>
  )
}

/**
 * An area as the board's carry holds it: carried by its name, as a task is by
 * its title, and only to be put in order.
 */
type CarriedArea = { id: string; title: string; area: Area }

/** Everything the board carries: a task, a line from Later, or a place to reorder. */
type Carried = Item | Later | CarriedArea

const isItem = (carried: Carried): carried is Item => 'kind' in carried

const isArea = (carried: Carried): carried is CarriedArea => 'area' in carried
