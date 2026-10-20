import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refineTranscript, segmentsFromWords, sliceTranscript, speechParts, timeWords } from '../src/align'
import { overlayEvents, overlayOpacity } from '../src/captions'
import { elevenLabsSpeech, wordsFromAlignment } from '../src/elevenlabs'
import { hasAnalyticsScope } from '../src/google'
import { imageDimensions, imageExtension } from '../src/images'
import { isPlainKey, isStoredUnder, keyOf, localPath } from '../src/storage'
import { sceneRange } from '../src/timing'
import { blackLevel, planTransitions } from '../src/transitions'
import { normalizeTransition } from '../src/types'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

describe('transitions', () => {
  it('reads old free-text transitions', () => {
    expect(normalizeTransition('crossfade')).toBe('crossfade')
    expect(normalizeTransition('Dissolve')).toBe('crossfade')
    expect(normalizeTransition('fade')).toBe('crossfade')
    expect(normalizeTransition('fade to black')).toBe('fade-black')
    expect(normalizeTransition('whip pan')).toBe('cut')
    expect(normalizeTransition('')).toBe('cut')
    expect(normalizeTransition(null)).toBe('cut')
  })

  it('plans crossfades, dips and fade-ins in frames', () => {
    const plans = planTransitions(
      [
        { length: 90, hasVisual: true, transition: 'fade-black' }, // first: fades in from black
        { length: 120, hasVisual: true, transition: 'crossfade' },
        { length: 60, hasVisual: true, transition: 'fade-black' },
        { length: 90, hasVisual: true, transition: 'cut' },
      ],
      30,
      true,
    )
    expect(plans[0]).toEqual({ fadeIn: 7, fadeOut: 0, crossfade: 0, tail: 15 })
    expect(plans[1]).toEqual({ fadeIn: 0, fadeOut: 7, crossfade: 15, tail: 0 })
    expect(plans[2]).toEqual({ fadeIn: 7, fadeOut: 0, crossfade: 0, tail: 0 })
    expect(plans[3]).toEqual({ fadeIn: 0, fadeOut: 0, crossfade: 0, tail: 0 })
  })

  it('shortens fades for short pictures and drops tiny ones', () => {
    const plans = planTransitions(
      [
        { length: 60, hasVisual: true, transition: 'cut' },
        { length: 10, hasVisual: true, transition: 'crossfade' }, // half of 10 frames
        { length: 3, hasVisual: true, transition: 'crossfade' }, // 1 frame: dropped
      ],
      30,
      true,
    )
    expect(plans[1].crossfade).toBe(5)
    expect(plans[0].tail).toBe(5)
    expect(plans[2].crossfade).toBe(0)
    expect(plans[1].tail).toBe(0)
  })

  it('fades in from black after the dark frame instead of crossfading', () => {
    const plans = planTransitions(
      [
        { length: 30, hasVisual: false, transition: 'cut' },
        { length: 90, hasVisual: true, transition: 'crossfade' },
      ],
      30,
      true,
    )
    expect(plans[1]).toEqual({ fadeIn: 7, fadeOut: 0, crossfade: 0, tail: 0 })
    expect(plans[0].tail).toBe(0)
  })

  it('plans the same fades in seconds for the preview', () => {
    const plans = planTransitions(
      [
        { length: 3, hasVisual: true, transition: 'cut' },
        { length: 4, hasVisual: true, transition: 'crossfade' },
      ],
      1,
      false,
    )
    expect(plans[1].crossfade).toBe(0.5)
    expect(plans[0].tail).toBe(0.5)
    expect(blackLevel({ fadeIn: 0.25, fadeOut: 0.25, crossfade: 0, tail: 0 }, 0, 3)).toBe(1)
    expect(blackLevel({ fadeIn: 0.25, fadeOut: 0.25, crossfade: 0, tail: 0 }, 1, 2)).toBe(0)
    expect(blackLevel({ fadeIn: 0.25, fadeOut: 0.25, crossfade: 0, tail: 0 }, 1, 0.125)).toBe(0.5)
  })
})

