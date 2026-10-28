// The explainer-style edit: steady drift, zoom-cuts, shakes, whips and their sound effects, in the
// render plan and against real ffmpeg.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseVolume } from '../src/audio'
import { ffmpegLog, probeStreams, runFfmpeg } from '../src/render/ffmpeg'
import {
  audioPlan,
  editSounds,
  motionFilter,
  planSegments,
  type RenderScene,
  renderVideo,
  segmentArgs,
} from '../src/render/render'

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-editing-'))
const file = (name: string) => path.join(temp, name)

function scene(start: number, end: number, extra: Partial<RenderScene> = {}): RenderScene {
  return {
    start,
    end,
    imagePath: file('a.png'),
    motion: 'none',
    fit: 'cover',
    focusX: 0.5,
    focusY: 0.5,
    transition: 'cut',
    ...extra,
  }
}

/** One pixel of the first frame at or after `time`, as [r, g, b]. */
async function pixel(video: string, time: number, x: number, y: number): Promise<number[]> {
  const out = file(`px-${time}-${x}-${y}.rgb`)
  await runFfmpeg([
    '-ss',
    String(time),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    `format=rgb24,crop=1:1:${x}:${y}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    out,
  ])
  return [...readFileSync(out)]
}

/** Mean loudness (dB) of the video's sound between two times. */
async function loudness(video: string, from: number, to: number): Promise<number> {
  const log = await ffmpegLog([
    '-ss',
    String(from),
    '-t',
    String(to - from),
    '-i',
    video,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ])
  return parseVolume(log).mean ?? -100
}

beforeAll(async () => {
  const still = (name: string, source: string) =>
    runFfmpeg(['-f', 'lavfi', '-i', source, '-frames:v', '1', file(name)])
  await still('a.png', 'color=c=0x202020:s=1280x720')
  // A white box in the middle (540–740 × 260–460): a zoom-cut makes it bigger.
  await still('box.png', 'color=c=0x202020:s=1280x720,drawbox=x=540:y=260:w=200:h=200:c=white:t=fill')
  await still('red.png', 'color=c=0xdd2222:s=1280x720')
  await still('blue.png', 'color=c=0x2244dd:s=1280x720')
  // White on the left half, black on the right: a shake moves the edge.
  await still('edge.png', 'color=c=black:s=1280x720,drawbox=x=0:y=0:w=640:h=720:c=white:t=fill')
})

afterAll(() => {
  try {
    rmSync(temp, { recursive: true, force: true })
  } catch {}
})

describe('the camera', () => {
  it('drifts at a steady speed', () => {
    const filter = motionFilter('zoom-in', 90, 1280, 720, 640, 360)!
    // perspective counts frames from 1.
    expect(filter).toContain('exp(-0.113329*((in-1)/89))')
    expect(filter).not.toContain('cos(')
  })

  it('zoom-cuts from the accent frame and shakes inside its window, on top of the move', () => {
    const filter = motionFilter('pan-left', 90, 1280, 720, 640, 360, 0, { zoom: 30, shakes: [60] })!
    expect(filter).toContain('if(gte((in-1),30),0.714286,1)')
    expect(filter).toContain('between((in-1),60,71)')
    expect(filter).toContain('(1-((in-1)/89))')
    // Accents alone still need the transform.
    expect(motionFilter('none', 90, 1280, 720, 640, 360, 0, { zoom: null, shakes: [0] })).toContain(
      'between((in-1),0,11)',
    )
    expect(motionFilter('none', 90, 1280, 720, 640, 360)).toBeNull()
  })
})

describe('accents and whips in the render plan', () => {
  it('puts each accent in the clip on screen at its moment, one zoom-cut per picture', () => {
    const segments = planSegments(
      [scene(0, 2), scene(2, 4, { imagePath: null }), scene(4, 6, { imagePath: file('box.png') })],
      180,
      [
        { kind: 'zoom', time: 1, scene: 0 },
        { kind: 'zoom', time: 3, scene: 1 },
        { kind: 'shake', time: 3.5, scene: 1 },
        { kind: 'shake', time: 4.5, scene: 2 },
      ],
    )
    expect(segments.map((s) => s.accents)).toEqual([
      { zoom: 30, shakes: [105] },
      { zoom: null, shakes: [15] },
    ])
  })

  it('whips only where there is a picture to whip from, and never inside one shot', () => {
    const layer = (pose: string) => ({
      backgroundPath: file('a.png'),
      posePath: file(pose),
      blinkPath: null,
      side: 'center' as const,
    })
    const segments = planSegments(
      [
        scene(0, 2, { transition: 'whip' }),
        scene(2, 4, { imagePath: file('red.png'), transition: 'whip' }),
        scene(4, 6, { imagePath: null, layer: layer('red.png') }),
        scene(6, 8, { imagePath: null, layer: layer('blue.png'), transition: 'whip' }),
      ],
      240,
    )
    expect(segments.map((s) => s.plan.whip)).toEqual([0, 9, 0, 0])
    expect(segments[0].plan.tail).toBe(9)
    expect(editSounds(segments)).toEqual([{ sound: 'whoosh', start: 2 }])
  })

  it('builds the whip from both pictures on a canvas, blurred frame by frame', () => {
    const segments = planSegments(
      [scene(0, 3), scene(3, 6, { imagePath: file('red.png'), transition: 'whip', motion: 'zoom-in' })],
      180,
    )
    const sizes = new Map([
      [segments[0].visual!.path!, { width: 1280, height: 720 }],
      [segments[1].visual!.path!, { width: 1280, height: 720 }],
    ])
    const args = segmentArgs(segments[1], segments[0], 'b.mp4', { width: 1280, height: 720 }, sizes, true, 1)
    const inputs = args.filter((_, i) => args[i - 1] === '-i')
    expect(inputs).toEqual([
      segments[1].visual!.path,
      segments[0].visual!.path,
      'color=c=0x14171f:s=1280x720:r=30',
    ])
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('split=2[cur][curw]')
    expect(graph).toContain('trim=end_frame=9[old]')
    expect(graph.match(/gblur=/g)).toHaveLength(9)
    expect(graph).toContain("enable='between(t,0.116667,0.15)'")
    expect(graph).toContain('[cur][whip]overlay=eof_action=pass')
    // Pad names are unique.
    const outputs = graph.match(/\[[a-z]+\](?=;|$)/g) ?? []
    expect(new Set(outputs).size).toBe(outputs.length)
  })
})

describe('the sound of the edit', () => {
  it('leaves the audio as it was without effects', () => {
    const plain = audioPlan({ voiceoverPath: 'voice.mp3', musicPath: 'music.mp3', musicVolume: 0.2 }, 10)
    expect(plain.graph).toContain(
      '[vmix][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97:level=false:latency=true[aout]',
    )
    expect(plain.inputs.filter((a) => a === '-i')).toHaveLength(2)
    expect(audioPlan({ voiceoverPath: 'voice.mp3', musicPath: null, musicVolume: 0 }, 10).label).toBe(
      '[voice]',
    )
  })

  it('splits each sound into one copy per event, delayed to its moment, under the voice', () => {
    const plan = audioPlan(
      { voiceoverPath: 'voice.mp3', musicPath: null, musicVolume: 0 },
      10,
      [
        { sound: 'whoosh', start: 2 },
        { sound: 'whoosh', start: 7.5 },
        { sound: 'thud', start: 4 },
      ],
      { whoosh: 'sfx-whoosh.wav', thud: 'sfx-thud.wav' },
    )
    expect(plan.inputs.filter((a) => a === '-i')).toHaveLength(3)
    expect(plan.graph).toContain('asplit=2[whoosh0][whoosh1]')
    expect(plan.graph).toContain('[whoosh1]adelay=delays=7500:all=1[whooshd1]')
    expect(plan.graph).toContain('[thudd0]amix=inputs=3')
    expect(plan.graph).toContain('[voice][sfx]amix=inputs=2:duration=first')
    expect(plan.label).toBe('[aout]')
    expect(plan.detail).toBe('Adding voice-over and sound effects')
  })
})

describe('rendering the edit', () => {
  it('zoom-cuts, whips and shakes on time, with sound, at the exact length', async () => {
    const workDir = mkdtempSync(path.join(temp, 'render-'))
    const output = await renderVideo({
      workDir,
      format: 'landscape',
      resolution: '720p',
      captionStyle: 'off',
      scenes: [
        scene(0, 2, { imagePath: file('box.png'), accent: 'zoom' }),
        scene(2, 4, { imagePath: file('red.png') }),
        scene(4, 6, { imagePath: file('blue.png'), transition: 'whip' }),
        scene(6, 8, { imagePath: file('edge.png'), accent: 'shake' }),
      ],
      voiceoverPath: null,
      duration: 8,
      words: [],
      musicPath: null,
      musicVolume: 0,
    })
    expect(output.durationSeconds).toBeCloseTo(8, 1)
    expect((await probeStreams(output.videoPath)).map((s) => s.codec_type).sort()).toEqual(['audio', 'video'])

    const bright = (rgb: number[]) => Math.min(...rgb) > 180
    // Zoom-cut at 1 s (the middle of the scene): the box grows past x = 520.
    expect(bright(await pixel(output.videoPath, 0.5, 520, 360))).toBe(false)
    expect(bright(await pixel(output.videoPath, 1.5, 520, 360))).toBe(true)
    // Frame 5 of the whip at 4 s: red has slid out past x = 200, blue covers the right.
    const left = await pixel(output.videoPath, 4.14, 200, 360)
    const right = await pixel(output.videoPath, 4.14, 1080, 360)
    expect(left[0]).toBeGreaterThan(left[2])
    expect(right[2]).toBeGreaterThan(right[0])
    expect((await pixel(output.videoPath, 4.5, 200, 360))[2]).toBeGreaterThan(150)
    // The shake at 6 s moves the edge at x = 640 to x ≈ 653 on its second frame.
    expect(bright(await pixel(output.videoPath, 5.99, 646, 360))).toBe(false)
    expect(bright(await pixel(output.videoPath, 6.02, 646, 360))).toBe(true)

    // Sound only where the effects are: a swish at 1 s, a whoosh at 4 s, a thud at 6 s.
    expect(await loudness(output.videoPath, 2.5, 3.5)).toBeLessThan(-80)
    expect(await loudness(output.videoPath, 4, 4.35)).toBeGreaterThan(-40)
    expect(await loudness(output.videoPath, 6, 6.3)).toBeGreaterThan(-40)
    expect(await loudness(output.videoPath, 0.9, 1.05)).toBeGreaterThan(-40)
  }, 180_000)

  it('stays silent with sound effects off', async () => {
    const workDir = mkdtempSync(path.join(temp, 'quiet-'))
    const output = await renderVideo({
      workDir,
      format: 'landscape',
      resolution: '720p',
      captionStyle: 'off',
      scenes: [scene(0, 1), scene(1, 2, { imagePath: file('red.png'), transition: 'whip' })],
      voiceoverPath: null,
      duration: 2,
      words: [],
      musicPath: null,
      musicVolume: 0,
      soundEffects: false,
    })
    expect(await loudness(output.videoPath, 0.9, 1.4)).toBeLessThan(-80)
  }, 120_000)
})
