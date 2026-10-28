import type { JobType } from '@cutroom/shared/protocol'
import { copyStoredFile, deleteFile, isStoredUnder } from '@cutroom/shared/storage'
import {
  type Accent,
  type ChannelNiche,
  EMPTY_POST,
  hasPicture,
  type Motion,
  normalizeAccent,
  normalizeTransition,
  type ProjectStatus,
  type SeriesTemplate,
  thumbnailOf,
} from '@cutroom/shared/types'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { CharacterDTO, JobDTO, ProjectDTO, ProjectFull, ProjectSummary, SceneDTO } from '@/lib/dto'
import { effectiveStatus } from '@/lib/stage'
import { getChannel } from './connections'
import { db, schema } from './db'
import type { CharacterRow, JobRow, ProjectRow, SceneRow } from './db/schema'
import { badRequest, newId, notFound } from './http'
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
  notes?: string
  /** Start from a series: its brief, look, voice, music, characters and post settings. */
  series?: { id: string; template: SeriesTemplate } | null
}) {
  const database = await db()
  const settings = await getSettings()
  const id = newId()
  const t = input.series?.template ?? null
  // A series brings its own setup; anything else starts from the channel's niche.
  const niche = t ? null : settings.niche
  const format = t?.format ?? input.format
  const seriesChannel = t?.channelId ? await getChannel(t.channelId) : null
  await database.insert(schema.projects).values({
    id,
    title: input.title,
    topic: input.topic || t?.topic || '',
    format,
    resolution: t?.resolution ?? settings.defaults.resolution,
    captionStyle: t?.captionStyle ?? settings.defaults.captionStyle,
    mode: t?.mode ?? settings.defaults.mode,
    language: t?.language ?? settings.defaults.language,
    audience: t?.audience ?? niche?.audience ?? '',
    tone: t?.tone ?? niche?.tone ?? '',
    artStyle: t?.artStyle ?? niche?.artStyle ?? '',
    notes: [t?.notes, nicheNotes(niche), input.notes].filter((n) => n?.trim()).join('\n\n'),
    targetMinutes: t?.targetMinutes ?? (format === 'portrait' ? 1 : (niche?.targetMinutes ?? 5)),
    pace: t?.pace ?? (format === 'portrait' ? 3 : (niche?.pace ?? 3)),
    textOverlays: t?.textOverlays ?? true,
    soundEffects: t?.soundEffects ?? true,
    voice: t?.voice ?? null,
    musicVolume: t?.musicVolume ?? 0.15,
    seriesId: input.series?.id ?? null,
    channelId: seriesChannel?.id ?? null,
    channelYoutubeId: t?.channelYoutubeId ?? seriesChannel?.youtubeId ?? null,
    post: {
      ...EMPTY_POST,
      privacy: t?.post.privacy ?? settings.defaults.privacy,
      categoryId: t?.post.categoryId ?? settings.defaults.categoryId,
      madeForKids: t?.post.madeForKids ?? settings.defaults.madeForKids,
      playlistId: t?.post.playlistId ?? settings.defaults.playlistId,
      language: t?.post.language ?? settings.defaults.language,
      tags: t?.post.tags ?? [],
    },
  })
  if (t) await applyTemplateFiles(id, t)
  else if (niche?.characterIds.length) await applyNicheCharacters(id, niche.characterIds)
  return id
}