describe('on-screen text', () => {
  const scenes = [
    { start: 0.4, onScreenText: '  Three   hearts ' },
    { start: 5, onScreenText: '' },
    { start: 9, onScreenText: 'Blue blood' },
  ]

  it('shows each text for its scene as laid out in the video', () => {
    expect(overlayEvents(scenes, 15)).toEqual([
      { start: 0, end: 5, text: 'Three hearts' },
      { start: 9, end: 15, text: 'Blue blood' },
    ])
  })

  it('fades in and out', () => {
    const overlay = { start: 0, end: 5, text: 'x' }
    expect(overlayOpacity(overlay, 0)).toBe(0)
    expect(overlayOpacity(overlay, 0.1)).toBeCloseTo(0.5)
    expect(overlayOpacity(overlay, 2)).toBe(1)
    expect(overlayOpacity(overlay, 5)).toBe(0)
    expect(overlayOpacity({ start: 0, end: 0.4, text: 'x' }, 0.01)).toBe(1)
  })
})

describe('word timing from pauses', () => {
  it('finds the speech between pauses', () => {
    expect(
      speechParts(
        [
          { start: 1, end: 1.5 },
          { start: 3, end: 3.2 },
        ],
        0.5,
        4,
      ),
    ).toEqual([
      { start: 0.5, end: 1 },
      { start: 1.5, end: 3 },
      { start: 3.2, end: 4 },
    ])
  })

  it('puts each pause after the word with punctuation', () => {
    // "Octopuses have three hearts," <pause> "and blue blood."
    const words = timeWords('Octopuses have three hearts, and blue blood.', { start: 0, end: 4 }, [
      { start: 2, end: 2.6 },
    ])
    expect(words.map((w) => w.text)).toHaveLength(7)
    expect(words[3].text).toBe('hearts,')
    expect(words[3].end).toBeCloseTo(2, 2)
    expect(words[4].start).toBeCloseTo(2.6, 2)
    // Nobody is "speaking" during the pause.
    expect(words.every((w) => w.end <= 2 || w.start >= 2.6)).toBe(true)
  })

  it('copes with more pauses than words', () => {
    const words = timeWords('Hi there', { start: 0, end: 3 }, [
      { start: 0.5, end: 0.7 },
      { start: 1.2, end: 1.3 },
      { start: 2, end: 2.5 },
    ])
    expect(words).toHaveLength(2)
    expect(words[0].start).toBe(0)
    expect(words[1].end).toBe(3)
  })

  it('moves sentence edges onto real pauses', () => {
    const segments = [
      { start: 0.1, end: 2.4, text: 'First sentence here.' }, // really ends at 2.0
      { start: 2.3, end: 5, text: 'Second one now.' }, // really starts at 2.8
    ]
    const silences = [
      { start: 0, end: 0.3 },
      { start: 2.0, end: 2.8 },
      { start: 4.6, end: 5 },
    ]
    const { segments: out, words } = refineTranscript(segments, silences, 5)
    expect(out[0]).toMatchObject({ start: 0.3, end: 2 })
    expect(out[1]).toMatchObject({ start: 2.8, end: 4.6 })
    expect(words[0].start).toBeCloseTo(0.3, 2)
    expect(words[words.length - 1].end).toBeCloseTo(4.6, 2)
  })

  it('falls back to spreading words when there are no pauses', () => {
    const { words } = refineTranscript([{ start: 0, end: 2, text: 'one two' }], [], 2)
    expect(words.map((w) => w.text)).toEqual(['one', 'two'])
  })

  it('groups words into sentences', () => {
    const words = 'One two. Three four five!'.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }))
    expect(segmentsFromWords(words)).toEqual([
      { start: 0, end: 1.5, text: 'One two.' },
      { start: 2, end: 4.5, text: 'Three four five!' },
    ])
  })
})

describe('shorts', () => {
  it('measures a run of scenes as the video lays them out', () => {
    const scenes = [{ start: 0.3 }, { start: 5 }, { start: 11 }, { start: 20 }]
    expect(sceneRange(scenes, 0, 1, 30)).toEqual({ start: 0, end: 11 })
    expect(sceneRange(scenes, 1, 2, 30)).toEqual({ start: 5, end: 20 })
    expect(sceneRange(scenes, 2, 3, 30)).toEqual({ start: 11, end: 30 })
  })

  it('slices the transcript and moves it to start at zero', () => {
    const transcript = {
      duration: 30,
      segments: [
        { start: 4, end: 7, text: 'a b' },
        { start: 9, end: 12, text: 'c d' },
      ],
      words: [
        { text: 'a', start: 4, end: 4.5 },
        { text: 'b', start: 6, end: 7 },
        { text: 'c', start: 9, end: 9.5 },
        { text: 'd', start: 11.5, end: 12 },
      ],
    }
    const slice = sliceTranscript(transcript, 5, 11)
    expect(slice.duration).toBe(6)
    expect(slice.words).toEqual([
      { text: 'b', start: 1, end: 2 },
      { text: 'c', start: 4, end: 4.5 },
    ])
    expect(slice.segments).toEqual([
      { start: 0, end: 2, text: 'a b' },
      { start: 4, end: 6, text: 'c d' },
    ])
  })
})

