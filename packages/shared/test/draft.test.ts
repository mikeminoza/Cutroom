import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/** `n` distinct words, starting with `label`. */
const words = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label}${i}.`).join(' ')

const brief = {
  topic: 'Sleep',
  audience: '',
  tone: '',
  language: 'en',
  minutes: 3,
  format: 'landscape' as const,
}
const board = { pace: 3, artStyle: 'Doodles', format: 'landscape' as const, characters: [] }

/**
 * Gemini's streamed answer, in `chunks`: it waits for `gate` before the last chunk, or breaks
 * with a 503 before chunk `breakAt`. The last chunk says why it stopped and what it used.
 */
function streamOf(
  chunks: string[],
  options: { gate?: Promise<void>; breakAt?: number; finish?: string } = {},
) {
  return async () =>
    (async function* () {
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

/** Storyboards a part as one scene, copying its words exactly. */
const storyboardPart = ({ contents }: { contents: string }) => {
  const part = /"""\n([\s\S]*?)\n"""/.exec(String(contents))?.[1] ?? ''
  return Promise.resolve({
    text: JSON.stringify({
      scenes: [
        {
          narration: part,
          visual: 'A picture',
          imagePrompt: 'A prompt',
          characters: [],
          shot: 'wide',
          motion: 'zoom-in',
        },
      ],
    }),
  })
}
const promptOf = (call: number) => String(generateContent.mock.calls[call][0].contents)

describe('cutting a script into parts as it is written', () => {
  it('makes the same parts as cutting the whole script at once', async () => {
    const { partCutter, scriptParts } = await import('../src/ai')
    const paragraphs = [words('a', 120), words('b', 200), words('c', 90), words('d', 600), words('e', 30)]
    const parts: string[] = []
    const cutter = partCutter(260, (part) => parts.push(part))
    for (const paragraph of paragraphs) cutter.add(paragraph)
    cutter.end()
    expect(parts).toEqual(scriptParts(paragraphs.join('\n\n'), 260))
  })
})

describe('the title line', () => {
  it('is the first line, without "Title:", quotes or markdown, with the script after it', async () => {
    const { titleAndScript } = await import('../src/ai')
    expect(titleAndScript('Why you wake up tired\n\nLook at you.')).toEqual({
      title: 'Why you wake up tired',
      script: 'Look at you.',
    })
    expect(titleAndScript('Title: **“Why you wake up tired”**\nLook at you.')?.title).toBe(
      'Why you wake up tired',
    )
    expect(titleAndScript('# Why you wake up tired\n\nLook at you.')?.title).toBe('Why you wake up tired')
    // Not known until the first line ends.
    expect(titleAndScript('Why you wa')).toBeNull()
    // A first line far too long for a title is the script's own.
    const opening = words('x', 40)
    expect(titleAndScript(`${opening}\n\nMore.`)).toEqual({ title: '', script: `${opening}\n\nMore.` })
  })
})

describe('writing a script live', () => {
  it('storyboards each part while the rest of the script is still being written', async () => {
    const { draftScript } = await import('../src/ai')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const [p1, p2, p3] = [words('a', 150), words('b', 150), words('c', 100)]
    generateContentStream.mockImplementationOnce(
      streamOf(['Why you wake up tired\n\n', `${p1}\n\n`, `${p2}\n\n`, p3], { gate }),
    )
    generateContent.mockImplementation(storyboardPart)
    const added: string[] = []
    const titles: string[] = []
    const parts: [number, number][] = []
    const drafting = draftScript(brief, board, {
      onText: (add) => added.push(add),
      onTitle: (title) => titles.push(title),
      onPart: (done, started) => parts.push([done, started]),
    })
    // The second paragraph is finished while the third is still coming: the first part (the first
    // paragraph) is already being storyboarded.
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1))
    expect(promptOf(0)).toContain('This is part 1 of one script')
    expect(promptOf(0)).not.toContain('closing scene')
    release()
    const draft = await drafting
    expect(draft.title).toBe('Why you wake up tired')
    expect(draft.script).toBe([p1, p2, p3].join('\n\n'))
    expect(added.join('')).toBe(draft.script)
    expect(titles).toEqual(['Why you wake up tired'])
    expect(draft.scenes?.map((scene) => scene.narration)).toEqual([p1, `${p2}\n\n${p3}`])
    expect(promptOf(1)).toContain('or the closing scene')
    expect(parts.at(-1)).toEqual([2, 2])
    expect(draft.storyboardError).toBeNull()
    // The script is plain text with its own length limit, not JSON.
    const request = generateContentStream.mock.calls[0][0]
    expect(request.config.responseMimeType).toBeUndefined()
    expect(request.config.maxOutputTokens).toBeGreaterThan(0)
  })

  it('starts over when the stream breaks, dropping the parts it had begun', async () => {
    vi.useFakeTimers()
    const { draftScript } = await import('../src/ai')
    const [p1, p2] = [words('a', 200), words('b', 200)]
    generateContentStream
      .mockImplementationOnce(streamOf(['Title\n\n', `${p1}\n\n`, `${p2}\n\n`, 'never sent'], { breakAt: 3 }))
      .mockImplementationOnce(streamOf(['Title\n\n', `${p1}\n\n`, p2]))
    generateContent.mockImplementation(storyboardPart)
    let restarts = 0
    const drafting = draftScript(brief, board, { onRestart: () => restarts++ })
    await vi.advanceTimersByTimeAsync(5000)
    const draft = await drafting
    expect(restarts).toBe(1)
    expect(draft.script).toBe(`${p1}\n\n${p2}`)
    expect(draft.scenes?.map((scene) => scene.narration)).toEqual([p1, p2])
  })

  it('keeps the script when storyboarding fails, and says why', async () => {
    const { draftScript } = await import('../src/ai')
    const p1 = words('a', 50)
    generateContentStream.mockImplementationOnce(streamOf(['Title\n\n', p1]))
    generateContent.mockRejectedValue(Object.assign(new Error('{"error":{"code":400}}'), { status: 400 }))
    const draft = await draftScript(brief, board, {})
    expect(draft).toMatchObject({ title: 'Title', script: p1, scenes: null })
    expect(draft.storyboardError).toMatch(/Gemini request failed/)
  })

  it('asks again when the script runs past its length limit', async () => {
    vi.useFakeTimers()
    const { draftScript } = await import('../src/ai')
    const p1 = words('a', 50)
    generateContentStream
      .mockImplementationOnce(streamOf(['Title\n\n', `${p1} ${p1}`], { finish: 'MAX_TOKENS' }))
      .mockImplementationOnce(streamOf(['Title\n\n', p1]))
    generateContent.mockImplementation(storyboardPart)
    const drafting = draftScript(brief, board, {})
    await vi.advanceTimersByTimeAsync(5000)
    expect((await drafting).script).toBe(p1)
    expect(generateContentStream).toHaveBeenCalledTimes(2)
  })
})

describe('timing each AI call', () => {
  it('logs how long it took, how many tries, and what Gemini thought and wrote', async () => {
    vi.stubEnv('VITEST', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { generateIdeas } = await import('../src/ai')
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ ideas: [{ title: 'Cappy wants pizza', angle: 'A' }] }),
      usageMetadata: { thoughtsTokenCount: 120, candidatesTokenCount: 80 },
    })
    await generateIdeas({
      niche: 'Capybaras',
      audience: '',
      tone: '',
      language: 'en',
      format: 'landscape',
      count: 1,
      direction: '',
      avoid: [],
      topTitles: [],
    })
    expect(info).toHaveBeenCalledWith(
      expect.stringMatching(
        /^AI ideas \(gemini-3\.8-flash\): \d+\.\d s, 1 try, 120 thinking \+ 80 written tokens$/,
      ),
    )
  })
})
