/**
 * The small shared pieces: buttons, icon buttons, in-place fields and form
 * field styling.
 *
 * These live outside `prompts/` because most of Mono's decisions are now made
 * inline on the stage rather than in a dialog, and the two should look
 * identical wherever they appear. Decorative edges use `line`; the boundary
 * of anything clickable or focusable uses `muted/70`, which is held to 3:1.
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

import { coerceBoundedMinutes } from './minutes'

export const fieldClass =
  'min-w-0 w-full max-w-full rounded-lg border border-muted/70 bg-ink px-3.5 py-2.5 text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none'

export const labelClass =
  'mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase'

/**
 * A tool in the header, drawn as an icon: the room, the pop-out, the guide and
 * settings. Borderless and quiet at rest, so four of them read as a cluster
 * rather than a row of buttons, with the name each one cannot show carried by
 * its `aria-label` and shown on hover by its `title`. Shared because every view
 * draws the same header (`AppHeader`), and the room and pop-out controls live
 * in their own modules.
 */
export const headerIconClass =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-raised hover:text-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright'

/**
 * The pencil on an editable block, pointing left.
 *
 * Unicode's pencil dingbats all point to the lower *right* — U+270E is
 * literally named LOWER RIGHT PENCIL — so this is that character mirrored
 * rather than a codepoint of its own. U+1F589 LOWER LEFT PENCIL does exist and
 * would be the honest answer, but it is missing from enough system fonts to
 * render as an empty box, and a control that is sometimes a box is worse than a
 * pencil facing the wrong way. The transform needs `inline-block`: it does
 * nothing at all to a bare inline span.
 *
 * A component rather than a character typed in two places, because the guide
 * quotes this control and the calendar draws it. One of them being a mirror
 * image of the other reads as two different buttons.
 */
export const EditGlyph = () => <span className="inline-block -scale-x-100">✎</span>

/**
 * A row's actions, shown on hover or while focus is in the row, and always on
 * a touch screen, which has no hover. Put `group/row` on the row.
 *
 * Faded rather than removed, so each control keeps its place and is still
 * there to be tabbed to: focusing one is what shows it. At rest a list reads
 * as its titles; the actions are a pointer or a Tab away. Used by All Tasks and
 * the tasks page alike, so the two are kept the same way.
 */
export const revealOnHover =
  'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100'

/**
 * A word that does something, drawn as a word rather than a button: End early
 * and Back to work while something runs, on the stage and in the mini window,
 * and the mini window's Reset size. Kept for the rare actions that should be
 * in reach without standing among the controls. The host sets the colour.
 */
export const quietActionClass =
  'rounded-sm underline-offset-2 hover:text-bright hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright'

/**
 * The small label over one of the stage's lists under a running block —
 * Tasks, Logs — set like the block's own label above the timer, so the parts
 * of the stage read as parts.
 */
export const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-[11px] font-medium tracking-widest text-muted uppercase">{children}</h3>
)

/**
 * An action drawn as an icon (`icons.tsx`, or `EditGlyph`) rather than a word:
 * the tasks page's rename, done, drop, archive, reopen, restore and delete,
 * and the same actions on a place in All Tasks.
 *
 * A row or card there carries up to four of these, and as words they were most
 * of what a narrow column held, pushing the titles they act on out of the way.
 * The name an icon cannot say goes in `label`, which is the accessible name and
 * says what it acts on — `Archive Mono auth` — and the bare verb in `hint`,
 * which a pointer sees on hover. `danger` is for the one that cannot be undone.
 */