describe('image sizes', () => {
  it('reads PNG, GIF, WebP and JPEG headers', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 1376)
    new DataView(png.buffer).setUint32(20, 768)
    expect(imageDimensions(png)).toEqual({ width: 1376, height: 768 })

    const gif = new Uint8Array(10)
    gif.set([...'GIF89a'].map((c) => c.charCodeAt(0)))
    new DataView(gif.buffer).setUint16(6, 320, true)
    new DataView(gif.buffer).setUint16(8, 200, true)
    expect(imageDimensions(gif)).toEqual({ width: 320, height: 200 })

    const webp = new Uint8Array(30)
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)))
    webp.set(
      [...'WEBPVP8X'].map((c) => c.charCodeAt(0)),
      8,
    )
    webp.set([0x7f, 0x07, 0x00], 24) // 1919 + 1
    webp.set([0x37, 0x04, 0x00], 27) // 1079 + 1
    expect(imageDimensions(webp)).toEqual({ width: 1920, height: 1080 })

    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00,
      0x03, 0, 0, 0, 0, 0, 0,
    ])
    expect(imageDimensions(jpeg)).toEqual({ width: 1280, height: 720 })

    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(imageExtension('image/jpeg')).toBe('.jpg')
    expect(imageExtension('image/png')).toBe('.png')
  })
})

describe('stored file checks', () => {
  it('refuses keys that climb out of their folder', () => {
    expect(isPlainKey('projects/a/voiceover/x.wav')).toBe(true)
    expect(isPlainKey('projects/a/voiceover/../../b/voiceover/x.wav')).toBe(false)
    expect(isPlainKey('projects/./a')).toBe(false)
    expect(isPlainKey('projects//a')).toBe(false)
    expect(isPlainKey('projects\\a')).toBe(false)
    expect(isPlainKey('')).toBe(false)
    expect(() => localPath('projects/a/../b/x.wav')).toThrow('Invalid file key')
  })

  it('accepts only our own files inside the given folder', () => {
    const folder = 'projects/NEW/voiceover'
    expect(isStoredUnder('/api/files/projects/NEW/voiceover/ab12cd34-short.wav', folder)).toBe(true)
    expect(isStoredUnder('/api/files/projects/NEW/voiceover/../../OTHER/voiceover/f.mp3', folder)).toBe(false)
    expect(isStoredUnder('/api/files/projects/NEW/voiceover/%2e%2e/%2e%2e/OTHER/f.mp3', folder)).toBe(false)
    expect(isStoredUnder('/api/files/projects/NEWER/voiceover/f.mp3', folder)).toBe(false)
    expect(isStoredUnder('/api/files/%E0%A4%A', folder)).toBe(false)
    // Local storage (no Blob token in tests): absolute URLs are never ours.
    expect(isStoredUnder('https://evil.example/projects/NEW/voiceover/f.mp3', folder)).toBe(false)
  })

  it('checks the host when files live on Vercel Blob', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
    try {
      const folder = 'projects/NEW/voiceover'
      expect(
        isStoredUnder(
          'https://abc123.public.blob.vercel-storage.com/projects/NEW/voiceover/s-x1.wav',
          folder,
        ),
      ).toBe(true)
      expect(isStoredUnder('https://evil.example/projects/NEW/voiceover/f.mp3', folder)).toBe(false)
      expect(
        isStoredUnder('http://abc123.public.blob.vercel-storage.com/projects/NEW/voiceover/f.wav', folder),
      ).toBe(false)
      expect(
        isStoredUnder('https://abc123.public.blob.vercel-storage.com/projects/OTHER/voiceover/f.wav', folder),
      ).toBe(false)
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN
    }
  })

  it('reads malformed URLs as no key instead of crashing', () => {
    expect(keyOf('/api/files/%E0%A4%A')).toBe('')
  })
})