/** The niche's description and narration style, as notes the script writer reads. */
function nicheNotes(niche: ChannelNiche | null): string {
  if (!niche) return ''
  return [
    niche.description.trim() && `Channel: ${niche.description.trim()}`,
    niche.narration.trim() && `Narration: ${niche.narration.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Gives a new project its own copies of the niche's main characters, in the niche's order. */
async function applyNicheCharacters(projectId: string, characterIds: string[]) {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.libraryCharacters)
    .where(inArray(schema.libraryCharacters.id, characterIds))
  const ordered = characterIds.flatMap((cid) => rows.filter((r) => r.id === cid))
  for (const [position, character] of ordered.entries()) {
    // A new video shouldn't fail over one missing image; it just goes without it.
    const images = await copyImages(character.images, `projects/${projectId}/characters`, {
      skipMissing: true,
    })
    await database.insert(schema.characters).values({
      id: newId(),
      projectId,
      name: character.name,
      description: character.description,
      images,
      position,
    })
  }
}

/** Gives a new project its own copies of the series' music and character images. */
async function applyTemplateFiles(projectId: string, template: SeriesTemplate) {
  const database = await db()
  if (template.musicUrl) {
    try {
      const music = await copyStoredFile(template.musicUrl, `projects/${projectId}/music`)
      await database
        .update(schema.projects)
        .set({ musicUrl: music.url, musicName: template.musicName })
        .where(eq(schema.projects.id, projectId))
    } catch (error) {
      console.warn('Series music was not copied:', error)
    }
  }
  for (const [position, character] of template.characters.entries()) {
    // A new episode shouldn't fail over one missing series file; it just goes without it.
    const images = await copyImages(character.images, `projects/${projectId}/characters`, {
      skipMissing: true,
    })
    await database.insert(schema.characters).values({
      id: newId(),
      projectId,
      name: character.name,
      description: character.description,
      images,
      position,
    })
  }
}

/**
 * Copies images into `folder`. When one can't be copied it fails (removing the copies it made), so
 * nothing ends up silently missing pictures; with `skipMissing` it leaves that image out instead.
 */
export async function copyImages(
  images: { url: string; key: string }[],
  folder: string,
  { skipMissing = false } = {},
): Promise<{ url: string; key: string }[]> {
  const results = await Promise.allSettled(images.map((image) => copyStoredFile(image.url, folder)))
  const copies = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) {
    console.warn('A character image was not copied:', failed.reason)
    if (!skipMissing) {
      await Promise.all(copies.map((copy) => deleteFile(copy.url)))
      badRequest('A character image could not be copied. Upload it again, or remove it, and try again.')
    }
  }
  return copies
}

/**
 * A file the browser says belongs to a project must be in that project's folder for its kind.
 * Replacing or removing it later deletes it, so it must never point at someone else's file.
 */
export function assertProjectFile(
  url: string | null | undefined,
  projectId: string,
  kind: 'scenes' | 'characters' | 'voiceover' | 'music' | 'thumbnail',
) {
  if (url == null) return
  if (!isStoredUnder(url, `projects/${projectId}/${kind}`))
    badRequest('Upload the file to this project first.')
}

/** Copies one stored file, or fails with a message saying which one. */
export async function copyFileOrFail(url: string, folder: string, what: string) {
  try {
    return await copyStoredFile(url, folder)
  } catch (error) {
    console.warn(`${url} was not copied:`, error)
    badRequest(`The ${what} could not be copied. Upload it again, or remove it, and try again.`)
  }
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

export async function latestJob(projectId: string, type: JobType): Promise<JobRow | null> {
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
  const [scenes, characters, retime, publish, voice] = await Promise.all([
    getScenes(id),
    getCharacters(id),
    latestJob(id, 'retime'),
    latestJob(id, 'publish'),
    latestJob(id, 'voice'),
  ])
  const dto = toProjectDTO(project)
  dto.status = effectiveStatus({
    status: project.status,
    scheduledAt: dto.scheduledAt,
    hasScript: Boolean(project.script.trim()),
    sceneCount: scenes.length,
    imagesDone: scenes.filter(hasPicture).length,
    hasVoiceover: Boolean(project.voiceoverUrl),
    timed: isTimed(project, scenes),
  })
  return {
    project: dto,
    scenes: scenes.map(toSceneDTO),
    characters: characters.map(toCharacterDTO),
    jobs: {
      retime: retime ? toJobDTO(retime) : null,
      publish: publish ? toJobDTO(publish) : null,
      voice: voice ? toJobDTO(voice) : null,
    },
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
        layer: schema.scenes.layer,
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
        imagesDone: frames.filter(hasPicture).length,
        hasVoiceover: Boolean(row.voiceoverUrl),
        timed: isTimed(row, frames),
      }),
      duration,
      scheduledAt,
      youtubeVideoId: row.youtubeVideoId,
      updatedAt: row.updatedAt.toISOString(),
      seriesId: row.seriesId,
      channelId: row.channelId,
      stats: row.stats ?? null,
      // A layered scene shows its background (or the pose) as its thumbnail.
      frames: frames.map((f) => ({ start: f.start, end: f.end, imageUrl: thumbnailOf(f) })),
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
  // AI voice-over parts a stopped voice job kept for its retry.
  const voiceJobs = await database
    .select({ result: schema.jobs.result })
    .from(schema.jobs)
    .where(eq(schema.jobs.projectId, id))
  await database.delete(schema.projects).where(eq(schema.projects.id, id))
  const urls = [
    full.project.voiceoverUrl,
    full.project.musicUrl,
    full.project.thumbnailUrl,
    full.project.outputUrl,
    full.project.srtUrl,
    ...full.scenes.map((s) => s.imageUrl),
    ...full.characters.flatMap((c) => c.images.map((i) => i.url)),
    ...voiceJobs.flatMap((j) => (j.result.voiceParts ?? []).map((p) => p.url)),
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
  accent?: Accent
  accentWord?: string
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
        transition: normalizeTransition(d.transition),
        accent: normalizeAccent(d.accent),
        accentWord: d.accentWord ?? '',
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
