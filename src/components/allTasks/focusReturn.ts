/**
 * Where the keyboard's focus goes in All Tasks' tree when what had it leaves.
 *
 * Controls leave while focus is in them: a field closed by ✓, × or Escape, a
 * row whose × deleted it, or anything another tab deletes, finishes, closes or
 * moves. When the one with focus goes, focus falls to the page, and a keyboard
 * is left at the top of the document. So the browser remembers the control
 * that last had focus, and once that control has left the page with focus
 * lost, focus goes to the first of these still drawn: the same control drawn
 * again (a rename its task moved), what opened it (the `⋯` of the row a popup
 * or a field belongs to), the `⋯` of the place its row is in, the search. Only
 * when focus was lost: if it already moved somewhere on purpose, it stays
 * there. A control's own key is `data-focus-key`; a field names its opener in
 * `data-focus-back`, and a place's list in `data-home`.
 *
 * A press that opens a field, or moves a row whose arrow it was, says which
 * control should have the focus next (`focusNext`), and it is focused after
 * the render that draws it.
 */

import { useEffect, useRef, type FocusEvent, type RefObject } from 'react'

export function useFocusReturn(
  root: RefObject<HTMLElement | null>,
  search: RefObject<HTMLInputElement | null>,
) {
  /**
   * The control that last had focus, and the keys of where focus goes if it is
   * taken away, in order — see the header.
   */
  const lastFocus = useRef<{ control: Element; to: (string | null)[] } | null>(null)
  /** The field a press has just opened, to be focused once it is drawn. */
  const focusField = useRef<string | null>(null)

  // After every render: a field a press has just opened is focused; otherwise,
  // once the control that last had focus has left the page and focus went
  // with it, focus is handed back. Not before it has gone, since the render
  // that takes it may not be this one.
  useEffect(() => {
    const doc = root.current?.ownerDocument
    if (!doc) return
    const keyed = (key: string | null) =>
      key ? root.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null

    const wanted = focusField.current
    if (wanted) {
      focusField.current = null
      keyed(wanted)?.focus()
      return
    }

    const last = lastFocus.current
    if (!last || last.control.isConnected) return
    lastFocus.current = null
    const active = doc.activeElement
    if (active !== null && active !== doc.body) return
    const named = last.to.map(keyed).find((el) => el)
    ;(named ?? search.current)?.focus()
  })

  return {
    /** Focus this control, by its `data-focus-key`, after the next render. */
    focusNext: (key: string) => {
      focusField.current = key
    },
    /** For the tree's root: remembers what has the focus, and where it goes back to. */
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const near = (name: string) => e.target.closest(`[${name}]`)?.getAttribute(name) ?? null
      lastFocus.current = {
        control: e.target,
        to: [e.target.getAttribute('data-focus-key'), near('data-focus-back'), near('data-home')],
      }
    },
  }
}
