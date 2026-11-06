// Testing the worker from Settings. A check is handed to the worker the way a job is (the same
// dispatch, secrets and storage) and reports each part: whether a run started and reached
// Cutroom, whether its keys work, whether ffmpeg renders, and whether Cutroom can read what it
// saved. A setup problem then shows up here instead of halfway through a real video.
import { existsSync } from 'node:fs'
import {
  CHECK_PREFIX,
  CHECK_STEPS,
  type CheckEvent,
  type CheckPayload,
  type CheckStatus,
  type CheckStep,
  type WorkerInfo,
} from '@cutroom/shared/protocol'
import { deleteFile, LOCAL_PREFIX, localPath, storageDriver } from '@cutroom/shared/storage'
import { desc, eq } from 'drizzle-orm'
import type { WorkerCheckDTO } from '@/lib/dto'
import { defaultChannel } from './connections'
import { db, schema } from './db'
import type { WorkerCheckRow } from './db/schema'
import { HttpError, newId, notFound } from './http'
import { dispatchCheck, githubRunsUrl, requireWorker, type WorkerMode, workerMode } from './jobs'
import { appUrl, getSettings } from './settings'

/** How long a worker may take to report in: a GitHub run starts a machine and installs ffmpeg. */
export const NO_SHOW_SECONDS: Record<WorkerMode, number> = { github: 8 * 60, render: 3 * 60 }
/** A sleeping worker service is asked again this often while it wakes up. */
const KICK_SECONDS = 45
/** A worker that reported and then went quiet this long has stopped. */
const SILENT_SECONDS = 10 * 60

function toDTO(row: WorkerCheckRow): WorkerCheckDTO {
  return {
    id: row.id,
    status: row.status,
    steps: row.steps,
    info: row.info ?? null,
    clipUrl: row.clipUrl,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    mode: workerMode(),
    runsUrl: workerMode() === 'github' ? githubRunsUrl() : null,
  }
}

const finished = (status: CheckStatus) => status === 'done' || status === 'failed'

async function latestRow(): Promise<WorkerCheckRow | null> {
  const database = await db()
  const [row] = await database
    .select()
    .from(schema.workerChecks)
    .orderBy(desc(schema.workerChecks.createdAt))
    .limit(1)
  return row ?? null
}

async function getRow(id: string): Promise<WorkerCheckRow> {
  const database = await db()
  const [row] = await database.select().from(schema.workerChecks).where(eq(schema.workerChecks.id, id))
  if (!row) notFound('This worker check')
  return row
}

async function save(id: string, values: Partial<typeof schema.workerChecks.$inferInsert>) {
  const database = await db()
  const [row] = await database
    .update(schema.workerChecks)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.workerChecks.id, id))
    .returning()
  return row
}

function setStep(steps: CheckStep[], key: CheckStep['key'], patch: Partial<CheckStep>): CheckStep[] {
  return steps.map((s) => (s.key === key ? { ...s, ...patch } : s))
}

/** Ends a check that stopped at `key`: that step failed, the ones after it never ran. */
async function fail(row: WorkerCheckRow, key: CheckStep['key'], message: string) {
  let past = false
  const steps = row.steps.map((s) => {
    if (s.key === key) {
      past = true
      return { ...s, status: 'failed' as const, detail: message }
    }
    return past && (s.status === 'pending' || s.status === 'running')
      ? { ...s, status: 'skipped' as const }
      : s
  })
  return save(row.id, { status: 'failed', steps, error: message, finishedAt: new Date() })
}

/** Why a worker never reported in, and what to look at. */
export function noShowMessage(mode: WorkerMode): string {
  return mode === 'github'
    ? `No GitHub Actions run reached Cutroom within ${NO_SHOW_SECONDS.github / 60} minutes. Open the worker's runs on GitHub: a run that failed straight away usually means APP_URL or WORKER_SECRET is missing from the repository secrets, or WORKER_SECRET differs from the one on Vercel.`
    : `The worker didn't answer within ${NO_SHOW_SECONDS.render / 60} minutes. Check that WORKER_URL points at it, that it is running, and that WORKER_SECRET is the same on both.`
}

/** Starts a check, or returns the one still running. Only the latest check (and its clip) is kept. */
export async function startCheck(): Promise<WorkerCheckDTO> {
  requireWorker()
  const current = await latestRow()
  if (current && !finished(current.status)) {
    const fresh = await refreshCheck(current)
    if (!finished(fresh.status)) return toDTO(fresh)
  }
  const database = await db()
  const old = await database.select({ clipUrl: schema.workerChecks.clipUrl }).from(schema.workerChecks)
  await Promise.all(old.map((c) => deleteFile(c.clipUrl)))
  await database.delete(schema.workerChecks)

  const mode = workerMode()
  const steps: CheckStep[] = CHECK_STEPS.map((s) => ({ ...s, status: 'pending' }))
  steps[0] = {
    ...steps[0],
    status: 'running',
    detail: mode === 'github' ? 'Waiting for GitHub to start a run (1–3 minutes)' : 'Waiting for the worker',
  }
  const [row] = await database
    .insert(schema.workerChecks)
    .values({ id: newId(), status: 'queued', steps })
    .returning()
  const error = await dispatchCheck(`${CHECK_PREFIX}${row.id}`)
  return toDTO(error ? await fail(row, 'start', error) : row)
}

