/**
 * The header every view draws: where you are on the left, tools on the right.
 *
 * It used to be one row of labelled buttons — Room, Pop out, Tasks, Recurring,
 * Guide, Settings — in which places you go and things you do looked the same,
 * and which wrapped to two rows on a phone. Sorting them by what they are is
 * what made it small again:
 *
 *  - **Places** are the two views a day moves between, Today and Tasks, as a
 *    switch beside the mark. Only those two. The routine is set up once and
 *    revisited rarely, so it is reached from where it is relevant — Settings,
 *    and the opening questions about hours and commitments — rather than from
 *    a permanent tab. The guide is read rather than worked in, so it is a tool.
 *  - **Tools** are icons: the room (its own swatch), the pop-out, the guide and
 *    settings. Each keeps its old name as its accessible name and shows it on
 *    hover, so nothing has become harder to find by name, only smaller.
 *
 * Two things stay as words because they are rare and matter when they appear:
 * `Not saving`, and the running timer a page other than the day carries
 * (`status`, a `HeaderStatus`). The day draws its timer on the stage instead.
 *
 * One component rather than four copies, because the four copies were already
 * drifting: each page had grown its own idea of which controls came first.
 */

import type { ReactNode } from 'react'

import { HeaderMark } from './HeaderMark'
import { StorageWarning } from './StorageWarning'
import { GuideIcon, SettingsIcon } from './icons'
import { headerIconClass } from './ui'
import { RoomMenu } from '@/ambient/RoomMenu'
import { PopOutButton } from '@/pip/PopOutButton'
import type { MiniWindowControls } from '@/pip/useMiniWindow'
import { DAY_HASH, GUIDE_HASH, TASKS_HASH, type Route } from '@/hooks/useRoute'
import type { Phase } from '@/domain/machine'

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
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-center gap-3 sm:gap-5">
        <HeaderMark phase={phase} home={current === 'day'} />
        {/* Real links, so either opens in its own tab and survives a reload,
            and the one you are on says so rather than disappearing — the row
            reads the same from every page. */}
        <nav aria-label="Pages" className="flex rounded-lg border border-muted/70 p-0.5">
          <Place href={DAY_HASH} here={current === 'day'}>
            Today
          </Place>
          <Place href={TASKS_HASH} here={current === 'tasks'}>
            Tasks
          </Place>
        </nav>
      </div>

      {/* `ml-auto` keeps the tools on the right when a narrow screen wraps
          them under the places. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {/* Nothing at all unless the browser has started refusing to save,
            which is the one failure worth a permanent place on screen. */}
        <StorageWarning onOpenSettings={onOpenSettings} />
        {status}
        <RoomMenu idPrefix={`${current}-header`} />
        <PopOutButton mini={mini} />
        <a
          href={GUIDE_HASH}
          aria-label="Guide"
          title="Guide"
          {...(current === 'guide' ? { 'aria-current': 'page' as const } : {})}
          className={`${headerIconClass} ${current === 'guide' ? 'bg-surface-raised text-bright' : ''}`}
        >
          <GuideIcon className="size-4" />
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
      className={`rounded-md px-3 py-1 text-xs transition ${
        here ? 'bg-surface-raised text-bright' : 'text-muted hover:text-bright'
      }`}
    >
      {children}
    </a>
  )
}
