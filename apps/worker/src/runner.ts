// Runs one job at a time (the free Render instance has very little CPU).
// Every run first claims the job from the web app, so a second worker (a restart overlapping the
// old instance, a GitHub Actions run, a double click) can never run or upload the same job twice.
import { STALL_SECONDS } from '@cutroom/shared/protocol'
import { claim, getPayload, LostJob, sendEvent } from './api'
import { createContext } from './jobs/context'
import { runPublish } from './jobs/publish'
import { runRetime } from './jobs/retime'
import { runVoice } from './jobs/voice'
import { keepAwake } from './keepalive'
import { errorMessage, makeWorkDir, removeWorkDir } from './util'

const queue: string[] = []
let active: { jobId: string; startedAt: number; controller: AbortController } | null = null
/** Jobs another worker holds: try again once its heartbeat would have gone stale. */
const retries = new Map<string, number>()
const MAX_CLAIM_RETRIES = 10

export function workerState() {
  return {
    active: active
      ? { jobId: active.jobId, seconds: Math.round((Date.now() - active.startedAt) / 1000) }
      : null,
    queued: [...queue],
  }
}

export function isKnown(jobId: string): boolean {
  return active?.jobId === jobId || queue.includes(jobId)
}

export function enqueue(jobId: string): 'started' | 'queued' | 'already' {
  if (isKnown(jobId)) return 'already'
  queue.push(jobId)
  const wasIdle = !active
  void drain()
  return wasIdle ? 'started' : 'queued'
}

export function cancel(jobId: string): boolean {
  const index = queue.indexOf(jobId)
  if (index >= 0) queue.splice(index, 1)
  if (active?.jobId === jobId) {
    active.controller.abort()
    return true
  }
  return index >= 0
}

async function drain() {
  if (active) return
  const jobId = queue.shift()
  if (!jobId) return
  const controller = new AbortController()
  active = { jobId, startedAt: Date.now(), controller }
  keepAwake(true)
  try {
    const outcome = await runJob(jobId, controller)
    if (outcome === 'busy') {
      // Usually the previous instance of this worker, still finishing after a restart.
      const attempt = (retries.get(jobId) ?? 0) + 1
      if (attempt <= MAX_CLAIM_RETRIES) {
        retries.set(jobId, attempt)
        setTimeout(() => enqueue(jobId), (STALL_SECONDS + 15) * 1000).unref()
      } else retries.delete(jobId)
    } else retries.delete(jobId)
  } catch (error) {
    // runJob reports its own failures; this only guards the queue against a crash.
    console.error(`[${jobId}] unexpected error:`, errorMessage(error))
  } finally {
    active = null
    keepAwake(false)
    void drain()
  }
}

/** 'skipped': nothing to do. 'error': the job could not be loaded at all (network, secrets). */
export type RunOutcome = 'done' | 'waiting' | 'failed' | 'busy' | 'skipped' | 'error'

/** Claims, runs and reports one job. Never throws. */
export async function runJob(jobId: string, controller: AbortController): Promise<RunOutcome> {
  const { signal } = controller
  try {
    const claimed = await claim(jobId)
    if (claimed === 'held') {
      console.log(`[${jobId}] another worker is running this job`)
      return 'busy'
    }
    if (claimed === 'not-runnable') {
      console.log(`[${jobId}] not waiting to run (finished, stopped or waiting for approval)`)
      return 'skipped'
    }
  } catch (error) {
    console.error(`[${jobId}] could not claim the job:`, errorMessage(error))
    return 'error'
  }
  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    payload = await getPayload(jobId)
  } catch (error) {
    console.error(`[${jobId}] could not load job:`, errorMessage(error))
    return 'error'
  }
  if (payload.job.status === 'done' || payload.job.status === 'failed') return 'skipped'

  let workDir: string
  try {
    workDir = await makeWorkDir(jobId)
  } catch (error) {
    // Usually a full or read-only temp disk. Say so, rather than leave the job held and silent.
    const message = `The worker could not create a temporary folder: ${errorMessage(error)}`
    console.error(`[${jobId}] ${message}`)
    await sendEvent(jobId, { type: 'failed', error: message }).catch(() => {})
    return 'failed'
  }
  let lost = false
  const ctx = createContext(payload, workDir, signal, () => {
    lost = true
    controller.abort()
  })
  console.log(`[${jobId}] ${payload.job.type} started for "${payload.project.title}"`)
  try {
    let outcome: 'done' | 'waiting' = 'done'
    if (payload.job.type === 'retime') await runRetime(payload, ctx)
    else if (payload.job.type === 'voice') await runVoice(payload, ctx)
    else outcome = await runPublish(payload, ctx)
    if (outcome === 'done') await sendEvent(jobId, { type: 'done' })
    console.log(`[${jobId}] ${outcome === 'done' ? 'finished' : 'waiting for approval'}`)
    return outcome
  } catch (error) {
    if (lost || error instanceof LostJob) {
      console.log(`[${jobId}] stopped: the job was stopped or taken over by another worker`)
      return 'failed'
    }
    const message = signal.aborted ? 'Stopped.' : errorMessage(error)
    console.error(`[${jobId}] failed at ${ctx.current ?? 'start'}:`, message)
    await sendEvent(jobId, { type: 'failed', error: message, key: ctx.current ?? undefined }).catch(() => {})
    return 'failed'
  } finally {
    ctx.progress.flush()
    await removeWorkDir(workDir)
  }
}
