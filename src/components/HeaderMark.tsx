/**
 * The cat and the name in the top-left of every header, and the way back to
 * the day from the pages that are not it.
 *
 * It replaced a `Back to today` button on the guide and the tasks page, which
 * took a slot in a header already holding the timer strip, the room, the
 * pop-out, both page links and Settings. The mark in the corner going home is
 * the convention people already reach for, so the button was the second way
 * of saying something the corner said anyway. Its accessible name keeps the
 * words "back to today", and a tooltip says them on hover, because a cat is
 * not self-evidently a link.
 *
 * On the day itself it is only the mark. A link there would go nowhere, and
 * would be one more stop for the keyboard on the way to the timer.
 *
 * The cat is the live phase, not a fixed idle one: on the other pages the
 * header keeps the timer in sight, and a cat sitting up politely beside a strip
 * that says "Focusing 12:34" would be the same creature saying something else.
 */

import { PixelCat } from './Companion/PixelCat'
import { DAY_HASH } from '@/hooks/useRoute'
import type { Phase } from '@/domain/machine'

export function HeaderMark({ phase, home }: { phase: Phase; home: boolean }) {
  const mark = (
    <>
      <PixelCat phase={phase} progress={null} variant="mark" className="h-7 w-11" decorative />
      {/* The word gives way on a phone, where the cat says it alone and the
          header has room for its places and tools on one row. */}
      <span className="hidden text-sm font-medium tracking-widest text-body uppercase sm:inline">
        Mono
      </span>
    </>
  )

  if (home) return <div className="flex items-center gap-2.5">{mark}</div>

  return (
    <a
      href={DAY_HASH}
      aria-label="Mono — back to today"
      title="Back to today"
      className="-m-1 flex items-center gap-2.5 rounded-lg p-1 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bright"
    >
      {mark}
    </a>
  )
}
