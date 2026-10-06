/**
 * The small line icons that stand in for words on a dense row: done, drop,
 * archive, restore, reopen, delete.
 *
 * Drawn rather than typed, for the reason `GripGlyph` gives on the tasks page:
 * the Unicode characters that look like these are missing from some system
 * fonts, or are read aloud as something else, and a control that is sometimes
 * an empty box is worse than a word. They are all one size, one stroke and
 * `currentColor`, so a button's hover colour is the icon's, and every one is
 * hidden from assistive technology — the button around it carries the name.
 *
 * The pencil is not here. `EditGlyph` is a character mirrored on purpose, and
 * the guide quotes it as one; it stays the one way Mono draws "edit".
 */

import type { ReactNode } from 'react'

const SIZE = 14

function Icon({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={SIZE}
      height={SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

/** A tick: done. */
export const CheckIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </Icon>
)

/** A circle struck through: dropped, decided against. */
export const DropIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M4.2 11.8l7.6-7.6" />
  </Icon>
)

/** A box with a lid: put away, kept. */
export const ArchiveIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <rect x="2" y="3" width="12" height="3" rx="0.75" />
    <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3" />
  </Icon>
)

/** The box again, with something coming out of it: back from the archive. */
export const RestoreIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 7v5.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7M8 11V2.5M5.5 5L8 2.5 10.5 5" />
  </Icon>
)

/** An arrow turning back on itself: open again. */
export const ReopenIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3.5 6.5h6.25a3.25 3.25 0 0 1 0 6.5H6M6 3.5l-3 3 3 3" />
  </Icon>
)

/** A bin: deleted for good. */
export const DeleteIcon = ({ className = '' }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 4.5h11M6.5 4.5V3a.75.75 0 0 1 .75-.75h1.5A.75.75 0 0 1 9.5 3v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" />
  </Icon>
)

/**
 * A ring, ticked and filled once done: whether something said to be finished
 * by hand has been — an intention. Filled rather than only ticked so the two
 * states differ by more than a thin stroke at a glance.
 */
export const DoneRingIcon = ({ done, className = '' }: { done: boolean; className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="6" {...(done ? { fill: 'currentColor' } : {})} />
    {done && <path d="M5.2 8.2l1.9 1.9 3.7-3.9" stroke="var(--color-ink)" />}
  </Icon>
)

/**
 * A small sun: chosen for today. Filled once chosen, for the reason the done
 * ring is — the two states should differ by more than a thin stroke.
 */
export const TodayIcon = ({ chosen, className = '' }: { chosen: boolean; className?: string }) => (
  <Icon className={className}>
    <circle cx="8" cy="8" r="2.75" {...(chosen ? { fill: 'currentColor' } : {})} />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Icon>
)
