// Subtitles in the video's other languages, added after the main captions. Gemini's translation
// and YouTube's caption upload are stubbed; the SRT files are real.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobPayload, JobResult } from '@cutroom/shared/protocol'
import { EMPTY_POST, type PostDetails } from '@cutroom/shared/types'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const translateCaptions = vi.hoisted(() => vi.fn())
const uploadCaptions = vi.hoisted(() => vi.fn())
vi.mock('@cutroom/shared/ai', async (original) => ({
  ...(await original<typeof import('@cutroom/shared/ai')>()),
  translateCaptions,
}))
vi.mock('@cutroom/shared/google', async (original) => ({
  ...(await original<typeof import('@cutroom/shared/google')>()),
  clientFromRefresh: () => ({}),
  uploadCaptions,
}))
vi.mock('../src/api', () => ({ nextSlot: vi.fn(), createShort: vi.fn() }))

const { AiError } = await import('@cutroom/shared/ai')
const { parseSrt, toSrt, wordsFromScenes } = await import('@cutroom/shared/captions')
const { runPublish } = await import('../src/jobs/publish')
const { addSubtitles } = await import('../src/jobs/subtitles')
type Ctx = Parameters<typeof addSubtitles>[1]

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-subtitles-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

const MAIN_SRT = toSrt(
  wordsFromScenes([
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
  ]),
)
const MAIN_CUES = parseSrt(MAIN_SRT).map((cue) => cue.text)
const times = (srt: string) => srt.split('\n').filter((line) => line.includes(' --> '))

const translation = (language: string) => ({ language, title: `Title in ${language}`, description: '' })
const post = (languages: string[], over: Partial<PostDetails> = {}): PostDetails => ({
  ...EMPTY_POST,
  title: 'Why you wake up at 3 AM',
  language: 'en',
  translations: languages.map(translation),
  ...over,
})

/** Every language asked for comes back with each cue translated. */
const translatedLine = (language: string, cue: string) => `[${language}] ${cue}`
const translateAll = () =>
  translateCaptions.mockImplementation(async ({ cues, to }: { cues: string[]; to: string[] }) =>
    to.map((language) => ({ language, cues: cues.map((cue) => translatedLine(language, cue)) })),
  )

let uploads: { language: string; srt: string }[] = []
beforeEach(() => {
  translateCaptions.mockReset()
  uploadCaptions.mockReset()
  uploads = []
  uploadCaptions.mockImplementation(
    async (_client: unknown, _video: string, file: string, language: string) => {
      uploads.push({ language, srt: readFileSync(file, 'utf8') })
    },
  )
})

function context(data: JobResult = {}, finished: (key: string) => boolean = () => false) {
  const steps: { key: string; status: string; detail?: string }[] = []
  const warnings: string[] = []
  const workDir = mkdtempSync(path.join(temp, 'work-'))
  writeFileSync(path.join(workDir, 'captions.srt'), MAIN_SRT)
  const ctx = {
    jobId: 'job-1',
    workDir,
    signal: new AbortController().signal,
    data,
    current: null,
    async result(patch: JobResult) {
      Object.assign(data, patch)
    },
    async step(key: string, status: string, detail?: string) {
      steps.push({ key, status, detail })
    },
    progress: Object.assign(() => {}, { flush() {} }),
    async waiting() {},
    finished,
    async warn(message: string) {
      warnings.push(message)
    },
  } as unknown as Ctx
  return { ctx, steps, warnings, srtFile: path.join(workDir, 'captions.srt') }
}

const add = (ctx: Ctx, srtFile: string, details: PostDetails, enabled = true) =>
  addSubtitles({ youtube: {} as never, videoId: 'yt-1', srtFile, post: details, enabled }, ctx)

