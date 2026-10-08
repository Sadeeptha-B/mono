/**
 * A sentence that says why a control will not do what it is asked, opened on
 * the control the way a log opens from its mark: Mono's own card
 * (`hoverCard.ts`), at once on hover or focus, placed where the column has
 * room for it, rather than the browser's `title`, which arrives a second late
 * and looks like nothing else here.
 *
 * Its host is always drawn, and the card only while there is something to
 * say (`note`). A row that comes to need one — the last of a block's tasks
 * once the others are let go — keeps the same elements, so the box with the
 * focus in it is not drawn again from under the keyboard.
 *
 * The card is the control's description (`describedBy`) as well as what the
 * pointer sees, so a screen reader hears the same sentence.
 */

import { useId, useRef, type ReactNode } from 'react'

import { cardClass, useOpenCard } from './hoverCard'

/** Wide enough for two short lines, and never taller than it needs. */
const NOTE_SIZE = { width: 224, height: 96 }

export function HoverNote({
  note,
  className = '',
  children,
}: {
  /** What to say, or null while there is nothing to. */
  note: string | null
  /** The host's own layout, which takes the place of the control it wraps. */
  className?: string
  /** The control, given the id of what describes it while there is a note. */
  children: (describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLSpanElement>(null)
  const opening = useOpenCard(anchor, anchor, card, { beside: false, size: NOTE_SIZE })

  return (
    <span ref={anchor} className={`group/note relative ${className}`} {...(note ? opening : {})}>
      {children(note ? id : undefined)}
      {note && (
        <span
          ref={card}
          id={id}
          role="tooltip"
          className={`${cardClass} hidden text-xs leading-snug text-body group-focus-within/note:block group-hover/note:block`}
        >
          {note}
        </span>
      )}
    </span>
  )
}
