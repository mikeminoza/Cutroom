import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTION_LINE_CHARS,
  cuesToSrt,
  parseSrt,
  SUBTITLE_LANGUAGES,
  subtitleLanguages,
  subtitleText,
  toSrt,
  wordsFromScenes,
} from '../src/captions'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
  createPartFromUri: () => ({}),
}))

const words = wordsFromScenes([
  {
    start: 0,
    end: 6,
    narration: 'It is 3 AM. Again. Your liver is doing its night shift, and it wants you awake.',
  },
  {
    start: 6,
    end: 12,
    narration: 'So you lie there, wide awake, wondering why your body hates sleep this much.',
  },
])
const times = (srt: string) => srt.split('\n').filter((line) => line.includes(' --> '))

describe('subtitles timed like the captions', () => {
  it('reads the caption track back exactly as it was written', () => {
    const srt = toSrt(words)
    const cues = parseSrt(srt)
    expect(cues.length).toBeGreaterThan(3)
    expect(cues[0].text).toBe('It is 3 AM.')
    expect(cuesToSrt(cues)).toBe(srt)
    // A file saved on Windows reads the same.
    expect(parseSrt(srt.replace(/\n/g, '\r\n'))).toEqual(cues)
  })

  it('puts translated text on the original times', () => {
    const srt = toSrt(words)
    const cues = parseSrt(srt)
    const translated = cuesToSrt(cues.map((cue, i) => ({ ...cue, text: `Línea ${i + 1}` })))
    expect(times(translated)).toEqual(times(srt))
    expect(parseSrt(translated).map((cue) => cue.text)).toEqual(cues.map((_, i) => `Línea ${i + 1}`))
  })

  it('lays out a long translated line as two balanced lines, like a caption line', () => {
    expect(subtitleText('  Son las   3 de la mañana. ')).toBe('Son las 3 de la mañana.')
    const long = 'Tu hígado está haciendo su turno de noche, y quiere que estés despierto.'
    const lines = subtitleText(long).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.join(' ')).toBe(long)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS)
    // Scripts written without spaces stay on one line, for YouTube's player to wrap.
    const japanese =
      'あなたの肝臓は夜勤をしていて、あなたに起きていてほしいと思っています。だからあなたは眠れないのです。'
    expect(subtitleText(japanese)).toBe(japanese)
  })

  it('go in at most two languages a video, the most-watched first, never the video’s own', () => {
    const t = (language: string, title = 'Title') => ({ language, title, description: '' })
    const translations = [t('fr'), t('de'), t('en'), t('it', '  '), t('hi'), t('pt'), t('es')]
    expect(SUBTITLE_LANGUAGES).toBe(2)
    expect(subtitleLanguages(translations, 'en')).toEqual(['es', 'pt'])
    expect(subtitleLanguages(translations, 'es')).toEqual(['pt', 'hi'])
    // Languages Settings doesn't list come after the ones it does.
    expect(subtitleLanguages([t('xx'), t('nl')], 'en')).toEqual(['nl', 'xx'])
    expect(subtitleLanguages(undefined, 'en')).toEqual([])
  })

  it('keep three uploads a day and a click of replies inside YouTube’s daily quota', () => {
    // An upload (1,600), its thumbnail (50), captions (400) and playlist (50), plus 400 a track.
    const video = 1_600 + 50 + 400 + 50 + SUBTITLE_LANGUAGES * 400
    expect(3 * video + 500).toBeLessThanOrEqual(10_000)
  })
})

