// End-to-end check of the render module: generates sample images, a voice-over and a music bed
// with ffmpeg (speech via Windows SAPI when available), renders a landscape 'highlight' video and
// a portrait 'line' video, then extracts PNG frames to look at.
//
//   pnpm --filter @cutroom/worker render:sample [--no-frames]
//
// Everything lands in <repo>/tmp/render-sample/.
import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chunkCaptions, type Overlay, overlayEvents, wordsFromScenes } from '@cutroom/shared/captions'
import type { CaptionStyle, Resolution, Transition, VideoFormat, Word } from '@cutroom/shared/types'
import { probeDuration, probeStreams, runFfmpeg } from '../src/render/ffmpeg'
import { type RenderScene, renderVideo } from '../src/render/render'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = join(repoRoot, 'tmp', 'render-sample')
const assetsDir = join(outDir, 'assets')
const withFrames = !process.argv.includes('--no-frames')

const SCRIPT =
  'Welcome to Cutroom. This sample turns a script, a voice over and a handful of images into a finished video. ' +
  'Every scene drifts with a gentle zoom or pan, while the captions follow each spoken word. ' +
  'When a scene has no picture, the previous one simply stays on screen. Thanks for watching!'

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

async function makeImage(file: string, source: string, codec: string[] = []): Promise<string> {
  const path = join(assetsDir, file)
  await runFfmpeg(['-f', 'lavfi', '-i', source, '-frames:v', '1', ...codec, '-update', '1', path])
  return path
}

/** Windows SAPI text-to-speech. Text and path go through env vars, so nothing needs quoting. */
function speak(text: string, wavPath: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  const script =
    'Add-Type -AssemblyName System.Speech; ' +
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
    '$s.SetOutputToWaveFile($env:CUTROOM_WAV); $s.Speak($env:CUTROOM_TEXT); $s.Dispose()'
  return new Promise((done) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, CUTROOM_WAV: wavPath, CUTROOM_TEXT: text },
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => done(false))
    child.on('close', async (code) => done(code === 0 && (await exists(wavPath))))
  })
}

async function makeAssets() {
  await mkdir(assetsDir, { recursive: true })
  console.log('Generating sample assets…')
  const images = {
    wide: await makeImage('wide-1920x1080.png', 'testsrc2=s=1920x1080'),
    tall: await makeImage('tall-1080x1920.jpg', 'mandelbrot=s=1080x1920:maxiter=600', ['-q:v', '3']),
    small: await makeImage('small-640x360.png', 'testsrc=s=640x360'),
    bars: await makeImage('bars-1600x1200.webp', 'smptehdbars=s=1600x1200', [
      '-c:v',
      'libwebp',
      '-quality',
      '85',
    ]),
    grid: await makeImage(
      'grid-1200x1200.jpg',
      'color=c=0x1d3557:s=1200x1200,drawgrid=w=100:h=100:t=3:c=0xf1faee@0.9,' +
        'drawbox=x=500:y=500:w=200:h=200:c=0xe63946:t=fill',
      ['-q:v', '3'],
    ),
  }

  const voicePath = join(assetsDir, 'voice.wav')
  await rm(voicePath, { force: true })
  let voiceKind = 'Windows SAPI speech'
  if (!(await speak(SCRIPT, voicePath))) {
    voiceKind = 'sine tone (SAPI unavailable)'
    // 3 s "talking" / 1 s pause, so the music ducking is audible.
    await runFfmpeg([
      '-f',
      'lavfi',
      '-i',
      "sine=f=190:d=20,tremolo=f=5:d=0.7,volume='if(lt(mod(t,4),3),1.5,0)':eval=frame",
      '-ac',
      '1',
      voicePath,
    ])
  }

  // A short pad (chord + pink noise) so -stream_loop has to loop it.
  const musicPath = join(assetsDir, 'music.mp3')
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=f=220:d=7',
    '-f',
    'lavfi',
    '-i',
    'sine=f=277.18:d=7',
    '-f',
    'lavfi',
    '-i',
    'sine=f=329.63:d=7',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=7:c=pink:a=0.05',
    '-filter_complex',
    '[0][1][2][3]amix=inputs=4:normalize=0,volume=1.6,afade=t=in:d=0.4,afade=t=out:st=6.6:d=0.4',
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    musicPath,
  ])
  return { images, voicePath, voiceKind, musicPath }
}

type Images = Awaited<ReturnType<typeof makeAssets>>['images']