export function IconButton({
  label,
  hint,
  onClick,
  danger = false,
  className = '',
  children,
}: {
  label: string
  hint: string
  onClick: () => void
  danger?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sm leading-none text-muted transition hover:bg-surface-raised ${
        danger ? 'hover:text-commit' : 'hover:text-bright'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function PrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-deep px-4 py-2.5 text-sm font-medium text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg border border-muted/70 px-4 py-2.5 text-sm text-body transition hover:bg-surface-raised hover:text-bright ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * A native time field whose box does not depend on the input's own padding.
 *
 * iOS Safari 26 miscalculates `width: 100%` on temporal inputs when the input
 * itself has padding. The ordinary `fieldClass` combines exactly those two
 * declarations, so a time control can extend past a form even when every grid
 * item is allowed to shrink. The frame owns the visual box and clips it; the
 * native input keeps its picker but has no padding to enter that WebKit path.
 * The frame forwards a click from its padding to the input, so separating the
 * visual box does not make the native picker's tap target any smaller.
 */
type TemporalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  /**
   * Working-hour ranges use the same boundary with denser spacing. Its
   * `@max-xs` adjustment requires an ancestor marked `@container`.
   */
  variant?: 'field' | 'compact'
}

export const TimeInput = (props: TemporalInputProps) => <TemporalInput {...props} type="time" />

/**
 * A native date field, framed as `TimeInput` is and for the same WebKit bug,
 * which affects every temporal input rather than only time. The recurring
 * page's start and end dates are the only ones Mono asks for.
 */
export const DateInput = (props: TemporalInputProps) => <TemporalInput {...props} type="date" />

function TemporalInput({
  type,
  variant = 'field',
  ...props
}: TemporalInputProps & { type: 'time' | 'date' }) {
  const input = useRef<HTMLInputElement>(null)
  const lastPointerType = useRef<string | null>(null)
  const frameClass =
    variant === 'compact'
      ? 'min-w-0 flex-1 px-2 @max-xs:px-1.5'
      : 'w-full px-3.5'

  const activateFromFrame = (event: MouseEvent<HTMLDivElement>) => {
    const field = input.current
    const fromTouch = lastPointerType.current === 'touch'
    lastPointerType.current = null
    if (!field || event.target === field || field.disabled) return

    field.focus()
    // A desktop pointer keeps the native distinction between clicking the
    // text and clicking empty frame space. A touch has no such precision: the
    // entire visible control is its tap target, so explicitly open the picker.
    if (!fromTouch) return

    try {
      field.showPicker()
    } catch {
      // Focus is the fallback where a browser does not expose `showPicker`, or
      // refuses it despite this handler running directly from a user gesture.
    }
  }

  return (
    <div
      data-time-input-frame
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        lastPointerType.current = event.pointerType
      }}
      onClick={activateFromFrame}
      className={`${frameClass} max-w-full overflow-hidden rounded-lg border border-muted/70 bg-ink py-2.5 focus-within:border-deep`}
    >
      <input
        {...props}
        ref={input}
        type={type}
        className="tnum block min-w-0 w-full max-w-full border-0 bg-transparent p-0 text-bright focus:outline-none"
      />
    </div>
  )
}

/**
 * A field for adding something, folded behind its own heading until asked for:
 * `Add intention`, `Add task`, `Add outcome`.
 *
 * One shape on the stage and the tasks page alike. The heading is a caret that
 * opens it and stays above it once open, so what is being added is said where
 * it is being written rather than only on a button that has gone; the × level
 * with it cancels, and so does the caret, folding it again. Either throws away
 * what was typed, as Escape does in the field — that is what cancelling means.
 * Whoever uses it owns the field and its `Done`, which keeps what was typed
 * and folds; Enter keeps it and leaves the field open for the next one,
 * because things are written down in runs.
 *
 * Focus is its business, not theirs. When it folds with focus inside it —
 * `Done`, the ×, Escape — the focused control goes with the fold, and focus
 * comes back to the heading rather than being dropped on the page. When focus
 * has already gone somewhere else — another field opened, the stage moved to
 * another question — it is left where it went.
 *
 * `canFold` false draws the heading without a caret or a ×: the commitments
 * question with nothing fixed yet, where the form is the whole question and
 * there is nothing to fold it back to.
 */
export function AddFold({
  title,
  label,
  open,
  onOpen,
  onCancel,
  cancelLabel,
  canFold = true,
  className = '',
  children,
}: {
  /** What is being added, as the heading says it. */
  title: string
  /** The heading's accessible name, when the title alone does not say where. */
  label?: string
  open: boolean
  onOpen: () => void
  onCancel: () => void
  cancelLabel: string
  canFold?: boolean
  /** The heading's own type: size and colour differ by where it sits. */
  className?: string
  children: ReactNode
}) {
  const toggle = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  // After the fold has rendered, so the heading it hands focus to is the one
  // now on screen. Focus lost with the fold rests on the document's body.
  useEffect(() => {
    const folded = wasOpen.current && !open
    wasOpen.current = open
    const doc = toggle.current?.ownerDocument
    if (folded && doc && (doc.activeElement === null || doc.activeElement === doc.body)) {
      toggle.current?.focus()
    }
  }, [open])

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {canFold ? (
          <button
            ref={toggle}
            type="button"
            onClick={open ? onCancel : onOpen}
            aria-expanded={open}
            {...(label ? { 'aria-label': label } : {})}
            className={`flex min-w-0 items-center gap-1.5 text-left transition hover:text-bright ${className}`}
          >
            <Caret open={open} />
            <span className="min-w-0 truncate">{title}</span>
          </button>
        ) : (
          <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
            <Caret open />
            <span className="min-w-0 truncate">{title}</span>
          </span>
        )}
        {open && canFold && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={cancelLabel}
            className="ml-auto shrink-0 px-1 text-muted transition hover:text-bright"
          >
            ×
          </button>
        )}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/** A chevron pointing at what it would show: right while folded, down while open. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 6 10"
      width="6"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
    >
      <path d="M1 1l4 4-4 4" />
    </svg>
  )
}

/**
 * The heading above an inline decision on the stage, with room level with the
 * title for one small control that belongs to the question as a whole rather
 * than to any answer to it — today's question's own timer.
 */
