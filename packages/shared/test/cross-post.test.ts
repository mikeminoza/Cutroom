import { describe, expect, it } from 'vitest'
import {
  CAPTION,
  crossPostCaption,
  crossPostHashtags,
  postedOn,
  videoFileName,
  videoSource,
} from '../src/cross-post'
import { EMPTY_POST, type PostDetails } from '../src/types'

const post = (over: Partial<PostDetails> = {}): PostDetails => ({
  ...EMPTY_POST,
  title: 'Why you wake up tired',
  description: [
    'Your alarm is not the problem. Sleep comes in 90-minute cycles, and waking mid-cycle leaves you groggy.',
    'Here is how to time your alarm so you wake up between cycles.',
    'New videos every Tuesday. Subscribe so you never miss one!',
    '#Shorts #Sleep #Health',
  ].join('\n\n'),
  hashtags: ['#Shorts', '#Sleep', '#Health'],
  tags: ['sleep cycles', 'why do i wake up tired', 'sleep', 'grogginess', 'health', 'sleep science'],
  ...over,
})

const hashtagsIn = (caption: string) => caption.match(/#\S+/g) ?? []

describe('TikTok and Reels captions', () => {
  it('puts the hook first, then a line from the description, then hashtags for each app', () => {
    expect(crossPostCaption(post(), 'tiktok')).toBe(
      [
        'Why you wake up tired',
        'Your alarm is not the problem.',
        '#Sleep #Health #sleepcycles #grogginess',
      ].join('\n'),
    )
    // Instagram shows the caption under the video, where blank lines read easier.
    expect(crossPostCaption(post(), 'reels')).toBe(
      [
        'Why you wake up tired',
        'Your alarm is not the problem.',
        '#Sleep #Health #sleepcycles #grogginess #sleepscience',
      ].join('\n\n'),
    )
  })

  it('drops hashtags that only mean something on YouTube', () => {
    const youtubeOnly = [
      '#Shorts',
      '#short',
      '#YouTubeShorts',
      '#ytshorts',
      '#shortsfeed',
      '#ShortsVideo',
      '#viralshorts',
      '#youtube',
      '#subscribe',
    ]
    const tags = crossPostHashtags(
      post({ hashtags: [...youtubeOnly, '#ShortStory', '#Octopus'], tags: ['youtube shorts', 'shorts'] }),
      'reels',
    )
    expect(tags).toEqual(['#ShortStory', '#Octopus'])
  })

  it('keeps to a small set: 4 on TikTok, 5 on Reels (Instagram allows 5, and never more than 30)', () => {
    const many = post({
      hashtags: Array.from({ length: 15 }, (_, i) => `#topic${i}`),
      tags: Array.from({ length: 40 }, (_, i) => `tag ${i}`),
    })
    expect(hashtagsIn(crossPostCaption(many, 'tiktok'))).toHaveLength(CAPTION.hashtags.tiktok)
    expect(hashtagsIn(crossPostCaption(many, 'reels'))).toHaveLength(CAPTION.hashtags.reels)
    expect(CAPTION.hashtags.tiktok).toBe(4)
    expect(CAPTION.hashtags.reels).toBeLessThanOrEqual(5)
  })

  it('turns tags into readable hashtags and skips the ones that would not work', () => {
    const tags = crossPostHashtags(
      post({
        hashtags: ['Ocean Facts', '#2026', '##octopus', `#${'a'.repeat(31)}`],
        // A long search phrase makes an unreadable hashtag nobody types.
        tags: ['OCTOPUS', "cat's purr", 'why do octopuses have three hearts', 'sea-life'],
      }),
      'reels',
    )
    expect(tags).toEqual(['#OceanFacts', '#octopus', '#catspurr', '#sealife'])
  })

  it('stays well within the 2,200 characters both apps allow, whatever the details hold', () => {
    const huge = post({
      title: 'T'.repeat(5000),
      description: 'word '.repeat(2000),
      hashtags: Array.from({ length: 15 }, (_, i) => `#${String.fromCharCode(97 + i).repeat(30)}`),
      tags: Array.from({ length: 60 }, (_, i) => `${String.fromCharCode(97 + (i % 26)).repeat(28)}${i}`),
    })
    for (const platform of ['tiktok', 'reels'] as const) {
      const caption = crossPostCaption(huge, platform)
      expect(caption.length).toBeLessThanOrEqual(500)
      expect(caption.length).toBeLessThan(CAPTION.limit)
      // A cut line ends on a whole word.
      expect(caption.split('\n').filter(Boolean)[1]).toMatch(/^(word )+word…$/)
    }
  })

  it('takes its line from the words of the description, not links, chapters, hashtags or YouTube asks', () => {
    const description = [
      'Why you wake up tired.',
      'Chapters',
      '0:00 The alarm',
      'Watch the full video on YouTube: https://youtu.be/abc',
      'Subscribe for a new one every week!',
      '#Sleep #Health',
      'Most people blame the alarm, but the clock inside you decides.',
    ].join('\n')
    expect(crossPostCaption(post({ description, hashtags: [], tags: [] }), 'tiktok')).toBe(
      'Why you wake up tired\nMost people blame the alarm, but the clock inside you decides.',
    )
  })

  it('leaves out what is missing', () => {
    expect(crossPostCaption(post({ description: '' }), 'tiktok')).toBe(
      'Why you wake up tired\n#Sleep #Health #sleepcycles #grogginess',
    )
    expect(crossPostCaption(post({ hashtags: [], tags: [] }), 'reels')).toBe(
      'Why you wake up tired\n\nYour alarm is not the problem.',
    )
    expect(crossPostCaption({ ...EMPTY_POST }, 'reels')).toBe('')
  })
})

describe('the video file for TikTok and Reels', () => {
  it('is named after its title', () => {
    expect(videoFileName('Why You Wake Up Tired?')).toBe('why-you-wake-up-tired.mp4')
    expect(videoFileName('¿Por qué despiertas cansado?')).toBe('por-que-despiertas-cansado.mp4')
    expect(videoFileName('なぜ疲れて起きるのか')).toBe('なぜ疲れて起きるのか.mp4')
    expect(videoFileName('  ')).toBe('video.mp4')
    expect(videoFileName('!!!')).toBe('video.mp4')
    // Long titles are cut at a whole word.
    expect(
      videoFileName('The real reason octopuses have three hearts and blue blood, explained simply and why'),
    ).toBe('the-real-reason-octopuses-have-three-hearts-and-blue-blood-explained-simply-and.mp4')
  })

  it('comes from the stored file, else from Google Drive, else is not there yet', () => {
    const project = {
      id: 'p1',
      title: 'Sleep',
      post: { title: 'Why you wake up tired' },
      outputUrl: 'https://store.public.blob.vercel-storage.com/projects/p1/renders/video.mp4',
      driveFileId: 'drive-1',
    }
    // Through our own route, which names the file: Blob is on another domain, where browsers
    // ignore a link's download name.
    expect(videoSource(project)).toEqual({
      kind: 'file',
      href: '/api/projects/p1/video',
      name: 'why-you-wake-up-tired.mp4',
    })
    expect(videoSource({ ...project, post: { title: '' } })).toMatchObject({ name: 'sleep.mp4' })
    // Removed from storage after posting, to free space: the copy on Drive.
    expect(videoSource({ ...project, outputUrl: null })).toEqual({
      kind: 'drive',
      href: 'https://drive.google.com/file/d/drive-1/view',
    })
    expect(videoSource({ ...project, outputUrl: null, driveFileId: null })).toEqual({ kind: 'none' })
  })
})

describe('where a Short is posted', () => {
  it('lists the apps it was marked as posted on', () => {
    expect(postedOn({})).toEqual([])
    expect(postedOn({ crossPosts: { reels: { at: '2026-11-20T10:00:00Z', url: null } } })).toEqual(['reels'])
    expect(
      postedOn({
        crossPosts: {
          reels: { at: '2026-11-20T10:00:00Z', url: null },
          tiktok: { at: '2026-11-21T10:00:00Z', url: 'https://www.tiktok.com/@me/video/1' },
        },
      }),
    ).toEqual(['tiktok', 'reels'])
  })
})
