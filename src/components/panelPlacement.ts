/**
 * Where a floating panel goes across, given the button it hangs from and the
 * room it may use.
 *
 * `TaskTreePicker` drops its panel from a button that sits after a word of
 * prefix, so the button can start a long way across a phone screen. Pinned to
 * the button's left edge with a width that only knew the viewport, the panel
 * ran off the right of a 375-pixel screen, widened the page, and put its ✎ and
 * × out of reach. The width cap has to know where the panel starts.
 *
 * So the rule is the dropdown one: hang from the button's left edge while
 * there is room for a usable panel to the right of it, narrowed to what is
 * there; otherwise line its right edge up with the right of the room and let it
 * grow leftwards. "The room" is the viewport less a gutter, narrowed further by
 * whatever scrolls the panel, since a panel past the edge of a scroller widens
 * that scroller instead. Pure, so it is tested without a browser; reading the
 * rectangles is the caller's job.
 */

/** A horizontal span in viewport pixels. */
export type Span = { left: number; right: number }

export type Across =
  /** Offsets are from the button's own edges, for an absolutely placed panel. */
  | { side: 'left'; offset: 0; minWidth: number; maxWidth: number }
  | { side: 'right'; offset: number; minWidth: number; maxWidth: number }

/** Narrower than this and a panel's rows stop being usable. */
export const PANEL_MIN_WIDTH = 256
/** Wider than this and a panel stops reading as a dropdown. */
export const PANEL_MAX_WIDTH = 416

export function placeAcross(anchor: Span, room: Span): Across {
  const available = Math.max(0, room.right - room.left)
  const minWidth = Math.min(PANEL_MIN_WIDTH, available)
  const toTheRight = room.right - anchor.left

  if (toTheRight >= minWidth && anchor.left >= room.left) {
    return { side: 'left', offset: 0, minWidth, maxWidth: Math.min(PANEL_MAX_WIDTH, toTheRight) }
  }
  // The panel's right edge at the room's right edge, as an offset from the
  // button's: negative when the room ends to the right of the button.
  return {
    side: 'right',
    offset: anchor.right - room.right,
    minWidth,
    maxWidth: Math.min(PANEL_MAX_WIDTH, available),
  }
}

/**
 * The room a panel drawn under this element may use: the viewport less a
 * gutter, and the inside of every scroller around it.
 */
export function roomFor(element: Element, gutter: number): Span {
  const doc = element.ownerDocument
  const view = doc.defaultView
  const room = { left: gutter, right: doc.documentElement.clientWidth - gutter }
  for (let at = element.parentElement; at && view; at = at.parentElement) {
    const style = view.getComputedStyle(at)
    const scrolls = [style.overflowX, style.overflowY].some((o) => o !== 'visible' && o !== 'clip')
    if (!scrolls) continue
    const box = at.getBoundingClientRect()
    const inner = box.left + at.clientLeft
    room.left = Math.max(room.left, inner)
    room.right = Math.min(room.right, inner + at.clientWidth)
  }
  return room
}
