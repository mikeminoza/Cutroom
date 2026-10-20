import { buildImagePrompt, sceneCharacters } from '@cutroom/shared/prompts'
import { deleteFile } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { route } from '@/server/http'
import { aspectFor, generateAndStore } from '@/server/images'
import {
  getCharacters,
  getProjectRow,
  getScene,
  toCharacterDTO,
  toSceneDTO,
  touchProject,
} from '@/server/projects'

// Image models take 10–40 seconds.
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

/** Generates the scene's picture from its prompt (characters' reference images attached). */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const scene = await getScene(id)
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
  const database = await db()
  const [updated] = await database
    .update(schema.scenes)
    .set({ imageUrl: image.url, imageWidth: image.width, imageHeight: image.height })
    .where(eq(schema.scenes.id, id))
    .returning()
  if (!updated) {
    // The scene was deleted while its picture was being made.
    await deleteFile(image.url)
    return { ok: false }
  }
  if (scene.imageUrl && scene.imageUrl !== image.url) await deleteFile(scene.imageUrl)
  await touchProject(project.id)
  return toSceneDTO(updated)
})