function scene(
  start: number,
  end: number,
  imagePath: string | null,
  motion: RenderScene['motion'],
  fit: RenderScene['fit'] = 'cover',
  focusX = 0.5,
  focusY = 0.5,
  transition: Transition = 'cut',
): RenderScene {
  return { start, end, imagePath, motion, fit, focusX, focusY, transition }
}

/** On-screen text for some scenes, timed the way the publish job times it. */
function sampleOverlays(scenes: RenderScene[], duration: number, texts: string[]): Overlay[] {
  return overlayEvents(
    scenes.map((s, i) => ({ start: s.start, onScreenText: texts[i] ?? '' })),
    duration,
  )
}

/** Splits [0, duration] at the given fractions. */
function cuts(duration: number, fractions: number[]): [number, number][] {
  const points = [0, ...fractions.map((f) => Math.round(f * duration * 100) / 100), duration]
  return points.slice(0, -1).map((p, i) => [p, points[i + 1]])
}

function landscapeScenes(images: Images, duration: number): RenderScene[] {
  const t = cuts(duration, [0.16, 0.32, 0.44, 0.58, 0.72, 0.86])
  return [
    scene(...t[0], images.wide, 'zoom-in', 'cover', 0.5, 0.5, 'fade-black'), // fades in from black
    scene(...t[1], images.tall, 'zoom-out', 'contain', 0.5, 0.5, 'crossfade'), // contain over cover
    scene(...t[2], null, 'none', 'cover', 0.5, 0.5, 'crossfade'), // no image: transition ignored
    scene(...t[3], images.small, 'pan-right', 'cover', 0.5, 0.5, 'fade-black'),
    scene(...t[4], images.bars, 'pan-left', 'cover', 0.5, 0.3, 'crossfade'), // pan into pan
    scene(...t[5], images.grid, 'zoom-in', 'cover', 0.7, 0.4),
    scene(...t[6], images.tall, 'none', 'cover', 0.5, 0.35, 'crossfade'),
  ]
}

const LANDSCAPE_TEXT = [
  'Welcome to Cutroom',
  '',
  '',
  'Gentle zoom & pan',
  '',
  '{Braces} \\ and long text that wraps',
]
const PORTRAIT_TEXT = ['', 'Shorts too', '', 'Fit on blur', '', 'The end']

function portraitScenes(images: Images, duration: number): RenderScene[] {
  const t = cuts(duration, [0.1, 0.28, 0.46, 0.64, 0.82])
  return [
    scene(...t[0], null, 'zoom-in'), // no image yet: dark frame
    scene(...t[1], images.tall, 'zoom-in', 'cover', 0.5, 0.4, 'crossfade'), // fades in from the dark frame
    scene(...t[2], images.wide, 'pan-left', 'contain', 0.5, 0.5, 'crossfade'), // contain + contain labels
    scene(...t[3], images.grid, 'zoom-out', 'cover', 0.3, 0.5, 'fade-black'),
    scene(...t[4], images.small, 'none', 'cover', 0.8, 0.5, 'crossfade'),
    scene(...t[5], images.bars, 'zoom-in'),
  ]
}

interface Job {
  name: string
  format: VideoFormat
  resolution: Resolution
  captionStyle: CaptionStyle
  scenes: RenderScene[]
  overlays: Overlay[]
}

function fmt(seconds: number): string {
  return `${seconds.toFixed(2)}s`
}

/** A moment where a middle word of a caption chunk is being spoken (yellow in highlight mode). */
function captionMoment(words: Word[], format: VideoFormat, near: number): number {
  const chunks = chunkCaptions(words, format).filter((c) => c.words.length >= 3)
  const chunk = chunks.reduce((best, c) =>
    Math.abs(c.start - near) < Math.abs(best.start - near) ? c : best,
  )
  const word = chunk.words[1]
  return (word.start + word.end) / 2
}

