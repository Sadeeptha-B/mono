/**
 * Minutes typed into a form field.
 *
 * `min` and `max` on a number input are advice, not enforcement: the spinner
 * respects them and the keyboard does not, so a duration of 9999 reached the
 * planner from a field that advertised a ceiling of 480. Parsing is separated
 * from coercing because a field being edited and a field being left are
 * different moments — mid-edit, out of range means "not valid yet"; on the way
 * out, it means "put it back inside the range".
 */

/** The bounds each duration field advertises, in one place per concept. */
export const COMMITMENT_MINUTES = { min: 5, max: 480, fallback: 30 } as const
export const BREAK_MINUTES = { min: 5, max: 240, fallback: 15 } as const
/**
 * The time either side of a commitment. Zero is the common answer and a
 * perfectly good one, which is the whole difference from the two above — a
 * commitment of no length is a mistake, an hour that needs no travel is not.
 */
export const MARGIN_MINUTES = { min: 0, max: 240, fallback: 0 } as const

/** The value if it is usable as-is, or null while it is not. */
export function parseBoundedMinutes(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null

  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) return null
  if (parsed < min || parsed > max) return null
  return parsed
}

/** The nearest usable value, as text for the field to show. */
export function coerceBoundedMinutes(
  raw: string,
  fallback: number,
  min: number,
  max: number,
): string {
  if (raw.trim() === '') return String(fallback)

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return String(fallback)

  return String(Math.min(max, Math.max(min, Math.round(parsed))))
}
