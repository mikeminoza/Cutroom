import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type OAuthClient, retitleVideo } from '../src/google'
import { findHits, HIT, withUsual } from '../src/hits'
import {
  findSlowStarters,
  SLOW,
  type SlowCandidate,
  titleChangesOf,
  titleProblem,
} from '../src/second-chance'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

// The YouTube API, as the SDK calls it.
const yt = vi.hoisted(() => ({ videos: { list: vi.fn(), update: vi.fn() } }))
vi.mock('@googleapis/youtube', () => ({ youtube: () => yt, auth: { OAuth2: class {} } }))

const now = new Date('2026-11-20T12:00:00Z')
const DAY = 86_400_000
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY).toISOString()

let n = 0
/** A video counted now, `age` days after it went public. */
const video = (views: number, age: number, over: Partial<SlowCandidate> = {}): SlowCandidate => ({
  id: `v${++n}`,
  channel: 'ch-1',
  format: 'landscape',
  views,
  publishedAt: daysAgo(age),
  fetchedAt: now.toISOString(),
  titleChangedAt: null,
  ...over,
})

/** Five settled long videos with these views: enough to compare with. */
const settled = (views = [280, 290, 300, 310, 320], over: Partial<SlowCandidate> = {}) =>
  views.map((v, i) => video(v, 40 + i * 10, over))

const ids = (videos: { id: string }[]) => videos.map((v) => v.id)

describe('slow starters', () => {
  it('finds a video with under a third of the usual views, the usual being the same as for hits', () => {
    const slow = video(60, 5)
    const fine = video(150, 6)
    const [found, ...rest] = findSlowStarters([...settled(), slow, fine])
    expect(rest).toEqual([])
    // The usual is the median of the five settled videos and the one out longer than it.
    expect(found).toMatchObject({ id: slow.id, usual: 295, peers: 6 })
    expect(SLOW.share).toBeCloseTo(1 / 3)
    // Just under a third is slow, a third is not.
    expect(ids(findSlowStarters([...settled([300, 300, 300, 300, 300]), video(99, 5)]))).toHaveLength(1)
    expect(findSlowStarters([...settled([300, 300, 300, 300, 300]), video(100, 5)])).toEqual([])
  })

  it('works the usual out once for both rules', () => {
    const hit = video(2_000, 35)
    const slow = video(20, 10)
    const videos = [...settled(), hit, slow]
    const usual = withUsual(videos)
    const [foundHit] = findHits(videos)
    const [foundSlow] = findSlowStarters(videos)
    expect(foundHit).toMatchObject({ id: hit.id })
    expect(foundSlow).toMatchObject({ id: slow.id })
    for (const found of [foundHit, foundSlow]) {
      const same = usual.find((u) => u.video.id === found.id)
      expect(same && { usual: Math.round(same.usual), peers: same.peers }).toEqual({
        usual: found.usual,
        peers: found.peers,
      })
    }
  })

  it('waits until it has been public 2 days when its views were counted', () => {
    expect(findSlowStarters([...settled(), video(5, 1.9)])).toEqual([])
    expect(findSlowStarters([...settled(), video(5, SLOW.minDays)])).toHaveLength(1)
    // Out 3 days now, but the views were counted a day after it went public: too early to judge.
    const early = video(5, 3, { fetchedAt: daysAgo(2) })
    expect(findSlowStarters([...settled(), early])).toEqual([])
  })

  it('stops once its views are mostly in, at 4 weeks, when a new title rarely helps', () => {
    expect(SLOW.maxDays).toBe(HIT.settledDays)
    expect(findSlowStarters([...settled(), video(5, 27)])).toHaveLength(1)
    expect(findSlowStarters([...settled(), video(5, 28)])).toEqual([])
  })

  it('compares long videos with long videos, Shorts with Shorts, on the same channel, with five at least', () => {
    const slow = video(30, 5)
    // Shorts and another channel's videos with many views don't make a long video look slow.
    const others = [
      ...settled([5_000, 5_000, 5_000, 5_000, 5_000], { format: 'portrait' }),
      ...settled([5_000, 5_000, 5_000, 5_000, 5_000], { channel: 'ch-2' }),
      ...settled([100, 100, 100, 100]),
    ]
    expect(findSlowStarters([...others, slow])).toEqual([])
    expect(ids(findSlowStarters([...others, ...settled([100]), slow]))).toEqual([slow.id])
  })

  it('gives no verdict on a channel whose videos usually get a handful of views', () => {
    const tiny = settled([SLOW.minUsual - 1, SLOW.minUsual - 1, SLOW.minUsual - 1, 20, 20])
    expect(findSlowStarters([...tiny, video(0, 5)])).toEqual([])
    const small = settled([SLOW.minUsual, SLOW.minUsual, SLOW.minUsual, 20, 20])
    expect(findSlowStarters([...small, video(0, 5)])).toHaveLength(1)
  })

  it('leaves a new title a week before offering again, counted from views counted after the change', () => {
    const changed = (days: number) => video(5, 20, { titleChangedAt: daysAgo(days) })
    expect(findSlowStarters([...settled(), changed(3)])).toEqual([])
    expect(findSlowStarters([...settled(), changed(SLOW.restDays)])).toHaveLength(1)
    // Changed after its views were last counted: those views are the old title's.
    expect(findSlowStarters([...settled(), changed(-1)])).toEqual([])
  })

  it('lists the newest first, and skips videos counted before they went public', () => {
    const older = video(10, 20)
    const newer = video(10, 4)
    const notOut = video(0, -1)
    expect(ids(findSlowStarters([...settled(), older, notOut, newer]))).toEqual([newer.id, older.id])
  })
})

