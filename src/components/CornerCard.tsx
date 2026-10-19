/**
 * The corner card: a button in the bottom-right corner of every page that
 * opens a small card above it, the way a site's chat opens from its corner.
 * It has two tabs. `Today` is today's list with its intentions (`TodayList`);
 * `Draft` is one page of loose text (`useDraftPad`), for thinking tasks
 * through before they are written into the backlog.
 *
 * It began as the tasks page's own, when today's list left the top of the
 * board: the list is something consulted while filing and choosing, not the
 * page's subject. It is on every page now, because both tabs are things
 * reached for wherever you are — what today is for while the calendar or
 * Later is in front of you, and somewhere to write a task down roughly before
 * deciding where it goes. Not a dialog over the page — nothing behind it is
 * shut off, and a click on the page leaves it open — because the board is
 * where tasks are chosen for today, with the sun on their rows, and the list
 * is worth watching fill while that happens. The × or the button closes it,
 * and Escape does from inside it, handing the focus back to the button.
 *
 * Whether it is open, and which tab shows, are one choice held for the whole
 * app (`useCorner`) rather than by each page, so a draft opened on the tasks
 * page is still open on the timeline page: moving between pages is not asking
 * for it to close. A page arriving with it open leaves the focus where the
 * move put it; only the press that opens it sends the focus in. A reload
 * starts it closed on `Today`.
 *
 * Closing it closes nothing inside it: an intention half renamed or half named
 * is there when it is opened again, or the tab turned back to (`CornerPanel`).
 * Those drafts are each page's, as they always were the tasks page's, and go
 * when the page is left; the draft itself is saved as it is typed.
 *
 * Today's list carries tasks between intentions. Where the page has a carry
 * of its own, the card's shares its hand (`hand`), so picking up on one puts
 * down the other. On the day the list joins the carry `App` holds around both
 * columns instead (`shared`), so a task dragged from All Tasks lands on one of
 * the card's intentions as it would on the question's.
 *
 * Above the pick-up's status bar (`CarryStatus`), which spans a phone's width
 * along the bottom, so the corner is raised there and drops to the corner
 * proper once the bar is a narrow strip in the middle.
 *
 * When the browser refuses to save the draft, the draft says so and offers its
 * text as a file (`DraftPage`), and the button carries a mark, so it is seen
 * on every page with the card closed. The text is the user's own and is held
 * nowhere else, not even in an export.
 */

import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react'
import { create } from 'zustand'

import { Carry, type CarryHand } from './carry'
import { TodayIcon } from './icons'
import { TodayCarry, TodayList, useIntentionRename } from './TodayList'
import { AddFields } from './Tasks/addFields'
import { dayKey } from '@/domain/time'
import { useDraftPad, DRAFT_MAX } from '@/store/draftPad'
import { useSession } from '@/store/session'
import { useTasks } from '@/store/tasks'

/** The card's two tabs. */
type CornerTab = 'today' | 'draft'

/**
 * Whether the card is open, and on which tab: one answer for every page, in
 * memory only. See the header.
 */
const useCorner = create<{ open: boolean; tab: CornerTab }>()(() => ({
  open: false,
  tab: 'today',
}))

/** What an empty day says on a page with no board to choose from. */
const CHOOSE_ELSEWHERE =
  "Nothing chosen for today yet. Choose tasks on today's question, or with the sun on a task on the Tasks page."

