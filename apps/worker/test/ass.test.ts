import { type CaptionChunk, chunkCaptions } from '@cutroom/shared/captions'
import type { Word } from '@cutroom/shared/types'
import { describe, expect, it } from 'vitest'
import { assColor, assTime, buildAss, captionLayout, escapeAssText } from '../src/render/ass'

const LANDSCAPE_720 = { width: 1280, height: 720, format: 'landscape' as const }
const PORTRAIT_1080 = { width: 1080, height: 1920, format: 'portrait' as const }

function words(...items: [string, number, number][]): Word[] {
  return items.map(([text, start, end]) => ({ text, start, end }))
}

interface Event {
  start: string
  end: string
  text: string
}

function events(ass: string): Event[] {
  return ass
    .split('\n')
    .filter((l) => l.startsWith('Dialogue:'))
    .map((l) => {
      const parts = l.slice('Dialogue: '.length).split(',')
      return { start: parts[1], end: parts[2], text: parts.slice(9).join(',') }
    })
}

function centis(time: string): number {
  const [h, m, s] = time.split(':')
  return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 100)
}

/** Text of the event without override tags, and the word wrapped in the yellow tag (if any). */
function plain(text: string): string {
  return text.replace(/\{[^}]*\}/g, '')
}
function highlighted(text: string): string | null {
  return /\{\\1c&H00B8FF&\}([^{]*)/.exec(text)?.[1]?.trim() ?? null
}

const sentence = words(
  ['Hello', 0, 0.4],
  ['there,', 0.4, 0.9],
  ['this', 1.0, 1.2],
  ['is', 1.2, 1.35],
  ['a', 1.35, 1.45],
  ['test.', 1.45, 2.0],
  ['Second', 2.5, 2.9],
  ['line', 2.9, 3.3],
)

describe('assTime', () => {
  it('formats h:mm:ss.cc', () => {
    expect(assTime(0)).toBe('0:00:00.00')
    expect(assTime(1.234)).toBe('0:00:01.23')
    expect(assTime(61.5)).toBe('0:01:01.50')
    expect(assTime(3661.236)).toBe('1:01:01.24')
  })

  it('rounds into the next unit and clamps negatives', () => {
    expect(assTime(59.999)).toBe('0:01:00.00')
    expect(assTime(-3)).toBe('0:00:00.00')
  })
})

describe('assColor', () => {
  it('converts #RRGGBB to &HAABBGGRR', () => {
    expect(assColor('#FFB800')).toBe('&H0000B8FF')
    expect(assColor('#FFFFFF')).toBe('&H00FFFFFF')
    expect(assColor('#000000', 0x80)).toBe('&H80000000')
  })
})

describe('escapeAssText', () => {
  it('escapes override braces', () => {
    expect(escapeAssText('{\\b1}bold')).toBe('\\{\\\u2060b1\\}bold')
    expect(escapeAssText('a}b{c')).toBe('a\\}b\\{c')
  })

  it('neutralises backslash escapes like \\N and \\h', () => {
    const out = escapeAssText('C:\\New\\hidden')
    expect(out).not.toMatch(/\\[Nnh{}]/)
    expect(out.replace(/\u2060/g, '')).toBe('C:\\New\\hidden')
  })

  it('turns newlines into \\N hard breaks', () => {
    expect(escapeAssText('one\ntwo\r\nthree')).toBe('one\\Ntwo\\Nthree')
  })

  it('leaves normal punctuation alone', () => {
    expect(escapeAssText("It's 5, okay? (yes) — 100%")).toBe("It's 5, okay? (yes) — 100%")
  })
})

describe('captionLayout', () => {
  it('landscape: bottom-centred, ~8% margin, ~5.2% font', () => {
    const layout = captionLayout(1920, 1080, 'landscape')
    expect(layout.alignment).toBe(2)
    expect(layout.marginV).toBe(Math.round(1080 * 0.08))
    expect(layout.fontSize).toBe(Math.round(1080 * 0.052))
    expect(layout.outline).toBe(4)
    expect(layout.pos).toBeNull()
  })

  it('portrait: centred on 68% of the height, ~4.2% font, 8% side margins', () => {
    const layout = captionLayout(1080, 1920, 'portrait')
    expect(layout.alignment).toBe(5)
    expect(layout.pos).toEqual({ x: 540, y: Math.round(1920 * 0.68) })
    expect(layout.fontSize).toBe(Math.round(1920 * 0.042))
    expect(layout.marginL).toBe(Math.round(1080 * 0.08))
    expect(layout.marginR).toBe(Math.round(1080 * 0.08))
  })

  it('scales the outline with resolution', () => {
    expect(captionLayout(1280, 720, 'landscape').outline).toBeCloseTo(2.7, 1)
    expect(captionLayout(720, 1280, 'portrait').outline).toBeCloseTo(2.7, 1)
  })
})

describe('buildAss header', () => {
  it('sets PlayRes to the output size and an Arial bold white/black style', () => {
    const ass = buildAss([], { ...LANDSCAPE_720, style: 'line' })
    expect(ass).toContain('PlayResX: 1280')
    expect(ass).toContain('PlayResY: 720')
    expect(ass).toContain('ScaledBorderAndShadow: yes')
    const style = ass.split('\n').find((l) => l.startsWith('Style:'))!
    const f = style.slice('Style: '.length).split(',')
    expect(f[1]).toBe('Arial')
    expect(f[2]).toBe(String(Math.round(720 * 0.052)))
    expect(f[3]).toBe('&H00FFFFFF') // primary: white
    expect(f[5]).toBe('&H00000000') // outline: black
    expect(f[7]).toBe('-1') // bold
    expect(f[15]).toBe('1') // BorderStyle 1 = outline + shadow, no box
    expect(Number(f[16])).toBeGreaterThan(0) // outline
    expect(Number(f[17])).toBeGreaterThan(0) // shadow
    expect(f[18]).toBe('2') // bottom centre
    expect(f[21]).toBe(String(Math.round(720 * 0.08)))
  })

  it("'off' has no events", () => {
    const chunks = chunkCaptions(sentence, 'landscape')
    expect(events(buildAss(chunks, { ...LANDSCAPE_720, style: 'off' }))).toHaveLength(0)
  })
})

describe("buildAss 'line'", () => {
  it('writes one white event per chunk with the chunk times', () => {
    const chunks = chunkCaptions(sentence, 'landscape')
    const list = events(buildAss(chunks, { ...LANDSCAPE_720, style: 'line' }))
    expect(list).toHaveLength(chunks.length)
    list.forEach((event, i) => {
      expect(plain(event.text)).toBe(chunks[i].words.map((w) => w.text).join(' '))
      expect(event.text).not.toContain('\\1c')
      expect(event.start).toBe(assTime(chunks[i].start))
    })
  })

  it('positions portrait captions with \\an5\\pos', () => {
    const chunks = chunkCaptions(sentence, 'portrait')
    const list = events(buildAss(chunks, { ...PORTRAIT_1080, style: 'line' }))
    for (const event of list)
      expect(event.text.startsWith(`{\\an5\\pos(540,${Math.round(1920 * 0.68)})`)).toBe(true)
  })

  it('escapes user text inside events', () => {
    const chunks: CaptionChunk[] = [{ start: 0, end: 1, words: words(['{evil}', 0, 0.5], ['a\\Nb', 0.5, 1]) }]
    const [event] = events(buildAss(chunks, { ...LANDSCAPE_720, style: 'line' }))
    expect(event.text).toContain('\\{evil\\}')
    expect(event.text).toContain('a\\\u2060Nb')
  })
})

describe("buildAss 'highlight'", () => {
  const chunks = chunkCaptions(sentence, 'landscape')
  const list = events(buildAss(chunks, { ...LANDSCAPE_720, style: 'highlight' }))

  it('writes one event per word, highlighting that word in Kodak yellow', () => {
    expect(list).toHaveLength(sentence.length)
    list.forEach((event, i) => {
      expect(highlighted(event.text)).toBe(sentence[i].text)
      expect(event.text.match(/\\1c&H00B8FF&/g)).toHaveLength(1)
    })
  })

  it('keeps the whole chunk on screen in every event', () => {
    let i = 0
    for (const chunk of chunks) {
      const text = chunk.words.map((w) => w.text).join(' ')
      for (const _ of chunk.words) expect(plain(list[i++].text)).toBe(text)
    }
  })

  it('tiles each chunk exactly: no gaps (flicker) and no overlaps', () => {
    let i = 0
    for (const chunk of chunks) {
      const group = list.slice(i, i + chunk.words.length)
      i += chunk.words.length
      expect(centis(group[0].start)).toBe(Math.round(chunk.start * 100))
      expect(centis(group[group.length - 1].end)).toBe(Math.round(chunk.end * 100))
      for (let j = 1; j < group.length; j++) expect(group[j].start).toBe(group[j - 1].end)
    }
    for (let j = 1; j < list.length; j++)
      expect(centis(list[j].start)).toBeGreaterThanOrEqual(centis(list[j - 1].end))
  })

  it('switches word at each word start, even across pauses inside a chunk', () => {
    const chunk: CaptionChunk = { start: 1, end: 3, words: words(['slow', 1, 1.2], ['words', 1.8, 3]) }
    const [a, b] = events(buildAss([chunk], { ...LANDSCAPE_720, style: 'highlight' }))
    expect([a.start, a.end, b.start, b.end]).toEqual(['0:00:01.00', '0:00:01.80', '0:00:01.80', '0:00:03.00'])
  })

  it('skips zero-length words without leaving a gap', () => {
    const chunk: CaptionChunk = {
      start: 0,
      end: 1,
      words: words(['a', 0, 0.5], ['b', 0.501, 0.502], ['c', 0.502, 1]),
    }
    const list = events(buildAss([chunk], { ...LANDSCAPE_720, style: 'highlight' }))
    expect(list.map((e) => highlighted(e.text))).toEqual(['a', 'c'])
    expect(list[0].end).toBe(list[1].start)
  })

  it('clamps a chunk that overlaps the next one', () => {
    const overlapping: CaptionChunk[] = [
      { start: 0, end: 2, words: words(['first', 0, 2]) },
      { start: 1.5, end: 3, words: words(['second', 1.5, 3]) },
    ]
    const [a, b] = events(buildAss(overlapping, { ...LANDSCAPE_720, style: 'highlight' }))
    expect(a.end).toBe('0:00:01.50')
    expect(b.start).toBe('0:00:01.50')
  })
})
