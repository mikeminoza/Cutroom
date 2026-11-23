import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findHits, HIT, type HitCandidate } from '../src/hits'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

const now = new Date('2026-11-20T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

let n = 0
/** A video counted now, `age` days after it went public. */
const video = (views: number, age: number, over: Partial<HitCandidate> = {}): HitCandidate => ({
  id: `v${++n}`,
  channel: 'ch-1',
  format: 'landscape',
  views,
  publishedAt: daysAgo(age),
  fetchedAt: now.toISOString(),
  ...over,
})

/** Five settled long videos with these views: enough to compare with. */
const settled = (views = [80, 90, 100, 110, 120], over: Partial<HitCandidate> = {}) =>
  views.map((v, i) => video(v, 40 + i * 10, over))

describe('your hits', () => {
  it('finds a video with at least 3 times the usual views, the usual being the median', () => {
    const big = video(450, 35)
    const ok = video(250, 45)
    const [hit, ...rest] = findHits([...settled(), big, ok])
    expect(rest).toEqual([])
    expect(hit).toMatchObject({ id: big.id, usual: 105, peers: 6 })
    expect(hit.times).toBeCloseTo(4.3, 1)
  })

  it('needs five other videos to compare with, so one or two never make a hit', () => {
    const big = video(5_000, 35)
    expect(findHits([...settled([100, 100, 100, 100]), big])).toEqual([])
    expect(findHits([...settled([100, 100, 100, 100, 100]), big]).map((h) => h.id)).toEqual([big.id])
  })

  it('compares long videos with long videos, Shorts with Shorts, and only on the same channel', () => {
    const big = video(500, 35)
    // Shorts and another channel's videos with few views don't make a long video look big.
    const others = [
      ...settled([100, 100, 100, 100], { format: 'portrait' }),
      ...settled([100, 100, 100, 100], { channel: 'ch-2' }),
      ...settled([150, 150, 150, 150]),
    ]
    expect(findHits([...others, big])).toEqual([])
    // A Short does well next to Shorts, not next to long videos.
    const short = video(2_000, 35, { format: 'portrait' })
    const hits = findHits([
      ...settled([400, 500, 600, 700, 800], { format: 'portrait' }),
      ...settled([10_000, 10_000, 10_000, 10_000, 10_000]),
      short,
    ])
    expect(hits.map((h) => [h.id, h.usual])).toEqual([[short.id, 600]])
  })

  it('never flatters a young video: it is held to the totals of videos out longer', () => {
    // Out 2 days with 250 views; the others had 100 by the time they settled. It may well end up
    // a hit, but it isn't one yet.
    expect(findHits([...settled(), video(250, 2)])).toEqual([])
    // Videos out for less time than it don't count: they're further from their totals.
    expect(findHits([...[1, 1, 1, 1, 1].map(() => video(20, 1)), video(400, 2)])).toEqual([])
    // Already past 3 times what the others got in all: a hit on day 2.
    expect(findHits([...settled(), video(400, 2)])).toHaveLength(1)
  })

  it('never flatters an old video by comparing it with videos still gathering views', () => {
    const old = video(600, 300)
    // Next to five videos out a week, it's far ahead, but they're still young.
    expect(findHits([...[7, 8, 9, 10, 11].map((age) => video(50, age)), old])).toEqual([])
    // Next to videos past 4 weeks, younger than it or not, it's compared as settled.
    const [hit] = findHits([...[30, 31, 32, 33, 34].map((age) => video(150, age)), old])
    expect(hit).toMatchObject({ id: old.id, usual: 150, times: 4 })
    expect(HIT.settledDays).toBe(28)
  })

  it('ignores small numbers, however many times usual', () => {
    expect(findHits([...settled([5, 5, 5, 5, 5]), video(HIT.minViews - 1, 35)])).toEqual([])
    expect(findHits([...settled([5, 5, 5, 5, 5]), video(HIT.minViews, 35)])).toHaveLength(1)
  })

  it("doesn't let an earlier hit raise the bar for the next one", () => {
    const first = video(9_000, 200)
    const next = video(400, 35)
    const hits = findHits([...settled(), first, next])
    expect(hits.map((h) => h.id)).toEqual([next.id, first.id])
    // The middle of 80, 90, 100, 110, 120 and 9,000: the average would be over 1,500.
    expect(hits[0].usual).toBe(105)
  })

  it('skips videos counted before they went public, and lists the newest first', () => {
    const notOut = video(9_000, -1)
    const older = video(500, 60)
    const newer = video(500, 35)
    expect(findHits([...settled(), notOut, older, newer]).map((h) => h.id)).toEqual([newer.id, older.id])
  })
})

describe('follow-up ideas for a hit', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
  })
  afterEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  const ask = async (ideas: { title: string; angle: string }[]) => {
    const { followUpIdeas } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ ideas }) })
    return followUpIdeas({
      niche: 'Why your body does weird stuff',
      narration: '',
      language: 'en',
      format: 'portrait',
      video: {
        title: 'Why you wake up at 3 AM',
        topic: 'The 3 AM wake-up, explained',
        opening: 'It is 3 AM. Again.',
        views: 4_200,
        usual: 1_000,
        watched: 81,
        searches: ['why do i wake up at 3am'],
      },
      avoid: ['Why you wake up at 3 AM', 'Why naps make you groggy'],
    })
  }

  it('asks the main model once for the next question, with what made the video work', async () => {
    const ideas = await ask([
      { title: ' Why you can’t fall back asleep ', angle: ' The racing mind at 3 AM. ' },
      { title: 'Why 4 AM feels different', angle: 'Body clocks.' },
    ])
    expect(ideas).toEqual([
      { title: 'Why you can’t fall back asleep', angle: 'The racing mind at 3 AM.' },
      { title: 'Why 4 AM feels different', angle: 'Body clocks.' },
    ])
    expect(generateContent).toHaveBeenCalledTimes(1)
    const request = generateContent.mock.calls[0][0]
    // Ideas get made and published: the writing model, not Flash-Lite.
    expect(request.model).toBe('gemini-3.8-flash')
    const prompt = String(request.contents)
    expect(prompt).toContain('"Why you wake up at 3 AM"')
    expect(prompt).toMatch(/4,200 views.*4\.2 times/)
    expect(prompt).toContain('It is 3 AM. Again.')
    expect(prompt).toContain('why do i wake up at 3am')
    expect(prompt).toMatch(/next question/)
    expect(prompt).toMatch(/Shorts/)
    expect(prompt).toContain('- Why naps make you groggy')
  })

  it('keeps 3 at most, and never the video itself again', async () => {
    const ideas = await ask([
      { title: 'Why You Wake Up At 3 AM', angle: 'Same again.' },
      { title: 'A', angle: '' },
      { title: '  ', angle: 'No title.' },
      { title: 'B', angle: '' },
      { title: 'C', angle: '' },
      { title: 'D', angle: '' },
    ])
    expect(ideas.map((i) => i.title)).toEqual(['A', 'B', 'C'])
  })
})
