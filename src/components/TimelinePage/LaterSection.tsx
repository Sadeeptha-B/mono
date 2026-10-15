/**
 * Later on the timeline page: what was put down to come back to, waiting to
 * be filed as a task, rewritten, let go, or deleted; and what was let go,
 * folded under it, each able to come back.
 *
 * It lived on the tasks page, above the board, and was filed by carrying a
 * line into one of the board's columns. The tasks page is the board alone
 * now, so a line is filed from where it waits, by naming the place it goes
 * (`FileInto`) — the one write that makes it a task there and takes it out
 * of Later (`fileLater`), as the carry was.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { keepForLater } from '../Later'
import { DeleteIcon, DropIcon, FileIcon, RestoreIcon } from '../icons'
import { EditGlyph, IconButton, RenameField, revealOnHover } from '../ui'
import { AddForm } from '../Tasks/addFields'
import { TASKS_HASH } from '@/hooks/useRoute'
import { useTasks } from '@/store/tasks'
import { taskTree, PATH_SEPARATOR, type TaskTreeNode } from '@/domain/tasks'
import { LATER_MAX_LENGTH, type Later } from '@/domain/later'
import { formatDayAndClock } from '@/domain/time'

/** A place a line can be filed into: an area, an open epic or an open outcome. */
type Place = { id: string; name: string; depth: number; path: string }

/**
 * Later: what was put down to come back to, waiting to be dealt with
 * (`domain/later.ts`), oldest first.
 *
 * Dealt with four ways, all here, away from the timer. Filed into an area,
 * an epic or an outcome, it becomes a task there and leaves the list, and the
 * list says where it went, since the task is now on another page. Let go, it
 * moves to the fold under the list, where it can be brought back, for the
 * reason a dropped task is kept: deciding not to is a decision. Deleted, it
 * goes. Its title can be rewritten first, since what is written in a hurry is
 * often not yet a task's name.
 *
 * Where it was written, when that was a block, is shown under it — what the
 * block was for and when — because a line put down mid-thought often only
 * makes sense beside what the thought was interrupting.
 *
 * Adding and renaming keep their `Done` and `Save`: only the board keeps what
 * a field holds when it is left.
 */
export function LaterSection({
  waiting,
  letGo,
}: {
  waiting: readonly Later[]
  letGo: readonly Later[]
}) {
  const items = useTasks((s) => s.items)
  const areas = useTasks((s) => s.areas)
  // Per backlog snapshot, not per render: the header's timer re-renders the
  // page every second.
  const places = useMemo(() => placesIn(taskTree(items, areas)), [items, areas])
  const [filed, setFiled] = useState<{ title: string; path: string } | null>(null)
  const said = useRef<HTMLParagraphElement>(null)
  // The row filed has gone, and with it the focus; it goes to what says where.
  useEffect(() => {
    if (filed) said.current?.focus()
  }, [filed])

  return (
    <section aria-label="Later" className="mt-8 border-t border-line pt-6">
      <div className="max-w-xl">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Later</h2>
        {filed && (
          <p
            ref={said}
            tabIndex={-1}
            role="status"
            className="mt-2 text-sm text-body focus:outline-none"
          >
            Filed <span className="text-bright">{filed.title}</span> in {filed.path} ·{' '}
            <a
              href={TASKS_HASH}
              className="text-muted underline-offset-4 hover:text-bright hover:underline"
            >
              Tasks
            </a>
          </p>
        )}
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nothing waiting. Put something down with Later in the header, or beside ✎ Log
            while a block runs.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              File one into an area, epic or outcome to make it a task there.
            </p>
            <ul aria-label="Waiting for later" className="mt-3 flex flex-col gap-2">
              {waiting.map((later) => (
                <LaterRow
                  key={later.id}
                  later={later}
                  places={places}
                  onFiled={(path) => setFiled({ title: later.title, path })}
                />
              ))}
            </ul>
          </>
        )}
        <AddForm
          draftKey="later"
          opener="Add to Later"
          label="New for later"
          placeholder="Something for later"
          maxLength={LATER_MAX_LENGTH}
          // Kept by its `Done`, not by being left: only the board saves that way.
          saveOnLeave={false}
          onAdd={keepForLater}
        />
        {letGo.length > 0 && <LetGoFold letGo={letGo} />}
      </div>
    </section>
  )
}

/** Every place in play, in the board's order, each with how deep it sits and its path. */
function placesIn(tree: readonly TaskTreeNode[]): Place[] {
  const found: Place[] = []
  const walk = (node: TaskTreeNode, depth: number, above: readonly string[]) => {
    const path = [...above, node.name]
    found.push({ id: node.id, name: node.name, depth, path: path.join(PATH_SEPARATOR) })
    for (const child of node.children) walk(child, depth + 1, path)
  }
  for (const area of tree) walk(area, 0, [])
  return found
}

