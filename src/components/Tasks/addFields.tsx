/**
 * The tasks page's `Add …` fields, and the page's hold on what is typed in
 * them (`AddFields`). Provided by `TasksPage` above the board's replacement
 * key, so a line typed into one outlasts an import landing — see `Backlog`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { PlusIcon } from '../icons'
import { AddFold, fieldClass, GhostButton, useFocusOnFold } from '../ui'
import { useLeave } from '../useLeave'

const FOLD_CLASS = {
  inline: { box: 'mt-2', heading: 'text-xs text-muted' },
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
 * What a page provides as `AddFields`: held by the page, above whatever it
 * keys by the backlog's replacements, so what is typed outlasts an import.
 * Stable across the timer's once-a-second render, so no field re-runs its fold
 * check for a tick.
 */
export function useAddFieldsValue() {
  const [current, claim] = useState<string | null>(null)
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
  return useMemo(() => ({ current, claim, drafts, draft }), [current, drafts, draft])
}

/**
 * An `Add …` control that opens into the field it asks for.
 *
 * Folded because the board has one in every column, every epic and every area,
 * and open they outweighed the tasks they add to: a page that is mostly empty
 * fields reads as a form to fill in rather than as the backlog. The fold costs
 * one click, and only on the rarer visit that adds rather than ticks.
 *
 * Two shapes. A task, an outcome or an epic opens as a card (`task`,
 * `outcome`, `epic`): `+ Add task` at the foot of a column, the small outlined
 * `+` at the top right of an epic's outcomes, or `+ Add epic` under an area's
 * cards, gives way to an empty card of the kind it adds, drawn where that card
 * will be — the way a board tool adds one. An area is not a card, but the
 * same rule holds: `+ Add area` at the foot of the board opens an empty area
 * name, set and ruled like a band's own, where the new band will stand. A
 * line for Later opens under a caret heading (`AddFold`), and keeps its own
 * `Done`.
 *
 * Enter adds and keeps it open, cleared and focused, because things are
 * usually written down in runs — three tasks for one outcome, not one; a card
 * stays at the foot of the list, under the one it just added. On the board,
 * leaving it — a click anywhere else, or Tab out of it — adds what is typed
 * and folds it, as a board's add field does, so there is no `Done` to find;
 * left empty, it simply folds. Later keeps its `Done` (`saveOnLeave` false):
 * a line put down for later is a thought half-caught, and the board's habit
 * of keeping whatever a click leaves behind is not one it was asked to share. The ×, Escape and a heading's caret fold it without adding,
 * and hand focus back to what opened it; a leave leaves the focus where it
 * went. It also folds when another field is opened while it is empty, so at
 * most one empty field is ever showing and nothing typed is thrown away
 * unasked. A line the store refuses — an import is landing — keeps the field
 * open with it, however it was asked to be kept.
 *
 * The leave waits for the click that caused it to finish (`useLeave`). Saving
 * on `blur` itself was tried first and removed, with a `Done` put in its
 * place: the press blurs the field before the release that completes the
 * click, so the row added and the field folding moved the page under the
 * pointer, and the click landed on whatever slid into its place — usually not
 * the `Add task` below it that was aimed at.
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
  saveOnLeave = true,
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
  /** What opens it: `Add task`, `Add outcome`. */
  opener: string
  /** The opener's accessible name, when its text alone does not say where. */
  openerLabel?: string
  /**
   * `inline` under a caret heading; `task`, `outcome` and `epic` open as an
   * empty card of that kind, and `area` as an empty band's name, where the
   * new one will stand.
   */
  variant?: 'inline' | 'task' | 'outcome' | 'epic' | 'area'
  /** Keep what is typed when the field is left (the board); false keeps a `Done` instead. */
  saveOnLeave?: boolean
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

  // Whether the last fold was the field being left, which leaves the focus be.
  const left = useRef(false)
  const refocus = () => !left.current
  // Keeps what is typed, if anything, and folds; a refusal keeps it open.
  const leave = useLeave(() => {
    if (title === null) return
    if (title.trim() !== '' && onAdd(title) === null) return
    left.current = true
    fold()
  })
  const leaving = saveOnLeave ? leave : {}
  // Keeps what is typed, if anything, and folds; a refusal keeps it open.
  const done = () => {
    if (title !== null && title.trim() !== '' && onAdd(title) === null) return
    fold()
  }
  const openIt = () => {
    left.current = false
    setTitle('')
    setAsked(true)
    claim(draftKey)
  }
  const cancelLabel = `Cancel ${label.charAt(0).toLowerCase()}${label.slice(1)}`

  const input = (inputClass: string) => (
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
      className={inputClass}
    />
  )
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title === null || onAdd(title) === null) return
    setTitle('')
    field.current?.focus()
  }

  if (variant !== 'inline') {
    return (
      <div {...leaving} className={className}>
        <AddCard
          kind={variant}
          open={open}
          opener={opener}
          {...(openerLabel ? { openerLabel } : {})}
          onOpen={openIt}
          onCancel={fold}
          cancelLabel={cancelLabel}
          refocus={refocus}
          onSubmit={submit}
        >
          {/* Set as the title it will become: a band's name, or a card's. */}
          {input(
            `min-w-0 flex-1 bg-transparent text-bright placeholder:text-muted/80 focus:outline-none ${
              variant === 'area' ? 'text-lg' : 'text-sm'
            }`,
          )}
        </AddCard>
      </div>
    )
  }

  const style = FOLD_CLASS[variant]
  return (
    <div {...leaving} className={`${style.box} ${className}`}>
      <AddFold
        title={opener}
        {...(openerLabel ? { label: openerLabel } : {})}
        open={open}
        onOpen={openIt}
        onCancel={fold}
        cancelLabel={cancelLabel}
        refocus={refocus}
        className={style.heading}
      >
        <form className="flex items-center gap-2" onSubmit={submit}>
          {input(`${fieldClass} py-1.5 text-sm`)}
          {!saveOnLeave && (
            // Smaller than the page's other buttons: it sits in a narrow column.
            <GhostButton type="button" onClick={done} className="shrink-0 px-3 py-1.5 text-xs">
              Done
            </GhostButton>
          )}
        </form>
      </AddFold>
    </div>
  )
}

