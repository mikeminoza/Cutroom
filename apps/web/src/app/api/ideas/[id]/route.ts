import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { notFound, readJson, route } from '@/server/http'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const patch = await readJson(
    request,
    z
      .object({
        title: z.string().trim().min(1).max(200),
        angle: z.string().max(1000),
        status: z.enum(['new', 'dismissed']),
      })
      .partial(),
  )
  const database = await db()
  const [row] = await database.update(schema.ideas).set(patch).where(eq(schema.ideas.id, id)).returning()
  if (!row) notFound('That idea')
  return { ...row, createdAt: row.createdAt.toISOString() }
})

export const DELETE = route(async (_request, { params }: Ctx) => {
  const database = await db()
  await database.delete(schema.ideas).where(eq(schema.ideas.id, (await params).id))
  return { ok: true }
})
