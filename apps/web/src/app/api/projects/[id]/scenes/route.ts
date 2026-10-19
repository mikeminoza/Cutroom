import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { badRequest, newId, readJson, route } from '@/server/http'
import { getProjectFull, getScenes, renumberScenes, replaceScenes, touchProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

const draftSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  narration: z.string().max(5000),
})

/** Adds an empty scene after `afterIndex` (or at the end), or replaces all scenes with `drafts`. */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({
      afterIndex: z.number().int().nullable().default(null),
      drafts: z.array(draftSchema).max(2000).optional(),
    }),
  )
  if (body.drafts) {
    await replaceScenes(id, body.drafts)
    return getProjectFull(id)
  }
  const { afterIndex } = body
  const scenes = await getScenes(id)
  const database = await db()
  const position = afterIndex === null ? scenes.length : afterIndex + 1
  const previous = scenes[position - 1]
  const following = scenes[position]
  const start = previous ? previous.end : 0
  const end = following ? Math.max(start + 0.5, following.start) : start + 4
  for (const scene of scenes.slice(position)) {
    await database
      .update(schema.scenes)
      .set({ index: scene.index + 1 })
      .where(eq(schema.scenes.id, scene.id))
  }
  await database.insert(schema.scenes).values({ id: newId(), projectId: id, index: position, start, end })
  await renumberScenes(id)
  await touchProject(id)
  return getProjectFull(id)
})

/** Bulk timing changes from the timeline, or a new order. */
export const PUT = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({
      times: z
        .array(z.object({ id: z.string(), start: z.number().min(0), end: z.number().min(0) }))
        .optional(),
      order: z.array(z.string()).optional(),
    }),
  )
  const database = await db()
  if (body.times) {
    for (const t of body.times) {
      if (t.end <= t.start) badRequest('A scene must end after it starts.')
      await database
        .update(schema.scenes)
        .set({ start: t.start, end: t.end })
        .where(and(eq(schema.scenes.id, t.id), eq(schema.scenes.projectId, id)))
    }
  }
  if (body.order) {
    for (const [index, sceneId] of body.order.entries()) {
      await database
        .update(schema.scenes)
        .set({ index })
        .where(and(eq(schema.scenes.id, sceneId), eq(schema.scenes.projectId, id)))
    }
    await renumberScenes(id)
  }
  await touchProject(id)
  return getProjectFull(id)
})
