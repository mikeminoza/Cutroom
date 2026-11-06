// A test run from Settings (server/worker-check.ts in the web app). It reaches Cutroom the way a
// job does, says where it runs, checks its keys, renders a short clip with the real renderer and
// saves it to storage, so a setup problem shows up before a real video runs into it.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hostname, release, type } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { checkGeminiKey } from '@cutroom/shared/ai'
import { elevenLabsVoices, hasElevenLabsKey } from '@cutroom/shared/elevenlabs'
import { clientFromRefresh, explainGoogleError, hasGoogleClient } from '@cutroom/shared/google'
import {
  CHECK_PREFIX,
  type CheckEvent,
  type CheckPayload,
  type CheckStepKey,
  type WorkerInfo,
} from '@cutroom/shared/protocol'
import { putLocalFile } from '@cutroom/shared/storage'
import type { Word } from '@cutroom/shared/types'
import { getCheck, sendCheckEvent } from './api'
import { ffmpegPath, runFfmpeg } from './render/ffmpeg'
import { renderVideo } from './render/render'
import { errorMessage, makeWorkDir, removeWorkDir } from './util'

const exec = promisify(execFile)

/** The machine, Node and ffmpeg this worker runs on. */
export async function workerInfo(): Promise<WorkerInfo> {
  const runner =
    process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : process.env.RENDER ? 'Render' : hostname()
  let os = `${type()} ${release()}`
  try {
    const name = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await readFile('/etc/os-release', 'utf8'))?.[1]
    if (name) os = name
  } catch {
    // Not Linux: the kernel name and version will do.
  }
  let ffmpeg = ''
  try {
    const { stdout } = await exec(ffmpegPath(), ['-version'], { timeout: 15_000 })
    ffmpeg = /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? 'unknown version'
  } catch {
    // Missing: the render step says so.
  }
  return { runner, os, node: process.version, ffmpeg }
}

const short = (error: unknown) => errorMessage(error).split('\n')[0].slice(0, 200)

/**
 * Checks the keys a job needs, with lookups that use no quota. Returns what works; throws with
 * everything that doesn't (and what works) when any key is missing or refused.
 */
export async function checkKeys(payload: Pick<CheckPayload, 'youtubeRefreshToken' | 'voiceProvider'>) {
  const works: string[] = []
  const problems: string[] = []

  if (!process.env.GEMINI_API_KEY) {
    problems.push('GEMINI_API_KEY is missing: AI voice-overs and post details need it')
  } else {
    try {
      await checkGeminiKey()
      works.push('Gemini works')
    } catch (error) {
      problems.push(`Gemini refused the key or model (GEMINI_API_KEY, GEMINI_MODEL): ${short(error)}`)
    }
  }

  if (!hasGoogleClient()) {
    problems.push(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing: uploads to YouTube and Drive need them',
    )
  } else if (!payload.youtubeRefreshToken) {
    works.push('YouTube sign-in not tested (no channel connected)')
  } else {
    try {
      await clientFromRefresh(payload.youtubeRefreshToken).getAccessToken()
      works.push('YouTube sign-in works')
    } catch (error) {
      const text = `${errorMessage(error)} ${String((error as { response?: { data?: { error?: unknown } } })?.response?.data?.error ?? '')}`
      problems.push(
        /invalid_client|unauthorized_client/.test(text)
          ? "Google refused GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET: they must be the same as the web app's"
          : (explainGoogleError(error) ?? `Google sign-in failed: ${short(error)}`),
      )
    }
  }

  if (hasElevenLabsKey()) {
    try {
      await elevenLabsVoices()
      works.push('ElevenLabs works')
    } catch (error) {
      problems.push(short(error))
    }
  } else if (payload.voiceProvider === 'elevenlabs') {
    problems.push('ELEVENLABS_API_KEY is missing, and your voice-overs use ElevenLabs')
  }

  if (problems.length) throw new Error(`${[...problems, ...works].join('. ')}.`)
  return works.join(' · ')
}

const CLIP_SECONDS = 4

/**
 * Renders a short clip through the real renderer: two pictures with motion, a whip between them,
 * burned-in captions, a voice track and sound effects. Returns the file and how long it took.
 */
