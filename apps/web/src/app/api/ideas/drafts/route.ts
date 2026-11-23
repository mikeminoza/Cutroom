import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { draftBatch, draftFromIdea, latestDraftBatch, queueDraftWriting } from '@/server/drafting'
import { badRequest, readJson, route } from '@/server/http'
import { appUrl } from '@/server/settings'
import { resumeTasks, startRunner } from '@/server/task-runner'

// The first draft is written after the answer, within this limit: the Hobby plan's 300 s with Fluid
// compute. Each later part runs in a request of its own (see server/task-runner.ts).
export const maxDuration = 300

/**
 * The newest batch of drafts being written (or written) on the server, for the Ideas page. Checking
 * on it also starts the queue again when its next run never started.
 */
export const GET = route(async (request) => {
  await resumeTasks(appUrl(request))
  return { batch: await latestDraftBatch() }
})

/**
 * Turns ideas into draft projects (in their series when they have one). Each idea is marked as
 * used and linked to its project. Returns the new project ids in the order of `ids`. With `write`,
 * Gemini then writes each one on the server, one part at a time (the batch), whether or not the
 * page stays open.
 */
export const POST = route(async (request) => {
  const body = await readJson(
    request,
    z.object({
      ids: z.array(z.string().max(100)).min(1).max(20),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
      write: z.boolean().default(false),
    }),
  )
  if (body.write && (await latestDraftBatch())?.running) {
    badRequest('Gemini is still writing your last drafts. Wait for them to finish, or stop them first.')
  }
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
  if (!body.write) return { created, batch: null }
  const batchId = await queueDraftWriting(created.map((c) => c.projectId))
  startRunner(appUrl(request))
  return { created, batch: await draftBatch(batchId) }
})
