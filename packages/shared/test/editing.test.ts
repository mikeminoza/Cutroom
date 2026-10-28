import { describe, expect, it } from 'vitest'
import {
  accentEvents,
  accentWindow,
  narrationHas,
  SHAKE_SECONDS,
  shakeAt,
  spaceEffects,
  ZOOM_CUT,
} from '../src/accents'
import { SFX_RATE, SOUNDS, sfxEvents, synthesize, wavBytes } from '../src/sfx'
import { planTransitions, whipFrame, whipProgress } from '../src/transitions'
import { type Accent, normalizeTransition, poseHead, type Word } from '../src/types'

const words = (list: [string, number][]): Word[] =>
  list.map(([text, start]) => ({ text, start, end: start + 0.3 }))

describe('the whip transition', () => {
  it('is what "whip", "swipe" and "slide" mean', () => {
    expect(normalizeTransition('whip')).toBe('whip')
    expect(normalizeTransition('Swipe left')).toBe('whip')
    expect(normalizeTransition('slide')).toBe('whip')
    expect(normalizeTransition('dissolve')).toBe('crossfade')
  })

  it('runs 9 frames, keeps the previous picture moving, and is capped by the shorter picture', () => {
    const plans = planTransitions(
      [
        { length: 90, hasVisual: true, transition: 'cut' },
        { length: 90, hasVisual: true, transition: 'whip' },
        { length: 10, hasVisual: true, transition: 'whip' },
      ],
      30,
      true,
    )
    expect(plans[1]).toMatchObject({ whip: 9, crossfade: 0, fadeIn: 0 })
    expect(plans[0].tail).toBe(9)
    expect(plans[2].whip).toBe(5)
    expect(plans[1].tail).toBe(5)
  })

  it('is a plain cut with nothing before it', () => {
    const [first, second] = planTransitions(
      [
        { length: 30, hasVisual: false, transition: 'cut' },
        { length: 90, hasVisual: true, transition: 'whip' },
      ],
      30,
      true,
    )
    expect(second).toEqual({ fadeIn: 0, fadeOut: 0, crossfade: 0, whip: 0, tail: 0 })
    expect(first.tail).toBe(0)
  })

  it('slides steadily from 0 to 1, blurring most in the middle and not at all at the ends', () => {
    const steps = Array.from({ length: 101 }, (_, i) => whipFrame(i / 100, 1280))
    for (let i = 1; i < steps.length; i++) expect(steps[i].shift).toBeGreaterThanOrEqual(steps[i - 1].shift)
    expect(steps[0]).toEqual({ shift: 0, blur: 0 })
    expect(steps[100].shift).toBe(1)
    expect(steps[100].blur).toBe(0)
    const peak = steps.reduce((best, s, i) => (s.blur > steps[best].blur ? i : best), 0)
    expect(peak).toBe(50)
    expect(steps[50].blur).toBeCloseTo(0.03 * 1280)
    // Evenly spaced steps: the cut frame already moves, the frame after the whip is at rest.
    expect(whipProgress(0, 9)).toBeCloseTo(0.1)
    expect(whipProgress(9, 9)).toBe(1)
  })
})

