/**
 * What has been put away under one parent on the board — done and dropped
 * tasks, finished or archived epics and outcomes — folded, each able to come
 * back.
 */

import { useState } from 'react'

import { ArchiveIcon, CheckIcon, DoneRingIcon, DropIcon, ReopenIcon, RestoreIcon } from '../icons'
import { IconButton, revealOnHover } from '../ui'
import { useTasks } from '@/store/tasks'
import { childrenOf, type Item } from '@/domain/tasks'
import { DeleteButton, liveInside } from './DeleteButton'

/**
 * What has been put away under one parent — done and dropped tasks, and
 * finished or archived epics and outcomes — folded, each able to come back.
 *
 * Each is a card of its own, quieter than the open tasks above it: an outline
 * in the page's rule colour rather than the controls' and no fill, its state
 * as a mark in front of a title that wraps rather than being cut short, and
 * its actions as icons. As a line of words — state, title, `Reopen`, `Delete`
 * — the title was what gave way in a column, down to its first few letters.
 *
 * An archived item can also be finished; restoring it brings it back as it was,
 * finished or not, so archived ones offer Restore and finished ones Reopen.
 *
 * A finished or archived epic or outcome shows what it took with it, nested
 * under it as it was left (`PutAwayInside`): its outcomes and its tasks, each
 * with its own state, since finishing one never touched them. They are only
 * shown — they are hidden by their parent, so the parent's card is where they
 * come back from.
 *
 * The cards are drawn only while the fold is open. The page re-renders every
 * second for the header's timer, and a column of finished work nobody has
 * asked to see is the part of the page that grows without end.
 */
export function PutAway({ items, allItems }: { items: readonly Item[]; allItems: readonly Item[] }) {
  if (items.length === 0) return null
  return <PutAwayFold items={items} allItems={allItems} />
}

/**
 * The fold itself, apart from `PutAway` so that whether it is open is
 * forgotten when the last thing in it comes back: the next thing put away
 * arrives folded, as it does on a fresh page.
 */
function PutAwayFold({ items, allItems }: { items: readonly Item[]; allItems: readonly Item[] }) {
  const [open, setOpen] = useState(false)
  return (
    <details className="mt-4" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted hover:text-body">
        Done, dropped and archived ({items.length})
      </summary>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((item) => (
            <PutAwayCard key={item.id} item={item} allItems={allItems} />
          ))}
        </ul>
      )}
    </details>
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

function PutAwayCard({ item, allItems }: { item: Item; allItems: readonly Item[] }) {
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
 * own state, an outcome's tasks under it in turn. Only shown — see `PutAway`.
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
