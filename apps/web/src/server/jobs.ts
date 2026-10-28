// Job orchestration. The web app owns job state; a worker runs the work and reports back through
// applyEvent(). Two kinds of worker:
//  - 'render': the always-on worker service (Render). While a job is active, every status check
//    from the dashboard also pings it, and it keeps itself awake while it works.
//  - 'github': a GitHub Actions run started per job (more CPU, never asleep, nothing to keep alive).
// A worker must claim a job before running it, and reports with its runner id, so two workers
// can never run (or upload) the same job at once.
import {
  initialSteps,
  type JobPayload,
  type JobResult,
  type JobType,
  type PublishStepKey,
  STALL_SECONDS,
  type WorkerEvent,
} from '@cutroom/shared/protocol'
import { deleteFile, storageDriver } from '@cutroom/shared/storage'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { searchTermsFor, topTitles } from './analytics'
import { postDueComments } from './comments'
import { channelFor, getDrive } from './connections'
import { db, schema } from './db'
import type { JobRow } from './db/schema'
import { badRequest, HttpError, newId, notFound } from './http'
import { notify } from './notify'
import {
  getCharacters,
  getProjectRow,
  getScenes,
  replaceScenes,
  toCharacterDTO,
  toProjectDTO,
  toSceneDTO,
  updateProject,
} from './projects'
import { appUrl, getSettings } from './settings'

export type WorkerMode = 'render' | 'github'

export function workerUrl(): string | null {
  return process.env.WORKER_URL ? process.env.WORKER_URL.replace(/\/$/, '') : null
}

function github(): { token: string; repo: string; workflow: string; ref: string } | null {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = process.env.GITHUB_REPO
  if (!token || !repo) return null
  return {
    token,
    repo,
    workflow: process.env.GITHUB_WORKFLOW_FILE || 'worker.yml',
    ref: process.env.GITHUB_BRANCH || 'main',
  }
}

/** GitHub Actions when it is set up (it is the explicit opt-in), otherwise the worker service. */
export function workerMode(): WorkerMode {
  if (process.env.WORKER_MODE === 'render') return 'render'
  return github() ? 'github' : 'render'
}

/** True when jobs have somewhere to run. */
export function workerConfigured(): boolean {
  if (!process.env.WORKER_SECRET) return false
  return workerMode() === 'github' ? Boolean(github()) : Boolean(workerUrl())
}

export function requireWorker() {
  if (!workerConfigured()) {
    badRequest(
      workerMode() === 'github'
        ? 'The GitHub Actions worker is not set up yet. Add GITHUB_DISPATCH_TOKEN, GITHUB_REPO and WORKER_SECRET.'
        : 'The worker is not set up yet. Add WORKER_URL and WORKER_SECRET.',
    )
  }
}

async function workerFetch(path: string, init?: RequestInit, timeoutMs = 8000): Promise<Response | null> {
  const base = workerUrl()
  if (!base || !process.env.WORKER_SECRET) return null
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${process.env.WORKER_SECRET}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    // Asleep or restarting. A waking worker resumes pending jobs by itself.
    return null
  }
}

/** Starts a GitHub Actions run for the job. Returns an error message, or null when it started. */
async function dispatchGithub(jobId: string): Promise<string | null> {
  const gh = github()
  if (!gh) return 'GitHub Actions is not set up.'
  try {
    const res = await fetch(
      `${(process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '')}/repos/${gh.repo}/actions/workflows/${encodeURIComponent(gh.workflow)}/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${gh.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
          'user-agent': 'cutroom',
        },
        body: JSON.stringify({ ref: gh.ref, inputs: { job_id: jobId } }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (res.ok) return null
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    return `GitHub answered HTTP ${res.status}${body?.message ? `: ${body.message}` : ''}`
  } catch (error) {
    return `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function pingWorker(): Promise<{ reachable: boolean; busy: boolean }> {
  if (workerMode() === 'github') {
    // Nothing to ping: a run starts per job. Busy when a job is running.
    const database = await db()
    const [running] = await database
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'running'))
      .limit(1)
    return { reachable: Boolean(github()), busy: Boolean(running) }
  }
  const base = workerUrl()
  if (!base) return { reachable: false, busy: false }
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { reachable: false, busy: false }
    const data = (await res.json()) as { active: unknown }
    return { reachable: true, busy: Boolean(data.active) }
  } catch {
    return { reachable: false, busy: false }
  }
}

