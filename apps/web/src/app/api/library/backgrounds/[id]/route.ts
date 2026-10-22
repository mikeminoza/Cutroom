import { deleteFile } from '@cutroom/shared/storage'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { LibraryBackgroundDTO } from '@/lib/dto'
import { db, schema } from '@/server/db'
import { notFound, readJson, route } from '@/server/http'
import { assertNotInUse } from '@/server/library'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx): Promise<LibraryBackgroundDTO> => {
  const { id } = await params
  const { name } = await readJson(request, z.object({ name: z.string().trim().max(100) }))
  const database = await db()
  const [row] = await database
    .update(schema.libraryBackgrounds)
    .set({ name })
    .where(eq(schema.libraryBackgrounds.id, id))
    .returning()
  if (!row) notFound('That background')
  return { ...row, createdAt: row.createdAt.toISOString() }
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const database = await db()
  const [current] = await database
    .select()
    .from(schema.libraryBackgrounds)
    .where(eq(schema.libraryBackgrounds.id, id))
  if (!current) return { ok: true }
  await assertNotInUse([current.url], 'This background')
  await database.delete(schema.libraryBackgrounds).where(eq(schema.libraryBackgrounds.id, id))
  await deleteFile(current.url)
  return { ok: true }
})
