// Cuts a Short out of a long video: a new 9:16 project with a run of the original's scenes, their
// images (copied), the matching stretch of the voice-over (cut in the browser and uploaded), and
// the captions' word timing shifted to start at zero.
import { sliceTranscript } from '@cutroom/shared/align'
import { isStoredUnder } from '@cutroom/shared/storage'
import { SHORT_MAX_SECONDS, sceneRange, totalDuration } from '@cutroom/shared/timing'
import { EMPTY_POST, type ImageFit } from '@cutroom/shared/types'
import { eq } from 'drizzle-orm'
import { db, schema } from './db'
import { badRequest } from './http'
import { copyFileOrFail, copyImages, getCharacters, getProjectRow, getScenes } from './projects'

const round = (n: number) => Math.round(n * 1000) / 1000

export interface ShortInput {
  sourceId: string
  newId: string
  from: number
  to: number
  fit: ImageFit
  title: string
  voiceover: { url: string; name: string; duration: number } | null
}

export async function createShort(input: ShortInput): Promise<string> {
  const source = await getProjectRow(input.sourceId)
  if (source.archived) badRequest('This video was archived to Drive, so its files are gone.')
  const scenes = await getScenes(input.sourceId)
  if (scenes.length === 0) badRequest('This video has no scenes yet.')
  if (input.from < 0 || input.to >= scenes.length || input.from > input.to)
    badRequest('Pick a valid run of scenes.')
  const duration = source.voiceoverDuration ?? totalDuration(scenes)
  const range = sceneRange(scenes, input.from, input.to, duration)
  const length = range.end - range.start
  if (length <= 0.5) badRequest('That part is too short.')
  if (length > SHORT_MAX_SECONDS + 0.5) badRequest('Shorts can be at most 3 minutes long. Pick fewer scenes.')
  if (source.voiceoverUrl && !input.voiceover) badRequest('The voice-over for the Short is missing.')
  if (input.voiceover && !isStoredUnder(input.voiceover.url, `projects/${input.newId}/voiceover`)) {
    badRequest('The Short’s voice-over must be uploaded into the Short’s own folder.')
  }

  const database = await db()
  const [taken] = await database
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, input.newId))
  if (taken) badRequest('That Short was already created.')

  const id = input.newId
  const picked = scenes.slice(input.from, input.to + 1)
  const transcript =
    source.transcript && input.voiceover ? sliceTranscript(source.transcript, range.start, range.end) : null
  const musicUrl = source.musicUrl
    ? (await copyFileOrFail(source.musicUrl, `projects/${id}/music`, 'music')).url
    : null
  await database.insert(schema.projects).values({
    id,
    title: input.title.trim() || `${source.title || 'Untitled video'} (Short)`,
    topic: source.topic,
    audience: source.audience,
    tone: source.tone,
    language: source.language,
    artStyle: source.artStyle,
    format: 'portrait',
    resolution: source.resolution,
    captionStyle: source.captionStyle,
    mode: source.mode,
    targetMinutes: Math.max(0.25, Math.round((length / 60) * 4) / 4),
    pace: 3,
    script: picked
      .map((s) => s.narration.trim())
      .filter(Boolean)
      .join(' '),
    notes: source.notes,
    voiceoverUrl: input.voiceover?.url ?? null,
    voiceoverName: input.voiceover?.name ?? null,
    voiceoverDuration: input.voiceover ? round(input.voiceover.duration) : null,
    transcript,
    musicUrl,
    musicName: musicUrl ? source.musicName : null,
    musicVolume: source.musicVolume,
    textOverlays: source.textOverlays,
    voice: source.voice,
    seriesId: source.seriesId,
    channelId: source.channelId,
    channelYoutubeId: source.channelYoutubeId,
    sourceProjectId: source.id,
    post: {
      ...EMPTY_POST,
      privacy: source.post.privacy,
      categoryId: source.post.categoryId,
      madeForKids: source.post.madeForKids,
      playlistId: source.post.playlistId,
      language: source.post.language,
      tags: source.post.tags ?? [],
    },
  })
  try {
    const sceneRows = await Promise.all(
      picked.map(async (scene, i) => {
        const start = i === 0 ? 0 : round(scene.start - range.start)
        const end = i === picked.length - 1 ? round(length) : round(picked[i + 1].start - range.start)
        const image = scene.imageUrl
          ? await copyFileOrFail(
              scene.imageUrl,
              `projects/${id}/scenes`,
              `picture of scene ${scene.index + 1}`,
            )
          : null
        return {
          ...scene,
          id: crypto.randomUUID(),
          projectId: id,
          index: i,
          start,
          end: Math.max(start + 0.1, end),
          imageUrl: image?.url ?? null,
          imageWidth: image ? scene.imageWidth : null,
          imageHeight: image ? scene.imageHeight : null,
          fit: input.fit,
          // The Short opens on its first picture with a cut.
          transition: i === 0 ? 'cut' : scene.transition,
        }
      }),
    )
    await database.insert(schema.scenes).values(sceneRows)
    const characters = await getCharacters(source.id)
    for (const character of characters) {
      await database.insert(schema.characters).values({
        id: crypto.randomUUID(),
        projectId: id,
        name: character.name,
        description: character.description,
        images: await copyImages(character.images, `projects/${id}/characters`),
        position: character.position,
      })
    }
  } catch (error) {
    // Don't leave a half-made Short behind.
    await database.delete(schema.projects).where(eq(schema.projects.id, id))
    throw error
  }
  return id
}
