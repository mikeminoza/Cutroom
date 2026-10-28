// Turns timed scenes + voice-over + captions into an H.264/AAC MP4 with ffmpeg.
//
// Pipeline (built for a fraction of one CPU core and ~512 MB of RAM):
//  1. Each scene becomes its own short video-only clip. The image is decoded, fitted and
//     colour-converted ONCE, then that single frame is looped, so the per-frame work is just the
//     motion transform, the caption overlay and the x264 encode. Captions and on-screen text are
//     burned here too: the clip is stamped with its absolute timeline time so libass picks the
//     right events. Transitions live inside the clips as well: a dip through black fades the end
//     of one clip and the start of the next; a crossfade feeds the previous picture into the
//     incoming clip and fades it out on top, still moving, over the first half second.
//  2. The clips (identical codec settings) are joined with the concat demuxer and stream-copied
//     in a final pass that only builds the audio (voice, music, ducking) — the video is encoded
//     exactly once, which roughly halves the CPU time of a "re-encode to burn captions" pass.
//  3. ffprobe reads the real duration back.
//
// A layered scene (a Library background with a character's pose in front) is built in its clip:
// the background moves like any picture, the pose stands still in front of it, breathing, bouncing
// while the narrator speaks, and blinking when it has an eyes-closed twin.
//
// The edit: every picture drifts at a steady speed, accents (a zoom-cut on a key word, a shake on
// a punchline) are part of the same camera transform, a whip slides the previous picture out and
// this one in with a motion blur, and the final pass mixes a whoosh, swish or thud under each.
import { rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type AccentEvent, accentEvents, SHAKE, SHAKE_SECONDS, ZOOM_CUT } from '@cutroom/shared/accents'
import { chunkCaptions, type Overlay, speechSpans, toSrt } from '@cutroom/shared/captions'
import {
  SFX_LEVEL,
  type SoundEvent,
  type SoundName,
  sfxEvents,
  synthesize,
  wavBytes,
} from '@cutroom/shared/sfx'
import {
  NO_TRANSITION,
  planTransitions,
  type TransitionPlan,
  whipFrame,
  whipProgress,
} from '@cutroom/shared/transitions'
import type {
  Accent,
  CaptionStyle,
  ImageFit,
  LayerSide,
  Motion,
  Resolution,
  Transition,
  VideoFormat,
  Word,
} from '@cutroom/shared/types'
import { outputSize, poseBox, poseHead } from '@cutroom/shared/types'
import { buildAss } from './ass'
import {
  defaultThreads,
  probeDuration,
  probeImageSize,
  renderSlots,
  runFfmpeg,
  throwIfAborted,
} from './ffmpeg'

export interface RenderScene {
  /** Seconds on the final timeline; scenes are contiguous & sorted. */
  start: number
  end: number
  /** Local file path (png/jpg/webp); null = no image uploaded (the previous image holds). */
  imagePath: string | null
  /** A picture built from Library layers, used when there's no imagePath. */
  layer?: RenderLayer | null
  motion: Motion
  fit: ImageFit
  /** 0..1 focus point used when cropping for 'cover' (and as the zoom anchor). */
  focusX: number
  focusY: number
  /** How this scene's picture comes in. Ignored for scenes without an image. */
  transition: Transition
  /** A zoom-cut or shake in this scene, on `accentWord` (see accentEvents). */
  accent?: Accent
  accentWord?: string
}

export interface RenderLayer {
  /** Local background file; null = the plain dark background behind the pose. */
  backgroundPath: string | null
  /** Local pose file: a cut-out with a transparent background. */
  posePath: string | null
  /** The same pose with the eyes closed, shown for a moment every few seconds. */
  blinkPath: string | null
  side: LayerSide
}

export interface RenderInput {
  /** Existing temp dir; all intermediates and the output go here. */
  workDir: string
  format: VideoFormat
  resolution: Resolution
  captionStyle: CaptionStyle
  scenes: RenderScene[]
  voiceoverPath: string | null
  /** Final video length (seconds). */
  duration: number
  /** Caption words with times. */
  words: Word[]
  /** On-screen text, burned in whatever the caption style. */
  overlays?: Overlay[]
  musicPath: string | null
  /** 0..1, background music level under the voice. */
  musicVolume: number
  /** A whoosh under each whip, a swish under each zoom-cut, a thud under each shake (default on). */
  soundEffects?: boolean
  /** Fraction 0..1 over the whole render, plus a human-readable step. */
  onProgress?: (fraction: number, detail: string) => void
  /** Kills ffmpeg when aborted; renderVideo then rejects with an AbortError. */
  signal?: AbortSignal
}

export interface RenderOutput {
  videoPath: string
  srtPath: string
  durationSeconds: number
}

export const FPS = 30
const BACKGROUND = '0x14171f'
const ASS_NAME = 'captions.ass'
const SRT_NAME = 'captions.srt'
const LIST_NAME = 'scenes.ffconcat'
const OUTPUT_NAME = 'video.mp4'
/** A shake lasts this many frames. */
const SHAKE_FRAMES = Math.round(SHAKE_SECONDS * FPS)
/** The frame number from 0 in `perspective` expressions (its `in` counts from 1). */
const FRAME = '(in-1)'
/**
 * Share of the progress bar for the scene clips. They hold all of the video work (motion,
 * captions, x264); the final pass only copies video and encodes audio, so it gets the rest.
 */
const SCENES_WEIGHT = 0.9

/** H.264 settings shared by every scene clip: they must match exactly for concat `-c copy`. */
const VIDEO_CODEC = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
]

