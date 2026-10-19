/**
 * One entry of the day, drawn on the calendar's axis.
 *
 * Every kind of entry is this one component, in the tone `style.ts` gives it:
 * a block run or planned, a break taken or pinned, a commitment and the time
 * either side of it. What differs is what it offers. A commitment and a break
 * open a form and come off the day (`editorFor`), and can be picked up and
 * dragged (`useCalendarDrag`, which hands each block its `Drag`): a pin as the
 * plan, a break taken as the record, put right. A block is neither, and what
 * is running belongs to the stage until it ends. A pin whose time has passed
 * also asks whether it was taken (`onMarkTaken`).
 *
 * Its controls do not depend on its height. A block tall enough for its words
 * carries them in its label row; one shorter carries them on a small card
 * beside it, outside the box that clips its text, so a ten-minute break can
 * still be confirmed, opened and removed — from the keyboard and a touch
 * screen too, where there is no drag to fall back on.
 */

import { type PointerEvent as ReactPointerEvent } from 'react'

import type { EntryComposer } from './SegmentEditor'
import { MARK_LANE_PX, Marks, countsOf, writtenIn, writtenWithin } from './BlockMarks'
import { GUTTER_PX, type Placed } from './geometry'
import { styleFor } from './style'
import type { Drag } from './useCalendarDrag'
import { useBlockTasks } from '../BlockTasks'
import { EditGlyph } from '../ui'
import { formatClock, formatDuration } from '@/domain/time'
import type { Ms, TimelineEntry } from '@/domain/types'

/** Below this height a block cannot fit a legible label, so it renders bare. */
const LABEL_MIN_PX = 22

/**
 * From this height a block has room for a line under its label. Below it the
 * label is its only line, and is centred in it rather than set from the top:
 * a quarter of an hour is 24 pixels, and the padding that suits a tall block
 * pushed a lone label against the bottom edge and clipped it there.
 */
const DETAIL_MIN_PX = 44

/**
 * How a block's controls appear in its label row: when the pointer is over
 * the block or the focus is in it, and always under a coarse pointer, which
 * has no hover — the rule rows of tasks keep (`revealOnHover`). Faded rather
 * than removed, so each is still there to be tabbed to. Inside the block, they
 * cannot reach a neighbour's; a short block's card can, and is revealed one
 * entry at a time instead (see beside it).
 */
const REVEAL =
  'opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100'

