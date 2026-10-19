// Job orchestration. The web app owns job state; the worker runs the work and
// reports back through applyEvent(). While a job is active, every status check
// from the dashboard also pings the worker, which keeps a free Render instance awake.
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
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getConnection } from './connections'
import { db, schema } from './db'
import type { JobRow } from './db/schema'
import { badRequest, newId, notFound } from './http'
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

export function workerUrl(): string | null {
  return process.env.WORKER_URL ? process.env.WORKER_URL.replace(/\/$/, '') : null
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

export async function pingWorker(): Promise<{ reachable: boolean; busy: boolean }> {
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
  await workerFetch('/jobs', { method: 'POST', body: JSON.stringify({ jobId }) })
}

export async function startJob(projectId: string, type: JobType): Promise<JobRow> {
  const database = await db()
  const [active] = await database
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.projectId, projectId),
        eq(schema.jobs.type, type),
        inArray(schema.jobs.status, ['queued', 'running', 'waiting']),
      ),
    )
    .limit(1)
  if (active) return active

  const id = newId()
  const [job] = await database
    .insert(schema.jobs)
    .values({ id, projectId, type, status: 'queued', steps: initialSteps(type), result: {} })
    .returning()
  if (type === 'publish') await updateProject(projectId, { status: 'rendering' })
  await dispatch(id)
  return job
}

/** Called whenever the dashboard checks on a job. Keeps the worker awake and restarts stalled jobs. */
export async function watchJob(job: JobRow): Promise<void> {
  if (!['queued', 'running'].includes(job.status)) return
  const now = Date.now()
  const kickedAgo = job.kickedAt ? (now - job.kickedAt.getTime()) / 1000 : Number.POSITIVE_INFINITY
  if (kickedAgo < 45) return
  const heartbeatAgo = job.heartbeatAt ? (now - job.heartbeatAt.getTime()) / 1000 : Number.POSITIVE_INFINITY
  const stalled = job.status === 'queued' || heartbeatAgo > STALL_SECONDS
  const database = await db()
  await database.update(schema.jobs).set({ kickedAt: new Date() }).where(eq(schema.jobs.id, job.id))
  if (stalled) {
    await workerFetch('/jobs', { method: 'POST', body: JSON.stringify({ jobId: job.id }) })
  } else {
    await workerFetch(`/jobs/${job.id}`, undefined, 5000)
  }
}

const PUBLISH_PHASE: Record<PublishStepKey, 'rendering' | 'uploading'> = {
  render: 'rendering',
  drive: 'rendering',
  details: 'rendering',
  approve: 'rendering',
  youtube: 'uploading',
  finish: 'uploading',
  archive: 'uploading',
}

