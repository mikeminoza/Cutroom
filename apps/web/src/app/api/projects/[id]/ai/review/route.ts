import { reviewScript } from '@cutroom/shared/ai'
import { scriptText, scriptVoice } from '@/server/drafting'
import { badRequest, route } from '@/server/http'
import { getProjectRow } from '@/server/projects'
import { answer } from '@/server/stream'

// A careful read of a long script (AI_BUDGET_MS ends it in time to answer clearly).
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * "Punch up and check facts": lines to improve in the narrator's voice, and the claims to check.
 * Sent as Gemini writes them when the page asks (server/stream.ts).
 */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  const script = await scriptText(id)
  if (!script.trim()) badRequest('Write or paste the script first.')
  const project = await getProjectRow(id)
  const voice = await scriptVoice(id)
  return answer(request, (events) =>
    reviewScript({ script, title: project.post?.title || project.title, voice }, events),
  )
})
