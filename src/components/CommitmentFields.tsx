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
 * The fold goes both ways, and closing it clears the two numbers rather than
 * hiding them. A margin still shapes the plan whether or not its field is on
 * screen, so a fold that merely hid a half hour of travel would leave the
 * calendar keeping time clear with nothing on the form to say why — the same
 * invisible-state trap `readCommitmentEdit` exists to avoid at the other end.
 * Folding it away therefore *means* "this costs nothing either side", which is
 * also the only reading under which the summary line above stays true.
 *
 * Which is one half of a rule with two. The other is that the fold is never
 * closed over a margin that exists, whoever put it there — so whether it is
 * open is *derived* from the draft rather than seeded from it. See the note by
 * `expanded`: seeding is right for a form that mounts per commitment, like the
 * calendar's composer, and quietly wrong for one that does not.
 *
 * The parent owns the state. What counts as ready differs by caller only in
 * where the submit button sits, but the resolve from wall clock to epoch
 * milliseconds happens here, at the edge, exactly once.
 */

import { useState, type Ref } from 'react'
import { format } from 'date-fns'

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
 * A draft of a commitment that already exists, for editing it.
 *
 * Back to wall clock, which is the direction `readCommitment` does not go: the
 * store holds an instant, the field holds "HH:mm", and this is the only place
 * that turns one into the other. An absent margin becomes "0" rather than an
 * empty field, so the fieldset shows what the commitment actually costs and
 * the number input has something to step from.
 */
export const draftFromCommitment = (commitment: Commitment): CommitmentDraft => ({
  title: commitment.title,
  time: format(commitment.startsAt, 'HH:mm'),
  durationText: String(commitment.durationMin),
  prepText: String(commitment.prepMin ?? 0),
  recoverText: String(commitment.recoverMin ?? 0),
})

/**
 * Whether two drafts say the same thing.
 *
 * Exists to tell an edit somebody has *changed* from one they merely opened.
 * Those are different things to walk away from: the first is work, and losing
 * it because you glanced at another question is the bug this whole component is
 * arranged to avoid; the second is a form that happens to be showing.
 */
export const draftsMatch = (a: CommitmentDraft, b: CommitmentDraft): boolean =>
  a.title === b.title &&
  a.time === b.time &&
  a.durationText === b.durationText &&
  a.prepText === b.prepText &&
  a.recoverText === b.recoverText

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

/**
 * The same draft, read as an edit to a commitment that already exists.
 *
 * The difference is the one line below, and it is the whole reason this is a
 * separate function. `readCommitment` omits a zero margin, which is right for
 * something new — it then looks exactly like every commitment written before
 * margins existed. It is wrong for an edit: the result is merged onto the
 * commitment it came from, so an omitted `prepMin` keeps the old one. Deleting
 * the half hour of travel would leave the plan still keeping it clear, with the
 * form insisting it was gone.
 */
export function readCommitmentEdit(
  now: Ms,
  draft: CommitmentDraft,
): Omit<Commitment, 'id'> | null {
  const next = readCommitment(now, draft)
  return next === null ? null : { prepMin: 0, recoverMin: 0, ...next }
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
  // What the user asked for, which is not the same question as what is on
  // screen. A draft carrying margins shows them whoever put them there, so the
  // state below is only ever the *extra* case: opened over a draft that has
  // none yet.
  //
  // Derived rather than seeded, and that is the whole of the fix it came from.
  // A seed runs once per mount, and the opening question does not remount this
  // fieldset between commitments — its draft lives in the panel above, and
  // surviving the switch is the point of putting it there. So a form first
  // opened on a new commitment sat collapsed, and pointing it at a 4pm swim
  // with half an hour of travel left that half hour hidden, in a fold whose
  // whole meaning is "this costs nothing either side", still shaping the plan.
  // Exactly the invisible state the fold was made two-way to prevent.
  const [expanded, setExpanded] = useState(false)
  const showMargins = expanded || draft.prepText !== '0' || draft.recoverText !== '0'

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

      {showMargins && (
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
            travelling, settling back in.
          </p>
        </div>
      )}

      {/* One control both ways round. `aria-expanded` is what says it reveals
          the fields below rather than adding a second commitment, and the sign
          is what says it at a glance. */}
      <button
        type="button"
        aria-expanded={showMargins}
        onClick={() => {
          // Closing has to clear as well as fold, and now it has to do both for
          // a second reason: with the fields derived, a margin left in the
          // draft would simply open them again on the next render.
          if (showMargins) {
            patch({ prepText: '0', recoverText: '0' })
            setExpanded(false)
          } else {
            setExpanded(true)
          }
        }}
        className="mt-3 text-sm text-muted underline underline-offset-4 transition hover:text-bright"
      >
        {showMargins ? '−' : '+'} Time either side
      </button>
    </>
  )
}
