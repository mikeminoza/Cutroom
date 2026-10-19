// Talks to the web app, which owns the database.
import type { JobPayload, WorkerEvent } from '@cutroom/shared/protocol'

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${process.env.WORKER_SECRET ?? ''}`, 'content-type': 'application/json' }
}

async function call<T>(path: string, init?: RequestInit, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${appUrl()}${path}`, { ...init, headers: headers() })
      if (res.status === 404) throw Object.assign(new Error('Not found'), { fatal: true })
      if (!res.ok) throw new Error(`Web app answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return (await res.json()) as T
    } catch (error) {
      lastError = error
      if ((error as { fatal?: boolean }).fatal) throw error
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw lastError
}

export function getPayload(jobId: string): Promise<JobPayload> {
  return call<JobPayload>(`/api/worker/jobs/${jobId}`)
}

export async function sendEvent(jobId: string, event: WorkerEvent): Promise<void> {
  await call(`/api/worker/jobs/${jobId}/events`, { method: 'POST', body: JSON.stringify(event) })
}

export async function pendingJobs(): Promise<string[]> {
  const data = await call<{ ids: string[] }>('/api/worker/jobs/pending', undefined, 2)
  return data.ids
}
