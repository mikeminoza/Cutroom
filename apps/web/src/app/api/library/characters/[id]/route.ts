import { deleteFile, isStoredUnder } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, notFound, readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(
    request,
    z
      .object({
        name: z.string().max(100),
        description: z.string().max(2000),
        images: z.array(z.object({ url: z.string().max(2000), key: z.string().max(500) })).max(6),
      })
      .partial(),
  )
  const database = await db()
  const [current] = await database
    .select()
    .from(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
  if (!current) notFound('That character')
  if (patch.images) {
    // Only files in this character's own folder: removing one deletes it.
    if (patch.images.some((i) => !isStoredUnder(i.url, `library/characters/${id}`))) {
      badRequest('Upload the images to this character first.')
    }
    const kept = new Set(patch.images.map((i) => i.url))
    await Promise.all(current.images.filter((i) => !kept.has(i.url)).map((i) => deleteFile(i.url)))
  }
  const [row] = await database
    .update(schema.libraryCharacters)
    .set(patch)
    .where(eq(schema.libraryCharacters.id, id))
    .returning()
  if (!row) notFound('That character')
  return { ...row, createdAt: row.createdAt.toISOString() }
})

/** Projects that used the character keep their own copies. */
export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const database = await db()
  const [row] = await database
    .delete(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
    .returning()
  if (row) await Promise.all(row.images.map((i) => deleteFile(i.url)))
  return { ok: true }
})
