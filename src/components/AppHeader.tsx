/**
 * The header every view draws: where you are on the left, tools on the right.
 *
 * It used to be one row of labelled buttons — Room, Pop out, Tasks, Recurring,
 * Guide, Settings — in which places you go and things you do looked the same,
 * and which wrapped to two rows on a phone. Sorting them by what they are is
 * what made it small again:
 *
 *  - **Places** are the views work moves between — Today, Tasks and
 *    Timeline — as a switch beside the mark. Only those. The routine is a
 *    page, but one you set up and come back from rather than work in, so it
 *    is a tool, drawn as the repeat mark every day's series carries.
 *  - **Tools** are icons: Later, the room (its own swatch), the pop-out, the
 *    routine and settings. Each keeps its name as its accessible name and shows
 *    it on hover, so nothing has become harder to find by name, only smaller.
 *    Later comes first, nearest what you are doing, because it is the one
 *    reached for in the middle of something else.
 *
 * The guide is not here. It is read once while learning Mono and rarely
 * after, so a permanent place on every page was more than it earned; Settings
 * links to it, as the place someone looking for help already opens.
 * The routine took its place: the usual hours and the recurring commitments
 * are a thing you go looking for when your week changes, and the links beside
 * the day's questions (`RoutineLink`) only appear while one of them is open.
 *
 * Two things stay as words because they are rare and matter when they appear:
 * `Not saving`, and the running timer a page other than the day carries
 * (`status`, a `HeaderStatus`). The day draws its timer on the stage instead.
 *
 * One component rather than a copy per page, because the copies were already
 * drifting: each page had grown its own idea of which controls came first.
 */

import { useLayoutEffect, useRef, type ReactNode } from 'react'

import { HeaderMark } from './HeaderMark'
import { LaterMenu } from './LaterMenu'
import { StorageWarning } from './StorageWarning'
import { RepeatIcon, SettingsIcon } from './icons'
import { headerIconClass } from './ui'
import { RoomMenu } from '@/ambient/RoomMenu'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { DAY_HASH, ROUTINE_HASH, TASKS_HASH, TIMELINE_HASH, type Route } from '@/hooks/useRoute'
import type { Phase } from '@/domain/machine'

/**
 * How wide every view is, its bar and what is under it: the day's two
 * columns' measure. Each view lays its content out to this, with the same
 * gutters inside it as the bar (`px-4 sm:px-6`), so every page shares one
 * left edge and one right edge, and moving between them moves nothing but
 * what is on the page.
 */
export const APP_WIDTH = 'max-w-6xl'

/**
 * The bar every view draws its header in: one width and one height, whatever
 * the view below is doing. No rule beneath it: the page's own space sets the
 * content apart, and a line drawn across every view was one more thing on
 * screen that said nothing. Where it sticks over a scrolling page it is the
 * page's own background, so what scrolls under it disappears cleanly.
 *
 * Each view used to draw its own — the day inside its two columns' measure,
 * the guide, routine and timeline at theirs, the tasks page as wide as its
 * board — so moving between them slid the mark, the places and the tools
 * sideways, and a little up or down, on every switch: the one thing on screen
 * that should not move, since it is what was just pressed. Now every view is
 * one width (`APP_WIDTH`), bar and page alike.
 *
 * Pinned with the view on a wide screen, where the view scrolls inside itself.
 * On a narrow one a page's bar sticks to the top as the document scrolls,
 * because it carries the timer and reading or filing should not quietly cost
 * you the block you are in; the day's does not (`sticky` false), since its
 * timer is on the stage, and on a phone the bar is two rows tall.
 *
 * A bar stuck over the document covers the top of it, so the document is
 * told how much (`scroll-padding-top`) and keeps everything it scrolls to
 * itself clear of the bar: a guide section jumped to from the contents, a
 * control the keyboard tabs to. Measured rather than written down, because
 * the bar's height is not one number — a phone's second row of places, a
 * running block's timer in the tools, `Not saving` beside it, any of which
 * can wrap. A fixed margin under it was right until the places took a row
 * of their own, and then a section jumped to during a block came to rest
 * with its heading under the bar.
 */
