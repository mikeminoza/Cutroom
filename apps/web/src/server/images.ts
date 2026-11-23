// Generating pictures with Gemini: scene images (with the characters' reference images attached,
// so they look the same in every scene) and thumbnails.
import { generateImage, hasGeminiKey, MAX_REFERENCE_IMAGES, type ReferenceImage } from '@cutroom/shared/ai'
import { imageDimensions, imageExtension } from '@cutroom/shared/images'
import { buildImagePrompt, sceneCharacters } from '@cutroom/shared/prompts'
import { deleteFile, makeKey, putFile, readStoredFile } from '@cutroom/shared/storage'
import { type CharacterInput, hasPicture, type VideoFormat } from '@cutroom/shared/types'
import { and, eq, isNull } from 'drizzle-orm'
import { STOPPED_BY_YOU } from '@/lib/tasks'
import { db, schema } from './db'
import type { SceneRow } from './db/schema'
import { badRequest } from './http'
import { getCharacters, getProjectRow, getScenes, toCharacterDTO, toSceneDTO, touchProject } from './projects'
import { appUrl } from './settings'
import { activeTasks, cancelQueued, queueBatch } from './tasks'

/** Pictures one queued task makes side by side: as many as the Images step used to make at once. */
const PICTURES_AT_ONCE = 2

const ACCEPTED = /^image\/(png|jpeg|webp|heic|heif)$/

/** Up to two images per character, at most MAX_REFERENCE_IMAGES in all. Unreadable ones are skipped. */
export async function referenceImages(characters: CharacterInput[]): Promise<ReferenceImage[]> {
  const picks = characters.flatMap((c) => c.images.slice(0, 2)).slice(0, MAX_REFERENCE_IMAGES)
  const loaded = await Promise.all(
    picks.map(async (image) => {
      try {
        const file = await readStoredFile(image.url, appUrl())
        return ACCEPTED.test(file.contentType) ? { data: file.data, mimeType: file.contentType } : null
      } catch (error) {
        console.warn(`Reference image ${image.url} was skipped:`, error)
        return null
      }
    }),
  )
  return loaded.filter((r): r is ReferenceImage => r !== null)
}

/** Generates a picture and stores it in the project's `folder`. */
export async function generateAndStore(input: {
  projectId: string
  folder: 'scenes' | 'thumbnail'
  name: string
  prompt: string
  characters: CharacterInput[]
  aspectRatio: '16:9' | '9:16'
}): Promise<{ url: string; width: number | null; height: number | null }> {
  if (!input.prompt.trim()) badRequest('Write an image prompt first.')
  const references = await referenceImages(input.characters)
  const image = await generateImage({ prompt: input.prompt, references, aspectRatio: input.aspectRatio })
  const size = imageDimensions(image.data)
  const stored = await putFile(
    makeKey(`projects/${input.projectId}/${input.folder}`, `${input.name}${imageExtension(image.mimeType)}`),
    image.data,
    image.mimeType,
  )
  return { url: stored.url, width: size?.width ?? null, height: size?.height ?? null }
}

export function aspectFor(format: VideoFormat): '16:9' | '9:16' {
  return format === 'portrait' ? '9:16' : '16:9'
}

/**
 * Gemini makes the scene's picture from its prompt (the characters' reference images attached) and
 * puts it on the scene in place of the old one. For the scene's Generate button, and for Generate
 * missing (from the queue) with `onlyMissing`: a scene that got a picture while it waited (uploaded,
 * or built from the Library) keeps it, and no picture is asked for. Returns the scene, or null when
 * it was deleted (or got a picture) meanwhile.
 */
export async function makeScenePicture(id: string, onlyMissing = false): Promise<SceneRow | null> {
  const database = await db()
  const [scene] = await database.select().from(schema.scenes).where(eq(schema.scenes.id, id))
  if (!scene || (onlyMissing && hasPicture(scene))) return null
  const project = await getProjectRow(scene.projectId)
  const characters = (await getCharacters(project.id)).map(toCharacterDTO)
  const dto = toSceneDTO(scene)
  const image = await generateAndStore({
    projectId: project.id,
    folder: 'scenes',
    name: `scene-${String(scene.index + 1).padStart(3, '0')}`,
    prompt: buildImagePrompt(dto, { artStyle: project.artStyle, format: project.format, characters }),
    characters: sceneCharacters(dto, characters),
    aspectRatio: aspectFor(project.format),
  })
  const [updated] = await database
    .update(schema.scenes)
    .set({ imageUrl: image.url, imageWidth: image.width, imageHeight: image.height })
    .where(and(eq(schema.scenes.id, id), onlyMissing ? isNull(schema.scenes.imageUrl) : undefined))
    .returning()
  if (!updated) {
    // The scene was deleted while its picture was being made, or a picture was dropped on it.
    await deleteFile(image.url)
    return null
  }
  if (scene.imageUrl && scene.imageUrl !== image.url) await deleteFile(scene.imageUrl)
  await touchProject(project.id)
  return updated
}

/**
 * Queues Gemini to make the picture of every scene still without one (Images → Generate missing),
 * in scene order, two side by side to a task. Scenes whose picture is queued or being made already
 * are left out. Returns how many were queued.
 */
export async function queueMissingPictures(projectId: string): Promise<number> {
  if (!hasGeminiKey()) badRequest('Add GEMINI_API_KEY to your environment to use AI features.')
  await getProjectRow(projectId)
  const [scenes, active] = await Promise.all([getScenes(projectId), activeTasks(projectId)])
  const missing = scenes.filter((s) => !hasPicture(s))
  if (missing.length === 0) badRequest('Every scene has a picture.')
  const busy = new Set(active.filter((t) => t.kind === 'picture').flatMap((t) => t.input.sceneIds ?? []))
  const ids = missing.filter((s) => !busy.has(s.id)).map((s) => s.id)
  if (ids.length === 0) badRequest('Every scene without a picture is already being made.')
  const tasks: Parameters<typeof queueBatch>[0] = []
  for (let i = 0; i < ids.length; i += PICTURES_AT_ONCE) {
    tasks.push({ kind: 'picture', projectId, input: { sceneIds: ids.slice(i, i + PICTURES_AT_ONCE) } })
  }
  await queueBatch(tasks)
  return ids.length
}

/** Stops Generate missing: the pictures not started are left; the ones being made are finished. */
export async function stopPictures(projectId: string): Promise<void> {
  await cancelQueued(projectId, 'picture', STOPPED_BY_YOU)
}
