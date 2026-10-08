/**
 * One place in All Tasks' tree and everything under it: its row, its field for
 * something new, its places and its tasks, each drawn by `rows.tsx` from what
 * the tree holds (`Tree`).
 *
 * What the tree holds reaches every level through a context rather than a
 * dozen props handed down each one, since every level needs all of it. It is
 * built again each time the tree draws, which is when every branch draws
 * anyway.
 */

import { createContext, useContext, type HTMLAttributes } from 'react'

import { dragInto, dropListProps, SlotMark, slotAttrs, slotEdge, type CarryContext } from '../carry'
import type { Editors } from './editors'
import type { Ordering } from './ordering'
import { DoneOption, InlineField, LEVEL, More, PlaceTick, PlaceTools, TaskOption } from './rows'
import type { PlaceActions } from './types'
import type { TaskTreeNode } from '@/domain/tasks'

/** Everything a branch draws with: the tree's state, its caller's handlers, and its carries. */
export type Tree = {
  editors: Editors
  ordering: Ordering
  focusNext: (key: string) => void
  places: PlaceActions
  selected: ReadonlySet<string>
  /** Everything open beneath each place, by its id: what its box ticks. */
  openUnder: ReadonlyMap<string, readonly string[]>
  onToggle: (taskId: string, on: boolean) => void
  onToggleMany: ((taskIds: readonly string[], on: boolean) => void) | undefined
  onDelete: (taskId: string) => void
  onComplete: (taskId: string) => void
  onReopen: (taskId: string) => void
  elsewhere: (taskId: string) => string | null
  draggable: boolean
  keepsOne: boolean
  /** Keep what is written into a place's field; see `TaskBrowser`. */
  write: (then: 'next' | 'done') => void
  renamePlace: (node: TaskTreeNode) => void
  rename: () => void
  /** The carry around the tree, which takes a place's open tasks into today's intentions. */
  outer: CarryContext
}

export const TreeContext = createContext<Tree | null>(null)

/** What a place's `+` writes under it. */
const CHILD: Partial<Record<TaskTreeNode['kind'], 'epic' | 'outcome'>> = {
  area: 'epic',
  epic: 'outcome',
}

/** The lines down the left that say how deep a row is. */
const guides = (depth: number) =>
  Array.from({ length: depth }, (_, level) => (
    <span key={level} aria-hidden="true" className="ml-1 w-2.5 shrink-0 self-stretch border-l border-line" />
  ))