export function Block({
  item,
  now,
  editing,
  onEdit,
  onRemoveBreak,
  onRemoveCommitment,
  onMarkTaken,
  drag,
}: {
  item: Placed
  now: Ms
  /** What the open composer is editing, so this can say if it is this. */
  editing: string | null
  onEdit: (next: EntryComposer) => void
  onRemoveBreak: (id: string) => void
  onRemoveCommitment: (id: string) => void
  /** Puts a passed pin on the record as taken, or null when it does not ask. */
  onMarkTaken: (() => void) | null
  /** Whether it can be picked up, and where a drag in the air puts it. */
  drag: Drag
}) {
  const { entry, top, height, shown, lane, lanes } = item
  const style = styleFor(entry)
  const isPast = entry.endsAt <= now
  const isActive = entry.kind === 'active'
  const showLabel = height >= LABEL_MIN_PX
  const oneLine = showLabel && height < DETAIL_MIN_PX
  const editor = editorFor(entry)
  const isEditing = editor !== null && editor.editing === editing
  // The block's counts are the whole block's; its marks are only those on
  // the part of it this day draws.
  const written = writtenIn(entry)
  const drawn =
    written && writtenWithin(written, { start: entry.startsAt, end: entry.endsAt }, shown)
  const tasks = useBlockTasks(
    (entry.kind === 'past' || entry.kind === 'active') && entry.segment.kind === 'block'
      ? entry.segment.taskIds
      : [],
  )
  const drawnHeight = Math.max(height, 4)
  const { onGrab, leaving } = drag
  const moved = drag.lifted || drag.at !== null

  // Over or not: a commitment or a break that never happened comes off the
  // record as readily as one still ahead, and so does a break taken by
  // mistake. A pin's id and a taken break's are both a break's to the log.
  const remove =
    entry.kind === 'planned-break'
      ? () => onRemoveBreak(entry.id)
      : entry.kind === 'past' && entry.segment.kind === 'break'
        ? () => onRemoveBreak(entry.segment.id)
        : entry.kind === 'commitment'
          ? () => onRemoveCommitment(entry.commitment.id)
          : null

  /*
    Named controls rather than a click anywhere on the block. The block is a
    drawing of a span of the day, and the day is a thing you point at while
    you think — a bare surface that silently means "open a form" is the kind
    of affordance you discover by accident. Hidden until the pointer or the
    keyboard arrives (`REVEAL`), so the axis stays a picture of the day at
    rest; `focus-within` is what keeps them reachable without a mouse.
  */
  const controls = (editor !== null || remove !== null || onMarkTaken !== null) && (
    <span className="flex items-baseline gap-1">
      {onMarkTaken !== null && (
        <button
          type="button"
          onClick={onMarkTaken}
          aria-label={`Mark ${style.label} as taken`}
          title="Took it"
          className="text-muted transition hover:text-rest"
        >
          ✓
        </button>
      )}
      {editor !== null && (
        <button
          type="button"
          onClick={() => onEdit(editor)}
          aria-label={`Edit ${style.label}`}
          className="text-muted transition hover:text-bright"
        >
          <EditGlyph />
        </button>
      )}
      {remove !== null && (
        <button
          type="button"
          onClick={remove}
          // Removing one day of a series skips that day, and says so: the
          // series itself is on the routine page.
          aria-label={
            entry.kind === 'commitment' && entry.commitment.recurringId !== undefined
              ? `Skip ${style.label} today`
              : `Remove ${style.label}`
          }
          className="text-muted transition hover:text-commit"
        >
          ×
        </button>
      )}
    </span>
  )

  const width = `calc((100% - ${GUTTER_PX}px) / ${lanes} - 4px)`
  const left = `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${lane} / ${lanes})`

  // Two boxes rather than one. The block clips its own text to its own height,
  // which is what sizes its list of tasks to a short block; the marks and a
  // log's card sit on its edges and have to be drawn outside it, so they
  // belong to a wrapper that does not clip. The wrapper keeps the marks'
  // layers to itself (`isolate`), and rises above its neighbours while the
  // pointer or focus is in it or a card in it is open for an edit, so an open
  // card is not drawn under the next block down. Dimming a past block is the
  // inner box's alone, or the card would be dimmed with it.
  return (
    <div
      // Focusable, though never a Tab stop, so a tap on a touch screen lands
      // focus here and shows this entry's controls and no other's.
      {...(controls && { tabIndex: -1 })}
      className={[
        'group absolute isolate outline-none hover:z-30 focus-within:z-30 [&:has([data-open])]:z-30',
        // A commitment's tint is translucent, and on its way it passes over
        // blocks the plan has not moved out of its path yet — those move when
        // it lands — so it carries the column's own surface under it.
        moved ? 'z-30 rounded-md bg-surface' : isActive || isEditing ? 'z-10' : '',
      ].join(' ')}
      style={{ top, height: drawnHeight, width, left }}
    >
      <div
        // The primary button of a mouse or pen, on the block rather than on
        // one of its controls: a press on ✎ or × is that control's.
        {...(onGrab && {
          onPointerDown: (event: ReactPointerEvent) => {
            if (event.button !== 0 || event.pointerType === 'touch') return
            if (event.target instanceof Element && event.target.closest('button')) return
            onGrab(event)
          },
        })}
        className={[
          'h-full overflow-hidden rounded-md border pl-2',
          oneLine ? 'flex flex-col justify-center' : 'py-1',
          // No transition while it follows the pointer, or it trails behind.
          drag.lifted ? 'cursor-grabbing shadow-lg' : moved ? '' : 'transition',
          onGrab && !drag.lifted ? 'cursor-grab select-none' : '',
          style.border,
          style.bg,
          // At full strength while in the air, wherever it is carried.
          isPast && !isActive && !drag.lifted ? 'opacity-40' : '',
          leaving ? 'opacity-30' : '',
          isActive ? 'ring-1 ring-inset ' + style.ring : '',
          isEditing ? 'ring-1 ring-inset ring-bright/70' : '',
        ].join(' ')}
        // Its words stop short of the column of marks down its right edge.
        style={{ paddingRight: drawn ? MARK_LANE_PX : 8 }}
        title={`${style.label} · ${formatClock(entry.startsAt)} · ${formatDuration(
          entry.endsAt - entry.startsAt,
        )}${written ? ` · ${countsOf(written, ' · ')}` : ''}`}
      >
        {showLabel ? (
          <>
            <div className="flex items-baseline justify-between gap-1.5">
              <span className={`truncate text-xs font-medium ${style.text}`}>
                {style.label}
              </span>
              {controls && <span className={`shrink-0 ${REVEAL}`}>{controls}</span>}
            </div>
            {height >= DETAIL_MIN_PX && style.detail && (
              <div className="truncate text-[11px] text-muted italic">{style.detail}</div>
            )}
            {/* A block's tasks take the duration's place, since the block's
                height already says how long it was. However many there are,
                the box clips them at its own height — that is what sizes them
                to the block. Its logs are not printed here: each is a mark on
                its edge, there in full under the pointer. */}
            {height >= DETAIL_MIN_PX && tasks.length > 0
              ? tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`truncate text-[11px] ${task.status === 'done' ? 'text-muted line-through' : 'text-body/80'}`}
                  >
                    {task.title}
                  </div>
                ))
              : height >= 60 && (
                  <div className="tnum mt-0.5 text-[11px] text-muted">
                    {formatDuration(entry.endsAt - entry.startsAt)}
                  </div>
                )}
          </>
        ) : (
          <span className="sr-only">{style.label}</span>
        )}
        {written && <span className="sr-only">{countsOf(written, ', ')}</span>}
      </div>

      {/* Too short to carry its words, it still carries its controls: beside
          it, on a raised card of their own that the block does not clip. A
          ten-minute break is an ordinary break, and without these its ✓, form
          and × were nowhere — and a drag is no answer from the keyboard or a
          touch screen.

          The card is taller than the block, so it reaches over its
          neighbours, and two short entries side by side would put one's
          buttons on the other's. So it is one entry's at a time: shown, and
          taking the pointer at all, only while this entry is pointed at or
          has the focus — on a touch screen, once it is tapped (the wrapper is
          focusable for that). Hidden, it is not there to be hit; shown, it
          rises with its entry above the rest. A press on the card around its
          buttons is a press on the block, and picks it up. */}
      {controls && !showLabel && (
        <span
          className={`pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded-md border border-line bg-surface-raised px-1.5 py-0.5 text-xs leading-none opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 group-hover:[&_button]:pointer-events-auto group-focus-within:[&_button]:pointer-events-auto`}
        >
          {controls}
        </span>
      )}

      {drawn && (
        <Marks
          written={drawn}
          span={shown}
          length={drawnHeight}
          axis="column"
          tone={style.mark ?? 'bg-muted'}
          dim={isPast && !isActive}
        />
      )}
    </div>
  )
}

/**
 * The editor this entry opens, or null if it does not open one.
 *
 * Only the two things the user put on the day by hand. Everything else here is
 * derived — the way to move a focus block is to change the hours or the
 * commitments it was planned around, and offering to edit one directly would be
 * offering to edit the output of a pure function.
 *
 * A commitment's margins are part of the commitment rather than entries in
 * their own right, so the travel either side opens the same form. Either
 * keeps its form once it is over, as it stays draggable and removable: the
 * calendar is also the record of how the day went, and a meeting planned for
 * three that ran at two, or a walk that never happened, is put right after the
 * fact.
 */
function editorFor(entry: TimelineEntry): EntryComposer | null {
  switch (entry.kind) {
    case 'planned-break':
      return { kind: 'break', editing: entry.id }
    case 'past':
      return entry.segment.kind === 'break' ? { kind: 'break', editing: entry.segment.id } : null
    case 'commitment':
    case 'commitment-margin':
      return { kind: 'commitment', editing: entry.commitment.id }
    default:
      return null
  }
}
