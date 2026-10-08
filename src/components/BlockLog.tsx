/**
 * What gets written into a running block: lines about how it is going, and a
 * count of the urges to leave it — and, from the same place, a line put down
 * for later, which is about something else and is not kept on the block.
 *
 * Here rather than in the stage, for `BlockTasks`'s reason: the stage, the mini
 * window and the calendar all show these, and one set of components is how
 * they cannot disagree about what writing one means. Each reads the session
 * store itself — the running block, and the actions that write into it — so a
 * host only says where they go.
 *
 * **The counter is noticing, not a score.** It says how many, never whether
 * that is good, and nothing else in Mono reads it — not the cat, not the room,
 * not the postcard. A number something else rewarded you for keeping low would
 * be a reason not to count honestly, and counting honestly is the whole of
 * what it is for. Only the last urge can be taken back, because a mis-tap is
 * noticed the moment it happens.
 *
 * **Logs can be corrected afterwards.** A mistype is often only seen later, on
 * the calendar, so a log's row edits and deletes it wherever it is drawn, in
 * the running block or one long finished. An edit keeps the minute the log
 * was written.
 *
 * Nothing here takes focus by itself. In the mini window a focused control can
 * raise that window over whatever the user went back to, and the tab may have
 * a field of its own in use.
 */

import { Fragment, useCallback, useState, type ReactNode } from 'react'

import { DeleteIcon, MinusIcon, PlusIcon } from './icons'
import { keepForLater, useKeptInBlock } from './Later'
import {
  EditGlyph,
  GhostButton,
  IconButton,
  LineField,
  RenameField,
  SectionHeading,
  revealOnHover,
} from './ui'
import { LATER_MAX_LENGTH } from '@/domain/later'
import { formatClock } from '@/domain/time'
import type { BlockLog } from '@/domain/types'
import { useSession } from '@/store/session'

/** A log is a sentence or two about the block; long enough for that, no more. */
export const LOG_MAX_LENGTH = 500

/** The running block, or null while none is. */
const useRunningBlock = () =>
  useSession((s) => (s.session.active?.kind === 'block' ? s.session.active : null))

/**
 * `URGES  − 3 +`: a tally, drawn as one.
 *
 * An urge is a moment the task pulled the other way — the tab nearly opened,
 * the phone nearly picked up — counted whether or not it was followed. Not
 * "distraction", which names the thing that won. "Diversion" and "stray" were
 * both tried and given back for the plainer word.
 *
 * It sits in a row of buttons and was first drawn as another of them, `Urge ·
 * 3`, which read as an action with a number on it rather than a number you
 * can add to. So the number is the thing, unboxed, with its label beside it
 * and two small matching steppers either side on one centre line — a plain
 * `−` and `+`, so the pair reads as one control. `+1` was tried and looked
 * like a different kind of thing from the `−` beside it, and both are drawn
 * rather than typed so they match. The step down takes back only the last, for
 * a mis-tap.
 *
 * The count is the length of the block's list of instants, read from the
 * store on every render — never a number this component keeps and adds to.
 */
export function UrgeCounter() {
  const block = useRunningBlock()
  const countUrge = useSession((s) => s.countUrge)
  const takeBackUrge = useSession((s) => s.takeBackUrge)
  if (!block) return null

  const count = block.urges.length
  const step =
    'grid size-6 shrink-0 place-items-center rounded-full border border-muted/70 leading-none text-body transition hover:bg-surface-raised hover:text-bright disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div role="group" aria-label="Urges" className="inline-flex items-center gap-1.5 px-1">
      <span className="text-[10px] font-medium tracking-widest text-muted uppercase">Urges</span>
      <button
        type="button"
        onClick={takeBackUrge}
        disabled={count === 0}
        aria-label="Take back the last urge"
        title="Take back the last urge"
        className={step}
      >
        <MinusIcon className="size-3" />
      </button>
      <span
        aria-live="polite"
        className="tnum min-w-[2ch] text-center text-base leading-none text-bright"
      >
        {count}
      </span>
      <button
        type="button"
        onClick={countUrge}
        aria-label="Count an urge"
        title="Count an urge to leave the task"
        className={step}
      >
        <PlusIcon className="size-3" />
      </button>
    </div>
  )
}

