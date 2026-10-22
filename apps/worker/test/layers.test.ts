// Layered scenes (a Library background with a character's pose in front) against real ffmpeg:
// the pose stands where the editor shows it, the character blinks, and crossfades still work.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runFfmpeg } from '../src/render/ffmpeg'
import { planSegments, poseY, type RenderScene, renderVideo } from '../src/render/render'

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-layers-'))
const file = (name: string) => path.join(temp, name)

function scene(start: number, end: number, extra: Partial<RenderScene>): RenderScene {
  return {
    start,
    end,
    imagePath: null,
    motion: 'none',
    fit: 'cover',
    focusX: 0.5,
    focusY: 0.5,
    transition: 'cut',
    ...extra,
  }
}

/** One pixel of the video at `time`, as [r, g, b]. */
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

const still = (name: string, source: string) =>
  runFfmpeg(['-f', 'lavfi', '-i', source, '-frames:v', '1', file(name)])

beforeAll(async () => {
  await still('kitchen.png', 'color=c=0x3366cc:s=640x360')
  // Cut-outs with an alpha channel: orange eyes open, green eyes closed.
  await still('happy.png', 'color=c=0xff8800:s=200x300,format=rgba')
  await still('happy-blink.png', 'color=c=0x00cc44:s=200x300,format=rgba')
})

afterAll(() => {
  try {
    rmSync(temp, { recursive: true, force: true })
  } catch {}
})

describe('layered scenes in the render plan', () => {
  it('gives every layered scene its own clip, and lets a scene without a picture hold it', () => {
    const layer = (side: 'left' | 'right') => ({
      backgroundPath: file('kitchen.png'),
      posePath: file('happy.png'),
      blinkPath: null,
      side,
    })
    const segments = planSegments(
      [
        scene(0, 2, { layer: layer('left') }),
        scene(2, 4, { layer: layer('right') }),
        scene(4, 6, {}),
        scene(6, 8, { layer: { ...layer('left'), backgroundPath: null } }),
      ],
      240,
    )
    expect(segments.map((s) => s.frames)).toEqual([60, 120, 60])
    expect(segments[1].visual?.pose?.side).toBe('right')
    // A pose on its own stands on the plain background.
    expect(segments[2].visual?.path).toBeNull()
    expect(segments[2].visual?.pose?.path).toBe(path.resolve(file('happy.png')))
  })

  it('bounces only through the speech within the clip', () => {
    const y = poseY(
      10,
      2,
      [
        { start: 9, end: 10.8 },
        { start: 13, end: 14 },
      ],
      0.035,
    )
    expect(y.match(/between/g)).toHaveLength(1)
    expect(y).toContain('between(t,-1,0.8)')
    expect(y.startsWith('H-h+h*0.035*(1-')).toBe(true)
    expect(poseY(0, 2, [], 0.035)).not.toContain('between')
  })
})

describe('rendering layered scenes', () => {
  it('stands the pose in front of the background, blinks, and crossfades to the next pose', async () => {
    const workDir = mkdtempSync(path.join(temp, 'render-'))
    writeFileSync(path.join(workDir, '.keep'), '')
    const output = await renderVideo({
      workDir,
      format: 'landscape',
      resolution: '720p',
      captionStyle: 'off',
      scenes: [
        scene(0, 2, {
          motion: 'zoom-in',
          layer: {
            backgroundPath: file('kitchen.png'),
            posePath: file('happy.png'),
            blinkPath: null,
            side: 'left',
          },
        }),
        scene(2, 4, {
          transition: 'crossfade',
          layer: {
            backgroundPath: null,
            posePath: file('happy.png'),
            blinkPath: file('happy-blink.png'),
            side: 'center',
          },
        }),
      ],
      voiceoverPath: null,
      duration: 4,
      words: [
        { text: 'Cappy', start: 0.2, end: 0.7 },
        { text: 'is', start: 0.75, end: 0.9 },
        { text: 'hungry.', start: 0.95, end: 1.5 },
      ],
      musicPath: null,
      musicVolume: 0,
    })
    expect(output.durationSeconds).toBeGreaterThan(3.9)

    const isOrange = ([r, g, b]: number[]) => r > 200 && g > 100 && g < 170 && b < 80
    const isGreen = ([r, g, b]: number[]) => g > 150 && r < 80 && b < 120
    // Scene 1: the background, and the pose on the left (box 768×576 → 384×576 from x≈77).
    const background = await pixel(output.videoPath, 1, 1200, 60)
    expect(background[2]).toBeGreaterThan(150)
    expect(isOrange(await pixel(output.videoPath, 1, 250, 600))).toBe(true)
    expect(isOrange(await pixel(output.videoPath, 1, 1000, 600))).toBe(false)
    // Scene 2: the pose alone, in the middle; its eyes close at 2.8–2.93 s.
    expect(isGreen(await pixel(output.videoPath, 2.86, 640, 600))).toBe(true)
    expect(isOrange(await pixel(output.videoPath, 3.5, 640, 600))).toBe(true)
    const dark = await pixel(output.videoPath, 3.5, 100, 100)
    expect(Math.max(...dark)).toBeLessThan(60)
  }, 120_000)
})