export async function applyEvent(jobId: string, event: WorkerEvent): Promise<void> {
  const database = await db()
  const job = await getJob(jobId)
  const now = new Date()

  if (event.type === 'step' && event.status === 'running' && event.progress !== undefined) {
    await database
      .update(schema.jobs)
      .set({
        status: 'running',
        progress: event.progress,
        progressStep: event.key,
        progressDetail: event.detail ?? null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(schema.jobs.id, jobId))
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
    await database
      .update(schema.jobs)
      .set({
        steps,
        status: 'running',
        heartbeatAt: now,
        updatedAt: now,
        progress: running ? null : job.progress,
        progressStep: running ? event.key : job.progressStep,
        progressDetail: running ? (event.detail ?? null) : job.progressDetail,
      })
      .where(eq(schema.jobs.id, jobId))
    if (job.type === 'publish' && running) {
      await updateProject(job.projectId, {
        status: PUBLISH_PHASE[event.key as PublishStepKey] ?? 'rendering',
      })
    }
    return
  }

  if (event.type === 'result') {
    await database
      .update(schema.jobs)
      .set({
        result: sql`${schema.jobs.result} || ${JSON.stringify(event.patch)}::jsonb`,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(schema.jobs.id, jobId))
    await applyResultToProject(job.projectId, event.patch)
    return
  }

  if (event.type === 'waiting') {
    const steps = job.steps.map((s) =>
      s.key === event.key ? { ...s, status: 'waiting' as const, detail: event.detail } : s,
    )
    await database
      .update(schema.jobs)
      .set({
        steps,
        status: 'waiting',
        progress: null,
        progressDetail: event.detail ?? null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(schema.jobs.id, jobId))
    await updateProject(job.projectId, { status: 'awaiting_approval' })
    return
  }

  if (event.type === 'failed') {
    const steps = job.steps.map((s) =>
      s.key === event.key || (!event.key && s.status === 'running')
        ? { ...s, status: 'failed' as const, detail: event.error, endedAt: now.toISOString() }
        : s,
    )
    await database
      .update(schema.jobs)
      .set({
        steps,
        status: 'failed',
        error: event.error,
        progress: null,
        heartbeatAt: now,
        updatedAt: now,
        finishedAt: now,
      })
      .where(eq(schema.jobs.id, jobId))
    if (job.type === 'publish') await updateProject(job.projectId, { status: 'failed' })
    return
  }

  // done
  await database
    .update(schema.jobs)
    .set({
      status: 'done',
      progress: null,
      progressDetail: null,
      heartbeatAt: now,
      updatedAt: now,
      finishedAt: now,
    })
    .where(eq(schema.jobs.id, jobId))
  if (job.type === 'publish') await finishPublish(job.projectId, jobId)
}

async function applyResultToProject(projectId: string, patch: JobResult) {
  const database = await db()
  const update: Parameters<typeof updateProject>[1] = {}
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

async function finishPublish(projectId: string, jobId: string) {
  const project = await getProjectRow(projectId)
  const job = await getJob(jobId)
  const scheduled = project.scheduledAt && project.scheduledAt.getTime() > Date.now()
  const status = project.youtubeVideoId ? (scheduled ? 'scheduled' : 'published') : 'rendered'
  // Not uploaded (YouTube not connected): free the posting slot for another video.
  await updateProject(projectId, project.youtubeVideoId ? { status } : { status, scheduledAt: null })

  const settings = await getSettings()
  const archived = job.result.archivedKeys ?? []
  if (
    settings.freeBlobAfterPosting &&
    storageDriver() === 'blob' &&
    archived.length &&
    project.youtubeVideoId
  ) {
    await Promise.all(archived.map((url) => deleteFile(url)))
    await updateProject(projectId, { archived: true })
  }
}

export async function approveJob(jobId: string) {
  const job = await getJob(jobId)
  if (job.status !== 'waiting') badRequest('This job is not waiting for approval.')
  const project = await getProjectRow(job.projectId)
  if (!project.post.title.trim()) badRequest('Add a title before approving.')
  const database = await db()
  const steps = job.steps.map((s) => (s.key === 'approve' ? { ...s, status: 'pending' as const } : s))
  await database
    .update(schema.jobs)
    .set({
      approved: true,
      status: 'queued',
      steps,
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
  const database = await db()
  const steps = job.steps.map((s) =>
    s.status === 'failed' || s.status === 'running' ? { ...s, status: 'pending' as const } : s,
  )
  await database
    .update(schema.jobs)
    .set({
      status: 'queued',
      error: null,
      steps,
      attempts: job.attempts + 1,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId))
  if (job.type === 'publish') await updateProject(job.projectId, { status: 'rendering' })
  await dispatch(jobId)
}

export async function cancelJob(jobId: string) {
  const job = await getJob(jobId)
  if (job.status === 'done' || job.status === 'failed') return
  const database = await db()
  await database
    .update(schema.jobs)
    .set({ status: 'failed', error: 'Stopped by you.', finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.jobs.id, jobId))
  await workerFetch(`/jobs/${jobId}`, { method: 'DELETE' })
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
  if (job && ['queued', 'running', 'waiting'].includes(job.status)) await cancelJob(job.id)
  await updateProject(projectId, { status: 'draft', youtubeVideoId: null })
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
  const [projectRow, scenes, characters, settings, youtube, drive] = await Promise.all([
    getProjectRow(job.projectId),
    getScenes(job.projectId),
    getCharacters(job.projectId),
    getSettings(),
    getConnection('youtube'),
    getConnection('drive'),
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
    },
    scenes: scenes.map(toSceneDTO),
    characters: characters.map(toCharacterDTO),
    settings,
    google: {
      youtubeRefreshToken: youtube?.refreshToken ?? null,
      driveRefreshToken: drive?.refreshToken ?? null,
    },
    appUrl: appUrl(request),
  }
}
