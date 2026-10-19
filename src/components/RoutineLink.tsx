/**
 * The way to the routine page, from wherever a question about one day borders
 * on every day: the opening questions about hours and commitments, the
 * calendar's editors for them, and Settings.
 *
 * The header carries the routine too (see `AppHeader`), but these stay: the
 * moment someone most often wants it is the moment they are answering one of
 * these questions and find the answer is the same every day, and the link
 * beside the question is shorter than the way round through the header. So it
 * is offered there, in the same words each time.
 */

import { ROUTINE_HASH } from '@/hooks/useRoute'

export function RoutineLink({ onFollow }: { onFollow?: () => void }) {
  return (
    <a
      href={ROUTINE_HASH}
      {...(onFollow ? { onClick: onFollow } : {})}
      className="underline underline-offset-4 hover:text-bright"
    >
      Routine
    </a>
  )
}
