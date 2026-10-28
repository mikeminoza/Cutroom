// Accents: a zoom-cut to a detail of the picture on a key word, and a short camera shake on a
// punchline. The ffmpeg render and the browser preview share these numbers, so both play the same.
import type { Accent, Word } from './types'

/** A zoom-cut jumps the framing in this much around the anchor and holds it to the picture's end. */
export const ZOOM_CUT = 1.4
/** Scenes shorter than this get no zoom-cut: it would flicker. */
export const ZOOM_MIN_SCENE = 1.2
/** A zoom-cut lands at least this long after its scene starts and before it ends. */
export const ZOOM_AFTER_START = 0.4
export const ZOOM_BEFORE_END = 0.5

/** A shake settles over this long. */
export const SHAKE_SECONDS = 0.4
/** Scenes shorter than this get no shake. */
export const SHAKE_MIN_SCENE = 0.5
/**
 * The shake: `amplitude` of the frame width sideways (and `ratioY` of that up and down) at `fx` and
 * `fy` Hz, dying away at e^(−decay·t). The framing grows by `grow`·e^(−decay·t) meanwhile, so the
 * picture's edges never show: the margin shrinks exactly as fast as the shake.
 */
export const SHAKE = { amplitude: 0.018, ratioY: 0.6, fx: 11, fy: 8.5, decay: 8, grow: 0.04 }

/** The AI's spacing: a chatty model can't over-edit (see spaceEffects). */
export const SHAKE_GAP = 15
export const WHIP_GAP = 20

export interface AccentEvent {
  kind: 'zoom' | 'shake'
  /** Seconds on the timeline. */
  time: number
  /** Index of the scene it belongs to. */
  scene: number
}

export interface AccentScene {
  start: number
  end: number
  accent: Accent
  accentWord: string
}

/** A word reduced to its letters and digits, for matching ("Bang!" = "bang"). */
const token = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * When each scene's accent plays. A scene runs from its start to the next scene's start (the
 * first from 0, the last to `duration`), as the render lays them out. The moment is the start of
 * the first caption word in the scene matching `accentWord` (case and punctuation ignored; a few
 * words match as a run), else the scene's start for a shake and its middle for a zoom; then it is
 * kept clear of the cuts. Scenes too short for their accent get none.
 */
export function accentEvents(scenes: AccentScene[], words: Word[], duration: number): AccentEvent[] {
  const events: AccentEvent[] = []
  scenes.forEach((scene, i) => {
    if (scene.accent !== 'zoom' && scene.accent !== 'shake') return
    const start = i === 0 ? 0 : scene.start
    const end = i < scenes.length - 1 ? scenes[i + 1].start : duration
    const length = end - start
    const zoom = scene.accent === 'zoom'
    if (length < (zoom ? ZOOM_MIN_SCENE : SHAKE_MIN_SCENE)) return
    const matched = wordTime(scene.accentWord, words, start, end)
    const time = matched ?? (zoom ? (start + end) / 2 : start)
    const lo = zoom ? start + ZOOM_AFTER_START : start
    const hi = zoom ? end - ZOOM_BEFORE_END : end - SHAKE_SECONDS
    events.push({ kind: scene.accent, time: Math.min(hi, Math.max(lo, time)), scene: i })
  })
  return events
}

/** Start of the first run of words between `start` and `end` matching `phrase`, or null. */
function wordTime(phrase: string, words: Word[], start: number, end: number): number | null {
  const wanted = phrase.split(/\s+/).map(token).filter(Boolean)
  if (wanted.length === 0) return null
  const inside = words.filter((w) => w.start >= start - 0.05 && w.start < end)
  for (let i = 0; i + wanted.length <= inside.length; i++) {
    if (wanted.every((t, j) => token(inside[i + j].text) === t)) return inside[i].start
  }
  return null
}

/** True when `phrase` matches a run of words in `narration` (the AI's accent word is checked). */
export function narrationHas(narration: string, phrase: string): boolean {
  const words = narration.split(/\s+/).map((text, i) => ({ text, start: i, end: i + 1 }))
  return wordTime(phrase, words, 0, words.length) !== null
}

/** The shake at `t` seconds after it starts: offsets as shares of the frame width, and the growth. */
export function shakeAt(t: number): { dx: number; dy: number; grow: number } {
  if (!(t >= 0 && t < SHAKE_SECONDS)) return { dx: 0, dy: 0, grow: 1 }
  const fade = Math.exp(-SHAKE.decay * t)
  return {
    dx: SHAKE.amplitude * Math.sin(2 * Math.PI * SHAKE.fx * t) * fade,
    dy: SHAKE.ratioY * SHAKE.amplitude * Math.cos(2 * Math.PI * SHAKE.fy * t) * fade,
    grow: 1 + SHAKE.grow * fade,
  }
}

/**
 * The part of the (already moving) picture the accents show, in its own pixels: `left`, `top`,
 * and `scale`, the shown width over the full width. `zoom` is the zoom-cut's anchor in pixels when
 * one is on; `shakes` are the seconds since each running shake began. The render builds the same
 * window as ffmpeg expressions (motionFilter in apps/worker/src/render/render.ts).
 */
export function accentWindow(
  zoom: { x: number; y: number } | null,
  shakes: number[],
  width: number,
  height: number,
): { left: number; top: number; scale: number } {
  const s = zoom ? 1 / ZOOM_CUT : 1
  let grow = 1
  let dx = 0
  let dy = 0
  for (const t of shakes) {
    const shake = shakeAt(t)
    grow += shake.grow - 1
    dx += shake.dx
    dy += shake.dy
  }
  const scale = s / grow
  const zx = zoom?.x ?? 0
  const zy = zoom?.y ?? 0
  return {
    left: zx * (1 - s) + ((width * s) / 2) * (1 - 1 / grow) - dx * width * scale,
    top: zy * (1 - s) + ((height * s) / 2) * (1 - 1 / grow) - dy * width * scale,
    scale,
  }
}

export interface EffectScene {
  start: number
  transition: string
  accent: Accent
}

/**
 * Keeps the AI's effects rare: shakes at least SHAKE_GAP seconds apart, whips at least WHIP_GAP
 * apart, and never a zoom-cut on two scenes in a row. The extras become a plain cut / no accent.
 * Only for effects the AI picked; choices made by hand are never re-spaced.
 */
export function spaceEffects<T extends EffectScene>(scenes: T[]): T[] {
  let lastShake = Number.NEGATIVE_INFINITY
  let lastWhip = Number.NEGATIVE_INFINITY
  let zoomBefore = false
  return scenes.map((scene) => {
    let { transition, accent } = scene
    if (transition === 'whip') {
      if (scene.start - lastWhip < WHIP_GAP) transition = 'cut'
      else lastWhip = scene.start
    }
    if (accent === 'shake') {
      if (scene.start - lastShake < SHAKE_GAP) accent = 'none'
      else lastShake = scene.start
    }
    if (accent === 'zoom' && zoomBefore) accent = 'none'
    zoomBefore = accent === 'zoom'
    return transition === scene.transition && accent === scene.accent
      ? scene
      : { ...scene, transition, accent }
  })
}