/**
 * The mini window's row while a block runs: the log and Later to the left, the
 * urges to the right, and whatever the window puts after them — the sound. The
 * stage lays the same out apart, the openers under the block's tasks and the
 * urges under its logs, level with each other; this window has one row to give
 * them. End early is on neither: both put it out of the way, as a quiet word.
 */
export function BlockControls({ after }: { after?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <BlockComposer compact />
      </div>
      <UrgeCounter />
      {after}
    </div>
  )
}

/**
 * `✎ Log` and `⤴ Later`, and the field either opens in their place.
 *
 * Two things a line written during a block can be. A log is about this block
 * and stays on it; Later is about anything else and goes to the tasks page to
 * be dealt with (`Later.tsx`). The choice is made by which is pressed, before
 * a word is written, because it is a different question each time — how is
 * this going, or what is this pulling me towards — and a field that asked
 * afterwards would be asking it at the moment the line was meant to be let go.
 *
 * Closed until asked for. Always open, a field read as something the block was
 * waiting for, and in the mini window it was most of what there was to look
 * at. Opening in place means neither surface grows; it closes again once the
 * line is kept or let go.
 *
 * Whether it is open is held here, by a component that lives exactly as long
 * as the block's controls do, so the next block starts with it closed. Beside
 * the openers it says how many lines the block has put down for later, since
 * those are listed nowhere on it; compact is the mini window's, which also
 * says how many logs there are, since it lists none.
 */