async function getJob(id: string): Promise<JobRow> {
  const database = await db()
  const [row] = await database.select().from(schema.jobs).where(eq(schema.jobs.id, id))
  if (!row) notFound('This job')
  return row
}

async function dispatch(jobId: string) {
  const database = await db()
  await database.update(schema.jobs).set({ kickedAt: new Date() }).where(eq(schema.jobs.id, jobId))
  if (workerMode() === 'github') {
    const error = await dispatchGithub(jobId)
    // Shown on the job while it waits to start; cleared once a run was started.
    await database
      .update(schema.jobs)
      .set({
        progressDetail: error ? `Could not start the GitHub Actions worker: ${error}` : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, 'queued')))
    return
  }
  await workerFetch('/jobs', { method: 'POST', body: JSON.stringify({ jobId }) })
}

const ACTIVE: JobRow['status'][] = ['queued', 'running', 'waiting']

/** Jobs of these types that are still in progress for the project. */
export async function activeJobs(projectId: string, types: JobType[]): Promise<JobRow[]> {
  const database = await db()
  return database
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.projectId, projectId),
        inArray(schema.jobs.type, types),
        inArray(schema.jobs.status, ACTIVE),
      ),
    )
}

const JOB_NAME: Record<JobType, string> = {
  retime: 'Matching the scenes to the voice-over',
  publish: 'Finish & schedule',
  voice: 'Recording the AI voice-over',
}

/** Refuses to start a job while another one would fight over the same project data. */
export async function assertNoConflict(projectId: string, type: JobType) {
  const conflicts: Record<JobType, JobType[]> = {
    retime: ['voice', 'publish'],
    voice: ['retime', 'publish'],
    publish: ['retime', 'voice'],
  }
  const [busy] = await activeJobs(projectId, conflicts[type])
  if (busy) badRequest(`${JOB_NAME[busy.type]} is still running for this video. Wait for it to finish.`)
}

/** Postgres refused a second active job on a project (the jobs_one_active_per_project index). */
function isDuplicateActive(error: unknown): boolean {
  let e = error
  for (let depth = 0; depth < 5 && e && typeof e === 'object'; depth++) {
    if ((e as { code?: unknown }).code === '23505') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

/**
 * Deletes the AI voice-over parts kept by earlier voice jobs of a project. A new voice job starts
 * fresh, and only the latest job can be retried, so the older parts would never be used.
 */
export async function deleteLeftoverVoiceParts(projectId: string) {
  const database = await db()
  const old = await database
    .select({ id: schema.jobs.id, result: schema.jobs.result })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.type, 'voice')))
  const urls = old.flatMap((j) => (j.result.voiceParts ?? []).map((p) => p.url))
  if (urls.length === 0) return
  await Promise.all(urls.map((url) => deleteFile(url)))
  await database
    .update(schema.jobs)
    .set({ result: sql`${schema.jobs.result} - 'voiceParts'` })
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.type, 'voice')))
}

export async function startJob(projectId: string, type: JobType): Promise<JobRow> {
  const [active] = await activeJobs(projectId, [type])
  if (active) return active
  await assertNoConflict(projectId, type)
  if (type === 'voice') await deleteLeftoverVoiceParts(projectId)

  const database = await db()
  const id = newId()
  let job: JobRow
  try {
    ;[job] = await database
      .insert(schema.jobs)
      .values({ id, projectId, type, status: 'queued', steps: initialSteps(type), result: {} })
      .returning()
  } catch (error) {
    if (!isDuplicateActive(error)) throw error
    // Another request started a job on this project a moment ago.
    const [same] = await activeJobs(projectId, [type])
    if (same) return same
    await assertNoConflict(projectId, type)
    throw error
  }
  if (type === 'publish') await updateProject(projectId, { status: 'rendering' })
  await dispatch(id)
  return job
}

/**
 * Called whenever someone checks on a job (dashboard polling, the daily cron). Keeps a sleeping
 * worker awake and restarts jobs whose worker went quiet.
 */
