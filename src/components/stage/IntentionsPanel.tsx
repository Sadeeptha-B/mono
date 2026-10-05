/**
 * The third opening question: what is today for?
 *
 * Asked last because it is the one answer that depends on the other two —
 * what you mean to do with a day is only honest once you know how much of it
 * is yours — and the question says how much that is.
 *
 * It carries its own timer. Unlike a commitment, an intention is always there
 * to be found: a day with nothing fixed in it is ordinary, a day with nothing
 * meant by it is not. What can go wrong instead is the opposite of the empty
 * answer, which is sitting here for half an hour polishing a list. So the
 * question gives itself a few minutes, starts counting the first time it is
 * asked, and at zero stops and asks whether you want longer. It never finishes
 * the setup for you, and it records nothing.
 *
 * That is why it is a timer on the question rather than a priorities block,
 * which was the other way to build it. A block is recorded, costs plan time and
 * arms site blocking, and it can only run inside working hours — while this
 * question is most often asked at half past eight, before they start. The
 * timer's instants live in `App`, beside which question is on screen, and the
 * face is derived from them and `now` like every other timer here.
 *
 * The drafts are not here. They live in `DaySetupPanel`, which stays mounted
 * while the user moves between the questions, for the reason its own header
 * gives: nothing typed is lost by changing your mind about which question to
 * answer first.
 */

import { unlockAudio } from '@/ambient/audio'
import { EditGlyph, fieldClass, GhostButton, InlineSelect, StagePrompt } from '../ui'
import { formatDuration, formatTimer } from '@/domain/time'
import type { Place } from '@/domain/tasks'
import type { Intention, IntentionLink, IntentionPatch, Ms } from '@/domain/types'

/** The two instants the intentions timer runs between. */
export type IntentionTimer = { startedAt: Ms; endsAt: Ms }

/** What is being typed: a new intention, or an edit to one already named. */
/** `placeId` is the area, epic or outcome the intention points at, if any. */
export type IntentionDraft = { title: string; placeId: string | null; editing: string | null }

export const emptyIntentionDraft: IntentionDraft = { title: '', placeId: null, editing: null }

