/**
 * The tasks page's other view: everything put away, in one place rather than
 * folded under every column it came from.
 *
 * The board draws only work (`Board.tsx`). What has been done, dropped or
 * archived — tasks, epics, outcomes, whole areas — waits here, each able to
 * come back. It used to be a fold under every outcome, every epic and every
 * inbox, beside one for archived areas: a line of its own in every narrow
 * column, which grows without end, and once places could fold, hidden inside
 * the folded ones too. What Later lets go is Later's, and waits with it on the
 * timeline page.
 */

import { useState } from 'react'

import { ArchiveIcon, CheckIcon, DoneRingIcon, DropIcon, ReopenIcon, RestoreIcon } from '../icons'
import { IconButton, revealOnHover } from '../ui'
import { useTasks } from '@/store/tasks'
import { childrenOf, PATH_SEPARATOR, type Area, type Item, type PutAwayEntry } from '@/domain/tasks'
import { DeleteButton, liveInside } from './DeleteButton'

/** What one area has put away, as the page lists it (`putAwayIn`). */
export type AreaPutAway = { area: Area; entries: readonly PutAwayEntry[] }

/** What the view can be narrowed to. */
type Filter = 'all' | 'done' | 'dropped' | 'archived'

const FILTER_NAME: Record<Filter, string> = {
  all: 'All',
  done: 'Done',
  dropped: 'Dropped',
  archived: 'Archived',
}

/** How many things the view holds: what the switch to it counts. */
export const putAwayCount = (byArea: readonly AreaPutAway[], archivedAreas: readonly Area[]): number =>
  byArea.reduce((sum, { entries }) => sum + entries.length, 0) + archivedAreas.length

/**
 * Everything put away: by area, most recent first, each under the open places
 * it sat in; then the areas archived whole.
 *
 * Narrowed by a row of filters when it holds more than one kind of thing. A
 * filter left with nothing in it — its last item brought back — shows
 * everything again rather than an empty page.
 *
 * Drawn only while chosen. The page renders every second for the header's
 * timer, and this is the part of the backlog that grows without end.
 */
