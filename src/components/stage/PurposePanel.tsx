/**
 * "One thing" — asked in place, where the timer will be.
 *
 * This deliberately is not a dialog. Naming the block is part of the work, not
 * an interruption to it, and a modal would blank out the very timeline that
 * tells you what the rest of the day looks like.
 */

import { useEffect, useRef, useState } from 'react'

import { fieldClass, GhostButton, PrimaryButton, StagePrompt } from '../ui'
import type { BlockKind } from '@/domain/types'

type Props = {
  blockKind: BlockKind
  afterReflection: boolean
  minutes: number
  reflectMinutes: number
  onSubmit: (purpose: string) => void
  onCannotDecide: () => void
  onCancel: () => void
}

export function PurposePanel({
  blockKind,
  afterReflection,
  minutes,
  reflectMinutes,
  onSubmit,
  onCannotDecide,
  onCancel,
}: Props) {
  const [purpose, setPurpose] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // Focus on entry, and start from a blank prompt rather than the last block's
  // text. Runs once per mount: the panel unmounts when the phase moves on.
  //
  // Only if this document already has focus, which matters since the mini
  // window arrived. Starting a block from there mounts this panel in a tab
  // nobody is looking at, and focusing an element in an unfocused window can
  // raise that window — so an ungated call would drag the user back to the tab
  // they had just walked away from, mid-keystroke. The mini window's own field
  // is gated the same way, so at most one of the two takes focus and only if
  // its window already had it.
  useEffect(() => {
    setPurpose('')
    if (document.hasFocus()) input.current?.focus()
  }, [])

  const trimmed = purpose.trim()

  return (
    <form
      className="max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <StagePrompt
        eyebrow={`${minutes} minute ${blockKind === 'deep' ? 'deep' : 'short'} block`}
        title="One thing"
        detail={
          afterReflection
            ? 'Now that the day has a shape — what is this block for?'
            : 'What is this block for? One purpose, not a list.'
        }
      />

      <input
        ref={input}
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        placeholder="Finish the planner tests"
        aria-label="Purpose for this block"
        maxLength={120}
        className={`${fieldClass} py-3 text-lg`}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PrimaryButton type="submit" disabled={!trimmed}>
          Start
        </PrimaryButton>
        <GhostButton type="button" onClick={onCancel}>
          Not yet
        </GhostButton>
        <button
          type="button"
          onClick={onCannotDecide}
          className="ml-auto text-sm text-muted underline-offset-4 transition hover:text-body hover:underline"
        >
          I can't pick one
        </button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Stuck? Take {reflectMinutes} minutes to work out what actually matters today. It
        gets recorded like any other block.
      </p>
    </form>
  )
}