export async function renderClip(dir: string, signal?: AbortSignal) {
  const first = path.join(dir, 'first.png')
  const second = path.join(dir, 'second.png')
  const voice = path.join(dir, 'voice.wav')
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-frames:v', '1', first], { signal })
  await runFfmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=1280x720', '-frames:v', '1', second], { signal })
  await runFfmpeg(
    ['-f', 'lavfi', '-i', `sine=frequency=330:duration=${CLIP_SECONDS}`, '-ac', '1', '-ar', '44100', voice],
    { signal },
  )
  const words: Word[] = 'Testing the Cutroom worker: pictures, captions and sound.'
    .split(' ')
    .map((text, i) => ({ text, start: 0.2 + i * 0.45, end: 0.55 + i * 0.45 }))
  const scene = { fit: 'cover', focusX: 0.5, focusY: 0.5 } as const
  const started = Date.now()
  const output = await renderVideo({
    workDir: dir,
    format: 'landscape',
    resolution: '720p',
    captionStyle: 'highlight',
    scenes: [
      { ...scene, start: 0, end: 2, imagePath: first, motion: 'zoom-in', transition: 'cut' },
      { ...scene, start: 2, end: CLIP_SECONDS, imagePath: second, motion: 'pan-left', transition: 'whip' },
    ],
    voiceoverPath: voice,
    duration: CLIP_SECONDS,
    words,
    musicPath: null,
    musicVolume: 0,
    soundEffects: true,
    signal,
  })
  return { videoPath: output.videoPath, seconds: Math.max(1, Math.round((Date.now() - started) / 1000)) }
}

/** Runs the check handed over as `runId` (CHECK_PREFIX + its id). Never throws. */
export async function runCheck(runId: string, signal: AbortSignal): Promise<'done' | 'failed' | 'error'> {
  const id = runId.slice(CHECK_PREFIX.length)
  let payload: CheckPayload
  try {
    payload = await getCheck(id)
  } catch (error) {
    console.error(`[${runId}] could not load the check:`, errorMessage(error))
    return 'error'
  }
  const send = (event: CheckEvent) => sendCheckEvent(id, event)
  let failed = false
  /** Runs one step; a failed step is reported and the check carries on with the next one. */
  const step = async (key: CheckStepKey, run: () => Promise<string>) => {
    await send({ type: 'step', key, status: 'running' })
    try {
      const detail = await run()
      await send({ type: 'step', key, status: 'done', detail })
      return true
    } catch (error) {
      failed = true
      await send({ type: 'step', key, status: 'failed', detail: errorMessage(error).slice(0, 1500) })
      return false
    }
  }

  let workDir: string | null = null
  try {
    await send({ type: 'info', info: await workerInfo() })
    await step('keys', () => checkKeys(payload))
    const dir = await makeWorkDir(runId)
    workDir = dir
    let clip: string | null = null
    await step('render', async () => {
      const rendered = await renderClip(dir, signal)
      clip = rendered.videoPath
      return `${CLIP_SECONDS}-second 720p clip with captions, a whip and sound effects, rendered in ${rendered.seconds}s`
    })
    if (clip) {
      await send({ type: 'step', key: 'storage', status: 'running' })
      const started = Date.now()
      try {
        const stored = await putLocalFile(`checks/${id}/test-clip.mp4`, clip, 'video/mp4')
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
        await send({ type: 'clip', url: stored.url, seconds })
      } catch (error) {
        failed = true
        await send({ type: 'step', key: 'storage', status: 'failed', detail: short(error) })
      }
    } else {
      await send({
        type: 'step',
        key: 'storage',
        status: 'skipped',
        detail: 'Nothing to save: the render failed.',
      })
    }
    await send({ type: 'finished' })
    console.log(`[${runId}] check finished${failed ? ' with problems' : ''}`)
    return failed ? 'failed' : 'done'
  } catch (error) {
    // A report didn't get through: Cutroom is unreachable, or ended the check.
    console.error(`[${runId}] check stopped:`, errorMessage(error))
    return 'error'
  } finally {
    if (workDir) await removeWorkDir(workDir)
  }
}
