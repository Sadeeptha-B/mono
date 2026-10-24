/**
 * Keeping what a field holds by leaving it: `useLeave`, and the two things it
 * waits on — the end of the press that took the focus away, and the turn of
 * the event loop after it.
 *
 * A module of its own rather than one of `ui.tsx`'s pieces, because it is
 * lifecycle rather than drawing: it listens to the whole document, a leave it
 * has begun outlives the field it was spread on, and every rule about when a
 * leave counts is here, in one place. The tasks page's board is its only
 * user, through `AddForm` and `RenameField`'s `saveOnLeave`.
 */

import { useLayoutEffect, useMemo, useRef, type FocusEvent } from 'react'

/**
 * Calls `onLeave` once the focus has left an element for somewhere else on
 * the page — and not until the gesture that moved it is over. Spread the
 * props it returns onto the element that holds the field and whatever belongs
 * with it: moving between those is not leaving.
 *
 * What a field does when it is left — keeping what was typed and folding
 * away — moves the page: a new row appears above it, the field closes. The
 * browser takes the focus away on the press, before the release that
 * completes a click, so doing it on `blur` moved the page under a pointer
 * still held down, and the click landed on whatever had slid into its place.
 * That is why the tasks page's fields once needed a `Done`. So a leave by
 * pointer waits for the press to end — its release, the drop of a drag it
 * began, or the browser cancelling it — and then for the click that release
 * completes, by a turn of the event loop; a leave by keyboard waits only that
 * turn.
 *
 * A leave is decided when the focus goes; the wait only puts it after the
 * click. So it is carried out even when that click takes the field away —
 * folds the column it is in, ticks its row done, turns the page to its other
 * view. The click is the user doing something else, which is what leaving
 * is, and a leave that needed the field to survive it lost what was typed to
 * the most ordinary clicks on the page. `onLeave` is then the last one the
 * field was drawn with. Whether whatever took the field away also made what
 * it held stale — an import replacing the records it names — is for the
 * host to judge as it writes; this knows nothing about records.
 *
 * It is not a leave if, by its turn, the focus has come back inside, or the
 * window itself lost the focus: switching to another app is not a decision
 * about the field, and the browser hands the focus back to it on return. Nor
 * is a blur heard once the field has begun to go. A field taken away by its
 * own Escape loses the focus as it goes, and browsers have differed over
 * whether to report that as a blur; the Chromium the specs run does not, so
 * no spec can catch it. Heard, it would be taken for a leave that outlives
 * the field, and write what Escape threw away.
 *
 * Works in whichever document it is drawn in, the mini window's included.
 */
export function useLeave(onLeave: () => void) {
  // Kept in step as each render commits, before any turn it waits for can
  // come round: a × or Escape that folds the field must be seen as folded.
  const latest = useRef(onLeave)
  useLayoutEffect(() => {
    latest.current = onLeave
  })
  // Whether the field has begun to go. Set by a layout effect's cleanup,
  // which React runs before it takes the field's elements out of the
  // document, so any blur their removal causes is already ignored; cleared
  // on mounting, since development mounts everything twice.
  const gone = useRef(false)
  useLayoutEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
    }
  }, [])
  // Undoes a leave waiting to happen: its listeners, or its turn. Only focus
  // coming back undoes one; the field going does not (see above).
  const waiting = useRef<(() => void) | null>(null)

  return useMemo(
    () => ({
      // On attaching, so the press that will take the focus away is seen.
      ref: (el: HTMLElement | null) => {
        if (el) pressesIn(el.ownerDocument)
      },
      onFocus: () => {
        waiting.current?.()
        waiting.current = null
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        const box = e.currentTarget
        if (gone.current || box.contains(e.relatedTarget as Node | null)) return
        waiting.current?.()
        const doc = box.ownerDocument
        let skipTurn = () => {}
        const settle = () => {
          stop()
          skipTurn()
          // Once, whichever comes first: its own turn, or a click that needs
          // it written before it acts (`settleLeaves`).
          const run = () => {
            skipTurn()
            waiting.current = null
            // A field taken away by the click contains nothing, so only the
            // window decides it then.
            if (!doc.hasFocus() || box.contains(doc.activeElement)) return
            latest.current()
          }
          const cancel = nextTask(run)
          due.add(run)
          skipTurn = () => {
            cancel()
            due.delete(run)
          }
        }
        // A press the browser cancels has ended, with no release to wait for,
        // unless what cancelled it was a drag beginning: then the drop ends
        // it. Asked a turn later, since a drag's start and the cancel it
        // causes come in one task, in an order browsers need not agree on.
        const cancelled = () => {
          skipTurn()
          skipTurn = nextTask(() => {
            if (!pressesIn(doc).dragging) settle()
          })
        }
        const stop = () => {
          for (const type of PRESS_ENDS) doc.removeEventListener(type, settle, true)
          doc.removeEventListener('pointercancel', cancelled, true)
        }
        waiting.current = () => {
          stop()
          skipTurn()
        }
        if (pressesIn(doc).down) {
          for (const type of PRESS_ENDS) doc.addEventListener(type, settle, true)
          doc.addEventListener('pointercancel', cancelled, true)
        } else {
          settle()
        }
      },
    }),
    [],
  )
}

