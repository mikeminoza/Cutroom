// Shorts made after posting, against real ffmpeg and local storage; Gemini's picks and the web
// app's answers are stubbed.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobPayload, JobResult } from '@cutroom/shared/protocol'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const pickShortMoments = vi.hoisted(() => vi.fn())
const createShort = vi.hoisted(() => vi.fn())
vi.mock('@cutroom/shared/ai', async (original) => ({
  ...(await original<typeof import('@cutroom/shared/ai')>()),
  hasGeminiKey: () => true,
  pickShortMoments,
}))
vi.mock('../src/api', () => ({ createShort }))

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-shorts-'))
process.env.STORAGE_DIR = path.join(temp, 'storage')

const { localPath } = await import('@cutroom/shared/storage')
const { runFfmpeg } = await import('../src/render/ffmpeg')
const { probeSeconds } = await import('../src/util')
const { makeShorts } = await import('../src/jobs/shorts')
type Ctx = Parameters<typeof makeShorts>[1]

const VOICE_KEY = 'projects/p1/voiceover/vo.mp3'

beforeAll(async () => {
  // Two minutes of tone stands in for the recorded voice-over.
  mkdirSync(path.dirname(localPath(VOICE_KEY)), { recursive: true })
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=120',
    '-c:a',
    'libmp3lame',
    localPath(VOICE_KEY),
  ])
})
afterAll(() => rmSync(temp, { recursive: true, force: true }))
beforeEach(() => {
  pickShortMoments.mockReset()
  createShort.mockReset()
  createShort.mockImplementation(async (_job: string, short: { newId: string }) => short.newId)
})

// Six 20-second scenes.
const scenes = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i}`,
  index: i,
  start: i * 20,
  end: i * 20 + 20,
  narration: `Cappy part ${i + 1}.`,
}))

function payload(project: Record<string, unknown> = {}): JobPayload {
  return {
    project: {
      id: 'p1',
      title: 'Cappy wants pizza',
      topic: 'Food',
      format: 'landscape',
      voiceoverUrl: `/api/files/${VOICE_KEY}`,
      voiceoverDuration: 120,
      transcript: null,
      ...project,
    },
    settings: { shorts: { count: 2, maxSeconds: 60 } },
    appUrl: 'http://localhost:3000',
  } as unknown as JobPayload
}

function context(data: JobResult) {
  const steps: { status: string; detail?: string }[] = []
  const warnings: string[] = []
  const ctx = {
    jobId: 'job-1',
    workDir: mkdtempSync(path.join(temp, 'work-')),
    signal: new AbortController().signal,
    data,
    current: null,
    async result(patch: JobResult) {
      Object.assign(data, patch)
    },
    async step(_key: string, status: string, detail?: string) {
      steps.push({ status, detail })
    },
    progress: Object.assign(() => {}, { flush() {} }),
    async waiting() {},
    finished: () => false,
    async warn(message: string) {
      warnings.push(message)
    },
  } as unknown as Ctx
  return { ctx, steps, warnings }
}

const picks = [
  { startIndex: 1, endIndex: 2, title: 'Cappy finds the fridge' },
  { startIndex: 4, endIndex: 5, title: 'Pizza time' },
]

describe('Shorts after posting', () => {
  it('cuts the voice-over for each moment and makes a Short draft from it', async () => {
    pickShortMoments.mockResolvedValue(picks)
    const data: JobResult = { youtubeVideoId: 'yt-1' }
    const { ctx, steps } = context(data)
    await makeShorts(payload(), ctx, scenes as JobPayload['scenes'], 'Cappy wants pizza')

    expect(pickShortMoments.mock.calls[0][0]).toMatchObject({ count: 2, maxSeconds: 60 })
    expect(createShort).toHaveBeenCalledTimes(2)
    const [, first] = createShort.mock.calls[0]
    expect(first).toMatchObject({ from: 1, to: 2, title: 'Cappy finds the fridge' })
    // Scenes 2-3 run from 20 s to 60 s: the clip is those 40 seconds.
    expect(first.voiceover.duration).toBeCloseTo(40, 1)
    const clip = localPath(`projects/${first.newId}/voiceover/short-voiceover.mp3`)
    expect(existsSync(clip)).toBe(true)
    expect(await probeSeconds(clip)).toBeCloseTo(40, 0)
    expect(data.shortIds).toHaveLength(2)
    expect(steps.at(-1)).toEqual({ status: 'done', detail: 'Made 2 Short drafts' })
  })

  it('carries on after a retry without asking Gemini again or repeating a Short', async () => {
    const data: JobResult = { youtubeVideoId: 'yt-1', shortPicks: picks, shortIds: ['made-before'] }
    const { ctx } = context(data)
    await makeShorts(payload(), ctx, scenes as JobPayload['scenes'], 'Cappy wants pizza')
    expect(pickShortMoments).not.toHaveBeenCalled()
    expect(createShort).toHaveBeenCalledTimes(1)
    expect(createShort.mock.calls[0][1]).toMatchObject({ title: 'Pizza time' })
    expect(data.shortIds).toEqual(['made-before', createShort.mock.calls[0][1].newId])
  })

  it('never fails the publish job, and skips what it cannot cut from', async () => {
    pickShortMoments.mockResolvedValue(picks)
    createShort.mockRejectedValue(new Error('The web app is unreachable'))
    const failing = context({ youtubeVideoId: 'yt-1' })
    await makeShorts(payload(), failing.ctx, scenes as JobPayload['scenes'], 'Cappy')
    expect(failing.steps.at(-1)?.status).toBe('skipped')
    expect(failing.warnings[0]).toMatch(/Shorts were not made: The web app is unreachable/)

    for (const [project, data, reason] of [
      [{ format: 'portrait' }, { youtubeVideoId: 'yt-1' }, 'already a Short'],
      [{}, {}, 'not posted'],
      [{ voiceoverDuration: 45 }, { youtubeVideoId: 'yt-1' }, 'too short'],
    ] as const) {
      const run = context({ ...data })
      await makeShorts(payload(project), run.ctx, scenes as JobPayload['scenes'], 'Cappy')
      expect(run.steps.at(-1)?.status).toBe('skipped')
      expect(run.steps.at(-1)?.detail).toContain(reason)
    }
  })
})
