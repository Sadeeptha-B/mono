/**
 * The tasks page's `Add …` fields, and the page's hold on what is typed in
 * them (`AddFields`). Provided by `TasksPage` above the board's replacement
 * key, so a line typed into one outlasts an import landing — see `Backlog`.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'

import { AddFold, fieldClass, GhostButton } from '../ui'

const FOLD_CLASS = {
  inline: { box: 'mt-2', heading: 'text-xs text-muted' },
  prominent: { box: 'mt-2', heading: 'text-sm text-body' },
  slot: {
    box: 'rounded-xl border border-dashed border-line px-3 py-4 hover:border-muted',
    heading: 'w-full text-xs text-muted',
  },
} as const

/**
 * The page's add fields: which was opened last, so opening one can fold the
 * others (`null` once the last one opened has been folded by hand), and what
 * is typed in each, by the field's `draftKey`.
 *
 * The drafts are the page's, not each field's, so they outlast a field being
 * drawn again: `Backlog` is started again when the backlog is replaced, and
 * what was being written into it is not part of what was replaced. Absent is
 * folded; an empty string is open with nothing typed.
 */
export const AddFields = createContext<{
  current: string | null
  claim: (id: string | null) => void
  drafts: ReadonlyMap<string, string>
  draft: (key: string, update: (was: string | null) => string | null) => void
}>({
  current: null,
  claim: () => undefined,
  drafts: new Map(),
  draft: () => undefined,
})

/**
 * An `Add …` heading that opens into the field it asks for (`AddFold`).
 *
 * Folded because the board has one in every column, every epic and every area,
 * and open they outweighed the tasks they add to: a page that is mostly empty
 * fields reads as a form to fill in rather than as the backlog. The fold costs
 * one click, and only on the rarer visit that adds rather than ticks.
 *
 * Enter adds and keeps it open, cleared and focused, because things are
 * usually written down in runs — three tasks for one outcome, not one. `Done`
 * adds what is typed and folds it. The caret, the × and Escape fold it without
 * adding, and all three hand focus back to the heading. It also folds when
 * another field is opened while it is empty, so at most one empty field is
 * ever showing and nothing typed is thrown away unasked.
 *
 * Not on blur, which was tried first. A press elsewhere blurs the field before
 * the release that completes the click, so a field folding on blur moved the
 * page under the pointer and the click landed on whatever slid into its place
 * — usually not the button below it that was aimed at. Opening another field
 * is itself a finished click, so folding in answer to it moves nothing that
 * matters.
 *
 * What is typed is held by the page under `draftKey` (`AddFields`), so a field
 * drawn again — after an import replaces the backlog — comes back open with
 * what was in it. It takes the focus only when a click opens it, never when it
 * comes back by itself, which would take the focus from wherever it had gone.
 */
export function AddForm({
  draftKey,
  opener,
  openerLabel,
  variant = 'inline',
  label,
  placeholder,
  maxLength = 120,
  className = '',
  onAdd,
}: {
  /**
   * Where it adds, and what: `task:<parent id>`, `later`. Stable across the
   * field being drawn again, which a React id is not, and unique on the page.
   */
  draftKey: string
  /** The heading: `Add task`, `Add outcome`. */
  opener: string
  /** The heading's accessible name, when its text alone does not say where. */
  openerLabel?: string
  /**
   * `inline` under what it adds to; `prominent` for the page's own `Add
   * area`, sized as the page's last word rather than a column's; `slot` for a
   * whole column of the board, outlined where the new column will stand.
   */
  variant?: 'inline' | 'prominent' | 'slot'
  label: string
  placeholder: string
  maxLength?: number
  className?: string
  /** Returns the new id, or null when the store refused it. */
  onAdd: (title: string) => string | null
}) {
  const { current, claim, drafts, draft } = useContext(AddFields)
  /** What is typed while open, or null while folded. */
  const title = drafts.get(draftKey) ?? null
  const setTitle = (next: string | null) => draft(draftKey, () => next)
  const open = title !== null
  // Opened by a click in this drawing of the field, and so the focus's.
  const [asked, setAsked] = useState(false)

  // Another field was opened: fold this one if nothing has been typed in it.
  useEffect(() => {
    if (current !== null && current !== draftKey) draft(draftKey, (t) => (t === '' ? null : t))
  }, [current, draftKey, draft])

  const field = useRef<HTMLInputElement>(null)

  const fold = () => {
    setTitle(null)
    if (current === draftKey) claim(null)
  }

  // Keeps what is typed, if anything, and folds; a refusal keeps it open.
  const done = () => {
    if (title !== null && title.trim() !== '' && onAdd(title) === null) return
    fold()
  }

  const style = FOLD_CLASS[variant]
  return (
    <div className={`${style.box} ${className}`}>
      <AddFold
        title={opener}
        {...(openerLabel ? { label: openerLabel } : {})}
        open={open}
        onOpen={() => {
          setTitle('')
          setAsked(true)
          claim(draftKey)
        }}
        onCancel={fold}
        cancelLabel={`Cancel ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        className={style.heading}
      >
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (title === null || onAdd(title) === null) return
            setTitle('')
            field.current?.focus()
          }}
        >
          <input
            ref={field}
            value={title ?? ''}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && fold()}
            placeholder={placeholder}
            aria-label={label}
            // Opened by a click asking for exactly this field; not when it is
            // drawn again with what was typed in it.
            autoFocus={asked}
            maxLength={maxLength}
            className={`${fieldClass} py-1.5 text-sm`}
          />
          {/* Smaller than the page's other buttons: every column can carry one. */}
          <GhostButton type="button" onClick={done} className="shrink-0 px-3 py-1.5 text-xs">
            Done
          </GhostButton>
        </form>
      </AddFold>
    </div>
  )
}