export function PutAwayView({
  byArea,
  archivedAreas,
  items,
}: {
  byArea: readonly AreaPutAway[]
  archivedAreas: readonly Area[]
  items: readonly Item[]
}) {
  const [chosen, setChosen] = useState<Filter>('all')

  const counts: Record<Filter, number> = { all: 0, done: 0, dropped: 0, archived: 0 }
  for (const { entries } of byArea) {
    for (const { item } of entries) counts[putAwayState(item) as Exclude<PutAwayState, 'open'>]++
  }
  counts.archived += archivedAreas.length
  counts.all = counts.done + counts.dropped + counts.archived

  if (counts.all === 0) {
    return (
      <p className="mt-6 max-w-2xl text-sm text-muted">
        Nothing put away. Done, dropped and archived work waits here until you bring it
        back or delete it.
      </p>
    )
  }

  const filter = counts[chosen] > 0 ? chosen : 'all'
  const shows = (state: PutAwayState) => filter === 'all' || filter === state
  const kinds = (['done', 'dropped', 'archived'] as const).filter((f) => counts[f] > 0)

  return (
    <div className="mt-8 max-w-3xl">
      {kinds.length > 1 && (
        <div role="group" aria-label="Show what is put away" className="-ml-2 flex flex-wrap gap-1">
          {(['all', ...kinds] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setChosen(f)}
              aria-pressed={filter === f}
              className={`rounded-md px-2 py-0.5 text-xs transition ${
                filter === f ? 'bg-surface-raised text-bright' : 'text-muted hover:text-bright'
              }`}
            >
              {FILTER_NAME[f]} <span className="text-muted">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {byArea.map(({ area, entries }) => {
        const shown = entries.filter(({ item }) => shows(putAwayState(item)))
        if (shown.length === 0) return null
        return (
          <section key={area.id} aria-label={`Put away in ${area.name}`} className="mt-6">
            <h3 className="text-lg text-bright wrap-break-word">{area.name}</h3>
            <ul className="mt-2 flex flex-col gap-1.5">
              {shown.map(({ item, path }) => (
                <PutAwayCard key={item.id} item={item} path={path} allItems={items} />
              ))}
            </ul>
          </section>
        )
      })}

      {archivedAreas.length > 0 && shows('archived') && <ArchivedAreas areas={archivedAreas} />}
    </div>
  )
}

/** Areas archived whole, each restored as it was, with everything in it. */
function ArchivedAreas({ areas }: { areas: readonly Area[] }) {
  const unarchiveArea = useTasks((s) => s.unarchiveArea)
  return (
    <section aria-label="Archived areas" className="mt-6">
      <h3 className="text-lg text-bright">Archived areas</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {areas.map((area) => (
          <li
            key={area.id}
            className="group/row flex items-start gap-2 rounded-lg border border-line px-2.5 py-2"
          >
            <StateMark state="archived" className="mt-[3px]" />
            <span className="min-w-0 flex-1 text-sm text-muted wrap-break-word">{area.name}</span>
            <span className="-my-0.5 -mr-1.5 flex shrink-0">
              <IconButton
                onClick={() => unarchiveArea(area.id)}
                label={`Restore ${area.name}`}
                hint="Restore"
                className={revealOnHover}
              >
                <RestoreIcon />
              </IconButton>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Where a put-away item stands. Archived wins: it is what hides the item. */
type PutAwayState = 'open' | 'done' | 'dropped' | 'archived'

const putAwayState = (item: Item): PutAwayState =>
  item.archivedAt !== undefined ? 'archived' : item.status

const STATE_NAME: Record<PutAwayState, string> = {
  open: 'Open',
  done: 'Done',
  dropped: 'Dropped',
  archived: 'Archived',
}

/**
 * The mark in front of a put-away title: a tick, a struck circle, a box, or an
 * empty ring for something still open inside what was put away. Its name is
 * read before the title and shown on hover.
 */
function StateMark({ state, className = '' }: { state: PutAwayState; className?: string }) {
  const name = STATE_NAME[state]
  return (
    <span title={name} className={`shrink-0 ${state === 'done' ? 'text-deep/80' : 'text-muted'} ${className}`}>
      {state === 'done' ? (
        <CheckIcon />
      ) : state === 'dropped' ? (
        <DropIcon />
      ) : state === 'archived' ? (
        <ArchiveIcon />
      ) : (
        <DoneRingIcon done={false} />
      )}
      <span className="sr-only">{name}: </span>
    </span>
  )
}

/**
 * One thing put away, as a card: quieter than the board's open work — an
 * outline in the page's rule colour rather than the controls' and no fill —
 * its state as a mark in front of a title that wraps rather than being cut
 * short, the open places it sat in above it, and its actions as icons.
 *
 * An archived item can also be finished; restoring it brings it back as it
 * was, finished or not, so archived ones offer Restore and finished ones
 * Reopen.
 *
 * A finished or archived epic or outcome shows what it took with it, nested
 * under it as it was left (`PutAwayInside`): its outcomes and its tasks, each
 * with its own state, since finishing one never touched them. They are only
 * shown — they are hidden by their parent, so the parent's card is where they
 * come back from.
 */
function PutAwayCard({
  item,
  path,
  allItems,
}: {
  item: Item
  /** The open epic and outcome it sat in, if any. */
  path: readonly string[]
  allItems: readonly Item[]
}) {
  const reopenItem = useTasks((s) => s.reopenItem)
  const unarchiveItem = useTasks((s) => s.unarchiveItem)
  const deleteItem = useTasks((s) => s.deleteItem)
  const state = putAwayState(item)

  return (
    <li className="group/row rounded-lg border border-line px-2.5 py-2">
      {/* Wraps, so a delete that asks first drops to a line of its own
          rather than squeezing the title. */}
      <div className="flex flex-wrap items-start gap-x-2">
        <StateMark state={state} className="mt-[3px]" />
        <div className="min-w-0 flex-1 basis-24 text-sm text-muted wrap-break-word">
          {path.length > 0 && (
            <span className="block text-xs text-muted/80">{path.join(PATH_SEPARATOR)}</span>
          )}
          {item.kind !== 'task' && (
            <span className="block text-[10px] tracking-widest uppercase">{item.kind}</span>
          )}
          <span className={state === 'done' ? 'line-through' : ''}>{item.title}</span>
        </div>
        <span className="-my-0.5 -mr-1.5 ml-auto flex flex-wrap items-center justify-end">
          {state === 'archived' ? (
            <IconButton
              onClick={() => unarchiveItem(item.id)}
              label={`Restore ${item.title}`}
              hint="Restore"
              className={revealOnHover}
            >
              <RestoreIcon />
            </IconButton>
          ) : (
            <IconButton
              onClick={() => reopenItem(item.id)}
              label={`Reopen ${item.title}`}
              hint="Reopen"
              className={revealOnHover}
            >
              <ReopenIcon />
            </IconButton>
          )}
          <DeleteButton
            title={item.title}
            inside={liveInside(item.id, allItems)}
            onDelete={() => deleteItem(item.id)}
            className={revealOnHover}
          />
        </span>
      </div>
      {item.kind !== 'task' && <PutAwayInside parent={item} allItems={allItems} />}
    </li>
  )
}

/**
 * What a put-away epic or outcome holds, as it was left: each child with its
 * own state, an outcome's tasks under it in turn. Only shown — see `PutAwayCard`.
 */
function PutAwayInside({ parent, allItems }: { parent: Item; allItems: readonly Item[] }) {
  const children = childrenOf(parent.id, allItems)
  if (children.length === 0) return null
  return (
    <ul
      aria-label={`Inside ${parent.title}`}
      className="mt-1.5 ml-1.5 flex flex-col gap-1 border-l border-line pl-2.5"
    >
      {children.map((child) => {
        const state = putAwayState(child)
        return (
          <li key={child.id} className="min-w-0">
            <div className="flex items-start gap-1.5 text-xs text-muted">
              <StateMark state={state} className="mt-px" />
              <div className="min-w-0 flex-1 wrap-break-word">
                {child.kind !== 'task' && (
                  <span className="mr-1.5 text-[10px] tracking-widest uppercase">{child.kind}</span>
                )}
                <span className={state === 'done' ? 'line-through' : ''}>{child.title}</span>
              </div>
            </div>
            {child.kind !== 'task' && <PutAwayInside parent={child} allItems={allItems} />}
          </li>
        )
      })}
    </ul>
  )
}
