import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { createProject, listProjects } from '@/server/projects'

export const GET = route(async () => listProjects())

export const POST = route(async (request) => {
  const input = await readJson(
    request,
    z.object({
      title: z.string().max(200).default(''),
      topic: z.string().max(4000).default(''),
      format: z.enum(['landscape', 'portrait']).default('landscape'),
    }),
  )
  const id = await createProject(input)
  return { id }
})
