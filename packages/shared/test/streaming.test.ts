import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerEvents } from '../src/ai'

const generateContent = vi.hoisted(() => vi.fn())
const generateContentStream = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
  },
  createPartFromUri: () => ({}),
}))

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key'
  generateContent.mockReset()
  generateContentStream.mockReset()
})
afterEach(() => {
  delete process.env.GEMINI_API_KEY
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** `text` in pieces of `size` characters, cut anywhere, the way Gemini streams it. */
const piecesOf = (text: string, size = 7) =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size))

/**
 * Gemini's streamed answer in `chunks`, after its thought summaries if any: it waits for `gate`
 * before the last chunk, or breaks with a 503 before chunk `breakAt`. The last chunk says why it
 * stopped and what it used.
 */
function streamOf(
  chunks: string[],
  options: { gate?: Promise<void>; breakAt?: number; finish?: string; thoughts?: string[] } = {},
) {
  return async () =>
    (async function* () {
      for (const thought of options.thoughts ?? []) {
        yield { text: undefined, candidates: [{ content: { parts: [{ text: thought, thought: true }] } }] }
      }
      for (const [i, text] of chunks.entries()) {
        if (options.breakAt === i) throw Object.assign(new Error('{"error":{"code":503}}'), { status: 503 })
        const last = i === chunks.length - 1
        if (last && options.gate) await options.gate
        yield {
          text,
          candidates: [last ? { finishReason: options.finish ?? 'STOP' } : {}],
          usageMetadata: last ? { thoughtsTokenCount: 40, candidatesTokenCount: 900 } : undefined,
        }
      }
    })()
}

/**
 * Runs `call` with Gemini answering `answer` in one piece, then streaming the same text: both
 * results, and every partial answer the streamed call handed over, in order.
 */
async function bothWays<P, T>(call: (events?: AnswerEvents<P>) => Promise<T>, answer: unknown) {
  const text = JSON.stringify(answer)
  generateContent.mockResolvedValueOnce({ text })
  const plain = await call()
  generateContentStream.mockImplementationOnce(streamOf(piecesOf(text)))
  const partials: P[] = []
  const streamed = await call({ onPartial: (partial) => partials.push(structuredClone(partial)) })
  return { plain, streamed, partials }
}

/** Each list in `partials` only grows, and holds what the final list starts with. */
function growsInto<T>(partials: T[][], final: T[]) {
  for (const [i, partial] of partials.entries()) {
    expect(final.slice(0, partial.length)).toEqual(partial)
    if (i > 0) expect(partial.length).toBeGreaterThanOrEqual(partials[i - 1].length)
  }
}

const script =
  'Look at you right now, scrolling in the dark.\n\nIt is basic biology. Adenosine builds up while you are awake. Coffee blocks it for hours.'
const voice = { narration: 'Sarcastic older brother', audience: 'US adults', tone: 'Roasting', rules: [] }
const review = {
  edits: [
    {
      original: 'Look at you right now, scrolling in the dark',
      suggestion: 'Look at you, doom-scrolling',
      kind: 'funnier',
      why: 'Sharper.',
    },
    { original: 'Words that are not there', suggestion: 'x', kind: 'tighter', why: '' },
    { original: 'It is basic biology.', suggestion: 'Biology.', kind: 'tighter', why: 'Shorter.' },
    { original: 'It is basic biology.', suggestion: 'Science.', kind: 'clearer', why: 'Again.' },
    { original: 'Coffee blocks it for hours.', suggestion: '', kind: 'cut', why: 'Filler.' },
  ],
  claims: [
    { quote: 'Adenosine builds up while you are awake', verdict: 'ok', note: 'Established.', safer: 'x' },
    { quote: 'Not in the script', verdict: 'wrong', note: '', safer: '' },
    {
      quote: 'Coffee blocks it for hours',
      verdict: 'check',
      note: 'Depends on the person.',
      safer: 'Coffee can block it for a few hours',
    },
  ],
}

