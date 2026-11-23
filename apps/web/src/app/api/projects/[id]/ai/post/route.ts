import { writePost } from '@/server/drafting'
import { route } from '@/server/http'
import { tracked } from '@/server/tasks'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  return tracked(id, 'post', () => writePost(id))
})