describe('accents', () => {
  const scene = (start: number, end: number, accent: Accent, accentWord = '') => ({
    start,
    end,
    accent,
    accentWord,
  })

  it('lands on the first matching word, ignoring case and punctuation', () => {
    const spoken = words([
      ['It', 0.1],
      ['went', 0.5],
      ['BOOM!', 1.4],
      ['boom', 2.2],
    ])
    expect(accentEvents([scene(0, 3, 'shake', 'boom')], spoken, 3)).toEqual([
      { kind: 'shake', time: 1.4, scene: 0 },
    ])
    expect(accentEvents([scene(0, 3, 'zoom', 'went boom')], spoken, 3)[0].time).toBe(0.5)
  })

  it('falls back to the start (shake) or the middle (zoom), and keeps clear of the cuts', () => {
    expect(accentEvents([scene(0, 2, 'shake'), scene(2, 6, 'zoom')], [], 6)).toEqual([
      { kind: 'shake', time: 0, scene: 0 },
      { kind: 'zoom', time: 4, scene: 1 },
    ])
    // A word right at the cut: a zoom waits 0.4 s, and never lands in the last half second.
    const early = words([
      ['now', 2],
      ['end', 5.9],
    ])
    expect(accentEvents([scene(0, 2, 'none'), scene(2, 6, 'zoom', 'now')], early, 6)[0].time).toBe(2.4)
    expect(accentEvents([scene(0, 2, 'none'), scene(2, 6, 'zoom', 'end')], early, 6)[0].time).toBe(5.5)
    // A shake needs time to settle before the next scene.
    expect(
      accentEvents([scene(0, 2, 'shake', 'end'), scene(2, 6, 'none')], words([['end', 1.9]]), 6)[0].time,
    ).toBe(2 - SHAKE_SECONDS)
  })

  it('runs each scene to the next one and skips scenes too short for their accent', () => {
    // The scene's own end (1.0) is ignored: it lasts until the next scene starts at 3.
    expect(accentEvents([scene(0, 1, 'zoom'), scene(3, 4, 'none')], [], 4)[0].time).toBe(1.5)
    expect(accentEvents([scene(0, 1, 'zoom'), scene(1, 4, 'none')], [], 4)).toEqual([])
    expect(accentEvents([scene(0, 0.4, 'shake'), scene(0.4, 4, 'none')], [], 4)).toEqual([])
  })

  it('checks that a word is in the narration', () => {
    expect(narrationHas('Then it went... BOOM!', 'boom')).toBe(true)
    expect(narrationHas('Then it went quiet.', 'boom')).toBe(false)
    expect(narrationHas('Then it went quiet.', '')).toBe(false)
  })

  it('zooms in around the anchor, which stays put', () => {
    const view = accentWindow({ x: 300, y: 200 }, [], 1280, 720)
    expect(view.scale).toBeCloseTo(1 / ZOOM_CUT)
    // The anchor is at the same place in the shown window as in the full frame.
    expect(view.left + 300 * view.scale).toBeCloseTo(300)
    expect(view.top + 200 * view.scale).toBeCloseTo(200)
    expect(accentWindow(null, [], 1280, 720)).toEqual({ left: 0, top: 0, scale: 1 })
  })

  it('shakes without ever showing the picture edges, and settles', () => {
    for (const zoom of [null, { x: 0, y: 0 }, { x: 1280, y: 720 }]) {
      for (let t = 0; t < SHAKE_SECONDS; t += 1 / 120) {
        const view = accentWindow(zoom, [t], 1280, 720)
        expect(view.left).toBeGreaterThanOrEqual(-1e-6)
        expect(view.top).toBeGreaterThanOrEqual(-1e-6)
        expect(view.left + 1280 * view.scale).toBeLessThanOrEqual(1280 + 1e-6)
        expect(view.top + 720 * view.scale).toBeLessThanOrEqual(720 + 1e-6)
      }
    }
    expect(shakeAt(SHAKE_SECONDS)).toEqual({ dx: 0, dy: 0, grow: 1 })
    expect(Math.abs(shakeAt(0.02).dx)).toBeGreaterThan(0.01)
  })

  it("spaces the AI's effects out and drops zoom-cuts in a row", () => {
    const picked = [
      { start: 0, transition: 'cut', accent: 'zoom' as Accent },
      { start: 3, transition: 'whip', accent: 'zoom' as Accent },
      { start: 6, transition: 'whip', accent: 'shake' as Accent },
      { start: 12, transition: 'cut', accent: 'shake' as Accent },
      { start: 22, transition: 'crossfade', accent: 'shake' as Accent },
      { start: 24, transition: 'whip', accent: 'zoom' as Accent },
    ]
    expect(spaceEffects(picked).map((s) => [s.transition, s.accent])).toEqual([
      ['cut', 'zoom'],
      ['whip', 'none'],
      ['cut', 'shake'],
      ['cut', 'none'],
      ['crossfade', 'shake'],
      ['whip', 'zoom'],
    ])
  })
})

describe('where a pose has its head', () => {
  it('is the middle of the top third of the pose as it stands in its box', () => {
    // A 2:3 pose in a 720p frame stands 384×576 px, from x≈77, sunk 3.5% below the bottom edge.
    const head = poseHead('landscape', 'left', 2 / 3)
    expect(head.x * 1280).toBeCloseTo(76.8 + 192)
    expect(head.y * 720).toBeCloseTo(720 - 576 * 0.965 + 96)
    expect(poseHead('landscape', 'center', 2 / 3).x).toBeCloseTo(0.5)
    expect(poseHead('landscape', 'right', 2 / 3).x).toBeCloseTo(1 - head.x)
  })
})

describe('sound effects', () => {
  it('are the same samples every time, the right length, and never clip', () => {
    for (const name of ['whoosh', 'swish', 'thud'] as const) {
      const samples = synthesize(name)
      expect(samples.length).toBe(Math.round(SOUNDS[name].seconds * SFX_RATE))
      expect(Array.from(synthesize(name, 24_000).slice(0, 50))).toEqual(
        Array.from(synthesize(name, 24_000).slice(0, 50)),
      )
      let peak = 0
      for (const s of samples) peak = Math.max(peak, Math.abs(s))
      expect(peak).toBeCloseTo(0.9)
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.01)
    }
  })

  it('are loudest where they should be', () => {
    for (const name of ['whoosh', 'swish', 'thud'] as const) {
      const samples = synthesize(name)
      const window = Math.round(0.01 * SFX_RATE)
      let loudest = 0
      let best = 0
      for (let at = 0; at + window <= samples.length; at += Math.round(window / 4)) {
        let energy = 0
        for (let i = at; i < at + window; i++) energy += samples[i] ** 2
        if (energy > best) {
          best = energy
          loudest = (at + window / 2) / SFX_RATE
        }
      }
      expect(Math.abs(loudest - SOUNDS[name].peak)).toBeLessThan(name === 'thud' ? 0.02 : 0.04)
    }
  })

  it('play a whoosh from each whip, a swish peaking on each zoom-cut and a thud on each shake', () => {
    expect(
      sfxEvents(
        [5],
        [
          { kind: 'zoom', time: 2, scene: 0 },
          { kind: 'shake', time: 8, scene: 2 },
        ],
      ),
    ).toEqual([
      { sound: 'swish', start: 2 - SOUNDS.swish.peak },
      { sound: 'whoosh', start: 5 },
      { sound: 'thud', start: 8 },
    ])
  })

  it('write a mono 16-bit WAV file', () => {
    const bytes = wavBytes(new Float32Array([0, 1, -1, 2]), 48_000)
    const view = new DataView(bytes.buffer)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(48_000)
    expect(view.getUint32(40, true)).toBe(8)
    expect([1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 32767])
  })
})
