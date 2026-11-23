import { followUpHit } from '@/server/hits'
import { route } from '@/server/http'

// Gemini writes the ideas (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** Has Gemini write follow-up ideas for one of your hits; they join the New ideas. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  return followUpHit(id)
})
