import { z } from 'zod'
import type { IdeaDTO } from '@/lib/dto'
import { db, schema } from '@/server/db'
import { newId, notFound, readJson, route } from '@/server/http'
import { getSeries } from '@/server/series'

/** Adds an idea you came up with yourself to the backlog, next to Gemini's suggestions. */
export const POST = route(async (request): Promise<IdeaDTO> => {
  const body = await readJson(
    request,
    z.object({
      title: z.string().trim().min(1, 'Give the idea a title.').max(200),
      angle: z.string().trim().max(1000).default(''),
      seriesId: z.string().max(100).nullable().default(null),
    }),
  )
  if (body.seriesId && !(await getSeries(body.seriesId))) notFound('That series')
  const database = await db()
  const [row] = await database
    .insert(schema.ideas)
    .values({ id: newId(), title: body.title, angle: body.angle, seriesId: body.seriesId })
    .returning()
  return { ...row, createdAt: row.createdAt.toISOString() }
})
