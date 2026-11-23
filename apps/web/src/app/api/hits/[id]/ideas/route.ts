import { mapPartials } from '@cutroom/shared/ai'
import { followUpHit } from '@/server/hits'
import { route } from '@/server/http'
import { answer } from '@/server/stream'

// Gemini writes the ideas (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * Has Gemini write follow-up ideas for one of your hits; they join the New ideas. When the page
 * asks, each idea is sent as Gemini writes it, as { ideas } (server/stream.ts).
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const write = await followUpHit(id)
  return answer(request, (events) => write(mapPartials(events, (ideas) => ({ ideas }))))
})
