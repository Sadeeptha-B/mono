/**
 * The speaker in either timer surface, and the only mute the user ever sees.
 *
 * It renders nothing unless a sound is actually resolved *and* a block is
 * running, so it is absent through breaks, prompts and the idle stage rather
 * than sitting there greyed out. There is nothing to mute in those states, and
 * a control that is present but inert only invites the question of what it
 * would have done.
 *
 * `Resume ambience` is not a second feature. A browser will not start an
 * AudioContext without a gesture, so a tab reloaded part-way through a block
 * holds the intent but not the permission; the button says so and asks for the
 * click, which is the honest version of an autoplay workaround. Both surfaces
 * read one hook, so muting from the mini window shows here and the reverse.
 */

import type { AmbienceControls } from './useAmbience'

export function AmbienceButton({ ambience }: { ambience: AmbienceControls }) {
  if (!ambience.available) return null
  const label = ambience.paused ? 'Resume ambience' : 'Mute ambience'
  return (
    <button
      type="button"
      onClick={ambience.toggle}
      aria-label={label}
      title={label}
      // Matches GhostButton's current text-sm + px-4 + py-2.5 footprint so the
      // icon and adjacent action sit on one baseline. Revisit this size if that
      // shared button padding changes.
      className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg border border-line text-body transition hover:bg-surface-raised hover:text-bright"
    >
      <svg
        viewBox="0 0 20 20"
        className="h-4.5 w-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3.5 8h3l4-3.5v11l-4-3.5h-3z" />
        {ambience.paused ? (
          <path d="m14 8 3 4m0-4-3 4" />
        ) : (
          <path d="M13.5 7a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" />
        )}
      </svg>
    </button>
  )
}