describe('title changes and title rules', () => {
  it('keeps the changes of the upload it is on: a new upload starts afresh', () => {
    const changes = [
      { videoId: 'old-upload', from: 'First try', at: daysAgo(30), views: 3 },
      { videoId: 'yt-1', from: 'Second try', at: daysAgo(2), views: 40 },
    ]
    expect(titleChangesOf({ titleChanges: changes }, 'yt-1')).toEqual([changes[1]])
    expect(titleChangesOf({ titleChanges: changes }, null)).toEqual([])
    expect(titleChangesOf({}, 'yt-1')).toEqual([])
  })

  it('follows YouTube’s rules for a title', () => {
    expect(titleProblem('Why cats knead')).toBeNull()
    expect(titleProblem('x'.repeat(100))).toBeNull()
    expect(titleProblem('   ')).toMatch(/Write a title/)
    expect(titleProblem('x'.repeat(101))).toMatch(/100 characters.*101/)
    expect(titleProblem('Cats <3 boxes')).toMatch(/< or >/)
  })
})

describe('changing the title on YouTube', () => {
  const client = {} as OAuthClient
  const snippet = {
    title: 'Why cats knead',
    description: 'Cats knead for comfort.\n\n0:00 Intro',
    tags: ['cats', 'kneading'],
    categoryId: '15',
    defaultLanguage: 'en',
    defaultAudioLanguage: 'en',
    // Read-only: YouTube sets these itself.
    publishedAt: '2026-11-10T10:00:00Z',
    channelId: 'UC-cats',
    channelTitle: 'Cat Facts',
    thumbnails: { default: { url: 'https://i.ytimg.com/x.jpg' } },
    localized: { title: 'Why cats knead', description: 'Cats knead for comfort.' },
  }

  beforeEach(() => {
    yt.videos.list.mockReset()
    yt.videos.update.mockReset()
    yt.videos.update.mockResolvedValue({ data: {} })
  })

  it('reads the video first and sends back its whole snippet with only the title changed', async () => {
    yt.videos.list.mockResolvedValueOnce({ data: { items: [{ id: 'vid', snippet }] } })
    const translate = vi.fn()
    const result = await retitleVideo(client, 'vid', 'The real reason cats knead', translate)
    expect(yt.videos.list).toHaveBeenCalledWith({ part: ['snippet', 'localizations'], id: ['vid'] })
    expect(yt.videos.update).toHaveBeenCalledTimes(1)
    expect(yt.videos.update).toHaveBeenCalledWith({
      part: ['snippet'],
      requestBody: {
        id: 'vid',
        snippet: {
          title: 'The real reason cats knead',
          description: 'Cats knead for comfort.\n\n0:00 Intro',
          tags: ['cats', 'kneading'],
          categoryId: '15',
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en',
        },
      },
    })
    // No titles in other languages: nothing to translate, and its localizations are left alone.
    expect(translate).not.toHaveBeenCalled()
    expect(result).toEqual({ previous: 'Why cats knead', localized: {} })
  })

  it('translates the new title once for its other languages and keeps their descriptions', async () => {
    yt.videos.list.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'vid',
            snippet,
            localizations: {
              es: { title: 'Por qué los gatos amasan', description: 'Los gatos amasan.' },
              de: { title: 'Warum Katzen treteln', description: 'Katzen treteln.' },
              en: { title: 'Why cats knead', description: 'Cats knead for comfort.' },
            },
          },
        ],
      },
    })
    // Gemini leaves out German: it gets the new title as it is, never the old one.
    const translate = vi.fn(async () => ({ es: 'La verdadera razón por la que los gatos amasan' }))
    const result = await retitleVideo(client, 'vid', 'The real reason cats knead', translate)
    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate).toHaveBeenCalledWith(['es', 'de'], 'en')
    const request = yt.videos.update.mock.calls[0][0]
    expect(request.part).toEqual(['snippet', 'localizations'])
    expect(request.requestBody.snippet).toMatchObject({
      title: 'The real reason cats knead',
      description: snippet.description,
      tags: snippet.tags,
      categoryId: '15',
    })
    expect(request.requestBody.localizations).toEqual({
      es: { title: 'La verdadera razón por la que los gatos amasan', description: 'Los gatos amasan.' },
      de: { title: 'The real reason cats knead', description: 'Katzen treteln.' },
      en: { title: 'The real reason cats knead', description: 'Cats knead for comfort.' },
    })
    expect(result).toEqual({
      previous: 'Why cats knead',
      localized: {
        es: 'La verdadera razón por la que los gatos amasan',
        de: 'The real reason cats knead',
      },
    })
  })

  it('changes nothing when the translation fails or the video is gone', async () => {
    yt.videos.list.mockResolvedValueOnce({
      data: {
        items: [{ id: 'vid', snippet, localizations: { es: { title: 'Viejo', description: 'Hola' } } }],
      },
    })
    await expect(
      retitleVideo(client, 'vid', 'New', async () => {
        throw new Error('Gemini is busy')
      }),
    ).rejects.toThrow(/busy/)
    yt.videos.list.mockResolvedValueOnce({ data: { items: [] } })
    await expect(retitleVideo(client, 'gone', 'New', vi.fn())).rejects.toThrow(/can't find/)
    expect(yt.videos.update).not.toHaveBeenCalled()
  })
})

describe('translating a new title', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
  })
  afterEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  it('asks Flash-Lite once for every language, and keeps only good titles in the languages asked', async () => {
    const { translateTitle } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        titles: [
          { language: 'es', title: ' La verdadera razón por la que los gatos amasan ' },
          { language: 'de', title: 'x'.repeat(120) },
          { language: 'fr', title: 'Pas demandé' },
          { language: 'pt', title: '  ' },
          { language: 'ja', title: '猫が<ふみふみ>する理由' },
        ],
      }),
    })
    const titles = await translateTitle({
      title: 'The real reason cats knead',
      from: 'en',
      to: ['es', 'de', 'pt', 'ja'],
    })
    expect(titles).toEqual({
      es: 'La verdadera razón por la que los gatos amasan',
      de: 'x'.repeat(100),
      ja: '猫がふみふみする理由',
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
    const request = generateContent.mock.calls[0][0]
    expect(request.model).toBe('gemini-3.5-flash-lite')
    const prompt = String(request.contents)
    expect(prompt).toContain('The real reason cats knead')
    expect(prompt).toContain('from en into')
    expect(prompt).toContain('es (Spanish)')
    expect(prompt).toContain('ja (Japanese)')
    expect(prompt).toMatch(/100 characters/)
  })
})
