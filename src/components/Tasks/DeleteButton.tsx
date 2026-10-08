/**
 * The tasks page's delete, which asks first when there is more than the thing
 * itself to lose, and the plain words it asks with.
 */

import { useState, type ReactNode } from 'react'

import { DeleteIcon } from '../icons'
import { IconButton } from '../ui'
import { liveDescendantsOf, type Item } from '@/domain/tasks'

/**
 * Delete, asking first when there is more than the thing itself to lose.
 *
 * Asked inline rather than in a dialog — Settings is the only dialog Mono has
 * — and only when it matters: an empty epic or area goes at once, one holding
 * tasks says how many will go with it. The same for an area as for an item,
 * since both take what is beneath them the same way.
 */
export function DeleteButton({
  title,
  inside,
  onDelete,
  className = '',
}: {
  title: string
  /** How many live items would go with it. */
  inside: number
  onDelete: () => void
  /** For the icon at rest only: a question being asked stays on screen. */
  className?: string
}) {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <IconButton
        danger
        onClick={() => (inside === 0 ? onDelete() : setAsking(true))}
        label={`Delete ${title}`}
        hint="Delete"
        className={className}
      >
        <DeleteIcon />
      </IconButton>
    )
  }
  // A line of its own in the row of icons it replaces one of: the question is
  // words, and squeezed beside the icons it wrapped a word to a line.
  return (
    <span
      role="group"
      aria-label={`Confirm deleting ${title}`}
      className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 py-1"
    >
      <span className="text-xs text-commit">
        And the {inside} item{inside === 1 ? '' : 's'} inside?
      </span>
      <TextButton onClick={onDelete} label={`Delete ${title} and everything in it`}>
        Delete all
      </TextButton>
      <TextButton onClick={() => setAsking(false)}>Keep</TextButton>
    </span>
  )
}

/** The live items anywhere beneath an area or an item: what deleting it takes. */
export const liveInside = (id: string, items: readonly Item[]): number =>
  liveDescendantsOf(id, items).length

function TextButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(label ? { 'aria-label': label } : {})}
      className="text-xs text-muted underline-offset-4 transition hover:text-bright hover:underline"
    >
      {children}
    </button>
  )
}