/** Ends a check whose worker never came or went quiet, and wakes a sleeping worker service. */
export async function refreshCheck(row: WorkerCheckRow, now = Date.now()): Promise<WorkerCheckRow> {
  if (finished(row.status)) return row
  const mode = workerMode()
  if (!row.heardAt) {
    if ((now - row.createdAt.getTime()) / 1000 > NO_SHOW_SECONDS[mode]) {
      return fail(row, 'start', noShowMessage(mode))
    }
    if (mode === 'render' && (now - row.updatedAt.getTime()) / 1000 > KICK_SECONDS) {
      await dispatchCheck(`${CHECK_PREFIX}${row.id}`)
      return save(row.id, {})
    }
    return row
  }
  if ((now - row.heardAt.getTime()) / 1000 > SILENT_SECONDS) {
    const running = row.steps.find((s) => s.status === 'running')?.key ?? 'render'
    return fail(
      row,
      running,
      'The worker stopped reporting partway through: it may have crashed or run out of time.',
    )
  }
  return row
}

export async function latestCheck(): Promise<WorkerCheckDTO | null> {
  const row = await latestRow()
  return row ? toDTO(await refreshCheck(row)) : null
}

/** What the worker needs to run a check. Counts as the worker reporting in. */
export async function checkPayload(id: string, request: Request): Promise<CheckPayload> {
  const row = await getRow(id)
  if (finished(row.status)) throw new HttpError(409, 'This worker check has already finished.')
  await save(id, { heardAt: new Date() })
  const [channel, settings] = await Promise.all([defaultChannel(), getSettings()])
  return {
    id,
    youtubeRefreshToken: channel?.refreshToken ?? null,
    voiceProvider: settings.voice.provider,
    appUrl: appUrl(request),
  }
}

/** Whether Cutroom can read the clip the worker saved: null when it can, or why not. */
export async function clipProblem(url: string): Promise<string | null> {
  if (url.startsWith(LOCAL_PREFIX)) {
    if (storageDriver() === 'blob') {
      return "The worker saved the clip on its own disk, where Cutroom can't reach it. Add BLOB_READ_WRITE_TOKEN to the worker's secrets, with the same value as on Vercel."
    }
    let found = false
    try {
      found = existsSync(localPath(url.slice(LOCAL_PREFIX.length)))
    } catch {
      found = false
    }
    return found
      ? null
      : "Cutroom can't find the clip the worker saved: the worker and the web app must share .data/storage, or both use Vercel Blob."
  }
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
    return res.ok ? null : `Cutroom couldn't read the clip back: storage answered HTTP ${res.status}.`
  } catch (error) {
    return `Cutroom couldn't read the clip back: ${error instanceof Error ? error.message : String(error)}`
  }
}

function infoLine(info: WorkerInfo): string {
  return [
    info.runner,
    info.os,
    `Node ${info.node.replace(/^v/, '')}`,
    info.ffmpeg ? `ffmpeg ${info.ffmpeg}` : 'no ffmpeg',
  ].join(' · ')
}

/** Applies one report from the worker. A finished check refuses it, and the worker stops. */
export async function applyCheckEvent(id: string, event: CheckEvent): Promise<WorkerCheckDTO> {
  const row = await getRow(id)
  if (finished(row.status)) throw new HttpError(409, 'This worker check has already finished.')
  const heardAt = new Date()

  if (event.type === 'info') {
    const steps = setStep(row.steps, 'start', { status: 'done', detail: infoLine(event.info) })
    return toDTO(await save(id, { status: 'running', info: event.info, steps, heardAt }))
  }
  if (event.type === 'step') {
    const steps = setStep(row.steps, event.key, { status: event.status, detail: event.detail })
    return toDTO(await save(id, { status: 'running', steps, heardAt }))
  }
  if (event.type === 'clip') {
    const problem = await clipProblem(event.url)
    const where = event.url.startsWith(LOCAL_PREFIX) ? '.data/storage' : 'Vercel Blob'
    const steps = setStep(
      row.steps,
      'storage',
      problem
        ? { status: 'failed', detail: problem }
        : { status: 'done', detail: `Saved to ${where} in ${event.seconds}s and read back by Cutroom` },
    )
    return toDTO(await save(id, { steps, clipUrl: problem ? null : event.url, heardAt }))
  }
  // finished
  const steps = row.steps.map((s) =>
    s.status === 'pending' || s.status === 'running' ? { ...s, status: 'skipped' as const } : s,
  )
  const failed = steps.find((s) => s.status === 'failed')
  return toDTO(
    await save(id, {
      status: failed ? 'failed' : 'done',
      steps,
      error: failed?.detail ?? null,
      heardAt,
      finishedAt: heardAt,
    }),
  )
}