interface Visual {
  /** The picture, or the layer's background; null = the plain dark background (a pose alone). */
  path: string | null
  fit: ImageFit
  focusX: number
  focusY: number
  motion: Motion
  /** A character's pose standing in front of the picture. */
  pose: { path: string; blinkPath: string | null; side: LayerSide } | null
  /** Built from Library layers rather than an uploaded picture. */
  layered: boolean
}

/** Seconds on the final timeline. */
interface Span {
  start: number
  end: number
}

export interface Segment {
  /** First frame on the final timeline. */
  startFrame: number
  frames: number
  /** null = solid background (no image yet). */
  visual: Visual | null
  /** Index of the first scene it covers (for progress messages). */
  sceneIndex: number
  /** How the picture comes in. */
  transition: Transition
  /** Fades in frames, filled in once all segments are known. */
  plan: TransitionPlan
  /**
   * The camera move this clip is part of: its whole length in frames, and how far into it the
   * clip starts. Usually the clip alone (plus the tail into the next crossfade); back-to-back
   * layered scenes on the same background share one move, so only the pose changes at the cut.
   */
  move: { frames: number; offset: number }
  /** The zoom-cut and shakes in this clip, in frames from its start. */
  accents: CameraAccents
}

/** Accents of one clip, in frames from its first frame (negative: before it). */
export interface CameraAccents {
  /** The zoom-cut's first frame; it holds to the end of the clip. null = none. */
  zoom: number | null
  /** Where it zooms in, in pixels; the picture's own anchor (its focus point) when missing. */
  zoomAnchor?: { x: number; y: number }
  /** Each shake's first frame. */
  shakes: number[]
}

const NO_ACCENTS: CameraAccents = { zoom: null, shakes: [] }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const clamp01 = (n: number) => (Number.isFinite(n) ? clamp(n, 0, 1) : 0.5)

/**
 * Splits the timeline into clips with exact frame counts. Boundaries are rounded once on the
 * absolute timeline (not per scene), so rounding never accumulates and the frames always add up
 * to round(duration * FPS). A scene without an image extends the previous clip — the previous
 * image keeps moving with the same motion instead of jumping back to its first frame. Before
 * the first image there's a solid dark frame. `accents` (from accentEvents) go to the clip on
 * screen at their moment: one zoom-cut per picture, and none on the dark frame.
 */
export function planSegments(
  scenes: RenderScene[],
  totalFrames: number,
  accents: AccentEvent[] = [],
): Segment[] {
  const sorted = [...scenes].sort((a, b) => a.start - b.start)
  const bounds: number[] = []
  sorted.forEach((scene, i) => {
    const frame = i === 0 ? 0 : clamp(Math.round(scene.start * FPS), 0, totalFrames)
    bounds.push(Math.max(frame, bounds[i - 1] ?? 0))
  })
  bounds.push(totalFrames)

  const segments: Segment[] = []
  let lastVisual: Visual | null = null
  // The transition of the scene that brought in lastVisual. Usually that scene's own segment uses
  // it; when its time rounds to no frames, the next segment shows its picture and needs it too.
  let lastTransition: Segment['transition'] = 'cut'
  sorted.forEach((scene, i) => {
    const layer = scene.imagePath ? null : (scene.layer ?? null)
    const background = scene.imagePath ?? layer?.backgroundPath ?? null
    const drawn = Boolean(background || layer?.posePath)
    if (drawn) {
      lastTransition = scene.transition ?? 'cut'
      lastVisual = {
        path: background ? resolve(background) : null,
        fit: scene.fit,
        focusX: clamp01(scene.focusX),
        focusY: clamp01(scene.focusY),
        motion: scene.motion,
        layered: layer !== null,
        pose: layer?.posePath
          ? {
              path: resolve(layer.posePath),
              blinkPath: layer.blinkPath ? resolve(layer.blinkPath) : null,
              side: layer.side,
            }
          : null,
      }
    }
    const frames = bounds[i + 1] - bounds[i]
    if (frames <= 0) return
    const previous = segments[segments.length - 1]
    if (!drawn && previous && previous.visual === lastVisual) {
      previous.frames += frames
      return
    }
    segments.push({
      startFrame: bounds[i],
      frames,
      visual: lastVisual,
      sceneIndex: i,
      transition: lastTransition,
      plan: NO_TRANSITION,
      move: { frames: 0, offset: 0 },
      accents: NO_ACCENTS,
    })
  })
  if (segments.length === 0)
    segments.push({
      startFrame: 0,
      frames: totalFrames,
      visual: null,
      sceneIndex: 0,
      transition: 'cut',
      plan: NO_TRANSITION,
      move: { frames: 0, offset: 0 },
      accents: NO_ACCENTS,
    })
  // Inside one shot (same background, new pose) the cut stays the shot's continuous cut.
  segments.forEach((segment, i) => {
    if (segment.transition === 'whip' && i > 0 && sameShot(segments[i - 1].visual, segment.visual))
      segment.transition = 'cut'
  })
  for (const event of accents) {
    const frame = Math.round(event.time * FPS)
    const segment = segments.find((s) => frame >= s.startFrame && frame < s.startFrame + s.frames)
    if (!segment?.visual) continue
    const local = frame - segment.startFrame
    if (event.kind === 'zoom' && segment.accents.zoom === null)
      segment.accents = { ...segment.accents, zoom: local }
    if (event.kind === 'shake')
      segment.accents = { ...segment.accents, shakes: [...segment.accents.shakes, local] }
  }
  const plans = planTransitions(
    segments.map((s) => ({ length: s.frames, hasVisual: s.visual !== null, transition: s.transition })),
    FPS,
    true,
  )
  segments.forEach((segment, i) => {
    segment.plan = plans[i]
    segment.move = { frames: segment.frames + plans[i].tail, offset: 0 }
  })
  joinShots(segments)
  return segments
}

