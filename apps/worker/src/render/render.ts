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
import { rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chunkCaptions, type Overlay, toSrt } from '@cutroom/shared/captions'
import { planTransitions, type TransitionPlan } from '@cutroom/shared/transitions'
import type {
  CaptionStyle,
  ImageFit,
  Motion,
  Resolution,
  Transition,
  VideoFormat,
  Word,
} from '@cutroom/shared/types'
import { outputSize } from '@cutroom/shared/types'
import { buildAss } from './ass'
import { defaultThreads, probeDuration, probeImageSize, runFfmpeg, throwIfAborted } from './ffmpeg'

export interface RenderScene {
  /** Seconds on the final timeline; scenes are contiguous & sorted. */
  start: number
  end: number
  /** Local file path (png/jpg/webp); null = no image uploaded (the previous image holds). */
  imagePath: string | null
  motion: Motion
  fit: ImageFit
  /** 0..1 focus point used when cropping for 'cover' (and as the zoom anchor). */
  focusX: number
  focusY: number
  /** How this scene's picture comes in. Ignored for scenes without an image. */
  transition: Transition
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
  path: string
  fit: ImageFit
  focusX: number
  focusY: number
  motion: Motion
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
}

const NO_FADES: TransitionPlan = { fadeIn: 0, fadeOut: 0, crossfade: 0, tail: 0 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const clamp01 = (n: number) => (Number.isFinite(n) ? clamp(n, 0, 1) : 0.5)

/**
 * Splits the timeline into clips with exact frame counts. Boundaries are rounded once on the
 * absolute timeline (not per scene), so rounding never accumulates and the frames always add up
 * to round(duration * FPS). A scene without an image extends the previous clip — the previous
 * image keeps moving with the same motion instead of jumping back to its first frame. Before
 * the first image there's a solid dark frame.
 */
export function planSegments(scenes: RenderScene[], totalFrames: number): Segment[] {
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
    if (scene.imagePath) {
      lastTransition = scene.transition ?? 'cut'
      lastVisual = {
        path: resolve(scene.imagePath),
        fit: scene.fit,
        focusX: clamp01(scene.focusX),
        focusY: clamp01(scene.focusY),
        motion: scene.motion,
      }
    }
    const frames = bounds[i + 1] - bounds[i]
    if (frames <= 0) return
    const previous = segments[segments.length - 1]
    if (!scene.imagePath && previous && previous.visual === lastVisual) {
      previous.frames += frames
      return
    }
    segments.push({
      startFrame: bounds[i],
      frames,
      visual: lastVisual,
      sceneIndex: i,
      transition: lastTransition,
      plan: NO_FADES,
    })
  })
  if (segments.length === 0)
    segments.push({
      startFrame: 0,
      frames: totalFrames,
      visual: null,
      sceneIndex: 0,
      transition: 'cut',
      plan: NO_FADES,
    })
  const plans = planTransitions(
    segments.map((s) => ({ length: s.frames, hasVisual: s.visual !== null, transition: s.transition })),
    FPS,
    true,
  )
  segments.forEach((segment, i) => {
    segment.plan = plans[i]
  })
  return segments
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
 * travel horizontally at a fixed 1/(1-f) zoom. Easing is half linear / half cosine: it starts
 * and ends at half speed, so the motion doesn't snap at cuts but never fully stops either.
 * `frames` is the whole move; `offset` starts this clip part-way through it (the previous
 * picture continuing its move while it crossfades out). Returns null when nothing animates.
 */
