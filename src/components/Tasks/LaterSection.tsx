/**
 * Later on the tasks page: what was put down to come back to, waiting to be
 * carried into a column of the board below and made a task there, rewritten,
 * let go, or deleted; and what was let go, folded under it, each able to come
 * back. A line is carried by the board's carry (`Backlog`), which is why it is
 * drawn inside it.
 */

import { useState } from 'react'

import { CarryGrip, useCarriedRow } from '../carry'
import { keepForLater } from '../Later'
import { DeleteIcon, DropIcon, RestoreIcon } from '../icons'
import { EditGlyph, IconButton, RenameField, revealOnHover } from '../ui'
import { useTasks } from '@/store/tasks'
import { LATER_MAX_LENGTH, type Later } from '@/domain/later'
import { formatDayAndClock } from '@/domain/time'
import { AddForm } from './addFields'

/**
 * Later: what was put down to come back to, waiting to be dealt with
 * (`domain/later.ts`), oldest first, above the areas it will be filed into.
 *
 * Dealt with three ways, all here, away from the timer. Carried into any
 * column of the board — dragged, or picked up with its grip and put down with
 * `Move here`, the board's own gesture — it becomes a task there and leaves
 * the list. Let go, it moves to a fold under the list, where it can be
 * brought back, for the reason a dropped task is kept: deciding not to is a
 * decision. Deleted, it goes. Its title can be rewritten first, since what is
 * written in a hurry is often not yet a task's name.
 *
 * Where it was written, when that was a block, is shown under it — what the
 * block was for and when — because a line put down mid-thought often only
 * makes sense beside what the thought was interrupting.
 */
export function LaterSection({ waiting, letGo }: { waiting: readonly Later[]; letGo: readonly Later[] }) {
  return (
    <section aria-label="Later" className="mt-8 border-t border-line pt-6">
      <div className="max-w-xl">
        <h2 className="text-xs font-medium tracking-widest text-muted uppercase">Later</h2>
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nothing waiting. Put something down with Later in the header, or beside ✎ Log
            while a block runs.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              Carry one into a column below to make it a task there.
            </p>
            <ul aria-label="Waiting for later" className="mt-3 flex flex-col gap-2">
              {waiting.map((later) => (
                <LaterRow key={later.id} later={later} />
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
          onAdd={keepForLater}
        />
        {letGo.length > 0 && <LetGoFold letGo={letGo} />}
      </div>
    </section>
  )
}

/** One line waiting in Later: carry it, rewrite it, let it go, or delete it. */
function LaterRow({ later }: { later: Later }) {
  const retitleLater = useTasks((s) => s.retitleLater)
  const letGoLater = useTasks((s) => s.letGoLater)
  const deleteLater = useTasks((s) => s.deleteLater)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { picked, dragProps } = useCarriedRow(later, renaming === null)

  return (
    <li
      {...dragProps}
      className={`group/row rounded-lg border px-3 py-2 ${
        picked ? 'border-dashed border-deep/70 bg-surface/60' : 'border-muted/70'
      }`}
    >
      <div className="flex items-start gap-2">
        <CarryGrip task={later} className="-ml-1.5 mt-0.5" />
        {renaming === null ? (
          <>
            <span className="min-w-0 flex-1 text-sm text-bright wrap-break-word">{later.title}</span>
            <span className="-my-0.5 -mr-1.5 flex shrink-0">
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
      <p className="mt-1 pl-5 text-xs text-muted wrap-break-word">
        {later.from && (
          <>
            From <span className="text-body">{later.from.purpose}</span>
            {' · '}
          </>
        )}
        {formatDayAndClock(later.createdAt)}
      </p>
    </li>
  )
}

/**
 * What was let go, folded under the list, each able to come back or be
 * deleted. Drawn only while open, as the board's put-away cards are.
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
