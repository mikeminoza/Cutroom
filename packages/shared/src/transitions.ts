// Transition timing shared by the ffmpeg render (in frames) and the browser preview (in seconds),
// so a crossfade or a dip through black lasts the same in both.
import type { Transition } from './types'

/** A crossfade blends the previous picture into the new one over this long, starting at the cut. */
export const CROSSFADE_SECONDS = 0.5
/** A dip through black fades the old picture out and the new one in, each over this long. */
export const DIP_SECONDS = 0.25

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
  /**
   * The next picture crossfades over this one, so this picture's camera motion runs this much
   * longer than its own time on screen (it keeps moving while it fades out).
   */
  tail: number
}

/**
 * Works out every fade. Pass lengths in frames with `unit` = frames per second and integer
 * rounding, or in seconds with `unit` = 1. Fades never take more than half a short picture
 * (a crossfade) or a third of it (each side of a dip), and are dropped below two frames.
 */
export function planTransitions(items: TransitionInput[], unit: number, integer: boolean): TransitionPlan[] {
  const round = (n: number) => (integer ? Math.floor(n) : n)
  const minimum = integer ? 2 : 2 / 30
  const crossfadeMax = round(CROSSFADE_SECONDS * unit)
  const dipMax = round(DIP_SECONDS * unit)
  const plans: TransitionPlan[] = items.map(() => ({ fadeIn: 0, fadeOut: 0, crossfade: 0, tail: 0 }))
  items.forEach((item, i) => {
    if (!item.hasVisual || item.transition === 'cut') return
    const previous = items[i - 1]
    if (!previous?.hasVisual) {
      // Nothing to blend from: come in from black.
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
