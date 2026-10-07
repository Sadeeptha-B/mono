/**
 * The way to the routine page, from wherever a question about one day borders
 * on every day: the opening questions about hours and commitments, the
 * calendar's editors for them, and Settings.
 *
 * The routine has no place in the header (see `AppHeader`): it is set up once
 * and changed rarely, and the moment someone wants it is the moment they are
 * answering one of these questions and find the answer is the same every day.
 * So it is offered there, in the same words each time.
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