async function extractFrames(name: string, video: string, job: Job, words: Word[], duration: number) {
  const shots: { label: string; time: number }[] = [
    { label: 'at-1s', time: 1 },
    { label: 'mid', time: duration / 2 },
    { label: 'caption', time: captionMoment(words, job.format, duration * 0.4) },
  ]
  job.scenes.forEach((s, i) => {
    shots.push({
      label: `scene${i + 1}-${s.imagePath ? s.fit : 'noimage'}-${s.motion}`,
      time: (s.start + s.end) / 2,
    })
    // Mid-transition: a crossfade is half way 0.25 s after the cut; a dip is darkest at the cut.
    if (i > 0 && s.imagePath && s.transition !== 'cut') {
      const at = s.transition === 'crossfade' ? s.start + 0.25 : s.start + 0.02
      shots.push({ label: `scene${i + 1}-${s.transition}`, time: at })
    }
  })
  const files: string[] = []
  for (const shot of shots) {
    const file = join(outDir, `${name}-${shot.label}-${shot.time.toFixed(2)}s.png`)
    await runFfmpeg(['-ss', shot.time.toFixed(3), '-i', video, '-frames:v', '1', '-update', '1', file])
    files.push(file)
  }
  // Three consecutive frames in the middle of the first moving scene, to judge smoothness.
  const moving = job.scenes.find((s) => s.imagePath && s.motion !== 'none')
  if (moving) {
    const at = (moving.start + moving.end) / 2
    const pattern = join(outDir, `${name}-consecutive-${at.toFixed(2)}s-%d.png`)
    await runFfmpeg(['-ss', at.toFixed(3), '-i', video, '-frames:v', '3', pattern])
    files.push(pattern.replace('%d', '{1,2,3}'))
  }
  return files
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const { images, voicePath, voiceKind, musicPath } = await makeAssets()
  const duration = Math.round((await probeDuration(voicePath)) * 100) / 100
  console.log(`Voice-over: ${voiceKind}, ${fmt(duration)}`)
  const words = wordsFromScenes([{ start: 0, end: duration, narration: SCRIPT }])

  const landscape = landscapeScenes(images, duration)
  const portrait = portraitScenes(images, duration)
  const jobs: Job[] = [
    {
      name: 'landscape',
      format: 'landscape',
      resolution: '720p',
      captionStyle: 'highlight',
      scenes: landscape,
      overlays: sampleOverlays(landscape, duration, LANDSCAPE_TEXT),
    },
    {
      name: 'portrait',
      format: 'portrait',
      resolution: '720p',
      captionStyle: 'line',
      scenes: portrait,
      overlays: sampleOverlays(portrait, duration, PORTRAIT_TEXT),
    },
  ]

  let failed = false
  for (const job of jobs) {
    const workDir = join(outDir, `${job.name}-work`)
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })
    console.log(`\n=== ${job.name} ${job.resolution} '${job.captionStyle}' ===`)
    let lastDetail = ''
    let lastTenth = -1
    const started = performance.now()
    const result = await renderVideo({
      workDir,
      format: job.format,
      resolution: job.resolution,
      captionStyle: job.captionStyle,
      scenes: job.scenes,
      voiceoverPath: voicePath,
      duration,
      words,
      overlays: job.overlays,
      musicPath,
      musicVolume: 0.35,
      onProgress: (fraction, detail) => {
        const tenth = Math.floor(fraction * 10)
        if (detail === lastDetail && tenth === lastTenth) return
        lastDetail = detail
        lastTenth = tenth
        console.log(`  ${(fraction * 100).toFixed(0).padStart(3)}%  ${detail}`)
      },
    })
    const seconds = (performance.now() - started) / 1000

    const video = join(outDir, `${job.name}.mp4`)
    const srt = join(outDir, `${job.name}.srt`)
    await copyFile(result.videoPath, video)
    await copyFile(result.srtPath, srt)
    const streams = await probeStreams(video)
    const drift = Math.abs(result.durationSeconds - duration)
    const hasAudio = streams.some((s) => s.codec_type === 'audio')
    const ok = drift <= 0.1 && hasAudio
    failed ||= !ok
    console.log(`  video:    ${video}`)
    console.log(`  captions: ${srt}`)
    console.log(
      `  streams:  ${streams.map((s) => `${s.codec_type}/${s.codec_name} ${s.duration ?? '?'}s`).join(', ')}`,
    )
    console.log(
      `  duration: ${fmt(result.durationSeconds)} (expected ${fmt(duration)}, off by ${drift.toFixed(3)}s) ${ok ? 'OK' : 'MISMATCH'}`,
    )
    console.log(`  rendered in ${fmt(seconds)} (${(duration / seconds).toFixed(2)}x realtime)`)

    if (withFrames) {
      const files = await extractFrames(job.name, video, job, words, duration)
      console.log('  frames:')
      for (const file of files) console.log(`    ${file}`)
    }
  }
  if (failed) {
    console.error('\nAt least one render did not match the expected duration or has no audio.')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
