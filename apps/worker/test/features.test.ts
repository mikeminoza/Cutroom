import { describe, expect, it } from 'vitest'
import { isMp3, parseSilences, parseVolume } from '../src/audio'
import { chunkText, textToRead } from '../src/jobs/voice'
import { buildAss } from '../src/render/ass'
import { motionFilter, planSegments, type RenderScene, segmentArgs } from '../src/render/render'

const LANDSCAPE_720 = { width: 1280, height: 720, format: 'landscape' as const }

function scene(
  start: number,
  end: number,
  imagePath: string | null,
  transition: RenderScene['transition'],
): RenderScene {
  return { start, end, imagePath, motion: 'zoom-in', fit: 'cover', focusX: 0.5, focusY: 0.5, transition }
}

describe('on-screen text in the ASS file', () => {
  it('adds a boxed top-centre style and fading, escaped events', () => {
    const ass = buildAss([], { ...LANDSCAPE_720, style: 'off' }, [
      { start: 0, end: 4, text: 'Three {hearts} \\ here' },
      { start: 4, end: 4.3, text: 'Quick' },
    ])
    const style = ass.split('\n').find((l) => l.startsWith('Style: Overlay'))
    expect(style).toBeDefined()
    const fields = style!.slice('Style: '.length).split(',')
    expect(fields[15]).toBe('3') // BorderStyle: opaque box
    expect(fields[18]).toBe('8') // Alignment: top centre
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(events).toHaveLength(2)
    expect(events[0]).toBe(
      'Dialogue: 1,0:00:00.00,0:00:04.00,Overlay,,0,0,0,,{\\fad(200,200)}Three \\{hearts\\} \\⁠ here',
    )
    // Too short to fade.
    expect(events[1]).toBe('Dialogue: 1,0:00:04.00,0:00:04.30,Overlay,,0,0,0,,Quick')
  })

  it('keeps captions and overlays together', () => {
    const words = [
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'there.', start: 0.5, end: 1 },
    ]
    const ass = buildAss([{ start: 0, end: 1, words }], { ...LANDSCAPE_720, style: 'line' }, [
      { start: 0, end: 2, text: 'Title' },
    ])
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'))
    expect(events.filter((e) => e.includes(',Overlay,'))).toHaveLength(1)
    expect(events.filter((e) => e.includes(',Caption,'))).toHaveLength(1)
  })
})

describe('transitions in the render plan', () => {
  it('plans fades per picture and ignores transitions of scenes without an image', () => {
    const segments = planSegments(
      [
        scene(0, 3, 'a.png', 'fade-black'),
        scene(3, 6, 'b.png', 'crossfade'),
        scene(6, 9, null, 'crossfade'), // holds b.png
        scene(9, 12, 'c.png', 'fade-black'),
      ],
      360,
    )
    expect(segments).toHaveLength(3)
    expect(segments.map((s) => s.frames)).toEqual([90, 180, 90])
    expect(segments[0].plan).toEqual({ fadeIn: 7, fadeOut: 0, crossfade: 0, tail: 15 })
    expect(segments[1].plan).toEqual({ fadeIn: 0, fadeOut: 7, crossfade: 15, tail: 0 })
    expect(segments[2].plan).toEqual({ fadeIn: 7, fadeOut: 0, crossfade: 0, tail: 0 })
  })

  it('continues the outgoing move from where its clip ended', () => {
    const offset = motionFilter('zoom-in', 105, 1280, 720, 640, 360, 90)
    expect(offset).toContain('((in+90)/104)')
    expect(motionFilter('zoom-in', 90, 1280, 720, 640, 360)).toContain('(in/89)')
  })

  it('builds a crossfade graph with both pictures and unique pad names', () => {
    const scenes = [
      { ...scene(0, 3, 'a.png', 'cut'), fit: 'contain' as const },
      { ...scene(3, 6, 'b.png', 'crossfade'), fit: 'contain' as const },
    ]
    const segments = planSegments(scenes, 180)
    const sizes = new Map([
      [segments[0].visual!.path!, { width: 1000, height: 1000 }],
      [segments[1].visual!.path!, { width: 1000, height: 1000 }],
    ])
    const args = segmentArgs(
      segments[1],
      segments[0],
      'out.mp4',
      { width: 1280, height: 720 },
      sizes,
      true,
      1,
    )
    const inputs = args.filter((_, i) => args[i - 1] === '-i')
    expect(inputs).toEqual([segments[1].visual!.path, segments[0].visual!.path])
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('[abg]')
    expect(graph).toContain('[bbg]')
    expect(graph).toContain('trim=end_frame=15')
    expect(graph).toContain('fade=t=out:s=0:n=15:alpha=1')
    expect(graph).toContain('[cur][old]overlay=eof_action=pass')
    // The old picture continues its 90 + 15 frame move.
    expect(graph).toContain('((in+90)/104)')
    expect(graph).toContain('setpts=N+90,ass=captions.ass,setpts=N[v]')
  })

  it('fades a dip into black inside the clip itself', () => {
    const segments = planSegments([scene(0, 3, 'a.png', 'cut'), scene(3, 6, 'b.png', 'fade-black')], 180)
    const sizes = new Map(segments.map((s) => [s.visual!.path!, { width: 1280, height: 720 }]))
    const first = segmentArgs(segments[0], null, 'a.mp4', { width: 1280, height: 720 }, sizes, false, 1)
    const second = segmentArgs(
      segments[1],
      segments[0],
      'b.mp4',
      { width: 1280, height: 720 },
      sizes,
      false,
      1,
    )
    expect(first.join(' ')).toContain('fade=t=out:s=83:n=7')
    expect(second.join(' ')).toContain('fade=t=in:s=0:n=7')
    expect(second.filter((a) => a === '-i')).toHaveLength(1)
  })
})

