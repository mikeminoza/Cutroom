// A series is a saved setup for a run of videos: brief, look, voice, music, characters and post
// settings, copied from a project. Every new episode starts from it. The series owns copies of its
// files, so posting (which clears an episode's working files) never touches them.
import { deleteFile } from '@cutroom/shared/storage'
import type { SeriesTemplate } from '@cutroom/shared/types'
import { desc, eq, sql } from 'drizzle-orm'
import type { SeriesDTO } from '@/lib/dto'
import { db, schema } from './db'
import type { SeriesRow } from './db/schema'
import { badRequest, newId, notFound } from './http'
import { copyFileOrFail, copyImages, getCharacters, getProjectRow } from './projects'

export async function getSeries(id: string): Promise<SeriesRow | null> {
  const database = await db()
  const [row] = await database.select().from(schema.series).where(eq(schema.series.id, id))
  return row ?? null
}

export async function listSeries(): Promise<SeriesDTO[]> {
  const database = await db()
  const rows = await database.select().from(schema.series).orderBy(desc(schema.series.updatedAt))
  const counts = await database
    .select({ seriesId: schema.projects.seriesId, count: sql<number>`count(*)::int` })
    .from(schema.projects)
    .groupBy(schema.projects.seriesId)
  return rows.map((row) => toSeriesDTO(row, Number(counts.find((c) => c.seriesId === row.id)?.count ?? 0)))
}

export function toSeriesDTO(row: SeriesRow, episodes: number): SeriesDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    template: row.template,
    episodes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Builds a template from a project, copying its music and character images into the series. */
async function templateFromProject(projectId: string, seriesId: string): Promise<SeriesTemplate> {
  const project = await getProjectRow(projectId)
  if (project.archived)
    badRequest('This video was archived to Drive, so its files are gone. Pick another one.')
  const characters = await getCharacters(projectId)
  const musicUrl = project.musicUrl
    ? (await copyFileOrFail(project.musicUrl, `series/${seriesId}/music`, 'music')).url
    : null
  return {
    topic: '',
    audience: project.audience,
    tone: project.tone,
    language: project.language,
    artStyle: project.artStyle,
    format: project.format,
    resolution: project.resolution,
    captionStyle: project.captionStyle,
    mode: project.mode,
    targetMinutes: project.targetMinutes,
    pace: project.pace,
    notes: project.notes,
    textOverlays: project.textOverlays,
    soundEffects: project.soundEffects,
    musicUrl,
    musicName: musicUrl ? project.musicName : null,
    musicVolume: project.musicVolume,
    voice: project.voice ?? null,
    channelId: project.channelId ?? null,
    channelYoutubeId: project.channelYoutubeId ?? null,
    post: {
      categoryId: project.post.categoryId,
      privacy: project.post.privacy,
      madeForKids: project.post.madeForKids,
      playlistId: project.post.playlistId,
      language: project.post.language,
      tags: project.post.tags ?? [],
    },
    characters: await Promise.all(
      characters.map(async (c) => ({
        name: c.name,
        description: c.description,
        images: await copyImages(c.images, `series/${seriesId}/characters`),
      })),
    ),
  }
}

function templateFiles(template: SeriesTemplate): string[] {
  return [template.musicUrl, ...template.characters.flatMap((c) => c.images.map((i) => i.url))].filter(
    (u): u is string => Boolean(u),
  )
}

/** Saves the project's setup as a new series, and makes the project its first episode. */
export async function createSeriesFromProject(projectId: string, name: string, description: string) {
  const id = newId()
  const template = await templateFromProject(projectId, id)
  const database = await db()
  const [row] = await database
    .insert(schema.series)
    .values({ id, name: name.trim() || 'Untitled series', description, template })
    .returning()
  await database.update(schema.projects).set({ seriesId: id }).where(eq(schema.projects.id, projectId))
  return row
}

/** Replaces the series setup with the project's current one. */
export async function updateSeriesFromProject(seriesId: string, projectId: string) {
  const current = await getSeries(seriesId)
  if (!current) notFound('That series')
  const template = await templateFromProject(projectId, seriesId)
  const database = await db()
  const [row] = await database
    .update(schema.series)
    .set({ template, updatedAt: new Date() })
    .where(eq(schema.series.id, seriesId))
    .returning()
  await Promise.all(templateFiles(current.template).map((url) => deleteFile(url)))
  return row
}

export async function deleteSeries(id: string) {
  const database = await db()
  const [row] = await database.delete(schema.series).where(eq(schema.series.id, id)).returning()
  if (row) await Promise.all(templateFiles(row.template).map((url) => deleteFile(url)))
}
