// The worker check from Settings: where it runs, the keys it reports, and the test clip it renders
// with real ffmpeg.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { checkKeys, renderClip, workerInfo } from '../src/check'
import { probeDuration, probeStreams } from '../src/render/ffmpeg'

const temp = mkdtempSync(path.join(os.tmpdir(), 'cutroom-check-'))

afterAll(() => {
  rmSync(temp, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the worker check', () => {
  it('says where the worker runs, with the ffmpeg version', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true')
    const info = await workerInfo()
    expect(info.runner).toBe('GitHub Actions')
    expect(info.node).toBe(process.version)
    expect(info.ffmpeg).toMatch(/^\S+$/)
    expect(info.os).not.toBe('')
  })

  it('renders a short clip with pictures, captions, a whip and sound', async () => {
    const { videoPath, seconds } = await renderClip(temp)
    const streams = await probeStreams(videoPath)
    expect(streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video'])
    expect(await probeDuration(videoPath)).toBeCloseTo(4, 0)
    expect(seconds).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('names every missing key, and the voice provider that needs one', async () => {
    for (const name of ['GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ELEVENLABS_API_KEY']) {
      vi.stubEnv(name, '')
    }
    const failure = await checkKeys({ youtubeRefreshToken: null, voiceProvider: 'elevenlabs' }).catch(
      (error: Error) => error.message,
    )
    expect(failure).toContain('GEMINI_API_KEY is missing')
    expect(failure).toContain('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing')
    expect(failure).toContain('ELEVENLABS_API_KEY is missing, and your voice-overs use ElevenLabs')
    // Gemini voices need no ElevenLabs key.
    const gemini = await checkKeys({ youtubeRefreshToken: null, voiceProvider: 'gemini' }).catch(
      (error: Error) => error.message,
    )
    expect(gemini).not.toContain('ELEVENLABS')
  })

  it('reports the keys that work, and an untested sign-in without a channel', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    const failure = await checkKeys({ youtubeRefreshToken: null, voiceProvider: 'gemini' }).catch(
      (error: Error) => error.message,
    )
    expect(failure).toBe(
      'GEMINI_API_KEY is missing: AI voice-overs and post details need it. YouTube sign-in not tested (no channel connected).',
    )
  })
})
