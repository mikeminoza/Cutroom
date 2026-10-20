import { z } from 'zod'
import { notFound, readJson, route } from '@/server/http'
import { createProject, listProjects } from '@/server/projects'
import { getSeries } from '@/server/series'

export const GET = route(async () => listProjects())

export const POST = route(async (request) => {
  const input = await readJson(
    request,
    z.object({
      title: z.string().max(200).default(''),
      topic: z.string().max(4000).default(''),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
      notes: z.string().max(4000).default(''),
      seriesId: z.string().max(100).nullable().default(null),
    }),
  )
  const series = input.seriesId ? await getSeries(input.seriesId) : null
  if (input.seriesId && !series) notFound('That series')
  const id = await createProject({ ...input, series })
  return { id }
})
