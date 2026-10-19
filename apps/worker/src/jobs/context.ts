import type { JobPayload, JobResult, StepKey, StepStatus } from '@cutroom/shared/protocol'
import { sendEvent } from '../api'
import { throttle } from '../util'

export interface JobContext {
  jobId: string
  workDir: string
  signal: AbortSignal
  /** Accumulated results, including those from earlier runs of this job. */
  result: (patch: JobResult) => Promise<void>
  data: JobResult
  step: (key: StepKey, status: StepStatus, detail?: string) => Promise<void>
  progress: ((key: StepKey, fraction: number, detail: string) => void) & { flush: () => void }
  waiting: (key: StepKey, detail: string) => Promise<void>
  /** True when a previous run already finished (or skipped) this step. */
  finished: (key: StepKey) => boolean
  /** The step currently running, used to attribute failures. */
  current: StepKey | null
  warn: (message: string) => Promise<void>
}

export function createContext(payload: JobPayload, workDir: string, signal: AbortSignal): JobContext {
  const jobId = payload.job.id
  const data: JobResult = { ...payload.job.result }
  const finishedSteps = new Set(
    payload.job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.key),
  )
  const progress = throttle((key: StepKey, fraction: number, detail: string) => {
    sendEvent(jobId, { type: 'step', key, status: 'running', progress: fraction, detail }).catch(() => {})
  }, 3000)

  const ctx: JobContext = {
    jobId,
    current: null,
    workDir,
    signal,
    data,
    async result(patch) {
      Object.assign(data, patch)
      await sendEvent(jobId, { type: 'result', patch })
    },
    async step(key, status, detail) {
      if (status === 'running') ctx.current = key
      if (status === 'done' || status === 'skipped') {
        progress.flush()
        finishedSteps.add(key)
      }
      await sendEvent(jobId, { type: 'step', key, status, detail })
    },
    progress,
    async waiting(key, detail) {
      await sendEvent(jobId, { type: 'waiting', key, detail })
    },
    finished: (key) => finishedSteps.has(key),
    async warn(message) {
      const warnings = [...(data.warnings ?? []), message]
      await ctx.result({ warnings })
    },
  }
  return ctx
}
