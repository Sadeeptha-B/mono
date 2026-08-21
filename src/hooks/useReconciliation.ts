/**
 * Reconciliation: noticing that time passed while we were not watching.
 *
 * Three independent things can make a block's end arrive without us: the tab
 * gets throttled to one tick a minute, the tab gets frozen entirely, or the
 * machine sleeps. So block completion is detected three ways — an armed
 * timeout, the wake events, and a check on every tick — and none of them is
 * trusted alone.
 *
 * The rule that matters: if we were away across a block boundary, we ask.
 * Silently banking a 45-minute block the user spent at lunch would make the
 * history worthless, and the history is the point.
 */

import { useEffect, useRef } from 'react'

import { AWAY_THRESHOLD_MS, useSession } from '@/store/session'
import { useNow } from './useNow'

export function useReconciliation(): void {
  const now = useNow()
  const dispatch = useSession((s) => s.dispatch)
  const checkDayRollover = useSession((s) => s.checkDayRollover)
  const active = useSession((s) => s.session.active)
  const phase = useSession((s) => s.phase)

  // Guards against firing the same transition repeatedly while a dialog waits
  // for the user, which would otherwise re-fire on every single tick.
  const elapsedFor = useRef<string | null>(null)
  const seenAt = useRef(now)

  useEffect(() => {
    const previous = seenAt.current
    seenAt.current = now

    checkDayRollover(now)
    if (!active) return

    const gap = now - previous
    const clockJumpedBackwards = gap < 0

    // Well past the end of a segment we have not yet noticed elapsing. We
    // cannot have been watching — had we been, the boundary would have been
    // caught within a tick of it. This is the reload case: a fresh mount has
    // no previous tick to compare against, so the gap above is zero and only
    // the overdue segment gives the absence away.
    const overdueUnnoticed =
      elapsedFor.current !== active.id && now - active.endsAt > AWAY_THRESHOLD_MS

    // Either we were genuinely gone, or the clock moved under us (an NTP
    // correction, a timezone change, a manual adjustment). Both mean the
    // elapsed time we would have inferred is not trustworthy.
    const wasAway = gap > AWAY_THRESHOLD_MS || clockJumpedBackwards || overdueUnnoticed

    if (wasAway && now > active.endsAt && phase.name !== 'reconciling') {
      // `previous` is the last tick we actually served; `getLastTickAt()` was
      // already refreshed by the tick that woke this effect, so it would
      // report the gap as zero.
      dispatch({ type: 'awayDetected', at: now, lastSeenAt: previous })
      return
    }

    // The ordinary path: the timer reached zero while we were watching.
    if (now >= active.endsAt && elapsedFor.current !== active.id) {
      elapsedFor.current = active.id
      dispatch({ type: 'timerElapsed', at: active.endsAt })
    }
  }, [now, active, phase.name, dispatch, checkDayRollover])

  // Belt and braces: an armed timeout catches the boundary even if the tick
  // interval is being throttled. Whichever fires first wins; the guard above
  // makes the second one a no-op.
  useEffect(() => {
    if (!active) return
    const delay = active.endsAt - Date.now()
    if (delay <= 0) return

    const id = setTimeout(() => {
      if (elapsedFor.current === active.id) return
      elapsedFor.current = active.id
      useSession.getState().dispatch({ type: 'timerElapsed', at: active.endsAt })
    }, delay)

    return () => clearTimeout(id)
  }, [active])
}
