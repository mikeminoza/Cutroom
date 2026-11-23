import { z } from 'zod'
import { writeProjectScript } from '@/server/drafting'
import { readJson, route } from '@/server/http'
import { getProjectFull } from '@/server/projects'
import { tracked } from '@/server/tasks'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const { notes } = await readJson(request, z.object({ notes: z.string().max(4000).default('') }))
  await tracked(id, 'script', () => writeProjectScript(id, notes))
  return getProjectFull(id)
})
