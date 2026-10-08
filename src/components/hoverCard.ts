/**
 * Mono's own hover card: what opens at once when something is pointed at or
 * focused, placed where it can be read — a log's mark on the calendar, and
 * the purpose of a running block in the mini window.
 *
 * Not the browser's `title` tooltip, which arrives a second late, looks like
 * nothing else in Mono, holds only a line of plain text, and cannot be
 * reached by the pointer to press anything in it. A card here is part of the
 * page: its host is a group (`group/…`) that holds both what is pointed at
 * and the card, the stylesheet shows the card while the group is hovered or
 * holds the focus, and the card touches what opened it, so the pointer can
 * travel from one into the other without a gap that would close it.
 *
 * Where it opens is worked out from the room around it (`placeCard`), as it
 * opens and for as long as it stays open: the calendar's column and the mini
 * window are both small, both scroll, and a card at a fixed size in a fixed
 * direction was cut off by either.
 *
 * Lifted out of the calendar's marks when the mini window wanted the same
 * card for the purpose, so the two cannot come to answer a pointer
 * differently.
 */

import { useCallback, useEffect, useLayoutEffect, useState, type FocusEvent, type RefObject } from 'react'

import { placeCard, type Box } from './Timeline/marks'

/** How the card opens: `beside` its target over what it is on, or above or below it. */
export type CardOptions = {
  beside: boolean
  /** Its size where there is room; smaller where there is not, scrolling inside. */
  size: { width: number; height: number }
  /** Held open whatever the pointer does: an edit under way inside it. */
  held?: boolean
}

/**
 * A card while it is open, kept where it can be seen; returns the handlers its
 * host listens with.
 *
 * Open is one state, however it came about: pointed at, focus inside it — a
 * keyboard reaching what opens it, or a field in it — or held. The card is
 * placed as it opens, in the handler, so the place is there in the frame that
 * first shows it; then again after every commit while it is open, so whatever
 * moved its host is caught — a commitment added beside a block taking it
 * into a narrower lane, the block ending shorter, the tick — and whenever
 * anything it is seen through scrolls or its window is resized. Closed, it
 * neither listens nor measures.
 *
 * Whether it shows is still the stylesheet's (hover, focus within, held),
 * because that cannot be held open by a focus that left without a word: some
 * browsers send no `focusout` when the focused field is removed, as an edit's
 * is on saving. Here that only keeps a hidden card being placed until the next
 * blur. The place is written straight onto the card rather than kept as state:
 * it is measurement, and as state it would cost a second render for each.
 */
export function useOpenCard(
  anchor: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
  card: RefObject<HTMLElement | null>,
  { beside, size, held = false }: CardOptions,
) {
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const open = pointed || focused || held
  const { width, height } = size

  const position = useCallback(() => {
    if (anchor.current && target.current && card.current) {
      positionCard(anchor.current, target.current, card.current, beside, { width, height })
    }
  }, [anchor, target, card, beside, width, height])

  // After every commit, deliberately without dependencies: what moves a host
  // is its own host's layout, which this cannot list.
  useLayoutEffect(() => {
    if (open) position()
  })

  useEffect(() => {
    const doc = anchor.current?.ownerDocument
    const view = doc?.defaultView
    if (!open || !doc || !view) return
    // Capture, since a scroll does not bubble: whichever box scrolls, the
    // card is placed again against what is left in view.
    doc.addEventListener('scroll', position, true)
    view.addEventListener('resize', position)
    return () => {
      doc.removeEventListener('scroll', position, true)
      view.removeEventListener('resize', position)
    }
  }, [open, anchor, position])

  return {
    onPointerEnter: () => {
      position()
      setPointed(true)
    },
    onPointerLeave: () => setPointed(false),
    onFocus: () => {
      position()
      setFocused(true)
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
    },
  }
}

/** The card's own look, the same wherever it opens. */
export const cardClass =
  'absolute z-20 overflow-y-auto rounded-md border border-muted/70 bg-surface-raised px-2 py-1.5 shadow-lg'

/** Place `card`, inside `anchor`, by the room around `target` (`placeCard`). */
function positionCard(
  anchor: HTMLElement,
  target: HTMLElement,
  card: HTMLElement,
  beside: boolean,
  size: { width: number; height: number },
): void {
  const from = anchor.getBoundingClientRect()
  const place = placeCard(target.getBoundingClientRect(), visibleBox(anchor), beside, size)
  card.style.left = `${place.left - from.left}px`
  card.style.width = `${place.width}px`
  card.style.maxHeight = `${place.maxHeight}px`
  card.style.top = place.opens === 'down' ? `${place.edge - from.top}px` : ''
  card.style.bottom = place.opens === 'up' ? `${from.bottom - place.edge}px` : ''
}

/**
 * The part of the page `element` can be seen in: its window, cut down by every
 * box around it that clips what overflows it — the calendar's scrolling
 * column, the mini window's scrolling body. Measured in the element's own
 * document, which for the mini window is not the one this code runs in.
 */
function visibleBox(element: HTMLElement): Box {
  const view = element.ownerDocument.defaultView
  const box: Box = {
    left: 0,
    top: 0,
    right: view?.innerWidth ?? Infinity,
    bottom: view?.innerHeight ?? Infinity,
  }
  for (let node = element.parentElement; node && view; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const rect = node.getBoundingClientRect()
    const left = rect.left + node.clientLeft
    const top = rect.top + node.clientTop
    box.left = Math.max(box.left, left)
    box.top = Math.max(box.top, top)
    box.right = Math.min(box.right, left + node.clientWidth)
    box.bottom = Math.min(box.bottom, top + node.clientHeight)
  }
  return box
}