/** One line waiting in Later: file it, rewrite it, let it go, or delete it. */
function LaterRow({
  later,
  places,
  onFiled,
}: {
  later: Later
  places: readonly Place[]
  onFiled: (path: string) => void
}) {
  const retitleLater = useTasks((s) => s.retitleLater)
  const letGoLater = useTasks((s) => s.letGoLater)
  const deleteLater = useTasks((s) => s.deleteLater)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [filing, setFiling] = useState(false)
  const fileButton = useRef<HTMLButtonElement>(null)
  const closeFiling = () => {
    setFiling(false)
    fileButton.current?.focus()
  }

  return (
    <li className="group/row rounded-lg border border-muted/70 px-3 py-2">
      <div className="flex items-start gap-2">
        {renaming === null ? (
          <>
            <span className="min-w-0 flex-1 text-sm text-bright wrap-break-word">{later.title}</span>
            <span className="-my-0.5 -mr-1.5 flex shrink-0">
              {/* Shown at rest, unlike the others: filing is what a line here
                  is waiting for. */}
              <IconButton
                ref={fileButton}
                onClick={() => setFiling((open) => !open)}
                label={`File ${later.title}`}
                hint="File into…"
                expanded={filing}
              >
                <FileIcon />
              </IconButton>
              <IconButton
                onClick={() => setRenaming(later.title)}
                label={`Rename ${later.title}`}
                hint="Rename"
                className={revealOnHover}
              >
                <EditGlyph />
              </IconButton>
              <IconButton
                onClick={() => letGoLater(later.id)}
                label={`Let go of ${later.title}`}
                hint="Let go"
                className={revealOnHover}
              >
                <DropIcon />
              </IconButton>
              <IconButton
                danger
                onClick={() => deleteLater(later.id)}
                label={`Delete ${later.title}`}
                hint="Delete"
                className={revealOnHover}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </>
        ) : (
          <RenameField
            label={`Rename ${later.title}`}
            value={renaming}
            onChange={setRenaming}
            onSave={() => {
              retitleLater(later.id, renaming)
              setRenaming(null)
            }}
            onCancel={() => setRenaming(null)}
            maxLength={LATER_MAX_LENGTH}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted wrap-break-word">
        {later.from && (
          <>
            From <span className="text-body">{later.from.purpose}</span>
            {' · '}
          </>
        )}
        {formatDayAndClock(later.createdAt)}
      </p>
      {filing && (
        <FileInto later={later} places={places} onFiled={onFiled} onClose={closeFiling} />
      )}
    </li>
  )
}

/**
 * The places a line can be filed into, opened under its row: every area, and
 * the open epics and outcomes in each, indented as the board nests them.
 * Choosing one files it there, at the foot of that place's tasks.
 *
 * In the row rather than floating over the page, so it needs no placing and
 * reads the same on a phone, where the list is as long as the backlog is
 * wide. Escape closes it and hands the focus back to its button. A filing the
 * store refuses — the line was let go or reworded in another tab, or an
 * import is landing — leaves the line where it was, to be filed again.
 */
function FileInto({
  later,
  places,
  onFiled,
  onClose,
}: {
  later: Later
  places: readonly Place[]
  onFiled: (path: string) => void
  onClose: () => void
}) {
  const fileLater = useTasks((s) => s.fileLater)
  return (
    <div
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
      className="mt-2 border-t border-line pt-2"
    >
      <p className="text-xs text-muted">File into…</p>
      {places.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          There is nowhere to file it yet. Add an area on the Tasks page.
        </p>
      ) : (
        <ul aria-label={`Places to file ${later.title} into`} className="mt-1 flex flex-col">
          {places.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => {
                  if (fileLater(later.id, place.id) !== null) onFiled(place.path)
                }}
                aria-label={`File ${later.title} into ${place.path}`}
                // Each level a step in, as the board nests them.
                style={{ paddingLeft: `${0.5 + place.depth * 0.875}rem` }}
                className={`w-full rounded-md py-1 pr-2 text-left text-sm transition hover:bg-surface-raised hover:text-bright ${
                  place.depth === 0 ? 'text-body' : 'text-muted'
                }`}
              >
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * What was let go, folded under the list, each able to come back or be
 * deleted. Drawn only while open: it is the part of Later that grows.
 */
function LetGoFold({ letGo }: { letGo: readonly Later[] }) {
  const restoreLater = useTasks((s) => s.restoreLater)
  const deleteLater = useTasks((s) => s.deleteLater)
  const [open, setOpen] = useState(false)
  return (
    <details className="mt-4" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted hover:text-body">
        Let go ({letGo.length})
      </summary>
      {open && (
        <ul aria-label="Let go" className="mt-2 flex flex-col gap-1.5">
          {letGo.map((later) => (
            <li
              key={later.id}
              className="group/row flex items-start gap-2 rounded-lg border border-line px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 text-sm text-muted wrap-break-word">{later.title}</span>
              <span className="-my-0.5 -mr-1.5 flex shrink-0">
                <IconButton
                  onClick={() => restoreLater(later.id)}
                  label={`Bring back ${later.title}`}
                  hint="Bring back"
                  className={revealOnHover}
                >
                  <RestoreIcon />
                </IconButton>
                <IconButton
                  danger
                  onClick={() => deleteLater(later.id)}
                  label={`Delete ${later.title}`}
                  hint="Delete"
                  className={revealOnHover}
                >
                  <DeleteIcon />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
