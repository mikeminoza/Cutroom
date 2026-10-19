import { deleteFile } from '@cutroom/shared/storage'
import { EMPTY_POST, type Motion, type ProjectStatus } from '@cutroom/shared/types'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { CharacterDTO, JobDTO, ProjectDTO, ProjectFull, ProjectSummary, SceneDTO } from '@/lib/dto'
import { effectiveStatus } from '@/lib/stage'
import { db, schema } from './db'
import type { CharacterRow, JobRow, ProjectRow, SceneRow } from './db/schema'
import { newId, notFound } from './http'
import { getSettings } from './settings'

export function toProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    ...row,
    post: { ...EMPTY_POST, ...row.post },
    transcript: row.transcript ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSceneDTO(row: SceneRow): SceneDTO {
  const { projectId: _projectId, ...rest } = row
  return rest
}

export function toCharacterDTO(row: CharacterRow): CharacterDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    images: row.images,
    position: row.position,
  }
}

export function toJobDTO(row: JobRow): JobDTO {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    steps: row.steps,
    result: row.result,
    error: row.error,
    approved: row.approved,
    progress: row.progress,
    progressStep: row.progressStep,
    progressDetail: row.progressDetail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

export function isTimed(
  project: Pick<ProjectRow, 'transcript' | 'voiceoverDuration'>,
  scenes: { end: number }[],
): boolean {
  if (project.transcript) return true
  if (!project.voiceoverDuration || scenes.length === 0) return false
  const last = Math.max(...scenes.map((s) => s.end))
  return Math.abs(last - project.voiceoverDuration) < 1
}

export async function createProject(input: {
  title: string
  topic: string
  format: 'landscape' | 'portrait'
}) {
  const database = await db()
  const settings = await getSettings()
  const id = newId()
  await database.insert(schema.projects).values({
    id,
    title: input.title,
    topic: input.topic,
    format: input.format,
    resolution: settings.defaults.resolution,
    captionStyle: settings.defaults.captionStyle,
    mode: settings.defaults.mode,
    language: settings.defaults.language,
    targetMinutes: input.format === 'portrait' ? 1 : 5,
    pace: input.format === 'portrait' ? 3 : 6,
    post: {
      ...EMPTY_POST,
      privacy: settings.defaults.privacy,
      categoryId: settings.defaults.categoryId,
      madeForKids: settings.defaults.madeForKids,
      playlistId: settings.defaults.playlistId,
      language: settings.defaults.language,
    },
  })
  return id
}

export async function getProjectRow(id: string): Promise<ProjectRow> {
  const database = await db()
  const [row] = await database.select().from(schema.projects).where(eq(schema.projects.id, id))
  if (!row) notFound('This project')
  return row
}

export async function getScenes(projectId: string): Promise<SceneRow[]> {
  const database = await db()
  return database
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.projectId, projectId))
    .orderBy(asc(schema.scenes.index))
}

export async function getCharacters(projectId: string): Promise<CharacterRow[]> {
  const database = await db()
  return database
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.projectId, projectId))
    .orderBy(asc(schema.characters.position), asc(schema.characters.createdAt))
}

export async function latestJob(projectId: string, type: 'retime' | 'publish'): Promise<JobRow | null> {
  const database = await db()
  const [row] = await database
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.type, type)))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(1)
  return row ?? null
}

