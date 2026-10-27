import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeBranding, toChannelDetails } from '../src/google'
import {
  clockLabel,
  footerTemplate,
  formatChannelKeywords,
  marketNote,
  parseChannelKeywords,
  presetSlots,
  scheduleLine,
  slotDays,
  topicName,
} from '../src/setup'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  generateContent.mockReset()
})
afterEach(() => {
  delete process.env.GEMINI_API_KEY
})

describe('posting schedule presets', () => {
  it('leans on weekends and puts every slot at the same time', () => {
    expect(presetSlots(2)).toEqual([
      { day: 0, time: '15:00' },
      { day: 6, time: '15:00' },
    ])
    expect(slotDays(presetSlots(3), true)).toBe('Thu, Sat and Sun')
    expect(presetSlots(5).map((s) => s.day)).toEqual([0, 1, 3, 4, 6])
    expect(presetSlots(7)).toHaveLength(7)
    expect(presetSlots(3, '12:30').every((s) => s.time === '12:30')).toBe(true)
  })

  it('writes the schedule for the description footer, Monday first', () => {
    const slots = [
      { day: 0, time: '18:00' },
      { day: 4, time: '18:00' },
      { day: 6, time: '12:00' },
      { day: 6, time: '18:00' },
    ]
    expect(scheduleLine(slots)).toBe('New videos every Thursday, Saturday and Sunday.')
    expect(scheduleLine([{ day: 2, time: '09:00' }])).toBe('New videos every Tuesday.')
    expect(scheduleLine(presetSlots(7))).toBe('New videos every day.')
    expect(scheduleLine([])).toBe('')
    expect(footerTemplate(slots)).toBe(
      "New videos every Thursday, Saturday and Sunday.\nSubscribe so you don't miss the next one.",
    )
    expect(footerTemplate([])).toBe("Subscribe so you don't miss the next one.")
  })

  it('shows times on a 12-hour clock', () => {
    expect(clockLabel('15:00')).toBe('3:00 PM')
    expect(clockLabel('00:05')).toBe('12:05 AM')
    expect(clockLabel('12:30')).toBe('12:30 PM')
  })
})

describe('target audience', () => {
  it('tells the AI how to write for the chosen country, and nothing when none is set', () => {
    expect(marketNote('US')).toMatch(/^Write for viewers in the United States: American English spelling/)
    expect(marketNote('')).toBe('')
    expect(marketNote('XX')).toBe('')
  })

  it('writes post details for that audience, with short titles', async () => {
    const { writePostDetails } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        titleOptions: ['A'],
        description: 'D',
        tags: [],
        hashtags: [],
        chapterPicks: [],
        thumbnailIdeas: [],
        thumbnailText: '',
      }),
    })
    await writePostDetails({
      title: '',
      topic: 't',
      audience: '',
      language: 'en',
      format: 'landscape',
      duration: 60,
      script: '',
      scenes: [{ start: 0, narration: 'x' }],
      defaultTags: [],
      descriptionFooter: '',
      market: 'US',
    })
    const prompt = String(generateContent.mock.calls.at(-1)?.[0].contents)
    expect(prompt).toContain('Language: en\nWrite for viewers in the United States')
    expect(prompt).toContain('max 60 characters with the hook in the first 40')
  })
})