export function CornerCard({
  hand,
  shared = false,
  empty = CHOOSE_ELSEWHERE,
}: {
  /** The page's own carry's hand, so the two never both hold something. */
  hand?: CarryHand
  /** Join the carry the page already provides (`App`'s), rather than holding one. */
  shared?: boolean
  /** What an empty day says, which depends on where the page's ways in are. */
  empty?: string
}) {
  const generation = useSession((s) => s.generation)
  const open = useCorner((s) => s.open)
  const unsaved = useDraftPad((s) => s.unsaved)
  const unsavedId = useId()
  const launcher = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Set by the press that opens it, so only that press sends the focus in.
  const asked = useRef(false)
  const close = () => {
    useCorner.setState({ open: false })
    launcher.current?.focus()
  }
  // Opened, the focus goes into the card — onto the draft's page, or the card
  // itself for today's list — unless something in it already took it as it
  // was drawn, such as a task's grip a move left waiting for this list. A
  // field left open in today's list does not: it keeps its draft, not the
  // focus (`TodayList`). Watched here rather than in the panel, so the panel
  // drawn again for a new day does not take the focus from the page.
  useEffect(() => {
    if (!open || !asked.current) return
    asked.current = false
    const el = panel.current
    if (!el || el.contains(el.ownerDocument.activeElement)) return
    const target = el.querySelector<HTMLElement>('[data-corner-focus]') ?? el
    target.focus()
  }, [open])

  return (
    <>
      {/* Keyed by the session's generation, as the stage is: what is being
          typed about today belongs to one particular day, and the midnight
          reset or an import must not carry it into the next, nor a task half
          carried between intentions. */}
      <CornerPanel
        key={generation}
        ref={panel}
        open={open}
        {...(hand ? { hand } : {})}
        shared={shared}
        empty={empty}
        onClose={close}
      />
      <button
        ref={launcher}
        type="button"
        onClick={() => {
          if (open) return close()
          asked.current = true
          useCorner.setState({ open: true })
        }}
        aria-expanded={open}
        aria-label="Today and draft"
        // Said beside its name rather than in it, so the name stays one.
        {...(unsaved ? { 'aria-describedby': unsavedId } : {})}
        title={unsaved ? `Today's tasks, and a draft — ${DRAFT_UNSAVED}` : "Today's tasks, and a draft"}
        className={`fixed right-4 bottom-20 z-40 flex size-12 items-center justify-center rounded-full border shadow-lg transition sm:right-6 sm:bottom-6 ${
          open
            ? 'border-deep/70 bg-surface-raised text-bright'
            : 'border-muted/70 bg-surface-raised text-deep hover:text-bright'
        }`}
      >
        <TodayIcon chosen className="size-5" />
        {unsaved && (
          <>
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-2.5 rounded-full border border-surface-raised bg-commit"
            />
            <span id={unsavedId} hidden>
              {DRAFT_UNSAVED}
            </span>
          </>
        )}
      </button>
    </>
  )
}

/**
 * The card, and whichever tab it is on.
 *
 * Mounted whether or not the card is showing, because it holds today's list's
 * two drafts — a new intention's title and a rename — and the card closes far
 * more often than anyone means to throw one away: a click on the button to
 * see the page behind it is not a cancel, and nor is a look at the draft.
 * They were held inside the list and went whenever it closed. Only the drafts
 * outlive it: a carry of the card's own, and anything in hand in it, is drawn
 * with the list, since a pick-up held with nowhere to put it down would leave
 * the status bar asking for a `Move here` that is not on screen.
 *
 * The intention field keeps the tasks page's rule for add fields: opening it
 * folds any other that is empty, and opening another folds it while nothing
 * has been written in it — closed or not. Elsewhere there are no others, and
 * the page provides none (`AddFields`).
 */
