import { z } from 'zod'
import { composeProject } from '@/server/drafting'
import { readJson, route } from '@/server/http'
import { getProjectFull } from '@/server/projects'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** Pictures from the Library for every scene still without one (see composeProject). */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { redo } = await readJson(request, z.object({ redo: z.boolean().default(false) }))
  await composeProject(id, redo)
  return getProjectFull(id)
})
