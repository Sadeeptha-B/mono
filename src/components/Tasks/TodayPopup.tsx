/**
 * Today on the tasks page: a button in the bottom-right corner that opens
 * today's list with its intentions (`TodayList`) in a panel above it, the way
 * a site's chat opens from its corner.
 *
 * It was a section above the board, and the tasks page is the board now: the
 * list is something consulted while filing and choosing, not the page's
 * subject, so it waits in the corner until asked for and does not push the
 * areas down the page. Not a dialog over the page — nothing behind it is shut
 * off, and a click on the board leaves it open — because the board is where
 * tasks are chosen for today, with the sun on their rows, and the list is
 * worth watching fill while that happens. The × or the button closes it, and
 * Escape does from inside it, handing the focus back to the button. Closing
 * it closes nothing inside it: an intention half renamed or half named is
 * there when it is opened again (`TodayPanel`).
 *
 * Above the pick-up's status bar (`CarryStatus`), which spans a phone's width
 * along the bottom, so the corner is raised there and drops to the corner
 * proper once the bar is a narrow strip in the middle.
 */

import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react'

import { Carry, type CarryHand } from '../carry'
import { TodayIcon } from '../icons'
import { TodayCarry, TodayList, useIntentionRename } from '../TodayList'
import { useSession } from '@/store/session'
import { AddFields } from './addFields'

export function TodayPopup({ hand }: { hand: CarryHand }) {
  const generation = useSession((s) => s.generation)
  const [open, setOpen] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = () => {
    setOpen(false)
    launcher.current?.focus()
  }
  // Opened, the focus goes into the panel, so the keyboard is where the list
  // is — unless a field left open in it took the focus as it was drawn again,
  // which is the more exact answer. Watched here rather than in the panel, so
  // the panel drawn again for a new day does not take the focus from the page.
  useEffect(() => {
    const el = panel.current
    if (open && el && !el.contains(el.ownerDocument.activeElement)) el.focus()
  }, [open])

  return (
    <>
      {/* Keyed by the session's generation, as the stage is: what is being
          typed about today belongs to one particular day, and the midnight
          reset or an import must not carry it into the next, nor a task half
          carried between intentions. */}
      <TodayPanel key={generation} ref={panel} open={open} hand={hand} onClose={close} />
      <button
        ref={launcher}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="Today"
        title="Today's tasks and intentions"
        className={`fixed right-4 bottom-20 z-40 flex size-12 items-center justify-center rounded-full border shadow-lg transition sm:right-6 sm:bottom-6 ${
          open
            ? 'border-deep/70 bg-surface-raised text-bright'
            : 'border-muted/70 bg-surface-raised text-deep hover:text-bright'
        }`}
      >
        <TodayIcon chosen className="size-5" />
      </button>
    </>
  )
}

/**
 * The panel, and today's list with its intentions (`TodayList`) inside it.
 * Tasks are chosen with the sun on their rows on the board; carrying between
 * intentions has its own carry here, apart from the board's, sharing one hand
 * with it.
 *
 * Mounted whether or not the panel is showing, because it holds the list's
 * two drafts — a new intention's title and a rename — and the panel closes
 * far more often than anyone means to throw one away: a click on the button
 * to see the board behind it is not a cancel. They were held inside the
 * panel and went whenever it closed. Only the drafts outlive it: the carry,
 * and anything in hand in it, is drawn with the panel, since a pick-up held
 * with nowhere to put it down would leave the status bar asking for a
 * `Move here` that is not on screen.
 *
 * The intention field keeps the page's rule for add fields: opening it folds
 * any other that is empty, and opening another folds it while nothing has been
 * written in it — closed or not.
 */
function TodayPanel({
  ref,
  open,
  hand,
  onClose,
}: {
  ref: Ref<HTMLDivElement>
  open: boolean
  hand: CarryHand
  onClose: () => void
}) {
  const [intention, setIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  const formId = useId()
  const titleId = useId()
  const { current, claim } = useContext(AddFields)
  // Whether today's own carry holds a picked-up task, whose Escape is its own.
  const holding = useRef(false)
  // Another field was opened: fold this one if nothing has been written in it.
  useEffect(() => {
    if (current !== null && current !== formId) setIntention((t) => (t === '' ? null : t))
  }, [current, formId])

  if (!open) return null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        // A field's Escape, or a picked-up task's, is theirs to answer.
        if (e.key !== 'Escape' || e.defaultPrevented || holding.current) return
        e.stopPropagation()
        onClose()
      }}
      className="fixed inset-x-4 bottom-36 z-40 flex max-h-[min(60vh,36rem)] flex-col rounded-xl border border-muted/70 bg-surface-raised shadow-lg focus:outline-none sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[26rem]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 id={titleId} className="text-xs font-medium tracking-widest text-muted uppercase">
          Today
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close today"
          className="-mr-1 px-1 text-muted transition hover:text-bright"
        >
          ×
        </button>
      </div>
      <div className="mono-scroll min-h-0 overflow-y-auto px-4 py-3">
        <TodayCarry hand={hand}>
          <Holding into={holding} />
          <TodayList
            // The panel's own bar names it; the list's row keeps `+ Intention`.
            heading={<span className="sr-only">Today's tasks</span>}
            newIntention={intention}
            onNewIntention={(next) => {
              if (intention === null && next !== null) claim(formId)
              if (next === null && current === formId) claim(null)
              setIntention(next)
            }}
            renaming={renaming}
            onRenaming={setRenaming}
            empty="Nothing chosen for today yet. Choose a task with the sun on its row on the board."
          />
        </TodayCarry>
      </div>
    </div>
  )
}

/** Tells the panel whether today's carry holds a picked-up task, as each render commits. */
function Holding({ into }: { into: RefObject<boolean> }) {
  const { held } = useContext(Carry)
  useLayoutEffect(() => {
    into.current = held?.by === 'pick'
  })
  return null
}
