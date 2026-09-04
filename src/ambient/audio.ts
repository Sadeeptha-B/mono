/**
 * The one audio engine shared by the completion chime and ambient rooms.
 *
 * AudioContext is created only inside a user gesture. Ambience intent may be
 * declared before that (notably after restoring a running block), and is
 * reconciled as soon as Resume supplies the gesture the browser requires.
 */

import type { AmbienceKind } from './rooms'

type Voice = { kind: AmbienceKind; source: AudioBufferSourceNode; gain: GainNode }
type Snapshot = 'locked' | 'running' | 'suspended'

let context: AudioContext | null = null
let chimeBus: GainNode | null = null
let ambienceBus: GainNode | null = null
let voice: Voice | null = null
const buffers = new Map<AmbienceKind, AudioBuffer>()
let desired: { kind: AmbienceKind | null; volume: number; muted: boolean } = {
  kind: null,
  volume: 0.35,
  muted: false,
}
let previewTimer: number | null = null
let preview: { kind: AmbienceKind; volume: number } | null = null
const listeners = new Set<() => void>()

const snapshot = (): Snapshot =>
  context === null ? 'locked' : context.state === 'running' ? 'running' : 'suspended'

const announce = () => listeners.forEach((listener) => listener())

export const subscribeAudio = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const audioSnapshot = (): Snapshot => snapshot()

function ensureContext(): AudioContext | null {
  if (context) return context
  const Ctor = window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  context = new Ctor()
  chimeBus = context.createGain()
  ambienceBus = context.createGain()
  chimeBus.connect(context.destination)
  ambienceBus.connect(context.destination)
  context.addEventListener('statechange', announce)
  return context
}

export async function unlockAudio(): Promise<void> {
  const audio = ensureContext()
  if (!audio) return
  if (audio.state === 'suspended') await audio.resume()
  reconcile(0.15)
  announce()
}

/** The stored linear value becomes a quieter, more useful perceptual curve. */
export const ambienceGainFor = (volume: number): number =>
  Math.min(1, Math.max(0, volume)) ** 2 * 0.35

export function setAmbienceIntent(
  kind: AmbienceKind | null,
  volume: number,
  muted: boolean,
): void {
  // A real running-block intent supersedes an idle preview. Otherwise starting
  // work during those six seconds would make Mute wait for the preview timer.
  if (kind !== null && preview !== null) {
    preview = null
    if (previewTimer !== null) window.clearTimeout(previewTimer)
    previewTimer = null
  }
  const previousKind = desired.kind
  desired = { kind, volume, muted }
  const fade =
    kind === null ? 0.8 : previousKind === null ? 1.5 : previousKind === kind ? 0.15 : 0.25
  reconcile(fade)
}

/** Adjust the current graph without turning a range drag into stored events. */
export function setLiveAmbienceVolume(volume: number): void {
  desired = { ...desired, volume }
  if (preview !== null) preview = { ...preview, volume }
  reconcile(0.05)
}

export async function previewAmbience(kind: AmbienceKind | null, volume: number): Promise<void> {
  if (previewTimer !== null) window.clearTimeout(previewTimer)
  if (kind === null) {
    preview = null
    setAmbienceIntent(null, volume, desired.muted)
    return
  }
  await unlockAudio()
  preview = { kind, volume }
  reconcile(0.25)
  previewTimer = window.setTimeout(() => {
    previewTimer = null
    preview = null
    reconcile(0.8)
  }, 6000)
}

function reconcile(fadeSeconds: number): void {
  if (!context || !ambienceBus || context.state !== 'running') return
  const now = context.currentTime
  const effectiveKind = preview?.kind ?? desired.kind
  const effectiveVolume = preview?.volume ?? desired.volume
  const target = effectiveKind === null || (preview === null && desired.muted)
    ? 0.0001
    : ambienceGainFor(effectiveVolume)
  ambienceBus.gain.cancelScheduledValues(now)
  ambienceBus.gain.setValueAtTime(Math.max(0.0001, ambienceBus.gain.value), now)
  ambienceBus.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), now + fadeSeconds)

  if (effectiveKind === null) {
    retireVoice(voice, fadeSeconds)
    voice = null
    return
  }
  if (voice?.kind === effectiveKind) return

  const previous = voice
  const source = context.createBufferSource()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()
  source.buffer = makeBuffer(context, effectiveKind)
  source.loop = true
  filter.type = effectiveKind === 'rain' ? 'highpass' : 'lowpass'
  filter.frequency.value = effectiveKind === 'brown' ? 850 : effectiveKind === 'pink' ? 3200 : 700
  filter.Q.value = effectiveKind === 'rain' ? 0.45 : 0.2
  gain.gain.value = previous ? 0.0001 : 1
  source.connect(filter).connect(gain).connect(ambienceBus)
  source.start()
  if (previous) {
    gain.gain.exponentialRampToValueAtTime(1, now + fadeSeconds)
  }
  voice = { kind: effectiveKind, source, gain }
  retireVoice(previous, fadeSeconds)
}

function retireVoice(old: Voice | null, seconds: number): void {
  if (!old || !context) return
  const now = context.currentTime
  old.gain.gain.cancelScheduledValues(now)
  old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), now)
  old.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
  old.source.stop(now + seconds + 0.05)
}

/** Seeded noise means room changes never depend on random application state. */
function makeBuffer(audio: AudioContext, kind: AmbienceKind): AudioBuffer {
  const cached = buffers.get(kind)
  if (cached) return cached

  const length = audio.sampleRate * 8
  const buffer = audio.createBuffer(2, length, audio.sampleRate)
  let seed = kind === 'brown' ? 19 : kind === 'pink' ? 37 : 71

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    let brown = 0
    let pink = 0
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const white = (seed / 0xffffffff) * 2 - 1
      brown = brown * 0.985 + white * 0.015
      pink = pink * 0.82 + white * 0.18
      data[i] = kind === 'brown' ? brown * 2.5 : kind === 'pink' ? pink * 0.72 : pink * 0.45 + white * 0.08
    }
    // Join the loop at equal samples; coloured noise hides the very short
    // interpolation while avoiding a discontinuity click every eight seconds.
    const edge = Math.min(2048, Math.floor(length / 8))
    const first = data[0] ?? 0
    for (let i = 0; i < edge; i += 1) {
      const at = length - edge + i
      const mix = i / Math.max(1, edge - 1)
      data[at] = (data[at] ?? 0) * (1 - mix) + first * mix
    }
  }
  buffers.set(kind, buffer)
  return buffer
}

/** A separate bus keeps an ambience mute from swallowing the completion cue. */
export function playChime(): void {
  if (!context || !chimeBus || context.state !== 'running') return
  const now = context.currentTime
  for (const [index, frequency] of [660, 880].entries()) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'sine'
    osc.frequency.value = frequency
    const start = now + index * 0.18
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
    osc.connect(gain).connect(chimeBus)
    osc.start(start)
    osc.stop(start + 0.5)
  }
}
