import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, readJson, route } from '@/server/http'
import { createProject } from '@/server/projects'
import { getSeries } from '@/server/series'

export const maxDuration = 60

/**
 * Turns ideas into draft projects (in their series when they have one). Each idea is marked as
 * used and linked to its project. Returns the new project ids in the order of `ids`.
 */
export const POST = route(async (request) => {
  const body = await readJson(
    request,
    z.object({
      ids: z.array(z.string().max(100)).min(1).max(20),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
    }),
  )
  const database = await db()
  const ideas = await database
    .select()
    .from(schema.ideas)
    .where(and(inArray(schema.ideas.id, body.ids), eq(schema.ideas.status, 'new')))
  if (ideas.length === 0) badRequest('Those ideas were already used or dismissed.')
  const created: { ideaId: string; projectId: string }[] = []
  for (const id of body.ids) {
    const idea = ideas.find((i) => i.id === id)
    if (!idea) continue
    const series = idea.seriesId ? await getSeries(idea.seriesId) : null
    const projectId = await createProject({
      title: idea.title,
      topic: idea.angle ? `${idea.title}. ${idea.angle}` : idea.title,
      format: body.format,
      series,
    })
    await database.update(schema.ideas).set({ status: 'used', projectId }).where(eq(schema.ideas.id, idea.id))
    created.push({ ideaId: idea.id, projectId })
  }
  return { created }
})