export function PlaceBranch({
  node,
  depth,
  parent,
  last,
}: {
  node: TaskTreeNode
  depth: number
  /** The place it hangs under, or `TOP` for an area. */
  parent: string
  /** Whether it is the last of its siblings, which draws a line under it. */
  last: boolean
}) {
  const tree = useContext(TreeContext)!
  const { editors, places, focusNext } = tree
  const { ordering, reorder, step, ends } = tree.ordering
  const { adding, setAdding, renamingPlace, setRenamingPlace, renaming, setRenaming } = editors
  const { menu, confirming, setConfirming, closeMenu, toggleMenu, openMenu } = editors

  /**
   * A place's row as the tree's carry sees it: dragged to put the place in
   * order, and a task let go on it goes last in it.
   */
  const placeRowProps = (): HTMLAttributes<HTMLDivElement> => {
    // An epic or outcome is carried by the carry around the tree too, which
    // takes everything open in it into one of today's intentions at once.
    const bundled = tree.draggable && node.kind !== 'area'
    const row = { id: node.id, title: node.name }
    return {
      draggable: true,
      ...dragInto(
        [
          ...(ordering ? [[reorder, row] as const] : []),
          ...(bundled
            ? [[tree.outer, { ...row, payload: { kind: 'place', placeId: node.id } }] as const]
            : []),
        ],
        node.name,
      ),
      ...(ordering ? dropListProps(reorder, node.id, ['task']) : {}),
    }
  }
  /** Whether a place's row drags at all: to be put in order, or to be carried into today. */
  const dragsPlace =
    renamingPlace?.id !== node.id && (ordering || (tree.draggable && node.kind !== 'area'))

  const child = CHILD[node.kind]
  const asking = confirming === node.id
  const open = menu === node.id
  const openTasks = node.tasks.filter((t) => t.status === 'open')
  const lastTask = openTasks[openTasks.length - 1]?.id
  // A task about to go last into a place with nothing open in it has no
  // row to draw a line under, so the place's own row lights instead.
  const into =
    reorder.aimed?.parent === node.id &&
    reorder.aimed.kind === 'task' &&
    reorder.aimed.before === null &&
    lastTask === undefined
  return (
    <li {...(ordering ? slotAttrs(node.kind, node.id) : {})} className="relative">
      <SlotMark edge={slotEdge(reorder.aimed, parent, node.kind, node.id, last)} />
      <div
        {...(dragsPlace ? placeRowProps() : {})}
        className={`group/row relative flex items-stretch gap-2 rounded-md px-2.5 ${
          dragsPlace ? 'cursor-grab active:cursor-grabbing' : ''
        } ${into ? 'bg-surface-raised' : ''}`}
      >
        {guides(depth)}
        {tree.onToggleMany && node.kind !== 'area' && renamingPlace?.id !== node.id && (
          <PlaceTick
            name={node.name}
            taskIds={tree.openUnder.get(node.id) ?? []}
            selected={tree.selected}
            onToggle={tree.onToggleMany}
            keepsOne={tree.keepsOne}
          />
        )}
        {renamingPlace?.id === node.id ? (
          <span className="flex min-w-0 flex-1 py-1">
            <InlineField
              value={renamingPlace.name}
              onChange={(name) => setRenamingPlace({ id: node.id, name })}
              onEnter={() => tree.renamePlace(node)}
              onKeep={() => tree.renamePlace(node)}
              onCancel={() => setRenamingPlace(null)}
              focusKey={`rename-place:${node.id}`}
              focusBack={`menu:${node.id}`}
              placeholder={node.name}
              label={`Rename ${LEVEL[node.kind].toLowerCase()} ${node.name}`}
              keepLabel={`Save the name of ${node.name}`}
              cancelLabel={`Keep the name of ${node.name}`}
            />
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 py-1.5 text-sm wrap-break-word">
              <span className="text-muted">{LEVEL[node.kind]}: </span>
              <span className={depth === 0 ? 'font-medium text-bright' : 'text-body'}>
                {node.name}
              </span>
            </span>
            <More
              id={node.id}
              label={`More for ${node.name}`}
              open={open}
              onToggle={() => toggleMenu(node.id)}
              menuRef={openMenu}
              className="mt-1"
            >
              <PlaceTools
                node={node}
                child={child}
                steps={
                  ordering
                    ? {
                        ...ends(node.kind, node.id, parent),
                        onStep: (by) => step(node.kind, node.id, parent, by),
                      }
                    : undefined
                }
                asking={asking}
                inside={asking ? places.inside(node) : 0}
                onAdd={(kind) => {
                  focusNext(`add:${node.id}`)
                  setAdding({ parentId: node.id, kind, title: '' })
                  closeMenu()
                }}
                onRename={() => {
                  focusNext(`rename-place:${node.id}`)
                  setRenamingPlace({ id: node.id, name: node.name })
                  closeMenu()
                }}
                onComplete={() => {
                  places.complete(node)
                  closeMenu()
                }}
                onArchive={() => {
                  places.archive(node)
                  closeMenu()
                }}
                onDelete={() => {
                  if (asking || places.inside(node) === 0) {
                    places.remove(node)
                    closeMenu()
                  } else {
                    setConfirming(node.id)
                  }
                }}
                onKeep={() => setConfirming(null)}
              />
            </More>
          </>
        )}
      </div>
      {/* Every row and field in here belongs to this place: where focus goes
          if one of them is taken away from under it. */}
      <ul
        data-home={`menu:${node.id}`}
        {...(ordering ? dropListProps(reorder, node.id, child ? [child, 'task'] : ['task']) : {})}
      >
        {adding?.parentId === node.id && (
          <li className="flex items-stretch gap-2 px-2.5 py-1">
            {guides(depth + 1)}
            <InlineField
              value={adding.title}
              onChange={(title) => setAdding({ ...adding, title })}
              onEnter={() => tree.write('next')}
              onKeep={() => tree.write('done')}
              onCancel={() => setAdding(null)}
              focusKey={`add:${node.id}`}
              focusBack={`menu:${node.id}`}
              placeholder={`A new ${adding.kind}`}
              label={`New ${adding.kind} in ${node.name}`}
              keepLabel={`Add the new ${adding.kind} to ${node.name}`}
              cancelLabel={`Cancel the new ${adding.kind} in ${node.name}`}
            />
          </li>
        )}
        {node.children.map((place, i, all) => (
          <PlaceBranch
            key={place.id}
            node={place}
            depth={depth + 1}
            parent={node.id}
            last={i === all.length - 1}
          />
        ))}
        {node.tasks.map((task) =>
          task.status === 'done' ? (
            <DoneOption
              key={task.id}
              task={task}
              guides={guides(depth + 1)}
              menu={menu === task.id}
              onMenu={() => toggleMenu(task.id)}
              menuRef={openMenu}
              onReopen={() => {
                tree.onReopen(task.id)
                closeMenu()
              }}
            />
          ) : renaming?.taskId === task.id ? (
            <li key={task.id} className="flex items-stretch gap-2 px-2.5 py-1">
              {guides(depth + 1)}
              <InlineField
                value={renaming.title}
                onChange={(title) => setRenaming({ taskId: task.id, title })}
                onEnter={tree.rename}
                onKeep={tree.rename}
                onCancel={() => setRenaming(null)}
                focusKey={`rename:${task.id}`}
                focusBack={`menu:${task.id}`}
                placeholder={task.title}
                label={`Rename ${task.title}`}
                keepLabel={`Save the name of ${task.title}`}
                cancelLabel={`Keep the name of ${task.title}`}
              />
            </li>
          ) : (
            <TaskOption
              key={task.id}
              task={task}
              guides={guides(depth + 1)}
              checked={tree.selected.has(task.id)}
              onToggle={() => tree.onToggle(task.id, !tree.selected.has(task.id))}
              keepsOne={tree.keepsOne}
              locked={tree.keepsOne && tree.selected.has(task.id) && tree.selected.size === 1}
              menu={menu === task.id}
              onMenu={() => toggleMenu(task.id)}
              menuRef={openMenu}
              onRename={() => {
                focusNext(`rename:${task.id}`)
                setRenaming({ taskId: task.id, title: task.title })
                closeMenu()
              }}
              onDelete={() => {
                tree.onDelete(task.id)
                closeMenu()
              }}
              onComplete={() => {
                tree.onComplete(task.id)
                closeMenu()
              }}
              elsewhere={tree.elsewhere(task.id)}
              draggable={tree.draggable}
              reorder={ordering ? reorder : null}
              edge={slotEdge(reorder.aimed, node.id, 'task', task.id, task.id === lastTask)}
              steps={
                ordering
                  ? {
                      ...ends('task', task.id, node.id),
                      onStep: (by) => step('task', task.id, node.id, by),
                    }
                  : undefined
              }
            />
          ),
        )}
      </ul>
    </li>
  )
}
