import { describe, expect, it } from 'vitest'
import { alignScenes, scenesFromSegments, wordsFromSegments } from '../src/align'
import { activeChunk, chunkCaptions, toSrt, wordsFromScenes } from '../src/captions'
import { buildImagePrompt } from '../src/prompts'
import { nextFreeSlot, upcomingSlots, zonedToUtc } from '../src/schedule'
import {
  formatTimecode,
  layoutByEstimate,
  normalizeChapters,
  parseTimecode,
  splitBySentences,
} from '../src/timing'
import type { Word } from '../src/types'

function spoken(text: string, start = 0, rate = 0.4): Word[] {
  return text
    .split(' ')
    .map((w, i) => ({ text: w, start: start + i * rate, end: start + i * rate + rate * 0.9 }))
}

describe('timing', () => {
  it('formats and parses timecodes', () => {
    expect(formatTimecode(75.4)).toBe('1:15.4')
    expect(formatTimecode(3725, false)).toBe('1:02:05')
    expect(parseTimecode('1:15.5')).toBe(75.5)
    expect(parseTimecode('nope')).toBeNull()
  })

  it('lays scenes end to end', () => {
    const placed = layoutByEstimate([{ narration: 'one two three four five' }, { narration: 'six seven' }])
    expect(placed[0].start).toBe(0)
    expect(placed[1].start).toBe(placed[0].end)
  })

  it('splits by sentence near the pace', () => {
    const scenes = splitBySentences('One two three. Four five six. Seven eight nine ten. Eleven.', 2)
    expect(scenes.length).toBeGreaterThan(1)
    expect(scenes.map((s) => s.narration).join(' ')).toBe(
      'One two three. Four five six. Seven eight nine ten. Eleven.',
    )
  })

  it('makes chapters YouTube accepts', () => {
    const chapters = normalizeChapters(
      [
        { start: 3, title: 'Intro' },
        { start: 8, title: 'Too close' },
        { start: 40, title: 'Middle' },
        { start: 90, title: 'End' },
      ],
      120,
    )
    expect(chapters[0]).toEqual({ start: 0, title: 'Intro' })
    expect(chapters.map((c) => c.title)).toEqual(['Intro', 'Middle', 'End'])
    expect(normalizeChapters([{ start: 0, title: 'Only' }], 120)).toEqual([])
  })
})

describe('alignment', () => {
  it('moves scenes to where their words are spoken', () => {
    const narrations = ['the quick brown fox', 'jumps over the lazy dog', 'and runs away']
    // A 2-second pause before the second scene and 1.5 s before the third.
    const words = [
      ...spoken('the quick brown fox', 0.5),
      ...spoken('jumps over the lazy dog', 4),
      ...spoken('and runs away', 8),
    ]
    const { times, matchedRatio } = alignScenes(narrations, words, 10)
    expect(matchedRatio).toBe(1)
    expect(times[0].start).toBe(0)
    expect(times[1].start).toBeCloseTo(4, 1)
    expect(times[2].start).toBeCloseTo(8, 1)
    expect(times[2].end).toBe(10)
    expect(times[0].end).toBe(times[1].start)
  })

  it('tolerates small differences between script and speech', () => {
    const narrations = ['octopuses have three hearts', 'and blue blood']
    const words = [...spoken('octopus has three hearts', 0), ...spoken('and blue blood', 3)]
    const { times } = alignScenes(narrations, words, 5)
    expect(times[1].start).toBeCloseTo(3, 1)
  })

  it('builds scenes from transcript segments', () => {
    const segments = [
      { start: 0.2, end: 2, text: 'First sentence.' },
      { start: 2.1, end: 4, text: 'Second one.' },
      { start: 4.2, end: 8, text: 'Third, longer sentence here.' },
    ]
    const scenes = scenesFromSegments(segments, 4, 9)
    expect(scenes[0].start).toBe(0)
    expect(scenes[scenes.length - 1].end).toBe(9)
    expect(wordsFromSegments(segments)).toHaveLength(8)
  })
})

describe('captions', () => {
  const words = wordsFromScenes([
    { start: 0, end: 4, narration: 'Hello there. This is a caption test for shorts.' },
  ])

  it('chunks short for vertical video and longer for widescreen', () => {
    const portrait = chunkCaptions(words, 'portrait')
    const landscape = chunkCaptions(words, 'landscape')
    expect(Math.max(...portrait.map((c) => c.words.length))).toBeLessThanOrEqual(3)
    expect(landscape.length).toBeLessThan(portrait.length)
    expect(portrait[0].words.map((w) => w.text)).toEqual(['Hello', 'there.'])
  })

  it('finds the chunk on screen at a time', () => {
    const chunks = chunkCaptions(words, 'portrait')
    expect(activeChunk(chunks, 0.1)?.words[0].text).toBe('Hello')
    expect(activeChunk(chunks, 99)).toBeNull()
  })

  it('writes SRT', () => {
    expect(toSrt(words)).toMatch(/^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nHello there\./)
  })
})

describe('schedule', () => {
  it('converts wall-clock time in a zone to UTC', () => {
    expect(zonedToUtc(2026, 1, 15, 18, 0, 'Asia/Manila').toISOString()).toBe('2026-01-15T10:00:00.000Z')
    expect(zonedToUtc(2026, 7, 1, 9, 30, 'America/New_York').toISOString()).toBe('2026-07-01T13:30:00.000Z')
  })

  it('lists upcoming slots and skips taken ones', () => {
    const from = new Date('2026-10-19T00:00:00Z') // a Monday
    const slots = [
      { day: 1, time: '18:00' },
      { day: 3, time: '18:00' },
    ]
    const upcoming = upcomingSlots(slots, 'UTC', from, 2)
    expect(upcoming[0].toISOString()).toBe('2026-10-19T18:00:00.000Z')
    expect(upcoming[1].toISOString()).toBe('2026-10-21T18:00:00.000Z')
    const next = nextFreeSlot(slots, 'UTC', [upcoming[0]], from)
    expect(next?.toISOString()).toBe('2026-10-21T18:00:00.000Z')
  })
})

describe('prompts', () => {
  it('adds characters, style and format to the scene prompt', () => {
    const prompt = buildImagePrompt(
      {
        visual: 'Milo on a boat',
        imagePrompt: 'Milo waves from a small red boat at sunrise',
        characters: ['milo'],
        shot: 'Wide shot',
      },
      {
        artStyle: 'Watercolor storybook',
        format: 'portrait',
        characters: [
          {
            id: '1',
            name: 'Milo',
            description: 'curly hair, yellow hoodie',
            images: [{ url: 'x', key: 'x' }],
          },
        ],
      },
    )
    expect(prompt).toContain('Milo: curly hair, yellow hoodie')
    expect(prompt).toContain('Match the attached reference image')
    expect(prompt).toContain('Style: Watercolor storybook.')
    expect(prompt).toContain('9:16 vertical')
  })
})
