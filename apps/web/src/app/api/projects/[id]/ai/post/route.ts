import { writePost } from '@/server/drafting'
import { route } from '@/server/http'
import { answer } from '@/server/stream'

// Gemini can take a while on long scripts: the Hobby plan allows 300 s with Fluid compute (on by
// default). AI_BUDGET_MS ends the AI work in time to answer with a clear message.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Writes the post details and saves them. When the page asks, the post is sent as Gemini writes
 * it (server/stream.ts); either way the work is recorded while it runs, and finishes and saves
 * when the page goes away.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  return answer(request, (events) => writePost(id, events), { projectId: id, kind: 'post' })
})