export function motionFilter(
  motion: Motion,
  frames: number,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  offset = 0,
): string | null {
  if (motion === 'none' || frames < 2) return null
  const seconds = frames / FPS
  const p = offset > 0 ? `((in+${offset})/${frames - 1})` : `(in/${frames - 1})`
  const eased = `(0.5*${p}+0.25*(1-cos(PI*${p})))`
  const ax = num(clamp(anchorX, 0, width))
  const ay = num(clamp(anchorY, 0, height))
  const W = num(width)
  const H = num(height)

  let r: string // visible fraction of the frame (1/zoom), as an expression of `in`
  let x0: string
  if (motion === 'zoom-in' || motion === 'zoom-out') {
    // Subtle and capped in speed: short scenes zoom less instead of lurching.
    const amount = Math.min(0.12, 0.05 * seconds)
    const k = num(Math.log(1 + amount))
    // exp() makes the zoom change at a constant perceived rate.
    r = motion === 'zoom-in' ? `exp(-${k}*${eased})` : `exp(-${k}*(1-${eased}))`
    x0 = `(${ax}-${ax}*${r})`
  } else {
    // Pan across up to 10% of the frame width (slower for short scenes).
    const travel = Math.min(0.1, 0.04 * seconds)
    r = num(1 - travel)
    const span = num(travel * width)
    x0 = motion === 'pan-right' ? `(${span}*${eased})` : `(${span}*(1-${eased}))`
  }
  const x1 = `(${x0}+${W}*${r})`
  const y0 = `(${ay}-${ay}*${r})`
  const y2 = `(${ay}+(${H}-${ay})*${r})`
  const opts = { x0, y0, x1, y1: y0, x2: x0, y2, x3: x1, y3: y2 }
  const parts = Object.entries(opts).map(([key, expr]) => `${key}='${expr}'`)
  return `perspective=${parts.join(':')}:interpolation=linear:sense=source:eval=frame`
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

export function segmentArgs(
  segment: Segment,
  previous: Segment | null,
  file: string,
  size: { width: number; height: number },
  sizes: Map<string, ImageSize>,
  burn: boolean,
  threads: number,
): string[] {
  const { width: W, height: H } = size
  const { plan } = segment
  const image = segment.visual ? (sizes.get(segment.visual.path) ?? null) : null
  const inputs: string[] = []
  let chain: string
  let motion: string | null = null
  if (segment.visual && image) {
    const base = baseFrame(segment.visual, size, image, 'a')
    inputs.push('-i', segment.visual.path)
    chain = base.chain
    // The move runs on through the next picture's crossfade (plan.tail), so it never stalls.
    motion = motionFilter(segment.visual.motion, segment.frames + plan.tail, W, H, base.anchorX, base.anchorY)
  } else {
    inputs.push('-f', 'lavfi', '-i', `color=c=${BACKGROUND}:s=${W}x${H}:r=${FPS}`)
    chain = `format=rgb24,${TO_YUV}`
  }
  // One decoded frame, repeated, then the move and any dip through black.
  const picture = [
    `[0:v]${chain}`,
    'loop=loop=-1:size=1:start=0',
    `settb=1/${FPS}`,
    'setpts=N',
    ...(motion ? [motion] : []),
    ...(plan.fadeIn > 0 ? [`fade=t=in:s=0:n=${plan.fadeIn}`] : []),
    ...(plan.fadeOut > 0 ? [`fade=t=out:s=${segment.frames - plan.fadeOut}:n=${plan.fadeOut}`] : []),
  ]
  // Timestamps = absolute timeline frames so libass shows the right text, then rebased to 0.
  const finish = [`setpts=N+${segment.startFrame}`, ...(burn ? [`ass=${ASS_NAME}`] : []), 'setpts=N[v]']

  const outgoing = previous?.visual ?? null
  const outgoingImage = outgoing ? (sizes.get(outgoing.path) ?? null) : null
  let graph: string
  if (plan.crossfade > 0 && previous && outgoing && outgoingImage) {
    // The previous picture, continuing its move from where its own clip ended, fades out on top.
    const base = baseFrame(outgoing, size, outgoingImage, 'b')
    inputs.push('-i', outgoing.path)
    const move = motionFilter(
      outgoing.motion,
      previous.frames + previous.plan.tail,
      W,
      H,
      base.anchorX,
      base.anchorY,
      previous.frames,
    )
    const old = [
      `[1:v]${base.chain}`,
      'loop=loop=-1:size=1:start=0',
      `settb=1/${FPS}`,
      'setpts=N',
      ...(move ? [move] : []),
      `trim=end_frame=${plan.crossfade}`,
      'format=yuva420p',
      `fade=t=out:s=0:n=${plan.crossfade}:alpha=1`,
    ]
    graph = [
      `${picture.join(',')}[cur]`,
      `${old.join(',')}[old]`,
      `[cur][old]overlay=eof_action=pass:format=yuv420,${finish.join(',')}`,
    ].join(';')
  } else {
    graph = [...picture, ...finish].join(',')
  }
  return [
    '-filter_complex_threads',
    String(threads),
    ...inputs,
    '-filter_complex',
    graph,
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

interface AudioPlan {
  inputs: string[]
  graph: string
  label: string
  detail: string
}

/** Voice (or silence) + optional looped music, ducked under the voice and faded out at the end. */
function audioPlan(input: RenderInput, duration: number): AudioPlan {
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

  if (voice && music) {
    graph.push(
      '[voice]asplit=2[vmix][vkey]',
      // Duck the music ~12 dB while the voice speaks; release slowly so it doesn't pump.
      '[music][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=450:knee=4[ducked]',
      '[vmix][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,' +
        'alimiter=limit=0.97:level=false:latency=true[aout]',
    )
    return { inputs, graph: graph.join(';'), label: '[aout]', detail: 'Mixing voice-over and music' }
  }
  if (voice) return { inputs, graph: graph.join(';'), label: '[voice]', detail: 'Adding voice-over' }
  if (music) return { inputs, graph: graph.join(';'), label: '[music]', detail: 'Adding music' }

  inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  graph.push(`[${next}:a]atrim=end=${D}[silence]`)
  return { inputs, graph: graph.join(';'), label: '[silence]', detail: 'Adding audio track' }
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
  const segments = planSegments(input.scenes, totalFrames)
  const sizes = new Map<string, ImageSize>()
  for (const segment of segments) {
    const path = segment.visual?.path
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

  const jobs: SegmentJob[] = segments.map((segment, i) => {
    const file = `scene-${String(i + 1).padStart(3, '0')}.mp4`
    const previous = segments[i - 1] ?? null
    return { segment, file, args: segmentArgs(segment, previous, file, size, sizes, burn, threads) }
  })

  const sceneCount = Math.max(1, input.scenes.length)
  let framesDone = 0
  for (const job of jobs) {
    const { segment } = job
    const detail = `Rendering scene ${Math.min(segment.sceneIndex + 1, sceneCount)} of ${sceneCount}`
    const at = (fraction: number) =>
      report((SCENES_WEIGHT * (framesDone + fraction * segment.frames)) / totalFrames, detail)
    at(0)
    await runFfmpeg(job.args, {
      cwd: workDir,
      signal,
      duration: segment.frames / FPS,
      onProgress: at,
    })
    framesDone += segment.frames
  }

  // Concat (stream copy) + audio.
  const list = ['ffconcat version 1.0']
  for (const job of jobs) list.push(`file '${job.file}'`, `duration ${num(job.segment.frames / FPS)}`)
  await writeFile(join(workDir, LIST_NAME), `${list.join('\n')}\n`, 'utf8')

  const exactDuration = totalFrames / FPS
  const audio = audioPlan(input, exactDuration)
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
