import { desc } from 'drizzle-orm'
import { z } from 'zod'
import type { IdeaDTO } from '@/lib/dto'
import { db, schema } from '@/server/db'
import { addIdeas } from '@/server/drafting'
import { notFound, readJson, route } from '@/server/http'
import { getSeries } from '@/server/series'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

async function listIdeas(): Promise<IdeaDTO[]> {
  const database = await db()
  const rows = await database.select().from(schema.ideas).orderBy(desc(schema.ideas.createdAt))
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

export const GET = route(async () => listIdeas())

/** Asks Gemini for new ideas and adds them to the backlog. */
export const POST = route(async (request) => {
  const body = await readJson(
    request,
    z.object({
      niche: z.string().max(500).default(''),
      seriesId: z.string().max(100).nullable().default(null),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
      count: z.number().int().min(1).max(20).default(8),
      direction: z.string().max(1000).default(''),
    }),
  )
  const series = body.seriesId ? await getSeries(body.seriesId) : null
  if (body.seriesId && !series) notFound('That series')
  await addIdeas({
    niche: body.niche,
    series,
    format: body.format,
    count: body.count,
    direction: body.direction,
  })
  return listIdeas()
})