describe('the script doctor, as Gemini writes it', () => {
  it('shows each edit and claim as soon as it is written, only the ones the review keeps', async () => {
    const { reviewScript } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) => reviewScript({ script, title: 'Tired', voice }, events),
      review,
    )
    expect(streamed).toEqual(plain)
    expect(plain.edits.map((e) => e.original)).toEqual([
      'Look at you right now, scrolling in the dark',
      'It is basic biology.',
      'Coffee blocks it for hours.',
    ])
    expect(plain.claims).toHaveLength(2)
    // Items come one at a time, never one that the whole review drops, and none goes away.
    expect(new Set(partials.map((p) => p.edits.length + p.claims.length)).size).toBe(6)
    growsInto(
      partials.map((p) => p.edits),
      plain.edits,
    )
    growsInto(
      partials.map((p) => p.claims),
      plain.claims,
    )
    expect(partials.at(-1)).toEqual(plain)
    // The same request, streamed: the schema, and the model's own level of thinking.
    const request = generateContentStream.mock.calls[0][0]
    expect(request.config.responseMimeType).toBe('application/json')
    expect(request.config.responseJsonSchema.required).toEqual(['edits', 'claims'])
    expect(request.config.thinkingConfig).toBeUndefined()
    expect(request.contents).toBe(generateContent.mock.calls[0][0].contents)
  })

  it('hands over the first edit while the rest is still being written', async () => {
    const { reviewScript } = await import('../src/ai')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    generateContentStream.mockImplementationOnce(streamOf(piecesOf(JSON.stringify(review)), { gate }))
    const partials: { edits: unknown[] }[] = []
    const reviewing = reviewScript({ script, title: '', voice }, { onPartial: (p) => partials.push(p) })
    await vi.waitFor(() => expect(partials.at(-1)?.edits.length).toBe(3))
    release()
    expect((await reviewing).edits).toHaveLength(3)
  })

  it('asks for no more claims than it keeps, the most important first', async () => {
    const { reviewScript } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ edits: [], claims: [] }) })
    await reviewScript({ script, title: '', voice })
    const prompt = String(generateContent.mock.calls[0][0].contents)
    expect(prompt).toContain('claims: up to 12 factual claims')
    expect(prompt).toContain('the most important first')
    expect(prompt).not.toContain('every factual claim')
    expect(prompt).toContain('edits: up to 10 lines')
  })

  it('says what Gemini is thinking about, from its thought summaries, without changing the answer', async () => {
    const { reviewScript } = await import('../src/ai')
    const text = JSON.stringify(review)
    generateContentStream.mockImplementationOnce(
      streamOf(piecesOf(text), {
        thoughts: [
          '**Reading the script**\n\nI am looking at the jokes.',
          ' Still the jokes.',
          '**Checking the sleep science**\n\nAdenosine is right.',
        ],
      }),
    )
    const thoughts: string[] = []
    const result = await reviewScript(
      { script, title: '', voice },
      { onPartial: () => {}, onThought: (line) => thoughts.push(line) },
    )
    expect(thoughts).toEqual(['Reading the script', 'Checking the sleep science'])
    generateContent.mockResolvedValueOnce({ text })
    expect(result).toEqual(await reviewScript({ script, title: '', voice }))
    // Thinking at the model's own level, with its summaries sent along.
    expect(generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({ includeThoughts: true })
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toBeUndefined()
  })
})