describe('pause detection output', () => {
  it('reads silencedetect and volumedetect logs', () => {
    const log = [
      '[silencedetect @ 000001] silence_start: 0',
      '[silencedetect @ 000001] silence_end: 0.31 | silence_duration: 0.31',
      'size=N/A time=00:00:05.00',
      '[silencedetect @ 000001] silence_start: 2.05',
      '[silencedetect @ 000001] silence_end: 2.6 | silence_duration: 0.55',
      '[silencedetect @ 000001] silence_start: 4.8',
    ].join('\r\n')
    expect(parseSilences(log, 5.2)).toEqual([
      { start: 0, end: 0.31 },
      { start: 2.05, end: 2.6 },
      { start: 4.8, end: 5.2 },
    ])
    expect(parseVolume('[Parsed_volumedetect_0 @ 1] mean_volume: -21.3 dB\n[x] max_volume: -0.5 dB')).toEqual(
      {
        mean: -21.3,
        max: -0.5,
      },
    )
    expect(parseVolume('mean_volume: -inf dB').mean).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('what the AI voice reads', () => {
  const project = { script: 'Para one.\n\nPara two.' } as never

  it('reads the scenes when there are scenes, the script otherwise', () => {
    const scenes = [
      { index: 1, narration: 'Second  scene.' },
      { index: 0, narration: 'First scene.' },
      { index: 2, narration: '  ' },
    ] as never
    expect(textToRead({ scenes, project })).toEqual(['First scene.', 'Second scene.'])
    expect(textToRead({ scenes: [], project })).toEqual(['Para one.', 'Para two.'])
  })

  it('groups pieces into parts and splits long ones at sentences', () => {
    expect(chunkText(['Aaa.', 'Bbb.', 'Ccc.'], 9)).toEqual(['Aaa. Bbb.', 'Ccc.'])
    expect(chunkText(['One two. Three four.'], 11)).toEqual(['One two.', 'Three four.'])
    expect(chunkText(['one two three four five'], 9)).toEqual(['one two', 'three', 'four five'])
    const all = chunkText(['A sentence here. Another one there.', 'Short.'], 20)
    expect(all.join(' ')).toBe('A sentence here. Another one there. Short.')
    expect(all.every((c) => c.length <= 20)).toBe(true)
  })
})

describe('telling speech formats apart', () => {
  it('accepts real MP3 headers and rejects PCM that merely starts with 0xFF', () => {
    expect(isMp3(Buffer.from('ID3\x04\x00', 'latin1'))).toBe(true)
    expect(isMp3(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe(true) // MPEG-1 layer III, 128 kb/s
    // A first PCM sample of -1 (FF FF) or -257 (FF FE) reads as Layer I, which speech never is.
    expect(isMp3(Buffer.from([0xff, 0xff, 0x00, 0x00]))).toBe(false)
    expect(isMp3(Buffer.from([0xff, 0xfe, 0x10, 0x00]))).toBe(false)
    // A bad bitrate index (1111) or sample-rate index (11).
    expect(isMp3(Buffer.from([0xff, 0xfb, 0xf0, 0x00]))).toBe(false)
    expect(isMp3(Buffer.from([0xff, 0xfb, 0x9c, 0x00]))).toBe(false)
  })
})

describe('a picture whose scene is too short to show', () => {
  it('keeps its transition when the next scene, without a picture, shows it', () => {
    // b.png's scene rounds to no frames; the imageless scene after it shows b.png.
    const segments = planSegments(
      [scene(0, 3, 'a.png', 'cut'), scene(3, 3.01, 'b.png', 'crossfade'), scene(3.01, 6, null, 'cut')],
      180,
    )
    expect(segments).toHaveLength(2)
    expect(segments[1].visual?.path).toMatch(/b\.png$/)
    expect(segments[1].transition).toBe('crossfade')
  })
})
