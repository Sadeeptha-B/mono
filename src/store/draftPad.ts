/**
 * The draft: one page of loose text, for thinking tasks through before they
 * are written into the backlog. The corner card's second tab (`CornerCard`)
 * shows it on every page.
 *
 * Kept in localStorage under its own key, beside the folds, rather than in the
 * backlog or the log. It is not a record of anything: nothing reads it, nothing
 * is derived from it, it has no ids to keep in step across tabs, and it is not
 * about one day, so the log's midnight reset would be the wrong lifetime for
 * it. For the same reason it is not in an export. It is written on every
 * change, because a scratch pad that has to be saved is one that gets lost.
 *
 * Another tab's write arrives as a `storage` event, and this tab takes what
 * storage holds now. One person types in one tab at a time, so the last write
 * is the one they meant; without it, a tab left open would put back an old
 * draft the next time anything was typed in it. What storage holds now, not
 * what the event says was written: events are queued, and one can arrive
 * after this tab has saved something newer, so its `newValue` would put the
 * older text on screen for the next keystroke to save over the newer.
 * Storage is the one answer to what was written last. Not while this tab's
 * own text is unsaved, though: that text is only here, and the other tab's
 * is on disk.
 *
 * A refused write keeps the text in memory, so typing goes on, but it is
 * words the user wrote, held nowhere else — the folds can be lost quietly,
 * and this cannot. So the store says so (`unsaved`) until a write lands, and
 * the card shows it and offers the text as a file (`CornerCard`). Emptying
 * the pad is a write like any other: refused, the old text is still on disk
 * and comes back after a reload, so it is unsaved just the same. Unlike the
 * session's and the backlog's failures it does not raise the header's
 * warning: that leads to Export, and Export does not carry the draft.
 */

import { create } from 'zustand'

export const DRAFT_KEY = 'mono.draft'

/** Generous for a scratch pad, and small beside what localStorage allows. */
export const DRAFT_MAX = 20_000

type DraftPad = {
  text: string
  /** Whether the text in memory failed to reach storage, and has not since. */
  unsaved: boolean
  setText: (text: string) => void
}

function readDraft(): string {
  try {
    const value = localStorage.getItem(DRAFT_KEY)
    return typeof value === 'string' ? value.slice(0, DRAFT_MAX) : ''
  } catch {
    return ''
  }
}

export const useDraftPad = create<DraftPad>()((set) => ({
  text: readDraft(),
  unsaved: false,
  setText: (text) => {
    const next = text.slice(0, DRAFT_MAX)
    try {
      localStorage.setItem(DRAFT_KEY, next)
      set({ text: next, unsaved: false })
    } catch {
      // The draft still holds for this tab, and says it is held only here.
      set({ text: next, unsaved: true })
    }
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // `key` is null when another tab cleared all of storage.
    if (e.key !== DRAFT_KEY && e.key !== null) return
    if (useDraftPad.getState().unsaved) return
    // Read now rather than taken from the event; see the header. Equal to
    // what is on screen — this tab's own newer save — it changes nothing.
    const stored = readDraft()
    if (stored !== useDraftPad.getState().text) useDraftPad.setState({ text: stored })
  })
}