export function BlockComposer({ compact = false }: { compact?: boolean }) {
  const block = useRunningBlock()
  const logBlock = useSession((s) => s.logBlock)
  const kept = useKeptInBlock()
  const [writing, setWriting] = useState<'log' | 'later' | null>(null)
  if (!block) return null

  const done = () => setWriting(null)
  if (writing === 'log') {
    return (
      <LineField
        label="Log"
        placeholder="How is it going?"
        submit="Log"
        closeLabel="Close the log"
        maxLength={LOG_MAX_LENGTH}
        compact={compact}
        onKeep={logBlock}
        onDone={done}
      />
    )
  }
  if (writing === 'later') {
    return (
      <LineField
        label="Later"
        placeholder="Something for later"
        submit="Keep"
        closeLabel="Close Later"
        maxLength={LATER_MAX_LENGTH}
        compact={compact}
        onKeep={(title) => keepForLater(title) !== null}
        onDone={done}
      />
    )
  }

  const opener = `shrink-0 ${compact ? 'px-3 py-1 text-xs' : 'px-3 py-1.5'}`
  const counts = [
    ...(compact && block.logs.length > 0 ? [`${block.logs.length} logged`] : []),
    ...(kept > 0 ? [`${kept} for later`] : []),
  ]
  // A row of its own with its own gap: on the stage its cell is a plain box,
  // and the two openers drawn there as inline siblings touched.
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <GhostButton
        type="button"
        onClick={() => setWriting('log')}
        aria-label="Write a log"
        title="Write a line about how it is going"
        className={opener}
      >
        <EditGlyph /> Log
      </GhostButton>
      <GhostButton
        type="button"
        onClick={() => setWriting('later')}
        aria-label="Put something down for later"
        title="Put down something to come back to, off this block"
        className={opener}
      >
        <span aria-hidden="true">⤴</span> Later
      </GhostButton>
      {counts.length > 0 && (
        <span className={`tnum text-muted ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {counts.join(' · ')}
        </span>
      )}
    </div>
  )
}

/**
 * The three columns a log is drawn in — its minute, its words, and its ✎ and
 * bin — so the actions line up under one another however long each log is,
 * just past the longest one, rather than trailing each line at a different
 * place or waiting at the far edge.
 */
const LOG_COLUMNS = 'grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2'

/** The edits under way on one surface, by log id. */
export type LogDrafts = {
  drafts: ReadonlyMap<string, string>
  /** Start, change or end (`null`) the edit of one log. */
  setDraft: (logId: string, draft: string | null) => void
}

/**
 * Where a surface keeps its edits under way, by log id: the stage's list,
 * or one block's marks on the calendar or the strip.
 *
 * Held by the surface rather than by the row drawing the log, because on the
 * calendar a row's place is not its own: neighbours share a mark only while
 * the block cannot hold them apart (`stackRuns`), and a mark regrouped by a
 * log deleted beside it draws the same log under a new parent. A draft held
 * by the row went with it. Held here, the edit is found again by its log's
 * id, and its field takes the focus back as it is drawn again.
 *
 * A log never comes back once deleted, so a draft left behind by one deleted
 * elsewhere is never drawn again; the surface's own lifetime — and the
 * session's, where the host keys it by `generation` — bounds the rest.
 */
export function useLogDrafts(): LogDrafts {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map())
  const setDraft = useCallback((logId: string, draft: string | null) => {
    setDrafts((current) => {
      const next = new Map(current)
      if (draft === null) next.delete(logId)
      else next.set(logId, draft)
      return next
    })
  }, [])
  return { drafts, setDraft }
}

/**
 * The running block's logs, oldest first, each one correctable, under their
 * heading. Nothing at all until there is one: a heading over nothing read as
 * a list that had failed to load.
 */
export function LogList() {
  const block = useRunningBlock()
  const edits = useLogDrafts()
  if (!block || block.logs.length === 0) return null

  // One grid for the whole list, each row a subgrid of it, so the columns are
  // the list's rather than each row's.
  return (
    <section className="mt-5">
      <SectionHeading>Logs</SectionHeading>
      <ul
        aria-label="Logs in this block"
        className={`mt-1.5 grid w-fit max-w-md gap-y-1 ${LOG_COLUMNS}`}
      >
        {block.logs.map((log) => (
          <li key={log.id} className="group/row col-span-3 grid grid-cols-subgrid items-baseline">
            <LogRow blockId={block.id} log={log} edits={edits} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The logs one mark stands for, with their ✎ and bin always showing: the card
 * the calendar and the mini window's strip open from a log's mark. Usually
 * one log; several where a block too short to hold its logs apart lets
 * neighbours share a mark (`stackRuns`), oldest first. The card is already
 * the thing pointed at, so hiding the actions until a second hover would only
 * make the reader hunt for them. Its edits are its host's (`useLogDrafts`).
 */
export function LogCard({
  blockId,
  logs,
  edits,
}: {
  blockId: string
  logs: readonly BlockLog[]
  edits: LogDrafts
}) {
  return (
    <div className={`grid items-baseline gap-y-1.5 ${LOG_COLUMNS}`}>
      {logs.map((log) => (
        <Fragment key={log.id}>
          <LogRow blockId={blockId} log={log} edits={edits} showActions />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * One log as three cells of its host's grid (`LOG_COLUMNS`): its minute, its
 * words, and a ✎ and a delete. In a list the actions wait for the pointer, as
 * every row's actions do here, and the host puts `group/row` on the row.
 *
 * The edit is its host's, by the log's id (`useLogDrafts`), so it outlasts
 * the row when the row is drawn again somewhere else. Saving words that have
 * not changed closes the field and writes nothing: an edit nobody made is not
 * an edit.
 */
function LogRow({
  blockId,
  log,
  edits,
  showActions = false,
}: {
  blockId: string
  log: BlockLog
  edits: LogDrafts
  showActions?: boolean
}) {
  const editLog = useSession((s) => s.editLog)
  const removeLog = useSession((s) => s.removeLog)
  const draft = edits.drafts.get(log.id) ?? null
  const edit = (next: string | null) => edits.setDraft(log.id, next)
  const time = formatClock(log.at)

  if (draft !== null) {
    return (
      <>
        <span className="tnum shrink-0 text-xs text-muted">{time}</span>
        <div className="col-span-2 flex">
          <RenameField
            label={`Change the log at ${time}`}
            value={draft}
            onChange={edit}
            onSave={() => {
              if (draft.trim() !== log.text) editLog(blockId, log.id, draft)
              edit(null)
            }}
            onCancel={() => edit(null)}
            textClass="text-xs"
            maxLength={LOG_MAX_LENGTH}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <span className="tnum shrink-0 text-xs text-muted">{time}</span>
      {/* A long log wraps under its own first line. */}
      <span className="min-w-0 text-sm wrap-anywhere text-body">{log.text}</span>
      {/* Level with the first line, not the middle of a wrapped log. */}
      <span className={`-my-1 flex shrink-0 self-start ${showActions ? '' : revealOnHover}`}>
        <IconButton label={`Edit log at ${time}`} hint="Edit" onClick={() => edit(log.text)}>
          <EditGlyph />
        </IconButton>
        <IconButton
          label={`Delete log at ${time}`}
          hint="Delete"
          danger
          onClick={() => removeLog(blockId, log.id)}
        >
          <DeleteIcon />
        </IconButton>
      </span>
    </>
  )
}
