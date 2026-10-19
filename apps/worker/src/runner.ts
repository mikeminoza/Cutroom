// Runs one job at a time (the free Render instance has very little CPU).
import { getPayload, sendEvent } from './api'
import { createContext } from './jobs/context'
import { runPublish } from './jobs/publish'
import { runRetime } from './jobs/retime'
import { errorMessage, makeWorkDir, removeWorkDir } from './util'

const queue: string[] = []
let active: { jobId: string; startedAt: number; controller: AbortController } | null = null

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
  try {
    await run(jobId, controller.signal)
  } finally {
    active = null
    void drain()
  }
}

async function run(jobId: string, signal: AbortSignal) {
  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    payload = await getPayload(jobId)
  } catch (error) {
    console.error(`[${jobId}] could not load job:`, errorMessage(error))
    return
  }
  if (payload.job.status === 'done' || payload.job.status === 'failed') return

  const workDir = await makeWorkDir(jobId)
  const ctx = createContext(payload, workDir, signal)
  console.log(`[${jobId}] ${payload.job.type} started for "${payload.project.title}"`)
  try {
    if (payload.job.type === 'retime') {
      await runRetime(payload, ctx)
      await sendEvent(jobId, { type: 'done' })
    } else {
      const outcome = await runPublish(payload, ctx)
      if (outcome === 'done') await sendEvent(jobId, { type: 'done' })
    }
    console.log(`[${jobId}] finished`)
  } catch (error) {
    const message = signal.aborted ? 'Stopped.' : errorMessage(error)
    console.error(`[${jobId}] failed at ${ctx.current ?? 'start'}:`, message)
    await sendEvent(jobId, { type: 'failed', error: message, key: ctx.current ?? undefined }).catch(() => {})
  } finally {
    ctx.progress.flush()
    await removeWorkDir(workDir)
  }
}
