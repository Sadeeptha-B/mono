/**
 * The one line the cat gets to say.
 *
 * Derived from the numbers rather than drawn from a bag of phrases. A pool of
 * cheerful variations would have needed a seed to stop it churning on every
 * tick, and it would have been the one part of Mono that talks for the sake of
 * talking. Everything else here states a fact and stops — "costs you 1 block
 * and 15 focus minutes" — so this does too.
 *
 * It only speaks at the seams. During a block, while a purpose is being named,
 * and while Mono has no idea where you went, it says nothing: there is either
 * something else on the stage asking you a question, or a block to protect.
 *
 * What it says is also the one thing the rest of the screen does not already
 * show. The stage footer counts what is still *ahead* of you; this counts what
 * is behind.
 */

import { formatDuration } from '@/domain/time'
import type { Vitals } from '@/domain/vitals'
import type { MoodName } from './cat'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function utteranceFor(mood: MoodName, vitals: Vitals): string | null {
  const { blocksToday, focusMinutesToday, streak } = vitals

  switch (mood) {
    case 'idle':
      if (blocksToday === 0) return 'Nothing banked yet today.'
      return `${plural(blocksToday, 'block')} banked · ${formatDuration(focusMinutesToday * 60_000)}`

    case 'complete':
      // The block just landed, so it is already in the history these numbers
      // come from. A run is the more interesting fact when there is one.
      if (streak >= 2) return `${streak} in a row.`
      return blocksToday === 1 ? 'First one today.' : `That makes ${blocksToday} today.`

    case 'resting':
      if (blocksToday === 0) return null
      return `${plural(blocksToday, 'block')} behind you.`

    // Naming a purpose, working, thinking, or asleep. All four have something
    // better on the stage than a remark from the cat.
    case 'defining':
    case 'focusing':
    case 'reflecting':
    case 'away':
      return null
  }
}
