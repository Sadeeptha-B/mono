/**
 * The small shared pieces: buttons and form field styling.
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
  type Ref,
} from 'react'

import { coerceBoundedMinutes } from './minutes'
import { GUIDE_HASH, TASKS_HASH, type Route } from '@/hooks/useRoute'

export const fieldClass =
  'min-w-0 w-full max-w-full rounded-lg border border-muted/70 bg-ink px-3.5 py-2.5 text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none'

export const labelClass =
  'mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase'

/**
 * The controls in the top-right of a view: Tasks, Guide, Settings, Back to
 * today.
 *
 * Shared because there are three headers — the day, the tasks page and the
 * guide — and they carry the same controls. Two copies of this string drifted
 * apart once already.
 */
export const headerControlClass =
  'rounded-lg border border-muted/70 px-3 py-1.5 text-xs text-body transition hover:bg-surface-raised hover:text-bright'

/**
 * Tasks and Guide, the same pair in every header.
 *
 * Each page used to leave out its own link, which made the header change shape
 * from one page to the next and left no way from the guide to the tasks without
 * going back to the day first. The page you are on keeps its link, marked as
 * the current page rather than removed, so the row reads the same everywhere.
 * Real links, so either can be opened in its own tab and survives a reload like
 * the document it is.
 */
export function PageLinks({ current }: { current: Route }) {
  const link = (route: Route, href: string, name: string) => {
    const here = route === current
    return (
      <a
        href={href}
        {...(here ? { 'aria-current': 'page' as const } : {})}
        className={`${headerControlClass} ${here ? 'border-bright/60 text-bright' : ''}`}
      >
        {name}
      </a>
    )
  }
  return (
    <>
      {link('tasks', TASKS_HASH, 'Tasks')}
      {link('guide', GUIDE_HASH, 'Guide')}
    </>
  )
}

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
export function TimeInput({
  variant = 'field',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  /**
   * Working-hour ranges use the same boundary with denser spacing. Its
   * `@max-xs` adjustment requires an ancestor marked `@container`.
   */
  variant?: 'field' | 'compact'
}) {
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
        type="time"
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
 * `canFold` false draws the heading without a caret or a ×: the intentions
 * question with nothing named yet, where the field is the whole question and
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
 * than to any answer to it — the intentions question's own timer.
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
 * A native select with a short word in front of it, such as "Intention:".
 *
 * Native because it is the right control for a short flat list in a dense row
 * — the platform's own picker on a phone, type to jump on a desktop — and
 * because a custom one would be a component to keep accessible for no gain.
 * The tasks page uses it to put a task under one of today's intentions. A
 * choice among tasks in the backlog is not flat, and has `TaskTreePicker`,
 * which draws it as the tree it is.
 */
export function InlineSelect({
  label,
  prefix,
  value,
  onChange,
  options,
  wide = false,
  ref,
}: {
  label: string
  prefix: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; name: string }[]
  /** Room for a full path rather than a single name. */
  wide?: boolean
  /** For a caller that mounts the select on demand and opens it at once. */
  ref?: Ref<HTMLSelectElement>
}) {
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-muted">
      <span>{prefix}</span>
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`${wide ? 'max-w-[18rem]' : 'max-w-[11rem]'} min-w-0 truncate rounded-md border border-muted/70 bg-ink px-1.5 py-0.5 text-body focus:border-deep focus:outline-none`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}
