/**
 * The header's `Later`: one field, on every page, for putting something down
 * to come back to.
 *
 * In the header because a tangent arrives wherever you are — on a break, while
 * choosing today's tasks, halfway down the guide — and the header is the one
 * thing every view draws. During a block the stage and the mini window offer
 * the same beside `✎ Log` (`BlockComposer`), which is where the eye already
 * is; this is the same act from everywhere else.
 *
 * The field stays open once a line is kept. A tangent rarely comes alone, and
 * the second should not cost a second trip to the header; Escape, or leaving
 * it by pointer or keyboard, puts it away (`useHeaderPopover`). What it has
 * kept is answered with how many are waiting and where, rather than a list:
 * dealing with them is the tasks page's business, away from whatever this
 * interrupted.
 *
 * No count on the icon itself. A number in the header that grows as things
 * are put down would be a reason to look at it, which is the opposite of what
 * putting them down was for.
 */

import { useState } from 'react'

import { useHeaderPopover } from './headerPopover'
import { LaterIcon } from './icons'
import { keepForLater, useWaitingCount } from './Later'
import { LineField, headerIconClass } from './ui'
import { LATER_MAX_LENGTH } from '@/domain/later'
import { TASKS_HASH } from '@/hooks/useRoute'

export function LaterMenu({ idPrefix }: { idPrefix: string }) {
  const { open, setOpen, close, wrap, button, panel, panelStyle } = useHeaderPopover(352)
  // What the last line written in this opening came to: kept, or turned
  // away while an import was landing. Nothing until there is something to say.
  const [outcome, setOutcome] = useState<'kept' | 'refused' | null>(null)
  const waiting = useWaitingCount()
  const panelId = `${idPrefix}-later`

  return (
    <div ref={wrap}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOutcome(null)
          setOpen((was) => !was)
        }}
        aria-label="Later"
        title="Put something down for later"
        className={`${headerIconClass} ${open ? 'bg-surface-raised text-bright' : ''}`}
      >
        <LaterIcon className="size-4" />
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label="Put something down for later"
          style={panelStyle}
          className="fixed z-30 overflow-y-auto rounded-xl border border-line bg-surface p-4 text-left shadow-2xl"
        >
          <p className="mb-2 text-xs text-muted">
            Something to come back to, off whatever you are doing now.
          </p>
          <LineField
            label="Later"
            placeholder="Something for later"
            submit="Keep"
            closeLabel="Close Later"
            maxLength={LATER_MAX_LENGTH}
            stayOpen
            onKeep={(title) => {
              // Kept is said only of what was kept. A refused line stays in the
              // field, and says why, so it can be kept again in a moment.
              const taken = keepForLater(title) !== null
              setOutcome(taken ? 'kept' : 'refused')
              return taken
            }}
            onDone={close}
          />
          <p aria-live="polite" className="mt-2 min-h-4 text-xs text-muted">
            {outcome === 'refused' &&
              'Not kept yet — a backup is still being imported. Keep it again in a moment.'}
            {outcome === 'kept' && (
              <>
                Kept ·{' '}
                <a
                  href={TASKS_HASH}
                  onClick={() => setOpen(false)}
                  className="text-body underline-offset-4 hover:text-bright hover:underline"
                >
                  {waiting} waiting on Tasks
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
