// Transition timing shared by the ffmpeg render (in frames) and the browser preview (in seconds),
// so a crossfade, a dip through black or a whip lasts the same in both.
import type { Transition } from './types'

/** A crossfade blends the previous picture into the new one over this long, starting at the cut. */
export const CROSSFADE_SECONDS = 0.5
/** A dip through black fades the old picture out and the new one in, each over this long. */
export const DIP_SECONDS = 0.25
/** A whip slides the old picture out and the new one in over this long (9 frames), from the cut. */
export const WHIP_SECONDS = 0.3
/** The strongest horizontal blur of a whip (at its fastest), as a share of the frame width. */
export const WHIP_BLUR = 0.03

export interface TransitionInput {
  /** Length of the picture's time on screen (frames or seconds). */
  length: number
  /** False for the dark frame shown before the first picture. */
  hasVisual: boolean
  /** How this picture comes in. */
  transition: Transition
}

export interface TransitionPlan {
  /** Fade in from black over this long at the start. */
  fadeIn: number
  /** Fade out to black over this long at the end. */
  fadeOut: number
  /** The previous picture fades out on top of this one over this long, starting at the cut. */
  crossfade: number
  /** The previous picture slides out and this one slides in over this long, starting at the cut. */
  whip: number
  /**
   * The next picture crossfades or whips in over this one, so this picture's camera motion runs
   * this much longer than its own time on screen (it keeps moving while it leaves).
   */
  tail: number
}

export const NO_TRANSITION: TransitionPlan = { fadeIn: 0, fadeOut: 0, crossfade: 0, whip: 0, tail: 0 }

/**
 * Works out every fade. Pass lengths in frames with `unit` = frames per second and integer
 * rounding, or in seconds with `unit` = 1. Fades never take more than half a short picture
 * (a crossfade, or a whip of either picture) or a third of it (each side of a dip), and are
 * dropped below two frames.
 */
export function planTransitions(items: TransitionInput[], unit: number, integer: boolean): TransitionPlan[] {
  const round = (n: number) => (integer ? Math.floor(n) : n)
  const minimum = integer ? 2 : 2 / 30
  const crossfadeMax = round(CROSSFADE_SECONDS * unit)
  const dipMax = round(DIP_SECONDS * unit)
  const whipMax = round(WHIP_SECONDS * unit)
  const plans: TransitionPlan[] = items.map(() => ({ ...NO_TRANSITION }))
  items.forEach((item, i) => {
    if (!item.hasVisual || item.transition === 'cut') return
    const previous = items[i - 1]
    if (!previous?.hasVisual) {
      // Nothing to blend from: a whip is a plain cut, the others come in from black.
      if (item.transition === 'whip') return
      const d = Math.min(dipMax, round(item.length / 3))
      if (d >= minimum) plans[i].fadeIn = d
      return
    }
    if (item.transition === 'fade-black') {
      const d = Math.min(dipMax, round(item.length / 3), round(previous.length / 3))
      if (d >= minimum) {
        plans[i].fadeIn = d
        plans[i - 1].fadeOut = d
      }
      return
    }
    if (item.transition === 'whip') {
      const d = Math.min(whipMax, round(item.length / 2), round(previous.length / 2))
      if (d >= minimum) {
        plans[i].whip = d
        plans[i - 1].tail = d
      }
      return
    }
    const d = Math.min(crossfadeMax, round(item.length / 2))
    if (d >= minimum) {
      plans[i].crossfade = d
      plans[i - 1].tail = d
    }
  })
  return plans
}

/** 1 = fully black. Used by the preview to draw the dip and the fade-in from black. */
export function blackLevel(plan: TransitionPlan, elapsed: number, remaining: number): number {
  let level = 0
  if (plan.fadeIn > 0 && elapsed < plan.fadeIn) level = Math.max(level, 1 - elapsed / plan.fadeIn)
  if (plan.fadeOut > 0 && remaining < plan.fadeOut) level = Math.max(level, 1 - remaining / plan.fadeOut)
  return Math.min(1, Math.max(0, level))
}

/**
 * How far a whip of `frames` frames is at `frame` (0 = the cut), 0 to 1. The cut frame already
 * shows it moving and the frame after the whip is the new picture at rest, so the steps are even.
 * The preview passes fractional frames.
 */
export function whipProgress(frame: number, frames: number): number {
  return Math.min(1, Math.max(0, (frame + 1) / (frames + 1)))
}

/**
 * One moment of a whip: `shift` is how far both pictures have slid left (0 to 1 of the width,
 * cubic ease-in-out), `blur` the horizontal blur in pixels, following the speed (none at either
 * end, the most in the middle).
 */
export function whipFrame(progress: number, width: number): { shift: number; blur: number } {
  const p = Math.min(1, Math.max(0, progress))
  const shift = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
  // The ease's slope, 0 to 3, as a share of its fastest.
  const speed = (p < 0.5 ? 12 * p ** 2 : 3 * (-2 * p + 2) ** 2) / 3
  return { shift, blur: WHIP_BLUR * width * speed }
}
