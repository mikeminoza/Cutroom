// Talks to the web app, which owns the database.
import { hostname } from 'node:os'
import type { JobPayload, WorkerEvent } from '@cutroom/shared/protocol'

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/** Identifies this worker process to the web app, which lets only one worker hold a job. */
export const RUNNER_ID = process.env.GITHUB_RUN_ID
  ? `github-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  : `${process.env.RENDER_INSTANCE_ID || hostname()}-${process.pid}-${Date.now().toString(36)}`

/** The web app refused a report: another worker holds the job now, or it was stopped. */
export class LostJob extends Error {
  constructor(message = 'This job was stopped or taken over by another worker.') {
    super(message)
    this.name = 'LostJob'
  }
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.WORKER_SECRET ?? ''}`,
    'content-type': 'application/json',
    'x-cutroom-runner': RUNNER_ID,
  }
}

async function call<T>(path: string, init?: RequestInit, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${appUrl()}${path}`, { ...init, headers: headers() })
      if (res.status === 404) throw Object.assign(new Error('Not found'), { fatal: true })
      if (res.status === 409) throw new LostJob()
      if (!res.ok) throw new Error(`Web app answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return (await res.json()) as T
    } catch (error) {
      lastError = error
      if (error instanceof LostJob || (error as { fatal?: boolean }).fatal) throw error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw lastError
}

/**
 * Asks to run the job: 'granted', 'held' (another worker is running it; ask again later) or
 * 'not-runnable' (finished, stopped or waiting for approval).
 */
export async function claim(jobId: string): Promise<'granted' | 'held' | 'not-runnable'> {
  const res = await fetch(`${appUrl()}/api/worker/jobs/${jobId}/claim`, {
    method: 'POST',
    headers: headers(),
  })
  if (res.ok) return 'granted'
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { reason?: string } | null
    return body?.reason === 'held' ? 'held' : 'not-runnable'
  }
  if (res.status === 404) return 'not-runnable'
  throw new Error(`Web app answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export function getPayload(jobId: string): Promise<JobPayload> {
  return call<JobPayload>(`/api/worker/jobs/${jobId}`)
}

export async function sendEvent(jobId: string, event: WorkerEvent): Promise<void> {
  await call(`/api/worker/jobs/${jobId}/events`, { method: 'POST', body: JSON.stringify(event) })
}

/** Makes a Short draft from the job's video; its voice-over is already uploaded. Returns its id. */
export async function createShort(
  jobId: string,
  short: {
    newId: string
    from: number
    to: number
    title: string
    voiceover: { url: string; name: string; duration: number } | null
  },
): Promise<string> {
  const data = await call<{ id: string }>(`/api/worker/jobs/${jobId}/shorts`, {
    method: 'POST',
    body: JSON.stringify(short),
  })
  return data.id
}

/** The video missed its posting time: the next free slot (now reserved), or null to post now. */
export async function nextSlot(jobId: string): Promise<string | null> {
  const data = await call<{ at: string | null }>(`/api/worker/jobs/${jobId}/reschedule`, { method: 'POST' })
  return data.at
}

export async function pendingJobs(): Promise<string[]> {
  const data = await call<{ ids: string[] }>('/api/worker/jobs/pending', undefined, 2)
  return data.ids
}
