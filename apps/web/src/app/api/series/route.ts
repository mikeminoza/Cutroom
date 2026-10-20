import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { getProjectRow } from '@/server/projects'
import { createSeriesFromProject, listSeries, toSeriesDTO } from '@/server/series'

export const GET = route(async () => listSeries())

/** Saves a project's setup as a new series. */
export const POST = route(async (request) => {
  const body = await readJson(
    request,
    z.object({
      projectId: z.string().max(100),
      name: z.string().trim().min(1, 'Name the series.').max(120),
      description: z.string().max(1000).default(''),
    }),
  )
  await getProjectRow(body.projectId)
  const row = await createSeriesFromProject(body.projectId, body.name, body.description)
  return toSeriesDTO(row, 1)
})