function CornerPanel({
  ref,
  open,
  hand,
  shared,
  empty,
  onClose,
}: {
  ref: Ref<HTMLDivElement>
  open: boolean
  hand?: CarryHand
  shared: boolean
  empty: string
  onClose: () => void
}) {
  const tab = useCorner((s) => s.tab)
  const hydrated = useTasks((s) => s.hydrated)
  const [intention, setIntention] = useState<string | null>(null)
  const [renaming, setRenaming] = useIntentionRename()
  const formId = useId()
  const tabsId = useId()
  const { current, claim } = useContext(AddFields)
  // Whether today's carry holds a picked-up task, whose Escape is its own.
  const holding = useRef(false)
  // Another field was opened: fold this one if nothing has been written in it.
  useEffect(() => {
    if (current !== null && current !== formId) setIntention((t) => (t === '' ? null : t))
  }, [current, formId])

  if (!open) return null

  const list = (
    <>
      <Holding into={holding} />
      <TodayList
        // The card's tab names it; the list's row keeps `+ Intention`.
        heading={<span className="sr-only">Today's tasks</span>}
        newIntention={intention}
        onNewIntention={(next) => {
          if (intention === null && next !== null) claim(formId)
          if (next === null && current === formId) claim(null)
          setIntention(next)
        }}
        renaming={renaming}
        onRenaming={setRenaming}
        empty={empty}
      />
    </>
  )
  const today = !hydrated ? (
    <p className="text-sm text-muted">Loading your tasks…</p>
  ) : shared ? (
    list
  ) : (
    <TodayCarry {...(hand ? { hand } : {})}>{list}</TodayCarry>
  )

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Today and draft"
      tabIndex={-1}
      onKeyDown={(e) => {
        // A field's Escape, or a picked-up task's, is theirs to answer.
        if (e.key !== 'Escape' || e.defaultPrevented) return
        if (tab === 'today' && holding.current) return
        e.stopPropagation()
        onClose()
      }}
      className="fixed inset-x-4 bottom-36 z-40 flex max-h-[min(60vh,36rem)] flex-col rounded-xl border border-muted/70 bg-surface-raised shadow-lg focus:outline-none sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[26rem]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
        <CornerTabs tab={tab} id={tabsId} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close today and draft"
          className="-mr-1 px-1 text-muted transition hover:text-bright"
        >
          ×
        </button>
      </div>
      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${tab}`}
        className={`mono-scroll min-h-0 overflow-y-auto ${tab === 'today' ? 'px-4 py-3' : ''}`}
      >
        {tab === 'today' ? today : <DraftPage />}
      </div>
    </div>
  )
}

/**
 * The card's two tabs, as the tabs pattern has them: the one showing is the
 * one in the Tab order, and the arrow keys, Home and End move between them,
 * turning the card over as they go — there are two, and both are instant.
 * Set as the page's other small switches are (`BacklogSwitch`).
 */
function CornerTabs({ tab, id }: { tab: CornerTab; id: string }) {
  const tabs = useRef<Record<CornerTab, HTMLButtonElement | null>>({ today: null, draft: null })
  const choose = (next: CornerTab, focus: boolean) => {
    useCorner.setState({ tab: next })
    if (focus) tabs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const next: CornerTab | null =
      e.key === 'Home'
        ? 'today'
        : e.key === 'End'
          ? 'draft'
          : e.key === 'ArrowLeft' || e.key === 'ArrowRight'
            ? tab === 'today'
              ? 'draft'
              : 'today'
            : null
    if (next === null) return
    e.preventDefault()
    choose(next, true)
  }
  const option = (value: CornerTab, name: string) => (
    <button
      ref={(el) => {
        tabs.current[value] = el
      }}
      type="button"
      role="tab"
      id={`${id}-${value}`}
      aria-selected={tab === value}
      aria-controls={`${id}-panel`}
      tabIndex={tab === value ? 0 : -1}
      onClick={() => choose(value, false)}
      className={`rounded-md px-2 py-0.5 text-xs font-medium tracking-widest uppercase transition ${
        tab === value ? 'bg-surface text-bright' : 'text-muted hover:text-bright'
      }`}
    >
      {name}
    </button>
  )
  return (
    <div role="tablist" aria-label="Show in the card" onKeyDown={onKeyDown} className="flex items-center gap-1">
      {option('today', 'Today')}
      {option('draft', 'Draft')}
    </div>
  )
}

/**
 * The draft: a bare page filling the card, saved as it is typed
 * (`useDraftPad`). No `Save`, no title and no clear button — a scratch pad
 * is emptied the way any text is, and a button that erased it at one press
 * would be the one thing here that cannot be undone.
 *
 * While the browser refuses to save it, a line over the page says so for as
 * long as it lasts, with the text offered as a file — the draft's own Export,
 * which needs nothing from storage. Not a copy to the clipboard: that asks a
 * permission, and is lost to the next copy. An emptied page that failed to
 * save is still unsaved — what it last saved comes back after a reload — so
 * the line stays and says that instead, with nothing to offer as a file.
 */
function DraftPage() {
  const text = useDraftPad((s) => s.text)
  const setText = useDraftPad((s) => s.setText)
  const unsaved = useDraftPad((s) => s.unsaved)
  const empty = text.trim() === ''
  return (
    <>
      {unsaved && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-commit/40 bg-commit/10 px-4 py-2 text-xs text-commit"
        >
          <span className="min-w-0 flex-1">
            {DRAFT_UNSAVED}.{' '}
            {empty
              ? 'What it last saved will come back after a reload.'
              : 'Save it as a file before you close Mono.'}
          </span>
          {!empty && (
            <button
              type="button"
              onClick={() => saveDraftFile(text)}
              className="shrink-0 rounded-md border border-commit/60 px-2 py-0.5 transition hover:bg-commit/20"
            >
              Save as file
            </button>
          )}
        </div>
      )}
      <textarea
        data-corner-focus
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Draft"
        placeholder="Think tasks through here before you write them down. Kept on this device as you type."
        maxLength={DRAFT_MAX}
        spellCheck
        className="mono-scroll block h-[min(40vh,22rem)] w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-bright placeholder:text-muted/80 focus:outline-none"
      />
    </>
  )
}

/** What the card says while the draft is not being saved. */
const DRAFT_UNSAVED = 'This browser is not saving the draft'

/** The draft as a text file, as Export hands over the day. */
function saveDraftFile(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  // The local day, as the export's name is.
  a.download = `mono-draft-${dayKey(Date.now())}.txt`
  a.click()
  // Revoking in the same tick cancels the download in some browsers before it
  // has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Tells the panel whether today's carry holds a picked-up task, as each render commits. */
function Holding({ into }: { into: RefObject<boolean> }) {
  const { held } = useContext(Carry)
  useLayoutEffect(() => {
    into.current = held?.by === 'pick'
  })
  return null
}
