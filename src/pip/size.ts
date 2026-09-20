/**
 * The opening size and the range in which the mini window feels like a compact
 * companion. Document PiP lets Chromium own the user's drag, so these are a
 * guide for offering a gesture-driven reset, not window constraints or the
 * smallest size at which the scrolling content still works.
 */
export const MINI_WINDOW_SIZE = { width: 470, height: 210 } as const

export const MINI_WINDOW_RANGE = {
  minWidth: 320,
  minHeight: 160,
  maxWidth: 520,
  maxHeight: 420,
} as const

export const outsideMiniWindowRange = (width: number, height: number): boolean =>
  width < MINI_WINDOW_RANGE.minWidth ||
  height < MINI_WINDOW_RANGE.minHeight ||
  width > MINI_WINDOW_RANGE.maxWidth ||
  height > MINI_WINDOW_RANGE.maxHeight
