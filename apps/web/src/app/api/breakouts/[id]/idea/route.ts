import { ideaFromBreakoutRow } from '@/server/breakouts'
import { route } from '@/server/http'

// Gemini writes the idea (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/** Makes an idea for this channel from a breakout; it joins the New ideas. */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  return { ideaId: await ideaFromBreakoutRow(id) }
})
