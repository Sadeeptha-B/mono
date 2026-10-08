/**
 * Putting something down for later, from wherever Mono is: the header's
 * `Later` on every page, `⤴ Later` beside `✎ Log` while a block runs, on the
 * stage and in the mini window, and `Add to Later` on the tasks page. What is
 * put down is dealt with on the tasks page (`LaterSection`): the moment a
 * tangent arrives is the moment to be rid of it, not to file it.
 *
 * Every one of those goes through `keepForLater`, never to the store's
 * `addLater` directly. Where a line was written is the same fact wherever it
 * was typed, and a field that called the store itself — the tasks page's, at
 * first — kept lines written during a block without the block.
 *
 * The task store knows nothing about the day, so it is told here where a line
 * came from: the running block and what it was for, by the same test that
 * says a block is running for ambience and site blocking (`isBlockRunning`).
 * Read when the line is kept rather than when the field opened, since a block
 * can end with the field still open.
 */

import { isBlockRunning } from '@/domain/machine'
import { waitingLater } from '@/domain/later'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'

/**
 * Put a line down for later, marked with the block it was written in, if any.
 * Its id, or null when the backlog would not take it — a blank line, or an
 * import landing — so the field it came from can keep it rather than lose it.
 */
export function keepForLater(title: string): string | null {
  const { phase, session } = useSession.getState()
  const { active } = session
  const from =
    isBlockRunning(phase, active) && active?.kind === 'block' && active.purpose !== null
      ? { blockId: active.id, purpose: active.purpose }
      : undefined
  return useTasks.getState().addLater(title, from)
}

/**
 * How many lines the running block has put down for later and not yet dealt
 * with, so keeping one visibly did something without the block listing what
 * is not about it. Zero with no block running.
 */
export function useKeptInBlock(): number {
  const blockId = useSession((s) =>
    s.session.active?.kind === 'block' ? s.session.active.id : null,
  )
  const later = useTasks((s) => s.later)
  if (blockId === null) return 0
  return waitingLater(later).filter((l) => l.from?.blockId === blockId).length
}

/** How many are waiting on the tasks page. */
export const useWaitingCount = (): number => waitingLater(useTasks((s) => s.later)).length