export function StagePrompt({
  eyebrow,
  title,
  detail,
  aside,
}: {
  eyebrow: string
  title: string
  detail?: string
  aside?: ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="text-xs font-medium tracking-widest text-muted uppercase">
        {eyebrow}
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-2xl leading-tight font-light text-bright">{title}</h2>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {detail && <p className="mt-1.5 text-sm leading-relaxed text-muted">{detail}</p>}
    </div>
  )
}

/**
 * A duration field with a floor and a ceiling it actually keeps.
 *
 * The parent owns the text, because what counts as valid differs by caller:
 * settings write every good keystroke straight through, while a form only
 * cares at submit. What is shared is the part worth having in one place — the
 * markup, and putting an out-of-range value back inside the range when the
 * field is left, whether by tab, click or Enter.
 */
export function MinutesInput({
  id,
  label,
  text,
  onText,
  min,
  max,
  fallback,
  step = 5,
  autoFocus = false,
}: {
  id: string
  label: string
  text: string
  onText: (text: string) => void
  min: number
  max: number
  /** Where an empty or unreadable field lands. */
  fallback: number
  step?: number
  autoFocus?: boolean
}) {
  const coerce = (raw: string) => onText(coerceBoundedMinutes(raw, fallback, min, max))

  return (
    // Native number controls keep an intrinsic minimum width in iOS Safari.
    // This wrapper is often a grid item beside a time input, so both it and
    // the input need permission to shrink inside their half of the row. The
    // input gets that from `fieldClass`; `min-w-0` here releases the grid item.
    <div className="min-w-0">
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onBlur={(e) => coerce(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') coerce(e.currentTarget.value)
        }}
        className={`${fieldClass} tnum`}
      />
    </div>
  )
}

/**
 * A name written in place, followed by a ✓ that keeps it and a × that lets it
 * go: a new intention, a new task or place in All Tasks, a rename there.
 *
 * The field and its two buttons only; the caller draws the frame around them,
 * which is what differs from one surface to the next. Enter is `onEnter` and
 * never submits a form the field sits in. Escape is the × and goes no further,
 * so an open menu around the field keeps its own Escape.
 */
export function KeepField({
  value,
  onChange,
  onEnter,
  onKeep,
  onCancel,
  label,
  keepLabel,
  cancelLabel,
  placeholder,
  inputClassName,
  autoFocus = false,
  focusKey,
}: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onKeep: () => void
  onCancel: () => void
  label: string
  keepLabel: string
  cancelLabel: string
  placeholder: string
  inputClassName: string
  /** Only where the press that drew the field asked for exactly it. */
  autoFocus?: boolean
  /** A key a caller can find the field by to focus it after it is drawn. */
  focusKey?: string
}) {
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        {...(focusKey !== undefined ? { 'data-focus-key': focusKey } : {})}
        maxLength={120}
        className={inputClassName}
      />
      <button
        type="button"
        onClick={onKeep}
        aria-label={keepLabel}
        className="shrink-0 px-0.5 text-deep transition hover:text-bright"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={cancelLabel}
        className="shrink-0 px-0.5 text-muted transition hover:text-bright"
      >
        ×
      </button>
    </>
  )
}

/**
 * A title rewritten in place, on the tasks page and in today's list: Enter or
 * `Save` keeps it, and neither keeps an empty one; Escape does not. Opened by
 * a press on that row's ✎, so it takes focus as it mounts. Never a form, so
 * it can sit inside one.
 */
export function RenameField({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  textClass = 'text-sm',
  maxLength = 120,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  textClass?: 'text-xs' | 'text-sm' | 'text-[15px]'
  /** A title is short; a block's note is a sentence or two. */
  maxLength?: number
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (value.trim() !== '') onSave()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        aria-label={label}
        autoFocus
        maxLength={maxLength}
        className={`${fieldClass} py-1 ${textClass}`}
      />
      <GhostButton
        type="button"
        disabled={value.trim() === ''}
        onClick={onSave}
        className="shrink-0 px-3 py-1 text-xs"
      >
        Save
      </GhostButton>
    </div>
  )
}
