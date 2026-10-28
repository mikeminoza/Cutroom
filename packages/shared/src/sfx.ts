// The editing sound effects, synthesised rather than recorded: no licences and no binary files,
// and the render (as WAV files) and the browser preview (as audio buffers) play the same samples.
import type { AccentEvent } from './accents'

export type SoundName = 'whoosh' | 'swish' | 'thud'

export const SFX_RATE = 48_000
/** How loud the effects sit under the voice (their samples peak at 0.9). */
export const SFX_LEVEL = 0.35

/** Each sound's length, and when it is loudest (seconds from its start). */
export const SOUNDS: Record<SoundName, { seconds: number; peak: number }> = {
  // A whip: rising air that is loudest where the slide lands.
  whoosh: { seconds: 0.35, peak: 0.24 },
  // A zoom-cut: a short, bright swish, loudest on the zoom frame.
  swish: { seconds: 0.16, peak: 0.07 },
  // A shake: a low impact, at once.
  thud: { seconds: 0.35, peak: 0.004 },
}

/** Seeded noise (mulberry32): the same samples every time. */
function noise(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/** Noise through a band-pass filter sweeping `from` → `to` Hz up to the peak, then a little back. */
function air(
  rate: number,
  sound: { seconds: number; peak: number },
  band: { from: number; to: number; q: number },
  seed: number,
): Float32Array {
  const n = Math.round(sound.seconds * rate)
  const out = new Float32Array(n)
  const random = noise(seed)
  // A state-variable filter (stable while the frequency moves).
  let ic1 = 0
  let ic2 = 0
  const k = 1 / band.q
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const rise = Math.min(1, t / sound.peak)
    const frequency =
      t <= sound.peak
        ? band.from + (band.to - band.from) * rise ** 1.5
        : band.to - (band.to - band.from) * 0.3 * ((t - sound.peak) / (sound.seconds - sound.peak))
    const g = Math.tan((Math.PI * Math.min(frequency, rate * 0.45)) / rate)
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2
    const v3 = random() - ic2
    const v1 = a1 * ic1 + a2 * v3
    const v2 = ic2 + a2 * ic1 + a3 * v3
    ic1 = 2 * v1 - ic1
    ic2 = 2 * v2 - ic2
    // Swells in smoothly, then dies away, reaching silence at the very end.
    const envelope =
      t <= sound.peak
        ? Math.sin((Math.PI / 2) * rise) ** 2
        : Math.exp((-4 * (t - sound.peak)) / (sound.seconds - sound.peak)) *
          Math.min(1, (sound.seconds - t) / 0.01)
    out[i] = v1 * envelope
  }
  return out
}

/** A sine dropping from 140 to 45 Hz, with a short click of noise on top: an impact. */
function impact(rate: number, sound: { seconds: number }): Float32Array {
  const n = Math.round(sound.seconds * rate)
  const out = new Float32Array(n)
  const random = noise(7)
  let phase = 0
  let click = 0
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const frequency = 45 + 95 * Math.exp(-25 * t)
    phase += (2 * Math.PI * frequency) / rate
    const attack = Math.min(1, t / 0.002)
    const tail = Math.min(1, (sound.seconds - t) / 0.01)
    // One-pole low-pass keeps the click from hissing.
    click += 0.35 * (random() - click)
    out[i] = (Math.sin(phase) * Math.exp(-9 * t) + 0.5 * click * Math.exp(-400 * t)) * attack * tail
  }
  return out
}

/** Scales a sound so it peaks at 0.9. */
function normalize(samples: Float32Array): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] / peak) * 0.9
  return samples
}

/** The samples of a sound (mono, at `rate`). The same every call. */
export function synthesize(name: SoundName, rate = SFX_RATE): Float32Array {
  const sound = SOUNDS[name]
  return normalize(
    name === 'whoosh'
      ? air(rate, sound, { from: 350, to: 2200, q: 1.1 }, 1)
      : name === 'swish'
        ? air(rate, sound, { from: 2200, to: 6500, q: 1.4 }, 2)
        : impact(rate, sound),
  )
}

export interface SoundEvent {
  sound: SoundName
  /** When the sound starts, in seconds on the timeline. */
  start: number
}

/**
 * The sounds under the edit: a whoosh from each whip's cut, a swish whose loudest point lands on
 * each zoom-cut, and a thud as each shake starts.
 */
export function sfxEvents(whips: number[], accents: AccentEvent[]): SoundEvent[] {
  const events: SoundEvent[] = [
    ...whips.map((time) => ({ sound: 'whoosh' as const, start: time })),
    ...accents.map((a) =>
      a.kind === 'zoom'
        ? { sound: 'swish' as const, start: a.time - SOUNDS.swish.peak }
        : { sound: 'thud' as const, start: a.time },
    ),
  ]
  return events.map((e) => ({ ...e, start: Math.max(0, e.start) })).sort((a, b) => a.start - b.start)
}

/** A 16-bit mono PCM WAV file of `samples`. */
export function wavBytes(samples: Float32Array, rate = SFX_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true)
  })
  return bytes
}