describe('small helpers', () => {
  it('reads storage keys from URLs', () => {
    expect(keyOf('/api/files/projects/p1/scenes/ab12cd34-scene.png')).toBe(
      'projects/p1/scenes/ab12cd34-scene.png',
    )
    expect(keyOf('https://x.public.blob.vercel-storage.com/projects/p1/voiceover/a%20b.wav')).toBe(
      'projects/p1/voiceover/a b.wav',
    )
  })

  it('knows when a channel granted analytics', () => {
    expect(hasAnalyticsScope('openid https://www.googleapis.com/auth/yt-analytics.readonly')).toBe(true)
    expect(hasAnalyticsScope('https://www.googleapis.com/auth/youtube.upload')).toBe(false)
    expect(hasAnalyticsScope(null)).toBe(false)
  })
})

describe('ElevenLabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ELEVENLABS_API_KEY
  })

  it('turns character times into word times', () => {
    const chars = [...'Hi you']
    const words = wordsFromAlignment({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
    })
    expect(words.map((w) => w.text)).toEqual(['Hi', 'you'])
    expect(words[0].start).toBe(0)
    expect(words[0].end).toBeCloseTo(0.2)
    expect(words[1].start).toBeCloseTo(0.3)
    expect(words[1].end).toBeCloseTo(0.6)
  })

  it('requests speech with timestamps and continuity text', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    const fetchMock = vi.fn(async () =>
      Response.json({
        audio_base64: Buffer.from('mp3').toString('base64'),
        alignment: {
          characters: ['O', 'k'],
          character_start_times_seconds: [0, 0.1],
          character_end_times_seconds: [0.1, 0.2],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await elevenLabsSpeech('Ok', { voiceId: 'voice 1', previousText: 'Before.' })
    expect(result.audio.toString()).toBe('mp3')
    expect(result.words).toEqual([{ text: 'Ok', start: 0, end: 0.2 }])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/v1/text-to-speech/voice%201/with-timestamps?output_format=mp3_44100_128')
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('el-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ text: 'Ok', previous_text: 'Before.' })
  })

  it('retries a dropped connection, and gives every request its own timeout', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    const ok = Response.json({ audio_base64: Buffer.from('mp3').toString('base64'), alignment: null })
    const fetchMock = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const result = await elevenLabsSpeech('Hi', { voiceId: 'v', signal: caller.signal })
    expect(result.audio.toString()).toBe('mp3')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The request's signal combines the caller's with a timeout, so it is not the caller's own.
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal).not.toBe(caller.signal)
  })

  it('stops at once when the job is stopped', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-key'
    const caller = new AbortController()
    const fetchMock = vi.fn(async () => {
      caller.abort(new Error('Stopped.'))
      throw new DOMException('aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(elevenLabsSpeech('Hi', { voiceId: 'v', signal: caller.signal })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('explains a rejected key without retrying', async () => {
    process.env.ELEVENLABS_API_KEY = 'bad'
    const fetchMock = vi.fn(async () => Response.json({ detail: { message: 'invalid' } }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(elevenLabsSpeech('x', { voiceId: 'v' })).rejects.toThrow(/did not accept the API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Gemini calls', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
  })
  afterEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  const image = (mimeType = 'image/png') => ({
    candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType, data: 'aW1n' } }] } }],
  })

  it('generates an image with reference images attached', async () => {
    const { generateImage } = await import('../src/ai')
    generateContent.mockResolvedValueOnce(image())
    const refs = Array.from({ length: 8 }, () => ({ data: Buffer.from('ref'), mimeType: 'image/png' }))
    const result = await generateImage({ prompt: 'A cat', references: refs, aspectRatio: '9:16' })
    expect(result.data.toString()).toBe('img')
    expect(result.mimeType).toBe('image/png')
    const request = generateContent.mock.calls[0][0]
    expect(request.model).toBe('gemini-3.1-flash-lite-image')
    expect(request.config.responseModalities).toEqual(['TEXT', 'IMAGE'])
    expect(request.config.imageConfig).toEqual({ aspectRatio: '9:16' })
    // The prompt plus at most six reference images.
    expect(request.contents[0].parts).toHaveLength(7)
  })

  it('says why an image was refused', async () => {
    const { generateImage } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }],
    })
    await expect(generateImage({ prompt: 'x', references: [], aspectRatio: '16:9' })).rejects.toMatchObject({
      code: 'bad_output',
      message: expect.stringContaining('IMAGE_SAFETY'),
    })
  })

  it('does not retry a bad request just because its text mentions an error code', async () => {
    const { generateImage } = await import('../src/ai')
    generateContent.mockRejectedValue(
      Object.assign(new Error('{"error":{"code":400,"message":"INTERNAL field exceeds 5000 bytes"}}'), {
        status: 400,
      }),
    )
    await expect(generateImage({ prompt: 'x', references: [], aspectRatio: '16:9' })).rejects.toMatchObject({
      code: 'failed',
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('retries a temporary server error', async () => {
    const { generateImage } = await import('../src/ai')
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('{"error":{"code":503}}'), { status: 503 }))
      .mockResolvedValueOnce(image())
    const result = await generateImage({ prompt: 'x', references: [], aspectRatio: '16:9' })
    expect(result.data.toString()).toBe('img')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('reports a model without free tier as a billing problem, without retrying', async () => {
    const { generateImage } = await import('../src/ai')
    generateContent.mockRejectedValue(
      new Error(
        '429 RESOURCE_EXHAUSTED: Quota exceeded for metric: generate_content_free_tier_requests, limit: 0',
      ),
    )
    await expect(generateImage({ prompt: 'x', references: [], aspectRatio: '16:9' })).rejects.toMatchObject({
      code: 'billing',
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('stops a speech request and its retry wait when the job is stopped', async () => {
    const { synthesizeSpeech } = await import('../src/ai')
    generateContent.mockRejectedValue(Object.assign(new Error('{"error":{"code":503}}'), { status: 503 }))
    const controller = new AbortController()
    const started = Date.now()
    const call = synthesizeSpeech('Hello.', { voice: 'Kore', signal: controller.signal })
    setTimeout(() => controller.abort(new Error('Stopped.')), 50)
    await expect(call).rejects.toThrow('Stopped.')
    // Without the signal the backoff alone would wait 1.5 s or more.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(generateContent.mock.calls[0][0].config.abortSignal).toBe(controller.signal)
  })

  it('reads speech with a voice and a delivery style', async () => {
    const { synthesizeSpeech } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'cGNt' } }] },
        },
      ],
    })
    const audio = await synthesizeSpeech('Hello there.', { voice: 'Charon', style: 'calm' })
    expect(audio.mimeType).toBe('audio/L16;codec=pcm;rate=24000')
    expect(audio.data.toString()).toBe('pcm')
    const request = generateContent.mock.calls[0][0]
    expect(request.model).toBe('gemini-3.8-flash-tts')
    expect(request.config.responseModalities).toEqual(['AUDIO'])
    expect(request.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon')
    expect(request.contents[0].parts[0]).toEqual({ text: 'Hello there.', speechMetadata: { style: 'calm' } })
  })

  it('asks again when speech comes back empty', async () => {
    const { synthesizeSpeech } = await import('../src/ai')
    generateContent
      .mockResolvedValueOnce({ candidates: [] })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [] } }] })
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'd2F2' } }] } }],
      })
    const audio = await synthesizeSpeech('Hi', { voice: 'Kore' })
    expect(audio.mimeType).toBe('audio/wav')
    expect(generateContent).toHaveBeenCalledTimes(3)
  })

  it('keeps a Short pick in range and under the length limit', async () => {
    const { pickShortMoment } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ startIndex: 1, endIndex: 9, title: ' Hook ', reason: 'Strong opener.' }),
    })
    const scenes = [0, 10, 20, 30, 40, 50].map((start) => ({ start, end: start + 10, narration: 'x' }))
    const pick = await pickShortMoment({ title: 't', topic: 'x', scenes, maxSeconds: 35 })
    expect(pick).toEqual({ startIndex: 1, endIndex: 3, title: 'Hook', reason: 'Strong opener.' })
  })

  it('shows Gemini the channel’s best titles when writing post details', async () => {
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
      topTitles: [{ title: 'Why octopuses dream', views: 12345 }],
    })
    expect(generateContent.mock.calls[0][0].contents).toContain('"Why octopuses dream" (12,345 views)')
  })
})
