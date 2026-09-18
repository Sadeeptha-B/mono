/**
 * The small shared pieces: buttons and form field styling.
 *
 * These live outside `prompts/` because most of Mono's decisions are now made
 * inline on the stage rather than in a dialog, and the two should look
 * identical wherever they appear. Decorative edges use `line`; the boundary
 * of anything clickable or focusable uses `muted/70`, which is held to 3:1.
 */

import {
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
} from 'react'

import { coerceBoundedMinutes } from './minutes'

export const fieldClass =
  'min-w-0 w-full max-w-full rounded-lg border border-muted/70 bg-ink px-3.5 py-2.5 text-bright placeholder:text-muted/90 focus:border-deep focus:outline-none'

export const labelClass =
  'mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase'

/**
 * The controls in the top-right of a view: Guide, Settings, Back to today.
 *
 * Shared because there are two headers — the day and the guide — and they carry
 * some of the same controls. Two copies of this string drifted apart once
 * already.
 */
export const headerControlClass =
  'rounded-lg border border-muted/70 px-3 py-1.5 text-xs text-body transition hover:bg-surface-raised hover:text-bright'

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

/** The heading above an inline decision on the stage. */
export function StagePrompt({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div className="mb-4">
      <div className="text-xs font-medium tracking-widest text-muted uppercase">
        {eyebrow}
      </div>
      <h2 className="mt-1.5 text-2xl leading-tight font-light text-bright">{title}</h2>
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