export async function watchJob(job: JobRow): Promise<void> {
  if (!['queued', 'running'].includes(job.status)) return
  const now = Date.now()
  const githubMode = workerMode() === 'github'
  // A GitHub run takes a minute or more to start, so be patient before starting another one.
  const patience = githubMode ? 10 * 60 : 45
  const kickedAgo = job.kickedAt ? (now - job.kickedAt.getTime()) / 1000 : Number.POSITIVE_INFINITY
  if (kickedAgo < patience) return
  const heartbeatAgo = job.heartbeatAt ? (now - job.heartbeatAt.getTime()) / 1000 : Number.POSITIVE_INFINITY
  const stalled = job.status === 'queued' || heartbeatAgo > (githubMode ? STALL_SECONDS * 4 : STALL_SECONDS)
  if (githubMode) {
    if (stalled) await dispatch(job.id)
    return
  }
  const database = await db()
  await database.update(schema.jobs).set({ kickedAt: new Date() }).where(eq(schema.jobs.id, job.id))
  if (stalled) {
    await workerFetch('/jobs', { method: 'POST', body: JSON.stringify({ jobId: job.id }) })
  } else {
    await workerFetch(`/jobs/${job.id}`, undefined, 5000)
  }
}

/**
 * A worker asks to run a job. Granted when nobody holds it, the same worker asks again, or the
 * holder has gone quiet for longer than STALL_SECONDS. One atomic update, so two workers asking
 * at the same moment can't both win.
 */