/** Two layered scenes on the same background, with a pose on at least one: same place, new pose. */
function sameShot(a: Visual | null, b: Visual | null): boolean {
  return Boolean(a?.layered && b?.layered && a.path !== null && a.path === b.path && (a.pose || b.pose))
}

/**
 * Back-to-back layered scenes on the same background become one continuous shot: they take the
 * first scene's framing and move, and the camera keeps going across the cuts instead of
 * starting over, so a quick cut reads as the character changing pose, not a new slide.
 */
function joinShots(segments: Segment[]) {
  let first = 0
  for (let i = 1; i <= segments.length; i++) {
    if (i < segments.length && sameShot(segments[i - 1].visual, segments[i].visual)) continue
    const run = segments.slice(first, i)
    if (run.length > 1) {
      const lead = run[0].visual as Visual
      const frames = run.reduce((n, s) => n + s.frames, 0) + run[run.length - 1].plan.tail
      let offset = 0
      for (const segment of run) {
        segment.visual = {
          ...(segment.visual as Visual),
          fit: lead.fit,
          focusX: lead.focusX,
          focusY: lead.focusY,
          motion: lead.motion,
        }
        segment.move = { frames, offset }
        offset += segment.frames
      }
    }
    first = i
  }
}

/** Plain decimal for filter args / expressions (never exponent notation). */
const num = (n: number) => {
  const fixed = n.toFixed(6)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/**
 * Ken Burns via `perspective` (eval=frame) on the pre-fitted W×H frame.
 *
 * Why: zoompan crops at integer x/y and integer sizes, which at a slow 12% zoom makes the
 * picture wobble by a pixel every few frames; the usual fix (upscaling 4–8× first) costs a
 * lot of memory and still only reaches 1/4–1/8 px. scale(eval=frame)+crop has the same integer
 * crop problem. `perspective` maps an arbitrary fractional rectangle of the source onto the
 * output with bilinear sampling at 1/256 px precision, so motion is perfectly smooth, and it
 * works on the small output-size frame (~3 ms/frame at 720p on one core).
 *
 * The rectangle keeps the focus point fixed while zooming (zoom "into" the subject); pans
 * travel horizontally at a fixed 1/(1-f) zoom. The speed is steady: a picture arrives already
 * moving, and two pictures with the same move cut together smoothly. `frames` is the whole move;
 * `offset` starts this clip part-way through it (the previous picture continuing its move while
 * it crossfades or whips out).
 *
 * `accents` narrow the moving rectangle further, as accentWindow in @cutroom/shared/accents does
 * for the preview: from the zoom-cut's frame it shows 1/ZOOM_CUT of the view around the anchor,
 * and during a shake it is offset and slightly enlarged. Returns null when nothing animates.
 */
export function motionFilter(
  motion: Motion,
  frames: number,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  offset = 0,
  accents: CameraAccents = NO_ACCENTS,
): string | null {
  const moving = motion !== 'none' && frames >= 2
  const accented = accents.zoom !== null || accents.shakes.length > 0
  if (!moving && !accented) return null
  const ax = num(clamp(anchorX, 0, width))
  const ay = num(clamp(anchorY, 0, height))
  const W = num(width)
  const H = num(height)

  let r = '1' // visible fraction of the frame (1/zoom), as an expression of `in`
  let x0 = '0'
  let y0 = '0'
  if (moving) {
    const seconds = frames / FPS
    const p = offset > 0 ? `((${FRAME}+${offset})/${frames - 1})` : `(${FRAME}/${frames - 1})`
    if (motion === 'zoom-in' || motion === 'zoom-out') {
      // Subtle and capped in speed: short scenes zoom less instead of lurching.
      const amount = Math.min(0.12, 0.05 * seconds)
      const k = num(Math.log(1 + amount))
      // exp() makes the zoom change at a constant perceived rate.
      r = motion === 'zoom-in' ? `exp(-${k}*${p})` : `exp(-${k}*(1-${p}))`
      x0 = `(${ax}-${ax}*${r})`
    } else {
      // Pan across up to 10% of the frame width (slower for short scenes).
      const travel = Math.min(0.1, 0.04 * seconds)
      r = num(1 - travel)
      const span = num(travel * width)
      x0 = motion === 'pan-right' ? `(${span}*${p})` : `(${span}*(1-${p}))`
    }
    y0 = `(${ay}-${ay}*${r})`
  }
  let opts: Record<string, string>
  if (!accented) {
    const x1 = `(${x0}+${W}*${r})`
    const y2 = `(${ay}+(${H}-${ay})*${r})`
    opts = { x0, y0, x1, y1: y0, x2: x0, y2, x3: x1, y3: y2 }
  } else {
    const view = accentExpressions(accents, width, height, accents.zoomAnchor ?? { x: anchorX, y: anchorY })
    const left = `(${x0}+${view.left}*${r})`
    const top = `(${y0}+${view.top}*${r})`
    const right = `(${left}+${W}*${r}*${view.scale})`
    const bottom = `(${top}+${H}*${r}*${view.scale})`
    opts = { x0: left, y0: top, x1: right, y1: top, x2: left, y2: bottom, x3: right, y3: bottom }
  }
  const parts = Object.entries(opts).map(([key, expr]) => `${key}='${expr}'`)
  return `perspective=${parts.join(':')}:interpolation=linear:sense=source:eval=frame`
}

/**
 * accentWindow as ffmpeg expressions of the frame number: the shown part of the moving view, in
 * its own pixels (left, top) and as a share of its size (scale).
 */
function accentExpressions(
  accents: CameraAccents,
  width: number,
  height: number,
  anchor: { x: number; y: number },
): { left: string; top: string; scale: string } {
  const W = num(width)
  const H = num(height)
  const s = accents.zoom !== null ? `if(gte(${FRAME},${accents.zoom}),${num(1 / ZOOM_CUT)},1)` : '1'
  const shakes = accents.shakes.map((first) => {
    const t = `((${FRAME}-${first})/${FPS})`
    return {
      on: `between(${FRAME},${first},${first + SHAKE_FRAMES - 1})`,
      t,
      fade: `exp(-${num(SHAKE.decay)}*${t})`,
    }
  })
  if (shakes.length === 0) {
    return {
      left: `(${num(clamp(anchor.x, 0, width))}*(1-${s}))`,
      top: `(${num(clamp(anchor.y, 0, height))}*(1-${s}))`,
      scale: s,
    }
  }
  const sum = (terms: string[]) => `(${terms.join('+')})`
  const grow = `(1+${sum(shakes.map((k) => `${k.on}*${num(SHAKE.grow)}*${k.fade}`))})`
  const dx = sum(
    shakes.map((k) => `${k.on}*${num(SHAKE.amplitude)}*sin(${num(2 * Math.PI * SHAKE.fx)}*${k.t})*${k.fade}`),
  )
  const dy = sum(
    shakes.map(
      (k) =>
        `${k.on}*${num(SHAKE.ratioY * SHAKE.amplitude)}*cos(${num(2 * Math.PI * SHAKE.fy)}*${k.t})*${k.fade}`,
    ),
  )
  const scale = `(${s}/${grow})`
  const ax = num(clamp(anchor.x, 0, width))
  const ay = num(clamp(anchor.y, 0, height))
  return {
    left: `(${ax}*(1-${s})+${W}*${s}/2*(1-1/${grow})-${dx}*${W}*${scale})`,
    top: `(${ay}*(1-${s})+${H}*${s}/2*(1-1/${grow})-${dy}*${W}*${scale})`,
    scale,
  }
}

/** RGB -> BT.709 limited-range yuv420p, tagged, so libass and players agree on colours. */
const TO_YUV =
  'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,' +
  'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709'

interface BaseFrame {
  /** Filter chain from [0:v] to a single W×H yuv420p frame (ends with a label-less output). */
  chain: string
  anchorX: number
  anchorY: number
}

/**
 * Fits the image into W×H once: 'cover' crops around the focus, 'contain' letterboxes on a blur.
 * `label` keeps the internal pad names unique when two pictures share one filter graph.
 */
function baseFrame(
  visual: Visual,
  size: { width: number; height: number },
  image: ImageSize,
  label = '',
): BaseFrame {
  const { width: W, height: H } = size
  const { width: iw, height: ih } = image
  if (visual.fit === 'contain') {
    const s = Math.min(W / iw, H / ih)
    const fw = clamp(Math.round(iw * s), 1, W)
    const fh = clamp(Math.round(ih * s), 1, H)
    const x = Math.floor((W - fw) / 2)
    const y = Math.floor((H - fh) / 2)
    // Background: a quarter-size cover crop, blurred, darkened, then scaled up. Blurring at
    // quarter size is ~16× cheaper and the upscale adds even more softness for free.
    const bw = Math.round(W / 4)
    const bh = Math.round(H / 4)
    const bs = Math.max(bw / iw, bh / ih)
    const bsw = Math.max(bw, Math.round(iw * bs))
    const bsh = Math.max(bh, Math.round(ih * bs))
    const bx = Math.round((bsw - bw) / 2)
    const by = Math.round((bsh - bh) / 2)
    const [bg, fg, bgs, fgs] = ['bg', 'fg', 'bgs', 'fgs'].map((name) => `[${label}${name}]`)
    const chain =
      `split=2${bg}${fg};` +
      `${bg}scale=${bsw}:${bsh}:flags=bilinear,crop=${bw}:${bh}:${bx}:${by},gblur=sigma=7,` +
      `colorchannelmixer=rr=0.5:gg=0.5:bb=0.5,scale=${W}:${H}:flags=bicubic${bgs};` +
      `${fg}scale=${fw}:${fh}:flags=lanczos${fgs};` +
      `${bgs}${fgs}overlay=${x}:${y}:format=auto,${TO_YUV}`
    return { chain, anchorX: x + visual.focusX * fw, anchorY: y + visual.focusY * fh }
  }
  const s = Math.max(W / iw, H / ih)
  const sw = Math.max(W, Math.round(iw * s))
  const sh = Math.max(H, Math.round(ih * s))
  const ox = clamp(Math.round(visual.focusX * sw - W / 2), 0, sw - W)
  const oy = clamp(Math.round(visual.focusY * sh - H / 2), 0, sh - H)
  const chain = `scale=${sw}:${sh}:flags=lanczos,crop=${W}:${H}:${ox}:${oy},${TO_YUV}`
  return { chain, anchorX: visual.focusX * sw - ox, anchorY: visual.focusY * sh - oy }
}

interface ImageSize {
  width: number
  height: number
}

interface SegmentJob {
  segment: Segment
  file: string
  args: string[]
}

/** Can this visual be drawn: its picture was read, or it's a pose on the plain background. */
function drawable(visual: Visual, sizes: Map<string, ImageSize>): boolean {
  return visual.path ? sizes.has(visual.path) : visual.pose !== null
}

/**
 * The pose's y: standing on the frame's bottom edge with `sink` of its height hidden below, and
 * rising into that room as it breathes (always, slowly) and bounces (while the narrator speaks).
 * `t` is the clip's own time; `at` is the timeline second of its first frame, so breathing runs
 * on smoothly across cuts. Only the speech within the `seconds` the clip lasts is included.
 */
export function poseY(at: number, seconds: number, speech: Span[], sink: number): string {
  const breathe = `0.15*(1+sin(2*PI*(t+${num(at)})/3.4))`
  const bounces = speech
    .filter((span) => span.end > at && span.start < at + seconds)
    .map((span) => {
      const from = span.start - at
      const length = span.end - span.start
      // About one hop every 0.4 s, fitted so the span starts and ends on the ground.
      const hops = Math.max(1, Math.round(length / 0.4))
      return `between(t,${num(from)},${num(span.end - at)})*abs(sin(${num((Math.PI * hops) / length)}*(t-${num(from)})))`
    })
  const lift = bounces.length ? `(0.65*(${bounces.join('+')})+${breathe})` : breathe
  return `H-h+h*${num(sink)}*(1-${lift})`
}

/** On for about an eighth of a second every 4.1 s: a blink. */
const blinkAt = (at: number) => `lt(mod(t+${num(at + 1.3)},4.1),0.13)`

/**
 * Adds a visual's inputs and returns the start of its filter chain: one decoded frame, repeated,
 * then the move; for a layered scene, the pose standing in front. Statements the pose needs go
 * into `graph` first. `label` keeps pad names unique when two pictures share one graph; `move` is
 * the whole move and how far into it this clip starts (the previous picture continuing its move
 * while it crossfades or whips out). `accents` are in frames of this clip: on a plain picture
 * they join its move; on a pose they act on the whole scene, zooming in on the pose's head.
 */
function pictureChain(
  visual: Visual | null,
  size: { width: number; height: number },
  sizes: Map<string, ImageSize>,
  inputs: string[],
  graph: string[],
  label: string,
  move: { frames: number; offset: number },
  time: { at: number; seconds: number; speech: Span[] },
  accents: CameraAccents = NO_ACCENTS,
): string {
  const { width: W, height: H } = size
  const nextInput = () => inputs.filter((arg) => arg === '-i').length
  const image = visual?.path ? (sizes.get(visual.path) ?? null) : null
  const index = nextInput()
  const pose = visual?.pose
  let chain: string
  let motion: string | null = null
  if (visual?.path && image) {
    const base = baseFrame(visual, size, image, label)
    inputs.push('-i', visual.path)
    chain = base.chain
    motion = motionFilter(
      visual.motion,
      move.frames,
      W,
      H,
      base.anchorX,
      base.anchorY,
      move.offset,
      pose ? NO_ACCENTS : accents,
    )
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${W}x${H}:r=${FPS}`)
    chain = `format=rgb24,${TO_YUV}`
  }
  const picture = [
    `[${index}:v]${chain}`,
    'loop=loop=-1:size=1:start=0',
    `settb=1/${FPS}`,
    'setpts=N',
    ...(motion ? [motion] : []),
  ].join(',')
  if (!pose) return picture

  // The pose (and its blink) fitted into its box once, colour-converted with alpha, repeated.
  const format = H > W ? 'portrait' : 'landscape'
  const box = poseBox(format)
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2))
  const fit =
    `scale=w=${even(W * box.width)}:h=${even(H * box.height)}:force_original_aspect_ratio=decrease:` +
    'force_divisible_by=2:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p,' +
    `loop=loop=-1:size=1:start=0,settb=1/${FPS},setpts=N`
  const margin = num(box.margin)
  const x = pose.side === 'left' ? `W*${margin}` : pose.side === 'right' ? `W-w-W*${margin}` : '(W-w)/2'
  const y = poseY(time.at, time.seconds, time.speech, box.sink)
  const place = `x=${x}:y='${y}':eval=frame:format=yuv420`
  const poseInput = nextInput()
  inputs.push('-i', pose.path)
  graph.push(`${picture}[${label}scene]`, `[${poseInput}:v]${fit}[${label}pose]`)
  // Accents move the background and the pose together.
  const poseSize = sizes.get(pose.path)
  const head = poseHead(format, pose.side, poseSize ? poseSize.width / poseSize.height : null)
  const accent = motionFilter('none', 0, W, H, 0, 0, 0, {
    ...accents,
    zoomAnchor: { x: head.x * W, y: head.y * H },
  })
  const standing = `[${label}scene][${label}pose]overlay=${place}`
  if (!pose.blinkPath) return accent ? `${standing},${accent}` : standing
  const blinkInput = nextInput()
  inputs.push('-i', pose.blinkPath)
  graph.push(`${standing}[${label}posed]`, `[${blinkInput}:v]${fit}[${label}blink]`)
  const blinking = `[${label}posed][${label}blink]overlay=${place}:enable='${blinkAt(time.at)}'`
  return accent ? `${blinking},${accent}` : blinking
}

/** Accents of the previous clip, counted from this clip's first frame (its zoom-cut still holds). */
function carried(previous: Segment): CameraAccents {
  const { zoom, shakes } = previous.accents
  return {
    zoom: zoom === null ? null : zoom - previous.frames,
    shakes: shakes.map((first) => first - previous.frames).filter((first) => first + SHAKE_FRAMES > 0),
  }
}

export function segmentArgs(
  segment: Segment,
  previous: Segment | null,
  file: string,
  size: { width: number; height: number },
  sizes: Map<string, ImageSize>,
  burn: boolean,
  threads: number,
  speech: Span[] = [],
): string[] {
  const { plan } = segment
  const inputs: string[] = []
  const graph: string[] = []
  const at = segment.startFrame / FPS
  // The picture, its move running on through the next picture's crossfade (plan.tail) so it
  // never stalls, then any dip through black.
  const picture = [
    pictureChain(
      segment.visual,
      size,
      sizes,
      inputs,
      graph,
      'a',
      segment.move,
      { at, seconds: segment.frames / FPS, speech },
      segment.accents,
    ),
    ...(plan.fadeIn > 0 ? [`fade=t=in:s=0:n=${plan.fadeIn}`] : []),
    ...(plan.fadeOut > 0 ? [`fade=t=out:s=${segment.frames - plan.fadeOut}:n=${plan.fadeOut}`] : []),
  ]
  // Timestamps = absolute timeline frames so libass shows the right text, then rebased to 0.
  const finish = [`setpts=N+${segment.startFrame}`, ...(burn ? [`ass=${ASS_NAME}`] : []), 'setpts=N[v]']

  const outgoing = previous?.visual ?? null
  // The previous picture, continuing its move (and its zoom-cut) from where its own clip ended.
  const old = (frames: number) =>
    previous && outgoing
      ? pictureChain(
          outgoing,
          size,
          sizes,
          inputs,
          graph,
          'b',
          { frames: previous.move.frames, offset: previous.move.offset + previous.frames },
          { at, seconds: frames / FPS, speech },
          carried(previous),
        )
      : ''
  if (plan.crossfade > 0 && previous && outgoing && drawable(outgoing, sizes)) {
    // It fades out on top.
    const fading = [
      old(plan.crossfade),
      `trim=end_frame=${plan.crossfade}`,
      'format=yuva420p',
      `fade=t=out:s=0:n=${plan.crossfade}:alpha=1`,
    ]
    graph.push(
      `${picture.join(',')}[cur]`,
      `${fading.join(',')}[old]`,
      `[cur][old]overlay=eof_action=pass:format=yuv420,${finish.join(',')}`,
    )
  } else if (plan.whip > 0 && previous && outgoing && drawable(outgoing, sizes)) {
    graph.push(...whipGraph(picture.join(','), old(plan.whip), plan.whip, size, inputs, finish.join(',')))
  } else {
    graph.push([...picture, ...finish].join(','))
  }
  return [
    '-filter_complex_threads',
    String(threads),
    ...inputs,
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[v]',
    '-frames:v',
    String(segment.frames),
    '-r',
    String(FPS),
    ...VIDEO_CODEC,
    '-threads',
    String(threads),
    '-an',
    file,
  ]
}

/**
 * A whip over the first `frames` frames: on a dark canvas the previous picture (`old`, already
 * moving) slides out to the left while this one (`picture`) slides in from the right, both on the
 * shared whipFrame curve and blurred sideways by its speed (one blur per frame, each on for its
 * own frame only). The result covers the clip until it ends, like a crossfade's old picture.
 * Frames are told apart by their time, not by the filters' frame counters (which count from 1 in
 * some ffmpeg versions).
 */
function whipGraph(
  picture: string,
  old: string,
  frames: number,
  size: { width: number; height: number },
  inputs: string[],
  finish: string,
): string[] {
  const { width: W, height: H } = size
  const canvas = inputs.filter((arg) => arg === '-i').length
  inputs.push('-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${W}x${H}:r=${FPS}`)
  const steps = Array.from({ length: frames }, (_, k) => whipFrame(whipProgress(k, frames), W))
  // Exact positions per frame, from the shared curve (overlay places whole pixels).
  const before = (k: number) => num((k + 0.5) / FPS)
  const perFrame = (values: number[]) =>
    values.reduceRight(
      (rest, value, k) => `if(lt(t,${before(k)}),${value},${rest})`,
      String(values[values.length - 1]),
    )
  const shifts = steps.map((s) => Math.round(s.shift * W))
  const blurs = steps.flatMap((s, k) =>
    s.blur >= 0.5
      ? [`gblur=sigma=${num(s.blur)}:sigmaV=0:enable='between(t,${before(k - 1)},${before(k)})'`]
      : [],
  )
  return [
    `${picture},split=2[cur][curw]`,
    `${old},trim=end_frame=${frames}[old]`,
    `[${canvas}:v]format=rgb24,${TO_YUV},trim=end_frame=${frames}[canvas]`,
    `[curw]trim=end_frame=${frames}[new]`,
    `[canvas][old]overlay=x='${perFrame(shifts.map((x) => -x))}':y=0:eval=frame:format=yuv420[half]`,
    `[half][new]overlay=x='${perFrame(shifts.map((x) => W - x))}':y=0:eval=frame:format=yuv420${blurs.length ? `,${blurs.join(',')}` : ''}[whip]`,
    `[cur][whip]overlay=eof_action=pass:format=yuv420,${finish}`,
  ]
}

interface AudioPlan {
  inputs: string[]
  graph: string
  label: string
  detail: string
}

/**
 * The sound effects the edit plays: a whoosh from each whip's cut, and a swish or thud on each
 * zoom-cut and shake that made it into a clip, at the frame it lands on.
 */
export function editSounds(segments: Segment[]): SoundEvent[] {
  const time = (segment: Segment, frame: number) => (segment.startFrame + frame) / FPS
  return sfxEvents(
    segments.filter((s) => s.plan.whip > 0).map((s) => s.startFrame / FPS),
    segments.flatMap((s) => [
      ...(s.accents.zoom !== null
        ? [{ kind: 'zoom' as const, time: time(s, s.accents.zoom), scene: s.sceneIndex }]
        : []),
      ...s.accents.shakes.map((frame) => ({
        kind: 'shake' as const,
        time: time(s, frame),
        scene: s.sceneIndex,
      })),
    ]),
  )
}

/**
 * Voice (or silence) + optional looped music, ducked under the voice and faded out at the end,
 * plus the sound effects: each effect file (one per sound) is split into one copy per event,
 * delayed to its moment and mixed in at SFX_LEVEL. Without effects the graph is unchanged.
 */
export function audioPlan(
  input: Pick<RenderInput, 'voiceoverPath' | 'musicPath' | 'musicVolume'>,
  duration: number,
  sounds: SoundEvent[] = [],
  soundFiles: Partial<Record<SoundName, string>> = {},
): AudioPlan {
  const D = num(duration)
  const inputs: string[] = []
  const graph: string[] = []
  let next = 1 // input 0 is the concat'ed video
  const voice = input.voiceoverPath ? resolve(input.voiceoverPath) : null
  const music = input.musicPath && input.musicVolume > 0 ? resolve(input.musicPath) : null

  if (voice) {
    inputs.push('-i', voice)
    // Mono first so a mono voice isn't dropped 3 dB by the stereo upmix, then duplicated.
    graph.push(
      `[${next++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,asetpts=PTS-STARTPTS,` +
        `pan=stereo|c0=c0|c1=c0,apad,atrim=end=${D}[voice]`,
    )
  }
  if (music) {
    inputs.push('-stream_loop', '-1', '-i', music)
    const fade = Math.min(2, duration)
    graph.push(
      `[${next++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,` +
        `atrim=end=${D},volume=${num(clamp(input.musicVolume, 0, 1))},` +
        `afade=t=out:st=${num(Math.max(0, duration - fade))}:d=${num(fade)}[music]`,
    )
  }

  // What gets mixed: the voice with the ducked music, or whichever there is, or silence.
  let beds: string[]
  let detail: string
  if (voice && music) {
    graph.push(
      '[voice]asplit=2[vmix][vkey]',
      // Duck the music ~12 dB while the voice speaks; release slowly so it doesn't pump.
      '[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=450:knee=4[ducked]',
    )
    beds = ['[vmix]', '[ducked]']
    detail = 'Mixing voice-over and music'
  } else if (voice) {
    beds = ['[voice]']
    detail = 'Adding voice-over'
  } else if (music) {
    beds = ['[music]']
    detail = 'Adding music'
  } else {
    inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
    graph.push(`[${next++}:a]atrim=end=${D}[silence]`)
    beds = ['[silence]']
    detail = 'Adding audio track'
  }

  const effects: string[] = []
  for (const sound of ['whoosh', 'swish', 'thud'] as const) {
    const file = soundFiles[sound]
    const starts = sounds.filter((e) => e.sound === sound).map((e) => e.start)
    if (!file || starts.length === 0) continue
    inputs.push('-i', resolve(file))
    const copies = starts.map((_, i) => `[${sound}${i}]`)
    graph.push(
      `[${next++}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono` +
        (copies.length > 1 ? `,asplit=${copies.length}${copies.join('')}` : copies[0]),
      ...starts.map(
        (start, i) => `${copies[i]}adelay=delays=${Math.round(start * 1000)}:all=1[${sound}d${i}]`,
      ),
    )
    effects.push(...starts.map((_, i) => `[${sound}d${i}]`))
  }
  if (effects.length > 0) {
    graph.push(
      `${effects.join('')}${effects.length > 1 ? `amix=inputs=${effects.length}:duration=longest:dropout_transition=0:normalize=0,` : ''}` +
        `volume=${num(SFX_LEVEL)},pan=stereo|c0=c0|c1=c0[sfx]`,
    )
    beds.push('[sfx]')
    detail = `${detail} and sound effects`
  }

  if (beds.length === 1) return { inputs, graph: graph.join(';'), label: beds[0], detail }
  graph.push(
    `${beds.join('')}amix=inputs=${beds.length}:duration=first:dropout_transition=0:normalize=0,` +
      'alimiter=limit=0.97:level=false:latency=true[aout]',
  )
  return { inputs, graph: graph.join(';'), label: '[aout]', detail }
}

export async function renderVideo(input: RenderInput): Promise<RenderOutput> {
  const { signal } = input
  throwIfAborted(signal)
  if (!(input.duration > 0) || !Number.isFinite(input.duration)) {
    throw new Error(`Cannot render a video of duration ${input.duration}`)
  }
  const workDir = resolve(input.workDir)
  const size = outputSize(input.format, input.resolution)
  const totalFrames = Math.max(1, Math.round(input.duration * FPS))
  const threads = defaultThreads()

  let lastFraction = -1
  let lastDetail = ''
  const report = (fraction: number, detail: string) => {
    const f = clamp(fraction, 0, 1)
    // Monotonic; same-step updates at most every 0.5%.
    if (f < lastFraction) return
    if (detail === lastDetail && f - lastFraction < 0.005 && f < 1) return
    lastFraction = f
    lastDetail = detail
    input.onProgress?.(f, detail)
  }
  report(0, 'Preparing scenes')

  // Captions: SRT always (YouTube caption track). ASS only when captions or on-screen text
  // are burned in.
  const srtPath = join(workDir, SRT_NAME)
  await writeFile(srtPath, input.words.length ? toSrt(input.words) : '', 'utf8')
  const captionsOn = input.captionStyle !== 'off' && input.words.length > 0
  const overlays = input.overlays ?? []
  const burn = captionsOn || overlays.length > 0
  if (burn) {
    const chunks = captionsOn ? chunkCaptions(input.words, input.format) : []
    const style = captionsOn ? input.captionStyle : 'off'
    const ass = buildAss(chunks, { ...size, format: input.format, style }, overlays)
    await writeFile(join(workDir, ASS_NAME), ass, 'utf8')
  }

  // Probe each distinct image once (also fails early with a clear message on a broken file).
  const accents = accentEvents(
    input.scenes.map((s) => ({
      start: s.start,
      end: s.end,
      accent: s.accent ?? 'none',
      accentWord: s.accentWord ?? '',
    })),
    input.words,
    totalFrames / FPS,
  )
  const segments = planSegments(input.scenes, totalFrames, accents)
  const sizes = new Map<string, ImageSize>()
  const files = segments.flatMap((segment) =>
    [segment.visual?.path, segment.visual?.pose?.path, segment.visual?.pose?.blinkPath].map((path) => ({
      path,
      segment,
    })),
  )
  for (const { path, segment } of files) {
    if (!path || sizes.has(path)) continue
    try {
      sizes.set(path, await probeImageSize(path, signal))
    } catch (error) {
      if (signal?.aborted) throw error
      const scene = segment.sceneIndex + 1
      throw new Error(`Scene ${scene}: could not read image ${path}: ${(error as Error).message}`, {
        cause: error,
      })
    }
  }

  // A layered scene's character bounces while the narrator speaks.
  const speech = speechSpans(input.words)
  // Clips rendered side by side share the cores between them.
  const slots = renderSlots()
  const clipThreads = slots > 1 ? Math.max(1, Math.floor(threads / slots)) : threads
  const jobs: SegmentJob[] = segments.map((segment, i) => {
    const file = `scene-${String(i + 1).padStart(3, '0')}.mp4`
    const previous = segments[i - 1] ?? null
    return {
      segment,
      file,
      args: segmentArgs(segment, previous, file, size, sizes, burn, clipThreads, speech),
    }
  })

  // Several clips at once on a multi-core machine; the first failure stops the rest.
  const sceneCount = Math.max(1, input.scenes.length)
  const running = new Map<SegmentJob, number>()
  let framesDone = 0
  const progress = (detail: string) => {
    let frames = framesDone
    for (const [job, fraction] of running) frames += fraction * job.segment.frames
    report((SCENES_WEIGHT * frames) / totalFrames, detail)
  }
  const stop = new AbortController()
  const abort = () => stop.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let next = 0
  try {
    await Promise.all(
      Array.from({ length: Math.min(slots, jobs.length) }, async () => {
        while (next < jobs.length && !stop.signal.aborted) {
          const job = jobs[next++]
          const detail = `Rendering scene ${Math.min(job.segment.sceneIndex + 1, sceneCount)} of ${sceneCount}`
          running.set(job, 0)
          progress(detail)
          try {
            await runFfmpeg(job.args, {
              cwd: workDir,
              signal: stop.signal,
              duration: job.segment.frames / FPS,
              onProgress: (fraction) => {
                running.set(job, fraction)
                progress(detail)
              },
            })
          } catch (error) {
            stop.abort(error)
            throw error
          }
          running.delete(job)
          framesDone += job.segment.frames
        }
      }),
    )
  } catch (error) {
    // The caller's own abort comes out as that, not as the clip it happened to interrupt.
    throwIfAborted(signal)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }

  // Concat (stream copy) + audio.
  const list = ['ffconcat version 1.0']
  for (const job of jobs) list.push(`file '${job.file}'`, `duration ${num(job.segment.frames / FPS)}`)
  await writeFile(join(workDir, LIST_NAME), `${list.join('\n')}\n`, 'utf8')

  const exactDuration = totalFrames / FPS
  // The sound effects, written once per sound that plays.
  const sounds = input.soundEffects === false ? [] : editSounds(segments)
  const soundFiles: Partial<Record<SoundName, string>> = {}
  for (const sound of new Set(sounds.map((e) => e.sound))) {
    const name = `sfx-${sound}.wav`
    await writeFile(join(workDir, name), wavBytes(synthesize(sound)))
    soundFiles[sound] = join(workDir, name)
  }
  const audio = audioPlan(input, exactDuration, sounds, soundFiles)
  const finalDetail = audio.detail
  report(SCENES_WEIGHT, finalDetail)
  await runFfmpeg(
    [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      LIST_NAME,
      ...audio.inputs,
      '-filter_complex_threads',
      '1',
      '-filter_complex',
      audio.graph,
      '-map',
      '0:v',
      '-map',
      audio.label,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-t',
      num(exactDuration),
      '-movflags',
      '+faststart',
      OUTPUT_NAME,
    ],
    {
      cwd: workDir,
      signal,
      duration: exactDuration,
      onProgress: (f) => report(SCENES_WEIGHT + (1 - SCENES_WEIGHT) * f * 0.98, finalDetail),
    },
  )

  const videoPath = join(workDir, OUTPUT_NAME)
  const durationSeconds = await probeDuration(videoPath, signal)

  // The clips are only intermediates; free the disk before the upload steps run.
  await Promise.all(jobs.map((job) => rm(join(workDir, job.file), { force: true }).catch(() => {})))
  report(1, 'Render complete')
  return { videoPath, srtPath, durationSeconds }
}
