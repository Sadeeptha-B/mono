/**
 * The small shared pieces: buttons and form field styling.
 *
 * These live outside `prompts/` because most of Mono's decisions are now made
 * inline on the stage rather than in a dialog, and the two should look
 * identical wherever they appear.
 */

import type { ButtonHTMLAttributes } from 'react'

import { coerceBoundedMinutes } from './minutes'

export const fieldClass =
  'w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-bright placeholder:text-muted/60 focus:border-deep focus:outline-none'

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
  'rounded-lg border border-line px-3 py-1.5 text-xs text-body transition hover:bg-surface-raised hover:text-bright'

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
      className={`rounded-lg border border-line px-4 py-2.5 text-sm text-body transition hover:bg-surface-raised hover:text-bright ${className}`}
    >
      {children}
    </button>
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
    <div>
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