export async function claimJob(
  jobId: string,
  runnerId: string,
): Promise<'granted' | 'held' | 'not-runnable'> {
  const database = await db()
  const stale = new Date(Date.now() - STALL_SECONDS * 1000)
  const rows = await database
    .update(schema.jobs)
    .set({ runnerId, heartbeatAt: new Date() })
    .where(
      and(
        eq(schema.jobs.id, jobId),
        inArray(schema.jobs.status, ['queued', 'running']),
        or(
          isNull(schema.jobs.runnerId),
          eq(schema.jobs.runnerId, runnerId),
          isNull(schema.jobs.heartbeatAt),
          lt(schema.jobs.heartbeatAt, stale),
        ),
      ),
    )
    .returning({ id: schema.jobs.id })
  if (rows.length > 0) return 'granted'
  const [job] = await database
    .select({ status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
  return job && ['queued', 'running'].includes(job.status) ? 'held' : 'not-runnable'
}

const PUBLISH_PHASE: Record<PublishStepKey, 'rendering' | 'uploading'> = {
  render: 'rendering',
  drive: 'rendering',
  details: 'rendering',
  approve: 'rendering',
  youtube: 'uploading',
  finish: 'uploading',
  shorts: 'uploading',
  archive: 'uploading',
}

function projectLink(projectId: string, step: string) {
  return `${appUrl()}/projects/${projectId}?step=${step}`
}

/**
 * Applies one report from a worker. `runnerId` comes from workers that claim jobs; a report from
 * a worker that no longer holds the job (another one took over, or you stopped it) is refused,
 * and that worker stops.
 */
export async function applyEvent(jobId: string, event: WorkerEvent, runnerId?: string | null): Promise<void> {
  const database = await db()
  const job = await getJob(jobId)
  const lost = () => new HttpError(409, 'Another worker is running this job, or it was stopped.')
  if (runnerId && job.runnerId !== runnerId) throw lost()
  const now = new Date()
  // Every write re-checks that this worker still holds the job, so a Stop or a takeover that lands
  // between the read above and the write is never overwritten.
  const owned = runnerId
    ? and(eq(schema.jobs.id, jobId), eq(schema.jobs.runnerId, runnerId))
    : eq(schema.jobs.id, jobId)
  const write = async (values: PgUpdateSetSource<typeof schema.jobs>) => {
    const rows = await database.update(schema.jobs).set(values).where(owned).returning({ id: schema.jobs.id })
    if (rows.length === 0) throw lost()
  }

  if (event.type === 'step' && event.status === 'running' && event.progress !== undefined) {
    await write({
      status: 'running',
      progress: event.progress,
      progressStep: event.key,
      progressDetail: event.detail ?? null,
      heartbeatAt: now,
      updatedAt: now,
    })
    return
  }

  if (event.type === 'step') {
    const steps = job.steps.map((step) => {
      if (step.key !== event.key) return step
      const finished = ['done', 'skipped', 'failed'].includes(event.status)
      return {
        ...step,
        status: event.status,
        detail: event.detail ?? step.detail,
        progress: finished ? undefined : step.progress,
        startedAt: step.startedAt ?? now.toISOString(),
        endedAt: finished ? now.toISOString() : undefined,
      }
    })
    const running = event.status === 'running'
    await write({
      steps,
      status: 'running',
      heartbeatAt: now,
      updatedAt: now,
      progress: running ? null : job.progress,
      progressStep: running ? event.key : job.progressStep,
      progressDetail: running ? (event.detail ?? null) : job.progressDetail,
    })
    if (job.type === 'publish' && running) {
      await updateProject(job.projectId, {
        status: PUBLISH_PHASE[event.key as PublishStepKey] ?? 'rendering',
      })
    }
    return
  }

  if (event.type === 'result') {
    await write({
      result: sql`${schema.jobs.result} || ${JSON.stringify(event.patch)}::jsonb`,
      heartbeatAt: now,
      updatedAt: now,
    })
    await applyResultToProject(job.projectId, event.patch)
    return
  }

  if (event.type === 'waiting') {
    const steps = job.steps.map((s) =>
      s.key === event.key ? { ...s, status: 'waiting' as const, detail: event.detail } : s,
    )
    await write({
      steps,
      status: 'waiting',
      progress: null,
      progressDetail: event.detail ?? null,
      heartbeatAt: now,
      updatedAt: now,
      runnerId: null,
    })
    await updateProject(job.projectId, { status: 'awaiting_approval' })
    if (job.status !== 'waiting') {
      const project = await getProjectRow(job.projectId)
      const post = project.post ?? null
      notify({
        kind: 'approval',
        title: `Ready for your approval: ${project.title || 'Untitled video'}`,
        body: post?.title ? `Title: ${post.title}` : 'Check the title, description and tags, then approve.',
        url: projectLink(job.projectId, 'publish'),
      })
    }
    return
  }

  if (event.type === 'failed') {
    const steps = job.steps.map((s) =>
      s.key === event.key || (!event.key && s.status === 'running')
        ? { ...s, status: 'failed' as const, detail: event.error, endedAt: now.toISOString() }
        : s,
    )
    await write({
      steps,
      status: 'failed',
      error: event.error,
      progress: null,
      heartbeatAt: now,
      updatedAt: now,
      finishedAt: now,
      runnerId: null,
    })
    if (job.type === 'publish') await updateProject(job.projectId, { status: 'failed' })
    if (job.status !== 'failed') {
      const project = await getProjectRow(job.projectId)
      notify({
        kind: 'failed',
        title: `Stopped: ${project.title || 'Untitled video'}`,
        body: `${JOB_NAME[job.type]} stopped. ${event.error}`,
        url: projectLink(job.projectId, job.type === 'publish' ? 'publish' : 'voiceover'),
      })
    }
    return
  }

  // done
  await write({
    status: 'done',
    progress: null,
    progressDetail: null,
    heartbeatAt: now,
    updatedAt: now,
    finishedAt: now,
    runnerId: null,
  })
  if (job.type === 'publish' && job.status !== 'done') await finishPublish(job.projectId, jobId)
}

async function applyResultToProject(projectId: string, patch: JobResult) {
  const database = await db()
  const update: Parameters<typeof updateProject>[1] = {}
  if (patch.voiceover) {
    // A new AI voice-over replaces the old file; timing follows in a later result.
    const project = await getProjectRow(projectId)
    if (project.voiceoverUrl && project.voiceoverUrl !== patch.voiceover.url) {
      await deleteFile(project.voiceoverUrl)
    }
    update.voiceoverUrl = patch.voiceover.url
    update.voiceoverName = patch.voiceover.name
    update.voiceoverDuration = patch.voiceover.duration
    update.transcript = null
  }
  if (patch.transcript) {
    update.transcript = patch.transcript
    update.voiceoverDuration = patch.transcript.duration
  }
  if (patch.post) update.post = patch.post
  if (patch.outputUrl) update.outputUrl = patch.outputUrl
  if (patch.srtUrl) update.srtUrl = patch.srtUrl
  if (patch.driveFolderId) update.driveFolderId = patch.driveFolderId
  if (patch.driveFolderUrl) update.driveFolderUrl = patch.driveFolderUrl
  if (patch.driveFileId) update.driveFileId = patch.driveFileId
  if (patch.youtubeVideoId) update.youtubeVideoId = patch.youtubeVideoId
  if (patch.publishAt !== undefined) update.scheduledAt = patch.publishAt ? new Date(patch.publishAt) : null
  if (Object.keys(update).length) await updateProject(projectId, update)

  if (patch.sceneTimes) {
    await Promise.all(
      patch.sceneTimes.map((t) =>
        database
          .update(schema.scenes)
          .set({ start: t.start, end: t.end })
          .where(and(eq(schema.scenes.id, t.id), eq(schema.scenes.projectId, projectId))),
      ),
    )
  }
  if (patch.createdScenes) {
    await replaceScenes(projectId, patch.createdScenes)
  }
}

function shortsNote(made: number): string {
  return made
    ? `\n${made === 1 ? 'A Short draft is' : `${made} Short drafts are`} ready on the Projects page.`
    : ''
}

async function finishPublish(projectId: string, jobId: string) {
  const project = await getProjectRow(projectId)
  const job = await getJob(jobId)
  const scheduled = project.scheduledAt && project.scheduledAt.getTime() > Date.now()
  const status = project.youtubeVideoId ? (scheduled ? 'scheduled' : 'published') : 'rendered'
  // Not uploaded (YouTube not connected): free the posting slot for another video.
  await updateProject(projectId, project.youtubeVideoId ? { status } : { status, scheduledAt: null })
  // Posted straight away: its comment for viewers goes up now (scheduled ones once they're out).
  if (project.youtubeVideoId && !scheduled) await postDueComments([projectId]).catch(() => [])

  const settings = await getSettings()
  const archived = job.result.archivedKeys ?? []
  if (settings.freeBlobAfterPosting && storageDriver() === 'blob' && project.youtubeVideoId) {
    if (archived.length) {
      await Promise.all(archived.map((url) => deleteFile(url)))
      await updateProject(projectId, { archived: true })
    }
    // The finished video and its captions are safe on Drive (and on YouTube): Vercel Blob's free
    // 1 GB shouldn't keep a 100 MB copy of every posted video.
    if (job.result.driveFileId && (project.outputUrl || project.srtUrl)) {
      await Promise.all([deleteFile(project.outputUrl), deleteFile(project.srtUrl)])
      await updateProject(projectId, { outputUrl: null, srtUrl: null })
    }
  }

  const title = project.post?.title || project.title || 'Untitled video'
  notify({
    kind: 'posted',
    title:
      status === 'scheduled'
        ? `Scheduled: ${title}`
        : status === 'published'
          ? `Posted: ${title}`
          : `Rendered: ${title}`,
    body:
      status === 'scheduled' && project.scheduledAt
        ? `Goes live ${project.scheduledAt.toUTCString()}.${shortsNote(job.result.shortIds?.length ?? 0)}`
        : project.youtubeVideoId
          ? `https://youtu.be/${project.youtubeVideoId}${shortsNote(job.result.shortIds?.length ?? 0)}`
          : 'The video is rendered. YouTube is not connected, so it was not posted.',
    url: projectLink(projectId, 'publish'),
  })
}

export async function approveJob(jobId: string) {
  const job = await getJob(jobId)
  if (job.status !== 'waiting') badRequest('This job is not waiting for approval.')
  const project = await getProjectRow(job.projectId)
  if (!project.post.title.trim()) badRequest('Add a title before approving.')
  if (project.channelYoutubeId && !(await channelFor(project.channelId, project.channelYoutubeId))) {
    badRequest("This video's YouTube channel was disconnected. Reconnect it in Settings first.")
  }
  const database = await db()
  const steps = job.steps.map((s) => (s.key === 'approve' ? { ...s, status: 'pending' as const } : s))
  await database
    .update(schema.jobs)
    .set({
      approved: true,
      status: 'queued',
      steps,
      runnerId: null,
      progress: null,
      progressDetail: null,
      // Upload exactly what the user sees on the Publish tab.
      result: sql`${schema.jobs.result} || ${JSON.stringify({ post: project.post })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId))
  await updateProject(job.projectId, { status: 'uploading' })
  await dispatch(jobId)
}

export async function retryJob(jobId: string) {
  const job = await getJob(jobId)
  if (job.status !== 'failed') badRequest('Only failed jobs can be retried.')
  await assertNoConflict(job.projectId, job.type)
  const database = await db()
  const steps = job.steps.map((s) =>
    s.status === 'failed' || s.status === 'running' ? { ...s, status: 'pending' as const } : s,
  )
  try {
    await database
      .update(schema.jobs)
      .set({
        status: 'queued',
        error: null,
        steps,
        runnerId: null,
        progress: null,
        progressDetail: null,
        attempts: job.attempts + 1,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.jobs.id, jobId))
  } catch (error) {
    if (isDuplicateActive(error))
      badRequest('Another job is already running for this video. Wait for it to finish.')
    throw error
  }
  if (job.type === 'publish') await updateProject(job.projectId, { status: 'rendering' })
  await dispatch(jobId)
}

export async function cancelJob(jobId: string) {
  const job = await getJob(jobId)
  if (job.status === 'done' || job.status === 'failed') return
  const database = await db()
  await database
    .update(schema.jobs)
    .set({
      status: 'failed',
      error: 'Stopped by you.',
      runnerId: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId))
  // The worker service stops at once; a GitHub run stops at its next report (it is refused).
  if (workerMode() === 'render') await workerFetch(`/jobs/${jobId}`, { method: 'DELETE' })
  if (job.type === 'publish') await updateProject(job.projectId, { status: 'draft' })
}

/** Starting over: clears the last publish so the project can be rendered again. */
export async function resetPublish(projectId: string) {
  const database = await db()
  const [job] = await database
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.type, 'publish')))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1)
  if (job && ACTIVE.includes(job.status)) await cancelJob(job.id)
  await updateProject(projectId, { status: 'draft', youtubeVideoId: null, stats: null, commentId: null })
}

export async function pendingJobIds(): Promise<string[]> {
  const database = await db()
  const rows = await database
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ['queued', 'running']))
    .orderBy(schema.jobs.createdAt)
  return rows.map((r) => r.id)
}

export async function buildPayload(jobId: string, request: Request): Promise<JobPayload> {
  const job = await getJob(jobId)
  const projectRow = await getProjectRow(job.projectId)
  const [scenes, characters, settings, channel, drive, insights, searches] = await Promise.all([
    getScenes(job.projectId),
    getCharacters(job.projectId),
    getSettings(),
    channelFor(projectRow.channelId, projectRow.channelYoutubeId),
    getDrive(),
    job.type === 'publish'
      ? topTitles(projectRow.channelId, projectRow.channelYoutubeId)
      : Promise.resolve([]),
    job.type === 'publish'
      ? searchTermsFor(projectRow.channelId, projectRow.channelYoutubeId)
      : Promise.resolve([]),
  ])
  const project = toProjectDTO(projectRow)
  return {
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      steps: job.steps,
      result: job.result,
      attempts: job.attempts,
      approved: job.approved,
    },
    project: {
      id: project.id,
      title: project.title,
      topic: project.topic,
      audience: project.audience,
      tone: project.tone,
      language: project.language,
      artStyle: project.artStyle,
      format: project.format,
      resolution: project.resolution,
      captionStyle: project.captionStyle,
      mode: project.mode,
      pace: project.pace,
      script: project.script,
      voiceoverUrl: project.voiceoverUrl,
      voiceoverDuration: project.voiceoverDuration,
      musicUrl: project.musicUrl,
      musicVolume: project.musicVolume,
      thumbnailUrl: project.thumbnailUrl,
      transcript: project.transcript,
      post: project.post,
      scheduledAt: project.scheduledAt,
      driveFolderId: project.driveFolderId,
      textOverlays: project.textOverlays,
      soundEffects: project.soundEffects,
      voice: project.voice,
    },
    scenes: scenes.map(toSceneDTO),
    characters: characters.map(toCharacterDTO),
    settings,
    google: {
      youtubeRefreshToken: channel?.refreshToken ?? null,
      youtubeChannelMissing: !channel && Boolean(projectRow.channelYoutubeId),
      driveRefreshToken: drive?.refreshToken ?? null,
    },
    insights: { topTitles: insights, searchTerms: searches.map((t) => t.term) },
    appUrl: appUrl(request),
  }
}
