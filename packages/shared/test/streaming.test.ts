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

/** `n` distinct words, starting with `label`. */
const words = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label}${i}.`).join(' ')
const board = { pace: 3, artStyle: 'Doodles', format: 'landscape' as const, characters: [] }
/** The part of the script a storyboard request is for, and its number. */
const partOf = (contents: unknown) => /"""\n([\s\S]*?)\n"""/.exec(String(contents))?.[1] ?? ''
const numberOf = (contents: unknown) => Number(/This is part (\d+)/.exec(String(contents))?.[1] ?? 1)
/** A storyboard answer for one part: its words copied exactly, in scenes of `size` words. */
function scenesFor(part: string, size = 50) {
  const all = part.split(/\s+/)
  const scenes = []
  for (let i = 0; i < all.length; i += size) {
    scenes.push({
      narration: all.slice(i, i + size).join(' '),
      visual: `Picture of ${all[i]}`,
      imagePrompt: 'A prompt',
      characters: [],
      shot: 'wide',
      motion: i === 0 ? 'drift' : 'pan-left',
      transition: 'whip',
      accent: 'zoom',
      accentWord: all[i + 1],
      onScreenText: '  Hi  ',
      notes: '',
    })
  }
  return { scenes }
}
/** Gemini storyboarding each part it's asked for, streamed in pieces of 40 characters. */
const storyboarding =
  (options: (number: number) => Parameters<typeof streamOf>[1] = () => ({})) =>
  async ({ contents }: { contents: unknown }) =>
    streamOf(piecesOf(JSON.stringify(scenesFor(partOf(contents))), 40), options(numberOf(contents)))()

describe('storyboards, as Gemini writes them', () => {
  const script = [words('a', 250), words('b', 250), words('c', 250)].join('\n\n')

  it('hand over scenes in script order, each part once the parts before it are done', async () => {
    const { splitScript } = await import('../src/ai')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Part 1 is the slow one: its last piece waits.
    generateContentStream.mockImplementation(storyboarding((number) => (number === 1 ? { gate } : {})))
    const lists: string[][] = []
    const splitting = splitScript(
      { ...board, script },
      { onPartial: (scenes) => lists.push(scenes.map((s) => s.narration)) },
    )
    await vi.waitFor(() => expect(lists.at(-1)).toHaveLength(4))
    await new Promise((resolve) => setTimeout(resolve, 30))
    // Parts 2 and 3 are written, but wait for part 1: the list only grows at its end.
    expect(generateContentStream).toHaveBeenCalledTimes(3)
    expect(lists.flat().some((narration) => !narration.startsWith('a'))).toBe(false)
    release()
    const scenes = await splitting
    expect(scenes).toHaveLength(15)
    growsInto(
      lists,
      scenes.map((s) => s.narration),
    )
    expect(lists.at(-1)).toEqual(scenes.map((s) => s.narration))

    // The same scenes as the storyboard in one piece, tidied the same way.
    generateContent.mockImplementation(async ({ contents }: { contents: unknown }) => ({
      text: JSON.stringify(scenesFor(partOf(contents))),
    }))
    expect(await splitScript({ ...board, script })).toEqual(scenes)
    expect(scenes[0]).toMatchObject({ motion: 'zoom-in', transition: 'whip', onScreenText: 'Hi' })
  })

  it('take back the scenes of a part Gemini starts over, and end the same', async () => {
    vi.useFakeTimers()
    const { splitScript } = await import('../src/ai')
    let broke = false
    generateContentStream.mockImplementation(async ({ contents }: { contents: unknown }) => {
      const pieces = piecesOf(JSON.stringify(scenesFor(partOf(contents))), 40)
      if (numberOf(contents) === 1 && !broke) {
        broke = true
        return streamOf(pieces, { breakAt: Math.floor(pieces.length * 0.6) })()
      }
      return streamOf(pieces)()
    })
    const lengths: number[] = []
    const splitting = splitScript(
      { ...board, script },
      { onPartial: (scenes) => lengths.push(scenes.length) },
    )
    await vi.advanceTimersByTimeAsync(5000)
    const scenes = await splitting
    expect(scenes).toHaveLength(15)
    expect(lengths.some((n, i) => i > 0 && n < lengths[i - 1])).toBe(true)
    expect(lengths.at(-1)).toBe(15)
  })

  it('hand over the scenes of Write with AI in order as its parts are storyboarded', async () => {
    const { draftScript } = await import('../src/ai')
    const [p1, p2] = [words('a', 200), words('b', 200)]
    generateContentStream.mockImplementation(
      async (request: { contents: unknown; config: { responseMimeType?: string } }) =>
        request.config.responseMimeType === 'application/json'
          ? storyboarding()(request)
          : streamOf(['Why you wake up tired\n\n', `${p1}\n\n`, p2])(),
    )
    const lists: string[][] = []
    const draft = await draftScript(
      { topic: 'Sleep', audience: '', tone: '', language: 'en', minutes: 3, format: 'landscape' },
      board,
      { onScenes: (scenes) => lists.push(scenes.map((s) => s.narration)) },
    )
    expect(draft.scenes).toHaveLength(8)
    growsInto(lists, draft.scenes?.map((s) => s.narration) ?? [])
    expect(lists.at(-1)).toEqual(draft.scenes?.map((s) => s.narration))
  })
})

describe('backgrounds and poses for scenes, as Gemini picks them', () => {
  const library = {
    backgrounds: ['Kitchen', 'Park'],
    characters: [{ name: 'Cappy', poses: ['happy', 'sad'] }],
  }
  const scenesOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ narration: `Line ${i}`, visual: i % 2 ? `Picture ${i}` : '' }))
  const pick = (sceneIndex: number, background = 'kitchen') => ({
    sceneIndex,
    background,
    character: 'cappy',
    pose: sceneIndex % 2 ? 'Sad' : 'happy',
    side: 'left',
  })

  it('give each scene its pick as soon as it is written, as the whole answer would', async () => {
    const { pickSceneLayers } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) => pickSceneLayers({ ...library, scenes: scenesOf(5) }, events),
      { scenes: [pick(0), pick(1, 'Moon'), pick(0, 'Park'), pick(3), pick(2)] },
    )
    expect(streamed).toEqual(plain)
    expect(plain[0]).toEqual({ background: 'Kitchen', character: 'Cappy', pose: 'happy', side: 'left' })
    expect(plain[1]).toEqual({ background: '', character: 'Cappy', pose: 'sad', side: 'left' })
    expect(plain[4]).toEqual({ background: '', character: '', pose: '', side: 'center' })
    // Each scene's pick, once there, is the final one; a scene Gemini left out has none.
    expect(partials.some((p) => p[0] !== null && p[3] === null)).toBe(true)
    for (const partial of partials) {
      expect(partial).toHaveLength(5)
      partial.forEach((one, i) => {
        if (one) expect(one).toEqual(plain[i])
      })
    }
    expect(partials.at(-1)?.slice(0, 4)).toEqual(plain.slice(0, 4))
    expect(partials.at(-1)?.[4]).toBeNull()
    expect(generateContent.mock.calls[0][0].model).toMatch(/lite/)
  })

  it('split a long video into parts side by side, each knowing the scenes just before it', async () => {
    const { pickSceneLayers } = await import('../src/ai')
    const scenes = scenesOf(70)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    generateContent.mockImplementation(async ({ contents }: { contents: unknown }) => {
      await gate
      const listed = [...String(contents).matchAll(/^\[(\d+)\] Line (\d+)/gm)]
      const background = listed.some((m) => m[2] === '0') ? 'Kitchen' : 'Park'
      return { text: JSON.stringify({ scenes: listed.map((m) => pick(Number(m[1]), background)) }) }
    })
    const picking = pickSceneLayers({ ...library, scenes })
    // Both parts asked at once.
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(2))
    release()
    const picks = await picking
    expect(picks.map((p) => p.background)).toEqual([...Array(35).fill('Kitchen'), ...Array(35).fill('Park')])
    const [first, second] = generateContent.mock.calls.map(([request]) => String(request.contents))
    expect(first).toContain('[34] Line 34')
    expect(first).not.toContain('Line 35')
    expect(second).toContain('[0] Line 35')
    // The end of part one as context, for continuity, without numbers to pick for.
    expect(second).toContain('- Line 32')
    expect(second).toContain('- Line 34')
    expect(second).not.toContain('[34] Line 34')

    // A short video stays one call.
    generateContent.mockClear()
    await pickSceneLayers({ ...library, scenes: scenesOf(60) })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })
})

/** Every field `partial` has, it has as `final` does. */
function fieldsFrom(partial: object, final: object) {
  for (const [key, value] of Object.entries(partial)) {
    if (!Array.isArray(value)) expect(value).toEqual(final[key as keyof typeof final])
  }
}

describe('more answers, as Gemini writes them', () => {
  it('give pose suggestions one by one, never one the character has', async () => {
    const { suggestPoses } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        suggestPoses(
          {
            character: { name: 'Cappy', description: 'A capybara' },
            artStyle: 'Doodles',
            niche: 'Sleep facts',
            have: ['Happy'],
            scripts: ['Cappy yawns. Cappy is shocked.'],
          },
          events,
        ),
      {
        poses: [
          { name: 'yawning', why: 'Script 1 yawns.', prompt: 'Cappy yawning' },
          { name: 'happy', why: 'Again.', prompt: 'Cappy happy' },
          { name: ' shocked ', why: 'A twist.', prompt: 'Cappy shocked' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain.map((p) => p.name)).toEqual(['yawning', 'shocked'])
    growsInto(partials, plain)
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give a learned channel style field by field, its ideas one by one', async () => {
    const { learnChannelStyle } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        learnChannelStyle(
          {
            reference: { title: 'Ref', description: '', videos: [] },
            thumbnails: [],
            character: { name: 'Cappy', description: '' },
            audience: '',
          },
          events,
        ),
      {
        description: ' Sleep science with Cappy. ',
        narration: 'Dry and quick.',
        audience: 'Adults',
        tone: 'Funny',
        artStyle: 'Doodles',
        pace: 4,
        ideas: [
          { title: 'Why you yawn', angle: 'A' },
          { title: ' ', angle: 'Untitled' },
          { title: 'Why naps hurt', angle: 'B' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain).toMatchObject({ description: 'Sleep science with Cappy.', pace: 4 })
    expect(partials.some((p) => p.description !== undefined && p.ideas === undefined)).toBe(true)
    for (const partial of partials) fieldsFrom(partial, plain)
    growsInto(
      partials.filter((p) => p.ideas).map((p) => p.ideas ?? []),
      plain.ideas,
    )
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give the channel setup part by part, each as the whole draft keeps it', async () => {
    const { suggestChannelSetup } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        suggestChannelSetup(
          {
            channel: 'Cappy Sleeps',
            niche: 'Sleep science',
            narration: '',
            audience: '',
            tone: '',
            market: 'US',
            targetMinutes: 6,
            schedule: '',
            uploads: [{ id: 'v2', title: 'Cappy tries to sleep', seconds: 75, views: 3000 }],
          },
          events,
        ),
      {
        description: ' Funny sleep science. ',
        keywords: ['sleep science', 'Sleep Science'],
        tags: ['#capybara'],
        subscribeLine: 'Subscribe.',
        category: { id: '22', why: '' },
        madeForKids: { value: false, why: 'Adults.' },
        cadence: { perWeek: 3, why: 'Fine.' },
        trailer: { id: 'v2', why: 'Typical.' },
        audience: { text: 'US adults', why: 'Specific.' },
        length: { minutes: 9.4, why: 'Ads.' },
        pillars: ['1. Myths'],
        rules: ['Hook first'],
        monetization: { rates: 'high', why: 'Pays.', risks: [] },
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain).toMatchObject({ category: { id: '27' }, length: { minutes: 9 } })
    expect(partials.some((p) => p.description !== undefined && p.monetization === undefined)).toBe(true)
    for (const partial of partials) fieldsFrom(partial, plain)
    expect(partials.at(-1)).toEqual(plain)
  })

  it('give translations one language at a time, from calls side by side', async () => {
    const { translatePost } = await import('../src/ai')
    const to = ['de', 'fr', 'es', 'it', 'nl', 'pt']
    const answer = (contents: unknown) => ({
      translations: to
        .filter((code) => String(contents).includes(`${code} (`))
        .map((language) => ({ language, title: ` Title ${language} `, description: `Text ${language}` })),
    })
    const input = { title: 'Sleep', description: 'About sleep', from: 'en', to }
    generateContent.mockImplementation(async ({ contents }: { contents: unknown }) => ({
      text: JSON.stringify(answer(contents)),
    }))
    const plain = await translatePost(input)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // The first call (four languages) is slow: the second call's languages show first.
    generateContentStream.mockImplementation(async ({ contents }: { contents: unknown }) =>
      streamOf(
        piecesOf(JSON.stringify(answer(contents)), 30),
        String(contents).includes('de (') ? { gate } : {},
      )(),
    )
    const partials: string[][] = []
    const translating = translatePost(input, {
      onPartial: (list) => partials.push(list.map((t) => t.language)),
    })
    await vi.waitFor(() => expect(partials.at(-1)).toEqual(expect.arrayContaining(['nl', 'pt'])))
    expect(partials.at(-1)).not.toContain('it')
    release()
    const streamed = await translating
    expect(streamed).toEqual(plain)
    expect(plain.map((t) => t.language)).toEqual(to)
    expect(partials.at(-1)).toEqual(to)
    // A language shown is never taken back.
    for (const [i, list] of partials.entries()) {
      if (i > 0) expect(list).toEqual(expect.arrayContaining(partials[i - 1]))
    }
  })

  it('give reply drafts comment by comment, as the whole answer keeps them', async () => {
    const { draftReplies } = await import('../src/ai')
    const { plain, streamed, partials } = await bothWays(
      (events) =>
        draftReplies(
          {
            channel: 'Body Facts',
            niche: '',
            narration: '',
            language: 'en',
            video: { title: 'Why 3 AM', topic: '', script: '' },
            comments: [
              { author: '@sam', text: 'Is it the liver?' },
              { author: '@bot', text: 'spam' },
              { author: '@kim', text: 'Great!' },
            ],
          },
          events,
        ),
      {
        replies: [
          { comment: 2, action: 'reply', text: 'Thanks, Kim! www.example.com', why: '' },
          { comment: 1, action: 'skip', text: '', why: 'Spam.' },
          { comment: 2, action: 'skip', text: '', why: 'A second answer.' },
          { comment: 0, action: 'reply', text: ' Partly! ', why: '' },
        ],
      },
    )
    expect(streamed).toEqual(plain)
    expect(plain).toEqual([{ reply: 'Partly!' }, { skip: 'Spam.' }, { reply: 'Thanks, Kim!' }])
    expect(partials.some((p) => p[2] !== null && p[0] === null)).toBe(true)
    for (const partial of partials) {
      partial.forEach((draft, i) => {
        if (draft) expect(draft).toEqual(plain[i])
      })
    }
    expect(partials.at(-1)).toEqual(plain)
  })
})