describe('channel setup on YouTube', () => {
  it('stores keywords the way YouTube does: multi-word ones quoted, within 500 characters', () => {
    expect(formatChannelKeywords(['capybara', 'sleep science', '"cartoon"', 'Capybara', ' '])).toBe(
      'capybara "sleep science" cartoon',
    )
    expect(parseChannelKeywords('capybara "sleep science" cartoon')).toEqual([
      'capybara',
      'sleep science',
      'cartoon',
    ])
    const many = Array.from({ length: 100 }, (_, i) => `keyword number ${i}`)
    expect(formatChannelKeywords(many).length).toBeLessThanOrEqual(500)
  })

  it('keeps every setting it does not change, because YouTube deletes the ones left out', () => {
    const current = {
      country: 'PH',
      description: 'Old',
      keywords: 'old',
      unsubscribedTrailer: 'abc123',
      trackingAnalyticsAccountId: 'UA-1',
      title: 'Read-only title',
    }
    expect(mergeBranding(current, { country: 'US', defaultLanguage: 'en' })).toEqual({
      country: 'US',
      defaultLanguage: 'en',
      description: 'Old',
      keywords: 'old',
      unsubscribedTrailer: 'abc123',
      trackingAnalyticsAccountId: 'UA-1',
    })
    expect(mergeBranding(null, { keywords: ['sleep science', 'capybara'] })).toEqual({
      keywords: '"sleep science" capybara',
    })
  })

  it('drafts the whole setup and keeps only choices YouTube and Cutroom can use', async () => {
    const { suggestChannelSetup } = await import('../src/ai')
    const reply = (fields: Record<string, unknown>) =>
      generateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          description: '  Funny sleep science with Cappy.  ',
          keywords: ['sleep science', '"capybara"', 'Sleep Science'],
          tags: ['#capybara', 'sleep', 'Capybara'],
          subscribeLine: ' Subscribe for a new sleep fact every week. ',
          category: { id: '27', why: 'It explains things.' },
          madeForKids: { value: false, why: 'Made for adults.' },
          cadence: { perWeek: 3, why: 'Six-minute videos.' },
          trailer: { id: 'v2', why: 'Short and typical.' },
          ...fields,
        }),
      })
    const input = {
      channel: 'Cappy Sleeps',
      niche: 'Sleep science explained by a capybara',
      narration: '',
      audience: 'Adults',
      tone: 'Funny',
      market: 'US',
      targetMinutes: 6,
      schedule: 'New videos every Saturday and Sunday.',
      uploads: [
        { id: 'v1', title: 'Why you wake up at 3 AM', seconds: 420, views: 900 },
        { id: 'v2', title: 'Cappy tries to sleep', seconds: 75, views: 3000 },
      ],
    }
    reply({})
    expect(await suggestChannelSetup(input)).toEqual({
      description: 'Funny sleep science with Cappy.',
      keywords: ['sleep science', 'capybara'],
      tags: ['capybara', 'sleep'],
      subscribeLine: 'Subscribe for a new sleep fact every week.',
      category: { id: '27', why: 'It explains things.' },
      madeForKids: { value: false, why: 'Made for adults.' },
      cadence: { perWeek: 3, why: 'Six-minute videos.' },
      trailer: { id: 'v2', title: 'Cappy tries to sleep', why: 'Short and typical.' },
    })
    const prompt = String(generateContent.mock.calls.at(-1)?.[0].contents)
    expect(prompt).toContain('Current posting schedule: New videos every Saturday and Sunday.')
    expect(prompt).toContain('Write for viewers in the United States')
    expect(prompt).toContain('v2 | Cappy tries to sleep | 75s | 3000')

    // A category, rhythm or trailer outside the choices falls back instead of breaking the page.
    reply({
      category: { id: '22', why: '' },
      cadence: { perWeek: 4, why: '' },
      trailer: { id: 'nope', why: '' },
    })
    const fallback = await suggestChannelSetup({ ...input, uploads: [] })
    expect(fallback.category.id).toBe('27')
    expect(fallback.cadence.perWeek).toBe(3)
    expect(fallback.trailer).toBeNull()
    expect(String(generateContent.mock.calls.at(-1)?.[0].contents)).toContain(
      'The channel has no uploads yet.',
    )
  })

  it('draws the profile picture and banner around the main character', async () => {
    const { channelArtPrompt } = await import('../src/ai')
    const input = {
      channel: 'Cappy Sleeps',
      niche: 'Sleep science',
      artStyle: 'Crude MS Paint',
      character: 'Cappy: a capybara',
    }
    const avatar = channelArtPrompt('avatar', input)
    expect(avatar).toContain('Cappy: a capybara (match the attached reference images exactly)')
    expect(avatar).toContain('No text, no letters')
    expect(avatar).toContain('Art style: Crude MS Paint.')
    const banner = channelArtPrompt('banner', { ...input, character: null })
    expect(banner).toContain('the channel name "Cappy Sleeps" in big, bold, easy-to-read letters')
    expect(banner).toContain('central horizontal strip about 60% of the width and 30% of the height')
    expect(banner).toContain('one simple mascot')
  })
})

describe('the YouTube channel page', () => {
  it('reads the channel as YouTube returns it', () => {
    const details = toChannelDetails({
      id: 'UC123',
      snippet: {
        title: 'Cappy Sleeps',
        customUrl: 'cappysleeps',
        publishedAt: '2025-03-02T10:00:00Z',
        thumbnails: { default: { url: 'small.jpg' }, high: { url: 'big.jpg' } },
        country: 'PH',
      },
      statistics: {
        subscriberCount: '1200',
        hiddenSubscriberCount: false,
        viewCount: '45000',
        videoCount: '31',
      },
      brandingSettings: {
        channel: {
          description: 'Sleep science',
          keywords: 'capybara "sleep science"',
          unsubscribedTrailer: 'vid1',
        },
      },
      status: {
        madeForKids: false,
        selfDeclaredMadeForKids: false,
        privacyStatus: 'public',
        longUploadsStatus: 'allowed',
      },
      topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Lifestyle_(sociology)'] },
      contentDetails: { relatedPlaylists: { uploads: 'UU123' } },
    })
    expect(details).toMatchObject({
      handle: '@cappysleeps',
      thumbnail: 'big.jpg',
      country: 'PH',
      keywords: ['capybara', 'sleep science'],
      trailer: 'vid1',
      subscribers: 1200,
      views: 45000,
      videos: 31,
      topics: ['Lifestyle (sociology)'],
      uploadsPlaylistId: 'UU123',
    })
    expect(
      toChannelDetails({ id: 'UC1', statistics: { hiddenSubscriberCount: true } })?.subscribers,
    ).toBeNull()
    expect(toChannelDetails({})).toBeNull()
    expect(topicName('https://en.wikipedia.org/wiki/Caf%C3%A9_culture')).toBe('Café culture')
  })

  it('sets and removes the trailer without touching the rest', () => {
    const current = { country: 'US', unsubscribedTrailer: 'old' }
    expect(mergeBranding(current, { trailer: 'new' })).toEqual({ country: 'US', unsubscribedTrailer: 'new' })
    expect(mergeBranding(current, { trailer: '' })).toEqual({ country: 'US' })
    expect(mergeBranding(current, {})).toEqual(current)
  })
})
