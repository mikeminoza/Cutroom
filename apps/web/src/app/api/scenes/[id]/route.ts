import { deleteFile, isStoredUnder } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { assertProjectFile, getProjectFull, getScene, renumberScenes, touchProject } from '@/server/projects'
import { scenePatchSchema } from '@/server/validation'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(request, scenePatchSchema)
  const scene = await getScene(id)
  if (patch.layer) {
    const { backgroundUrl, poseUrl, blinkUrl } = patch.layer
    if (
      [backgroundUrl, poseUrl, blinkUrl].some(
        (url) =>
          url && !isStoredUnder(url, 'library/backgrounds') && !isStoredUnder(url, 'library/characters'),
      )
    ) {
      badRequest('Pick the background and pose from the Library.')
    }
  }
  if (patch.imageUrl !== undefined && patch.imageUrl !== scene.imageUrl) {
    assertProjectFile(patch.imageUrl, scene.projectId, 'scenes')
    await deleteFile(scene.imageUrl)
    if (patch.imageUrl === null) {
      patch.imageWidth = null
      patch.imageHeight = null
    }
  }
  const database = await db()
  const [updated] = await database
    .update(schema.scenes)
    .set(patch as Partial<typeof schema.scenes.$inferInsert>)
    .where(eq(schema.scenes.id, id))
    .returning()
  await touchProject(scene.projectId)
  const { projectId: _p, ...dto } = updated
  return dto
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const scene = await getScene(id)
  const database = await db()
  await database.delete(schema.scenes).where(eq(schema.scenes.id, id))
  await deleteFile(scene.imageUrl)
  await renumberScenes(scene.projectId)
  await touchProject(scene.projectId)
  return getProjectFull(scene.projectId)
})