export async function getProjectFull(id: string): Promise<ProjectFull> {
  const project = await getProjectRow(id)
  const [scenes, characters, retime, publish] = await Promise.all([
    getScenes(id),
    getCharacters(id),
    latestJob(id, 'retime'),
    latestJob(id, 'publish'),
  ])
  const dto = toProjectDTO(project)
  dto.status = effectiveStatus({
    status: project.status,
    scheduledAt: dto.scheduledAt,
    hasScript: Boolean(project.script.trim()),
    sceneCount: scenes.length,
    imagesDone: scenes.filter((s) => s.imageUrl).length,
    hasVoiceover: Boolean(project.voiceoverUrl),
    timed: isTimed(project, scenes),
  })
  return {
    project: dto,
    scenes: scenes.map(toSceneDTO),
    characters: characters.map(toCharacterDTO),
    jobs: { retime: retime ? toJobDTO(retime) : null, publish: publish ? toJobDTO(publish) : null },
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const database = await db()
  const rows = await database.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt))
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [sceneRows, jobRows] = await Promise.all([
    database
      .select({
        projectId: schema.scenes.projectId,
        index: schema.scenes.index,
        start: schema.scenes.start,
        end: schema.scenes.end,
        imageUrl: schema.scenes.imageUrl,
      })
      .from(schema.scenes)
      .where(inArray(schema.scenes.projectId, ids))
      .orderBy(asc(schema.scenes.index)),
    database
      .select()
      .from(schema.jobs)
      .where(
        and(
          inArray(schema.jobs.projectId, ids),
          inArray(schema.jobs.status, ['queued', 'running', 'waiting']),
        ),
      )
      .orderBy(desc(schema.jobs.createdAt)),
  ])
  return rows.map((row) => {
    const frames = sceneRows.filter((s) => s.projectId === row.id)
    const job = jobRows.find((j) => j.projectId === row.id)
    const duration = row.voiceoverDuration ?? frames.reduce((max, f) => Math.max(max, f.end), 0)
    const scheduledAt = row.scheduledAt?.toISOString() ?? null
    return {
      id: row.id,
      title: row.title,
      topic: row.topic,
      format: row.format,
      status: effectiveStatus({
        status: row.status,
        scheduledAt,
        hasScript: Boolean(row.script.trim()),
        sceneCount: frames.length,
        imagesDone: frames.filter((f) => f.imageUrl).length,
        hasVoiceover: Boolean(row.voiceoverUrl),
        timed: isTimed(row, frames),
      }),
      duration,
      scheduledAt,
      youtubeVideoId: row.youtubeVideoId,
      updatedAt: row.updatedAt.toISOString(),
      frames: frames.map((f) => ({ start: f.start, end: f.end, imageUrl: f.imageUrl })),
      hasScript: Boolean(row.script.trim()),
      hasVoiceover: Boolean(row.voiceoverUrl),
      timed: isTimed(row, frames),
      job: job
        ? { type: job.type, status: job.status, progress: job.progress, detail: job.progressDetail }
        : null,
    }
  })
}

type ProjectPatch = Partial<Omit<ProjectRow, 'id' | 'createdAt' | 'updatedAt' | 'scheduledAt'>> & {
  scheduledAt?: Date | null
}

export async function updateProject(id: string, patch: ProjectPatch) {
  const database = await db()
  const result = await database
    .update(schema.projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning({ id: schema.projects.id })
  if (result.length === 0) notFound('This project')
}

export async function touchProject(id: string) {
  const database = await db()
  await database.update(schema.projects).set({ updatedAt: new Date() }).where(eq(schema.projects.id, id))
}

export async function setStatus(id: string, status: ProjectStatus) {
  await updateProject(id, { status })
}

export async function deleteProject(id: string) {
  const full = await getProjectFull(id)
  const database = await db()
  await database.delete(schema.projects).where(eq(schema.projects.id, id))
  const urls = [
    full.project.voiceoverUrl,
    full.project.musicUrl,
    full.project.thumbnailUrl,
    full.project.outputUrl,
    full.project.srtUrl,
    ...full.scenes.map((s) => s.imageUrl),
    ...full.characters.flatMap((c) => c.images.map((i) => i.url)),
  ]
  await Promise.all(urls.map((u) => deleteFile(u)))
}

export interface SceneDraftInput {
  start: number
  end: number
  narration: string
  visual?: string
  imagePrompt?: string
  characters?: string[]
  shot?: string
  motion?: Motion
  onScreenText?: string
  transition?: string
  notes?: string
}

/** Replaces every scene in the project (used after splitting the script). */
export async function replaceScenes(projectId: string, drafts: SceneDraftInput[]) {
  const database = await db()
  const old = await getScenes(projectId)
  await database.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId))
  if (drafts.length) {
    await database.insert(schema.scenes).values(
      drafts.map((d, index) => ({
        id: newId(),
        projectId,
        index,
        start: d.start,
        end: d.end,
        narration: d.narration,
        visual: d.visual ?? '',
        imagePrompt: d.imagePrompt ?? '',
        characters: d.characters ?? [],
        shot: d.shot ?? '',
        motion: d.motion ?? 'zoom-in',
        onScreenText: d.onScreenText ?? '',
        transition: d.transition ?? 'cut',
        notes: d.notes ?? '',
      })),
    )
  }
  await Promise.all(old.map((s) => deleteFile(s.imageUrl)))
  await updateProject(projectId, { status: 'draft' })
}

export async function renumberScenes(projectId: string) {
  const database = await db()
  const rows = await getScenes(projectId)
  await Promise.all(
    rows.map((row, index) =>
      row.index === index
        ? null
        : database.update(schema.scenes).set({ index }).where(eq(schema.scenes.id, row.id)),
    ),
  )
}

export async function getScene(id: string): Promise<SceneRow> {
  const database = await db()
  const [row] = await database.select().from(schema.scenes).where(eq(schema.scenes.id, id))
  if (!row) notFound('This scene')
  return row
}
