import { z } from 'zod'
import { readJson, route } from '@/server/http'
import { draftVideoReplies } from '@/server/replies'
import { answer } from '@/server/stream'

// Gemini drafts the replies (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

/**
 * Has Gemini draft replies to one video's comments that have none yet. Posts nothing. When the
 * page asks, each draft is sent as Gemini writes it, as { comments } (server/stream.ts).
 */
export const POST = route(async (request) => {
  const { projectId } = await readJson(request, z.object({ projectId: z.string().min(1).max(100) }))
  return answer(request, (events) => draftVideoReplies(projectId, events))
})
