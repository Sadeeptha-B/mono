/**
 * Whether taking tasks out of today would be refused because they are all a
 * running block holds.
 *
 * A running block's tasks are today's, so taking one out of today takes it
 * off the block as well, and taking out everything the block holds is refused
 * whole (`removeAllFromToday`), as letting go of it in All Tasks is: every
 * block is for at least one task. The surfaces that take tasks out of today —
 * today's list, a place's heading in it, and the tasks page's suns — ask this
 * so a refused press says why, as All Tasks' last box does, rather than
 * looking like a press that did not land.
 */

import { useCallback } from 'react'

import { leavesBlockEmpty, runningBlockTasks } from '@/domain/machine'
import { useSession } from '@/store/session'

export const KEEPS_BLOCK =
  'Every block is for at least one task. Tick another for it in All Tasks before taking this out of today.'
export const KEEPS_BLOCK_PLACE =
  'Every block is for at least one task. Tick another for it in All Tasks before taking all of this out of today.'

/** Asks whether taking these tasks out of today would leave the running block with none. */
export function useKeepsBlock(): (taskIds: readonly string[]) => boolean {
  const held = useSession((s) => runningBlockTasks(s.phase, s.session))
  return useCallback((taskIds) => leavesBlockEmpty(held, taskIds), [held])
}