describe('streamed answers', () => {
  const packaging = {
    notes: [
      { level: 'fix', text: 'The title promises a fix the opening never mentions.' },
      { level: 'great', text: 'Thumbnail and title work together.' },
      { level: 'good', text: '' },
      { level: 'look', text: 'Medical wording may limit ads.' },
    ],
  }
  const packagingInput = {
    title: 'T',
    thumbnailText: '',
    thumbnailIdea: '',
    description: '',
    opening: '',
    audience: '',
  }

  it('start over cleanly when Gemini does, and end as the answer in one piece would', async () => {
    vi.useFakeTimers()
    const { reviewPackaging } = await import('../src/ai')
    const text = JSON.stringify(packaging)
    const pieces = piecesOf(text)
    generateContentStream
      .mockImplementationOnce(streamOf(pieces, { breakAt: pieces.length - 3 }))
      .mockImplementationOnce(streamOf(pieces))
    const events: string[] = []
    const notes = reviewPackaging(packagingInput, {
      onPartial: (partial) => events.push(`partial ${partial.length}`),
      onRestart: () => events.push('restart'),
    })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await notes
    const restart = events.indexOf('restart')
    expect(restart).toBeGreaterThan(0)
    expect(events.filter((e) => e === 'restart')).toHaveLength(1)
    // Shown again from nothing after the restart, up to the whole answer.
    expect(events[restart + 1]).toBe('partial 0')
    expect(events.at(-1)).toBe('partial 3')
    generateContent.mockResolvedValueOnce({ text })
    expect(result).toEqual(await reviewPackaging(packagingInput))
  })

  it('ask again when the answer runs past its length limit, as in one piece', async () => {
    vi.useFakeTimers()
    const { reviewPackaging } = await import('../src/ai')
    const pieces = piecesOf(JSON.stringify(packaging))
    generateContentStream
      .mockImplementationOnce(streamOf(pieces.slice(0, 5), { finish: 'MAX_TOKENS' }))
      .mockImplementationOnce(streamOf(pieces))
    const notes = reviewPackaging(packagingInput, { onPartial: () => {} })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await notes).toHaveLength(3)
    expect(generateContentStream).toHaveBeenCalledTimes(2)
  })

  it('fail as the answer in one piece would when it is not what was asked for', async () => {
    const { reviewPackaging } = await import('../src/ai')
    generateContentStream.mockImplementationOnce(streamOf(piecesOf('{"notes":"none"}')))
    await expect(reviewPackaging(packagingInput, { onPartial: () => {} })).rejects.toMatchObject({
      code: 'bad_output',
    })
    generateContentStream.mockImplementationOnce(streamOf(['{"notes":[', '{"level":"fix"']))
    await expect(reviewPackaging(packagingInput, { onPartial: () => {} })).rejects.toMatchObject({
      code: 'bad_output',
    })
  })

  it('ask for thought summaries only where Gemini thinks at length', async () => {
    const { reviewPackaging } = await import('../src/ai')
    generateContentStream.mockImplementationOnce(streamOf(piecesOf(JSON.stringify(packaging))))
    await reviewPackaging(packagingInput, { onPartial: () => {}, onThought: () => {} })
    expect(generateContentStream.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('log when the first words arrived', async () => {
    vi.stubEnv('VITEST', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { reviewPackaging } = await import('../src/ai')
    generateContentStream.mockImplementationOnce(streamOf(piecesOf(JSON.stringify(packaging))))
    await reviewPackaging(packagingInput, { onPartial: () => {} })
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^AI packaging review \(gemini-3\.8-flash\): \d+\.\d s, 1 try, first words after \d+\.\d s, 40 thinking \+ 900 written tokens$/,
      ),
    )
  })

  it('give the packaging notes one by one, as the review keeps them', async () => {
    const { reviewPackaging } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) => reviewPackaging(packagingInput, events),
      packaging,
    )
    expect(streamed).toEqual(plain)
    expect(plain).toHaveLength(3)
    growsInto(partials, plain)
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give the hook check part by part, replacing only the real opening', async () => {
    const { checkHook } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) => checkHook({ script, title: 'Tired', thumbnailText: '', voice, lessons: [] }, events),
      {
        score: 14,
        verdict: 'Strong start.',
        problems: ['A slow second line', ''],
        promise: { kept: false, note: 'The title is about mornings.' },
        replaces: 'It is basic biology.',
        openings: [
          { text: 'You hit snooze three times. Bad news.', why: 'Relatable.' },
          { text: 'Your brain is full of sleep glue.', why: 'Surprising.' },
          { text: '', why: 'Empty.' },
          { text: 'Ever wake up tired?', why: 'A question.' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain.score).toBe(10)
    expect(plain.replaces).toBe('Look at you right now, scrolling in the dark.')
    expect(plain.openings).toHaveLength(3)
    // The score shows before the openings are written, and each opening on its own.
    expect(partials.some((p) => p.score === 10 && p.openings === undefined)).toBe(true)
    growsInto(
      partials.filter((p) => p.openings).map((p) => p.openings ?? []),
      plain.openings,
    )
    for (const partial of partials) {
      for (const [key, value] of Object.entries(partial)) {
        if (!Array.isArray(value)) expect(value).toEqual(plain[key as keyof typeof plain])
      }
    }
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give post details as they are written, built as the final details are', async () => {
    const { writePostDetails } = await import('../src/ai')
    const input = {
      title: 'Sleep',
      topic: 'Why you wake up tired',
      audience: '',
      language: 'en',
      format: 'landscape' as const,
      duration: 200,
      script,
      scenes: [0, 40, 80, 120, 160].map((start, i) => ({ start, narration: `Scene ${i}` })),
      defaultTags: ['capybara', 'Sleep science'],
      descriptionFooter: 'New videos every week.',
    }
    const { plain, streamed, partials } = await bothWays((events) => writePostDetails(input, events), {
      titleOptions: ['  Why you wake up tired ', 'The 2 AM goblin', 'Sleep glue'],
      description: 'You slept eight hours. So why?\n\nHere is the biology.',
      tags: ['sleep', 'sleep science', 'tired'],
      hashtags: ['sleep', '#biology', '#tired'],
      chapterPicks: [
        { sceneIndex: 0, title: 'Intro' },
        { sceneIndex: 1, title: 'Adenosine' },
        { sceneIndex: 9, title: 'Nowhere' },
        { sceneIndex: 3, title: 'The fix' },
      ],
      thumbnailIdeas: ['A goblin in bed', 'An empty coffee cup'],
      thumbnailText: 'SO TIRED',
      comment: 'What wakes you up? ',
    })
    expect(streamed).toEqual(plain)
    expect(plain.description).toContain('Chapters\n0:00 Intro\n0:40 Adenosine\n2:00 The fix')
    growsInto(
      partials.filter((p) => p.titleOptions).map((p) => p.titleOptions ?? []),
      plain.titleOptions,
    )
    // The first title shows before the description is written.
    expect(partials.some((p) => p.titleOptions?.length === 1 && p.description === undefined)).toBe(true)
    // The description shows once written, and gains its chapters and hashtags as they are.
    const described = partials.filter((p) => p.description !== undefined)
    expect(described[0].description).toBe(
      'You slept eight hours. So why?\n\nHere is the biology.\n\nNew videos every week.',
    )
    for (const partial of partials) {
      for (const key of ['tags', 'hashtags', 'chapters', 'thumbnailText', 'comment'] as const) {
        if (partial[key] !== undefined) expect(partial[key]).toEqual(plain[key])
      }
    }
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give ideas one by one, no more than asked for', async () => {
    const { generateIdeas } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        generateIdeas(
          {
            niche: 'Capybaras',
            audience: '',
            tone: '',
            language: 'en',
            format: 'landscape',
            count: 3,
            direction: '',
            avoid: [],
            topTitles: [],
          },
          events,
        ),
      {
        ideas: [
          { title: 'Cappy wants pizza', angle: 'A' },
          { title: ' ', angle: 'Untitled' },
          { title: 'Cappy at the beach', angle: 'B' },
          { title: 'Cappy goes to space', angle: 'C' },
          { title: 'One too many', angle: 'D' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain.map((i) => i.title)).toEqual([
      'Cappy wants pizza',
      'Cappy at the beach',
      'Cappy goes to space',
    ])
    growsInto(partials, plain)
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give follow-up ideas one by one, never the hit itself', async () => {
    const { followUpIdeas } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        followUpIdeas(
          {
            niche: 'Capybaras',
            narration: '',
            language: 'en',
            format: 'landscape',
            video: {
              title: 'Cappy wants pizza',
              topic: '',
              opening: '',
              views: 9000,
              usual: 1000,
              watched: null,
              searches: [],
            },
            avoid: [],
          },
          events,
        ),
      {
        ideas: [
          { title: 'Cappy wants pizza', angle: 'Again' },
          { title: 'Cappy bakes bread', angle: 'A' },
          { title: 'Cappy opens a cafe', angle: 'B' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain.map((i) => i.title)).toEqual(['Cappy bakes bread', 'Cappy opens a cafe'])
    growsInto(partials, plain)
    expect(partials.at(-1)).toEqual(plain)
  })
})
