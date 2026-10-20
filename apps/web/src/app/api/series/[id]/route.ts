import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { notFound, readJson, route } from '@/server/http'
import { getProjectRow } from '@/server/projects'
import { deleteSeries, getSeries, listSeries, updateSeriesFromProject } from '@/server/series'

type Ctx = { params: Promise<{ id: string }> }

/** Rename, describe, or replace the setup with a project's current one (`fromProjectId`). */
export const PATCH = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const body = await readJson(
    request,
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(1000).optional(),
      fromProjectId: z.string().max(100).optional(),
    }),
  )
  if (!(await getSeries(id))) notFound('That series')
  if (body.fromProjectId) {
    await getProjectRow(body.fromProjectId)
    await updateSeriesFromProject(id, body.fromProjectId)
  }
  if (body.name !== undefined || body.description !== undefined) {
    const database = await db()
    await database
      .update(schema.series)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.series.id, id))
  }
  return (await listSeries()).find((s) => s.id === id)
})

/** Episodes stay; they just stop belonging to a series. */
export const DELETE = route(async (_request, { params }: Ctx) => {
  await deleteSeries((await params).id)
  return { ok: true }
})
