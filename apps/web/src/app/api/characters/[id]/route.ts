import { deleteFile } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { notFound, readJson, route } from '@/server/http'
import { toCharacterDTO, touchProject } from '@/server/projects'
import { characterPatchSchema } from '@/server/validation'

type Ctx = { params: Promise<{ id: string }> }

async function load(id: string) {
  const database = await db()
  const [row] = await database.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!row) notFound('This character')
  return row
}

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(request, characterPatchSchema)
  const current = await load(id)
  if (patch.images) {
    const kept = new Set(patch.images.map((i) => i.url))
    await Promise.all(current.images.filter((i) => !kept.has(i.url)).map((i) => deleteFile(i.url)))
  }
  const database = await db()
  const [row] = await database
    .update(schema.characters)
    .set(patch)
    .where(eq(schema.characters.id, id))
    .returning()
  await touchProject(current.projectId)
  return toCharacterDTO(row)
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const current = await load(id)
  const database = await db()
  await database.delete(schema.characters).where(eq(schema.characters.id, id))
  await Promise.all(current.images.map((i) => deleteFile(i.url)))
  await touchProject(current.projectId)
  return { ok: true }
})