/**
 * Leaves whose press has ended and whose turn has not come yet: decided, and
 * waiting only for the click to land.
 */
const due = new Set<() => void>()

/**
 * Carries out now every leave waiting for its turn, from inside the click it
 * was waiting for. For a click whose own write has to include what the leave
 * writes: folding every column of an epic must fold the outcome its add field
 * is about to add, and a leave carried out a turn later added it open beside
 * the folded ones (`useFoldAll`). The wait exists so the page does not move
 * under a press before its click lands; inside the click, it has landed. Each
 * leave still runs once, and still only if the focus has not come back to
 * its field.
 */
export function settleLeaves() {
  for (const run of [...due]) run()
}

/**
 * What ends a press: its release, or — when the press began a drag, which
 * cancels the pointer instead — the drag's drop or end. The drop is heard as
 * well as the end because a drop that moves the dragged row unmounts it, and
 * its `dragend` then reaches nothing (`useCarryState`). A cancel that began no
 * drag ends a press too, and is heard apart, since it has to ask first.
 */
const PRESS_ENDS = ['pointerup', 'drop', 'dragend'] as const

/**
 * Runs `run` in a task of its own, after the one now running; returns what
 * cancels it. The release of a press and the click it completes are one
 * task, so this comes after the click has landed.
 *
 * A message rather than a timer: a timer is the clock's, and a clock paused
 * or faked — the browser specs pause it — never lets it fire. A posted
 * message is what React's own scheduler waits on, for the same reason.
 */
function nextTask(run: () => void): () => void {
  const channel = new MessageChannel()
  let live = true
  channel.port1.onmessage = () => {
    channel.port1.close()
    if (live) run()
  }
  channel.port2.postMessage(null)
  return () => {
    live = false
    channel.port1.close()
  }
}

/**
 * Whether a pointer is held down in each document a leaving field has been
 * drawn in, and whether the press has begun a drag, which outlasts the
 * pointer's own cancel.
 */
type Press = { down: boolean; dragging: boolean }
const presses = new WeakMap<Document, Press>()

function pressesIn(doc: Document): Press {
  const known = presses.get(doc)
  if (known) return known
  const state: Press = { down: false, dragging: false }
  doc.addEventListener('pointerdown', () => Object.assign(state, { down: true, dragging: false }), true)
  doc.addEventListener('dragstart', () => (state.dragging = true), true)
  doc.addEventListener('pointercancel', () => (state.down = false), true)
  for (const type of ['pointerup', 'drop', 'dragend']) {
    doc.addEventListener(type, () => Object.assign(state, { down: false, dragging: false }), true)
  }
  presses.set(doc, state)
  return state
}
