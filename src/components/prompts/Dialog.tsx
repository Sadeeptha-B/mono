/**
 * The shared dialog shell.
 *
 * Mono is mostly dialogs interrupting a timer, so these are built on Radix
 * primitives rather than hand-rolled: focus trapping, escape handling, scroll
 * locking and the aria wiring all matter and are all easy to get subtly wrong.
 *
 * Most of Mono's prompts are *not* dismissible. "Did you finish this block?"
 * has no correct default answer, so there is no close button and escape does
 * nothing — the user has to say what happened. The close control appears only
 * when `onDismiss` is given, which is what keeps that promise: a dialog either
 * offers every way out or none of them.
 *
 * The card is bounded by the viewport rather than by its content: the title
 * stays put and the body scrolls. Settings is long enough to overflow a laptop
 * in landscape, and a dialog that runs off the bottom of the screen hides its
 * own Done button.
 */

import * as RadixDialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  /** Omit to make the dialog unskippable. */
  onDismiss?: (() => void) | undefined
}

export function Dialog({ open, title, description, children, onDismiss }: Props) {
  const dismissible = onDismiss !== undefined

  return (
    <RadixDialog.Root open={open}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/80 backdrop-blur-sm" />
        <RadixDialog.Content
          onEscapeKeyDown={(e) => (dismissible ? onDismiss?.() : e.preventDefault())}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <div className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="flex items-start justify-between gap-4">
              <RadixDialog.Title className="text-lg font-medium text-bright">
                {title}
              </RadixDialog.Title>

              {dismissible && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Close"
                  className="-mt-1 -mr-1.5 shrink-0 rounded-md p-1.5 text-muted transition hover:bg-surface-raised hover:text-bright"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M4 4 L12 12 M12 4 L4 12" />
                  </svg>
                </button>
              )}
            </div>

            {description ? (
              <RadixDialog.Description className="mt-1.5 text-sm leading-relaxed text-muted">
                {description}
              </RadixDialog.Description>
            ) : (
              // Radix warns without a description; this keeps the tree valid
              // without inventing copy the design does not want.
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>

          <DialogBody>{children}</DialogBody>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/**
 * The scrolling half of the card.
 *
 * It lives in its own component because Radix unmounts the content when the
 * dialog closes, so this is the only place a ref to the viewport is reliably
 * non-null on mount.
 */
function DialogBody({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ atTop: true, atBottom: true })

  const measure = useCallback(() => {
    const el = viewport.current
    if (!el) return
    // A pixel of slack: fractional scroll positions mean the arithmetic rarely
    // lands exactly on the boundary.
    const atTop = el.scrollTop <= 1
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
    setEdges((prev) =>
      prev.atTop === atTop && prev.atBottom === atBottom ? prev : { atTop, atBottom },
    )
  }, [])

  useEffect(() => {
    measure()
    // The content grows and shrinks under the user — adding a working-hours
    // stretch, a validation line appearing — so watch both boxes rather than
    // measuring once.
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewport}
        onScroll={measure}
        className="mono-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-5 sm:px-6 sm:pb-6"
      >
        <div ref={content}>{children}</div>
      </div>

      {/* Hairlines rather than gradients: the rest of the app draws its
          divisions with a 1px line, and a fade would be the only blur in it. */}
      <ScrollEdge show={!edges.atTop} className="top-0" />
      <ScrollEdge show={!edges.atBottom} className="bottom-0" />
    </div>
  )
}

function ScrollEdge({ show, className }: { show: boolean; className: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 h-px bg-line transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  )
}