export function IntentionsPanel({
  now,
  eyebrow,
  timer,
  minutes,
  onStartTimer,
  planned,
  intentions,
  places,
  draft,
  onDraft,
  onAdd,
  onUpdate,
  onRemove,
}: {
  now: Ms
  eyebrow: string
  /** Null until it has been started, which on a re-visit is only by hand. */
  timer: IntentionTimer | null
  /** The setting, for the label on the button that starts another round. */
  minutes: number
  onStartTimer: () => void
  /** What the day can still hold, as context for what to intend. */
  planned: { blocks: number; minutes: number }
  intentions: readonly Intention[]
  /**
   * Everywhere an intention may point: areas, open epics and open outcomes, as
   * full paths. Empty until the backlog has loaded.
   */
  places: readonly Place[]
  draft: IntentionDraft
  onDraft: (draft: IntentionDraft) => void
  onAdd: (input: Omit<Intention, 'id'>) => void
  onUpdate: (id: string, patch: IntentionPatch) => void
  onRemove: (id: string) => void
}) {
  const title = draft.title.trim()
  const place = places.find((p) => p.id === draft.placeId)
  // A place is only ever an area, an epic or an outcome — tasks are never
  // offered — so its kind is always one a link can carry.
  const link: IntentionLink | null =
    place && place.kind !== 'task' ? { kind: place.kind, id: place.id } : null

  const submit = () => {
    if (!title) return
    // A gesture, which is the only time a browser lets audio start. Without it
    // the chime at the end of this question could never be heard on a day's
    // first visit, because nothing before it has been clicked.
    void unlockAudio()
    if (draft.editing) onUpdate(draft.editing, { title, link })
    else onAdd({ title, ...(link ? { link } : {}) })
    // An area stays chosen: the next intention is usually from the same part of
    // life as the last one. An epic or outcome does not — two intentions about
    // the same epic are rare, and a link carried over unnoticed would file the
    // next one somewhere it does not belong.
    onDraft({ ...emptyIntentionDraft, placeId: place?.kind === 'area' ? place.id : null })
  }

  const startEditing = (intention: Intention) =>
    onDraft({
      title: intention.title,
      placeId: intention.link?.id ?? null,
      editing: intention.id,
    })

  return (
    <>
      <StagePrompt
        eyebrow={eyebrow}
        title="What do you intend today?"
        detail={capacityDetail(planned)}
      />

      <IntentionsClock
        now={now}
        timer={timer}
        minutes={minutes}
        onStart={() => {
          void unlockAudio()
          onStartTimer()
        }}
      />

      {intentions.length > 0 && (
        <ul aria-label="Intended today" className="mb-4 flex flex-col gap-1.5">
          {intentions.map((intention) => (
            <IntentionRow
              key={intention.id}
              intention={intention}
              placeName={placeName(intention.link, places)}
              editing={intention.id === draft.editing}
              onEdit={() => startEditing(intention)}
              onRemove={() => {
                if (draft.editing === intention.id) onDraft(emptyIntentionDraft)
                onRemove(intention.id)
              }}
            />
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          value={draft.title}
          onChange={(e) => onDraft({ ...draft, title: e.target.value })}
          placeholder="Handle the billing ticket"
          aria-label={draft.editing ? 'This intention' : 'Next intention'}
          maxLength={120}
          className={`${fieldClass} py-3 text-lg`}
        />

        {/* An optional pointer into the backlog: an area, or an epic or
            outcome by its path. A select, because once epics exist there can be
            dozens of places, and a row of chips that long is a list to read. */}
        {places.length > 0 && (
          <div className="mt-3 text-xs">
            <InlineSelect
              label="What this intention is part of"
              prefix="Part of"
              value={draft.placeId ?? ''}
              onChange={(value) => onDraft({ ...draft, placeId: value === '' ? null : value })}
              options={[
                { value: '', name: 'Nothing in particular' },
                ...places.map((p) => ({ value: p.id, name: p.label })),
              ]}
              wide
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <GhostButton type="submit" disabled={!title}>
            {draft.editing ? 'Save intention' : 'Add intention'}
          </GhostButton>
          {draft.editing && (
            <GhostButton type="button" onClick={() => onDraft(emptyIntentionDraft)}>
              Cancel
            </GhostButton>
          )}
        </div>
      </form>
    </>
  )
}

/**
 * The timer's face: counting, run out, or not yet started.
 *
 * Run out is the interesting state, and it is quiet on purpose. Nothing is
 * taken away and nothing moves on; the time is simply up, and the one control
 * offered is another round of it. A question that hurried you along would be
 * the app deciding your intentions were finished, which is not its call.
 */
function IntentionsClock({
  now,
  timer,
  minutes,
  onStart,
}: {
  now: Ms
  timer: IntentionTimer | null
  minutes: number
  onStart: () => void
}) {
  const remaining = timer === null ? null : timer.endsAt - now
  const running = remaining !== null && remaining > 0

  return (
    <div className="mb-4 flex items-center gap-3 text-sm" aria-live="polite">
      {running ? (
        <>
          <span className="tnum text-bright" aria-label="Time left for intentions">
            {formatTimer(remaining)}
          </span>
          <span className="text-muted">to name what today is for</span>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onStart}
            aria-label={`Give it ${minutes} minutes`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-muted/70 text-body transition hover:bg-surface-raised hover:text-bright"
          >
            ▶
          </button>
          <span className="text-muted">
            {timer === null
              ? `Give it ${minutes} minutes`
              : `Time's up. Another ${minutes} minutes?`}
          </span>
        </>
      )}
    </div>
  )
}

function IntentionRow({
  intention,
  placeName,
  editing,
  onEdit,
  onRemove,
}: {
  intention: Intention
  placeName: string | null
  editing: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <li
      className={`flex items-baseline gap-3 rounded-lg border px-3 py-2 ${
        editing ? 'border-bright/60' : 'border-muted/70'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-bright">{intention.title}</div>
        {placeName && <div className="truncate text-xs text-muted">{placeName}</div>}
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${intention.title}`}
        className="shrink-0 text-muted transition hover:text-bright"
      >
        <EditGlyph />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${intention.title}`}
        className="shrink-0 text-muted transition hover:text-commit"
      >
        ×
      </button>
    </li>
  )
}

/**
 * What a linked intention points at, by its path. A link to something since
 * finished, archived or deleted shows nothing rather than an id: the intention
 * still stands, only its pointer has gone quiet.
 */
function placeName(link: IntentionLink | undefined, places: readonly Place[]): string | null {
  if (!link) return null
  return places.find((p) => p.id === link.id)?.label ?? null
}

function capacityDetail(planned: { blocks: number; minutes: number }): string {
  if (planned.blocks === 0) {
    return 'A few broad strokes. There is no focus time left in the plan, so keep it short.'
  }
  return `A few broad strokes, not a list. The plan has room for ${planned.blocks} block${
    planned.blocks === 1 ? '' : 's'
  } — ${formatDuration(planned.minutes * 60_000)} of focus.`
}