export function AppBar({
  sticky = true,
  ...header
}: Parameters<typeof AppHeader>[0] & { sticky?: boolean }) {
  const bar = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = bar.current
    if (!sticky || !el) return
    // From `lg` up the bar is static and the view scrolls inside itself,
    // leaving the document nothing to scroll, so this then does nothing.
    const root = el.ownerDocument.documentElement
    const keepClear = () => {
      root.style.scrollPaddingTop = `${el.offsetHeight}px`
    }
    keepClear()
    const observer = new ResizeObserver(keepClear)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingTop = ''
    }
  }, [sticky])

  return (
    <header
      ref={bar}
      className={`shrink-0 bg-ink ${
        sticky ? 'sticky top-0 z-20 lg:static' : ''
      }`}
    >
      {/* The gutters inside the measure, as every view's content has them. */}
      <div className={`mx-auto ${APP_WIDTH} px-4 py-3 sm:px-6`}>
        <AppHeader {...header} />
      </div>
    </header>
  )
}

export function AppHeader({
  current,
  phase,
  mini,
  onOpenSettings,
  status,
}: {
  current: Route
  phase: Phase
  mini: MiniWindowControls
  onOpenSettings: () => void
  /** What the timer would be saying, on a page that hides it. */
  status?: ReactNode
}) {
  return (
    // One row from `sm` up. Below it the places take a row of their own, as a
    // strip of tabs the width of the screen, under the mark and the tools:
    // three places, the mark and five tools ask for some 420 pixels, and a
    // phone has 358 between its gutters. A second row chosen and laid out is
    // not the wrap this header was rebuilt to end, where places and tools fell
    // wherever the line broke. The wrapper around the mark and the places is
    // `contents` there, so the two are placed on the grid one by one.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:flex sm:flex-wrap sm:justify-between sm:gap-x-4">
      <div className="contents sm:flex sm:items-center sm:gap-5">
        <HeaderMark phase={phase} home={current === 'day'} />
        {/* Real links, so either opens in its own tab and survives a reload,
            and the one you are on says so rather than disappearing — the row
            reads the same from every page. */}
        <nav
          aria-label="Pages"
          className="col-span-2 row-start-2 flex rounded-lg border border-muted/70 p-0.5 sm:col-auto sm:row-auto"
        >
          <Place href={DAY_HASH} here={current === 'day'}>
            Today
          </Place>
          <Place href={TASKS_HASH} here={current === 'tasks'}>
            Tasks
          </Place>
          <Place href={TIMELINE_HASH} here={current === 'timeline'}>
            Timeline
          </Place>
        </nav>
      </div>

      {/* Level with the mark on a phone, at the right of the first row; on the
          right of the one row above that. */}
      <div className="col-start-2 row-start-1 ml-auto flex flex-wrap items-center justify-end gap-0.5 sm:gap-1">
        {/* Nothing at all unless the browser has started refusing to save,
            which is the one failure worth a permanent place on screen. */}
        <StorageWarning onOpenSettings={onOpenSettings} />
        {status}
        <LaterMenu idPrefix={`${current}-header`} />
        <RoomMenu idPrefix={`${current}-header`} />
        <PopOutButton mini={mini} />
        <a
          href={ROUTINE_HASH}
          aria-label="Routine"
          title="Routine"
          {...(current === 'routine' ? { 'aria-current': 'page' as const } : {})}
          className={`${headerIconClass} ${current === 'routine' ? 'bg-surface-raised text-bright' : ''}`}
        >
          <RepeatIcon className="size-4" />
        </a>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className={headerIconClass}
        >
          <SettingsIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

function Place({ href, here, children }: { href: string; here: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      {...(here ? { 'aria-current': 'page' as const } : {})}
      // Sharing the strip's width on a phone, where it is a row of its own.
      className={`flex-1 rounded-md px-3 py-1 text-center text-xs transition sm:flex-none ${
        here ? 'bg-surface-raised text-bright' : 'text-muted hover:text-bright'
      }`}
    >
      {children}
    </a>
  )
}