describe('translating captions', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    generateContent.mockReset()
  })
  afterEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  const cues = ['It is 3 AM. Again.', 'Your liver is doing its night shift,', 'and it wants you awake.']
  const answer = (subtitles: { language: string; lines: string[] }[]) => ({
    text: JSON.stringify({ subtitles }),
  })
  /** The languages and cue texts a request asks for. */
  const asked = (request: { contents: unknown; config: { responseJsonSchema: any } }) => ({
    codes: request.config.responseJsonSchema.properties.subtitles.items.properties.language.enum as string[],
    cues: String(request.contents)
      .split('\n')
      .map((line) => /^\d+\. (.*)$/.exec(line)?.[1])
      .filter((cue): cue is string => cue !== undefined),
  })
  /** Answers every request with each cue marked as translated into each language asked. */
  const translateAll = () =>
    generateContent.mockImplementation(async (request) => {
      const { codes, cues } = asked(request)
      return answer(codes.map((language) => ({ language, lines: cues.map((cue) => `${language}: ${cue}`) })))
    })

  it('sends the cues as a numbered list to Flash-Lite, and gets each language back line for line', async () => {
    const { translateCaptions } = await import('../src/ai')
    generateContent.mockResolvedValueOnce(
      answer([
        {
          language: 'es',
          lines: [' Son las 3 AM. Otra vez. ', 'Tu hígado hace su turno de noche,', 'y te quiere despierto.'],
        },
        {
          language: 'pt',
          lines: ['São 3 da manhã. De novo.', 'Seu fígado está no turno da noite,', 'e quer você acordado.'],
        },
      ]),
    )
    const result = await translateCaptions({ cues, from: 'en', to: ['es', 'pt', 'en'] })
    expect(result).toEqual([
      {
        language: 'es',
        cues: ['Son las 3 AM. Otra vez.', 'Tu hígado hace su turno de noche,', 'y te quiere despierto.'],
      },
      {
        language: 'pt',
        cues: ['São 3 da manhã. De novo.', 'Seu fígado está no turno da noite,', 'e quer você acordado.'],
      },
    ])
    expect(generateContent).toHaveBeenCalledTimes(1)
    const request = generateContent.mock.calls[0][0]
    // Flash-Lite has a free quota of its own, kept apart from the writing.
    expect(request.model).toBe('gemini-3.5-flash-lite')
    const prompt = String(request.contents)
    expect(prompt).toContain(
      '1. It is 3 AM. Again.\n2. Your liver is doing its night shift,\n3. and it wants you awake.',
    )
    expect(prompt).toContain('es (Spanish)')
    expect(prompt).toContain('pt (Portuguese)')
    expect(prompt).toMatch(/3 lines/)
  })

  it('leaves out a language whose lines don’t match the cues, and keeps the others', async () => {
    const { translateCaptions } = await import('../src/ai')
    generateContent.mockResolvedValueOnce(
      answer([
        // One line short: every line after the merge would show at the wrong time.
        {
          language: 'es',
          lines: ['Son las 3 AM. Otra vez. Tu hígado hace su turno de noche,', 'y te quiere despierto.'],
        },
        // Its numbers copied in: taken out again.
        {
          language: 'pt',
          lines: ['1. São 3 da manhã.', '2. Seu fígado trabalha,', '3. e quer você acordado.'],
        },
        { language: 'fr', lines: ['Il est 3 h.', '', 'et il veut que tu sois réveillé.'] },
      ]),
    )
    const result = await translateCaptions({ cues, from: 'en', to: ['es', 'pt', 'fr', 'de'] })
    expect(result.map((r) => r.language)).toEqual(['es', 'pt', 'fr', 'de'])
    expect(result[0]).toEqual({ language: 'es', error: expect.stringMatching(/line up/) })
    expect(result[1]).toEqual({
      language: 'pt',
      cues: ['São 3 da manhã.', 'Seu fígado trabalha,', 'e quer você acordado.'],
    })
    // A blank line is no translation of a cue that says something.
    expect(result[2]).toEqual({ language: 'fr', error: expect.stringMatching(/line up/) })
    // Left out of the answer altogether.
    expect(result[3]).toEqual({ language: 'de', error: expect.stringMatching(/left it out/) })
  })

  it('asks for several languages a call while the answer fits comfortably', async () => {
    const { translateCaptions } = await import('../src/ai')
    translateAll()
    // A minute of captions: four languages fit one answer, so six take two calls.
    const short = Array.from({ length: 20 }, (_, i) => `Caption number ${i + 1} of a short video.`)
    const result = await translateCaptions({
      cues: short,
      from: 'en',
      to: ['es', 'pt', 'hi', 'id', 'fr', 'de'],
    })
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(generateContent.mock.calls.map((call) => asked(call[0]).codes)).toEqual([
      ['es', 'pt', 'hi', 'id'],
      ['fr', 'de'],
    ])
    expect(result.every((r) => 'cues' in r && r.cues.length === short.length)).toBe(true)

    // Ten minutes of captions: fewer languages a call, each with room for a token a character,
    // which scripts like Hindi or Japanese can take.
    generateContent.mockClear()
    const long = Array.from(
      { length: 220 },
      (_, i) => `This is caption line ${i + 1}, with a few more words.`,
    )
    const characters = long.join('').length
    await translateCaptions({ cues: long, from: 'en', to: ['es', 'pt', 'hi', 'ja'] })
    const requests = generateContent.mock.calls.map((call) => call[0])
    expect(requests.length).toBeGreaterThan(1)
    expect(requests.length).toBeLessThan(4)
    for (const request of requests) {
      expect(request.config.maxOutputTokens).toBeGreaterThanOrEqual(asked(request).codes.length * characters)
      expect(request.config.maxOutputTokens).toBeLessThanOrEqual(65_536)
    }
    expect(requests.flatMap((request) => asked(request).codes).sort()).toEqual(['es', 'hi', 'ja', 'pt'])
  })

  it('splits a very long video’s captions into parts and puts each language back together in order', async () => {
    const { translateCaptions } = await import('../src/ai')
    translateAll()
    const hour = Array.from(
      { length: 1500 },
      (_, i) => `This is caption line ${i + 1}, with a few more words.`,
    )
    const [result] = await translateCaptions({ cues: hour, from: 'en', to: ['es'] })
    expect(generateContent.mock.calls.length).toBeGreaterThan(1)
    for (const call of generateContent.mock.calls) {
      expect(call[0].config.maxOutputTokens).toBeLessThanOrEqual(65_536)
    }
    expect(result).toEqual({ language: 'es', cues: hour.map((cue) => `es: ${cue}`) })
  })

  it('turns a failed call into the reason for its languages instead of throwing', async () => {
    const { translateCaptions } = await import('../src/ai')
    generateContent.mockImplementation(async (request) => {
      const { codes } = asked(request)
      if (codes.includes('es')) {
        throw Object.assign(
          new Error('Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier'),
          { status: 429 },
        )
      }
      return answer(codes.map((language) => ({ language, lines: cues.map((cue) => `${language}: ${cue}`) })))
    })
    const many = ['es', 'pt', 'hi', 'id', 'fr']
    const result = await translateCaptions({ cues, from: 'en', to: many })
    expect(result.slice(0, 4)).toEqual(
      ['es', 'pt', 'hi', 'id'].map((language) => ({
        language,
        error: expect.stringMatching(/daily limit/),
      })),
    )
    expect(result[4]).toEqual({ language: 'fr', cues: cues.map((cue) => `fr: ${cue}`) })
  })
})