describe('subtitles in other languages', () => {
  it('adds each language as a track of its own, on exactly the times of the main captions', async () => {
    translateAll()
    const { ctx, srtFile, warnings } = context({ captionTracks: ['en'] })
    expect(await add(ctx, srtFile, post(['es', 'pt']))).toEqual(['es', 'pt'])

    expect(translateCaptions).toHaveBeenCalledTimes(1)
    expect(translateCaptions.mock.calls[0][0]).toMatchObject({
      cues: MAIN_CUES,
      from: 'en',
      to: ['es', 'pt'],
    })
    expect(uploads.map((u) => u.language)).toEqual(['es', 'pt'])
    for (const upload of uploads) {
      expect(times(upload.srt)).toEqual(times(MAIN_SRT))
      expect(parseSrt(upload.srt).map((cue) => cue.text)).toEqual(
        MAIN_CUES.map((cue) => translatedLine(upload.language, cue)),
      )
    }
    // Kept, so a retry adds neither again.
    expect(ctx.data.captionTracks).toEqual(['en', 'es', 'pt'])
    expect(warnings).toEqual([])
  })

  it('adds two languages at most, the most-watched first, to keep YouTube’s quota for uploads', async () => {
    translateAll()
    const { ctx, srtFile } = context({ captionTracks: ['en'] })
    expect(await add(ctx, srtFile, post(['fr', 'de', 'hi', 'pt', 'es']))).toEqual(['es', 'pt'])
    expect(translateCaptions.mock.calls[0][0].to).toEqual(['es', 'pt'])
    expect(uploadCaptions).toHaveBeenCalledTimes(2)
  })

  it('skips a language whose translation did not line up, with a warning, and adds the rest', async () => {
    translateCaptions.mockResolvedValueOnce([
      { language: 'es', error: "Gemini's translation didn't line up with the captions." },
      { language: 'pt', cues: MAIN_CUES.map((cue) => translatedLine('pt', cue)) },
    ])
    const { ctx, srtFile, warnings } = context({ captionTracks: ['en'] })
    expect(await add(ctx, srtFile, post(['es', 'pt']))).toEqual(['pt'])
    expect(uploads.map((u) => u.language)).toEqual(['pt'])
    expect(warnings).toEqual([
      "Subtitles in Spanish not added: Gemini's translation didn't line up with the captions.",
    ])
  })

  it('turns Gemini and YouTube failures into warnings', async () => {
    translateCaptions.mockRejectedValueOnce(new Error('Gemini is busy right now. Try again in a minute.'))
    const gemini = context({ captionTracks: ['en'] })
    expect(await add(gemini.ctx, gemini.srtFile, post(['es', 'pt']))).toEqual([])
    expect(gemini.warnings).toEqual([
      'Subtitles in Spanish and Portuguese not added: Gemini is busy right now. Try again in a minute.',
    ])

    translateAll()
    uploadCaptions.mockRejectedValueOnce(
      Object.assign(new Error('Quota'), { errors: [{ reason: 'quotaExceeded' }] }),
    )
    const youtube = context({ captionTracks: ['en'] })
    expect(await add(youtube.ctx, youtube.srtFile, post(['es', 'pt']))).toEqual(['pt'])
    expect(youtube.warnings).toEqual([
      "Subtitles in Spanish not added: The YouTube API's free daily quota is used up. It resets at midnight Pacific time; click Retry after that.",
    ])
  })

  it('does nothing when turned off in Settings, or with no other languages', async () => {
    translateAll()
    const off = context({ captionTracks: ['en'] })
    expect(await add(off.ctx, off.srtFile, post(['es', 'pt']), false)).toEqual([])
    const none = context({ captionTracks: ['en'] })
    expect(await add(none.ctx, none.srtFile, post([]))).toEqual([])
    expect(translateCaptions).not.toHaveBeenCalled()
    expect(uploadCaptions).not.toHaveBeenCalled()
  })

  it('adds no language twice when the step runs again', async () => {
    translateAll()
    const { ctx, srtFile } = context({ captionTracks: ['en', 'es'] })
    expect(await add(ctx, srtFile, post(['es', 'pt']))).toEqual(['es', 'pt'])
    expect(translateCaptions.mock.calls[0][0].to).toEqual(['pt'])
    expect(uploads.map((u) => u.language)).toEqual(['pt'])

    translateCaptions.mockClear()
    const again = context({ captionTracks: ['en', 'es', 'pt'] })
    expect(await add(again.ctx, again.srtFile, post(['es', 'pt']))).toEqual(['es', 'pt'])
    expect(translateCaptions).not.toHaveBeenCalled()
  })
})

describe('the publish job with subtitles', () => {
  /** A job whose every step is done but the last ones on YouTube: thumbnail, captions, playlist. */
  function publish(
    details: PostDetails,
    settings = { translateTo: ['es', 'pt'], translatedSubtitles: true },
  ) {
    const payload = {
      job: { id: 'job-1', type: 'publish', steps: [], result: {}, approved: true },
      project: { id: 'p1', title: 'Why you wake up at 3 AM', thumbnailUrl: null, post: details },
      scenes: [],
      characters: [],
      settings: { defaults: settings },
      google: { youtubeRefreshToken: 'token', driveRefreshToken: null },
      insights: { topTitles: [] },
      appUrl: 'http://localhost:3000',
    } as unknown as JobPayload
    const data: JobResult = {
      youtubeVideoId: 'yt-1',
      srtUrl: '/api/files/projects/p1/captions.srt',
      post: details,
    }
    return { payload, ...context(data, (key) => key !== 'finish') }
  }

  it('adds the main captions first, then the subtitles', async () => {
    translateAll()
    const job = publish(post(['es', 'pt']))
    expect(await runPublish(job.payload, job.ctx)).toBe('done')
    expect(uploads.map((u) => u.language)).toEqual(['en', 'es', 'pt'])
    expect(uploads[0].srt).toBe(MAIN_SRT)
    expect(job.steps.at(-1)).toEqual({
      key: 'finish',
      status: 'done',
      detail: 'Added captions, subtitles in Spanish and Portuguese',
    })
  })

  it('still posts when the subtitles fail', async () => {
    translateCaptions.mockRejectedValue(
      new AiError("Gemini's free daily limit is used up. It resets at midnight Pacific time.", 'daily_limit'),
    )
    const job = publish(post(['es', 'pt']))
    expect(await runPublish(job.payload, job.ctx)).toBe('done')
    expect(uploads.map((u) => u.language)).toEqual(['en'])
    expect(job.warnings).toEqual([
      "Subtitles in Spanish and Portuguese not added: Gemini's free daily limit is used up. It resets at midnight Pacific time.",
    ])
    expect(job.steps.at(-1)).toEqual({ key: 'finish', status: 'done', detail: 'Added captions' })
  })

  it('tries no subtitles when the main captions could not be added', async () => {
    translateAll()
    uploadCaptions.mockRejectedValueOnce(new Error('The caption track already exists'))
    const job = publish(post(['es', 'pt']))
    expect(await runPublish(job.payload, job.ctx)).toBe('done')
    expect(translateCaptions).not.toHaveBeenCalled()
    expect(job.warnings).toEqual(['Captions not added: The caption track already exists'])
  })

  it('leaves the subtitles out when Settings turns them off', async () => {
    translateAll()
    const job = publish(post(['es', 'pt']), { translateTo: ['es', 'pt'], translatedSubtitles: false })
    expect(await runPublish(job.payload, job.ctx)).toBe('done')
    expect(uploads.map((u) => u.language)).toEqual(['en'])
    expect(translateCaptions).not.toHaveBeenCalled()
  })
})
