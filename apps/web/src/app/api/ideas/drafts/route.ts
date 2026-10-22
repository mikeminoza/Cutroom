import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { draftFromIdea } from '@/server/drafting'
import { badRequest, readJson, route } from '@/server/http'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

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
    const projectId = await draftFromIdea(idea, body.format)
    created.push({ ideaId: idea.id, projectId })
  }
  return { created }
})
