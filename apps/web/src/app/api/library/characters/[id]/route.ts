import { deleteFile } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { notFound, readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(
    request,
    z.object({ name: z.string().max(100), description: z.string().max(2000) }).partial(),
  )
  const database = await db()
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
