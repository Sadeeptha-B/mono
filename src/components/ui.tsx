/**
 * The small shared pieces: buttons and form field styling.
 *
 * These live outside `prompts/` because most of Mono's decisions are now made
 * inline on the stage rather than in a dialog, and the two should look
 * identical wherever they appear.
 */

import type { ButtonHTMLAttributes } from 'react'

export const fieldClass =
  'w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-bright placeholder:text-muted/60 focus:border-deep focus:outline-none'

export const labelClass =
  'mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase'

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
