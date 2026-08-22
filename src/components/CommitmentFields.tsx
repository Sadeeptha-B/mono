/**
 * What a commitment is, as a form: what, when, how long, and what it costs
 * either side of itself.
 *
 * Two places ask for one — the question the day opens with, and the calendar's
 * composer — and they used to be separate copies of the same form with
 * different labels. They can now be on screen at the same time, so the ids are
 * prefixed rather than fixed: two `id="commitment-time"` inputs would leave the
 * second label pointing at the first field.
 *
 * The before/after pair is folded away by default. Most commitments do not need
 * it, and four number fields in a row is a form rather than a question — but a
 * 4pm swim really does cost the afternoon either side of itself, and until
 * there was somewhere to say so Mono kept offering a block at 3:40.
 *
 * The parent owns the state. What counts as ready differs by caller only in
 * where the submit button sits, but the resolve from wall clock to epoch
 * milliseconds happens here, at the edge, exactly once.
 */

import { useState, type Ref } from 'react'

import { fieldClass, labelClass, MinutesInput } from './ui'
import { COMMITMENT_MINUTES, MARGIN_MINUTES, parseBoundedMinutes } from './minutes'
import { wallClockOn } from '@/domain/time'
import type { Commitment, Ms } from '@/domain/types'

export type CommitmentDraft = {
  title: string
  time: string
  durationText: string
  prepText: string
  recoverText: string
}

export const emptyDraft = (time: string): CommitmentDraft => ({
  title: '',
  time,
  durationText: String(COMMITMENT_MINUTES.fallback),
  prepText: String(MARGIN_MINUTES.fallback),
  recoverText: String(MARGIN_MINUTES.fallback),
})

/**
 * The draft as something the store will take, or null while it is not one yet.
 *
 * `now` is read here on every render and never written back into state, which
 * is the whole trick: it advances every second, and putting it anywhere near a
 * dependency list resets the field being typed into.
 *
 * A zero margin is omitted rather than stored, so a commitment with no travel
 * attached looks exactly like every commitment written before margins existed.
 */
export function readCommitment(
  now: Ms,
  draft: CommitmentDraft,
): Omit<Commitment, 'id'> | null {
  const title = draft.title.trim()
  const startsAt = wallClockOn(now, draft.time)
  const durationMin = parseBoundedMinutes(
    draft.durationText,
    COMMITMENT_MINUTES.min,
    COMMITMENT_MINUTES.max,
  )
  const prepMin = parseMargin(draft.prepText)
  const recoverMin = parseMargin(draft.recoverText)

  if (title.length === 0 || startsAt === null || durationMin === null) return null
  if (prepMin === null || recoverMin === null) return null

  return {
    title,
    startsAt,
    durationMin,
    ...(prepMin === 0 ? {} : { prepMin }),
    ...(recoverMin === 0 ? {} : { recoverMin }),
  }
}

const parseMargin = (raw: string): number | null =>
  parseBoundedMinutes(raw, MARGIN_MINUTES.min, MARGIN_MINUTES.max)

export function CommitmentFields({
  idPrefix,
  titleLabel,
  showTitleLabel = true,
  draft,
  onDraft,
  titleRef,
  large = false,
}: {
  /** Prefixes every id on the fieldset. Must be unique on the page. */
  idPrefix: string
  /** The accessible name of the title field, which differs by surface. */
  titleLabel: string
  /**
   * The opening question already has a heading asking exactly this, so a
   * second uppercase label above the field would only repeat it. There the
   * name is carried by `aria-label` instead.
   */
  showTitleLabel?: boolean
  draft: CommitmentDraft
  onDraft: (draft: CommitmentDraft) => void
  titleRef?: Ref<HTMLInputElement>
  /** The opening question gives the title field more presence than a composer does. */
  large?: boolean
}) {
  // Opened by the user, or already open because the draft arrived carrying
  // margins — editing a commitment that has them must not hide them.
  const [showMargins, setShowMargins] = useState(
    () => draft.prepText !== '0' || draft.recoverText !== '0',
  )

  const patch = (part: Partial<CommitmentDraft>) => onDraft({ ...draft, ...part })

  return (
    <>
      {showTitleLabel && (
        <label className={labelClass} htmlFor={`${idPrefix}-title`}>
          {titleLabel}
        </label>
      )}
      <input
        id={`${idPrefix}-title`}
        ref={titleRef}
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="Daily standup"
        maxLength={80}
        {...(showTitleLabel ? {} : { 'aria-label': titleLabel })}
        className={`${fieldClass} ${large ? 'py-3 text-lg' : ''}`}
      />

      <div className="mt-3 grid max-w-xs grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-time`}>
            At
          </label>
          <input
            id={`${idPrefix}-time`}
            type="time"
            value={draft.time}
            onChange={(e) => patch({ time: e.target.value })}
            className={`${fieldClass} tnum`}
          />
        </div>
        <MinutesInput
          id={`${idPrefix}-duration`}
          label="For (minutes)"
          text={draft.durationText}
          onText={(durationText) => patch({ durationText })}
          {...COMMITMENT_MINUTES}
        />
      </div>

      {showMargins ? (
        <div className="mt-3">
          <div className="grid max-w-xs grid-cols-2 gap-3">
            <MinutesInput
              id={`${idPrefix}-prep`}
              label="Getting ready"
              text={draft.prepText}
              onText={(prepText) => patch({ prepText })}
              {...MARGIN_MINUTES}
            />
            <MinutesInput
              id={`${idPrefix}-recover`}
              label="Getting back"
              text={draft.recoverText}
              onText={(recoverText) => patch({ recoverText })}
              {...MARGIN_MINUTES}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Minutes either side that the commitment really costs — changing,
            travelling, settling back in. Mono keeps them clear too.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowMargins(true)}
          className="mt-3 text-sm text-muted underline underline-offset-4 transition hover:text-bright"
        >
          + Time either side
        </button>
      )}
    </>
  )
}