/**
 * A task, outcome or epic being added, as the card it will be: folded, the
 * quiet `+ Add task` or `+ Add epic`, or for an outcome a small outlined `+`
 * alone, its words in its name and on hover, since the epic's board places it
 * apart from the columns (`EpicBoard`); open, an empty card of that kind where
 * it will stand, its field where the title will be and a × that throws it
 * away. An area the same way,
 * as the name heading a band rather than a card, with the band's rule under
 * it and `+ Add area` sized as the page's last word rather than a column's.
 * Only drawn: what is typed, and how it is kept, are `AddForm`'s.
 *
 * Open, the opener is gone — the card stands in its place, as a board's does —
 * so the × or Escape hands the focus back to the opener drawn again
 * (`useFocusOnFold`).
 */
function AddCard({
  kind,
  open,
  opener,
  openerLabel,
  onOpen,
  onCancel,
  cancelLabel,
  refocus,
  onSubmit,
  children,
}: {
  kind: 'task' | 'outcome' | 'epic' | 'area'
  open: boolean
  opener: string
  openerLabel?: string
  onOpen: () => void
  onCancel: () => void
  cancelLabel: string
  refocus: () => boolean
  onSubmit: (e: FormEvent) => void
  /** The field. */
  children: ReactNode
}) {
  const openerRef = useRef<HTMLButtonElement>(null)
  useFocusOnFold(open, openerRef, refocus)

  const cancel = (
    <button
      type="button"
      onClick={onCancel}
      aria-label={cancelLabel}
      className="-my-0.5 -mr-1 shrink-0 px-0.5 text-muted transition hover:text-bright"
    >
      ×
    </button>
  )

  if (!open) {
    return kind !== 'outcome' ? (
      <button
        ref={openerRef}
        type="button"
        onClick={onOpen}
        {...(openerLabel ? { 'aria-label': openerLabel } : {})}
        className={`flex items-center gap-1.5 transition hover:text-bright ${
          kind === 'area' ? 'text-sm text-body' : 'text-xs text-muted'
        } ${kind === 'task' ? 'mt-2 px-1' : ''}`}
      >
        <PlusIcon className="size-3" />
        {opener}
      </button>
    ) : (
      <button
        ref={openerRef}
        type="button"
        onClick={onOpen}
        aria-label={openerLabel ?? opener}
        title={opener}
        className="flex size-7 items-center justify-center rounded-lg border border-dashed border-line text-muted transition hover:border-muted hover:text-bright"
      >
        <PlusIcon className="size-3.5" />
      </button>
    )
  }

  // The card's own outline lights while its field has the focus, since the
  // field itself is drawn without one, as the title it will become.
  if (kind === 'area') {
    return (
      <form
        onSubmit={onSubmit}
        className="flex max-w-md items-center gap-2 border-b border-line pb-2 focus-within:border-deep"
      >
        {children}
        {cancel}
      </form>
    )
  }
  return kind === 'task' ? (
    <form
      onSubmit={onSubmit}
      className="mt-2 flex items-start gap-2 rounded-lg border border-muted/70 bg-surface/40 px-3 py-2 focus-within:border-deep"
    >
      {children}
      {cancel}
    </form>
  ) : (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-muted bg-surface/40 px-3 py-2.5 focus-within:border-deep"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-widest text-muted uppercase">
          {kind === 'epic' ? 'Epic' : 'Outcome'}
        </span>
        {cancel}
      </div>
      <div className="mt-0.5 flex">{children}</div>
    </form>
  )
}
