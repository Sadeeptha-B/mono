/**
 * The resting state: nothing is running, and Mono is offering the next block.
 *
 * The day's opening questions used to live here too, gated on there being no
 * commitments yet. They are their own panel now (`DaySetupPanel`), for two
 * reasons: they ask about hours as well, and "no commitments" was never a
 * usable stand-in for "not asked yet" — a day with nothing fixed in it answered
 * the question by having nothing to say, and got asked forever.
 */

import { GhostButton, PrimaryButton, StagePrompt } from '../ui'
import { PixelCat } from '../Companion/PixelCat'
import { markTierFor } from '../Companion/cat'
import { formatClock, formatDuration } from '@/domain/time'
import type { BlockKind, Ms, RoomId } from '@/domain/types'
import { dayProgressLabel, type DayProgress } from '@/domain/dayProgress'

export function ReadyPanel({
  nextBlockKind,
  minutes,
  onStart,
}: {
  nextBlockKind: BlockKind | null
  minutes: number
  onStart: (kind: BlockKind) => void
}) {
  if (!nextBlockKind) {
    return (
      <div className="max-w-md">
        <StagePrompt
          eyebrow="Nothing running"
          title="No more blocks fit"
          detail="There isn't enough time before your next commitment to start another block."
        />
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Nothing running"
        title={`Ready for ${minutes} minutes`}
        detail={`Your next ${nextBlockKind === 'deep' ? 'deep' : 'short'} block is up.`}
      />
      <PrimaryButton type="button" onClick={() => onStart(nextBlockKind)}>
        Start {nextBlockKind === 'deep' ? 'deep' : 'short'} block
      </PrimaryButton>
    </div>
  )
}

/**
 * The current moment falls outside every work region.
 *
 * This is the honest answer to "why is nothing planned": you said this time
 * was not for working. The calendar beside it still shows what is coming, and
 * the escape hatch changes the declared shape rather than quietly ignoring it —
 * so working now means saying so.
 *
 * That escape hatch opens the calendar's own hours editor, in place, rather
 * than a dialog over the top of it. The thing you are about to change is drawn
 * beside this panel; covering it up to ask about it was always backwards.
 */
export function OutsideHoursPanel({
  now,
  nextStart,
  hasRegions,
  dayDone,
  onEditHours,
  progress,
  roomId,
}: {
  now: Ms
  /** When the next region opens, or null if the day is done. */
  nextStart: Ms | null
  hasRegions: boolean
  dayDone: boolean
  onEditHours: () => void
  progress: DayProgress
  roomId: RoomId
}) {
  if (dayDone) {
    return (
      <div className="max-w-lg">
        <StagePrompt eyebrow="Outside working hours" title="Day done" />
        <div className="rounded-xl border border-line bg-surface-raised/45 p-4">
          <div>
            <p className="text-2xl font-light text-bright">
              {progress.blocks === 0
                ? 'Nothing banked today'
                : `${formatDuration(progress.focusMinutes * 60_000)} focused`}
            </p>
            {progress.blocks > 0 && (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {progress.blocks} block{progress.blocks === 1 ? '' : 's'} ·{' '}
                {progress.deepBlocks} deep · {progress.shortBlocks} short
                {progress.breaks > 0 &&
                  ` · ${progress.breaks} break${progress.breaks === 1 ? '' : 's'} (${formatDuration(progress.breakMinutes * 60_000)})`}
              </p>
            )}
          </div>
          <PixelCat
            phase={{ name: 'idle' }}
            progress={null}
            roomId={roomId}
            sceneTier={progress.sceneTier}
            trail={progress.trail}
            tier={markTierFor(progress.blocks)}
            progressLabel={dayProgressLabel(progress)}
            className="mx-auto mt-3 h-24 w-48 sm:h-28 sm:w-56"
          />
          {progress.longestBlock && (
            <p className="mt-3 border-t border-line pt-3 text-sm text-body">
              Longest block:{' '}
              <span className="text-bright">{progress.longestBlock.purpose}</span>
              <span className="text-muted">
                {' '}· {formatDuration(progress.longestBlock.minutes * 60_000)}
              </span>
            </p>
          )}
        </div>
        <GhostButton type="button" onClick={onEditHours} className="mt-4">
          Change today's hours
        </GhostButton>
      </div>
    )
  }

  const detail = !hasRegions
    ? "You haven't set any working hours for today."
    : nextStart === null
      ? "That's the end of your working hours. The plan picks up tomorrow."
      : `Nothing scheduled until ${formatClock(nextStart)}.`

  return (
    <div className="max-w-md">
      <StagePrompt
        eyebrow="Outside working hours"
        title={
          nextStart === null ? 'Day done' : `Back in ${formatDuration(nextStart - now)}`
        }
        detail={detail}
      />
      <GhostButton type="button" onClick={onEditHours}>
        {hasRegions ? "Change today's hours" : 'Set working hours'}
      </GhostButton>
    </div>
  )
}
