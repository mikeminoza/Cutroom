// The AI voice-over job against real ffmpeg and local storage, with Gemini stubbed: free-tier
// limits are waited out or explained, and a retry carries on from the last finished part.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { JobPayload, JobResult } from '@cutroom/shared/protocol'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const synthesizeSpeech = vi.hoisted(() => vi.fn())
vi.mock('@cutroom/shared/ai', async (original) => ({
  ...(await original<typeof import('@cutroom/shared/ai')>()),
  synthesizeSpeech,
}))

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-voice-'))
process.env.STORAGE_DIR = path.join(temp, 'storage')

const { AiError } = await import('@cutroom/shared/ai')
const { localPath } = await import('@cutroom/shared/storage')
const { patiently, runVoice } = await import('../src/jobs/voice')
type Ctx = Parameters<typeof runVoice>[1]

afterAll(() => rmSync(temp, { recursive: true, force: true }))
beforeEach(() => synthesizeSpeech.mockReset())

/** Half a second of silent 24 kHz PCM, as Gemini sends it. */
const speech = () => ({ data: Buffer.alloc(24_000), mimeType: 'audio/L16;codec=pcm;rate=24000' })

function payload(): JobPayload {
  // Two scenes of 1,000 characters: two parts, since a Gemini part holds at most 1,500.
  const line = (word: string) => `${`${word} `.repeat(Math.floor(990 / (word.length + 1)))}${word}.`
  return {
    job: {
      id: 'job-1',
      type: 'voice',
      status: 'running',
      steps: [],
      result: {},
      attempts: 0,
      approved: false,
    },
    project: { id: 'project-1', script: '', voice: { provider: 'gemini', voice: 'Kore', style: '' } },
    scenes: [
      { id: 'a', index: 0, start: 0, end: 1, narration: line('Capybara') },
      { id: 'b', index: 1, start: 1, end: 2, narration: line('Snack') },
    ],
    settings: { voice: { provider: 'gemini', voice: 'Kore', style: '' } },
    appUrl: 'http://localhost:3000',
  } as unknown as JobPayload
}

function context(data: JobResult): Ctx {
  const done = new Set<string>()
  const progress = Object.assign(() => {}, { flush() {} })
  return {
    jobId: 'job-1',
    workDir: mkdtempSync(path.join(temp, 'work-')),
    signal: new AbortController().signal,
    data,
    current: null,
    async result(patch) {
      Object.assign(data, patch)
    },
    async step(key, status) {
      if (status === 'done' || status === 'skipped') done.add(key)
    },
    progress,
    async waiting() {},
    finished: (key) => done.has(key),
    async warn() {},
  }
}

describe('AI voice-over on the free tier', () => {
  it('stops on the daily limit with a way forward, then a retry records only the missing part', async () => {
    synthesizeSpeech
      .mockResolvedValueOnce(speech())
      .mockRejectedValueOnce(new AiError("Gemini's free daily limit is used up.", 'daily_limit'))
    const data: JobResult = {}
    await expect(runVoice(payload(), context(data))).rejects.toThrow(/Upload your own recording/)
    expect(data.voiceParts).toHaveLength(1)
    const kept = data.voiceParts?.[0]
    expect(kept?.key.startsWith('projects/project-1/voiceover/parts/')).toBe(true)
    expect(existsSync(localPath(kept?.key ?? ''))).toBe(true)

    // Retry: part 1 comes from storage, only part 2 is asked of Gemini.
    synthesizeSpeech.mockResolvedValueOnce(speech())
    await runVoice(payload(), context(data))
    expect(synthesizeSpeech).toHaveBeenCalledTimes(3)
    expect(String(synthesizeSpeech.mock.calls[2][0])).toMatch(/^Snack/)
    expect(data.voiceover?.duration).toBeGreaterThan(1)
    expect(data.transcript?.words.length).toBeGreaterThan(0)
    // The joined voice-over is saved, so the parts are gone.
    expect(data.voiceParts).toEqual([])
    expect(existsSync(localPath(kept?.key ?? ''))).toBe(false)
  })

  it('waits out the per-minute limit instead of failing', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new AiError('limit', 'rate_limited'))
      .mockRejectedValueOnce(new AiError('limit', 'rate_limited'))
      .mockResolvedValueOnce('recorded')
    const waits: number[] = []
    const result = await patiently(run, new AbortController().signal, (s) => waits.push(s), 0)
    expect(result).toBe('recorded')
    expect(waits).toEqual([0, 0])

    // Anything else fails right away.
    const broken = vi.fn().mockRejectedValue(new AiError('nope', 'bad_output'))
    await expect(patiently(broken, new AbortController().signal, () => {}, 0)).rejects.toThrow('nope')
    expect(broken).toHaveBeenCalledTimes(1)
  })
})
